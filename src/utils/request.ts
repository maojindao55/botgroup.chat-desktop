import { invoke } from '@tauri-apps/api/core';
import { llmChatReadableStream, llmChatComplete } from '@/utils/llmClient';
import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';
import { collectLegacyApiKeys, clearLegacyApiKeys } from '@/utils/legacyApiKeys';
import { defaultGroups as staticGroups } from '@/config/groups';
import { prepareChatGroups } from '@/config/groupStorage';
import { generateAICharacters, modelConfigs } from '@/config/aiCharacters';
import { builtinAIMembers, type AIMember } from '@/config/aiMembers';
import { builtinProviders, mapProviderToRust } from '@/config/providers';
import { normalizeDesktopUser } from '@/utils/userAvatar';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
if (isTauri) {
  localStorage.setItem('token', 'local_desktop_token_placeholder');
}
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Client-side implementation of AI response scheduling
async function clientScheduleAI(message: string, history: any[], availableAIs: any[]): Promise<string[]> {
  const allTags = new Set<string>();
  availableAIs.forEach(ai => {
    ai.tags?.forEach((tag: string) => allTags.add(tag));
  });

  const matchedTags: string[] = [];

  // Use the scheduler character configuration
  const schedulerAI = generateAICharacters(message, Array.from(allTags).join(','))[0];

  try {
    const creds = await resolveLlmCredentials(schedulerAI.model);
    const prompt = schedulerAI.custom_prompt;
    const text = await llmChatComplete({
      ...creds,
      messages: [
        { role: 'system', content: prompt },
        ...history.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
        { role: 'user', content: message },
      ],
    });
    text.split(',').forEach((tag: string) => {
      const trimmed = tag.trim();
      if (trimmed) matchedTags.push(trimmed);
    });
  } catch (e) {
    console.error('Failed client-side AI analysis for scheduling:', e);
  }

  // If matched "文字游戏", all AIs respond
  if (matchedTags.includes("文字游戏")) {
    return availableAIs.map(ai => ai.id);
  }

  // Calculate scores
  const aiScores = new Map<string, number>();
  const messageLC = message.toLowerCase();

  for (const ai of availableAIs) {
    if (!ai.tags) continue;
    let score = 0;
    matchedTags.forEach(tag => {
      if (ai.tags?.includes(tag)) {
        score += 2;
      }
    });

    if (messageLC.includes(ai.name.toLowerCase())) {
      score += 5;
    }

    const recentHistory = history.slice(-5);
    recentHistory.forEach(hist => {
      if (hist.name === ai.name && hist.content.length > 0) {
        score += 1;
      }
    });

    if (score > 0) {
      aiScores.set(ai.id, score);
    }
  }

  const sortedAIs = Array.from(aiScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  if (sortedAIs.length === 0) {
    const maxResponders = Math.min(2, availableAIs.length);
    const numResponders = Math.floor(Math.random() * maxResponders) + 1;
    const shuffledAIs = [...availableAIs]
      .sort(() => Math.random() - 0.5)
      .slice(0, numResponders);
    return shuffledAIs.map(ai => ai.id);
  }

  return sortedAIs.slice(0, 3); // MAX_RESPONDERS = 3
}

function loadStoredCustomGroups(): any[] {
  try {
    const stored = localStorage.getItem('custom_groups');
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((g: any) => (
      g && g.type === 'ai' && g.members && !g.memberIds ? { ...g, memberIds: g.members } : g
    ));
  } catch (e) {
    console.error('Failed to parse custom groups:', e);
    return [];
  }
}

function toSeedRow(m: AIMember) {
  return {
    id: m.id,
    kind: m.kind,
    name: m.name,
    avatar: m.avatar || null,
    description: m.description || null,
    tags: JSON.stringify(m.tags || []),
    source: m.source,
    config: JSON.stringify({
      providerId: m.providerId,
      model: m.model,
      schedulerTag: m.schedulerTag,
      customPrompt: m.customPrompt,
      stages: m.stages,
    }),
    enabled: 1,
  };
}

function toCharacter(m: AIMember) {
  return {
    id: m.id,
    name: m.name,
    personality: m.schedulerTag || '',
    providerId: m.providerId,
    model: m.model,
    avatar: m.avatar || '',
    custom_prompt: m.customPrompt || '',
    tags: m.tags,
    stages: m.stages,
    runtime: 'llm'
  };
}

// Mock Response Helper
function mockResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function request(url: string, options: RequestInit = {}) {
  // If not running in Tauri, fallback to standard HTTP fetch
  if (!isTauri) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    } as any;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
    });
  }

  // Running inside Tauri - Intercept and map endpoints
  const cleanUrl = url.split('?')[0];

  try {
    // 1. Initial configuration endpoint
    if (cleanUrl === '/api/init') {
      let user: any = null;
      try {
        user = await invoke('get_current_user');
      } catch (e) {
        console.error('Failed to get current user from Tauri SQLite:', e);
      }

      // If no user exists, create a default "本地用户" immediately to avoid empty user profile
      if (!user) {
        try {
          user = await invoke('create_local_user', { nickname: '本地用户' });
          localStorage.setItem('token', 'local_desktop_token_placeholder');
        } catch (e) {
          console.error('Failed to create default local user:', e);
        }
      }

      const allGroups = prepareChatGroups(staticGroups, loadStoredCustomGroups());

      let characters: any[] = [];
      try {
        // PR4: one-shot migration (localStorage → vault, member config → providerId)
        try {
          const alreadyDone = await invoke<boolean>('migration_status');
          if (!alreadyDone) {
            const migrationResult = await invoke<{ migrated: boolean }>('migrate_a_complete', {
              input: { localStorageKeys: collectLegacyApiKeys() },
            });
            if (migrationResult.migrated) {
              clearLegacyApiKeys();
              console.info('[init] PR4 data migration completed');
            }
          }
        } catch (migrationErr) {
          console.error('[init] PR4 migration failed:', migrationErr);
        }

        let dbMembers: any[] = await invoke('list_ai_members', { kind: 'llm' });
        const existingIds = new Set(dbMembers.map((m: { id: string }) => m.id));
        const missing = builtinAIMembers.filter((b) => !existingIds.has(b.id));
        if (missing.length > 0) {
          await invoke('seed_builtin_ai_members', { members: missing.map(toSeedRow) });
          dbMembers = await invoke('list_ai_members', { kind: 'llm' });
        }

        const dbProviders: { id: string }[] = await invoke('list_providers');
        const existingProviderIds = new Set(dbProviders.map(p => p.id));
        const missingProviders = builtinProviders.filter(p => !existingProviderIds.has(p.id));
        if (missingProviders.length > 0) {
          await invoke('seed_builtin_providers', {
            providers: missingProviders.map(mapProviderToRust),
          });
        }

        characters = dbMembers.map((r: any) => {
          let tags: string[] = [];
          if (r.tags) {
            try { tags = JSON.parse(r.tags); } catch {}
          }
          let config: any = {};
          if (r.config) {
            try { config = JSON.parse(r.config); } catch {}
          }
          return {
            id: r.id,
            name: r.name,
            personality: config.schedulerTag || config.personality || '',
            providerId: config.providerId,
            model: config.model || modelConfigs[0].model,
            avatar: r.avatar || '',
            custom_prompt: config.customPrompt || '',
            tags,
            stages: config.stages,
            runtime: 'llm'
          };
        });
      } catch (e) {
        console.error('Failed to initialize AI members from Tauri SQLite:', e);
        characters = builtinAIMembers.map(toCharacter);
      }
      characters.unshift(generateAICharacters('#groupName#', '#allTags#')[0]);

      return mockResponse({
        code: 200,
        data: {
          groups: allGroups,
          characters,
          user: user || null
        }
      });
    }

    // 2. User info endpoint
    if (cleanUrl === '/api/user/info') {
      const user = await invoke('get_current_user');
      return mockResponse({
        code: 200,
        data: user ? normalizeDesktopUser(user as Record<string, unknown>) : null
      });
    }

    // 3. User update endpoint
    if (cleanUrl === '/api/user/update') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '用户不存在' }, 401);
      }
      const updatedUser = await invoke('update_user_info', {
        userId: user.id,
        nickname: body.nickname || user.nickname,
        avatarUrl: body.avatar_url || user.avatar_url || user.avatarUrl
      });
      return mockResponse({
        success: true,
        data: normalizeDesktopUser(updatedUser as Record<string, unknown>)
      });
    }

    // 3b. User avatar upload (legacy JSON path — prefer direct invoke from uploadUserAvatar)
    if (cleanUrl === '/api/user/avatar/upload') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '用户不存在' }, 401);
      }
      try {
        let bytes: Uint8Array;
        if (typeof body.data_base64 === 'string') {
          const binary = atob(body.data_base64);
          bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        } else if (body.data instanceof Uint8Array) {
          bytes = body.data;
        } else {
          return mockResponse({ success: false, message: '无效的上传数据' }, 400);
        }
        const updatedUser = await invoke('upload_user_avatar', {
          userId: user.id,
          data: bytes,
          mimeType: body.mime_type,
        });
        return mockResponse({
          success: true,
          data: normalizeDesktopUser(updatedUser as Record<string, unknown>),
        });
      } catch (error) {
        return mockResponse({
          success: false,
          message: error instanceof Error ? error.message : '上传头像失败',
        }, 400);
      }
    }

    // 4. Scheduler API for AI response selection
    if (cleanUrl === '/api/scheduler') {
      const body = JSON.parse(options.body as string);
      const selectedAIs = await clientScheduleAI(body.message, body.history, body.availableAIs);
      return mockResponse({ selectedAIs });
    }

    // 11. Chat API (Direct LLM streaming from client side)
    if (cleanUrl === '/api/chat') {
      const body = JSON.parse(options.body as string);
      const { message, custom_prompt, history, aiName, index, model = "qwen-plus", providerId } = body;

      const creds = await resolveLlmCredentials(model, providerId);

      // Build message payload
      const systemPrompt = `${custom_prompt}\n 注意重要：1、你在群里叫${aiName}认准自己的身份； 2、你的输出内容不要加${aiName}：这种多余前缀；3、如果用户提出玩游戏，比如成语接龙等，严格按照游戏规则，不要说一大堆，要简短精炼; 4、保持群聊风格字数严格控制在50字以内，越简短越好（新闻总结类除外）`;

      const baseMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map((h: { role: string; content: string }) => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.content
        })),
      ];

      const userMessage = { role: 'user', content: message };
      if (index === 0) {
        baseMessages.push(userMessage);
      } else {
        baseMessages.splice(baseMessages.length - index, 0, userMessage);
      }

      const readable = await llmChatReadableStream({
        ...creds,
        messages: baseMessages,
        emitDoneMarker: false,
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // Default error for unhandled API calls
    return mockResponse({ success: false, message: `Desktop Mock API: ${cleanUrl} not implemented` }, 404);
  } catch (error: any) {
    console.error('Request intercept error:', error);
    return mockResponse({ success: false, message: error.message || 'Tauri operation failed' }, 500);
  }
}
