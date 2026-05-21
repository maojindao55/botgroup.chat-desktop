/**
 * CLI Agent 策略引擎
 * 实现 CLI 群的多种执行策略：sequential / router / race / pipeline
 * CLI Agent 通过 /api/cli/run 流式调用
 */
import type { CLIGroup, CLIStrategy } from '@/config/groups';
import type { CLIAgent } from '@/config/aiCharacters';
import { request } from '@/utils/request';

// ============ 类型定义 ============

export interface CLIRunResult {
  taskId: string;
  agentId: string;
  agentName: string;
  content: string;
  exitCode?: number;
  durationMs?: number;
  isError?: boolean;
}

export interface CLIStreamCallback {
  onAgentStart: (taskId: string, agentId: string, agentName: string) => void;
  onToken: (taskId: string, token: string) => void;
  onAgentEnd: (taskId: string, fullContent: string) => void;
  onError: (taskId: string, error: string) => void;
}

export interface CLIRunOptions {
  timeoutMs?: number;
  approvalMode?: 'auto' | 'ask';
  showStderr?: boolean;
}

// ============ 单个 CLI Agent 执行 ============

/**
 * 调用单个 CLI Agent，通过 /api/cli/run 流式执行
 * 参考 ChatUI.tsx 中的 CLI 调用模式
 */
async function callCLIAgent(
  groupId: string,
  agent: CLIAgent,
  prompt: string,
  cwd: string,
  options: CLIRunOptions,
  callbacks: CLIStreamCallback,
): Promise<CLIRunResult> {
  const sessionId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;

  callbacks.onAgentStart(sessionId, agent.id, agent.name);

  const startTime = Date.now();
  const cliCfg = agent.cli || { adapter: 'generic' as const };

  const requestBody = {
    sessionId,
    groupId,
    agentId: agent.id,
    agentName: agent.name,
    adapter: cliCfg.adapter,
    prompt,
    cwd: cwd || null,
    binary: cliCfg.binary || null,
    extraArgs: cliCfg.extraArgs || null,
    env: cliCfg.env || null,
    timeoutMs: options.timeoutMs,
    approvalMode: options.approvalMode ?? cliCfg.approvalMode ?? 'auto',
    showStderr: options.showStderr ?? cliCfg.showStderr ?? true,
  };

  let fullContent = '';
  let exitCode: number | undefined;
  let failed = false;
  let errorMessage = '';

  try {
    const response = await request('/api/cli/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`CLI 请求失败: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('无法获取响应流');

    const decoder = new TextDecoder();
    let buffer = '';

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
            const token = data.content || '';
            if (token) {
              fullContent += token;
              callbacks.onToken(sessionId, token);
            }
            if (data.type === 'error') {
              failed = true;
              errorMessage = data.error || data.content || 'CLI 执行出错';
            }
            if (data.type === 'done') {
              exitCode = typeof data.exitCode === 'number' ? data.exitCode : exitCode;
              if (data.status && data.status !== 'completed') {
                failed = true;
                errorMessage = errorMessage || data.error || data.status;
              } else if (typeof exitCode === 'number' && exitCode !== 0) {
                failed = true;
                errorMessage = errorMessage || `CLI 非 0 退出: ${exitCode}`;
              }
            }
          } catch { /* 跳过解析错误 */ }
        }
      }
    }

    exitCode = exitCode ?? (failed ? -1 : 0);
    if (failed) {
      callbacks.onError(sessionId, errorMessage || 'CLI 执行失败');
    } else {
      callbacks.onAgentEnd(sessionId, fullContent);
    }
  } catch (error: any) {
    const errMsg = error?.message || '未知错误';
    fullContent = `[CLI Agent 执行出错: ${errMsg}]`;
    exitCode = -1;
    callbacks.onError(sessionId, errMsg);
  }

  const durationMs = Date.now() - startTime;

  return {
    taskId: sessionId,
    agentId: agent.id,
    agentName: agent.name,
    content: fullContent,
    exitCode,
    durationMs,
    isError: failed || fullContent.startsWith('[CLI Agent 执行出错'),
  };
}


// ============ 策略实现 ============

/**
 * 顺序执行策略：逐个 CLI Agent 执行
 */
