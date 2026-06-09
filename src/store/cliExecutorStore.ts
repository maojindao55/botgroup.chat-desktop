import { create } from 'zustand';

import { hasExplicitToolSessionArg, cliAdapterDefinitions, type CLIAdapterDefinition, type CLIAdapterId } from '@/config/cliAdapters';

export interface CLIExecutorOverride {
  id: CLIAdapterId;
  /** 自定义执行器复用哪个内置 adapter 的协议与运行逻辑 */
  baseAdapter?: CLIAdapterId;
  label?: string;
  binary?: string;
  extraArgs?: string[];
  installHint?: string;
  docsUrl?: string;
  enabled?: boolean;
}

export interface ResolvedCLIExecutor extends CLIAdapterDefinition {
  /** 真正传给 Rust/stream parser 的内置 adapter id */
  runtimeAdapter: string;
  baseAdapter?: string;
  binary: string;
  extraArgs: string[];
  enabled: boolean;
  source: 'builtin' | 'customized' | 'custom';
}

interface CLIExecutorStore {
  overrides: Record<string, CLIExecutorOverride>;
  listResolved: () => ResolvedCLIExecutor[];
  getResolved: (id: string | null | undefined) => ResolvedCLIExecutor | undefined;
  getOverride: (id: string) => CLIExecutorOverride | undefined;
  upsertOverride: (override: CLIExecutorOverride) => void;
  resetOverride: (id: string) => void;
  duplicateExecutor: (id: string) => ResolvedCLIExecutor | undefined;
}

const STORAGE_KEY = 'cli_executor_overrides';

function readOverrides(): Record<string, CLIExecutorOverride> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CLIExecutorOverride[];
    if (!Array.isArray(parsed)) return {};
    const record: Record<string, CLIExecutorOverride> = {};
    parsed.forEach((item) => {
      if (item?.id) {
        record[item.id] = {
          ...item,
          extraArgs: Array.isArray(item.extraArgs) ? item.extraArgs : [],
        };
      }
    });
    return record;
  } catch (e) {
    console.error('Failed to read CLI executor overrides', e);
    return {};
  }
}

function writeOverrides(overrides: Record<string, CLIExecutorOverride>) {
  if (typeof localStorage === 'undefined') return;
  const list = Object.values(overrides);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export function resolveExecutor(definition: CLIAdapterDefinition, override?: CLIExecutorOverride): ResolvedCLIExecutor {
  return {
    ...definition,
    runtimeAdapter: definition.id,
    label: override?.label?.trim() || definition.label,
    defaultBinary: definition.defaultBinary,
    binary: override?.binary?.trim() || definition.defaultBinary || definition.id,
    extraArgs: override?.extraArgs?.filter(Boolean) || [],
    installHint: override?.installHint ?? definition.installHint,
    docsUrl: override?.docsUrl ?? definition.docsUrl,
    enabled: override?.enabled !== false,
    source: override ? 'customized' : 'builtin',
  };
}

function resolveCustomExecutor(override: CLIExecutorOverride): ResolvedCLIExecutor | undefined {
  const base = cliAdapterDefinitions.find((definition) => definition.id === override.baseAdapter);
  if (!base) return undefined;
  return {
    ...base,
    id: override.id,
    runtimeAdapter: base.id,
    baseAdapter: base.id,
    label: override.label?.trim() || `${base.label} Copy`,
    binary: override.binary?.trim() || base.defaultBinary || base.id,
    extraArgs: override.extraArgs?.filter(Boolean) || [],
    installHint: override.installHint ?? base.installHint,
    docsUrl: override.docsUrl ?? base.docsUrl,
    enabled: override.enabled !== false,
    source: 'custom',
  };
}

export function resolveCLIExecutors(overrides: Record<string, CLIExecutorOverride>): ResolvedCLIExecutor[] {
  const builtinExecutors = cliAdapterDefinitions.map((definition) =>
    resolveExecutor(definition, overrides[definition.id]),
  );
  const builtinIds = new Set(cliAdapterDefinitions.map((definition) => definition.id));
  const customExecutors = Object.values(overrides)
    .filter((override) => override.baseAdapter && !builtinIds.has(override.id))
    .map(resolveCustomExecutor)
    .filter((executor): executor is ResolvedCLIExecutor => !!executor);
  return [...builtinExecutors, ...customExecutors];
}

export function parseCLICommandInput(input: string | null | undefined): { binary?: string; args: string[] } {
  const text = input?.trim();
  if (!text) return { args: [] };
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) parts.push(current);

  return {
    binary: parts[0],
    args: parts.slice(1),
  };
}

