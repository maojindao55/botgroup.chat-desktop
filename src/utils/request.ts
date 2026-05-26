import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { llmChatReadableStream, llmChatComplete } from '@/utils/llmClient';
import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';
import { collectLegacyApiKeys, clearLegacyApiKeys } from '@/utils/legacyApiKeys';
import { defaultGroups as staticGroups } from '@/config/groups';
import { filterDeletedCLITemplates } from '@/config/cliTemplateStorage';
import { generateAICharacters, cliAgents, modelConfigs } from '@/config/aiCharacters';
import { builtinAIMembers, type AIMember } from '@/config/aiMembers';
import { builtinProviders, lookupProviderByEnvName, mapProviderToRust } from '@/config/providers';
import {
  parseClaudeJsonLine,
  renderClaudeCommandCompleted,
  renderClaudeCommandGroupEnd,
  renderClaudeCommandGroupStart,
  renderClaudeCommandStarted,
} from '@/utils/claudeStream';
import { cleanCliOutputLine, shouldSuppressCliOutputLine } from '@/utils/cliOutput';
import {
  parseCodexJsonLine,
  renderCodexCommandCompleted,
  renderCodexCommandGroupEnd,
  renderCodexCommandGroupStart,
  renderCodexCommandStarted,
} from '@/utils/codexStream';
import {
  parseOpenCodeJsonLine,
  renderOpenCodeCommand,
  renderOpenCodeCommandGroupEnd,
  renderOpenCodeCommandGroupStart,
} from '@/utils/opencodeStream';

