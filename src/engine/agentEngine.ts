/**
 * Agent 策略引擎
 * 实现 Agent 群的八种执行策略：
 *   sequential / router / discussion / react
 *   pipeline / debate / mapreduce / supervisor
 * 每个 Agent 独立配置 LLM API，支持工具调用循环
 */
import type { AgentGroup, AgentMember } from '@/config/groups';
import { lookupProviderByEnvName } from '@/config/providers';
import { translateEngineRole } from '@/i18n/engineLabels';
import { te } from '@/i18n/translate';
import { request } from '@/utils/request';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { Blackboard } from './blackboard';
import type { CLIAgent } from '@/config/aiCharacters';
import { mapAIMemberToLegacy } from '@/config/aiCharacters';
import { callCLIAgent as callCLIAgentRaw } from './cliEngine';
import type { CLIStreamCallback, CLIAgentMeta, CLIRunOptions } from './cliEngine';
import { withCliToolSession } from './cliToolSessions';

/** GroupContext: CLI 成员执行所需的群上下文 */
interface AgentGroupContext {
  groupId: string;
  workspacePath?: string;
  timeout?: number;
  approvalMode?: 'auto' | 'ask';
  showStderr?: boolean;
  /** 读取该 CLI agent 上一次的 tool session id（与 CLITaskUI 行为一致） */
  toolSessionLookup?: (agentId: string) => string | null | undefined;
  /** CLI agent 启动新 tool session 时回写（adapter 用于判断是否需要持久化） */
  onToolSession?: (agentId: string, adapter: string, sessionId: string) => void;
}

/** 系统保留的伪 Agent ID 前缀，避免与用户自建 Agent ID 冲突 */
const SYSTEM_AGENT_PREFIX = '__sys_';

function isCLIMember(agent: AgentMember): boolean {
  const candidate = agent as any;
  return candidate.kind === 'cli' || candidate.runtime === 'cli' || !!candidate.cli;
}

function isLLMCoordinatorCandidate(agent: AgentMember): boolean {
  return !isCLIMember(agent) && !!agent.providerId && !!agent.model && Array.isArray(agent.tools);
}

function getLLMCoordinator(agents: AgentMember[]): AgentMember | undefined {
  return agents.find(isLLMCoordinatorCandidate);
}

function hasCLIWorkspace(groupContext?: AgentGroupContext): boolean {
  return !!groupContext?.workspacePath?.trim();
}

function getAgentRole(agent: AgentMember): string {
  return agent.role || (isCLIMember(agent) ? 'CLI 开发成员' : '专家');
}

function assertCLIWorkspaceConfigured(
  agents: AgentMember[],
  mutedUsers: string[],
  groupContext: AgentGroupContext,
): void {
  const activeCli = agents.find(agent => !mutedUsers.includes(agent.id) && isCLIMember(agent));
  if (!activeCli || hasCLIWorkspace(groupContext)) return;
  throw new Error(`Agent 群包含 CLI 成员「${activeCli.name}」，请先配置工作目录。`);
}

function emitSyntheticResult(
  callbacks: StreamCallback,
  result: AgentRunResult,
): AgentRunResult {
  callbacks.onAgentStart(result.agentId, result.agentName);
  callbacks.onToken(result.agentId, result.content);
  callbacks.onAgentEnd(result.agentId, result.content);
  return result;
}

export function getGroupAgents(group: AgentGroup): AgentMember[] {
  const membersState = useAIMemberStore.getState().members;
  const dbAgents = (group.memberIds || [])
    .map(id => membersState[id])
    .filter(m => m && (m.kind === 'cli' || m.kind === 'agent'))
    .map(normalizeAgentMember);
  
  if (dbAgents.length > 0) {
    return dbAgents;
  }
  return (group.agents || []).map(normalizeAgentMember);
}

function normalizeAgentMember(agent: any): AgentMember {
  if (agent.providerId && agent.model) {
    return agent as AgentMember;
  }
  const llm = agent.llm;
  return {
    ...agent,
    providerId: agent.providerId || lookupProviderByEnvName(llm?.apiKey || 'DEEPSEEK_API_KEY'),
    model: agent.model || llm?.model || 'deepseek-chat',
  };
}