export function resolveCLIExecutorForConfig(
  overrides: Record<string, CLIExecutorOverride>,
  adapter: string | null | undefined,
  binary?: string | null,
): ResolvedCLIExecutor | undefined {
  const adapterId = adapter || 'codex';
  const executors = resolveCLIExecutors(overrides);
  const direct = executors.find((executor) => executor.id === adapterId);
  const parsedBinary = parseCLICommandInput(binary).binary;
  const trimmedBinary = binary?.trim();
  if ((trimmedBinary || parsedBinary) && (!direct || direct.source === 'builtin')) {
    const runtimeAdapter = direct?.runtimeAdapter || adapterId;
    const byBinary = executors.find((executor) => {
      const executorCommand = parseCLICommandInput(executor.binary);
      return executor.source === 'custom'
        && executor.runtimeAdapter === runtimeAdapter
        && (executor.binary === trimmedBinary || executorCommand.binary === parsedBinary);
    });
    if (byBinary) return byBinary;
  }
  return direct;
}

export function mergeCLIExtraArgs(
  executorExtraArgs: string[] | null | undefined,
  memberExtraArgs: string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  [...(executorExtraArgs || []), ...(memberExtraArgs || [])]
    .filter(Boolean)
    .forEach((arg) => {
      if (seen.has(arg)) return;
      seen.add(arg);
      merged.push(arg);
    });
  return merged;
}

export function applyExecutorDefaultsToCliConfig<T extends {
  adapter?: string;
  binary?: string;
  extraArgs?: string[];
  toolSessionId?: string;
  env?: Record<string, string>;
  approvalMode?: 'auto' | 'ask';
  showStderr?: boolean;
  wsl?: boolean;
  wslDistro?: string;
}>(cli: T): T {
  const adapter = cli.adapter || 'codex';
  const executor = resolveCLIExecutorForConfig(readOverrides(), adapter, cli.binary);
  if (!executor) return cli;
  const executorCommand = parseCLICommandInput(executor.binary);
  const memberCommand = parseCLICommandInput(cli.binary);
  const resolvedBinary = memberCommand.binary || executorCommand.binary || executor.binary;
  const executorExtraArgs = [...executorCommand.args, ...(executor.extraArgs || [])];
  const memberExtraArgs = [...memberCommand.args, ...(cli.extraArgs || [])];
  const mergedExtraArgs = mergeCLIExtraArgs(executorExtraArgs, memberExtraArgs);
  const toolSessionId = cli.toolSessionId;
  const runtimeAdapter = executor.runtimeAdapter;
  const shouldDropToolSession = toolSessionId
    && executorExtraArgs.length > 0
    && hasExplicitToolSessionArg(runtimeAdapter, executorExtraArgs);

  return {
    ...cli,
    adapter: runtimeAdapter,
    binary: resolvedBinary,
    extraArgs: mergedExtraArgs,
    toolSessionId: shouldDropToolSession ? undefined : toolSessionId,
  };
}

export const useCLIExecutorStore = create<CLIExecutorStore>((set, get) => ({
  overrides: readOverrides(),

  listResolved: () => resolveCLIExecutors(get().overrides),

  getResolved: (id) => {
    if (!id) return undefined;
    return resolveCLIExecutors(get().overrides).find((executor) => executor.id === id);
  },

  getOverride: (id) => get().overrides[id],

  upsertOverride: (override) => {
    const next = {
      ...get().overrides,
      [override.id]: {
        ...override,
        baseAdapter: override.baseAdapter,
        label: override.label?.trim() || undefined,
        binary: override.binary?.trim() || undefined,
        extraArgs: override.extraArgs?.filter(Boolean) || [],
        installHint: override.installHint ?? undefined,
        docsUrl: override.docsUrl ?? undefined,
        enabled: override.enabled !== false,
      },
    };
    writeOverrides(next);
    set({ overrides: next });
  },

  resetOverride: (id) => {
    const next = { ...get().overrides };
    delete next[id];
    writeOverrides(next);
    set({ overrides: next });
  },

  duplicateExecutor: (id) => {
    const source = get().getResolved(id);
    if (!source) return undefined;
    const baseAdapter = source.baseAdapter || source.runtimeAdapter;
    const baseId = `${source.id}-copy`;
    let nextId = baseId;
    let index = 2;
    const existingIds = new Set(resolveCLIExecutors(get().overrides).map((executor) => executor.id));
    while (existingIds.has(nextId)) {
      nextId = `${baseId}-${index}`;
      index += 1;
    }
    const override: CLIExecutorOverride = {
      id: nextId,
      baseAdapter: baseAdapter as CLIAdapterId,
      label: `${source.label} Copy`,
      binary: source.binary,
      extraArgs: [...source.extraArgs],
      installHint: source.installHint,
      docsUrl: source.docsUrl,
      enabled: source.enabled,
    };
    const next = {
      ...get().overrides,
      [nextId]: override,
    };
    writeOverrides(next);
    set({ overrides: next });
    return resolveCustomExecutor(override);
  },
}));
