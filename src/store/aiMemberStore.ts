import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { AIMember, AIMemberKind, builtinAIMembers } from '../config/aiMembers';
import { lookupProviderByEnvName, lookupProviderByModel } from '../config/providers';
import { normalizeTags } from '../config/tagTaxonomy';

interface RustAIMember {
  id: string;
  kind: string;
  name: string;
  avatar: string | null;
  description: string | null;
  tags: string | null;
  source: string;
  config: string;
  enabled: number;
  created_at?: string | null;
  updated_at?: string | null;
}

function normalizeLlmConfig(config: Record<string, unknown>): Record<string, unknown> {
  const model = String(config.model ?? '');
  const providerId =
    (config.providerId as string | undefined) ??
    (model ? lookupProviderByModel(model) : 'unmapped-unknown');
  const schedulerTag =
    (config.schedulerTag as string | undefined) ??
    (config.personality as string | undefined);
  const { personality: _p, ...rest } = config;
  return {
    ...rest,
    providerId,
    model,
    ...(schedulerTag ? { schedulerTag } : {}),
  };
}

function normalizeAgentConfig(config: Record<string, unknown>): Record<string, unknown> {
  if (config.providerId && config.model) {
    const { llm: _l, ...rest } = config;
    return rest;
  }
  const llm = config.llm as { baseURL?: string; apiKey?: string; model?: string } | undefined;
  if (llm) {
    const model = llm.model ?? 'deepseek-chat';
    const apiKey = llm.apiKey ?? '';
    const providerId = looksLikeRealKey(apiKey)
      ? `unmapped-${config.id ?? 'agent'}`
      : lookupProviderByEnvName(apiKey);
    const { llm: _l, ...rest } = config;
    return { ...rest, providerId, model };
  }
  return {
    ...config,
    providerId: config.providerId ?? 'deepseek',
    model: config.model ?? 'deepseek-chat',
  };
}

function looksLikeRealKey(value: string): boolean {
  if (value.startsWith('API_KEY_')) return false;
  if (value.length <= 20) return false;
  return !/^[A-Z0-9_]+$/.test(value);
}

// Convert from Rust type to TS type
export function mapFromRust(r: RustAIMember): AIMember {
  let tags: string[] = [];
  if (r.tags) {
    try {
      tags = JSON.parse(r.tags);
    } catch (e) {
      console.error('Failed to parse tags JSON', e);
    }
  }

  let parsedConfig: Record<string, unknown> = {};
  if (r.config) {
    try {
      parsedConfig = JSON.parse(r.config);
    } catch (e) {
      console.error('Failed to parse config JSON', e);
    }
  }

  if (r.kind === 'llm') {
    parsedConfig = normalizeLlmConfig(parsedConfig);
  } else if (r.kind === 'agent') {
    parsedConfig = normalizeAgentConfig({ ...parsedConfig, id: r.id });
  }

  return {
    id: r.id,
    kind: r.kind as AIMemberKind,
    name: r.name,
    avatar: r.avatar || undefined,
    description: r.description || undefined,
    tags,
    source: r.source as 'builtin' | 'user',
    enabled: r.enabled === 1,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : undefined,
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : undefined,
    ...parsedConfig,
  } as AIMember;
}

// Convert from TS type to Rust type
export function mapToRust(m: AIMember): RustAIMember {
  const tagsStr = JSON.stringify(m.tags || []);

  let configObj: Record<string, unknown> = {};
  if (m.kind === 'llm') {
    configObj = {
      providerId: m.providerId,
      model: m.model,
      customPrompt: m.customPrompt,
      stages: m.stages,
    };
    if (m.schedulerTag) configObj.schedulerTag = m.schedulerTag;
  } else if (m.kind === 'agent') {
    configObj = {
      role: m.role,
      systemPrompt: m.systemPrompt,
      providerId: m.providerId,
      model: m.model,
      tools: m.tools,
      maxTurns: m.maxTurns,
      temperature: m.temperature,
    };
  } else if (m.kind === 'cli') {
    configObj = { cli: m.cli };
  }

  return {
    id: m.id,
    kind: m.kind,
    name: m.name,
    avatar: m.avatar || null,
    description: m.description || null,
    tags: tagsStr,
    source: m.source,
    config: JSON.stringify(configObj),
    enabled: m.enabled !== false ? 1 : 0,
  };
}

