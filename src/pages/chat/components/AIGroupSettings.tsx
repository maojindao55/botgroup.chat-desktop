/**
 * AI 群聊配置面板 - 成员管理 + 调度策略配置
 * 用于 AI 群聊的 MembersManagement 替代组件
 */
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { UserPlus, Mic, MicOff, Check, X } from 'lucide-react';
import { cn } from "@/lib/utils";
import { getAvailableAICharacters } from '@/config/aiCharacters';
import type { AICharacter } from '@/config/aiCharacters';
import type { AIGroup } from '@/config/groups';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';


interface User {
  id: number | string;
  name: string;
  avatar?: string;
}

interface AIGroupSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: AIGroup;
  users: (User | AICharacter)[];
  mutedUsers: string[];
  onToggleMute: (userId: string) => void;
  isGroupDiscussionMode: boolean;
  onToggleGroupDiscussion: () => void;
  schedulerStrategy: 'tag' | 'round_robin' | 'all';
  onStrategyChange: (strategy: 'tag' | 'round_robin' | 'all') => void;
  onAddMember?: (memberId: string) => void;
  onRemoveMember?: (memberId: string) => void;
}

export const AIGroupSettings = ({
  open,
  onOpenChange,
  group,
  users,
  mutedUsers,
  onToggleMute,
  isGroupDiscussionMode,
  onToggleGroupDiscussion,
  schedulerStrategy,
  onStrategyChange,
  onAddMember,
  onRemoveMember,
}: AIGroupSettingsProps) => {
  const [showAddMember, setShowAddMember] = useState(false);
  const allCharacters = getAvailableAICharacters();
  const currentMemberIds = users.filter(u => 'personality' in u).map(u => u.id as string);
  const availableToAdd = allCharacters.filter(c => !currentMemberIds.includes(c.id));


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[320px] sm:w-[400px]">
        <SheetHeader>
          <SheetTitle>AI 群聊配置</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-5">
          {/* 全员讨论模式 */}
          <div className="p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">全员讨论模式</div>
                <div className="text-xs text-muted-foreground">开启后全员每轮回复</div>
              </div>
              <Switch checked={isGroupDiscussionMode} onCheckedChange={onToggleGroupDiscussion} />
            </div>
          </div>

          {/* 调度策略 */}
          {!isGroupDiscussionMode && (
            <div className="space-y-2">
              <label className="text-sm font-medium">调度策略</label>
              {[
                { value: 'tag' as const, label: '标签匹配', desc: '根据消息智能匹配相关AI' },
                { value: 'round_robin' as const, label: '轮询', desc: '按顺序轮流回复' },
                { value: 'all' as const, label: '全员', desc: '所有成员都回复' },
              ].map(item => (
                <button key={item.value}
                  onClick={() => onStrategyChange(item.value)}
                  className={cn(
                    "w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all",
                    schedulerStrategy === item.value
                      ? "border-[#ff6600] bg-orange-50 dark:bg-orange-950/20"
                      : "border-border hover:bg-accent/30"
                  )}>
                  <div className="flex-1">
                    <div className="text-xs font-medium">{item.label}</div>
                    <div className="text-[10px] text-muted-foreground">{item.desc}</div>
                  </div>
                  {schedulerStrategy === item.value && <Check className="w-3.5 h-3.5 text-[#ff6600]" />}
                </button>
              ))}
            </div>
          )}


          {/* 成员管理 */}
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm font-medium">群成员（{users.length}）</span>
              <Button variant="outline" size="sm" onClick={() => setShowAddMember(!showAddMember)}>
                <UserPlus className="w-3.5 h-3.5 mr-1.5" />
                添加成员
              </Button>
            </div>

            {/* 添加成员面板 */}
            {showAddMember && availableToAdd.length > 0 && (
              <div className="mb-3 p-3 border rounded-lg bg-muted/30 space-y-2">
                <div className="text-xs text-muted-foreground mb-2">点击添加到群聊</div>
                <ScrollArea className="max-h-[120px]">
                  <div className="space-y-1">
                    {availableToAdd.map(char => {
                      const avatarData = getAvatarData(char.name);
                      return (
                        <button key={char.id}
                          onClick={() => { onAddMember?.(char.id); }}
                          className="w-full flex items-center gap-2 p-2 rounded-md hover:bg-accent/50 text-left transition-all">
                          <Avatar className="w-6 h-6">
                            {resolveAvatarByName(char.name, char.avatar) ? (
                              <AvatarImage src={resolveAvatarByName(char.name, char.avatar)} className="object-cover" />
                            ) : (
                              <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-[10px]">
                                {avatarData.text}
                              </AvatarFallback>
                            )}
                          </Avatar>
                          <span className="text-xs flex-1">{char.name}</span>
                          <UserPlus className="w-3 h-3 text-muted-foreground" />
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* 成员列表 */}
            <ScrollArea className="h-[calc(100vh-420px)]">
              <div className="space-y-1.5 pr-2">
                {users.map((user) => {
                  const avatarData = getAvatarData(user.name);
                  const isAI = 'personality' in user;
                  return (
                    <div key={user.id} className="flex items-center justify-between p-2 hover:bg-accent/30 rounded-lg transition-all">
                      <div className="flex items-center gap-2.5">
                        <Avatar className="w-8 h-8">
                          {resolveAvatarByName(user.name, user.avatar) ? (
                            <AvatarImage src={resolveAvatarByName(user.name, user.avatar)} className="object-cover" />
                          ) : (
                            <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                              {avatarData.text}
                            </AvatarFallback>
                          )}
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="text-sm">{user.name}</span>
                          {mutedUsers.includes(user.id as string) && (
                            <span className="text-[10px] text-red-500">已禁言</span>
                          )}
                        </div>
                      </div>
                      {user.name !== "我" && (
                        <div className="flex gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7"
                                  onClick={() => onToggleMute(user.id as string)}>
                                  {mutedUsers.includes(user.id as string)
                                    ? <MicOff className="w-3.5 h-3.5 text-red-500" />
                                    : <Mic className="w-3.5 h-3.5 text-green-500" />}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {mutedUsers.includes(user.id as string) ? '取消禁言' : '禁言'}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          {isAI && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7"
                                    onClick={() => onRemoveMember?.(user.id as string)}>
                                    <X className="w-3.5 h-3.5 text-muted-foreground hover:text-red-500" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>移除成员</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      )}
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

export default AIGroupSettings;
