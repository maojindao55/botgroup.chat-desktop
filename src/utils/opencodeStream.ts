export interface OpenCodeJsonParseResult {
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

function toolUseContent(part: any): string | undefined {
  const title = typeof part?.state?.title === 'string' && part.state.title.trim()
    ? part.state.title.trim()
    : typeof part?.tool === 'string' && part.tool.trim()
      ? part.tool.trim()
      : 'Tool use';
  const sections = [
    part?.state?.input === undefined ? '' : `**Input**\n\n${fence(part.state.input, 'json')}`,
    part?.state?.output === undefined ? '' : `**Output**\n\n${fence(part.state.output)}`,
  ].filter(Boolean);

  return details(`→ ${title}`, sections.join('\n\n') || '_No details_', true);
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
  if (typeof event.sessionID === 'string' && event.sessionID) {
    result.sessionId = event.sessionID;
  }

  if (event.type === 'text' && typeof event.part?.text === 'string') {
    result.content = event.part.text;
  } else if (event.type === 'tool_use') {
    const content = toolUseContent(event.part);
    if (content) result.content = content;
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
