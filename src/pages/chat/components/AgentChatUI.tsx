/**
 * Agent 群聊对话组件
 * 独立的聊天 UI，使用 agentEngine 策略引擎驱动对话
 */
import { useState, useRef, useEffect } from 'react';
import { Send, Settings2, ChevronLeft, Puzzle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { ChatMarkdown } from '@/components/Markdown';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { executeAgentStrategy } from '@/engine/agentEngine';
import type { StreamCallback } from '@/engine/agentEngine';
import AgentGroupSettings from './AgentGroupSettings';
import Sidebar from './Sidebar';
import type { AgentGroup, Group } from '@/config/groups';


interface ChatMessage {
  id: number;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  isAI: boolean;
  isError?: boolean;
}

interface AgentChatUIProps {
  group: AgentGroup;
  groups: Group[];
  selectedGroupIndex: number;
  onSelectGroup: (index: number) => void;
  onCreateGroup?: (group: Group) => void;
  onUpdateGroup?: (updates: Partial<AgentGroup>) => void;
}

const AgentChatUI = ({
  group,
  groups,
  selectedGroupIndex,
  onSelectGroup,
  onCreateGroup,
  onUpdateGroup,
}: AgentChatUIProps) => {
  const userStore = useUserStore();
  const isMobile = useIsMobile();

  // 策略中文标签映射
  const strategyLabels: Record<string, string> = {
    sequential: '顺序执行',
    router: '意图路由',
    discussion: '全员讨论',
    react: 'ReAct 循环',
    pipeline: '流水线',
    debate: '辩论',
    mapreduce: 'MapReduce',
    supervisor: '监督者',
  };

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const msgIdCounter = useRef(0);

  useEffect(() => {
    if (isMobile !== undefined) setSidebarOpen(!isMobile);
  }, [isMobile]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleToggleMute = (userId: string) => {
    setMutedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };


  const handleSendMessage = async () => {
    if (isLoading || !inputMessage.trim()) return;

    const userName = userStore.userInfo.nickname || '我';
    const userMsg: ChatMessage = {
      id: ++msgIdCounter.current,
      sender: { id: 'user', name: userName },
      content: inputMessage,
      isAI: false,
    };
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);

    // 构建历史上下文
    const history = messages
      .slice(-20)
      .map(m => `${m.sender.name}: ${m.content}`)
      .join('\n');

    // Agent 消息 ID 映射
    const agentMsgIds: Record<string, number> = {};

    const callbacks: StreamCallback = {
      onAgentStart: (agentId, agentName) => {
        const id = ++msgIdCounter.current;
        agentMsgIds[agentId] = id;
        const agentMsg: ChatMessage = {
          id,
          sender: { id: agentId, name: agentName },
          content: '',
          isAI: true,
        };
        setMessages(prev => [...prev, agentMsg]);
      },
      onToken: (agentId, token) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, content: m.content + token } : m)
        );
      },
      onAgentEnd: (_agentId, _fullContent) => {
        // 消息已通过 onToken 逐步更新完毕
      },
      onError: (agentId, error) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        setMessages(prev =>
          prev.map(m => m.id === msgId
            ? { ...m, content: `[错误] ${error}`, isError: true }
            : m
          )
        );
      },
    };

    try {
      await executeAgentStrategy(group, inputMessage, history, mutedUsers, callbacks);
    } catch (error: any) {
      console.error('Agent strategy execution failed:', error);
    }

    setIsLoading(false);
  };


  const userName = userStore.userInfo.nickname || '我';

  return (
    <>
      <AgentGroupSettings
        open={showSettings}
        onOpenChange={setShowSettings}
        group={group}
        mutedUsers={mutedUsers}
        onToggleMute={handleToggleMute}
        onUpdateGroup={(updates) => onUpdateGroup?.(updates)}
      />

      <div className="fixed inset-0 overflow-hidden bg-white dark:bg-zinc-950 flex items-start justify-center">
        <div className="h-full flex w-full relative overflow-hidden">
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={onSelectGroup}
            groups={groups}
            onCreateGroup={onCreateGroup}
          />

          <div className="flex flex-col flex-1 min-w-0">
            {/* Header */}
            <header className="bg-white/90 backdrop-blur-lg dark:bg-zinc-900/90 border-b border-border/60 flex-none shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center md:px-1">
                  <div className="md:hidden flex items-center justify-center m-1 cursor-pointer mr-2" onClick={toggleSidebar}>
                    <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Puzzle className="w-4 h-4 text-[#ff6600]" />
                    <h1 className="font-semibold text-sm tracking-wide text-foreground/90">{group.name}</h1>
                    <span className="text-xs text-muted-foreground">({group.agents.length} agents)</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex -space-x-2">
                    {group.agents.slice(0, 4).map(agent => {
                      const avatarData = getAvatarData(agent.name);
                      const resolvedAvatar = resolveAvatarByName(agent.name, agent.avatar);
                      return (
                        <TooltipProvider key={agent.id}>
                          <Tooltip>
                            <TooltipTrigger>
                              <Avatar className="w-8 h-8 border-2 border-background shadow-sm">
                                {resolvedAvatar ? (
                                  <AvatarImage src={resolvedAvatar} className="object-cover" />
                                ) : (
                                  <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                                    {avatarData.text}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                            </TooltipTrigger>
                            <TooltipContent><p>{agent.name} - {agent.role}</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    {group.agents.length > 4 && (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold border-2 border-background shadow-sm text-muted-foreground">
                        +{group.agents.length - 4}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 font-medium">
                    {strategyLabels[group.strategy] || group.strategy}
                  </span>
                  <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} className="h-8 w-8 rounded-lg hover:bg-accent/60">
                    <Settings2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </header>


            {/* Chat Area */}
            <div className="flex-1 overflow-hidden bg-stone-50 dark:bg-[#0a0a0f]">
              <ScrollArea className="h-full px-4 py-3 md:px-5 md:py-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-20">
                    <Puzzle className="w-12 h-12 mb-4 text-muted-foreground/40" />
                    <p className="text-lg font-medium">Agent 协作群</p>
                    <p className="text-sm mt-2 text-center max-w-md">{group.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2 justify-center">
                      {group.agents.map(a => (
                        <span key={a.id} className="text-xs bg-muted px-2 py-1 rounded-full">
                          {a.name}: {a.role}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground/60 mt-4">策略: {strategyLabels[group.strategy] || group.strategy} | 最大轮数: {group.maxRounds}</p>
                  </div>
                )}

                <div className="space-y-4">
                  {messages.map((message) => {
                    const isUser = message.sender.name === userName;
                    const avatarData = getAvatarData(message.sender.name);
                    return (
                      <div key={message.id} className={`flex items-start gap-3 ${isUser ? "justify-end" : ""}`}>
                        {!isUser && (
                          <Avatar className="w-8 h-8 rounded-full border-2 border-background shadow-sm flex-shrink-0">
                            {resolveAvatarByName(message.sender.name, message.sender.avatar) ? (
                              <AvatarImage src={resolveAvatarByName(message.sender.name, message.sender.avatar)} className="object-cover" />
                            ) : (
                              <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                                {avatarData.text}
                              </AvatarFallback>
                            )}
                          </Avatar>
                        )}
                        <div className={isUser ? "text-right max-w-[75%]" : "max-w-[75%]"}>
                          <div className="text-xs text-muted-foreground/75 px-1">
                            {message.sender.name}
                            {!isUser && (
                              <span className="ml-1.5 text-[10px] text-purple-500">agent</span>
                            )}
                          </div>
                          <div className={`mt-1 p-3 px-4 shadow-sm ${
                            isUser
                              ? "bg-gradient-to-tr from-orange-500 to-amber-500 text-white text-left rounded-2xl rounded-tr-sm shadow-sm"
                              : message.isError
                                ? "bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-2xl rounded-tl-sm text-left shadow-sm"
                                : "bg-white dark:bg-zinc-800/90 border border-border/60 dark:border-zinc-700/50 rounded-2xl rounded-tl-sm text-left shadow-sm"
                          }`}>
                            <ChatMarkdown
                              content={message.content}
                              isUser={isUser}
                            />
                            {message.isAI && isLoading && messages[messages.length - 1]?.id === message.id && (
                              <span className="typing-indicator ml-1">▋</span>
                            )}
                          </div>
                        </div>
                        {isUser && (
                          <Avatar className="w-8 h-8 rounded-full border-2 border-background shadow-sm flex-shrink-0">
                            {userStore.userInfo?.avatar_url ? (
                              <AvatarImage src={userStore.userInfo.avatar_url} className="object-cover" />
                            ) : (
                              <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                                {avatarData.text}
                              </AvatarFallback>
                            )}
                          </Avatar>
                        )}
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>


            {/* Input Area */}
            <div className="bg-white dark:bg-zinc-900 border-t border-border/60 dark:border-zinc-800 px-5 py-3 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-3 pb-[env(safe-area-inset-bottom)]">
                <div className="flex-1 relative">
                  <Input
                    placeholder="输入消息，Agent 将按策略协作回复..."
                    className="w-full bg-muted/30 dark:bg-muted/15 border-border/30 focus-visible:ring-1 focus-visible:ring-[#ff6600]/50 focus-visible:border-[#ff6600]/30 rounded-xl px-4 py-2.5 h-11 text-sm transition-all"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  />
                </div>
                <Button
                  onClick={handleSendMessage}
                  disabled={isLoading}
                  className="bg-[#ff6600] hover:bg-[#e65c00] text-white shadow-sm hover:shadow-md hover:shadow-orange-500/15 transition-all rounded-xl h-11 px-5 flex-shrink-0"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-10 md:hidden" onClick={toggleSidebar} />
      )}
    </>
  );
};

export default AgentChatUI;