interface AIMemberStore {
  members: Record<string, AIMember>;
  loading: boolean;
  load: (kind?: AIMemberKind) => Promise<void>;
  upsert: (member: AIMember) => Promise<void>;
  clone: (id: string) => Promise<AIMember>;
  remove: (id: string) => Promise<void>;
  list: (kind?: AIMemberKind) => AIMember[];
  get: (id: string) => AIMember | undefined;
  findReferencingGroups: (id: string, allGroups: Group[]) => Group[];
}

async function seedMissingBuiltins(): Promise<void> {
  const all = await invoke<RustAIMember[]>('list_ai_members', { kind: null });
  if (all.length === 0) {
    await invoke('seed_builtin_ai_members', { members: builtinAIMembers.map(mapToRust) });
    return;
  }
  const existingIds = new Set(all.map((m) => m.id));
  const missing = builtinAIMembers.filter((b) => !existingIds.has(b.id));
  if (missing.length > 0) {
    await invoke('seed_builtin_ai_members', { members: missing.map(mapToRust) });
  }
}

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;

export const useAIMemberStore = create<AIMemberStore>((set, get) => ({
  members: {},
  loading: false,

  load: async (kind?: AIMemberKind) => {
    set({ loading: true });
    try {
      if (isTauri) {
        await seedMissingBuiltins();
        const rustMembers = await invoke<RustAIMember[]>('list_ai_members', { kind });
        const record: Record<string, AIMember> = {};

        rustMembers.forEach((r) => {
          record[r.id] = mapFromRust(r);
        });

        set({ members: { ...get().members, ...record } });
      } else {
        const localStr = localStorage.getItem('custom_ai_members') || '[]';
        const customMembers = JSON.parse(localStr) as AIMember[];
        const record: Record<string, AIMember> = {};

        builtinAIMembers.forEach((m) => {
          record[m.id] = m;
        });
        customMembers.forEach((m) => {
          record[m.id] = m;
        });

        set({ members: record });
      }
    } catch (e) {
      console.error('Failed to load AI members', e);
    } finally {
      set({ loading: false });
    }
  },

  upsert: async (member: AIMember) => {
    const existing = get().members[member.id];
    if (existing?.source === 'builtin') {
      throw new Error('无法修改内置成员，请使用「克隆并编辑」。');
    }
    if (!existing && member.source === 'builtin') {
      throw new Error('不能从界面创建 builtin 成员。');
    }

    const updated: AIMember = {
      ...member,
      source: 'user',
      tags: normalizeTags(member.tags || []),
      updatedAt: Date.now(),
      createdAt: member.createdAt || Date.now(),
    };

    if (isTauri) {
      const rustMember = mapToRust(updated);
      await invoke('upsert_ai_member', { member: rustMember });
    } else {
      const localStr = localStorage.getItem('custom_ai_members') || '[]';
      let customMembers = JSON.parse(localStr) as AIMember[];
      customMembers = customMembers.filter((m) => m.id !== member.id);
      customMembers.push(updated);
      localStorage.setItem('custom_ai_members', JSON.stringify(customMembers));
    }

    set((state) => ({
      members: {
        ...state.members,
        [updated.id]: updated,
      },
    }));
  },

  clone: async (id: string) => {
    const orig = get().members[id];
    if (!orig) {
      throw new Error('成员不存在');
    }
    const ts = Date.now();
    const cloned = JSON.parse(JSON.stringify(orig)) as AIMember;
    cloned.id = `${orig.id}-copy-${ts}`;
    cloned.source = 'user';
    cloned.name = `${orig.name} (副本)`;
    cloned.createdAt = ts;
    cloned.updatedAt = ts;
    await get().upsert(cloned);
    return cloned;
  },

  remove: async (id: string) => {
    if (isTauri) {
      await invoke('delete_ai_member', { id });
    } else {
      const localStr = localStorage.getItem('custom_ai_members') || '[]';
      let customMembers = JSON.parse(localStr) as AIMember[];
      customMembers = customMembers.filter((m) => m.id !== id);
      localStorage.setItem('custom_ai_members', JSON.stringify(customMembers));
    }

    set((state) => {
      const copy = { ...state.members };
      delete copy[id];
      return { members: copy };
    });
  },

  list: (kind?: AIMemberKind) => {
    const all = Object.values(get().members);
    if (!kind) return all;
    return all.filter((m) => m.kind === kind);
  },

  get: (id: string) => get().members[id],

  findReferencingGroups: (id: string, allGroups: Group[]) =>
    allGroups.filter((g) => g.memberIds?.includes(id)),
}));
