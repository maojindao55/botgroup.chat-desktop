/**
 * 团队模板列表 — 管理所有 CLI 团队模板，修改仅影响未来新任务
 */
import { Button, Drawer } from 'antd';
import { Plus, Settings2, Trash2, X } from 'lucide-react';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { getCLIWorkflowLabel } from '@/config/groupProduct';
import type { CLITeamTemplate } from '@/config/cliTasks';

const useStyles = createStyles(({ token, css }) => ({
  inlinePanel: css`
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
  `,
  inlineHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
  `,
  inlineTitle: css`
    font-size: 14px;
    font-weight: 600;
  `,
  inlineCloseBtn: css`
    border: none;
    background: transparent;
    cursor: pointer;
    opacity: 0.6;
    display: flex;
    padding: 4px;
    &:hover { opacity: 1; }
  `,
  content: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  hint: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.5;
  `,
  card: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 12px;
    padding: 12px;
    background: ${token.colorFillTertiary};
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  cardHeader: css`
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  `,
  cardTitle: css`
    font-size: 13px;
    font-weight: 600;
  `,
  cardDesc: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.4;
  `,
  meta: css`
    font-size: 10px;
    color: ${token.colorTextTertiary};
  `,
  settingsBtn: css`
    flex: none;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    border-radius: 8px;
    padding: 6px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: ${token.colorTextSecondary};
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  cardActions: css`
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  `,
  deleteBtn: css`
    flex: none;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    border-radius: 8px;
    padding: 6px 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    color: ${token.colorTextTertiary};
    &:hover {
      border-color: #ff4d4f;
      color: #ff4d4f;
    }
  `,
}));

interface CLITemplateListPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: CLITeamTemplate[];
  taskCountByTemplate: Record<string, number>;
  onOpenTemplateSettings: (templateId: string) => void;
  onCreateTemplate?: () => void;
  onDeleteTemplate?: (templateId: string) => void;
  inline?: boolean;
}

export const CLITemplateListPanel = ({
  open,
  onOpenChange,
  templates,
  taskCountByTemplate,
  onOpenTemplateSettings,
  onCreateTemplate,
  onDeleteTemplate,
  inline,
}: CLITemplateListPanelProps) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['cli', 'product']);

  const workflowLabel = (template: CLITeamTemplate) => {
    const fallback = getCLIWorkflowLabel(template.strategy, template.workflowTemplateId);
    const id = template.workflowTemplateId;
    if (id) {
      return t(`product:cliWorkflowTemplates.${id}.label`, { defaultValue: fallback });
    }
    return fallback;
  };

  const sessionPolicyText = (policy: CLITeamTemplate['sessionPolicy']) =>
    t(`product:cliSessionPolicy.${policy}.label`, { defaultValue: policy });

  if (!open) {
    if (inline) return null;
    return null;
  }

  const body = (
    <div className={styles.content}>
      <div className={styles.hint}>
        {t('cli:templateList.hint')}
      </div>
      {templates.length === 0 && (
        <div className={styles.hint}>
          {t('cli:templateList.emptyHint')}
        </div>
      )}
      {onCreateTemplate && (
        <Button
          type="primary"
          block
          icon={<Plus size={14} />}
          onClick={onCreateTemplate}
          style={{ background: '#ff6600', borderColor: '#ff6600', height: 36, borderRadius: 10 }}
        >
          {t('cli:templateList.create')}
        </Button>
      )}
      {templates.map(template => (
        <div key={template.id} className={styles.card}>
          <div className={styles.cardHeader}>
            <div style={{ minWidth: 0 }}>
              <div className={styles.cardTitle}>{template.name}</div>
              <div className={styles.cardDesc}>{template.description}</div>
            </div>
            <div className={styles.cardActions}>
              <button
                type="button"
                className={styles.settingsBtn}
                onClick={() => onOpenTemplateSettings(template.id)}
              >
                <Settings2 size={14} />
                {t('cli:templateList.settings')}
              </button>
              {onDeleteTemplate && (
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteTemplate(template.id);
                  }}
                  title={t('cli:templateList.deleteTitle')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
          <div className={styles.meta}>
            {workflowLabel(template)} · {t('cli:templateList.memberCount', { count: template.memberIds.length })}
            {` · ${sessionPolicyText(template.sessionPolicy)}`}
          </div>
          <div className={styles.meta}>
            {t('cli:templateList.linkedTasks', { count: taskCountByTemplate[template.id] || 0 })}
          </div>
        </div>
      ))}
    </div>
  );

  if (inline) {
    return (
      <div className={styles.inlinePanel} style={{ width: 360, flexShrink: 0 }}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>{t('cli:templateList.title')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {onCreateTemplate && (
              <button
                type="button"
                className={styles.inlineCloseBtn}
                onClick={onCreateTemplate}
                title={t('cli:templateList.createTitle')}
              >
                <Plus size={16} />
              </button>
            )}
            <button type="button" className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
              <X size={16} />
            </button>
          </div>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Drawer
      title={t('cli:templateList.title')}
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={420}
    >
      {body}
    </Drawer>
  );
};

export default CLITemplateListPanel;
