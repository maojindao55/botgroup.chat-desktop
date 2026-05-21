/**
 * CLI Agent 策略引擎
 *
 * 设计目标（参考 docs/cli-execution-strategy-refactor-plan.md）：
 *  - 用户视角仍是简单的预设模式：sequential / router / race / pipeline / discussion
 *  - 内部统一为可组合的 `CLIExecutionPlan`：selection × collaboration × schedule × isolation × failurePolicy
 *  - 调度入口拆为：选择 Agent → 准备执行环境 → 构造提示 → 调度 → 清理
 *
 * CLI Agent 通过 /api/cli/run 流式调用。
 */
import type {
  CLIGroup,
  CLIExecutionPlan,
} from '@/config/groups';
import { resolveExecutionPlan } from '@/config/groups';
import type { CLIAgent } from '@/config/aiCharacters';
import { request } from '@/utils/request';

// ============ 类型定义 ============

export type CLIRunStatus = 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface CLIRunResult {
  taskId: string;
  agentId: string;
  agentName: string;
  content: string;
  status?: CLIRunStatus;
  exitCode?: number;
  durationMs?: number;
  isError?: boolean;
  /** 实际执行使用的 cwd（race worktree 时为 worktree 路径，便于 UI 展示） */
  cwd?: string;
  /** worktree 分支名（仅 race + worktree 模式有值） */
  branch?: string;
  /** 阶段标签（pipeline 显示阶段名，discussion 显示 Round） */
  stageLabel?: string;
  /** worktree 基准 commit SHA（用于对比 diff） */
  baseSha?: string;
  /** 用户是否标记采用此结果 */
  adopted?: boolean;
}

export interface CLIStreamCallback {
  onAgentStart: (taskId: string, agentId: string, agentName: string, meta?: CLIAgentMeta) => void;
  onToken: (taskId: string, token: string) => void;
  onAgentEnd: (taskId: string, fullContent: string) => void;
  onError: (taskId: string, error: string) => void;
}

export interface CLIAgentMeta {
  /** 阶段或轮次标签，例如 "Round 1"、"审查/修改" */
  stageLabel?: string;
  /** 实际执行 cwd（worktree 路径或 workspace） */
  cwd?: string;
  /** worktree 分支名 */
  branch?: string;
  /** worktree baseSha（用于后续 diff 对比） */
  baseSha?: string;
}

export interface CLIRunOptions {
  timeoutMs?: number;
  approvalMode?: 'auto' | 'ask';
  showStderr?: boolean;
}

interface CLIWorktreeInfo {
  agentId: string;
  path: string;
  branchName?: string;
  baseSha?: string;
}

interface CLIWorktreePrepareResult {
  worktrees: CLIWorktreeInfo[];
  runId: string;
}

interface AgentExecutionContext {
  agent: CLIAgent;
  /** 实际执行 cwd */
  cwd: string;
  isolation: 'sameWorkspace' | 'readOnly' | 'worktreePerAgent' | 'copyPerAgent';
  /** worktree 路径（worktreePerAgent 时有值） */
  worktreePath?: string;
  branchName?: string;
  /** worktree 基准 SHA（worktreePerAgent 时有值，用于 diff 对比） */
  baseSha?: string;
  /** 临时 copy 路径（copyPerAgent 时有值） */
  tempCopyPath?: string;
}

interface ScheduleInput {
  plan: CLIExecutionPlan;
  group: CLIGroup;
  contexts: AgentExecutionContext[];
  prompt: string;
  options: Required<Pick<CLIRunOptions, 'timeoutMs' | 'approvalMode' | 'showStderr'>>;
  callbacks: CLIStreamCallback;
}

// ============ 单个 CLI Agent 执行 ============

const READ_ONLY_PROMPT_PREFIX = `你正在参与 CLI Agent 讨论模式。
本模式只用于分析、评审和提出执行建议。
不要修改文件，不要运行会改变 workspace 状态的命令。
如果需要执行修改，请明确列出建议的后续执行步骤。

`;

/**
 * 调用单个 CLI Agent，通过 /api/cli/run 流式执行。
 */
