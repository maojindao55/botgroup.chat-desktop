import { useTranslation } from 'react-i18next';
import { createStyles } from 'antd-style';
import { ShieldCheck } from 'lucide-react';
import type { AgentWorkflowPlan, AgentWorkflowRun, AgentWorkflowPhaseState } from '@/config/agentWorkflow';
import { ChatMarkdown } from '@/components/Markdown';

interface AgentWorkflowTimelineProps {
  run?: AgentWorkflowRun;
  plan?: AgentWorkflowPlan;
  compact?: boolean;
}

type StatusKey = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  phase: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: ${token.borderRadius}px;
    padding: 8px 10px;
    background: ${token.colorFillQuaternary};
    color: ${token.colorText};
  `,
  summary: css`
    cursor: pointer;
    list-style: none;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  `,
  summaryIndex: css`
    font-weight: 600;
    color: ${token.colorText};
  `,
  body: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
  `,
  agentsLabel: css`
    color: ${token.colorTextSecondary};
    font-size: ${token.fontSizeSM}px;
  `,
  promptText: css`
    white-space: pre-wrap;
    font-size: 13px;
    color: ${token.colorText};
  `,
  errorText: css`
    color: ${token.colorErrorText};
  `,
  outputs: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  outputItem: css`
    border-top: 1px solid ${token.colorBorderSecondary};
    padding-top: 8px;
  `,
  outputHeader: css`
    font-weight: 600;
    margin-bottom: 4px;
    color: ${token.colorText};
  `,
  pill: css`
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 12px;
    line-height: 18px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorFillQuaternary};
    color: ${token.colorTextSecondary};
  `,
  pillPending: css`
    background: ${token.colorFillQuaternary};
    color: ${token.colorTextSecondary};
    border-color: ${token.colorBorderSecondary};
  `,
  pillRunning: css`
    background: ${token.colorInfoBg};
    color: ${token.colorInfoText};
    border-color: ${token.colorInfoBorder};
  `,
  pillCompleted: css`
    background: ${token.colorSuccessBg};
    color: ${token.colorSuccessText};
    border-color: ${token.colorSuccessBorder};
  `,
  pillFailed: css`
    background: ${token.colorErrorBg};
    color: ${token.colorErrorText};
    border-color: ${token.colorErrorBorder};
  `,
  pillSkipped: css`
    background: ${token.colorWarningBg};
    color: ${token.colorWarningText};
    border-color: ${token.colorWarningBorder};
  `,
  icon: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    flex: none;
  `,
  attempt: css`
    color: ${token.colorTextSecondary};
    font-size: ${token.fontSizeSM}px;
  `,
  verdictPass: css`
    background: ${token.colorSuccessBg};
    color: ${token.colorSuccessText};
    border-color: ${token.colorSuccessBorder};
  `,
  verdictFail: css`
    background: ${token.colorErrorBg};
    color: ${token.colorErrorText};
    border-color: ${token.colorErrorBorder};
  `,
}));

function statusToPillClass(
  styles: {
    pillPending: string;
    pillRunning: string;
    pillCompleted: string;
    pillFailed: string;
    pillSkipped: string;
  },
  status?: string,
): string {
  switch (status as StatusKey) {
    case 'running':
      return styles.pillRunning;
    case 'completed':
      return styles.pillCompleted;
    case 'failed':
      return styles.pillFailed;
    case 'skipped':
    case 'cancelled':
      return styles.pillSkipped;
    case 'pending':
    default:
      return styles.pillPending;
  }
}

function renderPhaseSummary(state: AgentWorkflowPhaseState | undefined, errorClass: string) {
  if (!state) return null;
  if (state.summary) return <ChatMarkdown content={state.summary} />;
  if (state.error) return <div className={errorClass}>{state.error}</div>;
  return null;
}

export function AgentWorkflowTimeline({ run, plan, compact = false }: AgentWorkflowTimelineProps) {
  const { t } = useTranslation('chat');
  const { styles, cx } = useStyles();
  const effectivePlan = run?.plan || plan;
  if (!effectivePlan) return null;

  return (
    <div className={styles.root}>
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
            className={styles.phase}
          >
            <summary className={styles.summary}>
              <span className={styles.summaryIndex}>
                {phase.mode === 'verifier' ? (
                  <ShieldCheck className={styles.icon} />
                ) : null}
                {index + 1}. {phase.label}
              </span>
              <span className={cx(styles.pill, statusToPillClass(styles, status))}>
                {t(`agentWorkflow.status.${status}`, status)}
              </span>
              {state && state.attempts && state.attempts > 1 ? (
                <span className={cx(styles.pill, styles.attempt)}>
                  {t('agentWorkflow.phase.attempt', { count: state.attempts })}
                </span>
              ) : null}
              {phase.mode === 'verifier' && state?.verdict ? (
                <span
                  className={cx(
                    styles.pill,
                    state.verdict === 'pass' ? styles.verdictPass : styles.verdictFail,
                  )}
                >
                  {t(`agentWorkflow.phase.verdict.${state.verdict}`, state.verdict)}
                </span>
              ) : null}
              <span className={styles.pill}>{t(`agentWorkflow.phase.mode.${phase.mode}`, phase.mode)}</span>
              <span className={styles.pill}>{t(`agentWorkflow.phase.schedule.${phase.schedule}`, phase.schedule)}</span>
            </summary>
            <div className={styles.body}>
              <div className={styles.agentsLabel}>
                {t('agentWorkflow.phase.agentsLabel')}: {agents || '-'}
              </div>
              {!compact && <div className={styles.promptText}>{phase.prompt}</div>}
              {renderPhaseSummary(state, styles.errorText)}
              {state?.verdictReasoning ? (
                <div className={styles.outputs}>
                  <div className={styles.outputItem}>
                    <div className={styles.outputHeader}>
                      {t('agentWorkflow.phase.verdictLabel')}
                    </div>
                    <ChatMarkdown content={state.verdictReasoning} />
                  </div>
                </div>
              ) : null}
              {state?.outputs?.length ? (
                <div className={styles.outputs}>
                  {state.outputs.map(output => (
                    <div key={`${phase.id}-${output.agentId}`} className={styles.outputItem}>
                      <div className={styles.outputHeader}>
                        {output.agentName}{' '}
                        {output.isError ? (
                          <span className={cx(styles.pill, styles.pillFailed)}>
                            {t('agentWorkflow.phase.errorTag')}
                          </span>
                        ) : null}
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
