export interface QoderJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

function textFromContentBlocks(content: unknown): string | undefined {
  if (typeof content === 'string' && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;

  const text = content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (block && typeof block === 'object') {
        const anyBlock = block as any;
        if (typeof anyBlock.text === 'string') return anyBlock.text;
        if (typeof anyBlock.content === 'string') return anyBlock.content;
      }
      return '';
    })
    .join('');

  return text.trim() ? text : undefined;
}

function contentFromEvent(event: any): string | undefined {
  return firstString(
    textFromContentBlocks(event.message?.content),
    event.message?.text,
    textFromContentBlocks(event.content),
    event.text,
    event.delta?.text,
    event.result,
    event.response,
    event.output,
  );
}

function errorFromEvent(event: any): string | undefined {
  const message = firstString(
    Array.isArray(event.errors) ? event.errors.find((value: unknown) => typeof value === 'string') : undefined,
    event.error?.message,
    event.error?.data?.message,
    event.message,
    event.result,
    event.error,
  );
  return message?.trim() || undefined;
}

export function parseQoderJsonLine(line: string): QoderJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: QoderJsonParseResult = {};
  const sessionId = firstString(
    event.session_id,
    event.sessionId,
    event.sessionID,
    event.data?.session_id,
    event.data?.sessionId,
    event.info?.id,
  );
  if (sessionId) result.sessionId = sessionId;

  if (event.type === 'error' || event.is_error === true) {
    result.error = errorFromEvent(event) || 'Qoder CLI 执行出错';
  } else {
    const content = contentFromEvent(event);
    if (content) result.content = content;
  }

  return Object.keys(result).length > 0 ? result : null;
}