async function callCLIAgent(
  groupId: string,
  ctx: AgentExecutionContext,
  prompt: string,
  options: CLIRunOptions,
  callbacks: CLIStreamCallback,
  meta: CLIAgentMeta,
): Promise<CLIRunResult> {
  const agent = ctx.agent;
  const sessionId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `cli-${Date.now()}-${Math.random().toString(36).slice(2)}`) as string;

  const displayName = meta.stageLabel
    ? `${agent.name} · ${meta.stageLabel}`
    : agent.name;

  callbacks.onAgentStart(sessionId, agent.id, displayName, {
    stageLabel: meta.stageLabel,
    cwd: ctx.cwd,
    branch: ctx.branchName,
    baseSha: ctx.baseSha,
  });

  const startTime = Date.now();
  const cliCfg = agent.cli || { adapter: 'generic' as const };

  const requestBody = {
    sessionId,
    groupId,
    agentId: agent.id,
    agentName: displayName,
    adapter: cliCfg.adapter,
    prompt,
    cwd: ctx.cwd || null,
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
  let status: CLIRunStatus | undefined;

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
                if (data.status === 'cancelled' || data.status === 'timeout' || data.status === 'failed') {
                  status = data.status as CLIRunStatus;
                }
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
    failed = true;
    errorMessage = errMsg;
    callbacks.onError(sessionId, errMsg);
  }

  const durationMs = Date.now() - startTime;

  // 推断 status：cancelled / timeout 优先以服务端为准；其余按 exitCode 判断
  if (!status) {
    if (exitCode === -2) {
      status = 'cancelled';
    } else if (failed) {
      status = /timeout/i.test(errorMessage) ? 'timeout' : 'failed';
    } else {
      status = 'completed';
    }
  }

  return {
    taskId: sessionId,
    agentId: agent.id,
    agentName: agent.name,
    content: fullContent,
    status,
    exitCode,
    durationMs,
    isError: failed || fullContent.startsWith('[CLI Agent 执行出错'),
    cwd: ctx.cwd,
    branch: ctx.branchName,
    stageLabel: meta.stageLabel,
    baseSha: ctx.baseSha,
  };
}

// ============ Agent 选择 ============

/**
 * 根据 plan.selection 选择参与执行的 Agent。
 * - all: 全部
 * - router: 标签 + 名字关键词匹配，分高者优先
 * - manual: 直接使用传入列表（兼容外层已过滤的情况）
 */
