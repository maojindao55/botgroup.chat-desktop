/**
 * ChatUI - 主入口分流组件
 * 根据群聊类型分流到对应的 UI 组件：
 * - ai → AIChatUI (本文件内实现，基于原有逻辑)
 * - cli → CLIChatUI (复用原有 CLI 逻辑)
 * - agent → AgentChatUI
 */
import { useState, useRef, useEffect } from "react";
import { Share2, Settings2, ChevronLeft, Bot, Terminal } from "lucide-react";
import { Tooltip } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
import { ChatInputArea } from '@lobehub/ui/chat';
import { createStyles } from 'antd-style';
import { request } from '@/utils/request';
import type { AICharacter, CLIAgent } from "@/config/aiCharacters";
import { cliAgents } from "@/config/aiCharacters";
import { ChatMarkdown } from '@/components/Markdown';
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


const useStyles = createStyles(({ token, css }) => ({
  page: css`
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: ${token.colorBgContainer};
    display: flex;
    align-items: flex-start;
    justify-content: center;
  `,
  container: css`
    height: 100%;
    display: flex;
    width: 100%;
    position: relative;
    overflow: hidden;
  `,
  rightCol: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  `,
  headerBar: css`
    background: ${token.colorBgContainer};
    border-bottom: 1px solid ${token.colorBorderSecondary};
    backdrop-filter: blur(12px);
    flex: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  `,
  headerInner: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
  `,
  chatArea: css`
    flex: 1;
    overflow: auto;
    background: ${token.colorBgLayout};
    padding: 12px 16px;
    @media (min-width: 768px) {
      padding: 16px 20px;
    }
  `,
  inputArea: css`
    background: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 12px 20px;
  `,
  cwdLabel: css`
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.6;
  `,
  cwdPath: css`
    font-family: ${token.fontFamilyCode};
    font-size: 10px;
    background: ${token.colorFillTertiary};
    color: ${token.colorTextSecondary};
    padding: 1px 6px;
    border-radius: 4px;
    border: 1px solid ${token.colorBorderSecondary};
    cursor: pointer;
    user-select: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
    @media (min-width: 640px) {
      max-width: 450px;
    }
    transition: all 0.2s;
    &:hover {
      background: ${token.colorFillSecondary};
      color: ${token.colorText};
    }
  `,
  bubbleUser: css`
    background: linear-gradient(to top right, #f97316, #f59e0b);
    color: #fff;
    text-align: left;
    border-radius: 16px;
    border-top-right-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    padding: 12px 16px;
    margin-top: 4px;
  `,
  bubbleAI: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 16px;
    border-top-left-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    padding: 12px 16px;
    margin-top: 4px;
    text-align: left;
  `,
  bubbleError: css`
    background: ${token.colorErrorBg};
    border: 1px solid ${token.colorErrorBorder};
    border-radius: 16px;
    border-top-left-radius: 4px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    padding: 12px 16px;
    margin-top: 4px;
    text-align: left;
  `,
  metaRow: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
    padding: 0 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  streaming: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #f97316;
    font-weight: 500;
  `,
  streamingDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f97316;
    animation: pulse 1s infinite;
    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.5;
      }
    }
  `,
  avatarStack: css`
    display: flex;
    align-items: center;
    & > * + * {
      margin-left: -8px;
    }
  `,
  avatarMore: css`
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 600;
    border: 2px solid ${token.colorBgContainer};
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  `,
  loadingPage: css`
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%);
  `,
  spinner: css`
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 4px solid #f97316;
    border-top-color: transparent;
    animation: spin 1s linear infinite;
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
  mobileBackBtn: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin: 4px;
    margin-right: 8px;
    cursor: pointer;
    color: ${token.colorTextTertiary};
    @media (min-width: 768px) {
      display: none;
    }
  `,
  mobileOverlay: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10;
    @media (min-width: 768px) {
      display: none;
    }
  `,
  desktopOnly: css`
    display: none;
    @media (min-width: 768px) {
      display: block;
    }
  `,
  mobileOnly: css`
    @media (min-width: 768px) {
      display: none;
    }
  `,
  messageList: css`
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  messageRow: css`
    display: flex;
    align-items: flex-start;
    gap: 12px;
  `,
}));

const ChatUI = () => {
  const userStore = useUserStore();
  const isMobile = useIsMobile();
  const { styles, cx } = useStyles();

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
      <div className={styles.loadingPage}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <p style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{initError}</p>
          <button
            onClick={() => { window.location.href = '/'; }}
            style={{
              padding: '8px 24px',
              background: '#ff6600',
              color: '#fff',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            返回首页
          </button>
        </div>
      </div>
    );
  }

  if (isInitializing || !group) {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.spinner} />
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

      <div className={styles.page}>
        <div className={styles.container}>
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={handleSelectGroup}
            groups={groups}
            onCreateGroup={handleCreateGroup}
          />

          <div className={styles.rightCol}>
            {/* Header */}
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div className={styles.mobileBackBtn} onClick={toggleSidebar}>
                    <ChevronLeft size={20} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {group.type === 'cli' ? (
                        <Terminal size={16} color="#ff6600" />
                      ) : (
                        <Bot size={16} color="#ff6600" />
                      )}
                      <h1 style={{ margin: 0, fontWeight: 600, fontSize: 14, letterSpacing: '0.02em' }}>
                        {group.name}
                      </h1>
                      <span style={{ fontSize: 12, opacity: 0.6 }}>({users.length})</span>
                    </div>
                    {group.type === 'cli' && workspacePath && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                        <span className={styles.cwdLabel}>CWD:</span>
                        <span
                          className={styles.cwdPath}
                          onDoubleClick={() => setShowSettings(true)}
                          title="双击以修改本地 Workspace 路径"
                        >
                          {workspacePath}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={styles.desktopOnly}>
                    <AdBanner show={showAd} closeAd={() => setShowAd(false)} />
                  </div>
                  <div className={styles.avatarStack}>
                    {users.slice(0, 4).map((user) => {
                      const a = getAvatarData(user.name);
                      const url = resolveAvatarByName(user.name, user.avatar);
                      return (
                        <Tooltip key={user.id} title={user.name}>
                          <LobeAvatar
                            avatar={url || a.text}
                            background={a.backgroundColor}
                            shape="circle"
                            size={32}
                            title={user.name}
                            style={{ flexShrink: 0 }}
                          />
                        </Tooltip>
                      );
                    })}
                    {users.length > 4 && (
                      <div className={styles.avatarMore}>+{users.length - 4}</div>
                    )}
                  </div>
                  <ActionIcon
                    icon={Settings2}
                    size="small"
                    onClick={() => setShowSettings(true)}
                    title="设置"
                  />
                </div>
              </div>
            </header>


            {/* Chat Area */}
            <div className={styles.chatArea}>
              <div className={styles.mobileOnly}>
                <AdBannerMobile show={showAd} closeAd={() => setShowAd(false)} />
              </div>
              <div className={styles.messageList}>
                {messages.map((message) => {
                  const isUser = message.sender.name === userName;
                  const a = getAvatarData(message.sender.name);
                  const url = resolveAvatarByName(message.sender.name, message.sender.avatar);
                  const isLatest = messages[messages.length - 1]?.id === message.id;
                  const isStreaming = !!message.isAI && isLoading && isLatest;
                  const isCli = !!message.sender?.id?.startsWith?.('cli-');
                  const bubbleClass = isUser
                    ? styles.bubbleUser
                    : message.isError
                      ? styles.bubbleError
                      : styles.bubbleAI;
                  return (
                    <div
                      key={message.id}
                      className={styles.messageRow}
                      style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}
                    >
                      {!isUser && (
                        <LobeAvatar
                          avatar={url || a.text}
                          background={a.backgroundColor}
                          shape="circle"
                          size={40}
                          title={message.sender.name}
                          style={{ flexShrink: 0 }}
                        />
                      )}
                      <div style={{ maxWidth: '75%', textAlign: isUser ? 'right' : 'left' }}>
                        <div className={styles.metaRow} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                          {message.sender.name}
                          {isStreaming && !message.content.includes('</details>') && (
                            <span className={styles.streaming}>
                              <span className={styles.streamingDot} />
                              {message.content === '' ? '思考中' : (isCli ? '执行中' : '输出中')}
                            </span>
                          )}
                        </div>
                        <div className={cx(bubbleClass, 'chat-message')}>
                          <ChatMarkdown
                            content={message.content}
                            isUser={isUser}
                          />
                          {isStreaming && (
                            <span className="typing-indicator" style={{ marginLeft: 4 }}>▋</span>
                          )}
                        </div>
                      </div>
                      {isUser && (
                        <LobeAvatar
                          avatar={url || a.text}
                          background={a.backgroundColor}
                          shape="circle"
                          size={40}
                          title={message.sender.name}
                          style={{ flexShrink: 0 }}
                        />
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </div>


            {/* Input Area */}
            <div className={styles.inputArea}>
              <ChatInputArea
                value={inputMessage}
                onInput={setInputMessage}
                onSend={handleSendMessage}
                loading={isLoading}
                placeholder={isCLIGroup ? '输入指令，CLI Agent 将在 workspace 中执行...' : '输入消息...'}
                topAddons={
                  messages.length > 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '0 4px' }}>
                      <Tooltip title="分享聊天记录">
                        <ActionIcon
                          icon={Share2}
                          size="small"
                          onClick={() => setShowPoster(true)}
                          title="分享聊天记录"
                        />
                      </Tooltip>
                    </div>
                  ) : null
                }
              />
            </div>
          </div>
        </div>
      </div>

      {sidebarOpen && (
        <div className={styles.mobileOverlay} onClick={toggleSidebar} />
      )}
    </>
  );
};

export default ChatUI;
