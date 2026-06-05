/**
 * 专家群聊对话组件
 * 独立的聊天 UI，使用 agentEngine 策略引擎驱动对话
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, Settings2, ChevronLeft, Puzzle } from 'lucide-react';
import { Tooltip, Button as AntdButton, message as antdMessage } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
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
import { isBuiltinGroupId } from '@/config/groupStorage';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { AppSettingsModal } from './AppSettingsModal';
import type { AppSettingsSection } from '@/config/appSettings';
import { MentionTextArea } from './MentionAutocomplete';
import { generateSessionTitle } from '@/utils/sessionTitle';
import { BRAND_ON_PRIMARY, brandPrimaryButtonStyle } from '@/lib/theme';

/** 生成唯一消息 ID */
let _globalMsgId = Date.now();
function nextMsgId(): string {
  return `msg_${++_globalMsgId}_${Math.random().toString(36).slice(2, 8)}`;
}

/** localStorage key for persisting chat messages per group */
function chatStorageKey(groupId: string): string {
  return `agent_chat_messages:${groupId}`;
}

/** localStorage key for the auto-summarized title per group */
function chatTitleKey(groupId: string): string {
  return `agent_chat_title:${groupId}`;
}

interface ChatMessage {
  id: string;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  isAI: boolean;
  isError?: boolean;
  /** 该消息是否仍在流式生成中 */
  isStreaming?: boolean;
}

interface AgentChatUIProps {
  group: AgentGroup;
  groups: Group[];
  selectedGroupIndex: number;
  onSelectGroup: (index: number) => void;
  onCreateGroup?: (group: Group) => void;
  onUpdateGroup?: (updates: Partial<AgentGroup>) => void;
  onEditGroup?: (index: number) => void;
  onDeleteGroup?: (group: Group) => void;
}

