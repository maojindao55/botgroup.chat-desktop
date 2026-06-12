export interface CursorJsonParseResult {
  sessionId?: string;
  content?: string;
  /** result 事件中的最终摘要（success） */
  resultContent?: string;
  generatedImagePaths?: string[];
  error?: string;
  command?: CursorCommandEvent;
  thinking?: {
    phase: 'delta' | 'completed';
    text?: string;
  };
}

export type CursorCommandEvent =
  | {
      phase: 'started';
      command: string;
    }
  | {
      phase: 'completed';
      exitCode: number;
      output?: string;
    }
  | {
      phase: 'tool_completed';
      label: string;
    };

export function renderCursorCommandGroupStart(): string {
  return `\n<details open data-cli-command-group="cursor"><summary>⚙️ 执行命令</summary>\n\n`;
}

export function renderCursorCommandGroupEnd(): string {
  return `\n</details>\n\n`;
}

export function renderCursorCommandStarted(command: string, index: number): string {
  const title = command.length > 120 ? `${command.slice(0, 117)}...` : command;
  return `<p><small>${index}. <code>${escapeHtml(title)}</code></small></p>\n\n${fence(command)}\n\n`;
}

export function renderCursorCommandCompleted(exitCode: number, output?: string): string {
  const status = exitCode === 0 ? '完成' : '失败';
  const parts = [`exit: ${exitCode} · ${status}`];
  const outputBlock = fence(output);
  if (outputBlock) parts.push(outputBlock);
  return `${parts.join('\n\n')}\n\n`;
}

export function renderCursorToolCompleted(label: string): string {
  return `✓ ${escapeHtml(label)}\n\n`;
}

export function renderCursorThinking(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  const escaped = escapeHtml(trimmed).replace(/\n/g, '\n> ');
  return `<details open><summary>💭 思考</summary>\n\n> ${escaped}\n\n</details>\n\n`;
}

/** 避免 assistant 与 result 重复展示同一段摘要 */
export function shouldEmitCursorSummary(next: string, previous: string): boolean {
  const a = next.trim();
  const b = previous.trim();
  if (!a) return false;
  if (!b) return true;
  if (a === b) return false;
  if (b.includes(a)) return false;
  if (a.includes(b) && a.length >= b.length) return false;
  return true;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fence(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).replace(/```/g, '\\`\\`\\`');
  return `\`\`\`\n${text}\n\`\`\``;
}

function sessionIdFromEvent(event: any): string | undefined {
  const candidates = [
    event.session_id,
    event.sessionId,
  ];

  return candidates.find((value) => typeof value === 'string' && value.length > 0);
}

function assistantTextFromEvent(event: any): string | undefined {
  const content = event.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    if (text.trim()) return text.trim();
  }
  if (typeof event.message?.text === 'string' && event.message.text.trim()) {
    return event.message.text.trim();
  }
  return undefined;
}

