/**
 * CLI Agent 群聊配置面板
 * 管理 CLI Agent 成员、workspacePath、审批模式、超时等
 */
import { useState, useEffect } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FolderOpen, Terminal, Mic, MicOff, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from "@/lib/utils";
import { request } from '@/utils/request';
import type { CLIAgent } from '@/config/aiCharacters';
import type { CLIGroup, CLIStrategy } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { invoke } from '@tauri-apps/api/core';


type CliStatus = { installed: boolean; version?: string; path?: string };

interface CLIGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: CLIGroup;
  members: CLIAgent[];
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  workspacePath: string;
  onWorkspacePathChange: (path: string) => void;
  approvalMode: 'auto' | 'ask';
  onApprovalModeChange: (mode: 'auto' | 'ask') => void;
  timeout: number;
  onTimeoutChange: (timeout: number) => void;
  strategy: CLIStrategy;
  onStrategyChange: (strategy: CLIStrategy) => void;
}

export const CLIGroupSettings = ({
  open,
  onOpenChange,
  group,
  members,
  mutedUsers,
  onToggleMute,
  workspacePath,
  onWorkspacePathChange,
  approvalMode,
  onApprovalModeChange,
  timeout,
  onTimeoutChange,
  strategy,
  onStrategyChange,
}: CLIGroupSettingsProps) => {
  const [cliStatus, setCliStatus] = useState<Record<string, CliStatus | 'loading'>>({});

  // 检测 CLI Agent 安装状态
  useEffect(() => {
    if (!open || members.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const m of members) {
        if (cancelled) break;
        const adapter = m.cli?.adapter;
        if (!adapter) continue;
        setCliStatus(prev => ({ ...prev, [m.id]: 'loading' }));
        try {
          const res = await request('/api/cli/check', {
            method: 'POST',
            body: JSON.stringify({ adapter }),
          });
          const json = await res.json();
          if (!cancelled) {
            setCliStatus(prev => ({ ...prev, [m.id]: json.data || { installed: false } }));
          }
        } catch {
          if (!cancelled) {
            setCliStatus(prev => ({ ...prev, [m.id]: { installed: false } }));
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [open, members]);


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>CLI Agent 配置</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {/* Workspace 路径 */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <FolderOpen className="w-4 h-4" />
              <span>本地 Workspace</span>
            </div>
            <div className="text-xs text-muted-foreground">
              CLI Agent 将在此目录下执行命令，支持选择或输入绝对路径
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="/Users/you/projects/your-repo"
                value={workspacePath}
                onChange={(e) => onWorkspacePathChange(e.target.value)}
                className="text-sm font-mono flex-1"
              />
              <Button
                variant="outline"
                type="button"
                onClick={async () => {
                  try {
                    const selected = await invoke<string | null>('select_directory');
                    if (selected) {
                      onWorkspacePathChange(selected);
                    }
                  } catch (e) {
                    console.error("Failed to select directory:", e);
                  }
                }}
                className="flex items-center gap-1 flex-shrink-0 text-xs h-9"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>选择</span>
              </Button>
            </div>
          </div>

          {/* 审批模式 */}
          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">自动审批</div>
                <div className="text-xs text-muted-foreground">开启后 Agent 自动执行，无需确认</div>
              </div>
              <Switch
                checked={approvalMode === 'auto'}
                onCheckedChange={(v) => onApprovalModeChange(v ? 'auto' : 'ask')}
              />
            </div>
          </div>

          {/* 超时设置 */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-2">
            <div className="text-sm font-medium">执行超时</div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={timeout / 1000}
                onChange={(e) => onTimeoutChange(Number(e.target.value) * 1000)}
                min={30}
                max={600}
                className="w-24 text-sm"
              />
              <span className="text-xs text-muted-foreground">秒</span>
            </div>
          </div>


          {/* 执行策略 */}
          <div className="p-4 bg-muted/50 rounded-lg space-y-2">
            <div className="text-sm font-medium">执行策略</div>
            <div className="grid grid-cols-4 gap-2">
              {[
                { value: 'sequential' as const, label: '顺序执行' },
                { value: 'router' as const, label: '智能路由' },
                { value: 'race' as const, label: '竞争模式' },
                { value: 'pipeline' as const, label: '流水线' },
              ].map(item => (
                <button key={item.value}
                  onClick={() => onStrategyChange(item.value)}
                  className={cn(
                    "p-2 rounded-lg border text-xs font-medium transition-all",
                    strategy === item.value
                      ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20 text-[#ff6600]"
                      : "border-border hover:bg-accent/30"
                  )}>
                  {item.label}
                </button>
              ))}
            </div>
            {/* 策略描述 */}
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {{
                sequential: '逐个 CLI Agent 依次执行任务',
                router: '根据任务特征自动选择最合适的 CLI Agent',
                race: '所有 CLI Agent 同时执行，对比结果取最优',
                pipeline: '按顺序形成流水线：生成→审查→优化',
              }[strategy]}
            </p>
          </div>

          {/* CLI Agent 成员列表 */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium">CLI Agents（{members.length}）</span>
            </div>
            <ScrollArea className="h-[calc(100vh-520px)]">
              <div className="space-y-2 pr-2">
                {members.map((agent) => {
                  const status = cliStatus[agent.id];
                  const avatarData = getAvatarData(agent.name);
                  return (
                    <div key={agent.id} className="flex items-center justify-between p-3 hover:bg-accent/30 rounded-lg border border-border/40 transition-all">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-9 h-9 border border-border/50">
                          {resolveAvatarByName(agent.name, agent.avatar) ? (
                            <AvatarImage src={resolveAvatarByName(agent.name, agent.avatar)} className="object-cover" />
                          ) : (
                            <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                              <Terminal className="w-4 h-4" />
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium">{agent.name}</span>
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                              <Terminal className="w-2.5 h-2.5" /> {agent.cli.adapter}
                            </span>
                          </div>
                          {status === 'loading' && (
                            <span className="text-[10px] text-muted-foreground">检测中...</span>
                          )}
                          {status && status !== 'loading' && status.installed && (
                            <span className="text-[10px] text-green-600 dark:text-green-400 inline-flex items-center gap-0.5">
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              {status.version || '已安装'}
                            </span>
                          )}
                          {status && status !== 'loading' && !status.installed && (
                            <span className="text-[10px] text-red-500 inline-flex items-center gap-0.5">
                              <XCircle className="w-2.5 h-2.5" />
                              未安装
                            </span>
                          )}
                          {mutedUsers.includes(agent.id) && (
                            <span className="text-[10px] text-red-500">已禁言</span>
                          )}
                        </div>
                      </div>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7"
                              onClick={() => onToggleMute(agent.id)}>
                              {mutedUsers.includes(agent.id)
                                ? <MicOff className="w-3.5 h-3.5 text-red-500" />
                                : <Mic className="w-3.5 h-3.5 text-green-500" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {mutedUsers.includes(agent.id) ? '取消禁言' : '禁言'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CLIGroupSettings;
