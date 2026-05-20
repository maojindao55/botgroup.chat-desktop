/**
 * Agent 群聊配置面板
 * 管理自定义 Agent 成员、LLM配置、执行策略、工具等
 */
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus, Trash2, Puzzle, ChevronDown, ChevronUp, Check, Mic, MicOff } from 'lucide-react';
import { cn } from "@/lib/utils";
import type { AgentGroup, AgentMember, AgentStrategy, AgentTool } from '@/config/groups';
import { getAvatarData } from '@/utils/avatar';


const AVAILABLE_TOOLS: AgentTool[] = [
  { name: 'web_search', description: '联网搜索获取实时信息', enabled: false },
  { name: 'code_interpreter', description: '执行代码片段并返回结果', enabled: false },
  { name: 'http_request', description: '发起 HTTP 请求调用外部 API', enabled: false },
  { name: 'memory', description: '存储和召回上下文信息', enabled: false },
];

interface AgentGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AgentGroup;
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  onUpdateGroup: (updates: Partial<AgentGroup>) => void;
}

export const AgentGroupSettings = ({
  open,
  onOpenChange,
  group,
  mutedUsers,
  onToggleMute,
  onUpdateGroup,
}: AgentGroupSettingsProps) => {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const updateAgent = (agentId: string, updates: Partial<AgentMember>) => {
    const newAgents = group.agents.map(a =>
      a.id === agentId ? { ...a, ...updates } : a
    );
    onUpdateGroup({ agents: newAgents });
  };

  const addAgent = () => {
    const newAgent: AgentMember = {
      id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: '',
      role: '',
      systemPrompt: '',
      llm: { baseURL: '', apiKey: '', model: '' },
      tools: AVAILABLE_TOOLS.map(t => ({ ...t })),
      maxTurns: 5,
      temperature: 0.7,
    };
    onUpdateGroup({ agents: [...group.agents, newAgent] });
    setExpandedAgent(newAgent.id);
  };

  const removeAgent = (agentId: string) => {
    onUpdateGroup({ agents: group.agents.filter(a => a.id !== agentId) });
  };


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[340px] sm:w-[440px]">
        <SheetHeader>
          <SheetTitle>Agent 群聊配置</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-80px)] mt-4">
          <div className="space-y-5 pr-2">
            {/* 执行策略 */}
            <div className="space-y-2">
              <label className="text-sm font-medium">执行策略</label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'sequential' as const, label: '顺序执行' },
                  { value: 'router' as const, label: '意图路由' },
                  { value: 'discussion' as const, label: '全员讨论' },
                  { value: 'react' as const, label: 'ReAct' },
                ].map(item => (
                  <button key={item.value}
                    onClick={() => onUpdateGroup({ strategy: item.value })}
                    className={cn(
                      "p-2 rounded-lg border text-xs font-medium transition-all",
                      group.strategy === item.value
                        ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20 text-[#ff6600]"
                        : "border-border hover:bg-accent/30"
                    )}>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 协调者 Prompt */}
            {(group.strategy === 'router' || group.strategy === 'react' || group.strategy === 'discussion') && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">协调者 Prompt</label>
                <textarea
                  className="w-full min-h-[60px] rounded-md border border-input bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                  placeholder="定义协调者如何分派任务..."
                  value={group.coordinatorPrompt || ''}
                  onChange={e => onUpdateGroup({ coordinatorPrompt: e.target.value })}
                />
              </div>
            )}

            {/* 最大轮数 */}
            <div className="flex items-center gap-3">
              <label className="text-sm font-medium whitespace-nowrap">最大轮数</label>
              <Input type="number" value={group.maxRounds} min={1} max={10} className="w-20 text-sm"
                onChange={e => onUpdateGroup({ maxRounds: Number(e.target.value) })} />
            </div>


            {/* Agent 成员列表 */}
            <div>
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-medium">Agent 成员（{group.agents.length}）</span>
                <Button variant="outline" size="sm" onClick={addAgent}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />添加
                </Button>
              </div>

              <div className="space-y-2">
                {group.agents.map((agent) => {
                  const isExpanded = expandedAgent === agent.id;
                  const avatarData = getAvatarData(agent.name || 'A');
                  return (
                    <div key={agent.id} className="border rounded-lg overflow-hidden">
                      {/* Agent 头部 */}
                      <div className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-accent/30"
                        onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}>
                        <Avatar className="w-7 h-7">
                          <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-[10px]">
                            <Puzzle className="w-3 h-3" />
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{agent.name || '未命名 Agent'}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{agent.role || '未设置角色'}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          {mutedUsers.includes(agent.id) && (
                            <span className="text-[10px] text-red-500 px-1">禁言</span>
                          )}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={(e) => { e.stopPropagation(); onToggleMute(agent.id); }}>
                                  {mutedUsers.includes(agent.id)
                                    ? <MicOff className="w-3 h-3 text-red-500" />
                                    : <Mic className="w-3 h-3 text-green-500" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>{mutedUsers.includes(agent.id) ? '取消禁言' : '禁言'}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </div>


                      {/* Agent 展开的编辑面板 */}
                      {isExpanded && (
                        <div className="p-3 border-t bg-muted/20 space-y-2.5">
                          <Input placeholder="Agent 名称" value={agent.name}
                            onChange={e => updateAgent(agent.id, { name: e.target.value })} className="text-sm" />
                          <Input placeholder="角色定位" value={agent.role}
                            onChange={e => updateAgent(agent.id, { role: e.target.value })} className="text-sm" />

                          <div className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">LLM 配置</span>
                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="API 地址" value={agent.llm.baseURL} className="text-xs"
                                onChange={e => updateAgent(agent.id, { llm: { ...agent.llm, baseURL: e.target.value } })} />
                              <Input placeholder="模型名" value={agent.llm.model} className="text-xs"
                                onChange={e => updateAgent(agent.id, { llm: { ...agent.llm, model: e.target.value } })} />
                            </div>
                            <Input placeholder="API Key" type="password" value={agent.llm.apiKey} className="text-xs"
                              onChange={e => updateAgent(agent.id, { llm: { ...agent.llm, apiKey: e.target.value } })} />
                          </div>

                          <div className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">System Prompt</span>
                            <textarea
                              className="w-full min-h-[50px] rounded-md border border-input bg-background px-2 py-1.5 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-none"
                              placeholder="定义 Agent 人设和能力..."
                              value={agent.systemPrompt}
                              onChange={e => updateAgent(agent.id, { systemPrompt: e.target.value })}
                            />
                          </div>

                          <div className="space-y-1.5">
                            <span className="text-xs font-medium text-muted-foreground">工具能力</span>
                            <div className="flex flex-wrap gap-2">
                              {agent.tools.map((tool, tIdx) => (
                                <label key={tool.name} className="flex items-center gap-1 text-[11px] cursor-pointer">
                                  <input type="checkbox" checked={tool.enabled}
                                    onChange={e => {
                                      const newTools = [...agent.tools];
                                      newTools[tIdx] = { ...newTools[tIdx], enabled: e.target.checked };
                                      updateAgent(agent.id, { tools: newTools });
                                    }}
                                    className="rounded border-gray-300 w-3 h-3" />
                                  <span>{tool.name}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">Temperature:</span>
                              <Input type="number" value={agent.temperature} step={0.1} min={0} max={2} className="w-16 h-7 text-xs"
                                onChange={e => updateAgent(agent.id, { temperature: Number(e.target.value) })} />
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-muted-foreground">MaxTurns:</span>
                              <Input type="number" value={agent.maxTurns} min={1} max={20} className="w-14 h-7 text-xs"
                                onChange={e => updateAgent(agent.id, { maxTurns: Number(e.target.value) })} />
                            </div>
                          </div>

                          <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50 w-full"
                            onClick={() => removeAgent(agent.id)}>
                            <Trash2 className="w-3.5 h-3.5 mr-1.5" /> 删除此 Agent
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export default AgentGroupSettings;
