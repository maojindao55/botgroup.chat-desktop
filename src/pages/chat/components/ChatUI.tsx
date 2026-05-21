/**
 * ChatUI - 主入口分流组件
 * 根据群聊类型分流到对应的 UI 组件：
 * - ai → AIChatUI (本文件内实现，基于原有逻辑)
 * - cli → CLIChatUI (复用原有 CLI 逻辑)
 * - agent → AgentChatUI
 */
import React, { useState, useRef, useEffect } from 'react';
import { Send, Share2, Settings2, ChevronLeft, Bot, Terminal } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { request } from '@/utils/request';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AICharacter, CLIAgent } from "@/config/aiCharacters";
import { cliAgents } from "@/config/aiCharacters";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { SharePoster } from '@/pages/chat/components/SharePoster';
import AIGroupSettings from './AIGroupSettings';
import CLIGroupSettings from './CLIGroupSettings';
import AgentChatUI from './AgentChatUI';
import Sidebar from './Sidebar';
import { AdBanner, AdBannerMobile } from './AdSection';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import type { Group, AIGroup, CLIGroup, AgentGroup, CLIStrategy } from '@/config/groups';


const KaTeXStyle = () => (
  <style dangerouslySetInnerHTML={{ __html: `
    .chat-message .katex-html { display: none; }
    .chat-message .katex { font: normal 1.1em KaTeX_Main, Times New Roman, serif; line-height: 1.2; text-indent: 0; white-space: nowrap; }
    .chat-message .katex-display { display: block; margin: 1em 0; text-align: center; }
  `}} />
);

