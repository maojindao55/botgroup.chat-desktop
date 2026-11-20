/**
 * 读取 /api/chat 返回的 SSE 流（每行 `data: {"content": "..."}`）。零运行时依赖，便于测试。
 */

export interface StreamReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel?(): Promise<void> | void;
}

export class StreamTimeoutError extends Error {
  constructor() {
    super('stream timeout');
    this.name = 'StreamTimeoutError';
  }
}

/** 去掉模型偶尔自带的「名字：」前缀 */
export function stripSpeakerPrefix(text: string, names: string[]): string {
  let result = text;
  for (const name of names) {
    if (!name) continue;
    for (const sep of ['：', ':']) {
      const prefix = `${name}${sep}`;
      if (result.startsWith(prefix)) result = result.slice(prefix.length).trimStart();
    }
  }
  return result;
}

export async function readSseContent(
  reader: StreamReader,
  options: { onDelta?: (fullText: string) => void; idleTimeoutMs?: number; speakerNames?: string[] } = {},
): Promise<string> {
  const decoder = new TextDecoder();
  const idleTimeoutMs = options.idleTimeoutMs ?? 15000;
  let buffer = '';
  let full = '';

  const handleLine = (line: string) => {
    if (!line.startsWith('data: ')) return;
    const payload = line.slice(6).trim();
    if (!payload || payload === '[DONE]') return;
    try {
      const data = JSON.parse(payload);
      if (typeof data?.content === 'string' && data.content) {
        full = stripSpeakerPrefix(full + data.content, options.speakerNames || []);
        options.onDelta?.(full);
      }
    } catch {
      // 跳过不完整或非 JSON 行
    }
  };

  while (true) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const chunk = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StreamTimeoutError()), idleTimeoutMs);
      }),
    ]).catch(async (error) => {
      if (error instanceof StreamTimeoutError) {
        await reader.cancel?.();
        if (full.trim()) return { done: true } as { done: boolean; value?: Uint8Array };
      }
      throw error;
    }).finally(() => clearTimeout(timer));

    if (chunk.value) buffer += decoder.decode(chunk.value, { stream: !chunk.done });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
    }
    if (chunk.done) break;
  }
  if (buffer) handleLine(buffer);
  return full;
}