/** 从 LLM 回复中提取 JSON 对象，支持 markdown code fence 包裹 */
function extractJSON(text: string): any | null {
  // 先尝试去掉 ```json ... ``` 包裹
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const cleaned = fenceMatch ? fenceMatch[1].trim() : text;
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ============ 类型定义 ============

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
  toolCalls?: { name: string; result: string }[];
}

export interface StreamCallback {
  onAgentStart: (agentId: string, agentName: string, meta?: { agentTaskId?: string; adapter?: string }) => void;
  onToken: (agentId: string, token: string) => void;
  onAgentEnd: (agentId: string, fullContent: string) => void;
  onError: (agentId: string, error: string) => void;
  /** 路由 fallback 等非致命信息通知 */
  onInfo?: (message: string) => void;
  /** CLI agent 启动 tool session（远端 SDK 会话）时上报 */
  onToolSession?: (agentId: string, adapter: string, sessionId: string) => void;
}

/** 引擎执行选项 */
export interface AgentEngineOptions {
  /** 外部传入的 AbortSignal，用于取消正在进行的请求 */
  signal?: AbortSignal;
  /** 读取该 CLI agent 上一次的 tool session id（透传给 groupContext） */
  toolSessionLookup?: (agentId: string) => string | null | undefined;
}

// ============ 单个 Agent 执行 ============


/**
 * 调用单个 Agent 的 LLM，支持流式返回
 * 通过服务端代理 /api/agent/chat 转发请求（避免前端暴露 API Key）
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


/**
 * 执行单个 Agent（支持 CLI 成员 + 兼容旧 LLM Agent）
 * 如果成员是 CLI 类型，通过 callCLIAgent 执行本地 CLI 进程
 * 否则回退到旧的 LLM 调用（兼容老数据）
 * @param agentIdOverride - 可选的自定义 agentId，用于多轮策略中区分同一 Agent 在不同轮次的消息
 */
async function runSingleAgent(
  agent: AgentMember,
  userMessage: string,
  context: string,
  callbacks: StreamCallback,
  signal?: AbortSignal,
  agentIdOverride?: string,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult> {
  const effectiveId = agentIdOverride || agent.id;

  // 检查是否为 CLI 成员
  const isCLI = isCLIMember(agent);
  if (isCLI) {
    if (!hasCLIWorkspace(groupContext)) {
      throw new Error(`CLI 成员「${agent.name}」需要先配置工作目录。`);
    }
    return runSingleCLIAgent(
      agent, userMessage, context, callbacks, signal, effectiveId, groupContext,
    );
  }

  // 兼容旧的 LLM Agent 调用
  callbacks.onAgentStart(effectiveId, agent.name);

  const messages: AgentMessage[] = [
    { role: 'system', content: agent.systemPrompt || `你是${agent.name}，${agent.role}。` },
  ];

  // 添加上下文
  if (context) {
    messages.push({ role: 'user', content: `[上下文信息]\n${context}` });
    messages.push({ role: 'assistant', content: '好的，我已了解上下文。' });
  }

  messages.push({ role: 'user', content: userMessage });

  let fullContent = '';

  try {
    const enabledTools = (agent.tools || []).filter(t => t.enabled);
    const maxTurns = enabledTools.length > 0 ? (agent.maxTurns || 5) : 1;
    let turn = 0;

    while (turn < maxTurns) {
      turn++;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const response = await callAgentLLM(agent, messages, (token) => {
        callbacks.onToken(effectiveId, token);
      }, signal);

      fullContent += response;
      break;
    }

    callbacks.onAgentEnd(effectiveId, fullContent);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      callbacks.onAgentEnd(effectiveId, fullContent || te('errors.aborted'));
      throw error;
    }
    const errMsg = error?.message || te('errors.unknownError');
    fullContent = te('errors.agentExecutionError', { message: errMsg });
    callbacks.onError(effectiveId, errMsg);
  }

  return {
    agentId: effectiveId,
    agentName: agent.name,
    content: fullContent,
  };
}

/**
 * 通过 CLI Agent 执行（复用 cliEngine 的 callCLIAgent）
 */
