import type { CLIAgent } from '@/config/aiCharacters';
import { hasExplicitToolSessionArg, supportsCliToolSession } from '@/config/cliAdapters';

export type CLISessionPolicy = 'task' | 'workspace' | 'template';

const DEFAULT_SESSION_POLICY: CLISessionPolicy = 'task';

export function cliToolSessionKey(scopeId: string, agentId: string, workspacePath: string): string {
  return `cliToolSession:${scopeId}:${agentId}:${workspacePath}`;
}

/** 根据 session 策略生成 localStorage key 的作用域 ID */
export function resolveCliToolSessionScope(params: {
  developmentTaskId: string;
  templateId: string;
  workspacePath: string;
  sessionPolicy?: CLISessionPolicy;
}): string {
  const policy = params.sessionPolicy ?? DEFAULT_SESSION_POLICY;
  switch (policy) {
    case 'workspace':
      return `ws:${params.workspacePath}`;
    case 'template':
      return params.templateId;
    case 'task':
    default:
      return params.developmentTaskId;
  }
}

/** 按 session 策略生成 tool session 的 localStorage key */
export function resolveCliToolSessionKey(params: {
  developmentTaskId: string;
  templateId: string;
  agentId: string;
  workspacePath: string;
  sessionPolicy?: CLISessionPolicy;
}): string {
  const scopeId = resolveCliToolSessionScope({
    developmentTaskId: params.developmentTaskId,
    templateId: params.templateId,
    workspacePath: params.workspacePath,
    sessionPolicy: params.sessionPolicy,
  });
  return cliToolSessionKey(scopeId, params.agentId, params.workspacePath);
}

export function withCliToolSession(agent: CLIAgent, sessionId: string | null | undefined): CLIAgent {
  if (!supportsCliToolSession(agent.cli?.adapter)) return agent;
  if (!sessionId) return agent;

  const extraArgs = agent.cli.extraArgs || [];
  const hasExplicitSession = hasExplicitToolSessionArg(agent.cli.adapter, extraArgs);
  if (hasExplicitSession) return agent;

  return {
    ...agent,
    cli: {
      ...agent.cli,
      toolSessionId: sessionId,
    },
  };
}
