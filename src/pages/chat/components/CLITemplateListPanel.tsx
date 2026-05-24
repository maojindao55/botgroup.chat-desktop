/**
 * 团队模板列表 — 管理所有 CLI 团队模板，修改仅影响未来新任务
 */
import { Drawer } from 'antd';
import { Settings2, X } from 'lucide-react';
import { createStyles } from 'antd-style';
import { cliWorkflowTemplates } from '@/config/groupProduct';
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
}));

interface CLITemplateListPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: CLITeamTemplate[];
  taskCountByTemplate: Record<string, number>;
  onOpenTemplateSettings: (templateId: string) => void;
  inline?: boolean;
}

function strategyLabel(strategy: string) {
  return cliWorkflowTemplates.find(t => t.strategy === strategy)?.label || strategy;
}

export const CLITemplateListPanel = ({
  open,
  onOpenChange,
  templates,
  taskCountByTemplate,
  onOpenTemplateSettings,
  inline,
}: CLITemplateListPanelProps) => {
  const { styles } = useStyles();

  if (!open) {
    if (inline) return null;
    return null;
  }

  const body = (
    <div className={styles.content}>
      <div className={styles.hint}>
        团队模板是新任务的默认配置来源。在此修改成员、群规或默认 Workspace 后，只影响之后创建的新任务，已有任务仍使用创建时的快照。
      </div>
      {templates.length === 0 && (
        <div className={styles.hint}>暂无团队模板。请先在群聊设置中创建 CLI 开发群。</div>
      )}
      {templates.map(template => (
        <div key={template.id} className={styles.card}>
          <div className={styles.cardHeader}>
            <div style={{ minWidth: 0 }}>
              <div className={styles.cardTitle}>{template.name}</div>
              <div className={styles.cardDesc}>{template.description}</div>
            </div>
            <button
              type="button"
              className={styles.settingsBtn}
              onClick={() => onOpenTemplateSettings(template.id)}
            >
              <Settings2 size={14} />
              设置
            </button>
          </div>
          <div className={styles.meta}>
            {strategyLabel(template.strategy)} · {template.memberIds.length} 位成员
            {template.workspacePath ? ` · ${template.workspacePath}` : ''}
          </div>
          <div className={styles.meta}>
            已有 {taskCountByTemplate[template.id] || 0} 个开发任务
          </div>
        </div>
      ))}
    </div>
  );

  if (inline) {
    return (
      <div className={styles.inlinePanel} style={{ width: 360, flexShrink: 0 }}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>团队模板</span>
          <button type="button" className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <Drawer
      title="团队模板"
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={360}
    >
      {body}
    </Drawer>
  );
};

export default CLITemplateListPanel;
