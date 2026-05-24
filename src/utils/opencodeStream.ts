export interface OpenCodeJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
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
    const title = event.part?.state?.title;
    if (typeof title === 'string' && title.trim()) {
      result.content = `→ ${title.trim()}\n`;
    }
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
