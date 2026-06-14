import type { AgentWorkflowIntent } from '@/config/agentWorkflow';

interface KeywordSet {
  intent: AgentWorkflowIntent;
  patterns: RegExp[];
}

// 按优先级从高到低；命中即定。
const KEYWORDS: KeywordSet[] = [
  { intent: 'review', patterns: [/复审|审查|改完.*审|修复.*复审|review.*then|then.*review/i] },
  {
    intent: 'implement',
    patterns: [/实现|修改|修复|重构|新增|开发|编写|写代码|写一个|写个|implement|develop|fix|refactor|build|write|create/i],
  },
  {
    intent: 'multi_solution',
    patterns: [/多(?:种|个)方案|几种方案|分别.*方案|备选|对比方案|方案对比|alternatives|options|multiple solutions|compare approaches/i],
  },
  { intent: 'audit', patterns: [/审计|排查|排错|diagnose|investigate|audit|troubleshoot/i] },
  { intent: 'discuss', patterns: [/讨论|分析|怎么看|看法|意见|评估|brainstorm|discuss|analyze|opinion|thoughts/i] },
];

/** 关键词意图分类。无命中返回 'quick'。纯函数、零依赖。 */
export function classifyIntent(message: string): AgentWorkflowIntent {
  const text = message || '';
  for (const { intent, patterns } of KEYWORDS) {
    if (patterns.some(re => re.test(text))) return intent;
  }
  return 'quick';
}

export interface DegradeContext {
  memberCount: number;
  workspaceReady: boolean;
}

export interface DegradeResult {
  intent: AgentWorkflowIntent;
  reason?: string;
}

/** 能力降级：成员不足 / 无 workspace 时把不可能的 intent 降到可行形态。 */
export function degradeIntent(intent: AgentWorkflowIntent, ctx: DegradeContext): DegradeResult {
  const needsMany = intent === 'discuss' || intent === 'multi_solution' || intent === 'audit';
  if (needsMany && ctx.memberCount < 2) {
    return { intent: 'quick', reason: 'not enough members for collaboration' };
  }
  if (intent === 'implement' && !ctx.workspaceReady) {
    return { intent: 'quick', reason: 'no workspace; implement downgraded to quick' };
  }
  if (intent === 'review' && !ctx.workspaceReady) {
    return { intent: 'audit', reason: 'no workspace; review downgraded to read-only audit' };
  }
  if (intent === 'review' && ctx.memberCount < 2) {
    return { intent: 'implement', reason: 'cannot pick a distinct reviewer; dropping verifier' };
  }
  return { intent };
}
