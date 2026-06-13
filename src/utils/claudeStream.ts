export interface ClaudeJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
  command?: ClaudeCommandEvent;
}

export type ClaudeCommandEvent =
  | {
      phase: 'started';
      command: string;
    }
  | {
      phase: 'completed';
      output?: string;
    };

export function renderClaudeCommandGroupStart(): string {
  return `\n<details open data-cli-command-group="claude"><summary>⚙️ 执行命令</summary>\n\n`;
}

export function renderClaudeCommandGroupEnd(): string {
  return `\n</details>\n\n`;
}

export function renderClaudeCommandStarted(command: string, index: number): string {
  const title = command.length > 120 ? `${command.slice(0, 117)}...` : command;
  return `<p><small>${index}. <code>${escapeHtml(title)}</code></small></p>\n\n${fence(command)}\n\n`;
}

export function renderClaudeCommandCompleted(output?: string): string {
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

function sessionIdFromEvent(event: any): string | undefined {
  const candidates = [
    event.session_id,
    event.sessionId,
    event.message?.session_id,
  ];

  return candidates.find((value) => typeof value === 'string' && value.length > 0);
}

function contentBlocks(event: any): any[] {
  const content = event?.message?.content;
  return Array.isArray(content) ? content : [];
}

function textFromToolResult(block: any): string | undefined {
  const content = block?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) => typeof item?.text === 'string' ? item.text : '')
      .filter(Boolean)
      .join('\n');
    return text || undefined;
  }
  if (content !== undefined && content !== null) return JSON.stringify(content, null, 2);
  return undefined;
}

export function parseClaudeJsonLine(line: string): ClaudeJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: ClaudeJsonParseResult = {};
  const sessionId = sessionIdFromEvent(event);
  if (sessionId) result.sessionId = sessionId;

  if (event.type === 'assistant') {
    const blocks = contentBlocks(event);
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    const bashUse = blocks.find((block) =>
      block?.type === 'tool_use' &&
      block.name === 'Bash' &&
      typeof block.input?.command === 'string'
    );

    if (text) result.content = text;
    if (bashUse) {
      result.command = {
        phase: 'started',
        command: bashUse.input.command,
      };
    }
  } else if (event.type === 'user') {
    const toolResult = contentBlocks(event).find((block) => block?.type === 'tool_result');
    if (toolResult) {
      result.command = {
        phase: 'completed',
        output: textFromToolResult(toolResult),
      };
    }
  } else if (event.type === 'error') {
    const message = event.message || event.error?.message || event.error;
    result.error = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Claude Code 执行出错';
  }

  return Object.keys(result).length > 0 ? result : null;
}