function selectAgents(
  plan: CLIExecutionPlan,
  agents: CLIAgent[],
  prompt: string,
): CLIAgent[] {
  if (agents.length === 0) return [];

  switch (plan.selection) {
    case 'manual':
    case 'all':
      return agents;

    case 'router': {
      const keywordTagMap: Record<string, string[]> = {
        '重构': ['重构'], 'refactor': ['重构'],
        '调试': ['调试'], 'debug': ['调试'],
        '编码': ['编码', '编程'], 'code': ['编码', '编程'],
        '编程': ['编程', '编码'], 'program': ['编程', '编码'],
        '分析': ['分析数据'], 'analyze': ['分析数据'], 'analysis': ['分析数据'],
        '推理': ['深度推理'], 'reason': ['深度推理'],
        '修复': ['调试'], 'fix': ['调试'], 'bug': ['调试'],
        '测试': ['编码', '调试'], 'test': ['编码', '调试'],
        '优化': ['重构', '深度推理'], 'optimize': ['重构', '深度推理'],
      };
      const promptLower = prompt.toLowerCase();
      const scored = agents.map(agent => {
        let score = 0;
        const tags = agent.tags || [];
        for (const [keyword, mappedTags] of Object.entries(keywordTagMap)) {
          if (promptLower.includes(keyword)) {
            for (const tag of mappedTags) {
              if (tags.includes(tag)) score += 2;
            }
          }
        }
        if (promptLower.includes(agent.name.toLowerCase())) score += 10;
        score += tags.length * 0.1;
        return { agent, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const top = scored[0].score;
      return top > 0
        ? scored.filter(s => s.score === top).map(s => s.agent)
        : [scored[0].agent];
    }

    default:
      return agents;
  }
}

// ============ 执行环境准备 ============

/**
 * 准备每个 Agent 的执行 cwd 与隔离信息。
 * - sameWorkspace / readOnly：所有 Agent 共用 workspace
 * - worktreePerAgent：调用 /api/cli/worktree/prepare 为每个 Agent 创建独立 git worktree
 * - copyPerAgent：创建临时只读副本目录（discussion 真只读隔离）
 */
async function prepareExecutionContexts(
  plan: CLIExecutionPlan,
  group: CLIGroup,
  agents: CLIAgent[],
  cwd: string,
): Promise<AgentExecutionContext[]> {
  if (agents.length === 0) return [];

  if (plan.isolation === 'worktreePerAgent') {
    if (!cwd) {
      throw new Error('竞争模式需要先设置 workspacePath。');
    }
    let prepared: CLIWorktreePrepareResult | null = null;
    try {
      const res = await request('/api/cli/worktree/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: group.id,
          cwd,
          agentIds: agents.map(a => a.id),
        }),
      });
      const json = await res.json();
      if (!json?.success) {
        throw new Error(json?.message || 'worktree 准备失败');
      }
      prepared = json.data as CLIWorktreePrepareResult;
    } catch (e: any) {
      // worktree 创建失败：明确报错，不做静默降级
      throw new Error(`无法为竞争模式创建 worktree: ${e?.message || e}`);
    }

    const byId = new Map<string, CLIWorktreeInfo>();
    for (const wt of prepared.worktrees) byId.set(wt.agentId, wt);

    return agents.map(agent => {
      const wt = byId.get(agent.id);
      if (!wt) {
        throw new Error(`Agent ${agent.name} 的 worktree 创建失败，请重试。`);
      }
      return {
        agent,
        cwd: wt.path,
        isolation: 'worktreePerAgent' as const,
        worktreePath: wt.path,
        branchName: wt.branchName,
        baseSha: wt.baseSha,
      };
    });
  }

  if (plan.isolation === 'copyPerAgent') {
    if (!cwd) {
      throw new Error('讨论模式需要先设置 workspacePath。');
    }
    // V2.5: 为 discussion 准备临时只读目录副本
    try {
      const res = await request('/api/cli/tempcopy/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          groupId: group.id,
          cwd,
          agentIds: agents.map(a => a.id),
        }),
      });
      const json = await res.json();
      if (!json?.success) {
        // 如果 temp copy 创建失败，阻止启动 discussion
        throw new Error(json?.message || '临时只读目录创建失败');
      }
      const copies: Array<{ agentId: string; path: string }> = json.data?.copies || [];
      const byId = new Map(copies.map(c => [c.agentId, c.path]));

      return agents.map(agent => {
        const copyPath = byId.get(agent.id);
        if (!copyPath) {
          throw new Error(`Agent ${agent.name} 的只读环境创建失败，请重试。`);
        }
        return {
          agent,
          cwd: copyPath,
          isolation: 'copyPerAgent' as const,
          tempCopyPath: copyPath,
        };
      });
    } catch (e: any) {
      // 如果只读环境准备失败，阻止启动 discussion 并给出明确错误
      throw new Error(`无法为讨论模式创建只读环境: ${e?.message || e}`);
    }
  }

  return agents.map(agent => ({
    agent,
    cwd,
    isolation: plan.isolation,
  }));
}

/**
 * 清理执行环境。
 * - worktreePerAgent：保留 worktree 让用户检查（不自动清理）
 * - copyPerAgent：执行结束后自动清理临时目录
 */
async function finalizeExecutionContexts(
  plan: CLIExecutionPlan,
  contexts: AgentExecutionContext[],
): Promise<void> {
  // copyPerAgent：自动清理临时只读副本
  if (plan.isolation === 'copyPerAgent') {
    const paths = contexts
      .map(c => c.tempCopyPath)
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      try {
        await request('/api/cli/tempcopy/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths }),
        });
      } catch (e) {
        console.warn('[cliEngine] 临时目录清理失败（不影响执行结果）:', e);
      }
    }
  }
  // worktreePerAgent：不自动清理（计划文档要求保留路径）
}

// ============ 提示词构造 ============

