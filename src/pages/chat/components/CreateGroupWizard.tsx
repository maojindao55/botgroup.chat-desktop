import { useState, useMemo, useEffect } from 'react';
import {
  Modal, Steps, Button, Input, InputNumber, Switch, Empty, Select,
} from 'antd';
import { createStyles } from 'antd-style';
import {
  Bot, Terminal, Puzzle,
  Check, FolderOpen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  Group, AIGroup, CLIGroup, CLIStrategy, CLISessionPolicy, AgentGroup, AgentStrategy, CLIReviewLoopRoles,
} from '@/config/groups';
import {
  aiSpeechModes,
  agentWorkflowTemplates,
  applyAISpeechMode,
  cliWorkflowTemplates,
  productGroupTypes,
  type AISpeechMode,
} from '@/config/groupProduct';
import { cliSessionPolicyOptions } from '@/config/cliTasks';
import {
  getTranslatedGroupTypeDescription,
  getTranslatedGroupTypeLabel,
} from '@/i18n/productLabels';
import { MemberPicker } from './MemberPicker';
import { invoke } from '@tauri-apps/api/core';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getPickableMembers } from '@/utils/aiMemberDisplay';

interface CreateGroupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (group: Group) => void;
  /** 锁定群类型并跳过「选择场景」步骤，用于开发任务页新建团队模板 */
  fixedGroupType?: GroupTypeChoice;
  /** 允许创建的群类型；侧边栏入口应排除 cli */
  allowedGroupTypes?: GroupTypeChoice[];
  /** 成员为空时跳转资源库 */
  onOpenLibrary?: () => void;
}

type GroupTypeChoice = 'ai' | 'cli' | 'agent';
type WizardStep = 'type' | 'basic' | 'members' | 'config' | 'confirm';

const groupTypeIcons = {
  ai: Bot,
  cli: Terminal,
  agent: Puzzle,
};

const defaultAgentTemplate = agentWorkflowTemplates[0];
const defaultCliWorkflowTemplate =
  cliWorkflowTemplates.find((item) => item.id === 'implement_review') || cliWorkflowTemplates[0];

function buildDefaultReviewLoopRoles(memberIds: string[]): CLIReviewLoopRoles {
  return {
    plannerId: memberIds[0],
    implementerId: memberIds[1] || memberIds[0],
    reviewerId: memberIds[0],
    maxReviewRounds: 2,
  };
}

const useStyles = createStyles(({ token, css }) => ({
  card: css`
    width: 100%;
    display: flex;
    align-items: flex-start;
    gap: 14px;
    padding: 16px;
    border-radius: 12px;
    border: 2px solid ${token.colorBorderSecondary};
    background: transparent;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    &:hover { border-color: ${token.colorBorder}; background: ${token.colorFillTertiary}; }
  `,
  cardActive: css`
    border-color: #ff6600 !important;
    background: rgba(255,102,0,0.06) !important;
  `,
  memberBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    text-align: left;
    margin-bottom: 6px;
    transition: all 0.15s;
    &:hover { background: ${token.colorFillTertiary}; }
  `,
  memberBtnActive: css`
    border-color: #ff6600;
    background: rgba(255,102,0,0.06);
  `,
  scrollMembers: css`
    max-height: 280px;
    overflow: auto;
    padding-right: 6px;
  `,
  agentBox: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 12px;
    background: ${token.colorFillTertiary};
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 12px;
  `,
  strategyBtn: css`
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: transparent;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s;
    margin-bottom: 8px;
    &:hover { background: ${token.colorFillTertiary}; }
  `,
  strategyBtnActive: css`
    border-color: #ff6600;
    background: rgba(255,102,0,0.06);
  `,
}));


