import type { CLIAgent } from '@/config/aiCharacters';

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
  if (agent.cli?.adapter !== 'opencode' && agent.cli?.adapter !== 'codex' && agent.cli?.adapter !== 'claude') return agent;
  if (!sessionId) return agent;

  const extraArgs = agent.cli.extraArgs || [];
  const hasExplicitSession = extraArgs.some((arg) =>
    arg === '--session' ||
    arg.startsWith('--session=') ||
    arg === '--session-id' ||
    arg.startsWith('--session-id=') ||
    arg === '--resume' ||
    arg.startsWith('--resume=') ||
    arg === '-r' ||
    arg === '-s' ||
    arg === '--continue' ||
    arg === '-c' ||
    arg === 'resume' ||
    arg === '--last'
  );
  if (hasExplicitSession) return agent;

  return {
    ...agent,
    cli: {
      ...agent.cli,
      toolSessionId: sessionId,
    },
  };
}
