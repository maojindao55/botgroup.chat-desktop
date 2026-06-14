/**
 * 专家群设置面板
 *
 * 重构后：移除固定的 8 种策略模板。用户只配置成员、工作目录、
 * 权限和默认协作偏好；运行时由 planner/runner 动态生成执行计划。
 */
import { useEffect, useMemo, useState } from 'react';
import { Drawer, Input, InputNumber, Switch, Tooltip, Button, Popconfirm, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { Mic, MicOff, X, FolderOpen, HelpCircle, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import type { AgentGroup } from '@/config/groups';
import type { AgentWorkflowEffort } from '@/config/agentWorkflow';
import { createDefaultAgentWorkflowDefaults } from '@/config/agentWorkflow';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { MemberPicker } from './MemberPicker';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { useAgentWorkflowPlannerSettings } from '@/store/agentWorkflowPlannerSettings';
import { agentWorkflowEfforts } from '@/config/groupProduct';
import { invoke } from '@tauri-apps/api/core';

interface AgentGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AgentGroup;
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  onUpdateGroup: (updates: Partial<AgentGroup>) => void;
  onDeleteGroup?: () => void;
  canDeleteGroup?: boolean;
  /** 桌面端使用内联面板，移动端使用 Drawer */
  inline?: boolean;
}

const useStyles = createStyles(({ token, css }) => ({
  scrollArea: css`
    height: calc(100vh - 80px);
    overflow: auto;
    padding-right: 8px;
  `,
  strategyGrid: css`
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  `,
  strategyBtn: css`
    padding: 10px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    text-align: center;
    color: ${token.colorText};
    display: flex;
    flex-direction: column;
    gap: 4px;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
    &:hover {
      background: rgba(255, 102, 0, 0.12);
    }
  `,
  strategyDesc: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    margin-top: 6px;
  `,
  capabilityTag: css`
    display: inline-block;
    margin-right: 4px;
    padding: 1px 6px;
    font-size: 10px;
    border-radius: 4px;
    background: rgba(255, 102, 0, 0.1);
    color: #ff6600;
  `,
  templateBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    color: ${token.colorText};
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  templateBtnActive: css`
    border-color: #ff6600;
    background: rgba(255, 102, 0, 0.08);
  `,
  supervisorBadge: css`
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(255, 102, 0, 0.12);
    color: #ff6600;
    font-weight: 500;
    white-space: nowrap;
  `,
  memberRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 8px;
    transition: background 0.15s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  scrollList: css`
    max-height: calc(100vh - 420px);
    overflow: auto;
  `,
  inlinePanel: css`
    width: 440px;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: ${token.colorBgContainer};
    border-left: 1px solid ${token.colorBorderSecondary};
    flex-shrink: 0;
    z-index: 5;
  `,
  inlineHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: nowrap;
    gap: 8px;
    height: 46px;
    box-sizing: border-box;
    padding: 0 12px 0 16px;
    border-bottom: 1px solid ${token.colorBorder};
    flex-shrink: 0;
  `,
  inlineTitle: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  inlineCloseBtn: css`
    flex-shrink: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${token.colorTextSecondary};
    border-radius: 4px;
    transition: background 0.2s;
    &:hover {
      background: ${token.colorFillTertiary};
    }
  `,
  inlineContent: css`
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  `,
}));

type WorkspaceStatus = 'idle' | 'checking' | 'valid' | 'invalid';

function renderWorkspaceStatus(
  status: WorkspaceStatus,
  t: (key: string, opts?: { defaultValue?: string }) => string,
  token: { colorSuccess: string; colorError: string; colorTextTertiary: string },
) {
  if (status === 'checking') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: token.colorTextTertiary }}>
        <Loader2 size={13} className="animate-spin" />
        {t('settings:agentGroup.workspaceChecking')}
      </span>
    );
  }
  if (status === 'valid') {
    return (
      <Tooltip title={t('settings:agentGroup.workspaceValid')}>
        <CheckCircle2 size={14} style={{ color: token.colorSuccess }} />
      </Tooltip>
    );
  }
  if (status === 'invalid') {
    return (
      <Tooltip title={t('settings:agentGroup.workspaceInvalid')}>
        <AlertCircle size={14} style={{ color: token.colorError }} />
      </Tooltip>
    );
  }
  return null;
}

