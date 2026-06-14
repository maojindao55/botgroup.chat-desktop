import type { AIMember } from '@/config/aiMembers';

export type SelectionRole = 'implementer' | 'reviewer' | 'summarizer';

export type SelectionStrategy =
  | { kind: 'first' }
  | { kind: 'count'; n: number }
  | { kind: 'all' }
  | { kind: 'byRole'; role: SelectionRole; fallback?: 'first' };

const ROLE_KEYWORDS: Record<SelectionRole, string[]> = {
  implementer: ['implement', 'develop', 'engineer', 'write', '实现', '开发', '工程', '编码', '编写'],
  reviewer: ['review', 'audit', 'test', '审', '复审', '审查', '评审', '测试'],
  summarizer: ['summar', 'synthes', 'conclude', 'coordinator', '汇总', '综合', '总结', '归纳', '协调'],
};

/**
 * 把声明式选人策略解析成具体 agentIds。
 * 解析顺序：剔除 exclude → 按 strategy 取数 → 截到 maxParallel。
 * byRole 用于单专家槽位（实现者/复审者/汇总者），返回首个命中；无命中走 fallback first。
 * 不报错；池不足则返回现有的。
 */
export function resolveAgentSelection(
  strategy: SelectionStrategy,
  members: AIMember[],
  opts: { maxParallel: number; exclude?: string[] },
): string[] {
  const exclude = new Set(opts.exclude || []);
  const pool = (members || []).filter(m => m && m.id && !exclude.has(m.id));
  const cap = Math.max(1, opts.maxParallel || 1);

  if (strategy.kind === 'first') {
    return pool.slice(0, 1).map(m => m.id);
  }
  if (strategy.kind === 'count') {
    const n = Math.max(1, Math.floor(strategy.n) || 1);
    return pool.slice(0, Math.min(n, cap)).map(m => m.id);
  }
  if (strategy.kind === 'all') {
    return pool.slice(0, cap).map(m => m.id);
  }

  // byRole：单专家槽位，返回首个命中
  const keywords = ROLE_KEYWORDS[strategy.role] || [];
  const matched = pool.filter(m => {
    const role = String((m as { role?: string }).role || '').toLowerCase();
    return keywords.some(kw => role.includes(kw));
  });
  if (matched.length > 0) return [matched[0].id];
  if (strategy.fallback === undefined || strategy.fallback === 'first') {
    return pool.slice(0, 1).map(m => m.id);
  }
  return [];
}
