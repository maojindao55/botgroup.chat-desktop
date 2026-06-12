import type { AgentGroup, Group } from './groups';
import { defaultGroups } from './groups';
import { createDefaultAgentWorkflowDefaults } from './agentWorkflow';
import {
  applyCLITemplateOverrides,
  filterDeletedCLITemplates,
} from './cliTemplateStorage';

export const DELETED_CHAT_GROUPS_KEY = 'deleted_chat_groups';
export const CUSTOM_GROUPS_KEY = 'custom_groups';

export function isBuiltinGroupId(groupId: string): boolean {
  return defaultGroups.some((g) => g.id === groupId);
}

export function loadDeletedChatGroupIds(): string[] {
  try {
    const stored = localStorage.getItem(DELETED_CHAT_GROUPS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function markChatGroupDeleted(groupId: string) {
  const ids = loadDeletedChatGroupIds();
  if (ids.includes(groupId)) return;
  localStorage.setItem(DELETED_CHAT_GROUPS_KEY, JSON.stringify([...ids, groupId]));
}

export function normalizeStoredGroup(group: Group): Group {
  if (group.type !== 'agent') return group;
  const legacy = group as Group & {
    agents?: Array<{ id?: string } | string>;
  };
  const inlineIds = Array.isArray(legacy.agents)
    ? legacy.agents
        .map(a => (typeof a === 'string' ? a : a?.id))
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  const existing = Array.isArray(group.memberIds) ? group.memberIds : [];
  const mergedIds = Array.from(new Set([...existing, ...inlineIds]));
  const next: AgentGroup & { agents?: unknown } = {
    ...(group as AgentGroup),
    memberIds: mergedIds,
    workflowDefaults: {
      ...createDefaultAgentWorkflowDefaults(),
      ...((group as AgentGroup).workflowDefaults || {}),
    },
  };
  // Keep legacy inline agents available until the ai_members migration has run.
  // AgentChatUI uses this as a compatibility fallback when memberIds cannot
  // resolve to store members yet.
  return next as Group;
}

export function loadCustomGroups(): Group[] {
  try {
    const stored = localStorage.getItem(CUSTOM_GROUPS_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeStoredGroup) : [];
  } catch {
    return [];
  }
}

export function saveCustomGroups(groups: Group[]) {
  localStorage.setItem(CUSTOM_GROUPS_KEY, JSON.stringify(groups));
}

export function upsertCustomGroup(group: Group) {
  const customGroups = loadCustomGroups();
  const index = customGroups.findIndex((g) => g.id === group.id);
  if (index >= 0) {
    customGroups[index] = group;
  } else {
    customGroups.push(group);
  }
  saveCustomGroups(customGroups);
}

export function removeCustomGroup(groupId: string) {
  saveCustomGroups(loadCustomGroups().filter((g) => g.id !== groupId));
}

export function removeChatGroupLocalData(groupId: string) {
  localStorage.removeItem(`workspace:${groupId}`);
  localStorage.removeItem(`cliStrategy:${groupId}`);
  localStorage.removeItem(`cliExecutionPlan:${groupId}`);
}

export function deleteChatGroup(groupId: string) {
  markChatGroupDeleted(groupId);
  removeCustomGroup(groupId);
  removeChatGroupLocalData(groupId);
}

export function filterDeletedChatGroups(groups: Group[]): Group[] {
  const deleted = new Set(loadDeletedChatGroupIds());
  return groups.filter((g) => !deleted.has(g.id));
}

/** 静态预设与用户群合并：同 id 时以 custom 覆盖 static */
export function mergeStaticAndCustomGroups(staticGroups: Group[], customGroups: Group[]): Group[] {
  const staticIds = new Set(staticGroups.map((g) => g.id));
  const overrideMap = new Map(customGroups.map((g) => [g.id, g]));

  const merged: Group[] = staticGroups.map((g) => {
    const override = overrideMap.get(g.id);
    if (!override) return normalizeStoredGroup(g);
    return normalizeStoredGroup({ ...g, ...override, type: g.type } as Group);
  });

  customGroups.forEach((g) => {
    if (!staticIds.has(g.id)) {
      merged.push(normalizeStoredGroup(g));
    }
  });

  return merged;
}

export function prepareChatGroups(staticGroups: Group[], customGroups: Group[]): Group[] {
  let groups = mergeStaticAndCustomGroups(staticGroups, customGroups);
  groups = applyCLITemplateOverrides(groups);
  groups = filterDeletedCLITemplates(groups);
  groups = filterDeletedChatGroups(groups);
  return groups;
}