async function runCLISequential(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  options: CLIRunOptions,
  callbacks: CLIStreamCallback,
): Promise<CLIRunResult[]> {
  const results: CLIRunResult[] = [];

  for (const agent of agents) {
    const result = await callCLIAgent(group.id, agent, prompt, cwd, options, callbacks);
    results.push(result);

    // 间隔
    if (agents.indexOf(agent) < agents.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * 智能路由策略：基于标签匹配选择最合适的 CLI Agent
 * 解析用户 prompt 中的关键词，与 Agent 的 tags 做匹配评分
 * 无需 LLM 调用，纯本地匹配
 */
async function runCLIRouter(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  options: CLIRunOptions,
  callbacks: CLIStreamCallback,
): Promise<CLIRunResult[]> {
  if (agents.length === 0) return [];

  // 标签关键词映射表（中/英文关键词 → 标签）
  const keywordTagMap: Record<string, string[]> = {
    '重构': ['重构'],
    'refactor': ['重构'],
    '调试': ['调试'],
    'debug': ['调试'],
    '编码': ['编码', '编程'],
    'code': ['编码', '编程'],
    '编程': ['编程', '编码'],
    'program': ['编程', '编码'],
    '分析': ['分析数据'],
    'analyze': ['分析数据'],
    'analysis': ['分析数据'],
    '推理': ['深度推理'],
    'reason': ['深度推理'],
    '修复': ['调试'],
    'fix': ['调试'],
    'bug': ['调试'],
    '测试': ['编码', '调试'],
    'test': ['编码', '调试'],
    '优化': ['重构', '深度推理'],
    'optimize': ['重构', '深度推理'],
  };

  // 计算每个 Agent 的匹配分数
  const promptLower = prompt.toLowerCase();
  const scores = agents.map(agent => {
    let score = 0;
    const agentTags = agent.tags || [];

    // 关键词匹配
    for (const [keyword, tags] of Object.entries(keywordTagMap)) {
      if (promptLower.includes(keyword)) {
        for (const tag of tags) {
          if (agentTags.includes(tag)) {
            score += 2;
          }
        }
      }
    }

    // 直接提到 Agent 名字加分
    if (promptLower.includes(agent.name.toLowerCase())) {
      score += 10;
    }

    // 标签数量多 = 能力更广泛，微加分
    score += agentTags.length * 0.1;

    return { agent, score };
  });

  // 按分数排序，选择最高分的 Agent
  scores.sort((a, b) => b.score - a.score);

  // 选择得分最高的 Agent（如果多个同分，都选）
  const topScore = scores[0].score;
  const selected = topScore > 0
    ? scores.filter(s => s.score === topScore).map(s => s.agent)
    : [scores[0].agent]; // 无匹配时 fallback 到第一个

  const results: CLIRunResult[] = [];
  for (const agent of selected) {
    const result = await callCLIAgent(group.id, agent, prompt, cwd, options, callbacks);
    results.push(result);
  }

  return results;
}

/**
 * 竞争模式：所有 CLI Agent 并行执行，返回全部结果
 * UI 层可展示哪个最先完成
 */
async function runCLIRace(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  options: CLIRunOptions,
  callbacks: CLIStreamCallback,
): Promise<CLIRunResult[]> {
  if (agents.length === 0) return [];

  // 所有 Agent 真并行执行
  return Promise.all(
    agents.map(agent => callCLIAgent(group.id, agent, prompt, cwd, options, callbacks))
  );
}

/**
 * 流水线策略：Agent 按阶段分工
 * Agent 1 生成代码 → Agent 2 审查/修改 → Agent 3 测试
 * 每个 Agent 收到上一个 Agent 的输出作为上下文
 */
async function runCLIPipeline(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  options: CLIRunOptions,
  callbacks: CLIStreamCallback,
): Promise<CLIRunResult[]> {
  if (agents.length === 0) return [];

  const results: CLIRunResult[] = [];
  // 阶段标签（按实际 Agent 数量截取）
  const stageLabels = ['生成代码', '审查/修改', '测试', '优化', '验证'];
  let previousOutput = '';

  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    const stageLabel = stageLabels[i] || `阶段 ${i + 1}`;
    const previousOutputForPrompt = previousOutput.length > 12000
      ? `${previousOutput.slice(0, 12000)}\n\n[上一阶段输出过长，已截断到前 12000 字符]`
      : previousOutput;

    // 构造流水线提示
    let pipelinePrompt: string;
    if (i === 0) {
      // 第一阶段：直接执行原始任务
      pipelinePrompt = prompt;
    } else {
      // 后续阶段：带上上一阶段的输出作为上下文
      pipelinePrompt = `以下是上一阶段（${agents[i - 1].name} - ${stageLabels[i - 1] || '处理'}）的输出结果：

---
${previousOutputForPrompt}
---

请基于以上结果，继续执行你的职责（${stageLabel}）。

原始需求：${prompt}`;
    }

    const result = await callCLIAgent(group.id, agent, pipelinePrompt, cwd, options, callbacks);
    results.push(result);
    if (result.isError || (typeof result.exitCode === 'number' && result.exitCode !== 0)) {
      break;
    }
    previousOutput = result.content;

    // 阶段间间隔
    if (i < agents.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  return results;
}


// ============ 主入口 ============

/**
 * CLI 群策略引擎主入口
 * 根据群配置的 strategy 分发到对应策略实现
 */
export async function executeCLIStrategy(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  callbacks: CLIStreamCallback,
  options?: CLIRunOptions
): Promise<CLIRunResult[]> {
  const opt = {
    timeoutMs: options?.timeoutMs ?? group.timeout ?? 300000,
    approvalMode: options?.approvalMode ?? group.approvalMode ?? 'auto',
    showStderr: options?.showStderr ?? group.showStderr ?? true,
  };

  switch (group.strategy) {
    case 'sequential':
      return runCLISequential(group, agents, prompt, cwd, opt, callbacks);
    case 'router':
      return runCLIRouter(group, agents, prompt, cwd, opt, callbacks);
    case 'race':
      return runCLIRace(group, agents, prompt, cwd, opt, callbacks);
    case 'pipeline':
      return runCLIPipeline(group, agents, prompt, cwd, opt, callbacks);
    default:
      return runCLISequential(group, agents, prompt, cwd, opt, callbacks);
  }
}

export default executeCLIStrategy;
