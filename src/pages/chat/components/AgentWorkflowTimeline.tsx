import { useTranslation } from 'react-i18next';
import type { AgentWorkflowPlan, AgentWorkflowRun, AgentWorkflowPhaseState } from '@/config/agentWorkflow';
import { ChatMarkdown } from '@/components/Markdown';

interface AgentWorkflowTimelineProps {
  run?: AgentWorkflowRun;
  plan?: AgentWorkflowPlan;
  compact?: boolean;
}

const statusColor: Record<string, { bg: string; color: string; border: string }> = {
  pending: { bg: '#f8fafc', color: '#475569', border: '#cbd5e1' },
  running: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
  completed: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  failed: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
  skipped: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  cancelled: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
};

function Pill({ children, color }: { children: string; color?: string }) {
  const theme = color ? statusColor[color] : undefined;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 20,
        padding: '1px 7px',
        borderRadius: 999,
        fontSize: 12,
        lineHeight: '18px',
        border: `1px solid ${theme?.border || '#e2e8f0'}`,
        background: theme?.bg || '#f8fafc',
        color: theme?.color || '#475569',
      }}
    >
      {children}
    </span>
  );
}

function renderPhaseSummary(state?: AgentWorkflowPhaseState) {
  if (!state) return null;
  if (state.summary) return <ChatMarkdown content={state.summary} />;
  if (state.error) return <div style={{ color: '#ef4444' }}>{state.error}</div>;
  return null;
}

export function AgentWorkflowTimeline({ run, plan, compact = false }: AgentWorkflowTimelineProps) {
  const { t } = useTranslation('chat');
  const effectivePlan = run?.plan || plan;
  if (!effectivePlan) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {effectivePlan.phases.map((phase, index) => {
        const state = run?.phaseStates?.[phase.id];
        const status = state?.status || 'pending';
        const agents = state?.selectedAgentIds?.length
          ? state.selectedAgentIds.join(', ')
          : phase.agentSelection.type === 'specific'
            ? phase.agentSelection.agentIds.join(', ')
            : `${t('agentWorkflow.phase.autoSuffix')}${phase.agentSelection.count ? ` × ${phase.agentSelection.count}` : ''}`;

        return (
          <details
            key={phase.id}
            open={status === 'running' || status === 'failed'}
            style={{
              border: '1px solid rgba(148,163,184,0.25)',
              borderRadius: 8,
              padding: '8px 10px',
              background: 'rgba(248,250,252,0.65)',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                listStyle: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontWeight: 600 }}>{index + 1}. {phase.label}</span>
              <Pill color={status}>{t(`agentWorkflow.status.${status}`, status)}</Pill>
              <Pill>{t(`agentWorkflow.phase.mode.${phase.mode}`, phase.mode)}</Pill>
              <Pill>{t(`agentWorkflow.phase.schedule.${phase.schedule}`, phase.schedule)}</Pill>
            </summary>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                {t('agentWorkflow.phase.agentsLabel')}: {agents || '-'}
              </div>
              {!compact && <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{phase.prompt}</div>}
              {renderPhaseSummary(state)}
              {state?.outputs?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {state.outputs.map(output => (
                    <div key={`${phase.id}-${output.agentId}`} style={{ borderTop: '1px solid rgba(148,163,184,0.25)', paddingTop: 8 }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {output.agentName} {output.isError ? <Pill color="failed">{t('agentWorkflow.phase.errorTag')}</Pill> : null}
                      </div>
                      <ChatMarkdown content={output.content || ''} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default AgentWorkflowTimeline;
