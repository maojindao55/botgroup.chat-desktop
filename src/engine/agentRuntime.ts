/**
 * Single-Agent Runtime
 *
 * Extracted from the legacy agentEngine.ts. Provides the primitive
 * "run one member once" capability that the workflow runner composes
 * into phases. This module knows nothing about workflow phases; the
 * runner injects phaseId / agentIdOverride into callbacks so the UI
 * can group output back to its phase bubble.
 */
import type { AgentGroup, AgentMember } from '@/config/groups';
import { lookupProviderByEnvName } from '@/config/providers';
import { te } from '@/i18n/translate';
import { request } from '@/utils/request';
import { useAIMemberStore } from '@/store/aiMemberStore';
import type { CLIAgent } from '@/config/aiCharacters';
import { mapAIMemberToLegacy } from '@/config/aiCharacters';
import { callCLIAgent as callCLIAgentRaw } from './cliEngine';
import type { CLIStreamCallback, CLIAgentMeta, CLIRunOptions } from './cliEngine';
import { withCliToolSession } from './cliToolSessions';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface AgentRunResult {
  agentId: string;
  agentName: string;
  content: string;
  isError?: boolean;
  toolCalls?: { name: string; result: string }[];
}

export interface AgentRuntimeCallback {
  onAgentStart: (agentId: string, agentName: string, meta?: { agentTaskId?: string; adapter?: string; phaseId?: string }) => void;
  onToken: (agentId: string, token: string, meta?: { phaseId?: string }) => void;
  onAgentEnd: (agentId: string, fullContent: string, meta?: { phaseId?: string }) => void;
  onError: (agentId: string, error: string, meta?: { phaseId?: string }) => void;
  onToolSession?: (agentId: string, adapter: string, sessionId: string) => void;
}

export interface AgentGroupContext {
  groupId: string;
  workspacePath?: string;
  timeout?: number;
  approvalMode?: 'auto' | 'ask';
  showStderr?: boolean;
  toolSessionLookup?: (agentId: string) => string | null | undefined;
  locale?: string;
}

export function isCLIMember(agent: AgentMember | any): boolean {
  if (!agent) return false;
  return agent.kind === 'cli' || agent.runtime === 'cli' || !!agent.cli;
}

export function hasCLIWorkspace(groupContext?: AgentGroupContext): boolean {
  return !!groupContext?.workspacePath?.trim();
}

export function normalizeAgentMember(agent: any): AgentMember {
  if (agent.providerId && agent.model) return agent as AgentMember;
  const llm = agent.llm;
  return {
    ...agent,
    providerId: agent.providerId || lookupProviderByEnvName(llm?.apiKey || 'DEEPSEEK_API_KEY'),
    model: agent.model || llm?.model || 'deepseek-chat',
  };
}

export function getGroupAgents(group: AgentGroup): AgentMember[] {
  const membersState = useAIMemberStore.getState().members;
  return (group.memberIds || [])
    .map(id => membersState[id])
    .filter(m => m && (m.kind === 'cli' || m.kind === 'agent'))
    .map(normalizeAgentMember);
}

/**
 * Call a single agent's LLM with streaming, via /api/agent/chat proxy.
 */
export async function callAgentLLM(
  agent: AgentMember,
  messages: AgentMessage[],
  onToken?: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  const response = await request('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      providerId: agent.providerId,
      model: agent.model,
      temperature: agent.temperature,
      messages,
      tools: (agent.tools || []).filter(t => t.enabled).map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: { type: 'object', properties: {} },
        },
      })),
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(te('errors.agentLlmRequestFailed', { status: response.status }));
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error(te('errors.streamUnavailable'));

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const data = JSON.parse(dataStr);
            const token = data.choices?.[0]?.delta?.content || data.content || '';
            if (token) {
              fullContent += token;
              onToken?.(token);
            }
          } catch { /* skip parse errors */ }
        }
      }
    }
  } finally {
    try { reader.cancel(); } catch { /* ignore */ }
  }

  return fullContent;
}

export interface RunSingleAgentOptions {
  signal?: AbortSignal;
  phaseId?: string;
  agentIdOverride?: string;
}

/**
 * Run a single agent. CLI members dispatch to cliEngine; LLM members
 * call the streaming chat endpoint. Errors are caught and returned as
 * isError results unless they are AbortError (re-thrown).
 */
