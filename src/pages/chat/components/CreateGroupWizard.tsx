import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Bot, Terminal, Puzzle, ChevronRight, ChevronLeft, Plus, Trash2, Check } from 'lucide-react';
import { cn } from "@/lib/utils";
import { getAvailableAICharacters, getAvailableCLIAgents } from '@/config/aiCharacters';
import type { AICharacter, CLIAgent } from '@/config/aiCharacters';
import type {
  Group, AIGroup, CLIGroup, AgentGroup, AgentMember, AgentStrategy, AgentTool,
} from '@/config/groups';
import { getAvatarData } from '@/utils/avatar';


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


export const CreateGroupWizard = ({ open, onOpenChange, onCreateGroup }: CreateGroupWizardProps) => {
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
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">选择你要创建的群聊类型</p>
      <div className="grid grid-cols-1 gap-3">
        {[
          { type: 'ai' as const, icon: Bot, title: '🤖 AI 群聊', desc: '多个 LLM 角色闲聊讨论、头脑风暴' },
          { type: 'cli' as const, icon: Terminal, title: '🛠️ CLI Agent 群', desc: 'Codex/Claude/OpenCode 本地执行代码' },
          { type: 'agent' as const, icon: Puzzle, title: '🧩 Agent 群聊', desc: '自定义 LLM Agent 协作，配置API+策略' },
        ].map(item => (
          <button
            key={item.type}
            onClick={() => setGroupType(item.type)}
            className={cn(
              "flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all",
              groupType === item.type
                ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20"
                : "border-border hover:border-muted-foreground/30 hover:bg-accent/30"
            )}
          >
            <item.icon className={cn("w-6 h-6 flex-shrink-0", groupType === item.type ? "text-[#ff6600]" : "text-muted-foreground")} />
            <div>
              <div className="font-medium text-sm">{item.title}</div>
              <div className="text-xs text-muted-foreground">{item.desc}</div>
            </div>
            {groupType === item.type && <Check className="w-4 h-4 ml-auto text-[#ff6600]" />}
          </button>
        ))}
      </div>
    </div>
  );


  const renderBasicStep = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1.5 block">群名称 *</label>
        <Input placeholder="给群聊起个名字" value={name} onChange={e => setName(e.target.value)} maxLength={30} />
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">群描述</label>
        <textarea
          className="w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
          placeholder="简单描述群聊的用途和规则"
          value={description}
          onChange={e => setDescription(e.target.value)}
          maxLength={200}
        />
      </div>
    </div>
  );

  const renderAIMembersStep = () => {
    const characters = getAvailableAICharacters();
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">选择 AI 成员加入群聊</p>
        <ScrollArea className="h-[280px]">
          <div className="space-y-2 pr-2">
            {characters.map(char => {
              const selected = selectedAIMembers.includes(char.id);
              const avatarData = getAvatarData(char.name);
              return (
                <button
                  key={char.id}
                  onClick={() => {
                    setSelectedAIMembers(prev =>
                      selected ? prev.filter(id => id !== char.id) : [...prev, char.id]
                    );
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-lg border transition-all text-left",
                    selected ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20" : "border-transparent hover:bg-accent/50"
                  )}
                >
                  <Avatar className="w-8 h-8">
                    {char.avatar ? <AvatarImage src={char.avatar} /> : (
                      <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                        {avatarData.text}
                      </AvatarFallback>
                    )}
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{char.name}</div>
                    <div className="text-xs text-muted-foreground truncate">{char.tags?.join(', ')}</div>
                  </div>
                  {selected && <Check className="w-4 h-4 text-[#ff6600] flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </ScrollArea>
        <div className="text-xs text-muted-foreground">已选 {selectedAIMembers.length} 个成员</div>
      </div>
    );
  };


  const renderCLIMembersStep = () => {
    const cliList = getAvailableCLIAgents();
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">选择 CLI Agent 加入群聊</p>
        <div className="space-y-2">
          {cliList.map(agent => {
            const selected = selectedCLIMembers.includes(agent.id);
            return (
              <button
                key={agent.id}
                onClick={() => {
                  setSelectedCLIMembers(prev =>
                    selected ? prev.filter(id => id !== agent.id) : [...prev, agent.id]
                  );
                }}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                  selected ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20" : "border-border hover:bg-accent/50"
                )}
              >
                <Terminal className={cn("w-5 h-5", selected ? "text-[#ff6600]" : "text-muted-foreground")} />
                <div className="flex-1">
                  <div className="text-sm font-medium">{agent.name}</div>
                  <div className="text-xs text-muted-foreground">adapter: {agent.cli.adapter}</div>
                </div>
                {selected && <Check className="w-4 h-4 text-[#ff6600]" />}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-muted-foreground">已选 {selectedCLIMembers.length} 个 Agent</div>
      </div>
    );
  };


  const renderAgentMembersStep = () => (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">配置 Agent 成员（每个 Agent 需配置独立 LLM API）</p>
      <ScrollArea className="h-[320px]">
        <div className="space-y-4 pr-2">
          {agents.map((agent, idx) => (
            <div key={agent.id} className="border rounded-lg p-3 space-y-2.5 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Agent #{idx + 1}</span>
                {agents.length > 1 && (
                  <Button variant="ghost" size="icon" className="h-6 w-6"
                    onClick={() => setAgents(prev => prev.filter((_, i) => i !== idx))}>
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </Button>
                )}
              </div>
              <Input placeholder="Agent 名称（如：产品经理）" value={agent.name}
                onChange={e => {
                  const updated = [...agents];
                  updated[idx] = { ...updated[idx], name: e.target.value };
                  setAgents(updated);
                }} />
              <Input placeholder="角色定位（如：负责需求分析）" value={agent.role}
                onChange={e => {
                  const updated = [...agents];
                  updated[idx] = { ...updated[idx], role: e.target.value };
                  setAgents(updated);
                }} />
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="API 地址" value={agent.llm.baseURL}
                  onChange={e => {
                    const updated = [...agents];
                    updated[idx] = { ...updated[idx], llm: { ...updated[idx].llm, baseURL: e.target.value } };
                    setAgents(updated);
                  }} />
                <Input placeholder="模型名" value={agent.llm.model}
                  onChange={e => {
                    const updated = [...agents];
                    updated[idx] = { ...updated[idx], llm: { ...updated[idx].llm, model: e.target.value } };
                    setAgents(updated);
                  }} />
              </div>
              <Input placeholder="API Key" type="password" value={agent.llm.apiKey}
                onChange={e => {
                  const updated = [...agents];
                  updated[idx] = { ...updated[idx], llm: { ...updated[idx].llm, apiKey: e.target.value } };
                  setAgents(updated);
                }} />
              <textarea
                className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                placeholder="System Prompt（定义角色人设和能力）"
                value={agent.systemPrompt}
                onChange={e => {
                  const updated = [...agents];
                  updated[idx] = { ...updated[idx], systemPrompt: e.target.value };
                  setAgents(updated);
                }}
              />
              <div className="flex flex-wrap gap-2">
                {agent.tools.map((tool, tIdx) => (
                  <label key={tool.name} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="checkbox" checked={tool.enabled}
                      onChange={e => {
                        const updated = [...agents];
                        const newTools = [...updated[idx].tools];
                        newTools[tIdx] = { ...newTools[tIdx], enabled: e.target.checked };
                        updated[idx] = { ...updated[idx], tools: newTools };
                        setAgents(updated);
                      }}
                      className="rounded border-gray-300"
                    />
                    <span>{tool.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <Button variant="outline" size="sm" onClick={() => setAgents(prev => [...prev, createEmptyAgent()])}>
        <Plus className="w-3.5 h-3.5 mr-1.5" />添加 Agent
      </Button>
    </div>
  );


  const renderMembersStep = () => {
    if (groupType === 'ai') return renderAIMembersStep();
    if (groupType === 'cli') return renderCLIMembersStep();
    return renderAgentMembersStep();
  };

  const renderAIConfigStep = () => (
    <div className="space-y-4">
      <div className="p-3 bg-muted/50 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">全员讨论模式</div>
            <div className="text-xs text-muted-foreground">开启后所有成员每轮都回复</div>
          </div>
          <Switch checked={isDiscussionMode} onCheckedChange={setIsDiscussionMode} />
        </div>
      </div>
      {!isDiscussionMode && (
        <div className="space-y-2">
          <label className="text-sm font-medium">调度策略</label>
          {[
            { value: 'tag' as const, label: '标签匹配', desc: '根据消息内容智能匹配相关 AI' },
            { value: 'round_robin' as const, label: '轮询', desc: '按顺序轮流回复' },
            { value: 'all' as const, label: '全员', desc: '每条消息所有人回复' },
          ].map(item => (
            <button key={item.value}
              onClick={() => setSchedulerStrategy(item.value)}
              className={cn(
                "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                schedulerStrategy === item.value ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20" : "border-border hover:bg-accent/30"
              )}>
              <div className="flex-1">
                <div className="text-sm font-medium">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </div>
              {schedulerStrategy === item.value && <Check className="w-4 h-4 text-[#ff6600]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const renderCLIConfigStep = () => (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium mb-1.5 block">Workspace 路径 *</label>
        <Input placeholder="/Users/you/projects/your-repo" value={workspacePath}
          onChange={e => setWorkspacePath(e.target.value)} className="font-mono text-sm" />
        <p className="text-xs text-muted-foreground mt-1">CLI Agent 将在此目录执行，需要绝对路径</p>
      </div>
      <div className="p-3 bg-muted/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">自动审批模式</div>
            <div className="text-xs text-muted-foreground">开启后 Agent 自动执行，无需确认</div>
          </div>
          <Switch checked={approvalMode === 'auto'} onCheckedChange={v => setApprovalMode(v ? 'auto' : 'ask')} />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium mb-1.5 block">超时时间 (秒)</label>
        <Input type="number" value={timeout / 1000}
          onChange={e => setTimeout_(Number(e.target.value) * 1000)} min={30} max={600} />
      </div>
    </div>
  );


  const renderAgentConfigStep = () => (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">执行策略</label>
        {[
          { value: 'sequential' as const, label: '顺序执行', desc: 'Agent 按顺序依次回复，后者看到前者输出' },
          { value: 'router' as const, label: '意图路由', desc: '协调者分析意图，选择相关 Agent 响应' },
          { value: 'discussion' as const, label: '全员讨论', desc: '所有 Agent 并行回复后汇总' },
          { value: 'react' as const, label: 'ReAct', desc: '协调者分析→分派→执行→判断→循环' },
        ].map(item => (
          <button key={item.value}
            onClick={() => setStrategy(item.value)}
            className={cn(
              "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
              strategy === item.value ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20" : "border-border hover:bg-accent/30"
            )}>
            <div className="flex-1">
              <div className="text-sm font-medium">{item.label}</div>
              <div className="text-xs text-muted-foreground">{item.desc}</div>
            </div>
            {strategy === item.value && <Check className="w-4 h-4 text-[#ff6600]" />}
          </button>
        ))}
      </div>
      {(strategy === 'router' || strategy === 'react' || strategy === 'discussion') && (
        <div>
          <label className="text-sm font-medium mb-1.5 block">协调者 Prompt</label>
          <textarea
            className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
            placeholder="定义协调者如何分派任务和汇总结果..."
            value={coordinatorPrompt}
            onChange={e => setCoordinatorPrompt(e.target.value)}
          />
        </div>
      )}
      <div>
        <label className="text-sm font-medium mb-1.5 block">最大协作轮数</label>
        <Input type="number" value={maxRounds} onChange={e => setMaxRounds(Number(e.target.value))} min={1} max={10} />
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

  const stepNumbers: Record<WizardStep, number> = { type: 1, basic: 2, members: 3, config: 4, confirm: 5 };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{stepTitles[step]}</DialogTitle>
          <DialogDescription>
            步骤 {stepNumbers[step]} / 4
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto py-2">
          {step === 'type' && renderTypeStep()}
          {step === 'basic' && renderBasicStep()}
          {step === 'members' && renderMembersStep()}
          {step === 'config' && renderConfigStep()}
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          {step !== 'type' ? (
            <Button variant="ghost" size="sm" onClick={prevStep}>
              <ChevronLeft className="w-4 h-4 mr-1" /> 上一步
            </Button>
          ) : <div />}
          {step === 'config' ? (
            <Button size="sm" onClick={handleCreate} disabled={!canProceed()}
              className="bg-[#ff6600] hover:bg-[#e65c00] text-white">
              创建群聊
            </Button>
          ) : (
            <Button size="sm" onClick={nextStep} disabled={!canProceed()}
              className="bg-[#ff6600] hover:bg-[#e65c00] text-white">
              下一步 <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateGroupWizard;