interface PromptBuildInput {
  plan: CLIExecutionPlan;
  basePrompt: string;
  /** pipeline 上一阶段输出，pipeline 模式下使用 */
  previousOutput?: string;
  previousAgentName?: string;
  previousStageLabel?: string;
  currentStageLabel?: string;
  /** discussion 第二轮的 transcript */
  discussionTranscript?: string;
  /** discussion 当前轮次（1-based） */
  discussionRound?: number;
  /** 是否需要只读约束前缀 */
  readOnly?: boolean;
}

const PIPELINE_STAGE_LABELS = ['生成代码', '审查/修改', '测试', '优化', '验证'];

function pipelineStageLabel(index: number): string {
  return PIPELINE_STAGE_LABELS[index] || `阶段 ${index + 1}`;
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}\n\n[内容过长，已截断到前 ${max} 字符]`;
}

function buildPromptForAgent(input: PromptBuildInput): string {
  const { plan, basePrompt } = input;
  const readOnlyPrefix = input.readOnly || plan.collaboration === 'discussion'
    ? READ_ONLY_PROMPT_PREFIX
    : '';

  if (plan.collaboration === 'pipeline' && input.previousOutput !== undefined) {
    const stage = input.currentStageLabel || '继续';
    const prevStage = input.previousStageLabel || '上一阶段';
    const prevAgent = input.previousAgentName || '上一阶段 Agent';
    const prev = truncate(input.previousOutput, 12000);
    return `${readOnlyPrefix}以下是上一阶段（${prevAgent} - ${prevStage}）的输出结果：

---
${prev}
---

请基于以上结果，继续执行你的职责（${stage}）。

原始需求：${basePrompt}`;
  }

  if (plan.collaboration === 'discussion') {
    const round = input.discussionRound ?? 1;
    if (round === 1 || !input.discussionTranscript) {
      return `${readOnlyPrefix}请围绕以下需求进行分析与方案讨论（不要修改文件）：

${basePrompt}`;
    }
    const transcript = truncate(input.discussionTranscript, 12000);
    return `${readOnlyPrefix}原始需求：${basePrompt}

以下是上一轮讨论记录：

---
${transcript}
---

