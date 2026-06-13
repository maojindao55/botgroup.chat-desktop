import { create } from 'zustand';

/**
 * Global settings for the Agent Workflow Planner.
 *
 * The planner can run in two modes:
 *   - 'rule'  : built-in keyword/template planner (offline, deterministic)
 *   - 'llm'   : delegate planning to a configured LLM model
 *
 * When `mode === 'llm'` but providerId/model is empty, callers should fall
 * back to rule planner and emit a warning.
 */
export type AgentWorkflowPlannerMode = 'rule' | 'llm';

export interface AgentWorkflowPlannerSettings {
  mode: AgentWorkflowPlannerMode;
  providerId: string;
  model: string;
  temperature: number;
  alwaysConfirmBeforeRun: boolean;
}

interface AgentWorkflowPlannerSettingsStore {
  settings: AgentWorkflowPlannerSettings;
  load: () => void;
  update: (patch: Partial<AgentWorkflowPlannerSettings>) => void;
  reset: () => void;
}

const STORAGE_KEY = 'agent_workflow_planner_settings';

const DEFAULTS: AgentWorkflowPlannerSettings = {
  mode: 'rule',
  providerId: '',
  model: '',
  temperature: 0.2,
  alwaysConfirmBeforeRun: true,
};

function safeRead(): AgentWorkflowPlannerSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AgentWorkflowPlannerSettings>;
    return {
      mode: parsed.mode === 'llm' ? 'llm' : 'rule',
      providerId: typeof parsed.providerId === 'string' ? parsed.providerId : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      temperature:
        typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)
          ? Math.max(0, Math.min(2, parsed.temperature))
          : DEFAULTS.temperature,
      alwaysConfirmBeforeRun:
        typeof parsed.alwaysConfirmBeforeRun === 'boolean'
          ? parsed.alwaysConfirmBeforeRun
          : DEFAULTS.alwaysConfirmBeforeRun,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function safeWrite(value: AgentWorkflowPlannerSettings) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch { /* quota / private mode */ }
}

export const useAgentWorkflowPlannerSettings = create<AgentWorkflowPlannerSettingsStore>((set, get) => ({
  settings: safeRead(),
  load: () => {
    set({ settings: safeRead() });
  },
  update: (patch) => {
    const next = { ...get().settings, ...patch };
    if (next.mode !== 'rule' && next.mode !== 'llm') next.mode = 'rule';
    safeWrite(next);
    set({ settings: next });
  },
  reset: () => {
    safeWrite(DEFAULTS);
    set({ settings: { ...DEFAULTS } });
  },
}));

/**
 * Read the current settings synchronously without subscribing.
 * Use this from non-React code (planner dispatcher, runner, etc.).
 */
export function getAgentWorkflowPlannerSettings(): AgentWorkflowPlannerSettings {
  return useAgentWorkflowPlannerSettings.getState().settings;
}

/**
 * `true` when LLM planner is enabled AND both providerId and model are set.
 * Other code should fall back to rule planner when this is `false`.
 */
export function isLLMPlannerReady(s: AgentWorkflowPlannerSettings = getAgentWorkflowPlannerSettings()): boolean {
  return s.mode === 'llm' && !!s.providerId && !!s.model;
}
