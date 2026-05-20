import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { groups as staticGroups } from '@/config/groups';
import { generateAICharacters, modelConfigs } from '@/config/aiCharacters';

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

      let dynamicGroups: any[] = [];
      if (user) {
        try {
          const list: any = await invoke('get_claw_groups', { userId: user.id });
          dynamicGroups = list.map((g: any) => ({
            id: g.id,
            name: `🦞${g.name}`,
            description: g.description || '',
            members: [],
            isGroupDiscussionMode: true,
            type: 'openclaw',
            clawGroupId: g.id
          }));
        } catch (e) {
          console.error('Failed to fetch local claw groups:', e);
        }
      }

      const allGroups = [...staticGroups, ...dynamicGroups];

      return mockResponse({
        code: 200,
        data: {
          groups: allGroups,
          characters: generateAICharacters('#groupName#', '#allTags#'),
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

    // 4. Create claw group
    if (cleanUrl === '/api/claw/create') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '请先登录' }, 401);
      }
      const group = await invoke('create_claw_group', {
        userId: user.id,
        name: body.name,
        description: body.description || ''
      });
      return mockResponse({
        success: true,
        data: { group }
      });
    }

    // 5. Join claw group
    if (cleanUrl === '/api/claw/join') {
      const body = JSON.parse(options.body as string);
      const user: any = await invoke('get_current_user');
      if (!user) {
        return mockResponse({ success: false, message: '请先登录' }, 401);
      }
      await invoke('join_claw_group', {
        userId: user.id,
        groupId: body.groupId
      });
      return mockResponse({ success: true });
    }

    // 6. Get claw group messages
    if (cleanUrl === '/api/claw/messages') {
      const params = new URLSearchParams(url.split('?')[1] || '');
      const group = params.get('group') || '';
      const limit = params.get('limit') ? parseInt(params.get('limit')!) : 30;
      const since = params.get('since') ? parseInt(params.get('since')!) : null;
      const before = params.get('before') ? parseInt(params.get('before')!) : null;

      const messages = await invoke('get_claw_messages', {
        groupId: group,
        limit,
        since,
        before
      });

      return mockResponse({
        success: true,
        data: messages
      });
    }

    // 7. Send claw group message
    if (cleanUrl === '/api/claw/send') {
      const body = JSON.parse(options.body as string);
      const message = await invoke('send_claw_message', {
        groupId: body.groupId,
        senderId: body.senderId || '1',
        senderName: body.senderName || '用户',
        senderType: body.senderType || 'user',
        content: body.content
      });

      return mockResponse({
        success: true,
        data: message
      });
    }

    // 8. Scheduler API for AI response selection
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
        adapter,
        prompt,
        cwd,
        binary,
        extraArgs,
        env,
        showStderr = true,
      } = body || {};

      if (!adapter || !prompt) {
        return mockResponse(
          { success: false, message: '/api/cli/run requires { adapter, prompt }' },
          400
        );
      }

      const sessionId =
        (typeof crypto !== 'undefined' && (crypto as any).randomUUID
          ? (crypto as any).randomUUID()
          : `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;

      const eventName = `cli://${sessionId}`;

      // We build a ReadableStream that closes when we receive the `done`
      // event (or `error`). Listener is detached on close/cancel.
      let unlistenFn: UnlistenFn | null = null;
      let closed = false;

      const readable = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          const enqueueChunk = (content: string) => {
            try {
              controller.enqueue(
                enc.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            } catch {
              /* controller already closed */
            }
          };

          const closeOnce = () => {
            if (closed) return;
            closed = true;
            try { controller.close(); } catch { /* */ }
            if (unlistenFn) { unlistenFn(); unlistenFn = null; }
          };

          // Subscribe BEFORE invoking, so we don't miss the first lines.
          let authErrorDetected = false;
          // Collect command executions for collapsible details block
          let pendingCommands: { cmd: string; duration?: string; exit_code?: number }[] = [];
          let detailsEmitted = false;

          const flushCommandDetails = () => {
            if (pendingCommands.length === 0 || detailsEmitted) return;
            detailsEmitted = true;
            // Use a visually distinct format that works with standard markdown.
            // The details/summary HTML tags work in most markdown renderers including react-markdown with rehype-raw.
            // If rehype-raw is not available, we fallback to a blockquote style.
            const header = `\n---\n<details><summary>🔧 执行过程 (${pendingCommands.length} 步)</summary>\n\n`;
            const items = pendingCommands.map((c, i) => {
              const status = c.exit_code === 0 ? '✓' : c.exit_code != null ? `✗ exit ${c.exit_code}` : '...';
              const cmdShort = c.cmd.length > 80 ? c.cmd.slice(0, 77) + '...' : c.cmd;
              return `${i + 1}. \`${cmdShort}\` ${status}`;
            }).join('\n');
            enqueueChunk(header + items + '\n\n</details>\n\n');
          };

          unlistenFn = await listen<any>(eventName, (evt) => {
            const payload = evt.payload || {};
            switch (payload.type) {
              case 'started':
                break;
              case 'stdout':
                if (typeof payload.content === 'string' && !authErrorDetected) {
                  const stdoutLine = payload.content;
                  // Codex --json mode: parse structured events
                  if (stdoutLine.startsWith('{') && stdoutLine.includes('"type"')) {
                    try {
                      const jsonEvt = JSON.parse(stdoutLine);
                      if (jsonEvt.type === 'item.completed' && jsonEvt.item?.type === 'agent_message' && jsonEvt.item?.text) {
                        // Before showing agent reply, flush any accumulated command details
                        flushCommandDetails();
                        enqueueChunk(jsonEvt.item.text + '\n');
                      } else if (jsonEvt.type === 'item.started' && jsonEvt.item?.type === 'command_execution') {
                        // Track command start
                        pendingCommands.push({ cmd: jsonEvt.item.command || '(unknown)' });
                      } else if (jsonEvt.type === 'item.completed' && jsonEvt.item?.type === 'command_execution') {
                        // Update the last command with exit code
                        const last = pendingCommands[pendingCommands.length - 1];
                        if (last) {
                          last.exit_code = jsonEvt.item.exit_code ?? 0;
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
                  enqueueChunk(`\n**登录已过期，请在终端重新登录：**\n\`\`\`\ncodex login    # Codex\nclaude login   # Claude Code\n\`\`\`\n`);
                  break;
                }
                // Normal stderr — skip verbose codex boot info (workdir/model/session lines)
                if (/^(OpenAI Codex|-------|workdir:|model:|provider:|approval:|sandbox:|reasoning|session id:)/i.test(line.trim())) break;
                enqueueChunk('> _' + line.replace(/_/g, '\\_') + '_\n');
                break;
              case 'error':
                if (typeof payload.message === 'string') {
                  enqueueChunk(`\n**[CLI error]** ${payload.message}\n`);
                }
                break;
              case 'done': {
                // Flush any remaining command details before closing
                flushCommandDetails();
                const code = typeof payload.exit_code === 'number' ? payload.exit_code : -1;
                if (code !== 0) {
                  enqueueChunk(`\n_(exit ${code})_\n`);
                }
                closeOnce();
                break;
              }
            }
          });

          try {
            await invoke('cli_run', {
              args: {
                sessionId,
                adapter,
                prompt,
                cwd: cwd || null,
                binary: binary || null,
                extraArgs: extraArgs || null,
                env: env || null,
              },
            });
          } catch (e: any) {
            const msg = e instanceof Error ? e.message : String(e);
            enqueueChunk(`**[CLI spawn failed]** ${msg}`);
            closeOnce();
          }
        },
        async cancel() {
          // Stream consumer aborted — kill the process.
          if (unlistenFn) { try { unlistenFn(); } catch {} unlistenFn = null; }
          try { await invoke('cli_kill', { sessionId }); } catch { /* ignore */ }
        },
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-CLI-Session-Id': sessionId,
        },
      });
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