export const CreateGroupWizard = ({
  open,
  onOpenChange,
  onCreateGroup,
  fixedGroupType,
  allowedGroupTypes,
  onOpenLibrary,
}: CreateGroupWizardProps) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['wizard', 'product', 'common']);
  const members = useAIMemberStore((state) => state.members);
  const { load: loadMembers } = useAIMemberStore();

  const allowedTypes = allowedGroupTypes ?? (['ai', 'cli', 'agent'] as GroupTypeChoice[]);
  const defaultGroupType = fixedGroupType || allowedTypes[0] || 'ai';

  const [step, setStep] = useState<WizardStep>(fixedGroupType ? 'basic' : 'type');
  const [groupType, setGroupType] = useState<GroupTypeChoice>(defaultGroupType);
  const isTemplateMode = fixedGroupType === 'cli';
  const visibleGroupTypes = productGroupTypes.filter((item) => allowedTypes.includes(item.type));

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // AI group
  const [selectedAIMembers, setSelectedAIMembers] = useState<string[]>([]);
  const [aiSpeechMode, setAISpeechMode] = useState<AISpeechMode>('smart');

  // CLI group
  const [selectedCLIMembers, setSelectedCLIMembers] = useState<string[]>([]);
  const [workspacePath, setWorkspacePath] = useState('');
  const [approvalMode, setApprovalMode] = useState<'auto' | 'ask'>('auto');
  const [timeout, setTimeout_] = useState(300000);
  const [cliStrategy, setCliStrategy] = useState<CLIStrategy>(defaultCliWorkflowTemplate.strategy);
  const [cliTemplateId, setCliTemplateId] = useState(defaultCliWorkflowTemplate.id);
  const [cliSessionPolicy, setCliSessionPolicy] = useState<CLISessionPolicy>('task');
  const [reviewLoopRoles, setReviewLoopRoles] = useState<CLIReviewLoopRoles>(() => buildDefaultReviewLoopRoles([]));

  // Agent group
  const [selectedAgentMembers, setSelectedAgentMembers] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<AgentStrategy>(defaultAgentTemplate.strategy);
  const [coordinatorPrompt, setCoordinatorPrompt] = useState(defaultAgentTemplate.coordinatorPrompt || '');
  const [maxRounds, setMaxRounds] = useState(defaultAgentTemplate.maxRounds);
  const [agentTemplateId, setAgentTemplateId] = useState(defaultAgentTemplate.id);

  useEffect(() => {
    if (open) {
      loadMembers();
    }
  }, [open, loadMembers]);

  useEffect(() => {
    if (cliTemplateId !== 'implement_review' || selectedCLIMembers.length === 0) return;
    const defaults = buildDefaultReviewLoopRoles(selectedCLIMembers);
    setReviewLoopRoles(prev => ({
      plannerId: prev.plannerId && selectedCLIMembers.includes(prev.plannerId) ? prev.plannerId : defaults.plannerId,
      implementerId: prev.implementerId && selectedCLIMembers.includes(prev.implementerId) ? prev.implementerId : defaults.implementerId,
      reviewerId: prev.reviewerId && selectedCLIMembers.includes(prev.reviewerId) ? prev.reviewerId : defaults.reviewerId,
      maxReviewRounds: prev.maxReviewRounds ?? 2,
    }));
  }, [cliTemplateId, selectedCLIMembers]);

  const reviewLoopRoleOptions = useMemo(
    () => selectedCLIMembers.map(id => ({
      value: id,
      label: members[id]?.name || id,
    })),
    [selectedCLIMembers, members],
  );

  const reset = () => {
    setStep(fixedGroupType ? 'basic' : 'type');
    setGroupType(defaultGroupType);
    setName('');
    setDescription('');
    setSelectedAIMembers([]);
    setAISpeechMode('smart');
    setSelectedCLIMembers([]);
    setWorkspacePath('');
    setApprovalMode('auto');
    setTimeout_(300000);
    setCliStrategy(defaultCliWorkflowTemplate.strategy);
    setCliTemplateId(defaultCliWorkflowTemplate.id);
    setCliSessionPolicy('task');
    setReviewLoopRoles(buildDefaultReviewLoopRoles([]));
    setSelectedAgentMembers([]);
    setStrategy(defaultAgentTemplate.strategy);
    setCoordinatorPrompt(defaultAgentTemplate.coordinatorPrompt || '');
    setMaxRounds(defaultAgentTemplate.maxRounds);
    setAgentTemplateId(defaultAgentTemplate.id);
  };


  const handleCreate = () => {
    const id = `group-${Date.now()}`;
    let group: Group;

    if (groupType === 'ai') {
      const aiMode = applyAISpeechMode(aiSpeechMode);
      group = {
        id, type: 'ai', name, description,
        memberIds: selectedAIMembers,
        members: selectedAIMembers,
        isGroupDiscussionMode: aiMode.isGroupDiscussionMode,
        schedulerStrategy: aiMode.schedulerStrategy,
      } as AIGroup;
    } else if (groupType === 'cli') {
      const selectedTemplate = cliWorkflowTemplates.find((item) => item.id === cliTemplateId);
      const resolvedReviewLoopRoles = cliTemplateId === 'implement_review'
        ? buildDefaultReviewLoopRoles(selectedCLIMembers)
        : undefined;
      const reviewLoopRolesToSave = cliTemplateId === 'implement_review'
        ? {
          plannerId: reviewLoopRoles.plannerId || resolvedReviewLoopRoles?.plannerId,
          implementerId: reviewLoopRoles.implementerId || resolvedReviewLoopRoles?.implementerId,
          reviewerId: reviewLoopRoles.reviewerId || resolvedReviewLoopRoles?.reviewerId,
          maxReviewRounds: reviewLoopRoles.maxReviewRounds ?? 2,
        }
        : undefined;
      group = {
        id, type: 'cli', name, description,
        memberIds: selectedCLIMembers,
        members: selectedCLIMembers,
        workspacePath: isTemplateMode ? '' : workspacePath,
        approvalMode,
        timeout,
        showStderr: true,
        strategy: cliStrategy,
        workflowTemplateId: cliTemplateId,
        sessionPolicy: cliSessionPolicy,
        executionPlan: selectedTemplate?.executionPlan,
        reviewLoopRoles: reviewLoopRolesToSave,
      } as CLIGroup;
    } else {
      group = {
        id, type: 'agent', name, description,
        memberIds: selectedAgentMembers,
        strategy,
        coordinatorPrompt: coordinatorPrompt || undefined,
        maxRounds,
      } as AgentGroup;
    }

    onCreateGroup(group);
    reset();
    onOpenChange(false);
  };

  const canProceed = (): boolean => {
    switch (step) {
      case 'type': return true;
      case 'basic': return name.trim().length > 0;
      case 'members':
        if (groupType === 'ai') return selectedAIMembers.length > 0;
        if (groupType === 'cli') return selectedCLIMembers.length > 0;
        if (groupType === 'agent') return selectedAgentMembers.length > 0;
        return false;
      case 'config':
        if (groupType === 'cli' && !isTemplateMode) return workspacePath.trim().length > 0;
        return true;
      default: return true;
    }
  };


  const stepFlow: WizardStep[] = fixedGroupType
    ? ['basic', 'members', 'config']
    : ['type', 'basic', 'members', 'config'];

  const nextStep = () => {
    const idx = stepFlow.indexOf(step);
    if (idx < stepFlow.length - 1) setStep(stepFlow[idx + 1]);
  };

  const prevStep = () => {
    const idx = stepFlow.indexOf(step);
    if (idx > 0) setStep(stepFlow[idx - 1]);
  };

  // ============ Render Steps ============

  const renderTypeStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>
        {t('wizard:typeStep.intro')}
      </p>
      {!allowedTypes.includes('cli') && (
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: 0 }}>
          {t('wizard:typeStep.cliHint')}
        </p>
      )}
      {visibleGroupTypes.map(item => {
        const Icon = groupTypeIcons[item.type];
        return (
        <button key={item.type}
          onClick={() => setGroupType(item.type)}
          className={cx(styles.card, groupType === item.type && styles.cardActive)}>
          <Icon size={20} style={{ marginTop: 2, color: groupType === item.type ? '#ff6600' : 'rgba(0,0,0,0.55)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, marginBottom: 4 }}>
              {getTranslatedGroupTypeLabel(t, item.type)}
            </div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
              {getTranslatedGroupTypeDescription(t, item.type)}
            </div>
          </div>
          {groupType === item.type && <Check size={16} style={{ marginTop: 2, color: '#ff6600' }} />}
        </button>
        );
      })}
    </div>
  );


  const renderBasicStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:basicStep.nameLabel')}</label>
        <Input placeholder={t('wizard:basicStep.namePlaceholder')} value={name} maxLength={30}
          onChange={e => setName(e.target.value)} />
      </div>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:basicStep.descriptionLabel')}</label>
        <Input.TextArea placeholder={t('wizard:basicStep.descriptionPlaceholder')} value={description} maxLength={100}
          onChange={e => setDescription(e.target.value)} />
      </div>
    </div>
  );

  const memberKind = groupType === 'ai' ? 'llm' as const : groupType === 'cli' ? 'cli' as const : 'agent' as const;
  const pickableMemberCount = useMemo(
    () => getPickableMembers(members, memberKind).length,
    [members, memberKind],
  );

  const handleOpenLibrary = () => {
    onOpenChange(false);
    reset();
    onOpenLibrary?.();
  };

  const renderEmptyMembers = (resourceKey: 'character' | 'cliMember' | 'expert') => (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <Empty description={t('wizard:membersStep.emptyDescription', {
        resource: t(`product:memberKinds.${resourceKey}`),
      })}>
        {onOpenLibrary ? (
          <Button type="primary" onClick={handleOpenLibrary}
            style={{ background: '#ff6600', borderColor: '#ff6600' }}>
            {t('wizard:membersStep.goLibrary')}
          </Button>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            {t('wizard:membersStep.openLibraryHint')}
          </span>
        )}
      </Empty>
    </div>
  );

  const renderMembersStep = () => {
    if (groupType === 'ai') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>{t('wizard:membersStep.pickCharacters')}</p>
          {pickableMemberCount === 0 ? (
            renderEmptyMembers('character')
          ) : (
            <MemberPicker
              kind="llm"
              value={selectedAIMembers}
              onChange={setSelectedAIMembers}
              placeholder={t('wizard:membersStep.characterPlaceholder')}
            />
          )}
        </div>
      );
    }
    if (groupType === 'cli') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>{t('wizard:membersStep.pickCliMembers')}</p>
          {pickableMemberCount === 0 ? (
            renderEmptyMembers('cliMember')
          ) : (
            <MemberPicker
              kind="cli"
              value={selectedCLIMembers}
              onChange={setSelectedCLIMembers}
              placeholder={t('wizard:membersStep.cliPlaceholder')}
            />
          )}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>{t('wizard:membersStep.pickExperts')}</p>
        {pickableMemberCount === 0 ? (
          renderEmptyMembers('expert')
        ) : (
          <MemberPicker
            kind="agent"
            value={selectedAgentMembers}
            onChange={setSelectedAgentMembers}
            placeholder={t('wizard:membersStep.expertPlaceholder')}
          />
        )}
      </div>
    );
  };

  const renderAIConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>{t('wizard:configStep.speechMode')}</label>
        {aiSpeechModes.map(item => (
          <button key={item.value}
            onClick={() => setAISpeechMode(item.value)}
            className={cx(styles.strategyBtn, aiSpeechMode === item.value && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t(`product:aiSpeechModes.${item.value}.label`, { defaultValue: item.label })}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t(`product:aiSpeechModes.${item.value}.description`, { defaultValue: item.description })}
              </div>
            </div>
            {aiSpeechMode === item.value && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
    </div>
  );

  const renderCLIConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!isTemplateMode && (
        <div>
          <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:configStep.workspacePath')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="/Users/you/projects/your-repo"
              value={workspacePath}
              onChange={e => setWorkspacePath(e.target.value)}
              style={{ flex: 1, fontFamily: 'var(--ant-font-family-code)' }}
            />
            <Button icon={<FolderOpen size={14} />}
              onClick={async () => {
                try {
                  const selected = await invoke<string | null>('select_directory');
                  if (selected) setWorkspacePath(selected);
                } catch (e) { console.error('Failed to select directory:', e); }
              }}>{t('common:actions.select')}</Button>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>{t('wizard:configStep.workspaceHint')}</p>
        </div>
      )}
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>{t('wizard:configStep.collaborationMode')}</label>
        {cliWorkflowTemplates.map(item => (
          <button key={item.id}
            onClick={() => {
              setCliStrategy(item.strategy);
              setCliTemplateId(item.id);
            }}
            className={cx(styles.strategyBtn, cliTemplateId === item.id && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t(`product:cliWorkflowTemplates.${item.id}.label`, { defaultValue: item.label })}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t(`product:cliWorkflowTemplates.${item.id}.description`, { defaultValue: item.description })}
              </div>
            </div>
            {cliTemplateId === item.id && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
      {cliTemplateId === 'implement_review' && (
        <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t('wizard:configStep.roleAssignment')}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
              {t('wizard:configStep.roleAssignmentHint')}
            </div>
            {selectedCLIMembers.length < 2 && (
              <div style={{ fontSize: 12, color: '#ff9500', marginTop: 4 }}>
                {t('wizard:configStep.roleAssignmentWarning')}
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{t('wizard:configStep.planner')}</div>
            <Select
              size="small"
              value={reviewLoopRoles.plannerId}
              onChange={(plannerId) => setReviewLoopRoles(prev => ({ ...prev, plannerId }))}
              options={reviewLoopRoleOptions}
              placeholder={t('wizard:configStep.plannerPlaceholder')}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{t('wizard:configStep.implementer')}</div>
            <Select
              size="small"
              value={reviewLoopRoles.implementerId}
              onChange={(implementerId) => setReviewLoopRoles(prev => ({ ...prev, implementerId }))}
              options={reviewLoopRoleOptions}
              placeholder={t('wizard:configStep.implementerPlaceholder')}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{t('wizard:configStep.reviewer')}</div>
            <Select
              size="small"
              value={reviewLoopRoles.reviewerId}
              onChange={(reviewerId) => setReviewLoopRoles(prev => ({ ...prev, reviewerId }))}
              options={reviewLoopRoleOptions}
              placeholder={t('wizard:configStep.reviewerPlaceholder')}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>{t('wizard:configStep.maxReviewRounds')}</div>
            <InputNumber
              size="small"
              value={reviewLoopRoles.maxReviewRounds}
              min={1}
              max={5}
              onChange={(value) => {
                setReviewLoopRoles(prev => ({
                  ...prev,
                  maxReviewRounds: typeof value === 'number' ? value : 2,
                }));
              }}
              style={{ width: 100 }}
            />
          </div>
        </div>
      )}
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>{t('wizard:configStep.cliSessionReuse')}</label>
        {cliSessionPolicyOptions.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => setCliSessionPolicy(item.value)}
            className={cx(styles.strategyBtn, cliSessionPolicy === item.value && styles.strategyBtnActive)}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t(`product:cliSessionPolicy.${item.value}.label`, { defaultValue: item.label })}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t(`product:cliSessionPolicy.${item.value}.description`, { defaultValue: item.description })}
              </div>
            </div>
            {cliSessionPolicy === item.value && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
      <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{t('wizard:configStep.autoApproval')}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>{t('wizard:configStep.autoApprovalHint')}</div>
          </div>
          <Switch checked={approvalMode === 'auto'} onChange={v => setApprovalMode(v ? 'auto' : 'ask')} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:configStep.timeoutSeconds')}</label>
        <InputNumber value={timeout / 1000} min={120} max={600}
          onChange={(v) => setTimeout_(Number(v) * 1000)} style={{ width: 120 }} />
      </div>
    </div>
  );


  const renderAgentConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>{t('wizard:configStep.agentCollaboration')}</label>
        {agentWorkflowTemplates.map(item => (
          <button key={item.id}
            onClick={() => {
              setAgentTemplateId(item.id);
              setStrategy(item.strategy);
              setMaxRounds(item.maxRounds);
              setCoordinatorPrompt(item.coordinatorPrompt || '');
            }}
            className={cx(styles.strategyBtn, agentTemplateId === item.id && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {t(`product:agentWorkflowTemplates.${item.id}.label`, { defaultValue: item.label })}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
                {t(`product:agentWorkflowTemplates.${item.id}.description`, { defaultValue: item.description })}
              </div>
            </div>
            {agentTemplateId === item.id && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
      {(strategy === 'router' || strategy === 'react' || strategy === 'discussion') && (
        <div>
          <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:configStep.coordinatorPrompt')}</label>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder={t('wizard:configStep.coordinatorPromptPlaceholder')}
            value={coordinatorPrompt} onChange={e => setCoordinatorPrompt(e.target.value)} />
        </div>
      )}
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>{t('wizard:configStep.maxRounds')}</label>
        <InputNumber value={maxRounds} min={1} max={10}
          onChange={(v) => setMaxRounds(Number(v))} style={{ width: 100 }} />
      </div>
    </div>
  );

  const renderConfigStep = () => {
    if (groupType === 'ai') return renderAIConfigStep();
    if (groupType === 'cli') return renderCLIConfigStep();
    return renderAgentConfigStep();
  };


  const stepTitles: Record<WizardStep, string> = useMemo(() => (
    isTemplateMode
      ? {
        type: '',
        basic: t('wizard:steps.templateBasic'),
        members: t('wizard:steps.templateMembers'),
        config: t('wizard:steps.templateConfig'),
        confirm: '',
      }
      : {
        type: t('wizard:steps.type'),
        basic: t('wizard:steps.basic'),
        members: t('wizard:steps.members'),
        config: t('wizard:steps.config'),
        confirm: '',
      }
  ), [isTemplateMode, t]);

  const stepItems = isTemplateMode
    ? [
      { title: t('wizard:steps.shortBasic') },
      { title: t('wizard:steps.shortMembers') },
      { title: t('wizard:steps.shortConfig') },
    ]
    : [
      { title: t('wizard:steps.shortType') },
      { title: t('wizard:steps.shortBasic') },
      { title: t('wizard:steps.shortMembers') },
      { title: t('wizard:steps.shortConfig') },
    ];

  const stepIndex: Record<WizardStep, number> = isTemplateMode
    ? { type: -1, basic: 0, members: 1, config: 2, confirm: 3 }
    : { type: 0, basic: 1, members: 2, config: 3, confirm: 4 };

  return (
    <Modal
      open={open}
      onCancel={() => { reset(); onOpenChange(false); }}
      title={isTemplateMode ? t('wizard:templateTitle', { step: stepTitles[step] }) : stepTitles[step]}
      width={520}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step !== stepFlow[0] && (
              <Button type="text" onClick={prevStep}>{t('wizard:actions.previous')}</Button>
            )}
          </div>
          <div>
            {step === 'config' ? (
              <Button type="primary" disabled={!canProceed()} onClick={handleCreate}
                style={{ background: '#ff6600', borderColor: '#ff6600' }}>
                {isTemplateMode ? t('wizard:actions.createTemplate') : t('wizard:actions.createGroup')}
              </Button>
            ) : (
              <Button type="primary" disabled={!canProceed()} onClick={nextStep}
                style={{ background: '#ff6600', borderColor: '#ff6600' }}>
                {t('wizard:actions.next')}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <Steps current={stepIndex[step]} size="small" style={{ marginBottom: 20 }} items={stepItems} />
      <div>
        {step === 'type' && renderTypeStep()}
        {step === 'basic' && renderBasicStep()}
        {step === 'members' && renderMembersStep()}
        {step === 'config' && renderConfigStep()}
      </div>
    </Modal>
  );
};

export default CreateGroupWizard;