const isTauri = typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__ !== undefined;
if (isTauri) {
  localStorage.setItem('token', 'local_desktop_token_placeholder');
}
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Client-side implementation of AI response scheduling
async function clientScheduleAI(message: string, history: any[], availableAIs: any[]): Promise<string[]> {
  const allTags = new Set<string>();
  availableAIs.forEach(ai => {
    ai.tags?.forEach((tag: string) => allTags.add(tag));
  });

  const matchedTags: string[] = [];

  // Use the scheduler character configuration
  const schedulerAI = generateAICharacters(message, Array.from(allTags).join(','))[0];

  try {
    const creds = await resolveLlmCredentials(schedulerAI.model);
    const prompt = schedulerAI.custom_prompt;
    const text = await llmChatComplete({
      ...creds,
      messages: [
        { role: 'system', content: prompt },
        ...history.slice(-10).map(h => ({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content })),
        { role: 'user', content: message },
      ],
    });
    text.split(',').forEach((tag: string) => {
      const trimmed = tag.trim();
      if (trimmed) matchedTags.push(trimmed);
    });
  } catch (e) {
    console.error('Failed client-side AI analysis for scheduling:', e);
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

      // Check if we need to migrate custom groups
      let needsSaveCustomGroups = false;
      const migratedCustomGroups = customGroups.map((g: any) => {
        let changed = false;
        const newGroup = { ...g };
        
        // 1. Migrate AI group
        if (newGroup.type === 'ai') {
          if (newGroup.members && !newGroup.memberIds) {
            newGroup.memberIds = newGroup.members;
            changed = true;
          }
        }
        
        // 2. Migrate CLI group
        if (newGroup.type === 'cli') {
          if (newGroup.members && !newGroup.memberIds) {
            newGroup.memberIds = newGroup.members;
            changed = true;
          }
        }

        // 3. Migrate Agent group: 把内联 agents 抽到 ai_members 库 + 写入 memberIds，然后清理旧字段
        if (newGroup.type === 'agent') {
          if (newGroup.agents && !newGroup.memberIds) {
            newGroup.memberIds = [];
            for (const agent of newGroup.agents) {
              const agentId = agent.id || `agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              newGroup.memberIds.push(agentId);
              
              const agentLlm = agent.llm || { baseURL: '', apiKey: '', model: '' };
              const mappedMember = {
                id: agentId,
                kind: 'agent' as const,
                name: agent.name || '未命名 Agent',
                avatar: agent.avatar || '',
                description: agent.role || '',
                tags: [],
                source: 'user' as const,
                enabled: true,
                role: agent.role || '',
                systemPrompt: agent.systemPrompt || '',
                providerId: agent.providerId || lookupProviderByEnvName(agentLlm.apiKey || 'DEEPSEEK_API_KEY'),
                model: agent.model || agentLlm.model || 'deepseek-chat',
                tools: agent.tools || [],
                maxTurns: agent.maxTurns || 5,
                temperature: agent.temperature || 0.7
              };

              if (isTauri) {
                invoke('upsert_ai_member', {
                  member: {
                    id: mappedMember.id,
                    kind: mappedMember.kind,
                    name: mappedMember.name,
                    avatar: mappedMember.avatar || null,
                    description: mappedMember.description || null,
                    tags: '[]',
                    source: 'user',
                    config: JSON.stringify({
                      role: mappedMember.role,
                      systemPrompt: mappedMember.systemPrompt,
                      providerId: mappedMember.providerId,
                      model: mappedMember.model,
                      tools: mappedMember.tools,
                      maxTurns: mappedMember.maxTurns,
                      temperature: mappedMember.temperature,
                    }),
                    enabled: 1
                  }
                }).catch((e: any) => console.error('Failed to migrate agent to DB:', e));
              } else {
                const localStr = localStorage.getItem('custom_ai_members') || '[]';
                const customMembers = JSON.parse(localStr);
                if (!customMembers.some((m: any) => m.id === agentId)) {
                  customMembers.push(mappedMember);
                  localStorage.setItem('custom_ai_members', JSON.stringify(customMembers));
                }
              }
            }
            // 迁移完成后清理内联 agents 字段，避免 memberIds + agents 双写不一致
            delete newGroup.agents;
            changed = true;
          }
        }

        if (changed) {
          needsSaveCustomGroups = true;
        }
        return newGroup;
      });

      if (needsSaveCustomGroups) {
        localStorage.setItem('custom_groups', JSON.stringify(migratedCustomGroups));
        customGroups = migratedCustomGroups;
      }

      const allGroups = filterDeletedCLITemplates([...staticGroups, ...customGroups]);

      let characters: any[] = [];
      if (isTauri) {
        try {
          // PR4: one-shot migration (localStorage → vault, member config → providerId)
          try {
            const alreadyDone = await invoke<boolean>('migration_status');
            if (!alreadyDone) {
              const migrationResult = await invoke<{ migrated: boolean }>('migrate_a_complete', {
                input: { localStorageKeys: collectLegacyApiKeys() },
              });
              if (migrationResult.migrated) {
                clearLegacyApiKeys();
                console.info('[init] PR4 data migration completed');
              }
            }
          } catch (migrationErr) {
            console.error('[init] PR4 migration failed:', migrationErr);
          }

          let dbMembers: any[] = await invoke('list_ai_members', { kind: null });
          if (dbMembers.length === 0) {
            const toSeed = builtinAIMembers.map((m) => {
              let configObj: any = {};
              if (m.kind === 'llm') {
                configObj = {
                  providerId: m.providerId,
                  model: m.model,
                  schedulerTag: m.schedulerTag,
                  customPrompt: m.customPrompt,
                  stages: m.stages,
                };
              } else if (m.kind === 'agent') {
                configObj = {
                  role: m.role,
                  systemPrompt: m.systemPrompt,
                  providerId: m.providerId,
                  model: m.model,
                  tools: m.tools,
                  maxTurns: m.maxTurns,
                  temperature: m.temperature,
                };
              } else if (m.kind === 'cli') {
                configObj = { cli: m.cli };
              }
              return {
                id: m.id,
                kind: m.kind,
                name: m.name,
                avatar: m.avatar || null,
                description: m.description || null,
                tags: JSON.stringify(m.tags || []),
                source: m.source,
                config: JSON.stringify(configObj),
                enabled: 1,
              };
            });
            await invoke('seed_builtin_ai_members', { members: toSeed });
            dbMembers = await invoke('list_ai_members', { kind: null });
          } else {
            const existingIds = new Set(dbMembers.map((m: { id: string }) => m.id));
            const missing = builtinAIMembers.filter((b) => !existingIds.has(b.id));
            if (missing.length > 0) {
              const toSeed = missing.map((m) => {
                let configObj: any = {};
                if (m.kind === 'llm') {
                  configObj = {
                    providerId: m.providerId,
                    model: m.model,
                    schedulerTag: m.schedulerTag,
                    customPrompt: m.customPrompt,
                    stages: m.stages,
                  };
                } else if (m.kind === 'agent') {
                  configObj = {
                    role: m.role,
                    systemPrompt: m.systemPrompt,
                    providerId: m.providerId,
                    model: m.model,
                    tools: m.tools,
                    maxTurns: m.maxTurns,
                    temperature: m.temperature,
                  };
                } else {
                  configObj = { cli: m.cli };
                }
                return {
                  id: m.id,
                  kind: m.kind,
                  name: m.name,
                  avatar: m.avatar || null,
                  description: m.description || null,
                  tags: JSON.stringify(m.tags || []),
                  source: m.source,
                  config: JSON.stringify(configObj),
                  enabled: 1,
                };
              });
              await invoke('seed_builtin_ai_members', { members: toSeed });
              dbMembers = await invoke('list_ai_members', { kind: null });
            }
          }

          const dbProviders: { id: string }[] = await invoke('list_providers');
          const existingProviderIds = new Set(dbProviders.map(p => p.id));
          const missingProviders = builtinProviders.filter(p => !existingProviderIds.has(p.id));
          if (missingProviders.length > 0) {
            await invoke('seed_builtin_providers', {
              providers: missingProviders.map(mapProviderToRust),
            });
          }

          characters = dbMembers.map((r: any) => {
            let tags: string[] = [];
            if (r.tags) {
              try { tags = JSON.parse(r.tags); } catch {}
            }
            let config: any = {};
            if (r.config) {
              try { config = JSON.parse(r.config); } catch {}
            }
            if (r.kind === 'llm') {
              return {
                id: r.id,
                name: r.name,
                personality: config.schedulerTag || config.personality || '',
                providerId: config.providerId,
                model: config.model || modelConfigs[0].model,
                avatar: r.avatar || '',
                custom_prompt: config.customPrompt || '',
                tags,
                stages: config.stages,
                runtime: 'llm'
              };
            } else if (r.kind === 'cli') {
              return {
                id: r.id,
                name: r.name,
                personality: r.id + '-cli',
                model: modelConfigs[0].model,
                avatar: r.avatar || '',
                custom_prompt: '',
                tags,
                runtime: 'cli',
                cli: config.cli
              };
            } else {
              return {
                id: r.id,
                name: r.name,
                personality: 'agent',
                providerId: config.providerId,
                model: config.model || modelConfigs[0].model,
                avatar: r.avatar || '',
                custom_prompt: config.systemPrompt || '',
                tags
              };
            }
          });
          const scheduler = generateAICharacters('#groupName#', '#allTags#')[0];
          characters.unshift(scheduler);
        } catch (e) {
          console.error('Failed to initialize AI members from Tauri SQLite:', e);
          characters = [...generateAICharacters('#groupName#', '#allTags#'), ...cliAgents];
        }
      } else {
        const localStr = localStorage.getItem('custom_ai_members') || '[]';
        const customMembers = JSON.parse(localStr) as AIMember[];
        const allAIMembers = [...builtinAIMembers, ...customMembers];
        characters = allAIMembers.map((m) => {
          if (m.kind === 'llm') {
            return {
              id: m.id,
              name: m.name,
              personality: m.schedulerTag || '',
              providerId: m.providerId,
              model: m.model,
              avatar: m.avatar || '',
              custom_prompt: m.customPrompt || '',
              tags: m.tags,
              stages: m.stages,
              runtime: 'llm'
            };
          } else if (m.kind === 'cli') {
            return {
              id: m.id,
              name: m.name,
              personality: m.id + '-cli',
              model: modelConfigs[0].model,
              avatar: m.avatar || '',
              custom_prompt: '',
              tags: m.tags,
              runtime: 'cli',
              cli: m.cli
            };
          } else {
            return {
              id: m.id,
              name: m.name,
              personality: 'agent',
              providerId: m.providerId,
              model: m.model,
              avatar: m.avatar || '',
              custom_prompt: m.systemPrompt || '',
              tags: m.tags
            };
          }
        });
        const scheduler = generateAICharacters('#groupName#', '#allTags#')[0];
        characters.unshift(scheduler);
      }

      return mockResponse({
        code: 200,
        data: {
          groups: allGroups,
          characters,
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
        toolSessionId,
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
          let codexSessionId: string | null = null;
          let claudeSessionId: string | null = null;
          let opencodeSessionId: string | null = null;
          let codexCommandGroupOpen = false;
          let codexCommandIndex = 0;
          let claudeCommandGroupOpen = false;
          let claudeCommandIndex = 0;
          let opencodeCommandGroupOpen = false;
          let opencodeCommandIndex = 0;
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
              void stepCount;
              enqueueChunk(`\n</details>\n\n`);
            }
          };

          const ensureCodexCommandGroupOpen = () => {
            if (!codexCommandGroupOpen) {
              codexCommandGroupOpen = true;
              codexCommandIndex = 0;
              enqueueChunk(renderCodexCommandGroupStart());
            }
          };

          const closeCodexCommandGroup = () => {
            if (codexCommandGroupOpen) {
              codexCommandGroupOpen = false;
              enqueueChunk(renderCodexCommandGroupEnd());
            }
          };

          const ensureClaudeCommandGroupOpen = () => {
            if (!claudeCommandGroupOpen) {
              claudeCommandGroupOpen = true;
              claudeCommandIndex = 0;
              enqueueChunk(renderClaudeCommandGroupStart());
            }
          };

          const closeClaudeCommandGroup = () => {
            if (claudeCommandGroupOpen) {
              claudeCommandGroupOpen = false;
              enqueueChunk(renderClaudeCommandGroupEnd());
            }
          };

          const ensureOpenCodeCommandGroupOpen = () => {
            if (!opencodeCommandGroupOpen) {
              opencodeCommandGroupOpen = true;
              opencodeCommandIndex = 0;
              enqueueChunk(renderOpenCodeCommandGroupStart());
            }
          };

          const closeOpenCodeCommandGroup = () => {
            if (opencodeCommandGroupOpen) {
              opencodeCommandGroupOpen = false;
              enqueueChunk(renderOpenCodeCommandGroupEnd());
            }
          };

          unlistenFn = await listen<any>(eventName, (evt) => {
            const payload = evt.payload || {};
            switch (payload.type) {
              case 'started':
                break;
              case 'stdout':
                if (typeof payload.content === 'string' && !authErrorDetected) {
                  const stdoutLine = cleanCliOutputLine(payload.content);
                  if (shouldSuppressCliOutputLine(stdoutLine)) break;

                  if (adapter === 'opencode') {
                    const parsed = parseOpenCodeJsonLine(stdoutLine);
                    if (parsed?.sessionId && parsed.sessionId !== opencodeSessionId) {
                      opencodeSessionId = parsed.sessionId;
                      enqueueEvent({
                        type: 'tool_session',
                        adapter: 'opencode',
                        sessionId: parsed.sessionId,
                      });
                    }
                    if (parsed?.error) {
                      closeOpenCodeCommandGroup();
                      enqueueEvent({
                        type: 'error',
                        content: `\n**[OpenCode error]** ${parsed.error}\n`,
                        error: parsed.error,
                      });
                    } else if (parsed?.command) {
                      ensureOpenCodeCommandGroupOpen();
                      opencodeCommandIndex++;
                      enqueueChunk(renderOpenCodeCommand(parsed.command, opencodeCommandIndex));
                    } else if (parsed?.content) {
                      closeOpenCodeCommandGroup();
                      enqueueChunk(parsed.content);
                    } else if (!stdoutLine.startsWith('{')) {
                      closeOpenCodeCommandGroup();
                      enqueueChunk(stdoutLine + '\n');
                    }
                    break;
                  }

                  if (adapter === 'claude') {
                    const parsed = parseClaudeJsonLine(stdoutLine);
                    if (parsed?.sessionId && parsed.sessionId !== claudeSessionId) {
                      claudeSessionId = parsed.sessionId;
                      enqueueEvent({
                        type: 'tool_session',
                        adapter: 'claude',
                        sessionId: parsed.sessionId,
                      });
                    }
                    if (parsed?.error) {
                      closeClaudeCommandGroup();
                      enqueueEvent({
                        type: 'error',
                        content: `\n**[Claude Code error]** ${parsed.error}\n`,
                        error: parsed.error,
                      });
                    }
                    if (parsed?.content) {
                      closeClaudeCommandGroup();
                      enqueueChunk(parsed.content);
                    }
                    if (parsed?.command) {
                      if (parsed.command.phase === 'started') {
                        ensureClaudeCommandGroupOpen();
                        claudeCommandIndex++;
                        enqueueChunk(renderClaudeCommandStarted(parsed.command.command, claudeCommandIndex));
                      } else if (claudeCommandGroupOpen) {
                        enqueueChunk(renderClaudeCommandCompleted(parsed.command.output));
                      }
                    } else if (!parsed && !stdoutLine.startsWith('{')) {
                      closeClaudeCommandGroup();
                      enqueueChunk(stdoutLine + '\n');
                    }
                    break;
                  }

                  // Codex --json mode: parse structured events, stream everything
                  if (isJsonMode && stdoutLine.startsWith('{') && stdoutLine.includes('"type"')) {
                    try {
                      const parsed = parseCodexJsonLine(stdoutLine);
                      if (parsed?.sessionId && parsed.sessionId !== codexSessionId) {
                        codexSessionId = parsed.sessionId;
                        enqueueEvent({
                          type: 'tool_session',
                          adapter: 'codex',
                          sessionId: parsed.sessionId,
                        });
                      }
                      if (parsed?.error) {
                        closeCodexCommandGroup();
                        enqueueEvent({
                          type: 'error',
                          content: `\n**[Codex error]** ${parsed.error}\n`,
                          error: parsed.error,
                        });
                      } else if (parsed?.command) {
                        ensureCodexCommandGroupOpen();
                        if (parsed.command.phase === 'started') {
                          codexCommandIndex++;
                          enqueueChunk(renderCodexCommandStarted(parsed.command.command, codexCommandIndex));
                        } else {
                          enqueueChunk(renderCodexCommandCompleted(parsed.command.exitCode, parsed.command.output));
                        }
                      } else if (parsed?.content) {
                        closeCodexCommandGroup();
                        enqueueChunk(parsed.content);
                      }
                    } catch {
                      closeCodexCommandGroup();
                      // Not valid JSON, show as-is
                      enqueueChunk(stdoutLine + '\n');
                    }
                  } else {
                    closeCodexCommandGroup();
                    closeClaudeCommandGroup();
                    closeOpenCodeCommandGroup();
                    // Non-JSON stdout (opencode, claude, etc.) — show as-is
                    enqueueChunk(stdoutLine + '\n');
                  }
                }
                break;
              case 'stderr':
                if (!showStderr || typeof payload.content !== 'string') break;
                // Once auth error is detected, suppress ALL further output
                if (authErrorDetected) break;
                const line = cleanCliOutputLine(payload.content);
                if (shouldSuppressCliOutputLine(line)) break;
                // Filter out noise lines that add no value
                if (/^(Reading additional input|WARNING:|^\s*$)/.test(line)) break;
                // Detect auth/token errors — show ONE friendly message then mute
                if (/401|token.?invalid|unauthorized|session.?ended|auth.?error|app_session_terminated|please.*(log\s*in|sign\s*in)/i.test(line)) {
                  authErrorDetected = true;
                  closeOpenCodeCommandGroup();
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
                  if (codexCommandGroupOpen) {
                    enqueueChunk(`> 📝 _${line.trim().replace(/_/g, '\\_')}_\n\n`);
                  } else {
                    ensureDetailsOpen();
                    enqueueChunk(`> 📝 _${line.trim().replace(/_/g, '\\_')}_\n\n`);
                  }
                } else {
                  closeOpenCodeCommandGroup();
                  enqueueChunk('> _' + line.replace(/_/g, '\\_') + '_\n');
                }
                break;
              case 'error':
                if (typeof payload.message === 'string') {
                  closeCodexCommandGroup();
                  closeClaudeCommandGroup();
                  closeOpenCodeCommandGroup();
                  enqueueEvent({
                    type: 'error',
                    content: `\n**[CLI error]** ${payload.message}\n`,
                    error: payload.message,
                  });
                }
                break;
              case 'done': {
                if (adapter === 'opencode' && opencodeSessionId) {
                  enqueueEvent({
                    type: 'tool_session',
                    adapter: 'opencode',
                    sessionId: opencodeSessionId,
                  });
                }
                const code = typeof payload.exit_code === 'number' ? payload.exit_code : -1;
                closeCodexCommandGroup();
                closeClaudeCommandGroup();
                closeOpenCodeCommandGroup();
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
                toolSessionId: toolSessionId || null,
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
      const body = JSON.parse((options.body as string) || '{}');
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

    // 9.6 CLI worktree prepare (race strategy isolation)
    if (cleanUrl === '/api/cli/worktree/prepare') {
      const body = JSON.parse(options.body as string);
      const { groupId, cwd, agentIds } = body || {};
      if (!groupId || !cwd || !Array.isArray(agentIds) || agentIds.length === 0) {
        return mockResponse(
          { success: false, message: '/api/cli/worktree/prepare requires { groupId, cwd, agentIds[] }' },
          400,
        );
      }
      try {
        const result = await invoke('cli_worktree_prepare', {
          args: { groupId, cwd, agentIds },
        });
        return mockResponse({ success: true, data: result });
      } catch (e: any) {
        return mockResponse(
          { success: false, message: typeof e === 'string' ? e : (e?.message || 'worktree prepare failed') },
          400,
        );
      }
    }

    // 9.7 CLI worktree cleanup
    if (cleanUrl === '/api/cli/worktree/cleanup') {
      const body = JSON.parse(options.body as string);
      const paths = Array.isArray(body?.paths) ? body.paths : [];
      try {
        await invoke('cli_worktree_cleanup', { args: { paths } });
        return mockResponse({ success: true });
      } catch (e: any) {
        return mockResponse(
          { success: false, message: typeof e === 'string' ? e : (e?.message || 'worktree cleanup failed') },
          400,
        );
      }
    }

    // 9.7b CLI git diff (race worktree vs base commit)
    if (cleanUrl === '/api/cli/git/diff') {
      const body = JSON.parse(options.body as string);
      const { cwd, baseSha } = body || {};
      if (!cwd || !baseSha) {
        return mockResponse(
          { success: false, message: '/api/cli/git/diff requires { cwd, baseSha }' },
          400,
        );
      }
      try {
        const result = await invoke('cli_git_diff', {
          args: { cwd, baseSha },
        });
        return mockResponse({ success: true, data: result });
      } catch (e: any) {
        return mockResponse(
          { success: false, message: typeof e === 'string' ? e : (e?.message || 'git diff failed') },
          400,
        );
      }
    }

    // 9.8 CLI temp copy prepare (discussion read-only isolation)
    if (cleanUrl === '/api/cli/tempcopy/prepare') {
      const body = JSON.parse(options.body as string);
      const { groupId, cwd, agentIds } = body || {};
      if (!groupId || !cwd || !Array.isArray(agentIds) || agentIds.length === 0) {
        return mockResponse(
          { success: false, message: '/api/cli/tempcopy/prepare requires { groupId, cwd, agentIds[] }' },
          400,
        );
      }
      try {
        const result = await invoke('cli_tempcopy_prepare', {
          args: { groupId, cwd, agentIds },
        });
        return mockResponse({ success: true, data: result });
      } catch (e: any) {
        return mockResponse(
          { success: false, message: typeof e === 'string' ? e : (e?.message || 'tempcopy prepare failed') },
          400,
        );
      }
    }

    // 9.9 CLI temp copy cleanup
    if (cleanUrl === '/api/cli/tempcopy/cleanup') {
      const body = JSON.parse(options.body as string);
      const paths = Array.isArray(body?.paths) ? body.paths : [];
      try {
        await invoke('cli_tempcopy_cleanup', { args: { paths } });
        return mockResponse({ success: true });
      } catch (e: any) {
        return mockResponse(
          { success: false, message: typeof e === 'string' ? e : (e?.message || 'tempcopy cleanup failed') },
          400,
        );
      }
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

    // 10b. OpenCode session title — used to auto-name tasks when OpenCode speaks first.
    if (cleanUrl === '/api/cli/opencode/session-title') {
      const body = JSON.parse(options.body as string);
      const sessionId = body?.sessionId;
      if (!sessionId || typeof sessionId !== 'string') {
        return mockResponse({ success: false, message: 'sessionId required' }, 400);
      }
      try {
        const result = await invoke('cli_opencode_session_title', {
          sessionId,
          binary: body?.binary,
        });
        return mockResponse({ success: true, data: result });
      } catch (e: unknown) {
        return mockResponse(
          { success: false, message: typeof e === 'string' ? e : (e as Error)?.message || 'fetch title failed' },
          400,
        );
      }
    }



    // 11. Chat API (Direct LLM streaming from client side)
    if (cleanUrl === '/api/chat') {
      const body = JSON.parse(options.body as string);
      const { message, custom_prompt, history, aiName, index, model = "qwen-plus", providerId } = body;

      const creds = await resolveLlmCredentials(model, providerId);

      // Build message payload
      const systemPrompt = `${custom_prompt}\n 注意重要：1、你在群里叫${aiName}认准自己的身份； 2、你的输出内容不要加${aiName}：这种多余前缀；3、如果用户提出玩游戏，比如成语接龙等，严格按照游戏规则，不要说一大堆，要简短精炼; 4、保持群聊风格字数严格控制在50字以内，越简短越好（新闻总结类除外）`;

      const baseMessages = [
        { role: 'system', content: systemPrompt },
        ...history.slice(-10).map((h: { role: string; content: string }) => ({
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

      const readable = await llmChatReadableStream({
        ...creds,
        messages: baseMessages,
        emitDoneMarker: false,
      });

      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        }
      });
    }

    // 12. Agent Chat API (Stream proxy for custom agents)
    if (cleanUrl === '/api/agent/chat') {
      const body = JSON.parse(options.body as string);
      const creds = await resolveLlmCredentials(body.model, body.providerId);

      const readable = await llmChatReadableStream({
        ...creds,
        messages: body.messages,
        temperature: body.temperature,
        tools: body.tools && body.tools.length > 0 ? body.tools : undefined,
        emitDoneMarker: true,
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