async function runSingleCLIAgent(
  agent: AgentMember,
  userMessage: string,
  context: string,
  callbacks: StreamCallback,
  signal?: AbortSignal,
  effectiveId?: string,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult> {
  const agentId = effectiveId || agent.id;
  const cwd = groupContext?.workspacePath || '';

  // 将 AIMember 转换为 CLIAgent
  const baseCliAgent: CLIAgent = (agent as any).cli
    ? agent as any
    : mapAIMemberToLegacy(agent as any) as CLIAgent;

  // 注入上次的 tool session（与 CLITaskUI 行为一致：每个 CLI agent 独立续接）
  const priorSession = groupContext?.toolSessionLookup?.(agent.id);
  const cliAgent: CLIAgent = priorSession
    ? withCliToolSession(baseCliAgent, priorSession)
    : baseCliAgent;

  // 构造 prompt：包含上下文 + 用户消息
  const cliHint = '[系统提示] 你正在参与多人协作群聊，请用 Markdown 格式回复（标题、列表、代码块、表格等），回复会直接渲染为富文本。生成的图片可直接输出本地绝对路径（如 /Users/xxx/output.png），会自动渲染为内嵌图片。\n\n';
  const prompt = context
    ? `${cliHint}[上下文信息]\n${context}\n\n[用户消息]\n${userMessage}`
    : `${cliHint}${userMessage}`;

  // 桥接 StreamCallback → CLIStreamCallback
  const cliCallbacks: CLIStreamCallback = {
    onAgentStart: (taskId, _agentId, agentName, _meta) => {
      callbacks.onAgentStart(agentId, agentName, {
        agentTaskId: taskId,
        adapter: cliAgent.cli?.adapter,
      });
    },
    onToken: (_taskId, token) => {
      callbacks.onToken(agentId, token);
    },
    onAgentEnd: (_taskId, fullContent) => {
      callbacks.onAgentEnd(agentId, fullContent);
    },
    onError: (_taskId, error) => {
      callbacks.onError(agentId, error);
    },
    onToolSession: (_taskId, _agentId, adapter, sessionId) => {
      callbacks.onToolSession?.(agent.id, adapter, sessionId);
    },
  };

  const cliOptions: CLIRunOptions = {
    timeoutMs: groupContext?.timeout ?? 300000,
    approvalMode: groupContext?.approvalMode ?? 'auto',
    showStderr: groupContext?.showStderr ?? true,
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
      groupContext?.groupId || 'agent-group',
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
    callbacks.onError(agentId, errMsg);
    return {
      agentId,
      agentName: agent.name,
      content: te('errors.agentExecutionError', { message: errMsg }),
    };
  }
}


// ============ 策略实现 ============

/**
 * 顺序执行策略：Agent 按顺序依次执行，后者看到前者的输出
 */
async function runSequential(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = [];
  let accumulatedContext = history;

  for (const agent of getGroupAgents(group)) {
    if (mutedUsers.includes(agent.id)) continue;
    if (signal?.aborted) break;

    const result = await runSingleAgent(agent, userMessage, accumulatedContext, callbacks, signal, undefined, groupContext);
    results.push(result);

    // 后续 Agent 能看到前面的输出
    accumulatedContext += `\n${agent.name}: ${result.content}`;

    // 间隔
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}

/**
 * 意图路由策略：用第一个 Agent 或 coordinatorPrompt 分析意图，选择相关 Agent
 */
async function runRouter(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  // 用协调者 Prompt + 第一个可用 Agent 的 LLM 来做路由决策
  const routerAgent = getLLMCoordinator(activeAgents);
  const agentList = activeAgents.map(a => `- ${a.id}: ${a.name} (${getAgentRole(a)})`).join('\n');

  const routerPrompt = group.coordinatorPrompt ||
    `你是一个智能路由器。根据用户消息，从以下 Agent 列表中选择最合适的 1-2 个来回答。
只返回选中的 Agent ID，用逗号分隔，不要有其他内容。

可选 Agent：
${agentList}`;

  const routerMessages: AgentMessage[] = [
    { role: 'system', content: routerPrompt },
    { role: 'user', content: userMessage },
  ];

  let selectedIds: string[] = [];
  let routerFailed = false;
  try {
    if (routerAgent) {
      const routerResponse = await callAgentLLM(
        { ...routerAgent, systemPrompt: routerPrompt, temperature: 0.1 },
        routerMessages,
        undefined,
        signal,
      );
      // 解析路由结果
      selectedIds = routerResponse
        .split(/[,，\s]+/)
        .map(s => s.trim())
        .filter(id => activeAgents.some(a => a.id === id));
    } else {
      selectedIds = activeAgents.map(a => a.id);
      routerFailed = true;
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // 路由失败，fallback 到全员
    selectedIds = activeAgents.map(a => a.id);
    routerFailed = true;
  }

  // 如果没匹配到，fallback 第一个
  if (selectedIds.length === 0) {
    selectedIds = [activeAgents[0].id];
    routerFailed = true;
  }

  // 通知用户路由 fallback
  if (routerFailed) {
    callbacks.onInfo?.(`路由决策失败，已回退为由 ${selectedIds.length} 位专家群友回答。`);
  }

  // 按选中的 Agent 顺序执行
  const results: AgentRunResult[] = [];
  let accumulatedContext = history;

  for (const id of selectedIds) {
    if (signal?.aborted) break;
    const agent = activeAgents.find(a => a.id === id);
    if (!agent) continue;

    const result = await runSingleAgent(agent, userMessage, accumulatedContext, callbacks, signal, undefined, groupContext);
    results.push(result);
    accumulatedContext += `\n${agent.name}: ${result.content}`;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}


/**
 * 全员讨论策略：所有 Agent 并行回复同一消息（使用 allSettled 容错）
 */
async function runDiscussion(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  const settled = await Promise.allSettled(
    activeAgents.map(agent =>
      runSingleAgent(agent, userMessage, history, callbacks, signal, undefined, groupContext)
    )
  );
  // 收集成功的结果，失败的已通过 onError 回调通知
  return settled
    .filter((r): r is PromiseFulfilledResult<AgentRunResult> => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * ReAct 策略：协调者分析→分派→执行→判断是否完成→循环
 */
async function runReAct(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const results: AgentRunResult[] = [];
  const coordinatorAgent = getLLMCoordinator(activeAgents);
  const maxRounds = group.maxRounds || 3;
  let round = 0;
  let accumulatedContext = history;

  const agentList = activeAgents.map(a => `- ${a.id}: ${a.name} (${getAgentRole(a)})`).join('\n');

  if (!coordinatorAgent) {
    callbacks.onInfo?.('当前自动处理策略没有可用 LLM 协调者，已回退为按成员顺序执行。');
    return runSequential(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
  }

  while (round < maxRounds) {
    round++;
    if (signal?.aborted) break;

    // 协调者决策
    const coordPrompt = group.coordinatorPrompt ||
      `你是一个任务协调者。分析用户需求和已有结果，决定下一步行动。

可用 Agent：
${agentList}

已有结果：
${accumulatedContext}

请用以下 JSON 格式回复（不要有其他内容）：
{"action": "delegate", "agentId": "xxx", "task": "具体任务描述"}
或者如果任务已完成：
{"action": "done", "summary": "最终总结"}`;

    const coordMessages: AgentMessage[] = [
      { role: 'system', content: coordPrompt },
      { role: 'user', content: userMessage },
    ];

    let decision: any = null;
    try {
      const response = await callAgentLLM(
        { ...coordinatorAgent, systemPrompt: coordPrompt, temperature: 0.1 },
        coordMessages,
        undefined,
        signal,
      );
      decision = extractJSON(response);
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      break;
    }

    if (!decision || decision.action === 'done') {
      // 任务完成，输出总结
      if (decision?.summary) {
        const coordinatorName = translateEngineRole('coordinator');
        const sysId = `${SYSTEM_AGENT_PREFIX}coordinator_r${round}`;
        const summaryResult: AgentRunResult = {
          agentId: sysId,
          agentName: coordinatorName,
          content: decision.summary,
        };
        callbacks.onAgentStart(sysId, coordinatorName);
        callbacks.onToken(sysId, decision.summary);
        callbacks.onAgentEnd(sysId, decision.summary);
        results.push(summaryResult);
      }
      break;
    }

    if (decision.action === 'delegate') {
      const targetAgent = activeAgents.find(a => a.id === decision.agentId);
      if (targetAgent) {
        const task = decision.task || userMessage;
        const result = await runSingleAgent(targetAgent, task, accumulatedContext, callbacks, signal, `${targetAgent.id}_r${round}`, groupContext);
        results.push(result);
        accumulatedContext += `\n${targetAgent.name}: ${result.content}`;
      }
    }
  }

  return results;
}


/**
 * 流水线策略：按角色分工，每个 Agent 的输出作为下一个 Agent 的结构化输入
 * 区别于 sequential：每个 Agent 收到包含原始需求 + 上一阶段产出的结构化提示
 */
async function runPipeline(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const results: AgentRunResult[] = [];
  // 流水线输入：第一个 Agent 直接收到用户消息，后续 Agent 收到结构化提示
  let stageInput = '';

  for (let i = 0; i < activeAgents.length; i++) {
    if (signal?.aborted) break;
    const agent = activeAgents[i];
    const stageNumber = i + 1;
    const totalStages = activeAgents.length;

    // 构造结构化流水线提示
    let pipelinePrompt: string;
    if (i === 0) {
      // 第一阶段：直接处理原始需求
      pipelinePrompt = `[流水线 Stage ${stageNumber}/${totalStages}]
你是流水线的第 ${stageNumber} 个环节，角色：${agent.role}。

原始需求：
${userMessage}`;
    } else {
      // 后续阶段：收到原始需求 + 上一阶段产出
      pipelinePrompt = `[流水线 Stage ${stageNumber}/${totalStages}]
你是流水线的第 ${stageNumber} 个环节，角色：${agent.role}。

原始需求：
${userMessage}

上一阶段（${activeAgents[i - 1].name}）的产出：
${stageInput}`;
    }

    const result = await runSingleAgent(agent, pipelinePrompt, history, callbacks, signal, undefined, groupContext);
    results.push(result);

    // 当前 Agent 的输出作为下一阶段的输入
    stageInput = result.content;

    // 阶段间间隔
    if (i < activeAgents.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  return results;
}

/**
 * 辩论策略：多 Agent 独立回答→互评更新立场→裁判总结
 * Round 1：所有 Agent 并行独立作答
 * Round 2..N：每个 Agent 审阅他人观点后更新自己的立场
 * 最终：裁判 Agent（第一个 Agent + coordinatorPrompt）输出最终结论
 *
 * 每轮使用 `agentId_rN` 格式作为唯一消息 ID，避免多轮覆盖
 */
async function runDebate(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const maxRounds = group.maxRounds || 3;
  const results: AgentRunResult[] = [];

  // 记录每个 Agent 的最新观点
  let opinions: Record<string, string> = {};

  // Round 1：所有 Agent 并行独立回答
  const round1Settled = await Promise.allSettled(
    activeAgents.map(agent =>
      runSingleAgent(agent, userMessage, history, callbacks, signal, `${agent.id}_r1`, groupContext)
    )
  );

  for (const r of round1Settled) {
    if (r.status === 'fulfilled') {
      results.push(r.value);
      // 用原始 agentId 做 opinions key
      const originalId = r.value.agentId.replace(/_r\d+$/, '');
      opinions[originalId] = r.value.content;
    }
  }

  // Round 2..N：互评阶段
  for (let round = 2; round <= maxRounds; round++) {
    if (signal?.aborted) break;

    const roundSettled = await Promise.allSettled(
      activeAgents.map(agent => {
        const othersOpinions = activeAgents
          .filter(a => a.id !== agent.id)
          .map(a => `[${a.name}] 的观点：${opinions[a.id] || '(无)'}`)
          .join('\n\n');

        const debatePrompt = `[辩论 Round ${round}/${maxRounds}]
原始问题：${userMessage}

你在上一轮的观点：
${opinions[agent.id] || '(无)'}

其他参与者的观点：
${othersOpinions}

请审阅以上观点，更新你的立场。你可以坚持、修正或补充自己的观点。`;

        return runSingleAgent(agent, debatePrompt, '', callbacks, signal, `${agent.id}_r${round}`, groupContext);
      })
    );

    for (const r of roundSettled) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
        const originalId = r.value.agentId.replace(/_r\d+$/, '');
        opinions[originalId] = r.value.content;
      }
    }
  }

  if (signal?.aborted) return results;

  // 最终裁决：由第一个 Agent（裁判）总结
  const judgeAgent = getLLMCoordinator(activeAgents);
  const allOpinions = activeAgents
    .map(a => `[${a.name}] 最终观点：${opinions[a.id] || '(无)'}`)
    .join('\n\n');

  const judgePrompt = group.coordinatorPrompt ||
    `你是辩论的最终裁判。请综合所有参与者的观点，给出公正的最终结论。`;

  const judgeName = translateEngineRole('judge');
  const judgeId = `${SYSTEM_AGENT_PREFIX}judge`;
  let judgeContent = '';
  if (judgeAgent) {
    const judgeMessages: AgentMessage[] = [
      { role: 'system', content: judgePrompt },
      { role: 'user', content: `原始问题：${userMessage}\n\n各方观点：\n${allOpinions}\n\n请给出最终裁决和总结。` },
    ];

    callbacks.onAgentStart(judgeId, judgeName);
    try {
      judgeContent = await callAgentLLM(
        { ...judgeAgent, systemPrompt: judgePrompt, temperature: 0.3 },
        judgeMessages,
        (token) => callbacks.onToken(judgeId, token),
        signal,
      );
      callbacks.onAgentEnd(judgeId, judgeContent);
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      const errMsg = error?.message || te('errors.unknownError');
      judgeContent = te('errors.judgeExecutionError', { message: errMsg });
      callbacks.onError(judgeId, errMsg);
    }
  } else {
    judgeContent = `以下是各成员的最终观点汇总：\n\n${allOpinions}`;
    emitSyntheticResult(callbacks, {
      agentId: judgeId,
      agentName: judgeName,
      content: judgeContent,
    });
  }

  results.push({
    agentId: judgeId,
    agentName: judgeName,
    content: judgeContent,
  });

  return results;
}

/**
 * MapReduce 策略：自动拆分任务→并行执行→汇总结果
 * MAP：协调者 + 第一个 Agent 的 LLM 拆分任务为 N 个子任务（JSON 格式）
 * EXECUTE：所有 Agent 并行执行各自的子任务
 * REDUCE：第一个 Agent 汇总所有结果为最终答案
 */
async function runMapReduce(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const results: AgentRunResult[] = [];
  const coordinatorAgent = getLLMCoordinator(activeAgents);

  // === MAP 阶段：拆分任务 ===
  const agentCount = activeAgents.length;
  const splitPrompt = group.coordinatorPrompt ||
    `你是一个任务拆分专家。请将以下任务拆分为 ${agentCount} 个可并行执行的子任务。
必须以 JSON 格式返回，不要有其他内容：
{"subtasks": ["子任务1描述", "子任务2描述", ...]}`;

  const splitMessages: AgentMessage[] = [
    { role: 'system', content: splitPrompt },
    { role: 'user', content: userMessage },
  ];

  let subtasks: string[] = [];
  try {
    if (coordinatorAgent) {
      const splitResponse = await callAgentLLM(
        { ...coordinatorAgent, systemPrompt: splitPrompt, temperature: 0.2 },
        splitMessages,
        undefined,
        signal,
      );
      const parsed = extractJSON(splitResponse);
      if (parsed && Array.isArray(parsed.subtasks)) {
        subtasks = parsed.subtasks;
      }
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    // JSON 解析失败，fallback：每个 Agent 执行原始消息
  }

  // 如果拆分失败，所有 Agent 执行原始任务
  if (subtasks.length === 0) {
    subtasks = activeAgents.map(() => userMessage);
  }

  if (signal?.aborted) return results;

  // === EXECUTE 阶段：并行执行子任务（使用 allSettled 容错）===
  const executeSettled = await Promise.allSettled(
    activeAgents.map((agent, idx) => {
      const task = subtasks[idx % subtasks.length] || userMessage;
      const taskPrompt = `[MapReduce 子任务 ${idx + 1}/${activeAgents.length}]
原始需求：${userMessage}

你的子任务：${task}`;
      return runSingleAgent(agent, taskPrompt, history, callbacks, signal, undefined, groupContext);
    })
  );
  const executeResults = executeSettled
    .filter((r): r is PromiseFulfilledResult<AgentRunResult> => r.status === 'fulfilled')
    .map(r => r.value);
  results.push(...executeResults);

  if (signal?.aborted) return results;

  // === REDUCE 阶段：汇总结果 ===
  const allResults = executeResults
    .map(r => `[${r.agentName}] 的结果：\n${r.content}`)
    .join('\n\n---\n\n');

  const reducePrompt = `你是结果汇总专家。请将以下多个子任务的执行结果，整合为一个连贯完整的最终答案。`;
  const reduceMessages: AgentMessage[] = [
    { role: 'system', content: reducePrompt },
    { role: 'user', content: `原始需求：${userMessage}\n\n各子任务结果：\n${allResults}\n\n请汇总为最终答案。` },
  ];

  const reducerName = translateEngineRole('reducer');
  const reducerId = `${SYSTEM_AGENT_PREFIX}reducer`;
  let reduceContent = '';
  if (coordinatorAgent) {
    callbacks.onAgentStart(reducerId, reducerName);
    try {
      reduceContent = await callAgentLLM(
        { ...coordinatorAgent, systemPrompt: reducePrompt, temperature: 0.3 },
        reduceMessages,
        (token) => callbacks.onToken(reducerId, token),
        signal,
      );
      callbacks.onAgentEnd(reducerId, reduceContent);
    } catch (error: any) {
      if (error?.name === 'AbortError') throw error;
      const errMsg = error?.message || te('errors.unknownError');
      reduceContent = te('errors.reducerExecutionError', { message: errMsg });
      callbacks.onError(reducerId, errMsg);
    }
  } else {
    void reduceMessages;
    reduceContent = `以下是各子任务结果汇总：\n\n${allResults}`;
    emitSyntheticResult(callbacks, {
      agentId: reducerId,
      agentName: reducerName,
      content: reduceContent,
    });
  }

  results.push({
    agentId: reducerId,
    agentName: reducerName,
    content: reduceContent,
  });

  return results;
}

/**
 * 监督者策略：一个 Agent 监督，可多轮分派+反馈修正
 * Agent[0] 是监督者，Agent[1..N] 是工人
 * Round 1：监督者分析任务并分配子任务给工人（JSON: {assignments: [{agentId, task}]}）
 * 工人执行被分配的任务
 * Round 2..N：监督者审阅结果，批准（{status: 'approved', summary}）
 *            或要求修正（{status: 'revise', feedback: [{agentId, instruction}]}）
 */
async function runSupervisor(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  signal?: AbortSignal,
  groupContext?: AgentGroupContext,
): Promise<AgentRunResult[]> {
  const activeAgents = getGroupAgents(group).filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length <= 1) {
    // 只有 1 个 Agent，回退到顺序执行
    return runSequential(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
  }

  const results: AgentRunResult[] = [];
  const supervisor = getLLMCoordinator(activeAgents);
  const workers = supervisor
    ? activeAgents.filter(agent => agent.id !== supervisor.id)
    : activeAgents;
  const maxRounds = group.maxRounds || 3;

  const workerList = workers.map(w => `- ${w.id}: ${w.name} (${getAgentRole(w)})`).join('\n');
  let workerOutputs: Record<string, string> = {};

  if (!supervisor) {
    callbacks.onInfo?.('当前监督者策略没有可用 LLM 监督者，已回退为按成员顺序执行。');
    return runSequential(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
  }

  for (let round = 1; round <= maxRounds; round++) {
    if (signal?.aborted) break;

    if (round === 1) {
      // === 第一轮：监督者分析任务并分配 ===
      const assignPrompt = group.coordinatorPrompt ||
        `你是任务监督者。分析用户需求，将任务分配给以下工人。
必须以 JSON 格式返回（不要有其他内容）：
{"assignments": [{"agentId": "工人ID", "task": "具体任务描述"}, ...]}

可用工人：
${workerList}`;

      const assignMessages: AgentMessage[] = [
        { role: 'system', content: assignPrompt },
        { role: 'user', content: userMessage },
      ];

      let assignments: { agentId: string; task: string }[] = [];
      try {
        const response = await callAgentLLM(
          { ...supervisor, systemPrompt: assignPrompt, temperature: 0.2 },
          assignMessages,
          undefined,
          signal,
        );
        const parsed = extractJSON(response);
        if (parsed && Array.isArray(parsed.assignments)) {
          assignments = parsed.assignments;
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        // 分配失败，所有工人执行原始任务
      }

      // 如果分配解析失败，所有工人执行原始任务
      if (assignments.length === 0) {
        assignments = workers.map(w => ({ agentId: w.id, task: userMessage }));
      }

      // 工人并行执行（使用 allSettled 容错）
      const workerSettled = await Promise.allSettled(
        assignments.map(({ agentId, task }) => {
          const worker = workers.find(w => w.id === agentId);
          if (!worker) return Promise.reject(new Error(`Worker ${agentId} not found`));
          return runSingleAgent(worker, task, history, callbacks, signal, `${agentId}_r${round}`, groupContext);
        })
      );

      for (const r of workerSettled) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
          const originalId = r.value.agentId.replace(/_r\d+$/, '');
          workerOutputs[originalId] = r.value.content;
        }
      }
    } else {
      // === 后续轮：监督者审阅并决定 ===
      const reviewSummary = Object.entries(workerOutputs)
        .map(([id, content]) => {
          const w = workers.find(w => w.id === id);
          return `[${w?.name || id}] 的结果：\n${content}`;
        })
        .join('\n\n---\n\n');

      const reviewPrompt = `你是任务监督者。审阅工人的执行结果，决定是否批准。

必须以 JSON 格式返回（不要有其他内容）：
批准：{"status": "approved", "summary": "最终总结"}
要求修正：{"status": "revise", "feedback": [{"agentId": "工人ID", "instruction": "修改指令"}]}

可用工人：
${workerList}`;

      const reviewMessages: AgentMessage[] = [
        { role: 'system', content: reviewPrompt },
        { role: 'user', content: `原始需求：${userMessage}\n\n工人结果：\n${reviewSummary}` },
      ];

      let decision: any = null;
      try {
        const response = await callAgentLLM(
          { ...supervisor, systemPrompt: reviewPrompt, temperature: 0.2 },
          reviewMessages,
          undefined,
          signal,
        );
        decision = extractJSON(response);
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        break;
      }

      if (!decision || decision.status === 'approved') {
        // 批准：输出最终总结
        if (decision?.summary) {
          const supervisorLabel = `${supervisor.name}(${translateEngineRole('supervisorSuffix')})`;
          const sysId = `${SYSTEM_AGENT_PREFIX}supervisor_r${round}`;
          const summaryResult: AgentRunResult = {
            agentId: sysId,
            agentName: supervisorLabel,
            content: decision.summary,
          };
          callbacks.onAgentStart(sysId, supervisorLabel);
          callbacks.onToken(sysId, decision.summary);
          callbacks.onAgentEnd(sysId, decision.summary);
          results.push(summaryResult);
        }
        break;
      }

      if (decision.status === 'revise' && Array.isArray(decision.feedback)) {
        // 要求修正：工人根据反馈重新执行（使用 allSettled 容错）
        const revisionSettled = await Promise.allSettled(
          decision.feedback.map(({ agentId, instruction }: { agentId: string; instruction: string }) => {
            const worker = workers.find(w => w.id === agentId);
            if (!worker) return Promise.reject(new Error(`Worker ${agentId} not found`));

            const revisionPrompt = `[监督者修正指令 Round ${round}]
原始需求：${userMessage}

你上一轮的输出：
${workerOutputs[agentId] || '(无)'}

监督者的修改要求：
${instruction}`;

            return runSingleAgent(worker, revisionPrompt, '', callbacks, signal, `${agentId}_r${round}`, groupContext);
          })
        );

        for (const r of revisionSettled) {
          if (r.status === 'fulfilled') {
            results.push(r.value);
            const originalId = r.value.agentId.replace(/_r\d+$/, '');
            workerOutputs[originalId] = r.value.content;
          }
        }
      }
    }
  }

  return results;
}


// ============ 主入口 ============

/**
 * Agent 群策略引擎主入口
 * 根据群配置的 strategy 分发到对应策略实现
 */
export async function executeAgentStrategy(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
  options?: AgentEngineOptions,
): Promise<AgentRunResult[]> {
  const signal = options?.signal;
  const groupContext: AgentGroupContext = {
    groupId: group.id,
    workspacePath: group.workspacePath,
    timeout: group.timeout,
    approvalMode: group.approvalMode,
    showStderr: group.showStderr,
    toolSessionLookup: options?.toolSessionLookup,
  };
  const agents = getGroupAgents(group);
  assertCLIWorkspaceConfigured(agents, mutedUsers, groupContext);

  switch (group.strategy) {
    case 'sequential':
      return runSequential(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'router':
      return runRouter(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'discussion':
      return runDiscussion(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'react':
      return runReAct(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'pipeline':
      return runPipeline(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'debate':
      return runDebate(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'mapreduce':
      return runMapReduce(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    case 'supervisor':
      return runSupervisor(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
    default:
      return runSequential(group, userMessage, history, mutedUsers, callbacks, signal, groupContext);
  }
}

export default executeAgentStrategy;