function shellCommandFromToolCall(event: any): string | undefined {
  const command = event?.tool_call?.shellToolCall?.args?.command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function shellResultFromToolCall(event: any): { exitCode: number; output?: string } | undefined {
  const result = event?.tool_call?.shellToolCall?.result;
  const success = result?.success;
  if (!success || typeof success !== 'object') return undefined;

  const exitCode = typeof success.exitCode === 'number' ? success.exitCode : 0;
  const output = typeof success.stdout === 'string' && success.stdout.trim()
    ? success.stdout
    : typeof success.interleavedOutput === 'string' && success.interleavedOutput.trim()
      ? success.interleavedOutput
      : undefined;

  return { exitCode, output };
}

function toolCallLabelFromEvent(event: any, phase: 'started' | 'completed'): string | undefined {
  const toolCall = event?.tool_call;
  if (!toolCall || typeof toolCall !== 'object') return undefined;

  if (toolCall.shellToolCall) return undefined;

  const editPath = toolCall.editToolCall?.args?.path;
  if (typeof editPath === 'string' && editPath.trim()) {
    return phase === 'started' ? `写入 ${editPath.trim()}` : `已写入 ${editPath.trim()}`;
  }

  const readPath = toolCall.readToolCall?.args?.path;
  if (typeof readPath === 'string' && readPath.trim()) {
    return phase === 'started' ? `读取 ${readPath.trim()}` : `已读取 ${readPath.trim()}`;
  }

  const grepPattern = toolCall.grepToolCall?.args?.pattern;
  if (typeof grepPattern === 'string' && grepPattern.trim()) {
    return phase === 'started' ? `搜索 ${grepPattern.trim()}` : `搜索完成 ${grepPattern.trim()}`;
  }

  if (toolCall.awaitToolCall) {
    return phase === 'started' ? '等待后台任务' : '后台任务已结束';
  }

  const genericKey = Object.keys(toolCall).find((key) => key.endsWith('ToolCall'));
  if (genericKey) {
    const label = genericKey.replace(/ToolCall$/, '');
    return phase === 'started' ? label : `${label} 完成`;
  }

  return undefined;
}

function nonShellToolCompleted(event: any): CursorCommandEvent | undefined {
  const label = toolCallLabelFromEvent(event, 'completed');
  if (!label) return undefined;
  const result = event?.tool_call?.[Object.keys(event.tool_call).find((k) => k.endsWith('ToolCall')) || ''];
  const failed = result?.error || result?.result?.error;
  if (failed) return undefined;
  return { phase: 'tool_completed', label };
}

const imagePathPattern = /(?:file:\/\/|(?<![A-Za-z])[A-Za-z]:[\\/]|\/|(?:\.{1,2}\/)?[A-Za-z0-9_.-]+\/)[^\s<>"'`|]*?\.(?:png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:[?#][^\s<>"'`|)]*)?/gi;
const maxImagePathScanLength = 8192;
const binaryLikeKeyPattern = /(?:base64|data|bytes|buffer|blob|b64)/i;
const pathLikeKeyPattern = /(?:path|paths|file|files|filename|url|uri|href|image|images)/i;
const textLikeKeyPattern = /(?:output|stdout|stderr|message|text|content|result|summary)/i;

function stripPathPunctuation(path: string): string {
  return path.replace(/[),.;:!?，。；：！？]+$/g, '');
}

function shouldScanImagePathString(value: string, key: string): boolean {
  if (!value.trim()) return false;
  if (binaryLikeKeyPattern.test(key)) return false;
  if (/^data:image\//i.test(value.trim())) return false;
  if (pathLikeKeyPattern.test(key)) return value.length <= maxImagePathScanLength;
  if (textLikeKeyPattern.test(key)) return value.length <= maxImagePathScanLength;
  if (value.length > 512) return false;
  imagePathPattern.lastIndex = 0;
  const matched = imagePathPattern.test(value);
  imagePathPattern.lastIndex = 0;
  return matched;
}

function collectImagePathCandidateStrings(value: unknown, output: string[], key = '', depth = 0): void {
  if (depth > 8 || value === undefined || value === null) return;
  if (typeof value === 'string') {
    if (shouldScanImagePathString(value, key)) output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectImagePathCandidateStrings(item, output, key, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value as Record<string, unknown>).forEach(([childKey, item]) => {
      collectImagePathCandidateStrings(item, output, childKey, depth + 1);
    });
  }
}

function extractImagePathsFromText(text: string): string[] {
  const paths: string[] = [];
  for (const match of text.matchAll(imagePathPattern)) {
    const path = stripPathPunctuation(match[0]);
    if (path) paths.push(path);
  }
  return paths;
}

function isGenerateImageToolKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return normalized.includes('generateimage') || (normalized.includes('generate') && normalized.includes('image'));
}

function extractGeneratedImagePaths(event: any): string[] {
  const toolCall = event?.tool_call;
  if (!toolCall || typeof toolCall !== 'object') return [];

  const imageToolKey = Object.keys(toolCall).find((key) => key.endsWith('ToolCall') && isGenerateImageToolKey(key));
  if (!imageToolKey) return [];

  const imageToolCall = toolCall[imageToolKey];
  if (!imageToolCall || typeof imageToolCall !== 'object') return [];

  const resultPayload = imageToolCall.result ?? imageToolCall.output ?? imageToolCall.content;
  if (resultPayload === undefined || resultPayload === null) return [];

  const strings: string[] = [];
  collectImagePathCandidateStrings(resultPayload, strings);

  const paths = strings.flatMap(extractImagePathsFromText);
  return Array.from(new Set(paths));
}

export function parseCursorJsonLine(line: string): CursorJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: CursorJsonParseResult = {};
  const sessionId = sessionIdFromEvent(event);
  if (sessionId) result.sessionId = sessionId;

  if (event.type === 'assistant') {
    const text = assistantTextFromEvent(event);
    if (text) result.content = text;
  } else if (event.type === 'thinking') {
    if (event.subtype === 'delta' && typeof event.text === 'string' && event.text) {
      result.thinking = { phase: 'delta', text: event.text };
    } else if (event.subtype === 'completed') {
      result.thinking = { phase: 'completed' };
    }
  } else if (event.type === 'tool_call' && event.subtype === 'started') {
    const command = shellCommandFromToolCall(event);
    if (command) {
      result.command = { phase: 'started', command };
    } else {
      const label = toolCallLabelFromEvent(event, 'started');
      if (label) result.command = { phase: 'started', command: label };
    }
  } else if (event.type === 'tool_call' && event.subtype === 'completed') {
    const shellResult = shellResultFromToolCall(event);
    if (shellResult) {
      result.command = {
        phase: 'completed',
        exitCode: shellResult.exitCode,
        output: shellResult.output,
      };
    } else {
      const toolCompleted = nonShellToolCompleted(event);
      if (toolCompleted) result.command = toolCompleted;
      const generatedImagePaths = extractGeneratedImagePaths(event);
      if (generatedImagePaths.length) result.generatedImagePaths = generatedImagePaths;
    }
  } else if (event.type === 'result') {
    if (event.is_error) {
      const message = event.result || event.error?.message || event.error;
      result.error = typeof message === 'string' && message.trim()
        ? message.trim()
        : 'Cursor Agent 执行出错';
    } else if (typeof event.result === 'string' && event.result.trim()) {
      result.resultContent = event.result.trim();
    }
  } else if (event.type === 'error') {
    const message = event.message || event.error?.message || event.error;
    result.error = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Cursor Agent 执行出错';
  }

  return Object.keys(result).length > 0 ? result : null;
}
