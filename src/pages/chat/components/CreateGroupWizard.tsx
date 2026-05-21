import { useState } from 'react';
import {
  Modal, Steps, Button, Input, InputNumber, Switch, Checkbox,
} from 'antd';
import { Avatar as LobeAvatar, ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import {
  Bot, Terminal, Puzzle,
  Plus, Trash2, Check, FolderOpen,
} from 'lucide-react';
import { getAvailableAICharacters, getAvailableCLIAgents } from '@/config/aiCharacters';
import type {
  Group, AIGroup, CLIGroup, AgentGroup, AgentMember, AgentStrategy, AgentTool,
} from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { invoke } from '@tauri-apps/api/core';


// 内置工具定义
const AVAILABLE_TOOLS: AgentTool[] = [
  { name: 'web_search', description: '联网搜索获取实时信息', enabled: false },
  { name: 'code_interpreter', description: '执行代码片段并返回结果', enabled: false },
  { name: 'http_request', description: '发起 HTTP 请求调用外部 API', enabled: false },
  { name: 'memory', description: '存储和召回上下文信息', enabled: false },
];

interface CreateGroupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateGroup: (group: Group) => void;
}

type GroupTypeChoice = 'ai' | 'cli' | 'agent';
type WizardStep = 'type' | 'basic' | 'members' | 'config' | 'confirm';

