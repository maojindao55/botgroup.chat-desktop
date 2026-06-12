import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentWorkflowPlan, AgentWorkflowRun } from '@/config/agentWorkflow';
import { summarizeWorkflowPlan } from '@/config/agentWorkflow';
import AgentWorkflowTimeline from './AgentWorkflowTimeline';

interface AgentWorkflowPlanCardProps {
  plan: AgentWorkflowPlan;
  run?: AgentWorkflowRun;
  warnings?: string[];
  approvalReason?: string | null;
  running?: boolean;
  onRun?: () => void;
  onCancel?: () => void;
  onRevise?: (instruction: string) => void;
}

const riskColor: Record<string, { bg: string; color: string; border: string }> = {
  low: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' },
  medium: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
  high: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
};

function Pill({ children, tone }: { children: string; tone?: string }) {
  const theme = tone ? riskColor[tone] : undefined;
  return (
    <span style={{
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
    }}>
      {children}
    </span>
  );
}

function PlainButton({
  children,
  primary = false,
  disabled = false,
  onClick,
}: {
  children: string;
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        border: primary ? '1px solid #f97316' : '1px solid #e2e8f0',
        background: primary ? '#f97316' : '#fff',
        color: primary ? '#fff' : '#334155',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function AgentWorkflowPlanCard({
  plan,
  run,
  warnings = [],
  approvalReason,
  running = false,
  onRun,
  onCancel,
  onRevise,
}: AgentWorkflowPlanCardProps) {
  const { t } = useTranslation('chat');
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const canRun = !!onRun && !running && (!run || run.status === 'planned');
  const canCancel = !!onCancel && (running || run?.status === 'planned' || run?.status === 'running');
  const canRevise = !!onRevise && !running && (!run || run.status === 'planned');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong>{plan.title}</strong>
          <Pill tone={plan.riskLevel}>{t(`agentWorkflow.risk.${plan.riskLevel}`, plan.riskLevel)}</Pill>
          <Pill>{t(`agentWorkflow.intent.${plan.intent}`, plan.intent)}</Pill>
          {plan.requiresApproval ? <Pill tone="high">{t('agentWorkflow.card.requiresApproval')}</Pill> : null}
          {run ? (
            <Pill tone={run.status === 'completed' ? 'low' : run.status === 'failed' ? 'high' : 'medium'}>
              {t(`agentWorkflow.status.${run.status}`, run.status)}
            </Pill>
          ) : null}
        </div>
        <div style={{ marginTop: 6, color: '#64748b', whiteSpace: 'pre-wrap' }}>
          {plan.explanation || summarizeWorkflowPlan(plan)}
        </div>
      </div>

      {approvalReason ? (
        <div style={{ color: '#b45309', background: 'rgba(251,191,36,0.12)', padding: 8, borderRadius: 8 }}>
          {approvalReason}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {warnings.map((warning, idx) => (
            <div key={`${idx}-${warning}`} style={{ color: '#b45309' }}>
              {t('agentWorkflow.card.warningPrefix')}: {warning}
            </div>
          ))}
        </div>
      ) : null}

      <AgentWorkflowTimeline run={run} plan={plan} compact />

      {canRevise && editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            rows={3}
            placeholder={t('agentWorkflow.card.instructionPlaceholder')}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 8,
              resize: 'vertical',
              font: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <PlainButton
              primary
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
            </PlainButton>
            <PlainButton onClick={() => setEditing(false)}>{t('agentWorkflow.card.cancelEdit')}</PlainButton>
          </div>
        </div>
      ) : null}

      {(canRun || canCancel || canRevise) ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canRun ? <PlainButton primary onClick={onRun}>{t('agentWorkflow.card.run')}</PlainButton> : null}
          {canRevise ? <PlainButton onClick={() => setEditing(value => !value)}>{t('agentWorkflow.card.modify')}</PlainButton> : null}
          {canCancel ? <PlainButton onClick={onCancel}>{t('agentWorkflow.card.cancel')}</PlainButton> : null}
        </div>
      ) : null}
    </div>
  );
}

export default AgentWorkflowPlanCard;
