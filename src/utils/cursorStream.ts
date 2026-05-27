export interface CursorJsonParseResult {
  sessionId?: string;
  content?: string;
  error?: string;
  command?: CursorCommandEvent;
}

export type CursorCommandEvent =
  | {
      phase: 'started';
      command: string;
    }
  | {
      phase: 'completed';
      exitCode: number;
      output?: string;
    };

export function renderCursorCommandGroupStart(): string {
  return `\n<details open data-cli-command-group="cursor"><summary>⚙️ 执行命令</summary>\n\n`;
}

export function renderCursorCommandGroupEnd(): string {
  return `\n</details>\n\n`;
}

export function renderCursorCommandStarted(command: string, index: number): string {
  const title = command.length > 120 ? `${command.slice(0, 117)}...` : command;
  return `<p><small>${index}. <code>${escapeHtml(title)}</code></small></p>\n\n${fence(command)}\n\n`;
}

export function renderCursorCommandCompleted(exitCode: number, output?: string): string {
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

function sessionIdFromEvent(event: any): string | undefined {
  const candidates = [
    event.session_id,
    event.sessionId,
  ];

  return candidates.find((value) => typeof value === 'string' && value.length > 0);
}

function shellCommandFromToolCall(event: any): string | undefined {
  const command = event?.tool_call?.shellToolCall?.args?.command;
  return typeof command === 'string' && command.trim() ? command.trim() : undefined;
}

function shellResultFromToolCall(event: any): { exitCode: number; output?: string } | undefined {
  const result = event?.tool_call?.shellToolCall?.result;
  const success = result?.success;
  if (!success || typeof success !== 'object') return undefined;

  const exitCode = typeof success.exitCode === 'number' ? success.exitCode : 0;
  const output = typeof success.stdout === 'string' && success.stdout.trim()
    ? success.stdout
    : typeof success.interleavedOutput === 'string' && success.interleavedOutput.trim()
      ? success.interleavedOutput
      : undefined;

  return { exitCode, output };
}

export function parseCursorJsonLine(line: string): CursorJsonParseResult | null {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    return null;
  }

  if (!event || typeof event !== 'object') return null;

  const result: CursorJsonParseResult = {};
  const sessionId = sessionIdFromEvent(event);
  if (sessionId) result.sessionId = sessionId;

  if (event.type === 'assistant') {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    const text = blocks
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('');
    if (text) result.content = text;
  } else if (event.type === 'tool_call' && event.subtype === 'started') {
    const command = shellCommandFromToolCall(event);
    if (command) {
      result.command = {
        phase: 'started',
        command,
      };
    }
  } else if (event.type === 'tool_call' && event.subtype === 'completed') {
    const shellResult = shellResultFromToolCall(event);
    if (shellResult) {
      result.command = {
        phase: 'completed',
        exitCode: shellResult.exitCode,
        output: shellResult.output,
      };
    }
  } else if (event.type === 'result' && event.is_error) {
    const message = event.result || event.error?.message || event.error;
    result.error = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Cursor Agent 执行出错';
  } else if (event.type === 'error') {
    const message = event.message || event.error?.message || event.error;
    result.error = typeof message === 'string' && message.trim()
      ? message.trim()
      : 'Cursor Agent 执行出错';
  }

  return Object.keys(result).length > 0 ? result : null;
}
