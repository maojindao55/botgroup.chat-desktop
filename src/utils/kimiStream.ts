export interface KimiToolCallInfo {
  id: string;
  name: string;
  arguments: string;
}

export interface KimiToolResultInfo {
  toolCallId: string;
  content: string;
}

export interface KimiJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
  toolCalls?: KimiToolCallInfo[];
  toolResult?: KimiToolResultInfo;
}

export function renderKimiCommandGroupStart(): string {
  return `\n<details open data-cli-command-group="kimi"><summary>⚙️ 执行命令</summary>\n\n`;
}

export function renderKimiCommandGroupEnd(): string {
  return `\n</details>\n\n`;
}

export function renderKimiCommandStarted(command: string, index: number): string {
  const title = command.length > 120 ? `${command.slice(0, 117)}...` : command;
  return `<p><small>${index}. <code>${escapeHtml(title)}</code></small></p>\n\n${fence(command)}\n\n`;
}

export function renderKimiCommandCompleted(output?: string): string {
  const outputBlock = fence(output);
  return outputBlock ? `${outputBlock}\n\n` : '';
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

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function safeParseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function labelForToolCall(name: string, rawArgs: string): string {
  const args = safeParseJson(rawArgs);
  if (!args) return name;

  switch (name) {
    case 'Bash':
    case 'bash': {
      const cmd = typeof args.command === 'string' ? args.command : undefined;
      return cmd || name;
    }
    case 'Read':
    case 'read': {
      const path = typeof args.path === 'string' ? args.path : undefined;
      return path ? `读取 ${path}` : name;
    }
    case 'Write':
    case 'write':
    case 'Edit':
    case 'edit':
    case 'Create':
    case 'create':
    case 'Replace':
    case 'replace':
    case 'Patch':
    case 'patch': {
      const path = typeof args.path === 'string' ? args.path
        : typeof args.file_path === 'string' ? args.file_path : undefined;
      return path ? `写入 ${path}` : name;
    }
    case 'Glob':
    case 'glob': {
      const pattern = typeof args.pattern === 'string' ? args.pattern : undefined;
      return pattern ? `搜索 ${pattern}` : name;
    }
    case 'Grep':
    case 'grep': {
      const pattern = typeof args.pattern === 'string' ? args.pattern
        : typeof args.query === 'string' ? args.query : undefined;
      return pattern ? `搜索 ${pattern}` : name;
    }
    default:
      return name;
  }
}

export function formatToolCallLabel(toolCall: KimiToolCallInfo): string {
  return labelForToolCall(toolCall.name, toolCall.arguments);
}

export function parseKimiJsonLine(line: string): KimiJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: KimiJsonParseResult = {};

  const sessionId = firstString(event.session_id, event.sessionId, event.sessionID);
  if (sessionId) result.sessionId = sessionId;

  if (event.type === 'error' || event.is_error === true || event.role === 'error') {
    const message = firstString(event.error?.message, event.error, event.message, event.detail);
    result.error = message?.trim() || 'Kimi Code 执行出错';
    return result;
  }

  if (event.role === 'meta' || event.role === 'system') {
    return Object.keys(result).length > 0 ? result : null;
  }

  if (event.role === 'tool') {
    const toolCallId = typeof event.tool_call_id === 'string' ? event.tool_call_id : '';
    const content = typeof event.content === 'string' ? event.content : '';
    if (toolCallId) {
      result.toolResult = { toolCallId, content };
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  if (event.role === 'assistant') {
    if (typeof event.content === 'string' && event.content.trim()) {
      result.content = event.content;
    }

    if (Array.isArray(event.tool_calls) && event.tool_calls.length > 0) {
      const toolCalls: KimiToolCallInfo[] = [];
      for (const tc of event.tool_calls) {
        const id = typeof tc?.id === 'string' ? tc.id : '';
        const fnName = typeof tc?.function?.name === 'string' ? tc.function.name : '';
        const fnArgs = typeof tc?.function?.arguments === 'string' ? tc.function.arguments : '';
        if (id && fnName) {
          toolCalls.push({ id, name: fnName, arguments: fnArgs });
        }
      }
      if (toolCalls.length > 0) result.toolCalls = toolCalls;
    }

    return Object.keys(result).length > 0 ? result : null;
  }

  const content = typeof event.content === 'string'
    ? event.content
    : firstString(event.text, event.result, event.output);
  if (content && content.trim()) {
    result.content = content;
  }

  return Object.keys(result).length > 0 ? result : null;
}
