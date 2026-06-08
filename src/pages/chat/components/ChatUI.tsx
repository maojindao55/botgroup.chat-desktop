/**
 * ChatUI - 主入口分流组件
 * 根据群聊类型分流到对应的 UI 组件：
 * - ai → AIChatUI (本文件内实现，基于原有逻辑)
 * - cli → CLIChatUI (复用原有 CLI 逻辑)
 * - agent → AgentChatUI
 */
import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { Send, Settings2, ChevronLeft, Bot, Terminal, PanelLeftOpen } from "lucide-react";
import { Tooltip, Button as AntdButton, Modal } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { BRAND_ON_PRIMARY, brandPrimaryButtonStyle } from '@/lib/theme';
import { request } from '@/utils/request';
import { normalizeDesktopUser } from '@/utils/userAvatar';
import { executeCLIStrategy } from '@/engine/cliEngine';
import { decideCliPreflight } from '@/engine/cliPreflight';
import { isCodeChangeIntent } from '@/engine/cliIntent';
import { buildCliUserPrompt } from '@/engine/cliPrompt';
import { cliToolSessionKey, withCliToolSession } from '@/engine/cliToolSessions';
import type { AICharacter, CLIAgent } from "@/config/aiCharacters";
import { mapAIMemberToLegacy } from "@/config/aiCharacters";
import { ChatMarkdown } from '@/components/Markdown';
import AIGroupSettings from './AIGroupSettings';
import CLIGroupSettings from './CLIGroupSettings';
import AgentChatUI from './AgentChatUI';
import CLITaskUI from './CLITaskUI';
import HomeView from './HomeView';
import Sidebar from './Sidebar';
import { AdBanner, AdBannerMobile } from './AdSection';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppSettingsModal } from './AppSettingsModal';
import type { AppSettingsSection } from '@/config/appSettings';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { resolveEffectiveMember } from '@/utils/aiMemberDisplay';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import type { Group, AIGroup, CLIGroup, AgentGroup, CLIStrategy, CLIExecutionPlan, CLISessionPolicy } from '@/config/groups';
import { resolveExecutionPlan } from '@/config/groups';
import { supportsCliToolSession } from '@/config/cliAdapters';
import { openPath } from '@tauri-apps/plugin-opener';

import {
  persistCLITemplateOverride,
  prepareCLIGroups,
  markCLITemplateDeleted,
  removeCLITemplateLocalData,
  removeCLITemplateFromCustomGroups,
} from '@/config/cliTemplateStorage';
import {
  deleteChatGroup,
  isBuiltinGroupId,
  upsertCustomGroup,
} from '@/config/groupStorage';
import ConversationSidebar from './ConversationSidebar';
import { MentionTextArea } from './MentionAutocomplete';
import { useChatSessionStore } from '@/store/chatSessionStore';
import {
  newChatMessageId,
  truncateSessionTitle,
  type ChatSessionMessage,
} from '@/config/chatSessions';
import { generateSessionTitle } from '@/utils/sessionTitle';
import { readLastView, saveLastView, clearLastView } from '@/utils/lastViewStorage';
import { AppPageShell } from '@/components/AppPageShell';

