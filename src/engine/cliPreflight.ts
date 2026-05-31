/**
 * CLI Agent 发送前 pre-flight 安装检测。
 *
 * 在真正调度 executeCLIStrategy 之前，按 adapter 去重调用 /api/cli/check，
 * 提前发现"本地未安装对应 CLI"（例如 codex 没装），阻止任务启动并给出安装引导，
 * 而不是等到运行时 spawn 失败才报错。
 *
 * 设计要点：
 *  - 检测以 adapter 为粒度（与设置面板一致，/api/cli/check 只接收 adapter）。
 *  - 检测调用本身失败（网络/IPC 异常、未知 adapter 等）时优雅降级为"放行"，
 *    避免因检测不可用而误伤正常执行。
 */
import type { CLIAgent } from '@/config/aiCharacters';
import { getCLIAdapterDefinition } from '@/config/cliAdapters';
import { te } from '@/i18n/translate';
import { request } from '@/utils/request';

export interface MissingCliAdapter {
  adapter: string;
  label: string;
  binary: string;
  installHint?: string;
  docsUrl?: string;
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
async function checkAdapterInstalled(adapter: string): Promise<boolean | null> {
  try {
    const res = await request('/api/cli/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adapter }),
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

/**
 * 对一组 CLI Agent 做发送前安装检测（按 adapter 去重并发）。
 */
export async function preflightCheckCliAgents(agents: CLIAgent[]): Promise<CliPreflightResult> {
  const adapterToAgentNames = new Map<string, string[]>();
  for (const agent of agents) {
    const adapter = agent.cli?.adapter || 'codex';
    const names = adapterToAgentNames.get(adapter) || [];
    names.push(agent.name);
    adapterToAgentNames.set(adapter, names);
  }

  const missing: MissingCliAdapter[] = [];
  const skipped: string[] = [];

  await Promise.all(
    Array.from(adapterToAgentNames.entries()).map(async ([adapter, agentNames]) => {
      const installed = await checkAdapterInstalled(adapter);
      if (installed === null) {
        skipped.push(adapter);
        return;
      }
      if (!installed) {
        const def = getCLIAdapterDefinition(adapter);
        missing.push({
          adapter,
          label: def.label,
          binary: def.defaultBinary || adapter,
          installHint: def.installHint,
          docsUrl: def.docsUrl,
          agentNames,
        });
      }
    }),
  );

  return { ok: missing.length === 0, missing, skipped };
}

/**
 * 把未安装列表格式化为可直接展示给用户的本地化提示（Markdown）。
 */
export function formatCliPreflightMessage(missing: MissingCliAdapter[]): string {
  const items = missing.map((m) => {
    const lines = [te('preflight.item', { label: m.label, binary: m.binary, agents: m.agentNames.join('、') })];
    if (m.installHint) lines.push(te('preflight.install', { command: m.installHint }));
    if (m.docsUrl) lines.push(te('preflight.docs', { url: m.docsUrl }));
    return lines.join('\n');
  });
  return `${te('preflight.header')}\n\n${items.join('\n\n')}`;
}
