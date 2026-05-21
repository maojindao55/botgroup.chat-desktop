/**
 * Agent 群聊对话组件
 * 独立的聊天 UI，使用 agentEngine 策略引擎驱动对话
 */
import { useState, useRef, useEffect } from 'react';
import { Settings2, ChevronLeft, Puzzle } from 'lucide-react';
import { Tooltip } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
import { ChatInputArea } from '@lobehub/ui/chat';
import { createStyles } from 'antd-style';
import { ChatMarkdown } from '@/components/Markdown';
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
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.3);
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
  agentBadge: css`
    margin-left: 6px;
    font-size: 10px;
    color: #a855f7;
  `,
  agentTagPurple: css`
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(168, 85, 247, 0.12);
    color: #a855f7;
    font-weight: 500;
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
  emptyState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 0;
    color: ${token.colorTextTertiary};
  `,
  emptyAgentTag: css`
    font-size: 12px;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
    padding: 4px 10px;
    border-radius: 999px;
  `,
}));

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
  const { styles } = useStyles();

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

      <div className={styles.page}>
        <div className={styles.container}>
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={onSelectGroup}
            groups={groups}
            onCreateGroup={onCreateGroup}
          />

          <div className={styles.rightCol}>
            {/* Header */}
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <div className={styles.mobileBackBtn} onClick={toggleSidebar}>
                    <ChevronLeft size={20} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Puzzle size={16} color="#ff6600" />
                    <h1 style={{ margin: 0, fontWeight: 600, fontSize: 14, letterSpacing: '0.02em' }}>
                      {group.name}
                    </h1>
                    <span style={{ fontSize: 12, opacity: 0.6 }}>
                      ({group.agents.length} agents)
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className={styles.avatarStack}>
                    {group.agents.slice(0, 4).map(agent => {
                      const a = getAvatarData(agent.name);
                      const url = resolveAvatarByName(agent.name, agent.avatar);
                      return (
                        <Tooltip key={agent.id} title={`${agent.name} - ${agent.role}`}>
                          <LobeAvatar
                            avatar={url || a.text}
                            background={a.backgroundColor}
                            shape="circle"
                            size={32}
                            title={agent.name}
                            style={{ flexShrink: 0 }}
                          />
                        </Tooltip>
                      );
                    })}
                    {group.agents.length > 4 && (
                      <div className={styles.avatarMore}>+{group.agents.length - 4}</div>
                    )}
                  </div>
                  <span className={styles.agentTagPurple}>
                    {strategyLabels[group.strategy] || group.strategy}
                  </span>
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
              {messages.length === 0 && (
                <div className={styles.emptyState}>
                  <Puzzle size={48} style={{ opacity: 0.4, marginBottom: 16 }} />
                  <p style={{ fontSize: 18, fontWeight: 500, margin: 0 }}>Agent 协作群</p>
                  <p style={{ fontSize: 14, marginTop: 8, textAlign: 'center', maxWidth: 480 }}>
                    {group.description}
                  </p>
                  <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                    {group.agents.map(a => (
                      <span key={a.id} className={styles.emptyAgentTag}>
                        {a.name}: {a.role}
                      </span>
                    ))}
                  </div>
                  <p style={{ fontSize: 12, marginTop: 16, opacity: 0.6 }}>
                    策略: {strategyLabels[group.strategy] || group.strategy} | 最大轮数: {group.maxRounds}
                  </p>
                </div>
              )}

              <div className={styles.messageList}>
                {messages.map((message) => {
                  const isUser = message.sender.name === userName;
                  const a = getAvatarData(message.sender.name);
                  const url = resolveAvatarByName(message.sender.name, message.sender.avatar);
                  const isLatest = messages[messages.length - 1]?.id === message.id;
                  const isStreaming = !!message.isAI && isLoading && isLatest;

                  let bubbleClass = styles.bubbleAI;
                  if (isUser) bubbleClass = styles.bubbleUser;
                  else if (message.isError) bubbleClass = styles.bubbleError;

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
                          size={32}
                          title={message.sender.name}
                          style={{ flexShrink: 0 }}
                        />
                      )}
                      <div style={{ maxWidth: '75%', textAlign: isUser ? 'right' : 'left' }}>
                        <div className={styles.metaRow} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                          {message.sender.name}
                          {!isUser && (
                            <span className={styles.agentBadge}>agent</span>
                          )}
                        </div>
                        <div className={bubbleClass}>
                          <ChatMarkdown content={message.content} isUser={isUser} />
                          {isStreaming && (
                            <span className="typing-indicator" style={{ marginLeft: 4 }}>▋</span>
                          )}
                        </div>
                      </div>
                      {isUser && (
                        <LobeAvatar
                          avatar={userStore.userInfo?.avatar_url || a.text}
                          background={a.backgroundColor}
                          shape="circle"
                          size={32}
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
                placeholder="输入消息，Agent 将按策略协作回复..."
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className={styles.mobileOverlay} onClick={toggleSidebar} />
      )}
    </>
  );
};

export default AgentChatUI;
