import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { defaultGroups as staticGroups } from '@/config/groups';
import { generateAICharacters, cliAgents, modelConfigs } from '@/config/aiCharacters';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
if (isTauri) {
  localStorage.setItem('token', 'local_desktop_token_placeholder');
}
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Helper to get local API Key
function getLocalApiKey(keyName: string): string {
  return localStorage.getItem(`API_KEY_${keyName}`) || '';
}

// Client-side implementation of AI response scheduling
async function clientScheduleAI(message: string, history: any[], availableAIs: any[]): Promise<string[]> {
  const allTags = new Set<string>();
  availableAIs.forEach(ai => {
    ai.tags?.forEach((tag: string) => allTags.add(tag));
  });

  const matchedTags: string[] = [];

  // Use the scheduler character configuration
  const schedulerAI = generateAICharacters(message, Array.from(allTags).join(','))[0];
  const modelConfig = modelConfigs.find(config => config.model === schedulerAI.model);
  const apiKey = getLocalApiKey(modelConfig?.apiKey || '');

  if (apiKey && modelConfig) {
    try {
      const prompt = schedulerAI.custom_prompt;
      const res = await fetch(`${modelConfig.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: schedulerAI.model,
          messages: [
            { role: 'system', content: prompt },
            ...history.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
            { role: 'user', content: message }
          ]
        })
      });

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        content.split(',').forEach((tag: string) => {
          const trimmed = tag.trim();
          if (trimmed) matchedTags.push(trimmed);
        });
      }
    } catch (e) {
      console.error('Failed client-side AI analysis for scheduling:', e);
    }
  }

  // If matched "文字游戏", all AIs respond
  if (matchedTags.includes("文字游戏")) {
    return availableAIs.map(ai => ai.id);
  }

  // Calculate scores
  const aiScores = new Map<string, number>();
  const messageLC = message.toLowerCase();

  for (const ai of availableAIs) {
    if (!ai.tags) continue;
    let score = 0;
    matchedTags.forEach(tag => {
      if (ai.tags?.includes(tag)) {
        score += 2;
      }
    });

    if (messageLC.includes(ai.name.toLowerCase())) {
      score += 5;
    }

    const recentHistory = history.slice(-5);
    recentHistory.forEach(hist => {
      if (hist.name === ai.name && hist.content.length > 0) {
        score += 1;
      }
    });

    if (score > 0) {
      aiScores.set(ai.id, score);
    }
  }

  const sortedAIs = Array.from(aiScores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  if (sortedAIs.length === 0) {
    const maxResponders = Math.min(2, availableAIs.length);
    const numResponders = Math.floor(Math.random() * maxResponders) + 1;
    const shuffledAIs = [...availableAIs]
      .sort(() => Math.random() - 0.5)
      .slice(0, numResponders);
    return shuffledAIs.map(ai => ai.id);
  }

  return sortedAIs.slice(0, 3); // MAX_RESPONDERS = 3
}

// Mock Response Helper
function mockResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function request(url: string, options: RequestInit = {}) {
  // If not running in Tauri, fallback to standard HTTP fetch
  if (!isTauri) {
    const token = localStorage.getItem('token');
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    } as any;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    return fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
    });
  }

  // Running inside Tauri - Intercept and map endpoints
  const cleanUrl = url.split('?')[0];

  try {
    // 1. Initial configuration endpoint
    if (cleanUrl === '/api/init') {
      let user: any = null;
      try {
        user = await invoke('get_current_user');
      } catch (e) {
        console.error('Failed to get current user from Tauri SQLite:', e);
      }

      // If no user exists, create a default "本地用户" immediately to avoid empty user profile
      if (!user) {
        try {
          user = await invoke('create_local_user', { nickname: '本地用户' });
          localStorage.setItem('token', 'local_desktop_token_placeholder');
        } catch (e) {
          console.error('Failed to create default local user:', e);
        }
      }

      let customGroups: any[] = [];
      try {
        const stored = localStorage.getItem('custom_groups');
        if (stored) {
          customGroups = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to parse custom groups:', e);
      }
      const allGroups = [...staticGroups, ...customGroups];

      return mockResponse({
        code: 200,
        data: {
          groups: allGroups,
          characters: [...generateAICharacters('#groupName#', '#allTags#'), ...cliAgents],
          user: user || null
        }
      });
    }

    // 2. User info endpoint
    if (cleanUrl === '/api/user/info') {
      const user = await invoke('get_current_user');
      return mockResponse({
        code: 200,
        data: user
      });
    }

    // 3. User update endpoint
    if (cleanUrl === '/api/user/update') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '用户不存在' }, 401);
      }
      const updatedUser = await invoke('update_user_info', {
        userId: user.id,
        nickname: body.nickname || user.nickname,
        avatarUrl: body.avatar_url || user.avatar_url
      });
      return mockResponse({
        success: true,
        data: updatedUser
      });
    }

    // 4. Scheduler API for AI response selection
    if (cleanUrl === '/api/scheduler') {
      const body = JSON.parse(options.body as string);
      const selectedAIs = await clientScheduleAI(body.message, body.history, body.availableAIs);
      return mockResponse({ selectedAIs });
    }

    // 9. CLI Agent run — spawn a local coding CLI (codex / claude / opencode / ...)
    // Streams stdout (and optionally stderr) back as a Server-Sent-Events style
    // stream identical in shape to /api/chat so ChatUI can consume it unchanged.
    if (cleanUrl === '/api/cli/run') {
      const body = JSON.parse(options.body as string);
      const {
        sessionId,
        groupId,
        agentId,
        agentName,
        adapter,
        prompt,
        cwd,
        binary,
        extraArgs,
        env,
        timeoutMs,
        approvalMode = 'auto',
        showStderr = true,
      } = body || {};

      if (!adapter || !prompt) {
        return mockResponse(
          { success: false, message: '/api/cli/run requires { adapter, prompt }' },
          400
        );
      }

      const finalSessionId = sessionId ||
        (typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;

      const eventName = `cli://${finalSessionId}`;

      // We build a ReadableStream that closes when we receive the `done`
      // event (or `error`). Listener is detached on close/cancel.
      let unlistenFn: UnlistenFn | null = null;
      let closed = false;

      const readable = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const enqueueEvent = (payload: Record<string, any>) => {
            try {
              controller.enqueue(
                enc.encode(`data: ${JSON.stringify(payload)}\n\n`)
              );
            } catch {
              /* controller already closed */
            }
          };
          const enqueueChunk = (content: string) => enqueueEvent({ content });

          const closeOnce = () => {
            if (closed) return;
            closed = true;
            try { controller.close(); } catch { /* */ }
            if (unlistenFn) { unlistenFn(); unlistenFn = null; }
          };

          // Subscribe BEFORE invoking, so we don't miss the first lines.
          let authErrorDetected = false;

          // ── Codex JSON mode: ALL output streams in real-time ──
          // Thinking & commands use a subdued visual style so the final reply stands out.
          // For non-JSON adapters we still stream raw stdout directly.
          let isJsonMode = adapter === 'codex';
          // Track whether we're inside an "intermediate" phase so we can
          // open/close a <details> wrapper around thinking+commands.
          let detailsOpen = false;
          let stepCount = 0;

          /** Open the collapsible block if not already open */
          const ensureDetailsOpen = () => {
            if (!detailsOpen) {
              detailsOpen = true;
              enqueueChunk(`\n<details open><summary>⚙️ 执行过程</summary>\n\n`);
            }
          };

          /** Close the collapsible block before the final reply or done */
          const closeDetails = () => {
            if (detailsOpen) {
              detailsOpen = false;
              const summary = stepCount > 0
                ? `⚙️ 已执行 ${stepCount} 个命令`
                : `⚙️ 执行过程`;
              // Replace the opening summary with final count by closing and re-emitting
              enqueueChunk(`\n</details>\n\n`);
            }
          };

          unlistenFn = await listen<any>(eventName, (evt) => {
            const payload = evt.payload || {};
            switch (payload.type) {
              case 'started':
                break;
              case 'stdout':
                if (typeof payload.content === 'string' && !authErrorDetected) {
                  const stdoutLine = payload.content;

                  // Codex --json mode: parse structured events, stream everything
                  if (isJsonMode && stdoutLine.startsWith('{') && stdoutLine.includes('"type"')) {
                    try {
                      const jsonEvt = JSON.parse(stdoutLine);

                      // Agent reply — close details block first, then stream reply text
                      if (jsonEvt.type === 'item.completed' && jsonEvt.item?.type === 'agent_message' && jsonEvt.item?.text) {
                        closeDetails();
                        enqueueChunk(jsonEvt.item.text + '\n');
                      }
                      // Thinking / reasoning — stream inside details block
                      else if (jsonEvt.type === 'item.completed' && jsonEvt.item?.type === 'reasoning' && jsonEvt.item?.text) {
                        ensureDetailsOpen();
                        enqueueChunk(`💭 **思考中**\n\n> ${jsonEvt.item.text.replace(/\n/g, '\n> ')}\n\n`);
                      }
                      // Command started — stream immediately
                      else if (jsonEvt.type === 'item.started' && jsonEvt.item?.type === 'command_execution') {
                        stepCount++;
                        ensureDetailsOpen();
                        const cmd = jsonEvt.item.command || '(unknown)';
                        const cmdShort = cmd.length > 120 ? cmd.slice(0, 117) + '...' : cmd;
                        enqueueChunk(`\n---\n\n▶ **Step ${stepCount}** — \`${cmdShort}\`\n\n`);
                      }
                      // Command completed — stream result
                      else if (jsonEvt.type === 'item.completed' && jsonEvt.item?.type === 'command_execution') {
                        ensureDetailsOpen();
                        const exitCode = jsonEvt.item.exit_code ?? 0;
                        const status = exitCode === 0 ? '✅ 成功' : `❌ 失败 (exit ${exitCode})`;
                        enqueueChunk(`${status}\n`);
                        if (jsonEvt.item.output) {
                          const outShort = jsonEvt.item.output.length > 500
                            ? jsonEvt.item.output.slice(0, 497) + '...'
                            : jsonEvt.item.output;
                          enqueueChunk(`\n\`\`\`\n${outShort}\n\`\`\`\n\n`);
                        }
                      }
                      // Skip turn.started, turn.completed, thread.started silently
                    } catch {
                      // Not valid JSON, show as-is
                      enqueueChunk(stdoutLine + '\n');
                    }
                  } else {
                    // Non-JSON stdout (opencode, claude, etc.) — show as-is
                    enqueueChunk(stdoutLine + '\n');
                  }
                }
                break;
              case 'stderr':
                if (!showStderr || typeof payload.content !== 'string') break;
                // Once auth error is detected, suppress ALL further output
                if (authErrorDetected) break;
                const line = payload.content;
                // Filter out noise lines that add no value
                if (/^(Reading additional input|WARNING:|^\s*$)/.test(line)) break;
                // Detect auth/token errors — show ONE friendly message then mute
                if (/401|token.?invalid|unauthorized|session.?ended|auth.?error|app_session_terminated|please.*(log\s*in|sign\s*in)/i.test(line)) {
                  authErrorDetected = true;
                  enqueueEvent({
                    type: 'error',
                    content: `\n**登录已过期，请在终端重新登录：**\n\`\`\`\ncodex login    # Codex\nclaude login   # Claude Code\n\`\`\`\n`,
                    error: 'auth_error',
                  });
                  break;
                }
                // Normal stderr — skip verbose codex boot info (workdir/model/session lines)
                if (/^(OpenAI Codex|-------|workdir:|model:|provider:|approval:|sandbox:|reasoning|session id:)/i.test(line.trim())) break;
                // In JSON mode, stream stderr as thinking inside the details block
                if (isJsonMode) {
                  ensureDetailsOpen();
                  enqueueChunk(`> 📝 _${line.trim().replace(/_/g, '\\_')}_\n\n`);
                } else {
                  enqueueChunk('> _' + line.replace(/_/g, '\\_') + '_\n');
                }
                break;
              case 'error':
                if (typeof payload.message === 'string') {
                  enqueueEvent({
                    type: 'error',
                    content: `\n**[CLI error]** ${payload.message}\n`,
                    error: payload.message,
                  });
                }
                break;
              case 'done': {
                const code = typeof payload.exit_code === 'number' ? payload.exit_code : -1;
                closeDetails();
                const status =
                  code === -2 ? 'cancelled'
                    : code === -3 ? 'timeout'
                      : code === 0 ? 'completed'
                        : 'failed';
                if (code !== 0) {
                  enqueueEvent({
                    type: 'done',
                    status,
                    exitCode: code,
                    content: `\n_(exit ${code})_\n`,
                    error: status === 'completed' ? undefined : status,
                  });
                } else {
                  enqueueEvent({ type: 'done', status, exitCode: code, content: '' });
                }
                closeOnce();
                break;
              }
            }
          });

          try {
            await invoke('cli_run', {
              args: {
                sessionId: finalSessionId,
                groupId: groupId || 'group-coding',
                agentId: agentId || 'cli-generic',
                agentName: agentName || 'CLI Agent',
                adapter,
                prompt,
                cwd: cwd || null,
                binary: binary || null,
                extraArgs: extraArgs || null,
                env: env || null,
                timeoutMs: timeoutMs || null,
                approvalMode,
                showStderr: showStderr ?? true,
              },
            });
          } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            enqueueEvent({
              type: 'error',
              content: `**[CLI spawn failed]** ${msg}`,
              error: msg,
            });
            enqueueEvent({
              type: 'done',
              status: 'failed',
              exitCode: -1,
              content: '',
              error: msg,
            });
            closeOnce();
          }
        },
        async cancel() {
          // Stream consumer aborted — kill the process.
          if (unlistenFn) { try { unlistenFn(); } catch {} unlistenFn = null; }
          try { await invoke('cli_kill', { sessionId: finalSessionId }); } catch { /* ignore */ }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-CLI-Session-Id': finalSessionId,
        },
      });
    }

    // 9.1 CLI task list
    if (cleanUrl === '/api/cli/tasks/list') {
      const urlObj = new URL(url, 'http://localhost');
      const groupId = urlObj.searchParams.get('groupId') || '';
      const limitVal = urlObj.searchParams.get('limit');
      const limit = limitVal ? parseInt(limitVal, 10) : undefined;
      const before = urlObj.searchParams.get('before') || undefined;

      const result = await invoke('cli_task_list', { groupId, limit, before });
      return mockResponse({ success: true, data: result });
    }

    // 9.2 CLI task get
    if (cleanUrl === '/api/cli/tasks/get') {
      const urlObj = new URL(url, 'http://localhost');
      const taskId = urlObj.searchParams.get('taskId') || '';
      const result = await invoke('cli_task_get', { taskId });
      return mockResponse({ success: true, data: result });
    }

    // 9.3 CLI task read log
    if (cleanUrl === '/api/cli/tasks/log') {
      const urlObj = new URL(url, 'http://localhost');
      const taskId = urlObj.searchParams.get('taskId') || '';
      const sinceLineVal = urlObj.searchParams.get('sinceLine') || urlObj.searchParams.get('since_line');
      const sinceLine = sinceLineVal ? parseInt(sinceLineVal, 10) : undefined;

      const result = await invoke('cli_task_read_log', { taskId, sinceLine });
      return mockResponse({ success: true, data: result });
    }

    // 9.4 CLI task cancel (kill)
    if (cleanUrl === '/api/cli/tasks/cancel') {
      const body = JSON.parse(options.body || '{}');
      const { taskId, sessionId } = body || {};
      const targetSessionId = taskId || sessionId || '';
      const result = await invoke('cli_kill', { sessionId: targetSessionId });
      return mockResponse({ success: true, data: result });
    }

    // 9.5 CLI runtime list
    if (cleanUrl === '/api/cli/runtimes/list') {
      const result = await invoke('cli_runtime_list');
      return mockResponse({ success: true, data: result });
    }

    // 10. CLI Agent availability check — used by member list to grey out
    //     CLIs that aren't installed.
    if (cleanUrl === '/api/cli/check') {
      const body = JSON.parse(options.body as string);
      const adapter = body?.adapter;
      if (!adapter) {
        return mockResponse({ success: false, message: 'adapter required' }, 400);
      }
      const result = await invoke('cli_check', { adapter });
      return mockResponse({ success: true, data: result });
    }



    // 11. Chat API (Direct LLM streaming from client side)
    if (cleanUrl === '/api/chat') {
      const body = JSON.parse(options.body as string);
      const { message, custom_prompt, history, aiName, index, model = "qwen-plus" } = body;

      const modelConfig = modelConfigs.find(config => config.model === model);
      if (!modelConfig) {
        throw new Error('不支持的模型类型');
      }

      // Try local storage for custom key, fallback to local env if compiled
      let apiKey = getLocalApiKey(modelConfig.apiKey);
      let baseURL = modelConfig.baseURL;

      // Special handling for Ollama or Local Endpoint
      if (modelConfig.apiKey === 'OLLAMA_API_KEY' || localStorage.getItem('API_KEY_OLLAMA_URL')) {
        const customOllamaUrl = localStorage.getItem('API_KEY_OLLAMA_URL');
        if (customOllamaUrl) {
          baseURL = customOllamaUrl;
        }
      }

      if (!apiKey && modelConfig.apiKey !== 'OLLAMA_API_KEY') {
        throw new Error(`${model} 的API密钥未配置，请点击左下角头像配置 API Key`);
      }

      // Build message payload
      const systemPrompt = `${custom_prompt}\n 注意重要：1、你在群里叫${aiName}认准自己的身份； 2、你的输出内容不要加${aiName}：这种多余前缀；3、如果用户提出玩游戏，比如成语接龙等，严格按照游戏规则，不要说一大堆，要简短精炼; 4、保持群聊风格字数严格控制在50字以内，越简短越好（新闻总结类除外）`;

      const baseMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map(h => ({
          role: h.role === 'user' ? 'user' : 'assistant',
          content: h.content
        })),
      ];

      const userMessage = { role: 'user', content: message };
      if (index === 0) {
        baseMessages.push(userMessage);
      } else {
        baseMessages.splice(baseMessages.length - index, 0, userMessage);
      }

      // Call LLM endpoint directly
      const response = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: baseMessages,
          stream: true
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`LLM Error: ${response.status} - ${errText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      // Convert LLM stream into the format expected by ChatUI
      const readable = new ReadableStream({
        async start(controller) {
          let buffer = '';
          try {
            while (true) {
              const { done, value } = await reader!.read();
              if (done) {
                controller.close();
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              let lines = buffer.split('\n');
              buffer = lines.pop() || ''; // keep the last partial line in buffer

              for (const line of lines) {
                const cleanLine = line.trim();
                if (!cleanLine) continue;

                if (cleanLine.startsWith('data: ')) {
                  const dataStr = cleanLine.slice(6);
                  if (dataStr === '[DONE]') continue;

                  try {
                    const parsed = JSON.parse(dataStr);
                    const content = parsed.choices?.[0]?.delta?.content || '';
                    if (content) {
                      controller.enqueue(
                        new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`)
                      );
                    }
                  } catch (e) {
                    // Ignore JSON parse errors for non-standard lines
                  }
                }
              }
            }
          } catch (e: any) {
            controller.error(e);
          }
        }
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // Default error for unhandled API calls
    return mockResponse({ success: false, message: `Desktop Mock API: ${cleanUrl} not implemented` }, 404);
  } catch (error: any) {
    console.error('Request intercept error:', error);
    return mockResponse({ success: false, message: error.message || 'Tauri operation failed' }, 500);
  }
}
