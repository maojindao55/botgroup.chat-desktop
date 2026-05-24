export interface CodexJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
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
    const summary = command.length > 120 ? `${command.slice(0, 117)}...` : command;
    result.content = details(`▶ ${summary}`, fence(command), true);
  } else if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
    const exitCode = event.item.exit_code ?? 0;
    const status = exitCode === 0 ? '✓ 命令完成' : `✗ 命令失败`;
    const body = [`exit: ${exitCode}`, fence(event.item.output)].filter(Boolean).join('\n\n');
    result.content = details(status, body);
  } else if (event.type === 'error') {
    const message = event.message || event.error?.message || event.error;
    result.error = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Codex 执行出错';
  }

  return Object.keys(result).length > 0 ? result : null;
}
