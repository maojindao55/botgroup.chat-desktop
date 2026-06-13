export interface OpenCodeJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
  command?: OpenCodeCommandEvent;
}

export interface OpenCodeCommandEvent {
  title: string;
  input?: unknown;
  output?: unknown;
}

export function renderOpenCodeCommandGroupStart(): string {
  return `\n<details open data-cli-command-group="opencode"><summary>⚙️ 执行命令</summary>\n\n`;
}

export function renderOpenCodeCommandGroupEnd(): string {
  return `\n</details>\n\n`;
}

export function renderOpenCodeCommand(command: OpenCodeCommandEvent, index: number): string {
  const title = command.title.length > 120 ? `${command.title.slice(0, 117)}...` : command.title;
  const sections = [
    command.input === undefined ? '' : `**Input**\n\n${fence(command.input, 'json')}`,
    command.output === undefined ? '' : `**Output**\n\n${fence(command.output)}`,
  ].filter(Boolean);
  const body = sections.length ? `${sections.join('\n\n')}\n\n` : '';
  return `<p><small>${index}. <code>${escapeHtml(title)}</code></small></p>\n\n${body}`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fence(value: unknown, language = ''): string {
  if (value === undefined || value === null || value === '') return '';

  const text = typeof value === 'string'
    ? value
    : JSON.stringify(value, null, 2);
  if (!text) return '';

  return `\`\`\`${language}\n${text.replace(/```/g, '\\`\\`\\`')}\n\`\`\``;
}

function details(summary: string, body: string, open = false): string {
  const openAttr = open ? ' open' : '';
  return `<details${openAttr}><summary>${escapeHtml(summary)}</summary>\n\n${body}\n\n</details>\n\n`;
}

function toolUseCommand(part: any): OpenCodeCommandEvent | undefined {
  const title = typeof part?.state?.title === 'string' && part.state.title.trim()
    ? part.state.title.trim()
    : typeof part?.tool === 'string' && part.tool.trim()
      ? part.tool.trim()
      : 'Tool use';

  return {
    title,
    input: part?.state?.input,
    output: part?.state?.output,
  };
}

function reasoningContent(part: any): string | undefined {
  const text = typeof part?.text === 'string' ? part.text.trim() : '';
  if (!text) return undefined;
  return details('💭 思考', `> ${escapeHtml(text).replace(/\n/g, '\n> ')}`, true);
}

function stepFinishContent(part: any): string | undefined {
  const reason = typeof part?.reason === 'string' ? part.reason : '';
  if (!reason || reason === 'stop') return undefined;

  const usage = [];
  if (typeof part.cost === 'number') usage.push(`cost: $${part.cost}`);
  if (part.tokens) {
    const tokens = [
      typeof part.tokens.input === 'number' ? `input ${part.tokens.input}` : '',
      typeof part.tokens.output === 'number' ? `output ${part.tokens.output}` : '',
      typeof part.tokens.reasoning === 'number' ? `reasoning ${part.tokens.reasoning}` : '',
    ].filter(Boolean).join(', ');
    if (tokens) usage.push(`tokens: ${tokens}`);
  }

  return details(`✓ Step: ${reason}`, usage.length ? usage.join('\n\n') : '_No usage data_');
}

export function parseOpenCodeJsonLine(line: string): OpenCodeJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: OpenCodeJsonParseResult = {};
  const sessionId = [
    event.sessionID,
    event.sessionId,
    event.part?.sessionID,
    event.part?.sessionId,
    event.info?.id,
  ].find((value) => typeof value === 'string' && value.length > 0);
  if (sessionId) {
    result.sessionId = sessionId;
  }

  if (event.type === 'text' && typeof event.part?.text === 'string') {
    result.content = event.part.text;
  } else if (event.type === 'tool_use') {
    const command = toolUseCommand(event.part);
    if (command) result.command = command;
  } else if (event.type === 'reasoning') {
    const content = reasoningContent(event.part);
    if (content) result.content = content;
  } else if (event.type === 'step_finish') {
    const content = stepFinishContent(event.part);
    if (content) result.content = content;
  } else if (event.type === 'error') {
    const message = event.error?.data?.message || event.error?.message || event.message;
    if (typeof message === 'string' && message.trim()) {
      result.error = message.trim();
    } else {
      result.error = 'OpenCode 执行出错';
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}