const ChatUI = () => {
  const userStore = useUserStore();
  const isMobile = useIsMobile();

  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id') ? parseInt(urlParams.get('id')!) : 0;

  // State
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(id);
  const [group, setGroup] = useState<Group | null>(null);
  const [groupAiCharacters, setGroupAiCharacters] = useState<AICharacter[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isGroupDiscussionMode, setIsGroupDiscussionMode] = useState(false);
  const [schedulerStrategy, setSchedulerStrategy] = useState<'tag' | 'round_robin' | 'all'>('tag');
  const [users, setUsers] = useState<any[]>([]);
  const [allNames, setAllNames] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<any[]>([]);
  const [showAd, setShowAd] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [initError, setInitError] = useState<string | null>(null);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);
  const [showPoster, setShowPoster] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [workspacePath, setWorkspacePath] = useState("");
  const [approvalMode, setApprovalMode] = useState<'auto' | 'ask'>('auto');
  const [cliTimeout, setCliTimeout] = useState(300000);
  const [cliStrategy, setCliStrategy] = useState<CLIStrategy>('sequential');

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isInitialized = useRef(false);

  useEffect(() => {
    if (isMobile !== undefined) setSidebarOpen(!isMobile);
  }, [isMobile]);


  // Init data
  useEffect(() => {
    if (isInitialized.current) return;

    const initData = async () => {
      try {
        const response = await request(`/api/init`);
        if (!response.ok) throw new Error('初始化数据失败');
        const { data } = await response.json();

        const currentGroup = data.groups[selectedGroupIndex];
        if (!currentGroup) {
          setInitError('群聊不存在或无权访问');
          setIsInitializing(false);
          return;
        }

        const characters = data.characters || [];
        setGroups(data.groups);
        setGroup(currentGroup);
        setIsInitializing(false);

        // AI/CLI group: resolve members
        if (currentGroup.type === 'ai' || !currentGroup.type) {
          setIsGroupDiscussionMode(currentGroup.isGroupDiscussionMode || false);
          setSchedulerStrategy(currentGroup.schedulerStrategy || 'tag');
          const groupChars = characters
            .filter((c: any) => currentGroup.members?.includes(c.id))
            .filter((c: any) => c.personality !== "sheduler")
            .sort((a: any, b: any) => currentGroup.members.indexOf(a.id) - currentGroup.members.indexOf(b.id));
          setGroupAiCharacters(groupChars);
          setAllNames([...groupChars.map((c: any) => c.name), 'user']);

          let avatar_url = null;
          let nickname = '我';
          if (data.user) {
            const r = await request('/api/user/info');
            const userInfo = await r.json();
            userStore.setUserInfo(userInfo.data);
            avatar_url = userInfo.data.avatar_url;
            nickname = userInfo.data.nickname;
          } else {
            userStore.setUserInfo({ id: 0, phone: '', nickname, avatar_url: null, status: 0 });
          }
          setUsers([{ id: 1, name: nickname, avatar: avatar_url }, ...groupChars]);
        } else if (currentGroup.type === 'cli') {
          const wsOverride = localStorage.getItem(`workspace:${currentGroup.id}`);
          setWorkspacePath(wsOverride || currentGroup.workspacePath || '');
          setApprovalMode(currentGroup.approvalMode || 'auto');
          setCliTimeout(currentGroup.timeout || 300000);
          setCliStrategy(currentGroup.strategy || 'sequential');

          let nickname = '我';
          if (data.user) {
            const r = await request('/api/user/info');
            const userInfo = await r.json();
            userStore.setUserInfo(userInfo.data);
            nickname = userInfo.data.nickname;
          } else {
            userStore.setUserInfo({ id: 0, phone: '', nickname, avatar_url: null, status: 0 });
          }

          const cliMembers = cliAgents.filter(a => currentGroup.members?.includes(a.id));
          setUsers([{ id: 1, name: nickname, avatar: null }, ...cliMembers]);
          setGroupAiCharacters(cliMembers as any);
          setAllNames([...cliMembers.map(a => a.name), 'user']);
        }
        // Agent group handled by AgentChatUI directly
      } catch (error) {
        console.error("初始化数据失败:", error);
        setInitError('加载失败，请刷新重试');
        setIsInitializing(false);
      }
    };

    initData();
    isInitialized.current = true;
  }, [userStore]);


  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  useEffect(() => { if (messages.length > 0) setShowAd(false); }, [messages]);

  const handleToggleMute = (userId: string) => {
    setMutedUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };
  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  const handleSelectGroup = (index: number) => { window.location.href = `?id=${index}`; };

  const handleCreateGroup = (newGroup: Group) => {
    try {
      const stored = localStorage.getItem('custom_groups');
      const customGroups = stored ? JSON.parse(stored) : [];
      customGroups.push(newGroup);
      localStorage.setItem('custom_groups', JSON.stringify(customGroups));
    } catch (e) {
      console.error('Failed to save custom group:', e);
    }
    setGroups(prev => [...prev, newGroup]);
    window.location.href = `?id=${groups.length}`;
  };

  // Loading / Error states
  if (initError) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-orange-50 via-orange-50/70 to-orange-100 dark:from-background dark:via-background dark:to-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-lg font-medium text-foreground mb-2">{initError}</p>
          <button onClick={() => { window.location.href = '/'; }}
            className="px-6 py-2 bg-[#ff6600] text-white rounded-lg hover:bg-[#e55c00] transition-colors">返回首页</button>
        </div>
      </div>
    );
  }

  if (isInitializing || !group) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-orange-50 via-orange-50/70 to-orange-100 dark:from-background dark:via-background dark:to-background flex items-center justify-center">
        <div className="w-8 h-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  // ============ TYPE ROUTING ============

  // Agent 群 → 独立组件
  if (group.type === 'agent') {
    return (
      <AgentChatUI
        group={group as AgentGroup}
        groups={groups}
        selectedGroupIndex={selectedGroupIndex}
        onSelectGroup={handleSelectGroup}
        onCreateGroup={handleCreateGroup}
      />
    );
  }


  // ============ AI / CLI 群的发送消息逻辑 ============
  const handleSendMessage = async () => {
    if (isLoading) return;
    if (!inputMessage.trim()) return;

    const userMessage = {
      id: messages.length + 1,
      sender: users[0],
      content: inputMessage,
      isAI: false,
    };
    setMessages(prev => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    // 构建历史
    let messageHistory = messages.map(msg => ({
      role: 'user',
      content: msg.sender.name === userStore.userInfo.nickname ? 'user：' + msg.content : msg.sender.name + '：' + msg.content,
      name: msg.sender.name,
    }));

    let selectedChars = groupAiCharacters;

    // AI 群：智能调度
    if (group.type === 'ai' && !isGroupDiscussionMode && schedulerStrategy === 'tag') {
      try {
        const res = await request(`/api/scheduler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: inputMessage, history: messageHistory, availableAIs: groupAiCharacters }),
        });
        const data = await res.json();
        if (data.selectedAIs) {
          selectedChars = data.selectedAIs.map((ai: any) => groupAiCharacters.find(c => c.id === ai)).filter(Boolean);
        }
      } catch { /* fallback to all */ }
    }

    // 逐个调用
    for (let i = 0; i < selectedChars.length; i++) {
      const char = selectedChars[i] as any;
      if (mutedUsers.includes(char.id)) continue;

      const aiMessage = {
        id: messages.length + 2 + i,
        sender: { id: char.id, name: char.name, avatar: char.avatar },
        content: "",
        isAI: true,
      };
      setMessages(prev => [...prev, aiMessage]);

      const isCliAgent = char.runtime === 'cli';
      let uri = isCliAgent ? "/api/cli/run" : "/api/chat";
      let requestBody: any;

      if (isCliAgent) {
        const cliCfg = char.cli || { adapter: 'generic' };
        const cleanHistory = messageHistory.slice(-6).map((m: any) => m.content).join('\n');
        requestBody = {
          adapter: cliCfg.adapter,
          prompt: cleanHistory ? `${cleanHistory}\nuser: ${inputMessage}` : inputMessage,
          cwd: workspacePath || null,
          binary: cliCfg.binary || null,
          extraArgs: cliCfg.extraArgs || null,
          env: cliCfg.env || null,
          showStderr: cliCfg.showStderr !== false,
        };
      } else {
        requestBody = {
          model: char.model,
          message: inputMessage,
          query: inputMessage,
          personality: char.personality,
          history: messageHistory,
          index: i,
          aiName: char.name,
          custom_prompt: (char.custom_prompt || '').replace('#groupName#', group.name) + "\n" + group.description,
        };
      }


      try {
        const response = await request(uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error('请求失败');

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error('无法获取响应流');

        let buffer = '';
        let completeResponse = '';
        const timeout = isCliAgent ? 300000 : 10000;

        while (true) {
          const startTime = Date.now();
          let { done, value } = await Promise.race([
            reader.read(),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error('响应超时')), timeout - (Date.now() - startTime))),
          ]);
          if (done) break;

          if (Date.now() - startTime > timeout) {
            reader.cancel();
            console.log("读取超时")
            if (completeResponse.trim() === "") {
              throw new Error('响应超时');
            }
            done = true;
          }

          if (done) {
            if (completeResponse.trim() === "") {
              completeResponse = "对不起，我还不够智能，服务又断开了。";
            }
            // Post-process: collapse <details open> → <details> so the
            // execution block folds up once streaming finishes.
            if (completeResponse.includes('<details open>')) {
              completeResponse = completeResponse.replace(/<details open>/g, '<details>');
            }
            setMessages(prev => {
              const newMessages = [...prev];
              const aiMessageIndex = newMessages.findIndex(msg => msg.id === aiMessage.id);
              if (aiMessageIndex !== -1) {
                newMessages[aiMessageIndex] = {
                  ...newMessages[aiMessageIndex],
                  content: completeResponse
                };
              }
              return newMessages;
            });
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          let newlineIndex;
          while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.content) {
                  completeResponse += data.content;
                  completeResponse = completeResponse.replace(new RegExp(`^(${allNames.join('|')})：`, 'i'), '');
                  setMessages(prev => prev.map(msg =>
                    msg.id === aiMessage.id ? { ...msg, content: completeResponse } : msg
                  ));
                }
              } catch { /* skip */ }
            }
          }
        }

        if (!completeResponse.trim()) {
          completeResponse = "对不起，服务暂时无法响应。";
          setMessages(prev => prev.map(msg =>
            msg.id === aiMessage.id ? { ...msg, content: completeResponse } : msg
          ));
        }

        // 流式结束后，将 <details open> 折叠为 <details>（自动收起执行过程）
        if (completeResponse.includes('<details open>')) {
          completeResponse = completeResponse.replace(/<details open>/g, '<details>');
          setMessages(prev => prev.map(msg =>
            msg.id === aiMessage.id ? { ...msg, content: completeResponse } : msg
          ));
        }

        messageHistory.push({ role: 'user', content: char.name + '：' + completeResponse, name: char.name });
        if (i < selectedChars.length - 1) await new Promise(r => setTimeout(r, 1000));
      } catch (error: any) {
        const errMsg = error?.message || '未知错误';
        messageHistory.push({ role: 'user', content: `${char.name}：[错误: ${errMsg}]`, name: char.name });
        setMessages(prev => prev.map(msg =>
          msg.id === aiMessage.id ? { ...msg, content: `对不起，服务出错(${errMsg})。`, isError: true } : msg
        ));
      }
    }
    setIsLoading(false);
  };


  // ============ RENDER: AI / CLI 群 ============
  const userName = userStore.userInfo.nickname || '我';
  const isCLIGroup = group.type === 'cli';

  return (
    <>
      <KaTeXStyle />

      {/* AI Group Settings */}
      {group.type === 'ai' && (
        <AIGroupSettings
          open={showSettings}
          onOpenChange={setShowSettings}
          group={group as AIGroup}
          users={users}
          mutedUsers={mutedUsers}
          onToggleMute={handleToggleMute}
          isGroupDiscussionMode={isGroupDiscussionMode}
          onToggleGroupDiscussion={() => setIsGroupDiscussionMode(!isGroupDiscussionMode)}
          schedulerStrategy={schedulerStrategy}
          onStrategyChange={setSchedulerStrategy}
        />
      )}

      {/* CLI Group Settings */}
      {group.type === 'cli' && (
        <CLIGroupSettings
          open={showSettings}
          onOpenChange={setShowSettings}
          group={group as CLIGroup}
          members={cliAgents.filter(a => (group as CLIGroup).members?.includes(a.id))}
          mutedUsers={mutedUsers}
          onToggleMute={handleToggleMute}
          workspacePath={workspacePath}
          onWorkspacePathChange={(p) => {
            setWorkspacePath(p);
            if (group.id) {
              if (p) localStorage.setItem(`workspace:${group.id}`, p);
              else localStorage.removeItem(`workspace:${group.id}`);
            }
          }}
          approvalMode={approvalMode}
          onApprovalModeChange={setApprovalMode}
          timeout={cliTimeout}
          onTimeoutChange={setCliTimeout}
          strategy={cliStrategy}
          onStrategyChange={setCliStrategy}
        />
      )}

      {/* Share Poster */}
      {showPoster && (
        <SharePoster messages={messages} onClose={() => setShowPoster(false)} />
      )}

      <div className="fixed inset-0 overflow-hidden bg-white dark:bg-zinc-950 flex items-start justify-center">
        <div className="h-full flex w-full relative overflow-hidden">
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={handleSelectGroup}
            groups={groups}
            onCreateGroup={handleCreateGroup}
          />

          <div className="flex flex-col flex-1 min-w-0">
            {/* Header */}
            <header className="bg-white/90 backdrop-blur-lg dark:bg-zinc-900/90 border-b border-border/60 flex-none shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center md:px-1">
                  <div className="md:hidden flex items-center justify-center m-1 cursor-pointer mr-2" onClick={toggleSidebar}>
                    <ChevronLeft className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div className="flex flex-col items-start justify-center">
                    <div className="flex items-center gap-2">
                      {group.type === 'cli' ? (
                        <Terminal className="w-4 h-4 text-[#ff6600]" />
                      ) : (
                        <Bot className="w-4 h-4 text-[#ff6600]" />
                      )}
                      <h1 className="font-semibold text-sm tracking-wide text-foreground/90">{group.name}</h1>
                      <span className="text-xs text-muted-foreground">({users.length})</span>
                    </div>
                    {group.type === 'cli' && workspacePath && (
                      <div className="text-[10px] text-muted-foreground font-mono truncate max-w-[220px] sm:max-w-[450px] mt-0.5 flex items-center gap-1">
                        <span className="text-[9px] uppercase tracking-wider opacity-60">CWD:</span>
                        <span 
                          onDoubleClick={() => setShowSettings(true)}
                          className="bg-secondary/80 text-secondary-foreground px-1.5 py-0.5 rounded border border-border/40 truncate cursor-pointer hover:bg-secondary hover:text-foreground transition-all select-none" 
                          title="双击以修改本地 Workspace 路径"
                        >
                          {workspacePath}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="hidden md:block">
                    <AdBanner show={showAd} closeAd={() => setShowAd(false)} />
                  </div>
                  <div className="flex -space-x-2">
                    {users.slice(0, 4).map((user) => {
                      const avatarData = getAvatarData(user.name);
                      return (
                        <TooltipProvider key={user.id}>
                          <Tooltip>
                            <TooltipTrigger>
                              <Avatar className="w-8 h-8 border-2 border-background shadow-sm">
                                {resolveAvatarByName(user.name, user.avatar) ? (
                                  <AvatarImage src={resolveAvatarByName(user.name, user.avatar)} className="object-cover" />
                                ) : (
                                  <AvatarFallback style={{ backgroundColor: avatarData.backgroundColor, color: 'white' }} className="text-xs">
                                    {avatarData.text}
                                  </AvatarFallback>
                                )}
                              </Avatar>
                            </TooltipTrigger>
                            <TooltipContent><p>{user.name}</p></TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      );
                    })}
                    {users.length > 4 && (
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-semibold border-2 border-background shadow-sm text-muted-foreground">
                        +{users.length - 4}
                      </div>
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} className="h-8 w-8 rounded-lg hover:bg-accent/60">
                    <Settings2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
              </div>
            </header>


            {/* Chat Area */}
            <div className="flex-1 overflow-hidden bg-stone-50 dark:bg-[#0a0a0f]">
              <ScrollArea className={`h-full ${!showAd ? 'px-4 py-3' : ''} md:px-5 md:py-4`}>
                <div className="md:hidden">
                  <AdBannerMobile show={showAd} closeAd={() => setShowAd(false)} />
                </div>
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div key={message.id}
                      className={`flex items-start gap-3 ${message.sender.name === userName ? "justify-end" : ""}`}>
                      {message.sender.name !== userName && (
                        <Avatar className="w-10 h-10 rounded-full border-2 border-background shadow-sm flex-shrink-0">
                          {resolveAvatarByName(message.sender.name, message.sender.avatar) ? (
                            <AvatarImage src={resolveAvatarByName(message.sender.name, message.sender.avatar)} className="w-10 h-10 object-cover" />
                          ) : (
                            <AvatarFallback style={{ backgroundColor: getAvatarData(message.sender.name).backgroundColor, color: 'white' }} className="text-xs">
                              {getAvatarData(message.sender.name).text}
                            </AvatarFallback>
                          )}
                        </Avatar>
                      )}
                      <div className={message.sender.name === userName ? "text-right max-w-[75%]" : "max-w-[75%]"}>
                        <div className="text-xs text-muted-foreground/75 px-1 flex items-center gap-1.5">
                          {message.sender.name}
                          {message.isAI && isLoading && messages[messages.length - 1]?.id === message.id && !message.content.includes('</details>') && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-orange-500 font-medium">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
                              {message.content === '' ? '思考中' : (message.sender?.id?.startsWith('cli-') ? '执行中' : '输出中')}
                            </span>
                          )}
                        </div>
                        <div className={`mt-1 p-3 px-4 shadow-sm chat-message ${
                          message.sender.name === userName
                            ? "bg-gradient-to-tr from-orange-500 to-amber-500 text-white text-left rounded-2xl rounded-tr-sm shadow-sm"
                            : "bg-white dark:bg-zinc-800/90 border border-border/60 dark:border-zinc-700/50 rounded-2xl rounded-tl-sm text-left shadow-sm"
                        }`}>
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm, remarkMath]}
                            rehypePlugins={[rehypeKatex, rehypeRaw]}
                            className={`prose dark:prose-invert max-w-none text-sm leading-relaxed ${
                              message.sender.name === userName ? "text-white [&_*]:text-white" : ""
                            }
                            [&_h2]:py-1
                            [&_h2]:m-0
                            [&_h3]:py-1.5
                            [&_h3]:m-0
                            [&_p]:m-0 
                            [&_pre]:bg-gray-900 
                            [&_pre]:p-2
                            [&_pre]:m-0 
                            [&_pre]:rounded-lg
                            [&_pre]:text-gray-100
                            [&_pre]:whitespace-pre-wrap
                            [&_pre]:break-words
                            [&_pre_code]:whitespace-pre-wrap
                            [&_pre_code]:break-words
                            [&_pre_code]:bg-transparent
                            [&_pre_code]:text-inherit
                            [&_pre_code]:p-0
                            [&_pre_code]:rounded-none
                            [&_code]:text-xs
                            [&_code]:text-gray-800
                            [&_code]:dark:text-gray-300
                            [&_code:not(:where(pre_*))]:text-orange-800
                            [&_code:not(:where(pre_*))]:bg-orange-100
                            [&_code:not(:where(pre_*))]:px-1.5
                            [&_code:not(:where(pre_*))]:py-0.5
                            [&_code:not(:where(pre_*))]:rounded
                            [&_code:not(:where(pre_*))]:dark:text-orange-300
                            [&_code:not(:where(pre_*))]:dark:bg-orange-950/30
                            [&_a]:text-[#ff6600]
                            [&_a]:no-underline
                            [&_a]:hover:underline
                            [&_a]:underline-offset-2
                            [&_ul]:my-2
                            [&_ol]:my-2
                            [&_li]:my-1
                            [&_blockquote]:border-l-4
                            [&_blockquote]:border-orange-300
                            [&_blockquote]:dark:border-orange-700
                            [&_blockquote]:bg-orange-50/50
                            [&_blockquote]:dark:bg-orange-950/20
                            [&_blockquote]:pl-4
                            [&_blockquote]:my-2
                            [&_blockquote]:italic
                            [&_blockquote]:rounded-r-lg
                            [&_details]:my-2
                            [&_details]:rounded-xl
                            [&_details]:bg-gradient-to-b
                            [&_details]:from-slate-50
                            [&_details]:to-slate-100
                            [&_details]:dark:from-zinc-800/70
                            [&_details]:dark:to-zinc-800/40
                            [&_details]:border
                            [&_details]:border-slate-200/80
                            [&_details]:dark:border-zinc-600/40
                            [&_details]:p-3
                            [&_details]:px-4
                            [&_details]:text-xs
                            [&_details]:shadow-sm
                            [&_details_hr]:my-2
                            [&_details_hr]:border-slate-200/60
                            [&_details_hr]:dark:border-zinc-600/30
                            [&_summary]:cursor-pointer
                            [&_summary]:font-semibold
                            [&_summary]:text-sm
                            [&_summary]:text-slate-600
                            [&_summary]:dark:text-slate-300
                            [&_summary]:select-none
                            [&_summary]:py-0.5
                            [&_summary]:hover:text-orange-600
                            [&_summary]:dark:hover:text-orange-400
                            [&_summary]:transition-colors
                            [&_details_blockquote]:border-l-2
                            [&_details_blockquote]:border-slate-300
                            [&_details_blockquote]:dark:border-zinc-500
                            [&_details_blockquote]:bg-white/60
                            [&_details_blockquote]:dark:bg-zinc-900/40
                            [&_details_blockquote]:text-slate-500
                            [&_details_blockquote]:dark:text-slate-400
                            [&_details_blockquote]:pl-3
                            [&_details_blockquote]:py-1
                            [&_details_blockquote]:my-1.5
                            [&_details_blockquote]:rounded-r-md
                            [&_details_blockquote]:text-[11px]
                            [&_details_blockquote]:not-italic
                            [&_details_pre]:bg-slate-800
                            [&_details_pre]:dark:bg-zinc-900
                            [&_details_pre]:rounded-md
                            [&_details_pre]:p-2
                            [&_details_pre]:text-[11px]
                            [&_details_pre]:my-1.5
                            [&_details_pre]:max-h-[150px]
                            [&_details_pre]:overflow-y-auto`}
                          >
                            {message.content}
                          </ReactMarkdown>
                          {message.isAI && isLoading && messages[messages.length - 1]?.id === message.id && (
                            <span className="typing-indicator ml-1">▋</span>
                          )}
                        </div>
                      </div>
                      {message.sender.name === userName && (
                        <Avatar className="w-10 h-10 rounded-full border-2 border-background shadow-sm flex-shrink-0">
                          {resolveAvatarByName(message.sender.name, message.sender.avatar) ? (
                            <AvatarImage src={resolveAvatarByName(message.sender.name, message.sender.avatar)} className="object-cover" />
                          ) : (
                            <AvatarFallback style={{ backgroundColor: getAvatarData(message.sender.name).backgroundColor, color: 'white' }} className="text-xs">
                              {getAvatarData(message.sender.name).text}
                            </AvatarFallback>
                          )}
                        </Avatar>
                      )}
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>
            </div>


            {/* Input Area */}
            <div className="bg-white dark:bg-zinc-900 border-t border-border/60 dark:border-zinc-800 px-5 py-3 shadow-[0_-1px_3px_rgba(0,0,0,0.04)]">
              <div className="flex items-center gap-3 pb-[env(safe-area-inset-bottom)]">
                {messages.length > 0 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => setShowPoster(true)}
                          className="h-9 w-9 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 flex-shrink-0">
                          <Share2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent><p>分享聊天记录</p></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <div className="flex-1 relative">
                  <Input
                    placeholder={isCLIGroup ? "输入指令，CLI Agent 将在 workspace 中执行..." : "输入消息..."}
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

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-10 md:hidden" onClick={toggleSidebar} />
      )}
    </>
  );
};

export default ChatUI;
