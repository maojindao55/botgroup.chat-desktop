import type { AgentWorkflowAgentOutput, AgentWorkflowOutputPolicy } from '@/config/agentWorkflow';
import { resolveLlmCredentials } from '@/utils/resolveLlmCredentials';
import { llmChatComplete } from '@/utils/llmClient';

export interface SummaryOptions {
  providerId?: string;
  model?: string;
  temperature?: number;
}

export interface ApplyOutputPolicyOptions {
  policy?: AgentWorkflowOutputPolicy;
  maxFullChars?: number;
  maxSummaryChars?: number;
  summary?: SummaryOptions;
  caller?: (text: string, opts: SummaryOptions, maxChars: number) => Promise<string>;
}

const DEFAULT_MAX_FULL = 1200;
const DEFAULT_MAX_SUMMARY = 400;

function truncate(text: string, max: number): string {
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n... (truncated)`;
}

export function extractFindings(text: string): string {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const items: string[] = [];
  const bulletRe = /^\s{0,3}([-*•]|\d+[.)])\s+(.+?)\s*$/;
  for (const line of lines) {
    const match = line.match(bulletRe);
    if (match && match[2].trim()) {
      items.push(`- ${match[2].trim()}`);
    }
  }
  const seen = new Set<string>();
  const unique = items.filter(item => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  });
  return unique.join('\n');
}

export function extractDiffBlocks(text: string): string {
  if (!text) return '';
  const fenceRe = /```(?:diff|patch)?\s*\n([\s\S]*?)```/g;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    const body = match[1];
    if (/^[+-@]/m.test(body)) {
      blocks.push(body.trim());
    }
  }
  return blocks.join('\n\n');
}

const defaultSummaryCaller = async (
  text: string,
  opts: SummaryOptions,
  maxChars: number,
): Promise<string> => {
  if (!opts.providerId || !opts.model) {
    throw new Error('summary caller requires providerId and model');
  }
  const creds = await resolveLlmCredentials(opts.model, opts.providerId);
  const result = await llmChatComplete({
    ...creds,
    messages: [
      {
        role: 'system',
        content: `You compress agent outputs into concise summaries for downstream phases. Output prose only, no preamble. Target <= ${maxChars} characters. Preserve concrete facts (file names, numbers, decisions). Drop pleasantries and meta commentary.`,
      },
      { role: 'user', content: text },
    ],
    temperature: opts.temperature ?? 0.2,
  });
  return result.trim();
};

export async function summarizeWithLLM(
  text: string,
  opts: SummaryOptions,
  maxChars = DEFAULT_MAX_SUMMARY,
  caller = defaultSummaryCaller,
): Promise<string> {
  if (!text.trim()) return '';
  if (!opts.providerId || !opts.model) {
    return truncate(text, maxChars);
  }
  try {
    const summary = await caller(text, opts, maxChars);
    if (summary && summary.trim()) return summary.trim();
    return truncate(text, maxChars);
  } catch {
    return truncate(text, maxChars);
  }
}

function joinAgentOutputs(outputs: AgentWorkflowAgentOutput[], maxPerOutput: number): string {
  if (outputs.length === 0) return '';
  if (outputs.length === 1) return truncate(outputs[0].content || '', maxPerOutput);
  return outputs
    .map(o => `### ${o.agentName}\n${truncate(o.content || '', maxPerOutput)}`)
    .join('\n\n');
}

export async function applyOutputPolicy(
  outputs: AgentWorkflowAgentOutput[],
  options: ApplyOutputPolicyOptions = {},
): Promise<string> {
  const policy: AgentWorkflowOutputPolicy = options.policy || 'full';
  const maxFull = options.maxFullChars ?? DEFAULT_MAX_FULL;
  const maxSummary = options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY;

  if (outputs.length === 0) return '';

  if (policy === 'full') {
    return joinAgentOutputs(outputs, maxFull);
  }

  if (policy === 'findings') {
    const merged = outputs
      .map(o => extractFindings(o.content || ''))
      .filter(Boolean)
      .join('\n');
    if (merged.trim()) return merged;
    return joinAgentOutputs(outputs, maxFull);
  }

  if (policy === 'diff') {
    const merged = outputs
      .map(o => extractDiffBlocks(o.content || ''))
      .filter(Boolean)
      .join('\n\n');
    if (merged.trim()) return merged;
    return joinAgentOutputs(outputs, maxFull);
  }

  if (policy === 'summary') {
    const joined = joinAgentOutputs(outputs, maxFull * 2);
    if (!joined.trim()) return '';
    if (!options.summary?.providerId || !options.summary?.model) {
      return truncate(joined, maxSummary);
    }
    return summarizeWithLLM(joined, options.summary, maxSummary, options.caller);
  }

  return joinAgentOutputs(outputs, maxFull);
}
