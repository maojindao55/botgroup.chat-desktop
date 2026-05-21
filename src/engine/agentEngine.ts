/**
 * Agent 策略引擎
 * 实现 Agent 群的八种执行策略：
 *   sequential / router / discussion / react
 *   pipeline / debate / mapreduce / supervisor
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
export async function callAgentLLM(
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
 * 全员讨论策略：所有 Agent 并行回复同一消息
 */
async function runDiscussion(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  // 真并行：所有 Agent 同时执行
  return Promise.all(
    activeAgents.map(agent =>
      runSingleAgent(agent, userMessage, history, callbacks)
    )
  );
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
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const results: AgentRunResult[] = [];
  // 流水线输入：第一个 Agent 直接收到用户消息，后续 Agent 收到结构化提示
  let stageInput = '';

  for (let i = 0; i < activeAgents.length; i++) {
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

    const result = await runSingleAgent(agent, pipelinePrompt, history, callbacks);
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
 */
async function runDebate(
  group: AgentGroup,
  userMessage: string,
  history: string,
  mutedUsers: string[],
  callbacks: StreamCallback,
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const maxRounds = group.maxRounds || 3;
  const results: AgentRunResult[] = [];

  // 记录每个 Agent 的最新观点
  let opinions: Record<string, string> = {};

  // Round 1：所有 Agent 并行独立回答
  const round1Results = await Promise.all(
    activeAgents.map(agent =>
      runSingleAgent(agent, userMessage, history, callbacks)
    )
  );

  for (const r of round1Results) {
    results.push(r);
    opinions[r.agentId] = r.content;
  }

  // Round 2..N：互评阶段
  for (let round = 2; round <= maxRounds; round++) {
    // 构造其他人的观点摘要
    const roundResults = await Promise.all(
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

        return runSingleAgent(agent, debatePrompt, '', callbacks);
      })
    );

    for (const r of roundResults) {
      results.push(r);
      opinions[r.agentId] = r.content;
    }
  }

  // 最终裁决：由第一个 Agent（裁判）总结
  const judgeAgent = activeAgents[0];
  const allOpinions = activeAgents
    .map(a => `[${a.name}] 最终观点：${opinions[a.id] || '(无)'}`)
    .join('\n\n');

  const judgePrompt = group.coordinatorPrompt ||
    `你是辩论的最终裁判。请综合所有参与者的观点，给出公正的最终结论。`;

  const judgeMessages: AgentMessage[] = [
    { role: 'system', content: judgePrompt },
    { role: 'user', content: `原始问题：${userMessage}\n\n各方观点：\n${allOpinions}\n\n请给出最终裁决和总结。` },
  ];

  callbacks.onAgentStart('judge', '裁判');
  let judgeContent = '';
  try {
    judgeContent = await callAgentLLM(
      { ...judgeAgent, systemPrompt: judgePrompt, temperature: 0.3 },
      judgeMessages,
      (token) => callbacks.onToken('judge', token),
    );
    callbacks.onAgentEnd('judge', judgeContent);
  } catch (error: any) {
    judgeContent = `[裁判出错: ${error?.message || '未知错误'}]`;
    callbacks.onError('judge', error?.message || '未知错误');
  }

  results.push({
    agentId: 'judge',
    agentName: '裁判',
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
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length === 0) return [];

  const results: AgentRunResult[] = [];
  const coordinatorAgent = activeAgents[0];

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
    const splitResponse = await callAgentLLM(
      { ...coordinatorAgent, systemPrompt: splitPrompt, temperature: 0.2 },
      splitMessages,
    );
    // 解析 JSON 子任务列表
    const jsonMatch = splitResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed.subtasks)) {
        subtasks = parsed.subtasks;
      }
    }
  } catch {
    // JSON 解析失败，fallback：每个 Agent 执行原始消息
  }

  // 如果拆分失败，所有 Agent 执行原始任务
  if (subtasks.length === 0) {
    subtasks = activeAgents.map(() => userMessage);
  }

  // === EXECUTE 阶段：并行执行子任务 ===
  const executeResults = await Promise.all(
    activeAgents.map((agent, idx) => {
      const task = subtasks[idx % subtasks.length] || userMessage;
      const taskPrompt = `[MapReduce 子任务 ${idx + 1}/${activeAgents.length}]
原始需求：${userMessage}

你的子任务：${task}`;
      return runSingleAgent(agent, taskPrompt, history, callbacks);
    })
  );
  results.push(...executeResults);

  // === REDUCE 阶段：汇总结果 ===
  const allResults = executeResults
    .map(r => `[${r.agentName}] 的结果：\n${r.content}`)
    .join('\n\n---\n\n');

  const reducePrompt = `你是结果汇总专家。请将以下多个子任务的执行结果，整合为一个连贯完整的最终答案。`;
  const reduceMessages: AgentMessage[] = [
    { role: 'system', content: reducePrompt },
    { role: 'user', content: `原始需求：${userMessage}\n\n各子任务结果：\n${allResults}\n\n请汇总为最终答案。` },
  ];

  callbacks.onAgentStart('reducer', '汇总者');
  let reduceContent = '';
  try {
    reduceContent = await callAgentLLM(
      { ...coordinatorAgent, systemPrompt: reducePrompt, temperature: 0.3 },
      reduceMessages,
      (token) => callbacks.onToken('reducer', token),
    );
    callbacks.onAgentEnd('reducer', reduceContent);
  } catch (error: any) {
    reduceContent = `[汇总出错: ${error?.message || '未知错误'}]`;
    callbacks.onError('reducer', error?.message || '未知错误');
  }

  results.push({
    agentId: 'reducer',
    agentName: '汇总者',
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
): Promise<AgentRunResult[]> {
  const activeAgents = group.agents.filter(a => !mutedUsers.includes(a.id));
  if (activeAgents.length <= 1) {
    // 只有 1 个 Agent，回退到顺序执行
    return runSequential(group, userMessage, history, mutedUsers, callbacks);
  }

  const results: AgentRunResult[] = [];
  const supervisor = activeAgents[0];
  const workers = activeAgents.slice(1);
  const maxRounds = group.maxRounds || 3;

  const workerList = workers.map(w => `- ${w.id}: ${w.name} (${w.role})`).join('\n');
  let workerOutputs: Record<string, string> = {};

  for (let round = 1; round <= maxRounds; round++) {
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
        );
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed.assignments)) {
            assignments = parsed.assignments;
          }
        }
      } catch {
        // 分配失败，所有工人执行原始任务
      }

      // 如果分配解析失败，所有工人执行原始任务
      if (assignments.length === 0) {
        assignments = workers.map(w => ({ agentId: w.id, task: userMessage }));
      }

      // 工人并行执行
      const workerResults = await Promise.all(
        assignments.map(({ agentId, task }) => {
          const worker = workers.find(w => w.id === agentId);
          if (!worker) return null;
          return runSingleAgent(worker, task, history, callbacks);
        })
      );

      for (const r of workerResults) {
        if (r) {
          results.push(r);
          workerOutputs[r.agentId] = r.content;
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
        );
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          decision = JSON.parse(jsonMatch[0]);
        }
      } catch {
        break;
      }

      if (!decision || decision.status === 'approved') {
        // 批准：输出最终总结
        if (decision?.summary) {
          const summaryResult: AgentRunResult = {
            agentId: supervisor.id,
            agentName: `${supervisor.name}(监督者)`,
            content: decision.summary,
          };
          callbacks.onAgentStart(supervisor.id, `${supervisor.name}(监督者)`);
          callbacks.onToken(supervisor.id, decision.summary);
          callbacks.onAgentEnd(supervisor.id, decision.summary);
          results.push(summaryResult);
        }
        break;
      }

      if (decision.status === 'revise' && Array.isArray(decision.feedback)) {
        // 要求修正：工人根据反馈重新执行
        const revisionResults = await Promise.all(
          decision.feedback.map(({ agentId, instruction }: { agentId: string; instruction: string }) => {
            const worker = workers.find(w => w.id === agentId);
            if (!worker) return null;

            const revisionPrompt = `[监督者修正指令 Round ${round}]
原始需求：${userMessage}

你上一轮的输出：
${workerOutputs[agentId] || '(无)'}

监督者的修改要求：
${instruction}`;

            return runSingleAgent(worker, revisionPrompt, '', callbacks);
          })
        );

        for (const r of revisionResults) {
          if (r) {
            results.push(r);
            workerOutputs[r.agentId] = r.content;
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
    case 'pipeline':
      return runPipeline(group, userMessage, history, mutedUsers, callbacks);
    case 'debate':
      return runDebate(group, userMessage, history, mutedUsers, callbacks);
    case 'mapreduce':
      return runMapReduce(group, userMessage, history, mutedUsers, callbacks);
    case 'supervisor':
      return runSupervisor(group, userMessage, history, mutedUsers, callbacks);
    default:
      return runSequential(group, userMessage, history, mutedUsers, callbacks);
  }
}

export default executeAgentStrategy;
