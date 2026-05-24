import { useState } from 'react';
import {
  Modal, Steps, Button, Input, InputNumber, Switch,
} from 'antd';
import { createStyles } from 'antd-style';
import {
  Bot, Terminal, Puzzle,
  Check, FolderOpen,
} from 'lucide-react';
import type {
  Group, AIGroup, CLIGroup, CLIStrategy, AgentGroup, AgentStrategy,
} from '@/config/groups';
import {
  aiSpeechModes,
  agentWorkflowTemplates,
  applyAISpeechMode,
  cliWorkflowTemplates,
  productGroupTypes,
  type AISpeechMode,
} from '@/config/groupProduct';
import { MemberPicker } from './MemberPicker';
import { invoke } from '@tauri-apps/api/core';

interface CreateGroupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (group: Group) => void;
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


export const CreateGroupWizard = ({ open, onOpenChange, onCreateGroup }: CreateGroupWizardProps) => {
  const { styles, cx } = useStyles();

  const [step, setStep] = useState<WizardStep>('type');
  const [groupType, setGroupType] = useState<GroupTypeChoice>('ai');

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

  // Agent group
  const [selectedAgentMembers, setSelectedAgentMembers] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<AgentStrategy>(defaultAgentTemplate.strategy);
  const [coordinatorPrompt, setCoordinatorPrompt] = useState(defaultAgentTemplate.coordinatorPrompt || '');
  const [maxRounds, setMaxRounds] = useState(defaultAgentTemplate.maxRounds);
  const [agentTemplateId, setAgentTemplateId] = useState(defaultAgentTemplate.id);

  const reset = () => {
    setStep('type');
    setGroupType('ai');
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
      group = {
        id, type: 'cli', name, description,
        memberIds: selectedCLIMembers,
        members: selectedCLIMembers,
        workspacePath,
        approvalMode,
        timeout,
        showStderr: true,
        strategy: cliStrategy,
        executionPlan: selectedTemplate?.executionPlan,
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
      case 'config': return groupType !== 'cli' || workspacePath.trim().length > 0;
      default: return true;
    }
  };


  const nextStep = () => {
    const flow: WizardStep[] = ['type', 'basic', 'members', 'config'];
    const idx = flow.indexOf(step);
    if (idx < flow.length - 1) setStep(flow[idx + 1]);
  };

  const prevStep = () => {
    const flow: WizardStep[] = ['type', 'basic', 'members', 'config'];
    const idx = flow.indexOf(step);
    if (idx > 0) setStep(flow[idx - 1]);
  };

  // ============ Render Steps ============

  const renderTypeStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>
        选择一个群聊场景，把合适的 AI 群友拉进来。
      </p>
      {productGroupTypes.map(item => {
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

  const renderMembersStep = () => {
    if (groupType === 'ai') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择角色群友加入群聊</p>
          <MemberPicker
            kind="llm"
            value={selectedAIMembers}
            onChange={setSelectedAIMembers}
            placeholder="选择角色群友..."
          />
        </div>
      );
    }
    if (groupType === 'cli') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择开发群友加入群聊</p>
          <MemberPicker
            kind="cli"
            value={selectedCLIMembers}
            onChange={setSelectedCLIMembers}
            placeholder="选择开发群友..."
          />
        </div>
      );
    }
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择专家群友加入群聊</p>
        <MemberPicker
          kind="agent"
          value={selectedAgentMembers}
          onChange={setSelectedAgentMembers}
          placeholder="选择专家群友..."
        />
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
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>开发群友将在此目录读写代码，支持选择或输入绝对路径</p>
      </div>
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
      <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>自动审批模式</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 4 }}>开启后开发群友自动执行，无需确认</div>
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


  const stepTitles: Record<WizardStep, string> = {
    type: '选择群聊场景',
    basic: '基础信息',
    members: '选择群友',
    config: '群聊设置',
    confirm: '',
  };
  const stepIndex: Record<WizardStep, number> = { type: 0, basic: 1, members: 2, config: 3, confirm: 4 };

  return (
    <Modal
      open={open}
      onCancel={() => { reset(); onOpenChange(false); }}
      title={stepTitles[step]}
      width={520}
      destroyOnClose
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            {step !== 'type' && (
              <Button type="text" onClick={prevStep}>上一步</Button>
            )}
          </div>
          <div>
            {step === 'config' ? (
              <Button type="primary" disabled={!canProceed()} onClick={handleCreate}
                style={{ background: '#ff6600', borderColor: '#ff6600' }}>
                创建群聊
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
      <Steps current={stepIndex[step]} size="small" style={{ marginBottom: 20 }} items={[
        { title: '类型' }, { title: '基础' }, { title: '成员' }, { title: '配置' },
      ]} />
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
