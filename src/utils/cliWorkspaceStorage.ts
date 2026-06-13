export const CLI_LAST_WORKSPACE_KEY = 'cli_last_workspace';

export function readLastCliWorkspace(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(CLI_LAST_WORKSPACE_KEY)?.trim() || '';
}

export function writeLastCliWorkspace(path: string): void {
  if (typeof localStorage === 'undefined') return;
  const trimmed = path.trim();
  if (trimmed) {
    localStorage.setItem(CLI_LAST_WORKSPACE_KEY, trimmed);
  } else {
    localStorage.removeItem(CLI_LAST_WORKSPACE_KEY);
  }
}

export function parentDirectoryPath(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  if (!normalized) return '';
  const idx = normalized.lastIndexOf('/');
  if (idx <= 0) return '';
  return normalized.slice(0, idx);
}

export function defaultNewWorkspaceFolderName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `dev-task-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** 新建任务时的 Workspace：优先上次使用，其次模板遗留字段（兼容旧数据） */
export function resolveDraftCliWorkspace(templateWorkspace?: string): string {
  const last = readLastCliWorkspace();
  if (last) return last;
  return templateWorkspace?.trim() || '';
}
