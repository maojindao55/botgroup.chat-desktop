export interface PromptContext {
  groupName?: string;
  aiName?: string;
  userName?: string;
  date?: string;
  time?: string;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('zh-CN');
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

/**
 * 替换 prompt 中的 {{var}} 占位符；兼容旧语法 #groupName# / #%#groupName#%# 等。
 */
export function applyPromptTemplate(text: string | undefined, ctx: PromptContext): string {
  if (!text) return '';

  const now = new Date();
  const vars: Record<string, string> = {
    groupName: ctx.groupName ?? '',
    aiName: ctx.aiName ?? '',
    userName: ctx.userName ?? '',
    date: ctx.date ?? formatDate(now),
    time: ctx.time ?? formatTime(now),
  };

  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
    out = out.replaceAll(`#${key}#`, value);
    out = out.replaceAll(`#%#${key}#%#`, value);
  }
  return out;
}
