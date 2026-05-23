import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface LlmMessage {
  role: string;
  content: string;
  name?: string;
}

export interface LlmStreamParams {
  sessionId?: string;
  baseURL: string;
  apiKey: string;
  model: string;
  messages: LlmMessage[];
  temperature?: number;
  tools?: unknown[];
  /** When true, append `data: [DONE]` after stream ends (agent path) */
  emitDoneMarker?: boolean;
}

export function formatSseContentLine(content: string): string {
  return `data: ${JSON.stringify({ content })}\n\n`;
}

export function formatSseDoneLine(): string {
  return 'data: [DONE]\n\n';
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Start Rust-side LLM streaming and expose it as a fetch-compatible ReadableStream
 * of SSE lines (`data: {"content":"..."}`).
 */
export async function llmChatReadableStream(params: LlmStreamParams): Promise<ReadableStream<Uint8Array>> {
  const sessionId = params.sessionId ?? newSessionId();
  const eventName = `llm://${sessionId}`;
  let unlisten: UnlistenFn | null = null;
  let closed = false;

  return new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const enqueue = (text: string) => {
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          /* already closed */
        }
      };
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* */ }
        if (unlisten) { unlisten(); unlisten = null; }
      };

      unlisten = await listen(eventName, (ev) => {
        const payload = ev.payload as { type?: string; content?: string; message?: string };
        switch (payload?.type) {
          case 'token':
            if (payload.content) enqueue(formatSseContentLine(payload.content));
            break;
          case 'error':
            closeOnce();
            break;
          case 'done':
            if (params.emitDoneMarker) enqueue(formatSseDoneLine());
            closeOnce();
            break;
          default:
            break;
        }
      });

      try {
        await invoke('llm_chat_stream', {
          args: {
            sessionId,
            baseUrl: params.baseURL.replace(/\/$/, ''),
            apiKey: params.apiKey,
            model: params.model,
            messages: params.messages,
            temperature: params.temperature,
            tools: params.tools && params.tools.length > 0 ? params.tools : undefined,
          },
        });
      } catch (e) {
        closeOnce();
        throw e;
      }
    },
    cancel() {
      if (unlisten) { unlisten(); unlisten = null; }
      closed = true;
    },
  });
}

/** Non-streaming helper: aggregate all tokens into one string. */
export async function llmChatComplete(params: LlmStreamParams): Promise<string> {
  const stream = await llmChatReadableStream({ ...params, emitDoneMarker: false });
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (line.startsWith('data: ')) {
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const j = JSON.parse(raw);
          if (j.content) out += j.content;
        } catch { /* skip */ }
      }
    }
  }
  return out;
}
