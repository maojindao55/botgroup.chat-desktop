import { useState, useMemo, useEffect } from 'react';
import {
  Modal, Steps, Button, Input, InputNumber, Switch, Empty, Select,
} from 'antd';
import { createStyles } from 'antd-style';
import {
  Bot, Terminal, Puzzle,
  Check, FolderOpen,
} from 'lucide-react';
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
        选择一个群聊场景，把合适的成员拉进来。
      </p>
      {!allowedTypes.includes('cli') && (
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', margin: 0 }}>
          开发群请前往侧边栏「开发任务」新建团队模板。
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
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, marginBottom: 4 }}>{item.label}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.description}</div>
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
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>群名称 *</label>
        <Input placeholder="给群聊起个名字" value={name} maxLength={30}
          onChange={e => setName(e.target.value)} />
      </div>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>群描述</label>
        <Input.TextArea placeholder="用一两句话描述这个群聊..." value={description} maxLength={100}
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

  const renderEmptyMembers = (resourceLabel: string) => (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
      <Empty description={`暂无${resourceLabel}，请先在资源库创建`}>
        {onOpenLibrary ? (
          <Button type="primary" onClick={handleOpenLibrary}
            style={{ background: '#ff6600', borderColor: '#ff6600' }}>
            去资源库新建
          </Button>
        ) : (
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            请从侧边栏打开资源库后新建
          </span>
        )}
      </Empty>
    </div>
  );

  const renderMembersStep = () => {
    if (groupType === 'ai') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择角色加入群聊</p>
          {pickableMemberCount === 0 ? (
            renderEmptyMembers('角色')
          ) : (
            <MemberPicker
              kind="llm"
              value={selectedAIMembers}
              onChange={setSelectedAIMembers}
              placeholder="选择角色..."
            />
          )}
        </div>
      );
    }
    if (groupType === 'cli') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择开发成员加入群聊</p>
          {pickableMemberCount === 0 ? (
            renderEmptyMembers('开发成员')
          ) : (
            <MemberPicker
              kind="cli"
              value={selectedCLIMembers}
              onChange={setSelectedCLIMembers}
              placeholder="选择开发成员..."
            />
          )}
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择专家加入群聊</p>
        {pickableMemberCount === 0 ? (
          renderEmptyMembers('专家')
        ) : (
          <MemberPicker
            kind="agent"
            value={selectedAgentMembers}
            onChange={setSelectedAgentMembers}
            placeholder="选择专家..."
          />
        )}
      </div>
    );
  };

  const renderAIConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>发言方式</label>
        {aiSpeechModes.map(item => (
          <button key={item.value}
            onClick={() => setAISpeechMode(item.value)}
            className={cx(styles.strategyBtn, aiSpeechMode === item.value && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.description}</div>
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
          <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>Workspace 路径 *</label>
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
              }}>选择</Button>
          </div>
          <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>开发成员将在此目录读写代码，支持选择或输入绝对路径</p>
        </div>
      )}
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>协作方式</label>
        {cliWorkflowTemplates.map(item => (
          <button key={item.id}
            onClick={() => {
              setCliStrategy(item.strategy);
              setCliTemplateId(item.id);
            }}
            className={cx(styles.strategyBtn, cliTemplateId === item.id && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.description}</div>
            </div>
            {cliTemplateId === item.id && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
      {cliTemplateId === 'implement_review' && (
        <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>角色分工</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>
              指定谁负责规划、谁按方案写代码、谁做复审。规划者和评审者可以是同一个开发成员。
            </div>
            {selectedCLIMembers.length < 2 && (
              <div style={{ fontSize: 12, color: '#ff9500', marginTop: 4 }}>
                建议至少选择 2 个开发成员，并分别指定规划/评审者与实现者。
              </div>
            )}
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>规划者</div>
            <Select
              size="small"
              value={reviewLoopRoles.plannerId}
              onChange={(plannerId) => setReviewLoopRoles(prev => ({ ...prev, plannerId }))}
              options={reviewLoopRoleOptions}
              placeholder="选择规划者"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>实现者</div>
            <Select
              size="small"
              value={reviewLoopRoles.implementerId}
              onChange={(implementerId) => setReviewLoopRoles(prev => ({ ...prev, implementerId }))}
              options={reviewLoopRoleOptions}
              placeholder="选择实现者"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>评审者</div>
            <Select
              size="small"
              value={reviewLoopRoles.reviewerId}
              onChange={(reviewerId) => setReviewLoopRoles(prev => ({ ...prev, reviewerId }))}
              options={reviewLoopRoleOptions}
              placeholder="选择评审者"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>最大复审轮数</div>
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
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>CLI 会话复用</label>
        {cliSessionPolicyOptions.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => setCliSessionPolicy(item.value)}
            className={cx(styles.strategyBtn, cliSessionPolicy === item.value && styles.strategyBtnActive)}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.description}</div>
            </div>
            {cliSessionPolicy === item.value && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
      <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>自动审批模式</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>开启后开发成员自动执行，无需确认</div>
          </div>
          <Switch checked={approvalMode === 'auto'} onChange={v => setApprovalMode(v ? 'auto' : 'ask')} />
        </div>
      </div>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>超时时间 (秒)</label>
        <InputNumber value={timeout / 1000} min={30} max={600}
          onChange={(v) => setTimeout_(Number(v) * 1000)} style={{ width: 120 }} />
      </div>
    </div>
  );


  const renderAgentConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>群内协作方式</label>
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
              <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.description}</div>
            </div>
            {agentTemplateId === item.id && <Check size={16} style={{ color: '#ff6600' }} />}
          </button>
        ))}
      </div>
      {(strategy === 'router' || strategy === 'react' || strategy === 'discussion') && (
        <div>
          <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>协调者 Prompt</label>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="定义协调者如何分派任务和汇总结果..."
            value={coordinatorPrompt} onChange={e => setCoordinatorPrompt(e.target.value)} />
        </div>
      )}
      <div>
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 6 }}>最大协作轮数</label>
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


  const stepTitles: Record<WizardStep, string> = isTemplateMode
    ? {
      type: '',
      basic: '模板名称',
      members: '选择开发成员',
      config: '执行策略',
      confirm: '',
    }
    : {
      type: '选择群聊场景',
      basic: '基础信息',
      members: '选择成员',
      config: '群聊设置',
      confirm: '',
    };
  const stepIndex: Record<WizardStep, number> = isTemplateMode
    ? { type: -1, basic: 0, members: 1, config: 2, confirm: 3 }
    : { type: 0, basic: 1, members: 2, config: 3, confirm: 4 };

  const stepItems = isTemplateMode
    ? [{ title: '基础' }, { title: '成员' }, { title: '配置' }]
    : [{ title: '类型' }, { title: '基础' }, { title: '成员' }, { title: '配置' }];

  return (
    <Modal
      open={open}
      onCancel={() => { reset(); onOpenChange(false); }}
      title={isTemplateMode ? `新建团队模板 · ${stepTitles[step]}` : stepTitles[step]}
      width={520}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step !== stepFlow[0] && (
              <Button type="text" onClick={prevStep}>上一步</Button>
            )}
          </div>
          <div>
            {step === 'config' ? (
              <Button type="primary" disabled={!canProceed()} onClick={handleCreate}
                style={{ background: '#ff6600', borderColor: '#ff6600' }}>
                {isTemplateMode ? '创建模板' : '创建群聊'}
              </Button>
            ) : (
              <Button type="primary" disabled={!canProceed()} onClick={nextStep}
                style={{ background: '#ff6600', borderColor: '#ff6600' }}>
                下一步
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
