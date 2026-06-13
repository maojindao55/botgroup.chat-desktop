/**
 * CLI Agent 发送前 pre-flight 安装检测。
 *
 * 在真正调度 executeCLIStrategy 之前，按 adapter 去重调用 /api/cli/check，
 * 提前发现"本地未安装对应 CLI"（例如 codex 没装），阻止任务启动并给出安装引导，
 * 而不是等到运行时 spawn 失败才报错。
 *
 * 设计要点：
 *  - 默认运行时检测以 adapter 为粒度，并携带执行器配置里的 binary override。
 *  - 配了自定义 binary 或 WSL 的成员不走默认 binary 检测，交给真正运行路径校验。
 *  - 检测调用本身失败（网络/IPC 异常、未知 adapter 等）时优雅降级为"放行"，
 *    避免因检测不可用而误伤正常执行。
 */
import type { CLIAgent } from '@/config/aiCharacters';
import { parseCLICommandInput, resolveCLIExecutorForConfig, useCLIExecutorStore } from '@/store/cliExecutorStore';
import { te } from '@/i18n/translate';
import { request } from '@/utils/request';

export interface MissingCliAdapter {
  adapter: string;
  label: string;
  binary: string;
  installHint?: string;
  docsUrl?: string;
  /** 使用该 adapter 且被检测为缺失的成员 ID */
  agentIds: string[];
  /** 使用该 adapter 的成员名（用于提示哪些成员受影响） */
  agentNames: string[];
}

export interface CliPreflightResult {
  /** 是否全部就绪（没有检测到未安装的 adapter） */
  ok: boolean;
  /** 未安装的 adapter 列表 */
  missing: MissingCliAdapter[];
  /** 无法判定（检测失败而降级放行）的 adapter 列表 */
  skipped: string[];
}

/**
 * 检测单个 adapter 是否安装。
 * @returns true=已安装, false=未安装, null=无法判定（降级放行）
 */
async function checkAdapterInstalled(adapter: string, binary?: string): Promise<boolean | null> {
  try {
    const res = await request('/api/cli/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter, binary }),
    });
    if (!res || (typeof res.ok === 'boolean' && !res.ok)) return null;
    const json = await res.json();
    if (!json || json.success === false || !json.data) return null;
    return !!json.data.installed;
  } catch {
    // 检测不可用：不阻塞执行，交给运行时兜底
    return null;
  }
}

function hasCliRuntimeOverride(agent: CLIAgent): boolean {
  const cli = agent.cli;
  return !!cli?.wsl || !!cli?.binary?.trim();
}

/**
 * 对一组 CLI Agent 做发送前安装检测（按 adapter 去重并发）。
 */
export async function preflightCheckCliAgents(agents: CLIAgent[]): Promise<CliPreflightResult> {
  const adapterToAgents = new Map<string, CLIAgent[]>();
  for (const agent of agents) {
    if (hasCliRuntimeOverride(agent)) continue;
    const adapter = agent.cli?.adapter || 'codex';
    const adapterAgents = adapterToAgents.get(adapter) || [];
    adapterAgents.push(agent);
    adapterToAgents.set(adapter, adapterAgents);
  }

  const missing: MissingCliAdapter[] = [];
  const skipped: string[] = [];

  await Promise.all(
    Array.from(adapterToAgents.entries()).map(async ([adapter, adapterAgents]) => {
      const executor = resolveCLIExecutorForConfig(useCLIExecutorStore.getState().overrides, adapter);
      const runtimeAdapter = executor?.runtimeAdapter || adapter;
      if (executor?.enabled === false) {
        const fallbackBinary = executor.binary || adapter;
        missing.push({
          adapter,
          label: executor.label,
          binary: fallbackBinary,
          installHint: executor.installHint,
          docsUrl: executor.docsUrl,
          agentIds: adapterAgents.map(agent => agent.id),
          agentNames: adapterAgents.map(agent => agent.name),
        });
        return;
      }
      const checkBinary = parseCLICommandInput(executor?.binary).binary || executor?.binary;
      const installed = await checkAdapterInstalled(runtimeAdapter, checkBinary);
      if (installed === null) {
        skipped.push(adapter);
        return;
      }
      if (!installed) {
        const fallbackBinary = executor?.binary || adapter;
        missing.push({
          adapter,
          label: executor?.label || adapter,
          binary: fallbackBinary,
          installHint: executor?.installHint,
          docsUrl: executor?.docsUrl,
          agentIds: adapterAgents.map(agent => agent.id),
          agentNames: adapterAgents.map(agent => agent.name),
        });
      }
    }),
  );

  return { ok: missing.length === 0, missing, skipped };
}

function renderMissingItems(missing: MissingCliAdapter[]): string {
  return missing
    .map((m) => {
      const lines = [te('preflight.item', { label: m.label, binary: m.binary, agents: m.agentNames.join('、') })];
      if (m.installHint) lines.push(te('preflight.install', { command: m.installHint }));
      if (m.docsUrl) lines.push(te('preflight.docs', { url: m.docsUrl }));
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * 任务被整单拦截时（角色型工作流或全部未安装）展示的错误提示。
 */
export function formatCliPreflightMessage(missing: MissingCliAdapter[]): string {
  return `${te('preflight.header')}\n\n${renderMissingItems(missing)}`;
}

/**
 * 独立模式下自动跳过部分未安装成员、继续用其余成员执行时展示的提示。
 */
export function formatCliPreflightSkippedMessage(missing: MissingCliAdapter[]): string {
  return `${te('preflight.skippedHeader')}\n\n${renderMissingItems(missing)}`;
}

/** preflight 决策：直接执行 / 过滤后执行 / 整单拦截 */
export type CliPreflightAction = 'proceed' | 'proceed-filtered' | 'block';

export interface CliPreflightDecision {
  action: CliPreflightAction;
  /** 实际应执行的 agent 列表（block 时为空） */
  agents: CLIAgent[];
  /** 检测到未安装的 adapter */
  missing: MissingCliAdapter[];
  /** 需要展示给用户的本地化消息（proceed 时为空字符串） */
  message: string;
  /** 该消息是否应按错误样式展示（block=true，proceed-filtered=false） */
  isError: boolean;
}

/**
 * 在安装检测的基础上结合协作语义给出决策：
 *  - interchangeable=true（独立模式：router / race / sequential / mapreduce）：
 *    可逐个丢弃未安装成员。仍有已安装成员时过滤后继续；全部未安装则拦截。
 *  - interchangeable=false（角色型：pipeline / review / discussion / debate）：
 *    任一成员缺失即整单拦截，避免破坏流水线/讨论的角色分工。
 */
export async function decideCliPreflight(
  agents: CLIAgent[],
  opts: { interchangeable: boolean },
): Promise<CliPreflightDecision> {
  const result = await preflightCheckCliAgents(agents);
  if (result.ok) {
    return { action: 'proceed', agents, missing: [], message: '', isError: false };
  }

  const missingAgentIds = new Set(result.missing.flatMap((m) => m.agentIds));

  if (opts.interchangeable) {
    const remaining = agents.filter((a) => !missingAgentIds.has(a.id));
    if (remaining.length > 0) {
      return {
        action: 'proceed-filtered',
        agents: remaining,
        missing: result.missing,
        message: formatCliPreflightSkippedMessage(result.missing),
        isError: false,
      };
    }
  }

  return {
    action: 'block',
    agents: [],
    missing: result.missing,
    message: formatCliPreflightMessage(result.missing),
    isError: true,
  };
}