const useStyles = createStyles(({ token, css }) => ({
  rightCol: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    position: relative;
  `,
  convSidebarExpandHandle: css`
    position: absolute;
    left: 0;
    top: 7px;
    z-index: 5;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 32px;
    padding: 0;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 0 8px 8px 0;
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    box-shadow: 1px 0 4px rgba(0, 0, 0, 0.06);
    transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
    &:hover {
      color: #ff6600;
      border-color: rgba(255, 102, 0, 0.35);
      background: rgba(255, 102, 0, 0.06);
    }
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
    flex-wrap: nowrap;
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
    overflow: hidden;
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
    flex: 0 0 auto;
    flex-shrink: 0;
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
  headerCwd: css`
    display: flex;
    align-items: center;
    gap: 6px;
    max-width: min(30vw, 360px);
    min-width: 0;
    flex: none;
  `,
  inputArea: css`
    background: ${token.colorBgContainer};
    border-top: 1px solid ${token.colorBorderSecondary};
    padding: 10px 14px 14px;
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
    min-width: 0;
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
      max-width: calc(100% - 44px);
    }
  `,
  messageBodyUser: css`
    text-align: right;
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
  typingCursor: css`
    margin-left: 4px;
    color: #ff6600;
  `,
  cliTaskFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed ${token.colorBorderSecondary};
    font-size: 12px;
    gap: 16px;
  `,
  cliTaskStatus: css`
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  `,
  cliTaskActions: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  cliActionBtnCancel: css`
    padding: 2px 10px;
    background: ${token.colorErrorBg};
    color: ${token.colorError};
    border: 1px solid ${token.colorErrorBorder};
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s;
    &:hover {
      background: ${token.colorError};
      color: #fff;
    }
  `,
  cliActionBtnRetry: css`
    padding: 2px 10px;
    background: ${token.colorInfoBg};
    color: ${token.colorInfo};
    border: 1px solid ${token.colorInfoBorder};
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.2s;
    &:hover {
      background: ${token.colorInfo};
      color: #fff;
    }
  `,
  cliWorktreeInfo: css`
    margin-top: 6px;
    padding: 6px 10px;
    background: ${token.colorFillTertiary};
    border-radius: 4px;
    font-size: 11px;
    color: ${token.colorTextSecondary};
    display: flex;
    flex-direction: column;
    gap: 2px;
    word-break: break-all;
  `,
  cliWorktreePath: css`
    font-family: var(--ant-font-family-code);
    font-size: 11px;
    color: ${token.colorTextSecondary};
    word-break: break-all;
  `,
  cliWorktreeCopyBtn: css`
    margin-left: 6px;
    padding: 0 6px;
    height: 18px;
    line-height: 18px;
    font-size: 10px;
    background: transparent;
    color: ${token.colorPrimary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
    &:hover {
      background: ${token.colorFillSecondary};
    }
  `,
  spinnerIcon: css`
    display: inline-block;
    flex-shrink: 0;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid ${token.colorInfo};
    border-top-color: transparent;
    vertical-align: middle;
    animation: cli-spin 1s linear infinite;
    @keyframes cli-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
}));

const ChatUI = () => {
  const userStore = useUserStore();
  const isMobile = useIsMobile();
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['chat', 'common', 'settings']);

  const urlParams = new URLSearchParams(window.location.search);
  const id = urlParams.get('id') ? parseInt(urlParams.get('id')!) : 0;
  const taskIdParam = urlParams.get('taskId');
  const convParam = urlParams.get('conv');
  // view 作为响应式状态：支持「群聊 ↔ 开发任务」的客户端切换，避免整页重载导致白屏闪烁
  const [viewParam, setViewParam] = useState<string | null>(() => urlParams.get('view'));
  const isCLIView = viewParam === 'cli-tasks' || viewParam === 'cli-task' || viewParam === 'cli-template';
  const isHomeView = viewParam === 'home';
  // 裸启动（无任何视图参数）：用于冷启动时恢复上次视图或落地首页
  const hasNoParams = !urlParams.get('id') && !viewParam && !taskIdParam;

  // State
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<AppSettingsSection>('general');
  const { load: loadAIMembers } = useAIMemberStore();
  const aiMembers = useAIMemberStore(state => state.members);

  useEffect(() => {
    loadAIMembers();
  }, []);
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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [convSidebarOpen, setConvSidebarOpen] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(convParam);
  // 会话 store（仅角色群使用）
  const chatSessions = useChatSessionStore(state => state.sessions);
  const createChatSessionInStore = useChatSessionStore(state => state.createSession);
  const replaceSessionMessages = useChatSessionStore(state => state.replaceMessages);
  const renameChatSession = useChatSessionStore(state => state.renameSession);
  const setChatSessionAutoTitle = useChatSessionStore(state => state.setAutoTitle);
  const deleteChatSession = useChatSessionStore(state => state.deleteSession);
  const deleteChatSessionsByGroup = useChatSessionStore(state => state.deleteSessionsByGroup);
  const toggleChatSessionPinned = useChatSessionStore(state => state.togglePinned);
  const toggleChatSessionArchived = useChatSessionStore(state => state.toggleArchived);
  const [workspacePath, setWorkspacePath] = useState("");
  const [approvalMode, setApprovalMode] = useState<'auto' | 'ask'>('auto');
  const [cliTimeout, setCliTimeout] = useState(300000);
  const [cliShowStderr, setCliShowStderr] = useState(true);
  const [cliStrategy, setCliStrategy] = useState<CLIStrategy>('sequential');
  const [cliExecutionPlan, setCliExecutionPlan] = useState<Partial<CLIExecutionPlan>>({});
  const [cliSessionPolicy, setCliSessionPolicy] = useState<CLISessionPolicy>('task');

  // Refs
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const isInitialized = useRef(false);
  /** 正在生成标题的会话 id，避免重复请求 */
  const titleGenRef = useRef<Set<string>>(new Set());
  /** 懒创建会话后跳过一次「加载历史」，避免覆盖刚输入的消息 */
  const suppressLoadRef = useRef(false);
  /** 用户刚点击「新建会话」，跳过一次自动选中最近会话 */
  const userStartedNewRef = useRef(false);

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

  const settingsPanelWidth = group?.type === 'agent' ? 440 : 400;
  const mentionCandidates = useMemo(
    () => groupAiCharacters.map(character => ({
      id: character.id,
      name: character.name,
      avatar: character.avatar,
    })),
    [groupAiCharacters],
  );

  const openAppSettings = (section: AppSettingsSection = 'general') => {
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const handleToggleSettings = (nextOpen: boolean) => {
    if (nextOpen === showSettings) return;
    setShowSettings(nextOpen);
    adjustWindowWidthForPanel(nextOpen ? settingsPanelWidth : -settingsPanelWidth);
  };

  useEffect(() => {
    if (isMobile !== undefined) {
      setSidebarOpen(!isMobile);
      setConvSidebarOpen(!isMobile);
    }
  }, [isMobile]);

  // Reactively compute members/users whenever group, aiMembers store, or user info updates
  useEffect(() => {
    if (!group) return;

    const memberIds = group.memberIds || (group as AIGroup | CLIGroup).members || [];
    const nickname = userStore.userInfo?.nickname || t('settings:aiGroup.selfName');
    const avatar_url = userStore.userInfo?.avatar_url || null;
    const avatarDisplaySrc = userStore.avatarDisplaySrc;
    const currentUser = { id: 1, name: nickname, avatar: avatarDisplaySrc || avatar_url };

    if (group.type === 'ai' || !group.type) {
      const resolvedMembers = memberIds
        .map(mid => resolveEffectiveMember(aiMembers, mid))
        .filter(m => m && m.enabled !== false && !(m.kind === 'llm' && m.schedulerTag === 'scheduler'));
      const resolvedCharacters = resolvedMembers.map(m => mapAIMemberToLegacy(m, group.name) as AICharacter);

      setGroupAiCharacters(resolvedCharacters);
      setAllNames([...resolvedCharacters.map(c => c.name), 'user']);
      setUsers([currentUser, ...resolvedCharacters]);
    } else if (group.type === 'cli') {
      const resolvedMembers = memberIds
        .map(mid => resolveEffectiveMember(aiMembers, mid))
        .filter(m => m && m.enabled !== false);
      const resolvedCLIAgents = resolvedMembers.map(m => mapAIMemberToLegacy(m) as CLIAgent);

      setGroupAiCharacters(resolvedCLIAgents as any);
      setAllNames([...resolvedCLIAgents.map(a => a.name), 'user']);
      setUsers([currentUser, ...resolvedCLIAgents]);
    }
  }, [group, aiMembers, userStore.userInfo, userStore.avatarDisplaySrc, t]);

  // Init data
  useEffect(() => {
    if (isInitialized.current) return;

    const initData = async () => {
      // 裸启动：恢复上次视图，没有记录则落地首页（避免直接进入开发任务）
      if (hasNoParams) {
        const last = readLastView();
        window.location.replace(last || '?view=home');
        return;
      }

      try {
        const response = await request(`/api/init`);
        if (!response.ok) throw new Error(t('chat:init.initDataFailed'));
        const { data } = await response.json();

        const resolvedGroups = prepareCLIGroups(data.groups);
        const currentGroup = resolvedGroups[selectedGroupIndex];

        // 旧链接指向 CLI 群时，重定向到任务优先视图（首页除外）
        if (currentGroup?.type === 'cli' && !isCLIView && !isHomeView) {
          window.location.replace('?view=cli-tasks');
          return;
        }

        if (!currentGroup && !isCLIView && !isHomeView) {
          clearLastView();
          setInitError(t('chat:init.groupNotFound'));
          setIsInitializing(false);
          return;
        }

        setGroups(resolvedGroups);

        // 首页视图：仅加载用户信息，不绑定具体群
        if (isHomeView) {
          setIsInitializing(false);
          if (data.user) {
            const r = await request('/api/user/info');
            const userInfo = await r.json();
            userStore.setUserInfo(normalizeDesktopUser(userInfo.data));
          } else {
            userStore.setUserInfo({ id: 0, phone: '', nickname: t('settings:aiGroup.selfName'), avatar_url: null, status: 0 });
          }
          return;
        }

        if (isCLIView) {
          setIsInitializing(false);
          if (data.user) {
            const r = await request('/api/user/info');
            const userInfo = await r.json();
            userStore.setUserInfo(normalizeDesktopUser(userInfo.data));
          } else {
            userStore.setUserInfo({ id: 0, phone: '', nickname: t('settings:aiGroup.selfName'), avatar_url: null, status: 0 });
          }
          return;
        }

        setGroup(currentGroup);
        setIsInitializing(false);

        if (urlParams.get('settings') === '1') {
          setShowSettings(true);
          const url = new URL(window.location.href);
          url.searchParams.delete('settings');
          window.history.replaceState({}, '', `${url.pathname}${url.search}`);
        }

        // AI/CLI group: resolve details
        if (currentGroup.type === 'ai' || !currentGroup.type) {
          setIsGroupDiscussionMode(currentGroup.isGroupDiscussionMode || false);
          setSchedulerStrategy(currentGroup.schedulerStrategy || 'tag');

          if (data.user) {
            const r = await request('/api/user/info');
            const userInfo = await r.json();
            userStore.setUserInfo(normalizeDesktopUser(userInfo.data));
          } else {
            userStore.setUserInfo({ id: 0, phone: '', nickname: t('settings:aiGroup.selfName'), avatar_url: null, status: 0 });
          }
        } else if (currentGroup.type === 'cli') {
          const wsOverride = localStorage.getItem(`workspace:${currentGroup.id}`);
          setWorkspacePath(wsOverride || currentGroup.workspacePath || '');
          setApprovalMode(currentGroup.approvalMode || 'auto');
          setCliTimeout(currentGroup.timeout || 300000);
          setCliShowStderr(currentGroup.showStderr !== false);
          setCliSessionPolicy(currentGroup.sessionPolicy || 'task');
          const strategyOverride = localStorage.getItem(`cliStrategy:${currentGroup.id}`) as CLIStrategy | null;
          setCliStrategy(strategyOverride || currentGroup.strategy || 'sequential');
          try {
            const storedPlan = localStorage.getItem(`cliExecutionPlan:${currentGroup.id}`);
            setCliExecutionPlan(storedPlan ? JSON.parse(storedPlan) : (currentGroup.executionPlan || {}));
          } catch {
            setCliExecutionPlan(currentGroup.executionPlan || {});
          }

          if (data.user) {
            const r = await request('/api/user/info');
            const userInfo = await r.json();
            userStore.setUserInfo(normalizeDesktopUser(userInfo.data));
          } else {
            userStore.setUserInfo({ id: 0, phone: '', nickname: t('settings:aiGroup.selfName'), avatar_url: null, status: 0 });
          }
        }
      } catch (error) {
        console.error("初始化数据失败:", error);
        setInitError(t('chat:init.loadFailed'));
        setIsInitializing(false);
      }
    };

    initData();
    isInitialized.current = true;
  }, [userStore, selectedGroupIndex, isCLIView, isHomeView]);

  // 记住当前视图，供下次冷启动恢复（Option C）。
  // viewParam/selectedGroupIndex 变化覆盖客户端切换；URL 已由各导航 pushState/replaceState 先行更新。
  useEffect(() => {
    if (isInitializing || initError) return;
    saveLastView(window.location.search);
  }, [isInitializing, initError, viewParam, selectedGroupIndex]);

  // 客户端切换群聊时解析当前群 + 派生状态（不重载页面）。
  // 初始加载由 initData 设定首个群；这里用 id 比对，命中即跳过，避免重复处理。
  useEffect(() => {
    if (isInitializing) return;
    if (isCLIView) return;
    if (isHomeView) return;
    if (!groups.length) return;
    const current = groups[selectedGroupIndex];
    if (!current) return;
    if (group && group.id === current.id) return;
    if (current.type === 'cli') {
      // 角色群侧栏已隐藏 CLI 群；万一选中则转任务视图（客户端）
      window.history.replaceState({}, '', '?view=cli-tasks');
      setViewParam('cli-tasks');
      return;
    }
    setShowSettings(false);
    setMessages([]);
    setActiveSessionId(null);
    setGroup(current);
    if (current.type === 'ai' || !current.type) {
      const aiGroup = current as AIGroup;
      setIsGroupDiscussionMode(aiGroup.isGroupDiscussionMode || false);
      setSchedulerStrategy(aiGroup.schedulerStrategy || 'tag');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedGroupIndex, isCLIView, isInitializing, group]);


  // ============ 会话（角色群）逻辑 ============
  const isAIGroup = !!group && (group.type === 'ai' || !group.type);
  const groupSessions = group ? chatSessions.filter(s => s.groupId === group.id) : [];

  const updateConvParam = (sessionId: string | null) => {
    const url = new URL(window.location.href);
    if (sessionId) url.searchParams.set('conv', sessionId);
    else url.searchParams.delete('conv');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  /** 存储消息 → 渲染消息（角色群消息形状一致，浅拷贝即可） */
  const storedToLocalMessages = (msgs: ChatSessionMessage[]) => msgs.map(m => ({ ...m }));

  /** 渲染消息 → 存储消息（仅保留需要持久化的字段；不存 avatar，渲染时按名称解析） */
  const localToStoredMessages = (msgs: any[]): ChatSessionMessage[] =>
    msgs.map(m => ({
      id: m.id,
      sender: { id: m.sender?.id, name: m.sender?.name },
      content: m.content || '',
      isAI: !!m.isAI,
      isError: !!m.isError,
    }));

  // 选中会话变化（来自 URL 或自动/手动选中）→ 加载历史消息
  useEffect(() => {
    if (!isAIGroup || !group) return;
    if (!activeSessionId) return;
    if (suppressLoadRef.current) { suppressLoadRef.current = false; return; }
    const session = chatSessions.find(s => s.id === activeSessionId);
    if (session && session.groupId === group.id) {
      setMessages(storedToLocalMessages(session.messages));
    } else {
      setMessages([]);
      setActiveSessionId(null);
      updateConvParam(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, group?.id, isAIGroup]);

  // 进入角色群且 URL 未指定会话 → 自动选中最近一条（非归档）
  useEffect(() => {
    if (!isAIGroup || !group) return;
    if (activeSessionId) return;
    if (userStartedNewRef.current) {
      userStartedNewRef.current = false;
      return;
    }
    const candidates = chatSessions
      .filter(s => s.groupId === group.id && !s.archived)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (candidates.length > 0) {
      setActiveSessionId(candidates[0].id);
      updateConvParam(candidates[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, isAIGroup]);

  // 安全点持久化 + 首轮总结标题（仅在空闲时落盘，避免逐 token 写入）
  useEffect(() => {
    if (!isAIGroup || !group) return;
    if (!activeSessionId) return;
    if (isLoading) return;
    if (messages.length === 0) return;

    replaceSessionMessages(activeSessionId, localToStoredMessages(messages));

    const session = useChatSessionStore.getState().getSession(activeSessionId);
    if (
      session &&
      session.titleSource !== 'manual' &&
      !session.titleGenerated &&
      !titleGenRef.current.has(session.id)
    ) {
      const userMsg = messages.find((m: any) => !m.isAI && (m.content || '').trim());
      const aiMsg = messages.find((m: any) => m.isAI && !m.isError && (m.content || '').trim());
      const titleChar: any = groupAiCharacters[0];
      if (userMsg && aiMsg && titleChar?.model) {
        const sid = session.id;
        titleGenRef.current.add(sid);
        generateSessionTitle({
          userMessage: userMsg.content,
          aiMessage: aiMsg.content,
          model: titleChar.model,
          providerId: titleChar.providerId,
        })
          .then(title => { if (title) setChatSessionAutoTitle(sid, title); })
          .finally(() => { titleGenRef.current.delete(sid); });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading, activeSessionId, isAIGroup]);

  /** 确保存在活跃会话（懒创建）；返回会话 id */
  const ensureActiveSession = (firstText: string): string | null => {
    if (!group || !isAIGroup) return null;
    if (activeSessionId && chatSessions.some(s => s.id === activeSessionId)) {
      return activeSessionId;
    }
    const fallbackTitle = truncateSessionTitle(firstText, undefined, t('chat:conversation.untitled'));
    const session = createChatSessionInStore(group.id, {
      fallbackTitle,
      settingsSnapshot: { isGroupDiscussionMode, schedulerStrategy },
    });
    suppressLoadRef.current = true;
    setActiveSessionId(session.id);
    updateConvParam(session.id);
    return session.id;
  };

  const startNewConversation = () => {
    userStartedNewRef.current = true;
    setMessages([]);
    setActiveSessionId(null);
    updateConvParam(null);
    setShowAd(false);
    if (isMobile) setConvSidebarOpen(false);
  };

  const handleSelectSession = (sessionId: string) => {
    if (sessionId === activeSessionId) {
      if (isMobile) setConvSidebarOpen(false);
      return;
    }
    setActiveSessionId(sessionId);
    updateConvParam(sessionId);
    if (isMobile) setConvSidebarOpen(false);
  };

  const handleDeleteSession = (sessionId: string) => {
    const target = chatSessions.find(s => s.id === sessionId);
    Modal.confirm({
      title: t('chat:conversation.deleteConfirmTitle', { name: target?.title || '' }),
      content: t('chat:conversation.deleteConfirmContent'),
      okText: t('common:actions.delete'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
      onOk: () => {
        deleteChatSession(sessionId);
        if (sessionId === activeSessionId) {
          const remaining = chatSessions
            .filter(s => s.id !== sessionId && s.groupId === group?.id && !s.archived)
            .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
          if (remaining.length > 0) {
            setActiveSessionId(remaining[0].id);
            updateConvParam(remaining[0].id);
          } else {
            startNewConversation();
          }
        }
      },
    });
  };

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
  }, [activeSessionId, group?.id]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollMessagesToBottom('smooth');
    }
  }, [messages]);
  useEffect(() => { if (messages.length > 0) setShowAd(false); }, [messages]);

  // 同步浏览器前进/后退：保持 view / 选中群 与 URL 一致（配合客户端视图与群切换）
  useEffect(() => {
    const onPopState = () => {
      const p = new URLSearchParams(window.location.search);
      setViewParam(p.get('view'));
      setSelectedGroupIndex(p.get('id') ? parseInt(p.get('id')!) : 0);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const handleToggleMute = (userId: string) => {
    setMutedUsers(prev => prev.includes(userId) ? prev.filter(id => id !== userId) : [...prev, userId]);
  };
  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);
  /** 客户端切换群聊：不重载页面，避免白屏闪烁。group 解析由下方 resolve effect 处理 */
  const goToGroup = (index: number) => {
    if (index === selectedGroupIndex && !isCLIView && !isHomeView) return;
    window.history.pushState({}, '', `?id=${index}`);
    setShowSettings(false);
    setSettingsOpen(false);
    setViewParam(null);
    setSelectedGroupIndex(index);
  };
  const handleSelectGroup = (index: number) => goToGroup(index);
  const handleNavigateCLI = () => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'cli-tasks' && !params.get('taskId')) return;
    if (view === 'cli-task' || view === 'cli-template') {
      window.history.pushState({}, '', '?view=cli-tasks');
      setShowSettings(false);
      setSettingsOpen(false);
      setViewParam('cli-tasks');
      return;
    }
    if (isCLIView) return;
    window.history.pushState({}, '', '?view=cli-tasks');
    setShowSettings(false);
    setSettingsOpen(false);
    setViewParam('cli-tasks');
  };
  /** 客户端切换到首页：不重载页面 */
  const handleNavigateHome = () => {
    if (isHomeView) return;
    window.history.pushState({}, '', '?view=home');
    setShowSettings(false);
    setSettingsOpen(false);
    setViewParam('home');
  };

  /** 打开指定开发任务（从首页进入）：整页跳转，确保 CLITaskUI 读取到 taskId */
  const handleSelectTask = (taskId: string) => {
    window.location.href = `?view=cli-task&taskId=${encodeURIComponent(taskId)}`;
  };

  const handleDeleteCLIGroup = (templateId: string) => {
    markCLITemplateDeleted(templateId);
    removeCLITemplateLocalData(templateId);
    removeCLITemplateFromCustomGroups(templateId);
    setGroups(prev => prev.filter(g => g.id !== templateId));
  };

  const handleUpdateCLIGroup = (updatedGroup: CLIGroup) => {
    setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
    persistCLITemplateOverride(updatedGroup);
    try {
      const stored = localStorage.getItem('custom_groups');
      if (stored) {
        const customGroups = JSON.parse(stored) as Group[];
        const nextCustom = customGroups.map(g => g.id === updatedGroup.id ? updatedGroup : g);
        localStorage.setItem('custom_groups', JSON.stringify(nextCustom));
      }
    } catch (e) {
      console.error('Failed to update CLI template:', e);
    }
  };

  const handleCliSessionPolicyChange = (policy: CLISessionPolicy) => {
    setCliSessionPolicy(policy);
    if (group?.type === 'cli') {
      handleUpdateCLIGroup({ ...(group as CLIGroup), sessionPolicy: policy });
    }
  };

  const updateGroup = (updatedGroup: Group) => {
    setGroup(updatedGroup);
    setGroups(prev => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
    upsertCustomGroup(updatedGroup);
  };

  const handleMembersChange = (newIds: string[]) => {
    if (!group) return;
    const nextGroup = { ...group, memberIds: newIds } as Group;
    updateGroup(nextGroup);
  };

  const handleUpdateGroup = (updates: Partial<Group>) => {
    if (!group) return;
    const nextGroup = { ...group, ...updates } as Group;
    updateGroup(nextGroup);
  };

  const navigateToGroupIndex = (index: number, options?: { openSettings?: boolean }) => {
    const url = new URL(window.location.href);
    url.searchParams.set('id', String(index));
    url.searchParams.delete('view');
    url.searchParams.delete('taskId');
    if (options?.openSettings) {
      url.searchParams.set('settings', '1');
    } else {
      url.searchParams.delete('settings');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    setViewParam(null);
    setSelectedGroupIndex(index);
  };

  const handleEditGroup = (index: number) => {
    if (index !== selectedGroupIndex) {
      window.location.href = `?id=${index}&settings=1`;
      return;
    }
    handleToggleSettings(true);
  };

  const confirmDeleteGroup = (targetGroup: Group) => {
    Modal.confirm({
      title: t('common:deleteGroup.confirmTitle', { name: targetGroup.name }),
      content: t('common:deleteGroup.warning'),
      okText: t('common:actions.delete'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
      onOk: () => {
        deleteChatGroup(targetGroup.id);
        deleteChatSessionsByGroup(targetGroup.id);
        const deletedIndex = groups.findIndex((g) => g.id === targetGroup.id);
        const remaining = groups.filter((g) => g.id !== targetGroup.id);
        setGroups(remaining);

        if (group?.id === targetGroup.id) {
          setShowSettings(false);
          setMessages([]);
          if (remaining.length > 0) {
            const nextIndex = Math.min(deletedIndex, remaining.length - 1);
            setGroup(remaining[nextIndex]);
            navigateToGroupIndex(nextIndex);
          } else {
            setGroup(null);
            window.history.replaceState({}, '', window.location.pathname);
          }
          return;
        }

        if (deletedIndex >= 0 && deletedIndex < selectedGroupIndex) {
          navigateToGroupIndex(selectedGroupIndex - 1);
        }
      },
    });
  };

  const handleDeleteGroup = (targetGroup: Group) => {
    confirmDeleteGroup(targetGroup);
  };

  const handleCreateGroup = (newGroup: Group) => {
    try {
      const stored = localStorage.getItem('custom_groups');
      const customGroups = stored ? JSON.parse(stored) : [];
      customGroups.push(newGroup);
      localStorage.setItem('custom_groups', JSON.stringify(customGroups));
    } catch (e) {
      console.error('Failed to save custom group:', e);
    }

    // 追加到末尾，新群索引即当前长度（在 append 前读取，保证可靠）
    const newIndex = groups.length;
    setGroups((prev) => [...prev, newGroup]);
    setSelectedGroupIndex(newIndex);

    if (newGroup.type === 'cli') {
      if (!isCLIView) {
        window.history.pushState({}, '', '?view=cli-tasks');
        setViewParam('cli-tasks');
      }
      return;
    }

    setViewParam(null);
    setGroup(newGroup);
    if (newGroup.type === 'ai' || !newGroup.type) {
      const aiGroup = newGroup as AIGroup;
      setIsGroupDiscussionMode(aiGroup.isGroupDiscussionMode || false);
      setSchedulerStrategy(aiGroup.schedulerStrategy || 'tag');
    }
    setShowSettings(false);
    setSettingsOpen(false);

    const url = new URL(window.location.href);
    url.searchParams.set('id', String(newIndex));
    url.searchParams.delete('view');
    url.searchParams.delete('taskId');
    window.history.replaceState({}, '', `${url.pathname}${url.search}`);
  };

  const patchCurrentCLIGroup = (patch: Partial<CLIGroup>) => {
    if (!group || group.type !== 'cli') return;
    const nextGroup = { ...(group as CLIGroup), ...patch };
    setGroup(nextGroup);
    setGroups(prev => prev.map(g => g.id === nextGroup.id ? nextGroup : g));
    if (patch.strategy) {
      localStorage.setItem(`cliStrategy:${nextGroup.id}`, patch.strategy);
    }
    if (patch.executionPlan) {
      if (Object.keys(patch.executionPlan).length > 0) {
        localStorage.setItem(`cliExecutionPlan:${nextGroup.id}`, JSON.stringify(patch.executionPlan));
      } else {
        localStorage.removeItem(`cliExecutionPlan:${nextGroup.id}`);
      }
    }
  };

  const handleCLIStrategyChange = (nextStrategy: CLIStrategy) => {
    setCliStrategy(nextStrategy);
    patchCurrentCLIGroup({ strategy: nextStrategy });
  };

  const handleCLIExecutionPlanChange = (
    patch: Partial<CLIExecutionPlan>,
    options?: { replace?: boolean },
  ) => {
    const nextPlan = options?.replace ? patch : { ...cliExecutionPlan, ...patch };
    setCliExecutionPlan(nextPlan);
    patchCurrentCLIGroup({ executionPlan: nextPlan });
  };

  // Loading / Error states
  if (initError) {
    return (
      <div className={styles.loadingPage}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <p style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{initError}</p>
          <button
            onClick={() => { window.location.href = '?view=home'; }}
            style={{
              padding: '8px 24px',
              background: '#ff6600',
              color: '#fff',
              borderRadius: 8,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {t('chat:actions.backHome')}
          </button>
        </div>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className={styles.loadingPage}>
        <div className={styles.spinner} />
      </div>
    );
  }

  const cliGroups = groups.filter((g): g is CLIGroup => g.type === 'cli');

  // 首页视图
  if (isHomeView) {
    return (
      <HomeView
        groups={groups}
        sidebarOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
        onSelectGroup={handleSelectGroup}
        onCreateGroup={handleCreateGroup}
        onNavigateCLI={handleNavigateCLI}
        onSelectTask={handleSelectTask}
      />
    );
  }

  // CLI 开发任务视图
  if (isCLIView) {
    return (
      <CLITaskUI
        groups={groups}
        cliGroups={cliGroups}
        selectedGroupIndex={selectedGroupIndex}
        onSelectGroup={handleSelectGroup}
        onCreateGroup={handleCreateGroup}
        onUpdateCLIGroup={handleUpdateCLIGroup}
        onDeleteCLIGroup={handleDeleteCLIGroup}
        onNavigateHome={handleNavigateHome}
        initialTaskId={taskIdParam}
      />
    );
  }

  if (!group) {
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
        onUpdateGroup={handleUpdateGroup}
        onEditGroup={handleEditGroup}
        onDeleteGroup={handleDeleteGroup}
      />
    );
  }

  const handleCancelTask = async (taskId: string) => {
    try {
      await request('/api/cli/tasks/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      setMessages(prev => prev.map(msg =>
        msg.taskId === taskId ? { ...msg, status: 'cancelled' } : msg
      ));
    } catch (e) {
      console.error('Failed to cancel task:', e);
    }
  };

  const handleRetryTask = async (msg: any) => {
    if (isLoading) return;
    if (!msg.prompt) return;

    setIsLoading(true);
    try {
      const m = resolveEffectiveMember(aiMembers, msg.sender.id);
      const baseAgent = m && m.kind === 'cli' ? mapAIMemberToLegacy(m) as CLIAgent : undefined;
      const agent = baseAgent
        ? withCliToolSession(
          baseAgent,
          localStorage.getItem(cliToolSessionKey((group as CLIGroup).id, baseAgent.id, workspacePath)),
        )
        : undefined;
      if (!agent) throw new Error(t('chat:errors.memberNotFound'));

      // 发送前 pre-flight：单成员重试，未安装则直接拦截并给出安装引导
      const preflight = await decideCliPreflight([agent], { interchangeable: false });
      if (preflight.action === 'block') {
        const sysMsg = {
          id: `sys-${Date.now()}`,
          sender: { id: 'sys', name: t('chat:systemSender') },
          content: preflight.message,
          isAI: true,
          isError: true,
        };
        setMessages(prev => [...prev, sysMsg]);
        return;
      }

      if (approvalMode === 'ask') {
        const confirmed = window.confirm(t('chat:confirmExecuteSingle', {
          name: agent.name,
          path: workspacePath || t('chat:defaultWorkspace'),
        }));
        if (!confirmed) return;
      }

      const tempGroup: CLIGroup = {
        ...(group as CLIGroup),
        strategy: 'sequential',
        approvalMode,
        timeout: cliTimeout,
        showStderr: cliShowStderr,
        executionPlan: cliExecutionPlan,
      };

      await executeCLIStrategy(
        tempGroup,
        [agent],
        msg.prompt,
        workspacePath,
        {
          onAgentStart: (taskId, agentId, agentName, meta) => {
            const agentInfoMember = resolveEffectiveMember(aiMembers, agentId);
            const agentInfo = agentInfoMember && agentInfoMember.kind === 'cli' ? mapAIMemberToLegacy(agentInfoMember) as CLIAgent : undefined;
            const baseName = agentInfo?.name || agentName;
            const aiMessage = {
              id: taskId,
              sender: { id: agentId, name: meta?.stageLabel ? `${baseName} · ${meta.stageLabel}` : baseName, avatar: agentInfo?.avatar },
              content: "",
              isAI: true,
              taskId: taskId,
              status: 'running',
              prompt: msg.prompt,
              stageLabel: meta?.stageLabel,
              cliCwd: meta?.cwd,
              cliBranch: meta?.branch,
              baseSha: meta?.baseSha,
            };
            setMessages(prev => [...prev, aiMessage]);
          },
          onToolSession: (_taskId, agentId, adapter, sessionId) => {
            if (supportsCliToolSession(adapter)) {
              localStorage.setItem(cliToolSessionKey((group as CLIGroup).id, agentId, workspacePath), sessionId);
            }
          },
          onToken: (taskId, token) => {
            setMessages(prev => prev.map(m =>
              m.taskId === taskId ? { ...m, content: m.content + token } : m
            ));
          },
          onAgentEnd: (taskId, fullContent) => {
            setMessages(prev => prev.map(m => {
              if (m.taskId === taskId) {
                let finalContent = fullContent;
                if (finalContent.includes('<details open>')) {
                  finalContent = finalContent.replace(/<details open>/g, '<details>');
                }
                return { ...m, content: finalContent, status: 'completed' };
              }
              return m;
            }));
          },
          onError: (taskId, error) => {
            setMessages(prev => prev.map(m => {
              if (m.taskId === taskId) {
                const normalized = String(error || '').toLowerCase();
                const status = normalized.includes('timeout')
                  ? 'timeout'
                  : normalized.includes('cancel')
                    ? 'cancelled'
                    : 'failed';
                return {
                  ...m,
                  content: m.content
                    ? m.content + `\n\n${t('chat:errors.appendError', { error })}`
                    : t('chat:errors.appendError', { error }),
                  status,
                  isError: true,
                };
              }
              return m;
            }));
          },
        },
        {
          timeoutMs: cliTimeout,
          approvalMode,
          showStderr: cliShowStderr,
        }
      );
    } catch (e: any) {
      console.error('Failed to retry task:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendCLIMessage = async (promptText: string) => {
    const taskPrompt = buildCliUserPrompt(promptText, workspacePath);

    const memberIds = (group as CLIGroup).memberIds || (group as CLIGroup).members || [];
    let activeAgents = memberIds
      .map(id => resolveEffectiveMember(aiMembers, id))
      .filter(m => m && m.kind === 'cli' && !mutedUsers.includes(m.id))
      .map(m => mapAIMemberToLegacy(m) as CLIAgent)
      .map(agent => withCliToolSession(
        agent,
        localStorage.getItem(cliToolSessionKey((group as CLIGroup).id, agent.id, workspacePath)),
      ));

    if (activeAgents.length === 0) {
      const systemMsg = {
        id: `sys-${Date.now()}`,
        sender: { id: 'sys', name: t('chat:systemSender') },
        content: t('chat:messages.noEnabledCliMembers'),
        isAI: true,
        isError: true,
      };
      setMessages(prev => [...prev, systemMsg]);
      setIsLoading(false);
      return;
    }

    if (cliStrategy === 'discussion' && isCodeChangeIntent(promptText)) {
      const systemMsg = {
        id: `sys-${Date.now()}`,
        sender: { id: 'sys', name: t('chat:systemSender') },
        content: t('chat:messages.readOnlyDiscussionHint'),
        isAI: true,
        isError: true,
      };
      setMessages(prev => [...prev, systemMsg]);
      setIsLoading(false);
      return;
    }

    // 发送前 pre-flight：本地未安装对应 CLI 时的处理
    // - 独立模式（router/race/sequential/mapreduce）：自动跳过未安装成员，用其余成员继续
    // - 角色型（pipeline/review/discussion）：任一缺失则整单拦截
    const interchangeable =
      resolveExecutionPlan({ strategy: cliStrategy, executionPlan: cliExecutionPlan })
        .collaboration === 'independent';
    const preflight = await decideCliPreflight(activeAgents, { interchangeable });
    if (preflight.message) {
      const sysMsg = {
        id: `sys-${Date.now()}`,
        sender: { id: 'sys', name: t('chat:systemSender') },
        content: preflight.message,
        isAI: true,
        isError: preflight.isError,
      };
      setMessages(prev => [...prev, sysMsg]);
    }
    if (preflight.action === 'block') {
      setIsLoading(false);
      return;
    }
    activeAgents = preflight.agents;

    if (approvalMode === 'ask') {
      const names = activeAgents.map(a => a.name).join('、');
      const confirmed = window.confirm(t('chat:confirmExecute', {
        names,
        path: workspacePath || t('chat:defaultWorkspace'),
      }));
      if (!confirmed) {
        setIsLoading(false);
        return;
      }
    }

    try {
      const customGroup: CLIGroup = {
        ...(group as CLIGroup),
        strategy: cliStrategy,
        timeout: cliTimeout,
        approvalMode,
        showStderr: cliShowStderr,
        executionPlan: cliExecutionPlan,
      };

      await executeCLIStrategy(
        customGroup,
        activeAgents,
        taskPrompt,
        workspacePath,
        {
          onAgentStart: (taskId, agentId, agentName, meta) => {
            const agentInfoMember = resolveEffectiveMember(aiMembers, agentId);
            const agentInfo = agentInfoMember && agentInfoMember.kind === 'cli' ? mapAIMemberToLegacy(agentInfoMember) as CLIAgent : undefined;
            const baseName = agentInfo?.name || agentName;
            const aiMessage = {
              id: taskId,
              sender: { id: agentId, name: meta?.stageLabel ? `${baseName} · ${meta.stageLabel}` : baseName, avatar: agentInfo?.avatar },
              content: "",
              isAI: true,
              taskId: taskId,
              status: 'running',
              prompt: taskPrompt,
              stageLabel: meta?.stageLabel,
              cliCwd: meta?.cwd,
              cliBranch: meta?.branch,
              baseSha: meta?.baseSha,
            };
            setMessages(prev => [...prev, aiMessage]);
          },
          onToolSession: (_taskId, agentId, adapter, sessionId) => {
            if (supportsCliToolSession(adapter)) {
              localStorage.setItem(cliToolSessionKey((group as CLIGroup).id, agentId, workspacePath), sessionId);
            }
          },
          onToken: (taskId, token) => {
            setMessages(prev => prev.map(m =>
              m.taskId === taskId ? { ...m, content: m.content + token } : m
            ));
          },
          onAgentEnd: (taskId, fullContent) => {
            setMessages(prev => prev.map(m => {
              if (m.taskId === taskId) {
                let finalContent = fullContent;
                if (finalContent.includes('<details open>')) {
                  finalContent = finalContent.replace(/<details open>/g, '<details>');
                }
                return { ...m, content: finalContent, status: 'completed' };
              }
              return m;
            }));
          },
          onError: (taskId, error) => {
            setMessages(prev => prev.map(m => {
              if (m.taskId === taskId) {
                const normalized = String(error || '').toLowerCase();
                const status = normalized.includes('timeout')
                  ? 'timeout'
                  : normalized.includes('cancel')
                    ? 'cancelled'
                    : 'failed';
                return {
                  ...m,
                  content: m.content
                    ? m.content + `\n\n${t('chat:errors.appendError', { error })}`
                    : t('chat:errors.appendError', { error }),
                  status,
                  isError: true,
                };
              }
              return m;
            }));
          },
        },
        {
          timeoutMs: cliTimeout,
          approvalMode,
          showStderr: cliShowStderr,
        }
      );
    } catch (err: any) {
      console.error('executeCLIStrategy error:', err);
      const errMsg = err?.message || String(err);
      const systemMsg = {
        id: `sys-${Date.now()}`,
        sender: { id: 'sys', name: t('chat:systemSender') },
        content: t('chat:errors.taskNotStarted', { message: errMsg }),
        isAI: true,
        isError: true,
      };
      setMessages(prev => [...prev, systemMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendAIMessage = async (promptText: string) => {
    let messageHistory = messages.map(msg => ({
      role: 'user',
      content: msg.sender.name === userStore.userInfo.nickname ? 'user：' + msg.content : msg.sender.name + '：' + msg.content,
      name: msg.sender.name,
    }));

    let selectedChars = groupAiCharacters;

    if (group.type === 'ai' && !isGroupDiscussionMode && schedulerStrategy === 'tag') {
      try {
        const res = await request(`/api/scheduler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: promptText, history: messageHistory, availableAIs: groupAiCharacters }),
        });
        const data = await res.json();
        if (data.selectedAIs) {
          selectedChars = data.selectedAIs.map((ai: any) => groupAiCharacters.find(c => c.id === ai)).filter(Boolean);
        }
      } catch { /* fallback to all */ }
    }

    for (let i = 0; i < selectedChars.length; i++) {
      const char = selectedChars[i] as any;
      if (mutedUsers.includes(char.id)) continue;

      const aiMessage = {
        id: newChatMessageId(),
        sender: { id: char.id, name: char.name, avatar: char.avatar },
        content: "",
        isAI: true,
      };
      setMessages(prev => [...prev, aiMessage]);

      let uri = "/api/chat";
      let requestBody = {
        model: char.model,
        providerId: char.providerId,
        message: promptText,
        query: promptText,
        personality: char.personality,
        history: messageHistory,
        index: i,
        aiName: char.name,
        custom_prompt: (char.custom_prompt || '') + "\n" + group.description,
      };

      try {
        const response = await request(uri, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        if (!response.ok) throw new Error(t('chat:errors.requestFailed'));

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error(t('chat:errors.streamUnavailable'));

        let buffer = '';
        let completeResponse = '';
        const timeout = 10000;

        while (true) {
          const startTime = Date.now();
          let { done, value } = await Promise.race([
            reader.read(),
            new Promise<any>((_, reject) => setTimeout(() => reject(new Error(t('chat:errors.timeout'))), timeout - (Date.now() - startTime))),
          ]);
          if (done) break;

          if (Date.now() - startTime > timeout) {
            reader.cancel();
            if (completeResponse.trim() === "") {
              throw new Error(t('chat:errors.timeout'));
            }
            done = true;
          }

          if (done) {
            if (completeResponse.trim() === "") {
              completeResponse = t('chat:errors.serviceUnavailable');
            }
            setMessages(prev => prev.map(msg =>
              msg.id === aiMessage.id ? { ...msg, content: completeResponse } : msg
            ));
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
          completeResponse = t('chat:errors.serviceUnavailable');
          setMessages(prev => prev.map(msg =>
            msg.id === aiMessage.id ? { ...msg, content: completeResponse } : msg
          ));
        }

        messageHistory.push({ role: 'user', content: char.name + '：' + completeResponse, name: char.name });
        if (i < selectedChars.length - 1) await new Promise(r => setTimeout(r, 1000));
      } catch (error: any) {
        const errMsg = error?.message || t('chat:unknownError');
        messageHistory.push({ role: 'user', content: `${char.name}：${t('chat:errors.appendError', { error: errMsg })}`, name: char.name });
        setMessages(prev => prev.map(msg =>
          msg.id === aiMessage.id ? { ...msg, content: t('chat:serviceError', { message: errMsg }), isError: true } : msg
        ));
      }
    }
    setIsLoading(false);
  };

  const handleSendMessage = async () => {
    if (isLoading) return;
    if (!inputMessage.trim()) return;

    if (group.type === 'ai' || !group.type) {
      ensureActiveSession(inputMessage);
    }

    const userMessage = {
      id: newChatMessageId(),
      sender: users[0],
      content: inputMessage,
      isAI: false,
    };
    shouldStickToBottomRef.current = true;
    setMessages(prev => [...prev, userMessage]);
    const prompt = inputMessage;
    setInputMessage("");
    setIsLoading(true);

    if (group.type === 'cli') {
      await handleSendCLIMessage(prompt);
    } else {
      await handleSendAIMessage(prompt);
    }
  };


  // ============ RENDER: AI / CLI 群 ============
  const userName = userStore.userInfo.nickname || t('settings:aiGroup.selfName');
  // 当前用户头像从全局解析（不随消息持久化，避免 base64 撑爆存储）；历史消息也据此渲染
  const selfAvatar = userStore.avatarDisplaySrc || userStore.userInfo?.avatar_url || undefined;
  const isCLIGroup = group.type === 'cli';

  return (
    <>
      {/* AI Group Settings (Mobile Drawer) */}
      {isMobile && group.type === 'ai' && (
        <AIGroupSettings
          open={showSettings}
          onOpenChange={handleToggleSettings}
          group={group as AIGroup}
          users={users}
          mutedUsers={mutedUsers}
          onToggleMute={handleToggleMute}
          isGroupDiscussionMode={isGroupDiscussionMode}
          onToggleGroupDiscussion={() => setIsGroupDiscussionMode(!isGroupDiscussionMode)}
          schedulerStrategy={schedulerStrategy}
          onStrategyChange={setSchedulerStrategy}
          onMembersChange={handleMembersChange}
          onUpdateGroup={handleUpdateGroup}
          onDeleteGroup={() => handleDeleteGroup(group)}
          canDeleteGroup={!isBuiltinGroupId(group.id)}
        />
      )}

      {/* CLI Group Settings (Mobile Drawer) */}
      {isMobile && group.type === 'cli' && (
        <CLIGroupSettings
          open={showSettings}
          onOpenChange={handleToggleSettings}
          group={{ ...(group as CLIGroup), strategy: cliStrategy, executionPlan: cliExecutionPlan }}
          members={
            ((group as CLIGroup).memberIds || (group as CLIGroup).members || [])
              .map(id => resolveEffectiveMember(aiMembers, id))
              .filter(m => m && m.kind === 'cli')
              .map(m => mapAIMemberToLegacy(m) as CLIAgent)
          }
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
          showStderr={cliShowStderr}
          onShowStderrChange={setCliShowStderr}
          strategy={cliStrategy}
          onStrategyChange={handleCLIStrategyChange}
          onExecutionPlanChange={handleCLIExecutionPlanChange}
          sessionPolicy={cliSessionPolicy}
          onSessionPolicyChange={handleCliSessionPolicyChange}
          onRetryTask={(agentId, prompt) => {
            const m = resolveEffectiveMember(aiMembers, agentId);
            const agent = m && m.kind === 'cli' ? mapAIMemberToLegacy(m) as CLIAgent : undefined;
            if (agent) {
              handleRetryTask({
                prompt,
                sender: { id: agentId, name: agent.name }
              });
              handleToggleSettings(false);
            }
          }}
          onMembersChange={handleMembersChange}
        />
      )}

      <AppPageShell>
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={toggleSidebar}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={handleSelectGroup}
            groups={groups}
            onCreateGroup={handleCreateGroup}
            onOpenSettings={openAppSettings}
            onNavigateCLI={handleNavigateCLI}
            onNavigateHome={handleNavigateHome}
            hiddenGroupTypes={['cli']}
          />

          {isAIGroup && (
            <ConversationSidebar
              isOpen={convSidebarOpen}
              toggleSidebar={() => setConvSidebarOpen(false)}
              sessions={groupSessions}
              selectedSessionId={activeSessionId}
              groupName={group.name}
              onSelectSession={handleSelectSession}
              onNewSession={startNewConversation}
              onRenameSession={renameChatSession}
              onDeleteSession={handleDeleteSession}
              onTogglePin={toggleChatSessionPinned}
              onToggleArchive={toggleChatSessionArchived}
            />
          )}

          <div className={styles.rightCol}>
            {isAIGroup && !convSidebarOpen && (
              <Tooltip title={t('chat:conversation.expand')} placement="right">
                <button
                  type="button"
                  className={styles.convSidebarExpandHandle}
                  onClick={() => setConvSidebarOpen(true)}
                  aria-label={t('chat:conversation.expand')}
                >
                  <PanelLeftOpen size={14} />
                </button>
              </Tooltip>
            )}
            {/* Header */}
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div className={styles.headerLeft}>
                  <div className={styles.mobileBackBtn} onClick={toggleSidebar}>
                    <ChevronLeft size={20} />
                  </div>
                  <div className={styles.titleRow}>
                    <span className={styles.titleIcon}>
                      {group.type === 'cli' ? (
                        <Terminal size={15} />
                      ) : (
                        <Bot size={15} />
                      )}
                    </span>
                    <h1 className={styles.titleText}>
                      {group.name}
                    </h1>
                    <span className={styles.memberCount}>({users.length})</span>
                  </div>
                </div>
                <div className={styles.headerActions}>
                  {group.type === 'cli' && workspacePath && (
                    <div className={styles.headerCwd}>
                      <span className={styles.cwdLabel}>CWD:</span>
                      <span
                        className={styles.cwdPath}
                        onDoubleClick={() => handleToggleSettings(!showSettings)}
                        title={t('chat:cliMeta.workspaceTitle')}
                      >
                        {workspacePath}
                      </span>
                    </div>
                  )}
                  <div className={styles.desktopOnly}>
                    <AdBanner show={showAd} closeAd={() => setShowAd(false)} />
                  </div>
                  <div className={styles.avatarStack}>
                    {users.slice(0, 4).map((user) => {
                      const a = getAvatarData(user.name);
                      const url = resolveAvatarByName(user.name, user.avatar, 32);
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
                    onClick={() => handleToggleSettings(!showSettings)}
                    title={t('chat:cliMeta.settings')}
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
              <div className={styles.mobileOnly}>
                <AdBannerMobile show={showAd} closeAd={() => setShowAd(false)} />
              </div>
              <div className={styles.messageList}>
                {messages.map((message) => {
                  const isUser = message.sender.name === userName;
                  const cliMember = message.sender?.id?.startsWith?.('cli-')
                    ? resolveEffectiveMember(aiMembers, message.sender.id)
                    : undefined;
                  const cliAgentInfo = cliMember && cliMember.kind === 'cli'
                    ? (mapAIMemberToLegacy(cliMember) as CLIAgent)
                    : undefined;
                  const avatarName = cliAgentInfo?.name || message.sender.name;
                  const avatarSource = isUser
                    ? (selfAvatar || message.sender.avatar)
                    : (cliAgentInfo?.avatar || message.sender.avatar);
                  const a = getAvatarData(avatarName);
                  const url = resolveAvatarByName(avatarName, avatarSource, 40);
                  const isLatest = messages[messages.length - 1]?.id === message.id;
                  const isStreaming = !!message.isAI && (message.status === 'running' || (isLoading && isLatest));
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
                      <div className={cx(styles.messageBody, isUser && styles.messageBodyUser)}>
                        <div className={styles.metaRow} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                          {message.sender.name}
                          {isStreaming && !message.content.includes('</details>') && (
                            <span className={styles.streaming}>
                              <span className={styles.streamingDot} />
                              {message.content === '' ? t('chat:status.thinking') : (isCli ? t('chat:status.executing') : t('chat:status.running'))}
                            </span>
                          )}
                        </div>
                        <div className={cx(bubbleClass, 'chat-message')}>
                          <ChatMarkdown
                            content={message.content}
                            isUser={isUser}
                            basePath={message.cliCwd || workspacePath}
                          />
                          {isStreaming && (
                            <span className={cx('typing-indicator', styles.typingCursor)}>▋</span>
                          )}
                          {message.taskId && (
                            <div className={styles.cliTaskFooter}>
                              <span className={styles.cliTaskStatus}>
                                {message.status === 'running' && (
                                  <>
                                    <span className={styles.spinnerIcon} />
                                    <span>{t('chat:status.executing')}</span>
                                  </>
                                )}
                                {message.status === 'completed' && <span style={{ color: '#52c41a' }}>{t('chat:status.completed')}</span>}
                                {message.status === 'failed' && <span style={{ color: '#ff4d4f' }}>{t('chat:status.failed')}</span>}
                                {message.status === 'cancelled' && <span style={{ color: '#faad14' }}>{t('chat:status.cancelled')}</span>}
                                {message.status === 'timeout' && <span style={{ color: '#ff4d4f' }}>{t('chat:status.timeout')}</span>}
                              </span>
                              <div className={styles.cliTaskActions}>
                                {message.status === 'running' && (
                                  <button
                                    onClick={() => handleCancelTask(message.taskId)}
                                    className={styles.cliActionBtnCancel}
                                  >
                                    {t('chat:cliMeta.stop')}
                                  </button>
                                )}
                                {['failed', 'cancelled', 'timeout'].includes(message.status || '') && (
                                  <button
                                    onClick={() => handleRetryTask(message)}
                                    className={styles.cliActionBtnRetry}
                                  >
                                    {t('chat:cliMeta.retry')}
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                          {message.taskId && (message.cliCwd || message.cliBranch) && message.cliCwd !== workspacePath && (
                            <div className={styles.cliWorktreeInfo}>
                              <div>
                                <span style={{ fontWeight: 500 }}>{t('chat:cliMeta.workdir')}</span>
                                <button
                                  className={styles.cliWorktreeCopyBtn}
                                  onClick={() => {
                                    if (message.cliCwd && navigator.clipboard) {
                                      navigator.clipboard.writeText(message.cliCwd).catch(() => { /* ignore */ });
                                    }
                                  }}
                                >
                                  {t('chat:cliMeta.copyPath')}
                                </button>
                                <button
                                  className={styles.cliWorktreeCopyBtn}
                                  onClick={async () => {
                                    if (message.cliCwd) {
                                      try {
                                        await openPath(message.cliCwd);
                                      } catch {
                                        // fallback: copy cd command to clipboard
                                        if (navigator.clipboard) {
                                          navigator.clipboard.writeText(`cd ${message.cliCwd}`).catch(() => {});
                                        }
                                      }
                                    }
                                  }}
                                >
                                  {t('chat:cliMeta.openPath')}
                                </button>
                              </div>
                              <div className={styles.cliWorktreePath}>{message.cliCwd}</div>
                              {message.cliBranch && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>{t('chat:cliMeta.branch')}</span>
                                  <span className={styles.cliWorktreePath}>{message.cliBranch}</span>
                                </div>
                              )}
                              {message.baseSha && (
                                <div>
                                  <span style={{ fontWeight: 500 }}>{t('chat:cliMeta.base')}</span>
                                  <span className={styles.cliWorktreePath}>{message.baseSha.slice(0, 8)}</span>
                                </div>
                              )}
                              {message.status === 'completed' && !message.adopted && (
                                <button
                                  className={styles.cliWorktreeCopyBtn}
                                  style={{ marginTop: 4, marginLeft: 0, color: '#52c41a', borderColor: '#b7eb8f' }}
                                  onClick={() => {
                                    setMessages(prev => prev.map(m =>
                                      m.taskId === message.taskId ? { ...m, adopted: true } : m
                                    ));
                                  }}
                                >
                                  {t('chat:cliMeta.adopt')}
                                </button>
                              )}
                              {message.adopted && (
                                <span style={{ marginTop: 4, display: 'inline-block', fontSize: 10, color: '#52c41a', fontWeight: 600 }}>
                                  {t('chat:cliMeta.adopted')}
                                </span>
                              )}
                            </div>
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
                  placeholder={isCLIGroup ? t('chat:placeholders.cliInput') : t('chat:placeholders.aiInput')}
                  containerStyle={{ flex: 1, minWidth: 0 }}
                />
                <AntdButton
                  className={styles.composeSendButton}
                  onClick={handleSendMessage}
                  loading={isLoading}
                  icon={isLoading ? undefined : <Send size={16} color={BRAND_ON_PRIMARY} />}
                  style={brandPrimaryButtonStyle}
                  styles={{
                    content: { color: BRAND_ON_PRIMARY },
                    icon: { color: BRAND_ON_PRIMARY },
                  }}
                />
              </div>
            </div>
          </div>

          {/* AI Group Settings (Desktop Inline) */}
          {!isMobile && group.type === 'ai' && (
            <AIGroupSettings
              inline
              open={showSettings}
              onOpenChange={handleToggleSettings}
              group={group as AIGroup}
              users={users}
              mutedUsers={mutedUsers}
              onToggleMute={handleToggleMute}
              isGroupDiscussionMode={isGroupDiscussionMode}
              onToggleGroupDiscussion={() => setIsGroupDiscussionMode(!isGroupDiscussionMode)}
              schedulerStrategy={schedulerStrategy}
              onStrategyChange={setSchedulerStrategy}
              onMembersChange={handleMembersChange}
              onUpdateGroup={handleUpdateGroup}
              onDeleteGroup={() => handleDeleteGroup(group)}
              canDeleteGroup={!isBuiltinGroupId(group.id)}
            />
          )}

          {/* CLI Group Settings (Desktop Inline) */}
          {!isMobile && group.type === 'cli' && (
            <CLIGroupSettings
              inline
              open={showSettings}
              onOpenChange={handleToggleSettings}
              group={{ ...(group as CLIGroup), strategy: cliStrategy, executionPlan: cliExecutionPlan }}
              members={
                ((group as CLIGroup).memberIds || (group as CLIGroup).members || [])
                  .map(id => resolveEffectiveMember(aiMembers, id))
                  .filter(m => m && m.kind === 'cli')
                  .map(m => mapAIMemberToLegacy(m) as CLIAgent)
              }
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
              showStderr={cliShowStderr}
              onShowStderrChange={setCliShowStderr}
              strategy={cliStrategy}
              onStrategyChange={handleCLIStrategyChange}
              onExecutionPlanChange={handleCLIExecutionPlanChange}
              sessionPolicy={cliSessionPolicy}
              onSessionPolicyChange={handleCliSessionPolicyChange}
              onRetryTask={(agentId, prompt) => {
                const m = resolveEffectiveMember(aiMembers, agentId);
                const agent = m && m.kind === 'cli' ? mapAIMemberToLegacy(m) as CLIAgent : undefined;
                if (agent) {
                  handleRetryTask({
                    prompt,
                    sender: { id: agentId, name: agent.name }
                  });
                  handleToggleSettings(false);
                }
              }}
              onMembersChange={handleMembersChange}
            />
          )}

      </AppPageShell>

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

export default ChatUI;