// 默认空 Agent 成员
function createEmptyAgent(): AgentMember {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    role: '',
    systemPrompt: '',
    llm: { baseURL: '', apiKey: '', model: '' },
    tools: AVAILABLE_TOOLS.map(t => ({ ...t })),
    maxTurns: 5,
    temperature: 0.7,
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


export const CreateGroupWizard = ({ open, onOpenChange, onCreateGroup }: CreateGroupWizardProps) => {
  const { styles, cx } = useStyles();

  const [step, setStep] = useState<WizardStep>('type');
  const [groupType, setGroupType] = useState<GroupTypeChoice>('ai');

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // AI group
  const [selectedAIMembers, setSelectedAIMembers] = useState<string[]>([]);
  const [schedulerStrategy, setSchedulerStrategy] = useState<'tag' | 'round_robin' | 'all'>('tag');
  const [isDiscussionMode, setIsDiscussionMode] = useState(false);

  // CLI group
  const [selectedCLIMembers, setSelectedCLIMembers] = useState<string[]>([]);
  const [workspacePath, setWorkspacePath] = useState('');
  const [approvalMode, setApprovalMode] = useState<'auto' | 'ask'>('auto');
  const [timeout, setTimeout_] = useState(300000);

  // Agent group
  const [agents, setAgents] = useState<AgentMember[]>([createEmptyAgent()]);
  const [strategy, setStrategy] = useState<AgentStrategy>('sequential');
  const [coordinatorPrompt, setCoordinatorPrompt] = useState('');
  const [maxRounds, setMaxRounds] = useState(3);

  const reset = () => {
    setStep('type');
    setGroupType('ai');
    setName('');
    setDescription('');
    setSelectedAIMembers([]);
    setSchedulerStrategy('tag');
    setIsDiscussionMode(false);
    setSelectedCLIMembers([]);
    setWorkspacePath('');
    setApprovalMode('auto');
    setTimeout_(300000);
    setAgents([createEmptyAgent()]);
    setStrategy('sequential');
    setCoordinatorPrompt('');
    setMaxRounds(3);
  };


  const handleCreate = () => {
    const id = `group-${Date.now()}`;
    let group: Group;

    if (groupType === 'ai') {
      group = {
        id, type: 'ai', name, description,
        members: selectedAIMembers,
        isGroupDiscussionMode: isDiscussionMode,
        schedulerStrategy,
      } as AIGroup;
    } else if (groupType === 'cli') {
      group = {
        id, type: 'cli', name, description,
        members: selectedCLIMembers,
        workspacePath,
        approvalMode,
        timeout,
        showStderr: true,
      } as CLIGroup;
    } else {
      group = {
        id, type: 'agent', name, description,
        agents: agents.filter(a => a.name && a.llm.baseURL),
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
        if (groupType === 'agent') return agents.some(a => a.name && a.llm.baseURL && a.llm.model);
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
      <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>选择你要创建的群聊类型</p>
      {[
        { type: 'ai' as const,    icon: Bot,      title: 'AI 群聊',     desc: '多个 LLM 角色闲聊讨论、头脑风暴' },
        { type: 'cli' as const,   icon: Terminal, title: 'CLI Agent 群', desc: 'Codex/Claude/OpenCode 本地执行代码' },
        { type: 'agent' as const, icon: Puzzle,   title: 'Agent 群聊',   desc: '自定义 LLM Agent 协作，配置API+策略' },
      ].map(item => (
        <button key={item.type}
          onClick={() => setGroupType(item.type)}
          className={cx(styles.card, groupType === item.type && styles.cardActive)}>
          <item.icon size={20} style={{ marginTop: 2, color: groupType === item.type ? '#ff6600' : 'rgba(0,0,0,0.55)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.2, marginBottom: 4 }}>{item.title}</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.desc}</div>
          </div>
          {groupType === item.type && <Check size={16} style={{ marginTop: 2, color: '#ff6600' }} />}
        </button>
      ))}
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
        <Input.TextArea autoSize={{ minRows: 3, maxRows: 6 }} maxLength={200}
          placeholder="简单描述群聊的用途和规则"
          value={description} onChange={e => setDescription(e.target.value)} />
      </div>
    </div>
  );

  const renderAIMembersStep = () => {
    const characters = getAvailableAICharacters();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择 AI 成员加入群聊</p>
        <div className={styles.scrollMembers}>
          {characters.map(char => {
            const selected = selectedAIMembers.includes(char.id);
            const a = getAvatarData(char.name);
            const url = resolveAvatarByName(char.name, char.avatar);
            return (
              <button key={char.id}
                onClick={() => setSelectedAIMembers(prev => selected ? prev.filter(id => id !== char.id) : [...prev, char.id])}
                className={cx(styles.memberBtn, selected && styles.memberBtnActive)}>
                <LobeAvatar avatar={url || a.text} background={a.backgroundColor} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{char.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{char.tags?.join(', ')}</div>
                </div>
                {selected && <Check size={16} style={{ color: '#ff6600', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>已选 {selectedAIMembers.length} 个成员</div>
      </div>
    );
  };


  const renderCLIMembersStep = () => {
    const cliList = getAvailableCLIAgents();
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>选择 CLI Agent 加入群聊</p>
        <div>
          {cliList.map(agent => {
            const selected = selectedCLIMembers.includes(agent.id);
            const a = getAvatarData(agent.name);
            const url = resolveAvatarByName(agent.name, agent.avatar);
            return (
              <button key={agent.id}
                onClick={() => setSelectedCLIMembers(prev => selected ? prev.filter(id => id !== agent.id) : [...prev, agent.id])}
                className={cx(styles.memberBtn, selected && styles.memberBtnActive)}>
                <LobeAvatar avatar={url || a.text} background={a.backgroundColor} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{agent.name}</div>
                  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>adapter: {agent.cli.adapter}</div>
                </div>
                {selected && <Check size={16} style={{ color: '#ff6600', flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>已选 {selectedCLIMembers.length} 个 Agent</div>
      </div>
    );
  };


  const renderAgentMembersStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>配置 Agent 成员（每个 Agent 需配置独立 LLM API）</p>
      <div style={{ maxHeight: 320, overflow: 'auto', paddingRight: 6 }}>
        {agents.map((agent, idx) => (
          <div key={agent.id} className={styles.agentBox}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>Agent #{idx + 1}</span>
              {agents.length > 1 && (
                <ActionIcon icon={Trash2} size="small" onClick={() => setAgents(prev => prev.filter((_, i) => i !== idx))}
                  style={{ color: '#ef4444' }} title="" />
              )}
            </div>
            <Input placeholder="Agent 名称（如：产品经理）" value={agent.name}
              onChange={e => { const u = [...agents]; u[idx] = { ...u[idx], name: e.target.value }; setAgents(u); }} />
            <Input placeholder="角色定位（如：负责需求分析）" value={agent.role}
              onChange={e => { const u = [...agents]; u[idx] = { ...u[idx], role: e.target.value }; setAgents(u); }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <Input placeholder="API 地址" value={agent.llm.baseURL}
                onChange={e => { const u = [...agents]; u[idx] = { ...u[idx], llm: { ...u[idx].llm, baseURL: e.target.value } }; setAgents(u); }} />
              <Input placeholder="模型名" value={agent.llm.model}
                onChange={e => { const u = [...agents]; u[idx] = { ...u[idx], llm: { ...u[idx].llm, model: e.target.value } }; setAgents(u); }} />
            </div>
            <Input.Password placeholder="API Key" value={agent.llm.apiKey}
              onChange={e => { const u = [...agents]; u[idx] = { ...u[idx], llm: { ...u[idx].llm, apiKey: e.target.value } }; setAgents(u); }} />
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="System Prompt（定义角色人设和能力）"
              value={agent.systemPrompt}
              onChange={e => { const u = [...agents]; u[idx] = { ...u[idx], systemPrompt: e.target.value }; setAgents(u); }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {agent.tools.map((tool, tIdx) => (
                <Checkbox
                  key={tool.name}
                  checked={tool.enabled}
                  onChange={e => {
                    const u = [...agents];
                    const newTools = [...u[idx].tools];
                    newTools[tIdx] = { ...newTools[tIdx], enabled: e.target.checked };
                    u[idx] = { ...u[idx], tools: newTools };
                    setAgents(u);
                  }}
                >{tool.name}</Checkbox>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Button icon={<Plus size={14} />} onClick={() => setAgents(prev => [...prev, createEmptyAgent()])}>
        添加 Agent
      </Button>
    </div>
  );


  const renderMembersStep = () => {
    if (groupType === 'ai') return renderAIMembersStep();
    if (groupType === 'cli') return renderCLIMembersStep();
    return renderAgentMembersStep();
  };

  const renderAIConfigStep = () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>全员讨论模式</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>开启后所有成员每轮都回复</div>
          </div>
          <Switch checked={isDiscussionMode} onChange={setIsDiscussionMode} />
        </div>
      </div>
      {!isDiscussionMode && (
        <div>
          <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>调度策略</label>
          {[
            { value: 'tag' as const, label: '标签匹配', desc: '根据消息内容智能匹配相关 AI' },
            { value: 'round_robin' as const, label: '轮询', desc: '按顺序轮流回复' },
            { value: 'all' as const, label: '全员', desc: '每条消息所有人回复' },
          ].map(item => (
            <button key={item.value}
              onClick={() => setSchedulerStrategy(item.value)}
              className={cx(styles.strategyBtn, schedulerStrategy === item.value && styles.strategyBtnActive)}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
                <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.desc}</div>
              </div>
              {schedulerStrategy === item.value && <Check size={16} style={{ color: '#ff6600' }} />}
            </button>
          ))}
        </div>
      )}
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
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 6 }}>CLI Agent 将在此目录执行，支持选择或输入绝对路径</p>
      </div>
      <div style={{ padding: 12, background: 'rgba(0,0,0,0.04)', borderRadius: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>自动审批模式</div>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>开启后 Agent 自动执行，无需确认</div>
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
        <label style={{ fontSize: 14, fontWeight: 500, display: 'block', marginBottom: 8 }}>执行策略</label>
        {[
          { value: 'sequential' as const, label: '顺序执行', desc: 'Agent 按顺序依次回复，后者看到前者输出' },
          { value: 'router'     as const, label: '意图路由', desc: '协调者分析意图，选择相关 Agent 响应' },
          { value: 'discussion' as const, label: '全员讨论', desc: '所有 Agent 并行回复后汇总' },
          { value: 'react'      as const, label: 'ReAct',    desc: '协调者分析→分派→执行→判断→循环' },
        ].map(item => (
          <button key={item.value}
            onClick={() => setStrategy(item.value)}
            className={cx(styles.strategyBtn, strategy === item.value && styles.strategyBtnActive)}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{item.label}</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{item.desc}</div>
            </div>
            {strategy === item.value && <Check size={16} style={{ color: '#ff6600' }} />}
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
    type: '选择群聊类型',
    basic: '基础信息',
    members: groupType === 'agent' ? '配置 Agent 成员' : '选择群成员',
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
