export interface CodexJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
  command?: CodexCommandEvent;
}

export type CodexCommandEvent =
  | {
      phase: 'started';
      command: string;
    }
  | {
      phase: 'completed';
      exitCode: number;
      output?: string;
    };

export function renderCodexCommandGroupStart(): string {
  return `\n<details open><summary>⚙️ 执行命令</summary>\n\n`;
}

export function renderCodexCommandGroupEnd(): string {
  return `\n</details>\n\n`;
}

export function renderCodexCommandStarted(command: string, index: number): string {
  const title = command.length > 120 ? `${command.slice(0, 117)}...` : command;
  return `#### ${index}. ${escapeHtml(title)}\n\n${fence(command)}\n\n`;
}

export function renderCodexCommandCompleted(exitCode: number, output?: string): string {
  const status = exitCode === 0 ? '完成' : '失败';
  const parts = [`exit: ${exitCode} · ${status}`];
  const outputBlock = fence(output);
  if (outputBlock) parts.push(outputBlock);
  return `${parts.join('\n\n')}\n\n`;
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

function details(summary: string, body: string, open = false): string {
  const openAttr = open ? ' open' : '';
  return `<details${openAttr}><summary>${escapeHtml(summary)}</summary>\n\n${body}\n\n</details>\n\n`;
}

function sessionIdFromEvent(event: any): string | undefined {
  const candidates = [
    event.sessionId,
    event.session_id,
    event.thread_id,
    event.thread?.id,
    event.conversation_id,
    event.conversationId,
  ];

  return candidates.find((value) => typeof value === 'string' && value.length > 0);
}

export function parseCodexJsonLine(line: string): CodexJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: CodexJsonParseResult = {};
  const sessionId = sessionIdFromEvent(event);
  if (sessionId) result.sessionId = sessionId;

  if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
    result.content = `${event.item.text}\n`;
  } else if (event.type === 'item.completed' && event.item?.type === 'reasoning' && typeof event.item.text === 'string') {
    const text = escapeHtml(event.item.text.trim()).replace(/\n/g, '\n> ');
    if (text) result.content = details('💭 思考', `> ${text}`, true);
  } else if (event.type === 'item.started' && event.item?.type === 'command_execution') {
    const command = typeof event.item.command === 'string' && event.item.command.trim()
      ? event.item.command.trim()
      : '(unknown command)';
    result.command = {
      phase: 'started',
      command,
    };
  } else if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
    const exitCode = event.item.exit_code ?? 0;
    result.command = {
      phase: 'completed',
      exitCode,
      output: typeof event.item.output === 'string' ? event.item.output : undefined,
    };
  } else if (event.type === 'error') {
    const message = event.message || event.error?.message || event.error;
    result.error = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Codex 执行出错';
  }

  return Object.keys(result).length > 0 ? result : null;
}
