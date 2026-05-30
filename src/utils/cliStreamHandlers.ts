import { adapterUsesOpenCodeSessionTitle, getCLIAdapterDefinition, type CLIStreamMode } from '../config/cliAdapters';
import {
  parseClaudeJsonLine,
  renderClaudeCommandCompleted,
  renderClaudeCommandGroupEnd,
  renderClaudeCommandGroupStart,
  renderClaudeCommandStarted,
} from './claudeStream';
import {
  parseCursorJsonLine,
  renderCursorCommandCompleted,
  renderCursorCommandGroupEnd,
  renderCursorCommandGroupStart,
  renderCursorCommandStarted,
  renderCursorThinking,
  renderCursorToolCompleted,
  shouldEmitCursorSummary,
} from './cursorStream';
import {
  parseCodexJsonLine,
  renderCodexCommandCompleted,
  renderCodexCommandGroupEnd,
  renderCodexCommandGroupStart,
  renderCodexCommandStarted,
} from './codexStream';
import {
  parseOpenCodeJsonLine,
  renderOpenCodeCommand,
  renderOpenCodeCommandGroupEnd,
  renderOpenCodeCommandGroupStart,
} from './opencodeStream';
import {
  parseQoderJsonLine,
} from './qoderStream';

export type CLIStreamEvent = Record<string, unknown>;

export interface CLIStreamEmitters {
  enqueueChunk: (content: string) => void;
  enqueueEvent: (payload: CLIStreamEvent) => void;
}

export interface CLIStreamHandler {
  streamMode: CLIStreamMode;
  usesJsonModeStderr: boolean;
  handleStdoutLine: (line: string) => boolean;
  closeCommandGroups: () => void;
  hasCommandGroupOpen: () => boolean;
  flushDone: () => void;
}

function rawHandler(streamMode: CLIStreamMode): CLIStreamHandler {
  return {
    streamMode,
    usesJsonModeStderr: false,
    handleStdoutLine: () => false,
    closeCommandGroups: () => {},
    hasCommandGroupOpen: () => false,
    flushDone: () => {},
  };
}

