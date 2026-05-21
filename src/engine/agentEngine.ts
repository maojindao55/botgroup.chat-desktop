/**
 * Agent 策略引擎
 * 实现 Agent 群的四种执行策略：sequential / router / discussion / react
 * 每个 Agent 独立配置 LLM API，支持工具调用循环
 */
import type { AgentGroup, AgentMember, AgentStrategy } from '@/config/groups';
import { request } from '@/utils/request';

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
  onAgentStart: (agentId: string, agentName: string) => void;
  onToken: (agentId: string, token: string) => void;
  onAgentEnd: (agentId: string, fullContent: string) => void;
  onError: (agentId: string, error: string) => void;
}

// ============ 单个 Agent 执行 ============


/**
 * 调用单个 Agent 的 LLM，支持流式返回
 * 通过服务端代理 /api/agent/chat 转发请求（避免前端暴露 API Key）
 */
async function callAgentLLM(
  agent: AgentMember,
  messages: AgentMessage[],
  onToken?: (token: string) => void,
): Promise<string> {
  const response = await request('/api/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseURL: agent.llm.baseURL,
      apiKey: agent.llm.apiKey,
      model: agent.llm.model,
      temperature: agent.temperature,
      messages,
      tools: agent.tools.filter(t => t.enabled).map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: { type: 'object', properties: {} },
        },
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(`Agent LLM 请求失败: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法获取响应流');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
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

  return fullContent;
}


/**
 * 执行单个 Agent（含工具调用循环）
 */
async function runSingleAgent(
  agent: AgentMember,
  userMessage: string,
  context: string,
  callbacks: StreamCallback,
): Promise<AgentRunResult> {
  callbacks.onAgentStart(agent.id, agent.name);

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
  let turns = 0;
  const maxTurns = agent.maxTurns || 5;

  try {
    // 简单实现：直接调用 LLM，不做工具循环（第一期）
    // 后续可扩展 function calling 循环
    fullContent = await callAgentLLM(agent, messages, (token) => {
      callbacks.onToken(agent.id, token);
    });

    callbacks.onAgentEnd(agent.id, fullContent);
  } catch (error: any) {
    const errMsg = error?.message || '未知错误';
    fullContent = `[Agent 执行出错: ${errMsg}]`;
    callbacks.onError(agent.id, errMsg);
  }

  return {
    agentId: agent.id,
    agentName: agent.name,
    content: fullContent,
  };
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
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = [];
  let accumulatedContext = history;

  for (const agent of group.agents) {
    if (mutedUsers.includes(agent.id)) continue;

    const result = await runSingleAgent(agent, userMessage, accumulatedContext, callbacks);
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
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  // 用协调者 Prompt + 第一个可用 Agent 的 LLM 来做路由决策
  const routerAgent = activeAgents[0];
  const agentList = activeAgents.map(a => `- ${a.id}: ${a.name} (${a.role})`).join('\n');

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
  try {
    const routerResponse = await callAgentLLM(
      { ...routerAgent, systemPrompt: routerPrompt, temperature: 0.1 },
      routerMessages,
    );
    // 解析路由结果
    selectedIds = routerResponse
      .split(/[,，\s]+/)
      .map(s => s.trim())
      .filter(id => activeAgents.some(a => a.id === id));
  } catch {
    // 路由失败，fallback 到全员
    selectedIds = activeAgents.map(a => a.id);
  }

  // 如果没匹配到，fallback 第一个
  if (selectedIds.length === 0) {
    selectedIds = [activeAgents[0].id];
  }

  // 按选中的 Agent 顺序执行
  const results: AgentRunResult[] = [];
  let accumulatedContext = history;

  for (const id of selectedIds) {
    const agent = activeAgents.find(a => a.id === id);
    if (!agent) continue;

    const result = await runSingleAgent(agent, userMessage, accumulatedContext, callbacks);
    results.push(result);
    accumulatedContext += `\n${agent.name}: ${result.content}`;
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
}


/**
 * 全员讨论策略：所有 Agent 回复同一消息（顺序执行模拟并行）
 */
async function runDiscussion(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  const results: AgentRunResult[] = [];

  for (const agent of activeAgents) {
    const result = await runSingleAgent(agent, userMessage, history, callbacks);
    results.push(result);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  return results;
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
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const results: AgentRunResult[] = [];
  const coordinatorAgent = activeAgents[0];
  const maxRounds = group.maxRounds || 3;
  let round = 0;
  let accumulatedContext = history;

  const agentList = activeAgents.map(a => `- ${a.id}: ${a.name} (${a.role})`).join('\n');

  while (round < maxRounds) {
    round++;

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
      );
      // 尝试解析 JSON
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        decision = JSON.parse(jsonMatch[0]);
      }
    } catch {
      break;
    }

    if (!decision || decision.action === 'done') {
      // 任务完成，输出总结
      if (decision?.summary) {
        const summaryResult: AgentRunResult = {
          agentId: 'coordinator',
          agentName: '协调者',
          content: decision.summary,
        };
        callbacks.onAgentStart('coordinator', '协调者');
        callbacks.onToken('coordinator', decision.summary);
        callbacks.onAgentEnd('coordinator', decision.summary);
        results.push(summaryResult);
      }
      break;
    }

    if (decision.action === 'delegate') {
      const targetAgent = activeAgents.find(a => a.id === decision.agentId);
      if (targetAgent) {
        const task = decision.task || userMessage;
        const result = await runSingleAgent(targetAgent, task, accumulatedContext, callbacks);
        results.push(result);
        accumulatedContext += `\n${targetAgent.name}: ${result.content}`;
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
): Promise<AgentRunResult[]> {
  switch (group.strategy) {
    case 'sequential':
      return runSequential(group, userMessage, history, mutedUsers, callbacks);
    case 'router':
      return runRouter(group, userMessage, history, mutedUsers, callbacks);
    case 'discussion':
      return runDiscussion(group, userMessage, history, mutedUsers, callbacks);
    case 'react':
      return runReAct(group, userMessage, history, mutedUsers, callbacks);
    default:
      return runSequential(group, userMessage, history, mutedUsers, callbacks);
  }
}

export default executeAgentStrategy;
