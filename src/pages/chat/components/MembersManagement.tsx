import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserPlus, Mic, MicOff, FolderOpen, Terminal, CheckCircle2, XCircle } from 'lucide-react';
import { type AICharacter } from "@/config/aiCharacters";
import { Switch } from "@/components/ui/switch";
import { request } from "@/utils/request";

interface User {
  id: number | string;
  name: string;
  avatar?: string;
}

interface MembersManagementProps {
  showMembers: boolean;
  setShowMembers: (show: boolean) => void;
  users: (User | AICharacter)[];
  mutedUsers: string[];
  handleToggleMute: (userId: string) => void;
  getAvatarData: (name: string) => { backgroundColor: string; text: string };
  isGroupDiscussionMode: boolean;
  onToggleGroupDiscussion: () => void;
  /** Group id, used to scope the workspacePath localStorage key. */
  groupId?: string;
  /** Initial workspace path from group config (may be overridden by localStorage). */
  initialWorkspacePath?: string;
  /** Called when the user edits workspacePath; receives the new absolute path. */
  onWorkspacePathChange?: (path: string) => void;
}

type CliStatus = { installed: boolean; version?: string; path?: string };

export const MembersManagement = ({
  showMembers,
  setShowMembers,
  users,
  mutedUsers,
  handleToggleMute,
  getAvatarData,
  isGroupDiscussionMode,
  onToggleGroupDiscussion,
  groupId,
  initialWorkspacePath,
  onWorkspacePathChange,
}: MembersManagementProps) => {
  const [cliStatus, setCliStatus] = useState<Record<string, CliStatus | 'loading'>>({});
  const [workspacePath, setWorkspacePath] = useState<string>(initialWorkspacePath || '');

  // Detect which CLI members are installed when the sheet opens.
  useEffect(() => {
    if (!showMembers) return;
    const cliMembers = users.filter(
      (u): u is AICharacter => 'runtime' in u && (u as AICharacter).runtime === 'cli'
    );
    if (cliMembers.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const m of cliMembers) {
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
  }, [showMembers, users]);

  const hasCliMembers = users.some(
    (u) => 'runtime' in u && (u as AICharacter).runtime === 'cli'
  );

  const persistWorkspacePath = (p: string) => {
    setWorkspacePath(p);
    if (groupId) {
      if (p) localStorage.setItem(`workspace:${groupId}`, p);
      else localStorage.removeItem(`workspace:${groupId}`);
    }
    onWorkspacePathChange?.(p);
  };

  return (
    <Sheet open={showMembers} onOpenChange={setShowMembers}>
      <SheetContent side="right" className="w-[300px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>群聊配置</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <div className="mb-6 p-4 bg-muted rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm">全员讨论模式</div>
                <div className="text-xs text-muted-foreground">开启后全员回复讨论</div>
              </div>
              <Switch
                checked={isGroupDiscussionMode}
                onCheckedChange={onToggleGroupDiscussion}
              />
            </div>
          </div>

          {hasCliMembers && (
            <div className="mb-6 p-4 bg-muted rounded-lg space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FolderOpen className="w-4 h-4" />
                <span>本地 Workspace</span>
              </div>
              <div className="text-xs text-muted-foreground">
                CLI Agent (Codex / ClaudeCode / OpenCode 等) 将在此目录下执行。请填写绝对路径。
              </div>
              <Input
                placeholder="/Users/you/projects/your-repo"
                value={workspacePath}
                onChange={(e) => persistWorkspacePath(e.target.value)}
                className="text-sm font-mono"
              />
            </div>
          )}

          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-muted-foreground">当前成员（{users.length}）</span>
            <Button variant="outline" size="sm">
              <UserPlus className="w-4 h-4 mr-2" />
              添加成员
            </Button>
          </div>
          <ScrollArea className="h-[calc(100vh-150px)]">
            <div className="space-y-2 pr-4">
              {users.map((user) => {
                const isCli = 'runtime' in user && (user as AICharacter).runtime === 'cli';
                const status = isCli ? cliStatus[user.id as string] : undefined;
                return (
                  <div key={user.id} className="flex items-center justify-between p-2 hover:bg-accent rounded-lg">
                    <div className="flex items-center gap-3">
                      <Avatar>
                        {'avatar' in user && user.avatar ? (
                          <AvatarImage src={user.avatar} className="w-10 h-10" />
                        ) : (
                          <AvatarFallback style={{ backgroundColor: getAvatarData(user.name).backgroundColor, color: 'white' }}>
                            {user.name[0]}
                          </AvatarFallback>
                        )}
                      </Avatar>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1.5">
                          <span>{user.name}</span>
                          {isCli && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300">
                              <Terminal className="w-2.5 h-2.5" /> CLI
                            </span>
                          )}
                        </div>
                        {isCli && status === 'loading' && (
                          <span className="text-[10px] text-muted-foreground">检测中...</span>
                        )}
                        {isCli && status && status !== 'loading' && status.installed && (
                          <span className="text-[10px] text-green-600 dark:text-green-400 inline-flex items-center gap-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            {status.version || '已安装'}
                          </span>
                        )}
                        {isCli && status && status !== 'loading' && !status.installed && (
                          <span className="text-[10px] text-red-500 inline-flex items-center gap-0.5">
                            <XCircle className="w-2.5 h-2.5" />
                            未安装
                          </span>
                        )}
                        {mutedUsers.includes(user.id as string) && (
                          <span className="text-xs text-red-500">已禁言</span>
                        )}
                      </div>
                    </div>
                    {user.name !== "我" && (
                      <div className="flex gap-2">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleToggleMute(user.id as string)}
                              >
                                {mutedUsers.includes(user.id as string) ? (
                                  <MicOff className="w-4 h-4 text-red-500" />
                                ) : (
                                  <Mic className="w-4 h-4 text-green-500" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              {mutedUsers.includes(user.id as string) ? '取消禁言' : '禁言'}
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
};