export async function runSingleAgent(
  agent: AgentMember,
  userMessage: string,
  context: string,
  callbacks: AgentRuntimeCallback,
  groupContext: AgentGroupContext,
  options: RunSingleAgentOptions = {},
): Promise<AgentRunResult> {
  const effectiveId = options.agentIdOverride || agent.id;
  const phaseId = options.phaseId;
  const signal = options.signal;

  if (isCLIMember(agent)) {
    if (!hasCLIWorkspace(groupContext)) {
      throw new Error(`CLI member "${agent.name}" requires a workspace path.`);
    }
    return runSingleCLIAgent(
      agent, userMessage, context, callbacks, groupContext,
      { signal, phaseId, agentIdOverride: effectiveId },
    );
  }

  callbacks.onAgentStart(effectiveId, agent.name, { phaseId });

  const messages: AgentMessage[] = [
    { role: 'system', content: `${agent.systemPrompt || `You are ${agent.name}, ${agent.role}.`}\n\n${buildLanguageHint(groupContext.locale)}` },
  ];

  if (context) {
    messages.push({ role: 'user', content: `[Context]\n${context}` });
    messages.push({ role: 'assistant', content: 'Acknowledged.' });
  }

  messages.push({ role: 'user', content: userMessage });

  let fullContent = '';

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const response = await callAgentLLM(agent, messages, (token) => {
      callbacks.onToken(effectiveId, token, { phaseId });
    }, signal);

    fullContent += response;
    callbacks.onAgentEnd(effectiveId, fullContent, { phaseId });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      callbacks.onAgentEnd(effectiveId, fullContent || te('errors.aborted'), { phaseId });
      throw error;
    }
    const errMsg = error?.message || te('errors.unknownError');
    fullContent = te('errors.agentExecutionError', { message: errMsg });
    callbacks.onError(effectiveId, errMsg, { phaseId });
    return {
      agentId: effectiveId,
      agentName: agent.name,
      content: fullContent,
      isError: true,
    };
  }

  return {
    agentId: effectiveId,
    agentName: agent.name,
    content: fullContent,
  };
}

function buildLanguageHint(locale?: string): string {
  if (locale?.toLowerCase().startsWith('zh')) {
    return '请使用简体中文回复，保持 Markdown 格式（标题、列表、代码块、表格）。';
  }
  return 'Reply in English, using Markdown (headings, lists, code blocks, tables).';
}

function buildCliHint(locale?: string): string {
  const lang = buildLanguageHint(locale);
  return `[System] You are in a multi-agent collaborative chat. ${lang} Generated images can be returned as local absolute paths (e.g. /Users/xxx/output.png) and will render inline.\n\n`;
}

/**
 * Run a single CLI agent via cliEngine.callCLIAgent.
 * Bridges CLIStreamCallback -> AgentRuntimeCallback.
 */
export async function runSingleCLIAgent(
  agent: AgentMember,
  userMessage: string,
  context: string,
  callbacks: AgentRuntimeCallback,
  groupContext: AgentGroupContext,
  options: RunSingleAgentOptions = {},
): Promise<AgentRunResult> {
  const agentId = options.agentIdOverride || agent.id;
  const phaseId = options.phaseId;
  const signal = options.signal;
  const cwd = groupContext.workspacePath || '';

  const baseCliAgent: CLIAgent = (agent as any).cli
    ? agent as any
    : mapAIMemberToLegacy(agent as any) as CLIAgent;

  const priorSession = groupContext.toolSessionLookup?.(agent.id);
  const cliAgent: CLIAgent = priorSession
    ? withCliToolSession(baseCliAgent, priorSession)
    : baseCliAgent;
  const cliHint = buildCliHint(groupContext.locale);
  const prompt = context
    ? cliHint + '[Context]\n' + context + '\n\n[User]\n' + userMessage
    : cliHint + userMessage;

  const cliCallbacks: CLIStreamCallback = {
    onAgentStart: (taskId, _agentId, agentName, _meta) => {
      callbacks.onAgentStart(agentId, agentName, {
        agentTaskId: taskId,
        adapter: cliAgent.cli?.adapter,
        phaseId,
      });
    },
    onToken: (_taskId, token) => {
      callbacks.onToken(agentId, token, { phaseId });
    },
    onAgentEnd: (_taskId, fullContent) => {
      callbacks.onAgentEnd(agentId, fullContent, { phaseId });
    },
    onError: (_taskId, error) => {
      callbacks.onError(agentId, error, { phaseId });
    },
    onToolSession: (_taskId, _agentId, adapter, sessionId) => {
      callbacks.onToolSession?.(agent.id, adapter, sessionId);
    },
  };

  const cliOptions: CLIRunOptions = {
    timeoutMs: groupContext.timeout ?? 300000,
    approvalMode: groupContext.approvalMode ?? 'auto',
    showStderr: groupContext.showStderr ?? true,
    signal,
  };

  const ctx = {
    agent: cliAgent,
    cwd,
    isolation: 'sameWorkspace' as const,
  };

  const meta: CLIAgentMeta = {};

  try {
    const result = await callCLIAgentRaw(
      groupContext.groupId || 'agent-group',
      ctx,
      prompt,
      cliOptions,
      cliCallbacks,
      meta,
    );

    return {
      agentId,
      agentName: agent.name,
      content: result.content,
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    const errMsg = error?.message || te('errors.unknownError');
    callbacks.onError(agentId, errMsg, { phaseId });
    return {
      agentId,
      agentName: agent.name,
      content: te('errors.agentExecutionError', { message: errMsg }),
      isError: true,
    };
  }
}