export const AgentGroupSettings = ({
  open,
  onOpenChange,
  group,
  mutedUsers,
  onToggleMute,
  onUpdateGroup,
  onDeleteGroup,
  canDeleteGroup = true,
  inline,
}: AgentGroupSettingsProps) => {
  const { t } = useTranslation(['settings', 'common', 'product']);
  const { styles, cx } = useStyles();
  const { token } = theme.useToken();
  const { members: allMembers } = useAIMemberStore();
  const globalAlwaysConfirm = useAgentWorkflowPlannerSettings(s => s.settings.alwaysConfirmBeforeRun);

  const currentMemberIds = group.memberIds || [];
  const currentAgents = currentMemberIds
    .map((id) => allMembers[id])
    .filter((m) => m && (m.kind === 'cli' || m.kind === 'agent'));

  const defaults = group.workflowDefaults || createDefaultAgentWorkflowDefaults();

  const updateDefaults = (patch: Partial<AgentGroup['workflowDefaults']>) => {
    onUpdateGroup({
      workflowDefaults: { ...defaults, ...patch },
    });
  };

  // 预设与实际数值的和解：高亮取决于 (maxPhases, maxParallelAgents) 是否命中某个预设，
  // 而非 defaults.effort。手动改数字后若与所有预设都不符，则进入「自定义」态。
  const activePreset = useMemo(
    () => agentWorkflowEfforts.find(
      (e) => e.recommendedMaxPhases === defaults.maxPhases
        && e.recommendedMaxParallelAgents === defaults.maxParallelAgents,
    ),
    [defaults.maxPhases, defaults.maxParallelAgents],
  );
  const isCustomized = !activePreset;

  // 工作目录即时校验（防抖 + 取消）。仅在桌面端生效。
  const [workspaceStatus, setWorkspaceStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const workspacePath = group.workspacePath || '';
  useEffect(() => {
    const path = workspacePath.trim();
    if (!path) { setWorkspaceStatus('idle'); return; }
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) { setWorkspaceStatus('idle'); return; }
    let cancelled = false;
    setWorkspaceStatus('checking');
    const timer = window.setTimeout(() => {
      invoke<boolean>('path_is_dir', { path })
        .then((ok) => { if (!cancelled) setWorkspaceStatus(ok ? 'valid' : 'invalid'); })
        .catch(() => { if (!cancelled) setWorkspaceStatus('idle'); });
    }, 400);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [workspacePath]);

  const settingsContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 基础信息 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>{t('settings:agentGroup.basicInfo')}</label>
        <Input
          value={group.name}
          onChange={(e) => onUpdateGroup({ name: e.target.value })}
          placeholder={t('settings:agentGroup.groupNamePlaceholder')}
          maxLength={30}
          showCount
        />
        <Input.TextArea
          value={group.description || ''}
          onChange={(e) => onUpdateGroup({ description: e.target.value })}
          placeholder={t('settings:agentGroup.groupDescriptionPlaceholder')}
          maxLength={100}
          showCount
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
      </div>

      {/* 默认协作偏好 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>
          {t('settings:agentGroup.workflowDefaults')}
        </label>
        <div className={styles.strategyGrid}>
          {agentWorkflowEfforts.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => updateDefaults({
                effort: item.value as AgentWorkflowEffort,
                maxPhases: item.recommendedMaxPhases,
                maxParallelAgents: item.recommendedMaxParallelAgents,
              })}
              className={cx(
                styles.strategyBtn,
                activePreset?.value === item.value && styles.strategyBtnActive,
              )}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {t(`settings:agentGroup.effort.${item.value}.label`, { defaultValue: item.label })}
              </span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>
                {t(`settings:agentGroup.effort.${item.value}.description`, {
                  defaultValue: item.description,
                })}
              </span>
            </button>
          ))}
        </div>
        {isCustomized && (
          <div style={{ fontSize: 11, color: token.colorWarningText, marginTop: 4 }}>
            {t('settings:agentGroup.customizedPreset')}
          </div>
        )}
      </div>

      {/* 高级选项 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>
          {t('settings:agentGroup.advanced')}
        </label>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {t('settings:agentGroup.maxPhases')}
            <Tooltip title={t('settings:agentGroup.maxPhasesHint')}>
              <HelpCircle size={13} style={{ color: token.colorTextTertiary, cursor: 'help' }} />
            </Tooltip>
          </span>
          <InputNumber
            value={defaults.maxPhases}
            min={1}
            max={10}
            style={{ width: 80 }}
            onChange={(v) => updateDefaults({ maxPhases: Number(v) || 1 })}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {t('settings:agentGroup.maxParallelAgents')}
            <Tooltip title={t('settings:agentGroup.maxParallelAgentsHint')}>
              <HelpCircle size={13} style={{ color: token.colorTextTertiary, cursor: 'help' }} />
            </Tooltip>
          </span>
          <InputNumber
            value={defaults.maxParallelAgents}
            min={1}
            max={5}
            style={{ width: 80 }}
            onChange={(v) => updateDefaults({ maxParallelAgents: Number(v) || 1 })}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ fontSize: 13 }}>{t('settings:agentGroup.alwaysShowPlan')}</span>
          <Switch
            checked={defaults.alwaysShowPlan}
            onChange={(v) => updateDefaults({ alwaysShowPlan: v })}
          />
        </div>
        {globalAlwaysConfirm && (
          <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
            {t('settings:agentGroup.alwaysShowPlanHint')}
          </div>
        )}
      </div>

      {/* 工作目录（独立段落，antd 风格 + 即时校验） */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ fontSize: 14, fontWeight: 500 }}>{t('settings:agentGroup.workspace')}</label>
        <div style={{ fontSize: 11, color: token.colorTextTertiary }}>
          {t('settings:agentGroup.workspaceHint')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="/Users/you/projects/your-repo"
            value={workspacePath}
            onChange={(e) => onUpdateGroup({ workspacePath: e.target.value })}
            style={{ flex: 1, fontFamily: token.fontFamilyCode, fontSize: 13 }}
            status={workspaceStatus === 'invalid' ? 'error' : undefined}
            suffix={renderWorkspaceStatus(workspaceStatus, t, token)}
          />
          <Button
            icon={<FolderOpen size={14} />}
            onClick={async () => {
              try {
                const selected = await invoke<string | null>('select_directory');
                if (selected) {
                  onUpdateGroup({ workspacePath: selected });
                }
              } catch (e) {
                console.error('Failed to select directory:', e);
              }
            }}
          >
            {t('settings:agentGroup.workspaceBrowse')}
          </Button>
        </div>
      </div>

      {/* 管理专家 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>{t('settings:agentGroup.manageExperts')}</span>
        <MemberPicker
          kind="cli"
          value={currentMemberIds}
          onChange={(newIds) => onUpdateGroup({ memberIds: newIds })}
          placeholder={t('settings:agentGroup.pickExpertsPlaceholder')}
        />
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: -4 }}>
          {t('settings:agentGroup.libraryHint')}
        </div>
        {currentAgents.length === 0 && (
          <div style={{ fontSize: 12, color: token.colorWarningText }}>
            {t('settings:agentGroup.noExpertsWarning')}
          </div>
        )}
        <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>
          {t('settings:agentGroup.experts', { count: currentAgents.length })}
        </div>

        {/* 成员列表 */}
        <div className={styles.scrollList}>
          {currentAgents.map((agent) => {
            if (!agent) return null;
            const avatarData = getAvatarData(agent.name || 'A');
            const avatarUrl = resolveAvatarByName(agent.name || 'A', agent.avatar, 32);
            const muted = mutedUsers.includes(agent.id);
            const capabilities = (agent as { capabilities?: string[] }).capabilities || [];

            return (
              <div key={agent.id} className={styles.memberRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                  <LobeAvatar
                    shape="circle"
                    avatar={avatarUrl || avatarData.text}
                    background={avatarData.backgroundColor}
                    size={32}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.name}
                      </span>
                    </div>
                    {agent.description && (
                      <div
                        style={{
                          fontSize: 11,
                          color: token.colorTextTertiary,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {agent.description}
                      </div>
                    )}
                    {capabilities.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {capabilities.map((cap) => (
                          <span key={cap} className={styles.capabilityTag}>{cap}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 4 }}>
                  <Tooltip title={muted ? t('settings:agentGroup.unmute') : t('settings:agentGroup.mute')}>
                    <ActionIcon
                      icon={muted ? MicOff : Mic}
                      size="small"
                      onClick={() => onToggleMute(agent.id)}
                      style={{ color: muted ? token.colorError : token.colorSuccess }}
                      title=""
                    />
                  </Tooltip>
                  <Popconfirm
                    title={t('settings:agentGroup.removeMemberConfirm')}
                    okText={t('settings:agentGroup.removeMember')}
                    okButtonProps={{ danger: true }}
                    cancelText={t('common:actions.cancel', { defaultValue: '取消' })}
                    onConfirm={() => {
                      const newIds = currentMemberIds.filter((id) => id !== agent.id);
                      onUpdateGroup({ memberIds: newIds });
                    }}
                  >
                    <Tooltip title={t('settings:agentGroup.removeMember')}>
                      <ActionIcon icon={X} size="small" title="" />
                    </Tooltip>
                  </Popconfirm>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {onDeleteGroup && canDeleteGroup && (
        <div style={{
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          paddingTop: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: token.colorError }}>{t('common:deleteGroup.title')}</div>
          <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {t('common:deleteGroup.warning')}
          </div>
          <Button danger onClick={onDeleteGroup} style={{ alignSelf: 'flex-start' }}>
            {t('common:deleteGroup.button')}
          </Button>
        </div>
      )}
    </div>
  );

  if (inline) {
    if (!open) return null;
    return (
          <div className={styles.inlinePanel}>
        <div className={styles.inlineHeader}>
          <span className={styles.inlineTitle}>{t('settings:agentGroup.title')}</span>
          <button className={styles.inlineCloseBtn} onClick={() => onOpenChange(false)}>
            <X size={16} />
          </button>
        </div>
        <div className={styles.inlineContent}>
          {settingsContent}
        </div>
      </div>
    );
  }

  return (
    <Drawer
      title={t('settings:agentGroup.title')}
      placement="right"
      open={open}
      onClose={() => onOpenChange(false)}
      width={440}
    >
      <div className={styles.scrollArea}>{settingsContent}</div>
    </Drawer>
  );
};

export default AgentGroupSettings;