请基于其他 Agent 的意见补充你的最终判断：
1. 你同意哪些结论？
2. 你不同意哪些结论，原因是什么？
3. 最大风险是什么？
4. 推荐下一步怎么执行？`;
  }

  return `${readOnlyPrefix}${basePrompt}`;
}

// ============ 失败策略 ============

/**
 * 统一判断是否在当前结果之后继续后续阶段/Agent。
 * - cancelled / exitCode === -2：永远停止后续
 * - failurePolicy === 'continue'：继续
 * - failurePolicy === 'stopOnFailure'：成功才继续
 * - failurePolicy === 'stopOnCancelled'：仅取消停止
 */
export function shouldContinueAfterResult(
  plan: CLIExecutionPlan,
  result: CLIRunResult,
): boolean {
  if (result.status === 'cancelled' || result.exitCode === -2) return false;
  if (plan.failurePolicy === 'continue') return true;
  if (plan.failurePolicy === 'stopOnCancelled') return true;
  if (plan.failurePolicy === 'stopOnFailure') {
    return !result.isError && (result.exitCode === undefined || result.exitCode === 0);
  }
  return true;
}

// ============ 调度实现 ============

async function runIndependentSequential(input: ScheduleInput): Promise<CLIRunResult[]> {
  const { plan, group, contexts, prompt, options, callbacks } = input;
  const results: CLIRunResult[] = [];
  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i];
    const finalPrompt = buildPromptForAgent({ plan, basePrompt: prompt });
    const result = await callCLIAgent(group.id, ctx, finalPrompt, options, callbacks, {});
    results.push(result);
    if (!shouldContinueAfterResult(plan, result)) break;
    if (i < contexts.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return results;
}

async function runIndependentParallel(input: ScheduleInput): Promise<CLIRunResult[]> {
  const { plan, group, contexts, prompt, options, callbacks } = input;
  return Promise.all(
    contexts.map(ctx =>
      callCLIAgent(
        group.id,
        ctx,
        buildPromptForAgent({ plan, basePrompt: prompt }),
        options,
        callbacks,
        {},
      ),
    ),
  );
}

async function runPipelineSchedule(input: ScheduleInput): Promise<CLIRunResult[]> {
  const { plan, group, contexts, prompt, options, callbacks } = input;
  const results: CLIRunResult[] = [];
  let previousOutput: string | undefined;
  let previousAgentName: string | undefined;
  let previousStageLabel: string | undefined;

  for (let i = 0; i < contexts.length; i++) {
    const ctx = contexts[i];
    const stageLabel = pipelineStageLabel(i);
    const finalPrompt = buildPromptForAgent({
      plan,
      basePrompt: prompt,
      previousOutput,
      previousAgentName,
      previousStageLabel,
      currentStageLabel: stageLabel,
    });
    const result = await callCLIAgent(group.id, ctx, finalPrompt, options, callbacks, {
      stageLabel,
    });
    results.push(result);
    if (!shouldContinueAfterResult(plan, result)) break;
    previousOutput = result.content;
    previousAgentName = ctx.agent.name;
    previousStageLabel = stageLabel;
    if (i < contexts.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return results;
}

/**
 * Discussion：每一轮内部并行，轮次之间串行。
 * Round 2 拿到 Round 1 的 transcript。
 */
async function runDiscussionSchedule(input: ScheduleInput): Promise<CLIRunResult[]> {
  const { plan, group, contexts, prompt, options, callbacks } = input;
  const totalRounds = Math.max(1, plan.maxRounds ?? 2);
  const allResults: CLIRunResult[] = [];
  let transcript = '';

  for (let round = 1; round <= totalRounds; round++) {
    const stageLabel = `Round ${round}`;
    const roundResults = await Promise.all(
      contexts.map(ctx =>
        callCLIAgent(
          group.id,
          ctx,
          buildPromptForAgent({
            plan,
            basePrompt: prompt,
            discussionRound: round,
            discussionTranscript: transcript || undefined,
            readOnly: true,
          }),
          options,
          callbacks,
          { stageLabel },
        ),
      ),
    );
    allResults.push(...roundResults);

    // 用本轮所有 Agent 的输出拼接成下一轮的 transcript
    const segments = roundResults
      .map(r => `### ${r.agentName} (${stageLabel})\n${r.content || '(无输出)'}`)
      .join('\n\n');
    transcript = transcript
      ? `${transcript}\n\n${segments}`
      : segments;

    // 任意 Agent 取消即终止后续轮次（保护用户的停止操作）
    if (roundResults.some(r => r.status === 'cancelled')) break;
  }

  return allResults;
}

/**
 * 调度入口：根据 collaboration × schedule 选择具体策略。
 */
async function runSchedule(input: ScheduleInput): Promise<CLIRunResult[]> {
  const { plan } = input;

  if (plan.collaboration === 'discussion') {
    return runDiscussionSchedule(input);
  }

  if (plan.collaboration === 'pipeline') {
    return runPipelineSchedule(input);
  }

  // independent
  if (plan.schedule === 'parallel') {
    return runIndependentParallel(input);
  }
  return runIndependentSequential(input);
}

// ============ 主入口 ============

/**
 * CLI 群策略引擎主入口。
 * 流程：解析 plan → 选 Agent → 准备执行环境 → 构造提示并调度 → 清理。
 */
export async function executeCLIStrategy(
  group: CLIGroup,
  agents: CLIAgent[],
  prompt: string,
  cwd: string,
  callbacks: CLIStreamCallback,
  options?: CLIRunOptions,
): Promise<CLIRunResult[]> {
  const opt = {
    timeoutMs: options?.timeoutMs ?? group.timeout ?? 300000,
    approvalMode: options?.approvalMode ?? group.approvalMode ?? 'auto',
    showStderr: options?.showStderr ?? group.showStderr ?? true,
  };

  if (agents.length === 0) return [];

  const plan = resolveExecutionPlan(group);
  const selected = selectAgents(plan, agents, prompt);
  if (selected.length === 0) return [];

  const contexts = await prepareExecutionContexts(plan, group, selected, cwd);

  try {
    return await runSchedule({
      plan,
      group,
      contexts,
      prompt,
      options: opt,
      callbacks,
    });
  } finally {
    await finalizeExecutionContexts(plan, contexts);
  }
}

export default executeCLIStrategy;
