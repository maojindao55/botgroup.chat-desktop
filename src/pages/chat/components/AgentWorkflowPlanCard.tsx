import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createStyles } from 'antd-style';
import type { AgentWorkflowPlan, AgentWorkflowRun } from '@/config/agentWorkflow';
import { summarizeWorkflowPlan } from '@/config/agentWorkflow';
import AgentWorkflowTimeline from './AgentWorkflowTimeline';

interface AgentWorkflowPlanCardProps {
  plan: AgentWorkflowPlan;
  run?: AgentWorkflowRun;
  warnings?: string[];
  approvalReason?: string | null;
  running?: boolean;
  revising?: boolean;
  onRun?: () => void;
  onCancel?: () => void;
  onRevise?: (instruction: string) => void;
}

type Tone = 'low' | 'medium' | 'high' | 'planned' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped' | 'pending';

const useStyles = createStyles(({ token, css }) => ({
  root: css`
    display: flex;
    flex-direction: column;
    gap: 12px;
    color: ${token.colorText};
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  `,
  title: css`
    font-weight: 600;
    color: ${token.colorText};
  `,
  description: css`
    margin-top: 6px;
    color: ${token.colorTextSecondary};
    white-space: pre-wrap;
  `,
  approvalBanner: css`
    padding: 8px 10px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorWarningBg};
    color: ${token.colorWarningText};
    border: 1px solid ${token.colorWarningBorder};
  `,
  warningList: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  warningItem: css`
    color: ${token.colorWarningText};
  `,
  reviseBox: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  textarea: css`
    width: 100%;
    box-sizing: border-box;
    border: 1px solid ${token.colorBorder};
    border-radius: ${token.borderRadius}px;
    padding: 8px;
    resize: vertical;
    font: inherit;
    background: ${token.colorBgContainer};
    color: ${token.colorText};
    outline: none;
    transition: border-color 0.15s;

    &::placeholder {
      color: ${token.colorTextPlaceholder};
    }

    &:focus {
      border-color: ${token.colorPrimary};
    }
  `,
  buttonRow: css`
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
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
  pillLow: css`
    background: ${token.colorSuccessBg};
    color: ${token.colorSuccessText};
    border-color: ${token.colorSuccessBorder};
  `,
  pillMedium: css`
    background: ${token.colorWarningBg};
    color: ${token.colorWarningText};
    border-color: ${token.colorWarningBorder};
  `,
  pillHigh: css`
    background: ${token.colorErrorBg};
    color: ${token.colorErrorText};
    border-color: ${token.colorErrorBorder};
  `,
  pillRunning: css`
    background: ${token.colorInfoBg};
    color: ${token.colorInfoText};
    border-color: ${token.colorInfoBorder};
  `,
  btn: css`
    border: 1px solid ${token.colorBorder};
    background: ${token.colorBgContainer};
    color: ${token.colorText};
    border-radius: ${token.borderRadius}px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;

    &:hover:not(:disabled) {
      background: ${token.colorFillTertiary};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `,
  btnPrimary: css`
    border: 1px solid ${token.colorPrimary};
    background: ${token.colorPrimary};
    color: #fff;
    border-radius: ${token.borderRadius}px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;

    &:hover:not(:disabled) {
      background: ${token.colorPrimaryHover};
      border-color: ${token.colorPrimaryHover};
    }

    &:disabled {
      cursor: not-allowed;
      opacity: 0.55;
    }
  `,
  revisingRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: ${token.borderRadius}px;
    background: ${token.colorInfoBg};
    color: ${token.colorInfoText};
    border: 1px solid ${token.colorInfoBorder};
    font-size: 13px;
  `,
  spinner: css`
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid ${token.colorInfoBorder};
    border-top-color: ${token.colorInfo};
    animation: agentPlanCardSpin 0.8s linear infinite;
    flex: none;

    @keyframes agentPlanCardSpin {
      to { transform: rotate(360deg); }
    }
  `,
}));

function toneToPillClass(
  styles: { pillLow: string; pillMedium: string; pillHigh: string; pillRunning: string },
  tone?: Tone,
): string {
  switch (tone) {
    case 'low':
    case 'completed':
      return styles.pillLow;
    case 'medium':
    case 'cancelled':
    case 'skipped':
      return styles.pillMedium;
    case 'high':
    case 'failed':
      return styles.pillHigh;
    case 'running':
      return styles.pillRunning;
    default:
      return '';
  }
}

export function AgentWorkflowPlanCard({
  plan,
  run,
  warnings = [],
  approvalReason,
  running = false,
  revising = false,
  onRun,
  onCancel,
  onRevise,
}: AgentWorkflowPlanCardProps) {
  const { t } = useTranslation('chat');
  const { styles, cx } = useStyles();
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const busy = running || revising;
  const canRun = !!onRun && !busy && (!run || run.status === 'planned');
  const canCancel = !!onCancel && (running || run?.status === 'planned' || run?.status === 'running');
  const canRevise = !!onRevise && !busy && (!run || run.status === 'planned');

  return (
    <div className={styles.root}>
      <div>
        <div className={styles.header}>
          <strong className={styles.title}>{plan.title}</strong>
          <span className={cx(styles.pill, toneToPillClass(styles, plan.riskLevel as Tone))}>
            {t(`agentWorkflow.risk.${plan.riskLevel}`, plan.riskLevel)}
          </span>
          <span className={styles.pill}>{t(`agentWorkflow.intent.${plan.intent}`, plan.intent)}</span>
          {plan.requiresApproval ? (
            <span className={cx(styles.pill, styles.pillHigh)}>{t('agentWorkflow.card.requiresApproval')}</span>
          ) : null}
          {run ? (
            <span className={cx(styles.pill, toneToPillClass(styles, run.status as Tone))}>
              {t(`agentWorkflow.status.${run.status}`, run.status)}
            </span>
          ) : null}
        </div>
        <div className={styles.description}>
          {plan.explanation || summarizeWorkflowPlan(plan)}
        </div>
      </div>

      {approvalReason ? (
        <div className={styles.approvalBanner}>{approvalReason}</div>
      ) : null}

      {warnings.length > 0 ? (
        <div className={styles.warningList}>
          {warnings.map((warning, idx) => (
            <div key={`${idx}-${warning}`} className={styles.warningItem}>
              {t('agentWorkflow.card.warningPrefix')}: {warning}
            </div>
          ))}
        </div>
      ) : null}

      {revising ? (
        <div className={styles.revisingRow}>
          <span className={styles.spinner} />
          <span>{t('agentWorkflow.card.revising', { defaultValue: '正在重新生成计划…' })}</span>
        </div>
      ) : null}

      <AgentWorkflowTimeline run={run} plan={plan} compact />

      {canRevise && editing ? (
        <div className={styles.reviseBox}>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={3}
            placeholder={t('agentWorkflow.card.instructionPlaceholder')}
            className={styles.textarea}
          />
          <div className={styles.buttonRow}>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!instruction.trim()}
              onClick={() => {
                const text = instruction.trim();
                if (!text) return;
                onRevise?.(text);
                setInstruction('');
                setEditing(false);
              }}
            >
              {t('agentWorkflow.card.replan')}
            </button>
            <button type="button" className={styles.btn} onClick={() => setEditing(false)}>
              {t('agentWorkflow.card.cancelEdit')}
            </button>
          </div>
        </div>
      ) : null}

      {(canRun || canCancel || canRevise) ? (
        <div className={styles.buttonRow}>
          {canRun ? (
            <button type="button" className={styles.btnPrimary} onClick={onRun}>
              {t('agentWorkflow.card.run')}
            </button>
          ) : null}
          {canRevise ? (
            <button type="button" className={styles.btn} onClick={() => setEditing(value => !value)}>
              {t('agentWorkflow.card.modify')}
            </button>
          ) : null}
          {canCancel ? (
            <button type="button" className={styles.btn} onClick={onCancel}>
              {t('agentWorkflow.card.cancel')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default AgentWorkflowPlanCard;
