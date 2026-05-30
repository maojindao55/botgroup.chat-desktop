/**
 * 记住用户上次所在的视图（首页 / 群聊 / 开发任务），用于冷启动时恢复。
 * 仅存储 URL search 串（形如 `?view=home`、`?id=2`、`?view=cli-task&taskId=...`）。
 */

const LAST_VIEW_KEY = 'last_view';

/** 读取上次视图的 search 串；非法或缺失时返回 null */
export function readLastView(): string | null {
  try {
    const value = localStorage.getItem(LAST_VIEW_KEY);
    return value && value.startsWith('?') ? value : null;
  } catch {
    return null;
  }
}

/** 保存当前视图的 search 串；空串或非 `?` 开头的不保存（避免裸路径导致恢复死循环） */
export function saveLastView(search: string) {
  try {
    if (!search || !search.startsWith('?')) return;
    localStorage.setItem(LAST_VIEW_KEY, search);
  } catch {
    // 忽略存储异常（隐私模式等）
  }
}

/** 清除已记录的视图（如上次视图指向的群已被删除时调用） */
export function clearLastView() {
  try {
    localStorage.removeItem(LAST_VIEW_KEY);
  } catch {
    // ignore
  }
}