export function createCLIStreamHandler(
  adapter: string,
  emitters: CLIStreamEmitters,
): CLIStreamHandler {
  const definition = getCLIAdapterDefinition(adapter);
  const streamMode = definition.streamMode;

  if (streamMode === 'codex-json') {
    let sessionId: string | null = null;
    let commandGroupOpen = false;
    let commandIndex = 0;

    const ensureCommandGroupOpen = () => {
      if (!commandGroupOpen) {
        commandGroupOpen = true;
        commandIndex = 0;
        emitters.enqueueChunk(renderCodexCommandGroupStart());
      }
    };

    const closeCommandGroups = () => {
      if (commandGroupOpen) {
        commandGroupOpen = false;
        emitters.enqueueChunk(renderCodexCommandGroupEnd());
      }
    };

    return {
      streamMode,
      usesJsonModeStderr: true,
      hasCommandGroupOpen: () => commandGroupOpen,
      closeCommandGroups,
      flushDone: () => {},
      handleStdoutLine: (line) => {
        if (!line.startsWith('{') || !line.includes('"type"')) return false;
        try {
          const parsed = parseCodexJsonLine(line);
          if (parsed?.sessionId && parsed.sessionId !== sessionId) {
            sessionId = parsed.sessionId;
            emitters.enqueueEvent({ type: 'tool_session', adapter, sessionId: parsed.sessionId });
          }
          if (parsed?.error) {
            closeCommandGroups();
            emitters.enqueueEvent({
              type: 'error',
              content: `\n**[Codex error]** ${parsed.error}\n`,
              error: parsed.error,
            });
          } else if (parsed?.command) {
            ensureCommandGroupOpen();
            if (parsed.command.phase === 'started') {
              commandIndex++;
              emitters.enqueueChunk(renderCodexCommandStarted(parsed.command.command, commandIndex));
            } else {
              emitters.enqueueChunk(renderCodexCommandCompleted(parsed.command.exitCode, parsed.command.output));
            }
          } else if (parsed?.content) {
            closeCommandGroups();
            emitters.enqueueChunk(parsed.content);
          }
        } catch {
          closeCommandGroups();
          emitters.enqueueChunk(`${line}\n`);
        }
        return true;
      },
    };
  }

  if (streamMode === 'opencode-json') {
    let sessionId: string | null = null;
    let commandGroupOpen = false;
    let commandIndex = 0;

    const ensureCommandGroupOpen = () => {
      if (!commandGroupOpen) {
        commandGroupOpen = true;
        commandIndex = 0;
        emitters.enqueueChunk(renderOpenCodeCommandGroupStart());
      }
    };

    const closeCommandGroups = () => {
      if (commandGroupOpen) {
        commandGroupOpen = false;
        emitters.enqueueChunk(renderOpenCodeCommandGroupEnd());
      }
    };

    return {
      streamMode,
      usesJsonModeStderr: false,
      hasCommandGroupOpen: () => commandGroupOpen,
      closeCommandGroups,
      flushDone: () => {
        if (adapterUsesOpenCodeSessionTitle(adapter) && sessionId) {
          emitters.enqueueEvent({ type: 'tool_session', adapter, sessionId });
        }
      },
      handleStdoutLine: (line) => {
        const parsed = parseOpenCodeJsonLine(line);
        if (parsed?.sessionId && parsed.sessionId !== sessionId) {
          sessionId = parsed.sessionId;
          emitters.enqueueEvent({ type: 'tool_session', adapter, sessionId: parsed.sessionId });
        }
        if (parsed?.error) {
          closeCommandGroups();
          emitters.enqueueEvent({
            type: 'error',
            content: `\n**[OpenCode error]** ${parsed.error}\n`,
            error: parsed.error,
          });
        } else if (parsed?.command) {
          ensureCommandGroupOpen();
          commandIndex++;
          emitters.enqueueChunk(renderOpenCodeCommand(parsed.command, commandIndex));
        } else if (parsed?.content) {
          closeCommandGroups();
          emitters.enqueueChunk(parsed.content);
        } else if (!line.startsWith('{')) {
          closeCommandGroups();
          emitters.enqueueChunk(`${line}\n`);
        }
        return true;
      },
    };
  }

  if (streamMode === 'claude-json') {
    let sessionId: string | null = null;
    let commandGroupOpen = false;
    let commandIndex = 0;

    const ensureCommandGroupOpen = () => {
      if (!commandGroupOpen) {
        commandGroupOpen = true;
        commandIndex = 0;
        emitters.enqueueChunk(renderClaudeCommandGroupStart());
      }
    };

    const closeCommandGroups = () => {
      if (commandGroupOpen) {
        commandGroupOpen = false;
        emitters.enqueueChunk(renderClaudeCommandGroupEnd());
      }
    };

    return {
      streamMode,
      usesJsonModeStderr: false,
      hasCommandGroupOpen: () => commandGroupOpen,
      closeCommandGroups,
      flushDone: () => {},
      handleStdoutLine: (line) => {
        const parsed = parseClaudeJsonLine(line);
        if (parsed?.sessionId && parsed.sessionId !== sessionId) {
          sessionId = parsed.sessionId;
          emitters.enqueueEvent({ type: 'tool_session', adapter, sessionId: parsed.sessionId });
        }
        if (parsed?.error) {
          closeCommandGroups();
          emitters.enqueueEvent({
            type: 'error',
            content: `\n**[Claude Code error]** ${parsed.error}\n`,
            error: parsed.error,
          });
        }
        if (parsed?.content) {
          closeCommandGroups();
          emitters.enqueueChunk(parsed.content);
        }
        if (parsed?.command) {
          if (parsed.command.phase === 'started') {
            ensureCommandGroupOpen();
            commandIndex++;
            emitters.enqueueChunk(renderClaudeCommandStarted(parsed.command.command, commandIndex));
          } else if (commandGroupOpen) {
            emitters.enqueueChunk(renderClaudeCommandCompleted(parsed.command.output));
          }
        } else if (!parsed && !line.startsWith('{')) {
          closeCommandGroups();
          emitters.enqueueChunk(`${line}\n`);
        }
        return true;
      },
    };
  }

  if (streamMode === 'cursor-json') {
    let sessionId: string | null = null;
    let commandGroupOpen = false;
    let commandIndex = 0;
    let thinkingBuffer = '';
    let lastSummaryText = '';

    const ensureCommandGroupOpen = () => {
      if (!commandGroupOpen) {
        commandGroupOpen = true;
        commandIndex = 0;
        emitters.enqueueChunk(renderCursorCommandGroupStart());
      }
    };

    const closeCommandGroups = () => {
      if (commandGroupOpen) {
        commandGroupOpen = false;
        emitters.enqueueChunk(renderCursorCommandGroupEnd());
      }
    };

    const flushThinking = () => {
      if (!thinkingBuffer.trim()) return;
      ensureCommandGroupOpen();
      emitters.enqueueChunk(renderCursorThinking(thinkingBuffer));
      thinkingBuffer = '';
    };

    const enqueueSummary = (text: string) => {
      if (!shouldEmitCursorSummary(text, lastSummaryText)) return;
      lastSummaryText = text.trim();
      closeCommandGroups();
      emitters.enqueueChunk(text.endsWith('\n') ? text : `${text}\n\n`);
    };

    return {
      streamMode,
      usesJsonModeStderr: false,
      hasCommandGroupOpen: () => commandGroupOpen,
      closeCommandGroups,
      flushDone: () => {
        flushThinking();
      },
      handleStdoutLine: (line) => {
        const parsed = parseCursorJsonLine(line);
        if (parsed?.sessionId && parsed.sessionId !== sessionId) {
          sessionId = parsed.sessionId;
          emitters.enqueueEvent({ type: 'tool_session', adapter, sessionId: parsed.sessionId });
        }
        if (parsed?.error) {
          flushThinking();
          closeCommandGroups();
          emitters.enqueueEvent({
            type: 'error',
            content: `\n**[Cursor Agent error]** ${parsed.error}\n`,
            error: parsed.error,
          });
        }
        if (parsed?.thinking) {
          if (parsed.thinking.phase === 'delta' && parsed.thinking.text) {
            thinkingBuffer += parsed.thinking.text;
          } else if (parsed.thinking.phase === 'completed') {
            flushThinking();
          }
        }
        if (parsed?.content) {
          flushThinking();
          enqueueSummary(parsed.content);
        }
        if (parsed?.resultContent) {
          flushThinking();
          enqueueSummary(parsed.resultContent);
        }
        if (parsed?.command) {
          if (parsed.command.phase === 'started') {
            flushThinking();
            ensureCommandGroupOpen();
            commandIndex++;
            emitters.enqueueChunk(renderCursorCommandStarted(parsed.command.command, commandIndex));
          } else if (parsed.command.phase === 'completed' && commandGroupOpen) {
            emitters.enqueueChunk(renderCursorCommandCompleted(parsed.command.exitCode, parsed.command.output));
          } else if (parsed.command.phase === 'tool_completed' && commandGroupOpen) {
            emitters.enqueueChunk(renderCursorToolCompleted(parsed.command.label));
          }
        } else if (!parsed && !line.startsWith('{')) {
          closeCommandGroups();
          emitters.enqueueChunk(`${line}\n`);
        }
        return true;
      },
    };
  }

  if (streamMode === 'qoder-json') {
    let sessionId: string | null = null;

    return {
      streamMode,
      usesJsonModeStderr: false,
      hasCommandGroupOpen: () => false,
      closeCommandGroups: () => {},
      flushDone: () => {},
      handleStdoutLine: (line) => {
        const parsed = parseQoderJsonLine(line);
        if (parsed?.sessionId && parsed.sessionId !== sessionId) {
          sessionId = parsed.sessionId;
          emitters.enqueueEvent({ type: 'tool_session', adapter, sessionId: parsed.sessionId });
        }
        if (parsed?.error) {
          emitters.enqueueEvent({
            type: 'error',
            content: `\n**[Qoder CLI error]** ${parsed.error}\n`,
            error: parsed.error,
          });
        } else if (parsed?.content) {
          emitters.enqueueChunk(parsed.content);
        } else if (!parsed) {
          emitters.enqueueChunk(`${line}\n`);
        }
        return true;
      },
    };
  }

  return rawHandler(streamMode);
}