const useStyles = createStyles(({ token, css }) => ({
  page: css`
    position: fixed;
    inset: 0;
    overflow: hidden;
    background: ${token.colorBgContainer};
    display: flex;
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
    border-bottom: 1px solid ${token.colorBorder};
    backdrop-filter: blur(12px);
    flex: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  `,
  headerInner: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    height: 46px;
    box-sizing: border-box;
    overflow: hidden;
    padding: 0 12px;
    @media (max-width: 640px) {
      padding: 0 10px;
    }
  `,
  headerLeft: css`
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
  `,
  titleStack: css`
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  `,
  titleRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  `,
  titleIcon: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: 1px solid rgba(255, 102, 0, 0.24);
    border-radius: 7px;
    background: rgba(255, 102, 0, 0.08);
    color: #ff6600;
    flex: none;
  `,
  titleText: css`
    margin: 0;
    min-width: 0;
    max-width: min(46vw, 420px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0;
    color: ${token.colorText};
  `,
  memberCount: css`
    flex: none;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  headerActions: css`
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 1 1 auto;
    min-width: 0;
  `,
  chatArea: css`
    flex: 1;
    overflow: auto;
    background: linear-gradient(180deg, ${token.colorBgContainer} 0%, ${token.colorFillQuaternary} 82%);
    padding: 16px;
    scrollbar-gutter: stable;
    @media (min-width: 768px) {
      padding: 20px 24px;
    }
  `,
  inputArea: css`
    background: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 10px 14px 14px;
  `,
  bubbleUser: css`
    background: #ff6600;
    color: #fff;
    text-align: left;
    border: 1px solid rgba(194, 65, 12, 0.22);
    border-radius: 8px;
    border-top-right-radius: 4px;
    box-shadow: none;
    padding: 9px 12px;
    margin-top: 4px;
    line-height: 1.58;
  `,
  bubbleAI: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    border-top-left-radius: 4px;
    box-shadow: none;
    padding: 9px 12px;
    margin-top: 4px;
    text-align: left;
    line-height: 1.58;
  `,
  bubbleError: css`
    background: ${token.colorErrorBg};
    border: 1px solid ${token.colorErrorBorder};
    border-radius: 8px;
    border-top-left-radius: 4px;
    box-shadow: none;
    padding: 9px 12px;
    margin-top: 4px;
    text-align: left;
    line-height: 1.58;
  `,
  metaRow: css`
    min-height: 18px;
    font-size: 11px;
    font-weight: 500;
    color: ${token.colorTextTertiary};
    padding: 0 2px;
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
    gap: 14px;
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    padding-bottom: 4px;
  `,
  messageRow: css`
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
  `,
  messageBody: css`
    max-width: min(720px, 76%);
    min-width: 0;
    text-align: left;

    @media (max-width: 640px) {
      max-width: calc(100% - 40px);
    }
  `,
  messageBodyUser: css`
    text-align: right;
  `,
  emptyState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    width: min(640px, 100%);
    margin: 0 auto 20px;
    padding: 56px 24px 44px;
    color: ${token.colorTextTertiary};
    text-align: center;
  `,
  emptyAgentTag: css`
    font-size: 12px;
    background: ${token.colorFillSecondary};
    color: ${token.colorTextSecondary};
    padding: 4px 10px;
    border-radius: 999px;
  `,
  emptyIcon: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    margin-bottom: 16px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    color: #ff6600;
  `,
  emptyTitle: css`
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  emptyDescription: css`
    margin: 8px 0 0;
    max-width: 480px;
    font-size: 14px;
    line-height: 1.6;
  `,
  emptyMeta: css`
    margin: 14px 0 0;
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  emptyAgentList: css`
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
    margin-top: 16px;
  `,
  composeShell: css`
    display: flex;
    align-items: flex-end;
    gap: 8px;
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    padding: 6px;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    transition: border-color 0.15s ease, box-shadow 0.15s ease;

    &:focus-within {
      border-color: rgba(255, 102, 0, 0.55);
      box-shadow: 0 0 0 2px rgba(255, 102, 0, 0.1);
    }

    textarea {
      border: none !important;
      box-shadow: none !important;
      background: transparent !important;
      resize: none;
      padding: 7px 8px !important;
    }
  `,
  composeSendButton: css`
    &&& {
      width: 36px;
      height: 36px;
      flex: none;
      border-radius: 7px;
      box-shadow: none;
    }
  `,
  composeStopButton: css`
    &&& {
      height: 36px;
      flex: none;
      border-radius: 7px;
      box-shadow: none;
    }
  `,
  typingCursor: css`
    margin-left: 4px;
    color: #ff6600;
  `,
}));

const AgentChatUI = ({
  group,
  groups,
  selectedGroupIndex,
  onSelectGroup,
  onCreateGroup,
  onUpdateGroup,
  onEditGroup,
  onDeleteGroup,
}: AgentChatUIProps) => {
  const { t } = useTranslation(['chat', 'settings', 'library', 'common']);
  const userStore = useUserStore();
  const isMobile = useIsMobile();
  const { styles, cx } = useStyles();
  const members = useAIMemberStore(s => s.members);
  const membersLoading = useAIMemberStore(s => s.loading);
  const loadMembers = useAIMemberStore(s => s.load);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const currentMemberIds = group.memberIds || group.agents?.map(a => a.id) || [];
  const dbAgents = currentMemberIds
    .map(id => members[id])
    .filter(m => m && (m.kind === 'cli' || m.kind === 'agent'));
  // 优先 store 数据；store 未 ready 时回落到群里的内联 agents（兼容旧数据）
  const currentAgents = dbAgents.length > 0 ? dbAgents : (group.agents || []);
  const mentionCandidates = useMemo(
    () => currentAgents.map(agent => ({
      id: agent.id,
      name: agent.name,
      avatar: agent.avatar,
    })),
    [currentAgents],
  );
  // store 已加载完成但成员仍解析不出来（id 引用失效 / 成员被删）
  const hasUnresolvedMembers =
    !membersLoading && currentMemberIds.length > 0 && currentAgents.length === 0;
  // store 仍在首次加载中且暂时拿不到成员
  const isResolvingMembers =
    membersLoading && currentMemberIds.length > 0 && currentAgents.length === 0;

  const getStrategyLabel = (strategy: string) =>
    t(`settings:strategies.${strategy}.label`, { defaultValue: strategy });

  // === 消息持久化：从 localStorage 加载历史消息 ===
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem(chatStorageKey(group.id));
      if (stored) {
        const parsed = JSON.parse(stored) as ChatMessage[];
        // 恢复时清除遗留的 streaming 标记
        return parsed.map(m => ({ ...m, isStreaming: false }));
      }
    } catch { /* ignore parse errors */ }
    return [];
  });
  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<AppSettingsSection>('general');
  const [groupTitle, setGroupTitle] = useState<string>(() => {
    try {
      return localStorage.getItem(chatTitleKey(group.id)) || '';
    } catch {
      return '';
    }
  });
  // Prevents double title generation across React strict-mode / concurrent re-renders.
  const titleGenRef = useRef<Set<string>>(new Set());

  /** 当前请求的 AbortController，用于取消正在进行的 Agent 策略执行 */
  const abortControllerRef = useRef<AbortController | null>(null);

  // 持久化消息到 localStorage（去除 isStreaming 标记）
  useEffect(() => {
    try {
      const toStore = messages.map(({ isStreaming: _, ...rest }) => rest);
      localStorage.setItem(chatStorageKey(group.id), JSON.stringify(toStore.slice(-100)));
    } catch { /* quota exceeded etc */ }
  }, [messages, group.id]);

  // 群切换时重新加载消息
  useEffect(() => {
    try {
      const stored = localStorage.getItem(chatStorageKey(group.id));
      if (stored) {
        const parsed = JSON.parse(stored) as ChatMessage[];
        setMessages(parsed.map(m => ({ ...m, isStreaming: false })));
      } else {
        setMessages([]);
      }
    } catch {
      setMessages([]);
    }
  }, [group.id]);

  // 群切换时重新加载已缓存的标题
  useEffect(() => {
    try {
      setGroupTitle(localStorage.getItem(chatTitleKey(group.id)) || '');
    } catch {
      setGroupTitle('');
    }
  }, [group.id]);

  // 首轮对话结束后用 LLM 自动总结标题（参考角色群聊 / CLI Agent 群聊）
  useEffect(() => {
    if (isLoading) return;
    if (messages.length === 0) return;
    if (groupTitle) return;
    if (titleGenRef.current.has(group.id)) return;

    const userMsg = messages.find(m => !m.isAI && (m.content || '').trim());
    const aiMsg = messages.find(m => m.isAI && !m.isError && (m.content || '').trim());
    const firstAgent = currentAgents[0];
    if (!userMsg || !aiMsg || !firstAgent?.model) return;

    const gid = group.id;
    titleGenRef.current.add(gid);
    generateSessionTitle({
      userMessage: userMsg.content,
      aiMessage: aiMsg.content,
      model: firstAgent.model,
      providerId: firstAgent.providerId,
    })
      .then(title => {
        if (!title) return;
        setGroupTitle(title);
        try {
          localStorage.setItem(chatTitleKey(gid), title);
        } catch {
          /* quota exceeded etc */
        }
      })
      .finally(() => {
        titleGenRef.current.delete(gid);
      });
    // currentAgents is memoized from props; no need to re-run on its identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading, group.id, groupTitle]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('settings') === '1') {
      setShowSettings(true);
      params.delete('settings');
      window.history.replaceState({}, '', `${window.location.pathname}?${params}`);
    }
  }, []);

  const AGENT_SETTINGS_WIDTH = 440;

  /** 桌面端打开右侧 inline 面板时同步扩展 Tauri 窗口宽度（移动端跳过） */
  const adjustWindowWidthForPanel = (deltaPx: number) => {
    if (isMobile) return;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
    (async () => {
      try {
        const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
        const appWindow = getCurrentWindow();
        const isMax = await appWindow.isMaximized();
        const isFull = await appWindow.isFullscreen();
        if (isMax || isFull) return;
        const scaleFactor = await appWindow.scaleFactor();
        const physicalSize = await appWindow.innerSize();
        const logicalSize = physicalSize.toLogical(scaleFactor);
        await appWindow.setSize(new LogicalSize(logicalSize.width + deltaPx, logicalSize.height));
      } catch (e) {
        console.error('Failed to resize window:', e);
      }
    })();
  };

  const openAppSettings = (section: AppSettingsSection = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const handleToggleSettings = (nextOpen: boolean) => {
    if (nextOpen === showSettings) return;
    setShowSettings(nextOpen);
    adjustWindowWidthForPanel(nextOpen ? AGENT_SETTINGS_WIDTH : -AGENT_SETTINGS_WIDTH);
  };

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);

  useEffect(() => {
    if (isMobile !== undefined) setSidebarOpen(!isMobile);
  }, [isMobile]);

  const handleChatAreaScroll = () => {
    const el = chatAreaRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    shouldStickToBottomRef.current = distanceToBottom < 80;
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    scrollMessagesToBottom('auto');
  }, [group.id]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollMessagesToBottom('smooth');
    }
  }, [messages]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleToggleMute = (userId: string) => {
    setMutedUsers(prev =>
      prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]
    );
  };

  /** 取消正在进行的请求 */
  const handleAbort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    // 标记所有 streaming 消息为已完成
    setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
  }, []);

  const handleSendMessage = async () => {
    if (isLoading || !inputMessage.trim()) return;

    const userName = userStore.userInfo.nickname || t('settings:aiGroup.selfName');
    const capturedInput = inputMessage;
    const userMsg: ChatMessage = {
      id: nextMsgId(),
      sender: { id: 'user', name: userName },
      content: capturedInput,
      isAI: false,
    };
    shouldStickToBottomRef.current = true;
    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);

    // 创建 AbortController
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 修复闭包问题：使用 setMessages 的 updater 获取最新 messages 构建 history
    // 同时将当前用户消息包含在内
    let history = '';
    setMessages(prev => {
      history = prev
        .slice(-20)
        .map(m => `${m.sender.name}: ${m.content}`)
        .join('\n');
      return prev; // 不修改 state，仅读取
    });

    // Agent 消息 ID 映射（支持多轮：每次 onAgentStart 都分配唯一 ID）
    const agentMsgIds: Record<string, string> = {};

    const callbacks: StreamCallback = {
      onAgentStart: (agentId, agentName) => {
        const id = nextMsgId();
        agentMsgIds[agentId] = id;
        const agentMsg: ChatMessage = {
          id,
          sender: { id: agentId, name: agentName },
          content: '',
          isAI: true,
          isStreaming: true,
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
      onAgentEnd: (agentId, _fullContent) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        setMessages(prev =>
          prev.map(m => m.id === msgId ? { ...m, isStreaming: false } : m)
        );
      },
      onError: (agentId, error) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        setMessages(prev =>
          prev.map(m => m.id === msgId
            ? { ...m, content: t('chat:errors.appendError', { error }), isError: true, isStreaming: false }
            : m
          )
        );
      },
      onInfo: (infoMsg) => {
        antdMessage.info(infoMsg);
      },
    };

    try {
      await executeAgentStrategy(group, capturedInput, history, mutedUsers, callbacks, {
        signal: controller.signal,
      });
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        // 用户主动取消，不需要报错
        antdMessage.info(t('chat:agentChat.aborted', { defaultValue: '已停止生成' }));
      } else {
        console.error('Agent strategy execution failed:', error);
        // 顶层错误提示用户
        const errorMsg = error?.message || t('chat:errors.unknownError', { defaultValue: '未知错误' });
        antdMessage.error(t('chat:errors.strategyFailed', { defaultValue: `策略执行失败: ${errorMsg}` }));
        // 同时在聊天中添加错误消息
        const errChatMsg: ChatMessage = {
          id: nextMsgId(),
          sender: { id: '__system__', name: t('chat:agentChat.system', { defaultValue: '系统' }) },
          content: t('chat:errors.strategyFailed', { defaultValue: `策略执行失败: ${errorMsg}` }),
          isAI: true,
          isError: true,
        };
        setMessages(prev => [...prev, errChatMsg]);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
      // 确保所有消息的 streaming 状态被清除
      setMessages(prev => prev.map(m => m.isStreaming ? { ...m, isStreaming: false } : m));
    }
  };


  const userName = userStore.userInfo.nickname || t('settings:aiGroup.selfName');

  return (
    <>
      {/* Agent Group Settings (Mobile Drawer) */}
      {isMobile && (
        <AgentGroupSettings
          open={showSettings}
          onOpenChange={handleToggleSettings}
          group={group}
          mutedUsers={mutedUsers}
          onToggleMute={handleToggleMute}
          onUpdateGroup={(updates) => onUpdateGroup?.(updates)}
          onDeleteGroup={() => onDeleteGroup?.(group)}
          canDeleteGroup={!isBuiltinGroupId(group.id)}
        />
      )}

      <div className={styles.page}>
        <div className={styles.container}>
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={onSelectGroup}
            groups={groups}
            onCreateGroup={onCreateGroup}
            onOpenSettings={openAppSettings}
            onNavigateCLI={() => { window.location.href = '?view=cli-tasks'; }}
            onNavigateHome={() => { window.location.href = '?view=home'; }}
            hiddenGroupTypes={['cli']}
          />

          <div className={styles.rightCol}>
            {/* Header */}
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div className={styles.headerLeft}>
                  <div className={styles.mobileBackBtn} onClick={toggleSidebar}>
                    <ChevronLeft size={20} />
                  </div>
                  <div className={styles.titleStack}>
                    <div className={styles.titleRow}>
                      <span className={styles.titleIcon}>
                        <Puzzle size={15} />
                      </span>
                      <h1 className={styles.titleText}>
                        {groupTitle || group.name}
                      </h1>
                      <span className={styles.memberCount}>
                        ({t('chat:agentChat.expertCount', { count: currentAgents.length })})
                      </span>
                    </div>
                  </div>
                </div>
                <div className={styles.headerActions}>
                  <div className={styles.avatarStack}>
                    {currentAgents.slice(0, 4).map(agent => {
                      const a = getAvatarData(agent.name);
                      const url = resolveAvatarByName(agent.name, agent.avatar, 32);
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
                    {currentAgents.length > 4 && (
                      <div className={styles.avatarMore}>+{currentAgents.length - 4}</div>
                    )}
                  </div>
                  <span className={styles.agentTagPurple}>
                    {getStrategyLabel(group.strategy)}
                  </span>
                  <ActionIcon
                    icon={Settings2}
                    size="small"
                    onClick={() => handleToggleSettings(!showSettings)}
                    title={t('chat:agentChat.settings')}
                  />
                </div>
              </div>
            </header>


            {/* Chat Area */}
            <div
              ref={chatAreaRef}
              className={styles.chatArea}
              onScroll={handleChatAreaScroll}
            >
              {messages.length === 0 && (
                <div className={styles.emptyState}>
                  <span className={styles.emptyIcon}>
                    <Puzzle size={26} />
                  </span>
                  <p className={styles.emptyTitle}>{t('chat:agentChat.emptyTitle')}</p>
                  <p className={styles.emptyDescription}>
                    {group.description}
                  </p>
                  {isResolvingMembers && (
                    <p className={styles.emptyMeta}>
                      {t('chat:agentChat.loadingLibrary')}
                    </p>
                  )}
                  {hasUnresolvedMembers && (
                    <p className={styles.emptyMeta} style={{ color: '#ef4444' }}>
                      {t('chat:agentChat.unresolvedMembers', { count: currentMemberIds.length })}<br />
                      {t('chat:agentChat.unresolvedMembersHint', { settings: t('appSettings:title') })}
                    </p>
                  )}
                  <div className={styles.emptyAgentList}>
                    {currentAgents.map(a => (
                      <span key={a.id} className={styles.emptyAgentTag}>
                        {a.name}: {('role' in a ? a.role : '')}
                      </span>
                    ))}
                  </div>
                  <p className={styles.emptyMeta}>
                    {t('chat:agentChat.strategyMeta', {
                      strategy: getStrategyLabel(group.strategy),
                      maxRounds: group.maxRounds,
                    })}
                  </p>
                </div>
              )}

              <div className={styles.messageList}>
                {messages.map((message) => {
                  const isUser = message.sender.name === userName;
                  const a = getAvatarData(message.sender.name);
                  const url = isUser
                    ? resolveAvatarByName(
                        userName,
                        userStore.avatarDisplaySrc || userStore.userInfo?.avatar_url,
                        32,
                      )
                    : resolveAvatarByName(message.sender.name, message.sender.avatar, 32);
                  const isStreaming = !!message.isStreaming;

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
                      <div className={cx(styles.messageBody, isUser && styles.messageBodyUser)}>
                        <div className={styles.metaRow} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                          {message.sender.name}
                          {!isUser && (
                            <span className={styles.agentBadge}>{t('chat:agentChat.expertBadge')}</span>
                          )}
                        </div>
                        <div className={bubbleClass}>
                          <ChatMarkdown content={message.content} isUser={isUser} />
                          {isStreaming && (
                            <span className={cx('typing-indicator', styles.typingCursor)}>▋</span>
                          )}
                        </div>
                      </div>
                      {isUser && (
                        <LobeAvatar
                          avatar={url || a.text}
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
              <div className={styles.composeShell}>
                <MentionTextArea
                  value={inputMessage}
                  onChange={setInputMessage}
                  candidates={mentionCandidates}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    if (!e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  placeholder={t('chat:agentChat.inputPlaceholder')}
                  containerStyle={{ flex: 1, minWidth: 0 }}
                  disabled={isLoading}
                />
                {isLoading ? (
                  <AntdButton
                    className={styles.composeStopButton}
                    danger
                    onClick={handleAbort}
                    icon={<Square size={16} />}
                  >
                    {t('chat:agentChat.stop', { defaultValue: '停止' })}
                  </AntdButton>
                ) : (
                  <AntdButton
                    className={styles.composeSendButton}
                    onClick={handleSendMessage}
                    icon={<Send size={16} color={BRAND_ON_PRIMARY} />}
                    style={brandPrimaryButtonStyle}
                    styles={{
                      content: { color: BRAND_ON_PRIMARY },
                      icon: { color: BRAND_ON_PRIMARY },
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Agent Group Settings (Desktop Inline) */}
          {!isMobile && (
            <AgentGroupSettings
              inline
              open={showSettings}
              onOpenChange={handleToggleSettings}
              group={group}
              mutedUsers={mutedUsers}
              onToggleMute={handleToggleMute}
              onUpdateGroup={(updates) => onUpdateGroup?.(updates)}
              onDeleteGroup={() => onDeleteGroup?.(group)}
              canDeleteGroup={!isBuiltinGroupId(group.id)}
            />
          )}

        </div>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className={styles.mobileOverlay} onClick={toggleSidebar} />
      )}

      <AppSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        groups={groups}
        initialSection={settingsSection}
      />
    </>
  );
};

export default AgentChatUI;
