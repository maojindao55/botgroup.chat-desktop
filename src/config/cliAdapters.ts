export type CLIAdapterId =
  | 'codex'
  | 'claude'
  | 'opencode'
  | 'cursor'
  | 'qodercli'
  | 'antigravity'
  | (string & {});

export type CLIStreamMode =
  | 'codex-json'
  | 'claude-json'
  | 'opencode-json'
  | 'cursor-json'
  | 'qoder-json'
  | 'raw';

export interface CLIAdapterDefinition {
  id: CLIAdapterId;
  label: string;
  defaultBinary?: string;
  streamMode: CLIStreamMode;
  commandGroup?: string;
  capabilities: {
    toolSession: boolean;
    openCodeSessionTitle?: boolean;
  };
  toolSessionArgs?: string[];
  toolSessionArgPrefixes?: string[];
  /** Shell command to install the CLI locally (shown in pre-flight guidance). */
  installHint?: string;
  /** Official installation / docs URL (shown in pre-flight guidance). */
  docsUrl?: string;
}

export const cliAdapterDefinitions: CLIAdapterDefinition[] = [
  {
    id: 'codex',
    label: 'Codex',
    defaultBinary: 'codex',
    streamMode: 'codex-json',
    commandGroup: 'codex',
    capabilities: { toolSession: true },
    toolSessionArgs: ['resume', '--last'],
    installHint: 'npm install -g @openai/codex',
    docsUrl: 'https://github.com/openai/codex',
  },
  {
    id: 'claude',
    label: 'Claude Code',
    defaultBinary: 'claude',
    streamMode: 'claude-json',
    commandGroup: 'claude',
    capabilities: { toolSession: true },
    toolSessionArgs: ['--resume', '-r', '--continue', '-c', '--session-id'],
    toolSessionArgPrefixes: ['--resume=', '--session-id='],
    installHint: 'npm install -g @anthropic-ai/claude-code',
    docsUrl: 'https://docs.anthropic.com/en/docs/claude-code',
  },
  {
    id: 'opencode',
    label: 'OpenCode',
    defaultBinary: 'opencode',
    streamMode: 'opencode-json',
    commandGroup: 'opencode',
    capabilities: { toolSession: true, openCodeSessionTitle: true },
    toolSessionArgs: ['--session', '-s', '--continue', '-c'],
    toolSessionArgPrefixes: ['--session='],
    installHint: 'npm install -g opencode-ai',
    docsUrl: 'https://opencode.ai/docs',
  },
  {
    id: 'cursor',
    label: 'Cursor Agent',
    defaultBinary: 'cursor-agent',
    streamMode: 'cursor-json',
    commandGroup: 'cursor',
    capabilities: { toolSession: true },
    toolSessionArgs: ['--resume', '--continue'],
    toolSessionArgPrefixes: ['--resume='],
    installHint: 'curl https://cursor.com/install -fsS | bash',
    docsUrl: 'https://docs.cursor.com/en/cli/installation',
  },
  {
    id: 'qodercli',
    label: 'Qoder CLI',
    defaultBinary: 'qodercli',
    streamMode: 'qoder-json',
    commandGroup: 'qoder',
    capabilities: { toolSession: true },
    toolSessionArgs: ['-r', '--resume', '-c', '--continue'],
    toolSessionArgPrefixes: ['--resume='],
    docsUrl: 'https://docs.qoder.com/en/cli',
  },
  {
    id: 'antigravity',
    label: 'Antigravity CLI',
    defaultBinary: 'agy',
    streamMode: 'raw',
    commandGroup: 'antigravity',
    capabilities: { toolSession: false },
    toolSessionArgs: ['--continue', '--conversation'],
    toolSessionArgPrefixes: ['--conversation='],
    installHint: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    docsUrl: 'https://antigravity.google/docs/cli-overview',
  },
];

const definitionsById = new Map(cliAdapterDefinitions.map((definition) => [definition.id, definition]));

export function getCLIAdapterDefinition(adapter: string): CLIAdapterDefinition {
  const known = definitionsById.get(adapter as CLIAdapterId);
  if (known) return known;
  return {
    id: adapter as CLIAdapterId,
    label: adapter,
    streamMode: 'raw',
    capabilities: { toolSession: false },
  };
}

export function supportsCliToolSession(adapter: string | null | undefined): boolean {
  if (!adapter) return false;
  return getCLIAdapterDefinition(adapter).capabilities.toolSession;
}

export function adapterUsesOpenCodeSessionTitle(adapter: string | null | undefined): boolean {
  if (!adapter) return false;
  return getCLIAdapterDefinition(adapter).capabilities.openCodeSessionTitle === true;
}

export function hasExplicitToolSessionArg(
  adapter: string | null | undefined,
  extraArgs: string[] | null | undefined,
): boolean {
  if (!adapter || !extraArgs?.length) return false;
  const definition = getCLIAdapterDefinition(adapter);
  const exactArgs = definition.toolSessionArgs || [];
  const argPrefixes = definition.toolSessionArgPrefixes || [];

  return extraArgs.some((arg) =>
    exactArgs.includes(arg) ||
    argPrefixes.some((prefix) => arg.startsWith(prefix))
  );
}
