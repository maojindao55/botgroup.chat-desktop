import type { CLIAgent } from '@/config/aiCharacters';

export function cliToolSessionKey(groupId: string, agentId: string, workspacePath: string): string {
  return `cliToolSession:${groupId}:${agentId}:${workspacePath}`;
}

export function withCliToolSession(agent: CLIAgent, sessionId: string | null | undefined): CLIAgent {
  if (agent.cli?.adapter !== 'opencode' && agent.cli?.adapter !== 'codex') return agent;
  if (!sessionId) return agent;

  const extraArgs = agent.cli.extraArgs || [];
  const hasExplicitSession = extraArgs.some((arg) =>
    arg === '--session' ||
    arg.startsWith('--session=') ||
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
