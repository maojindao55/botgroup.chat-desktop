import type { AgentWorkflowPhase, AgentWorkflowRun } from '@/config/agentWorkflow';

export interface VerifierContext {
  phase: AgentWorkflowPhase;
  run: AgentWorkflowRun;
  userMessage: string;
}

export function wrapVerifierPrompt(ctx: VerifierContext): string {
  const { phase, run } = ctx;
  const targets = (phase.dependsOn || [])
    .map(depId => {
      const depPhase = run.plan.phases.find(p => p.id === depId);
      const depState = run.phaseStates[depId];
      const summary = depState?.summary || depState?.error || '(no output)';
      return `[Phase: ${depPhase?.label || depId}]\n${summary}`;
    })
    .join('\n\n');

  return [
    'You are a verifier. Decide whether the previous phases satisfy the criteria below.',
    '',
    '[CRITERIA]',
    phase.prompt,
    '',
    '[USER REQUEST]',
    ctx.userMessage,
    '',
    '[PHASES TO VERIFY]',
    targets,
    '',
    '[OUTPUT FORMAT]',
    'First line: PASS or FAIL.',
    'Subsequent lines (max 200 words): brief reasoning. If FAIL, prefer a markdown list of concrete issues.',
  ].join('\n');
}

export interface VerdictResult {
  verdict: 'pass' | 'fail';
  reasoning: string;
}

const PASS_FALLBACK_RE = /(?:\b(approve[ds]?|approval|looks good|lgtm)\b|通过|满足|符合|合格)/i;
const FAIL_FALLBACK_RE = /(?:\b(reject(ed)?|insufficient|not\s+sufficient|missing)\b|不通过|不满足|不符合|不合格|未通过|缺失)/i;

export function parseVerdict(output: string): VerdictResult {
  const text = (output || '').trim();
  if (!text) {
    return { verdict: 'pass', reasoning: '(empty output, defaulting to pass)' };
  }
  const lines = text.split(/\r?\n/);
  const firstLine = lines[0].trim();
  if (/^pass\b/i.test(firstLine)) {
    return { verdict: 'pass', reasoning: lines.slice(1).join('\n').trim() || firstLine };
  }
  if (/^fail\b/i.test(firstLine)) {
    return { verdict: 'fail', reasoning: lines.slice(1).join('\n').trim() || firstLine };
  }
  if (FAIL_FALLBACK_RE.test(text)) {
    return { verdict: 'fail', reasoning: text };
  }
  if (PASS_FALLBACK_RE.test(text)) {
    return { verdict: 'pass', reasoning: text };
  }
  return { verdict: 'pass', reasoning: text };
}
