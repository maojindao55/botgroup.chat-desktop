/**
 * 专家群聊对话组件
 * 独立的聊天 UI，使用 planner -> workflow runner 驱动对话
 */
import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Square, Settings2, ChevronLeft, Puzzle, PanelLeftOpen, Paperclip, ChevronDown, Copy, Check } from 'lucide-react';
import { Tooltip, Button as AntdButton, Modal, message as antdMessage } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
import { ModelIcon } from '@lobehub/icons';
import { createStyles } from 'antd-style';
import { invoke } from '@tauri-apps/api/core';
import i18n from '@/i18n';
import { ChatMarkdown } from '@/components/Markdown';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { resolveEffectiveMember } from '@/utils/aiMemberDisplay';
import { planAgentWorkflow, planAgentWorkflowSmart } from '@/engine/agentWorkflowPlanner';
import { runAgentWorkflowPlan } from '@/engine/agentWorkflowRunner';
import type { AgentWorkflowRunnerCallbacks } from '@/engine/agentWorkflowRunner';
import AgentGroupSettings from './AgentGroupSettings';
import Sidebar from './Sidebar';
import ConversationSidebar from './ConversationSidebar';
import CLITaskLogModal from './CLITaskLogModal';
import type { AgentGroup, Group } from '@/config/groups';
import { isBuiltinGroupId } from '@/config/groupStorage';
import { useAIMemberStore } from '@/store/aiMemberStore';
import type { AIMember } from '@/config/aiMembers';
import { useChatSessionStore } from '@/store/chatSessionStore';
import { useShallow } from 'zustand/react/shallow';
import { useMutedMembersStore } from '@/store/mutedMembersStore';
import { useAgentWorkflowPlannerSettings } from '@/store/agentWorkflowPlannerSettings';
import {
  truncateSessionTitle,
  sanitizeWorkflowRunForStorage,
  type ChatAttachment,
  type ChatSessionMessage,
} from '@/config/chatSessions';
import {
  composeMessageWithAttachments,
  createChatAttachment,
  formatAttachmentsForHistory,
  MAX_ATTACHMENTS_PER_MESSAGE,
  validateAttachmentCandidate,
} from '@/utils/chatAttachments';
import { resolveCliToolSessionKey } from '@/engine/cliToolSessions';
import { supportsCliToolSession } from '@/config/cliAdapters';
import { getWorkflowPlanApprovalReason, newAgentWorkflowRun, type AgentWorkflowPlan, type AgentWorkflowRun } from '@/config/agentWorkflow';
import AgentWorkflowPlanCard from './AgentWorkflowPlanCard';
import { AppSettingsModal } from './AppSettingsModal';
import type { AppSettingsSection } from '@/config/appSettings';
import { MentionTextArea } from './MentionAutocomplete';
import { extractMentionedCandidateIds } from '@/utils/mentionAutocomplete';
import { ChatAttachmentList } from './ChatAttachments';
import { generateSessionTitle } from '@/utils/sessionTitle';
import { BRAND_ON_PRIMARY, brandPrimaryButtonStyle } from '@/lib/theme';

/** 生成唯一消息 ID */
let _globalMsgId = Date.now();
function nextMsgId(): string {
  return `msg_${++_globalMsgId}_${Math.random().toString(36).slice(2, 8)}`;
}

/** 旧版单会话 localStorage key 前缀（仅用于一次性迁移） */
const LEGACY_MSG_KEY_PREFIX = 'agent_chat_messages:';
const LEGACY_TITLE_KEY_PREFIX = 'agent_chat_title:';

const EMPTY_MESSAGES: readonly ChatSessionMessage[] = Object.freeze([]);

interface ChatMessage {
  id: string;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  isAI: boolean;
  isError?: boolean;
  /** 该消息是否仍在流式生成中 */
  isStreaming?: boolean;
  /** 仅作为 workflow runner 的容器在内存中存在，不在聊天列表中渲染 */
  hidden?: boolean;
  /** CLI agent 一次任务 id，用于查执行日志（仅 CLI agent 产生的消息有） */
  agentTaskId?: string;
  /** CLI adapter（codex/claude/opencode/...），日志 Modal 用 */
  adapter?: string;
  attachments?: ChatAttachment[];
  workflowRun?: ChatSessionMessage['workflowRun'];
}

interface PendingWorkflowExecution {
  plan: AgentWorkflowPlan;
  userMessage: string;
  history: string;
  sessionId: string;
  mentionedAgentIds?: string[];
  revisionInstruction?: string;
}

function cloneWorkflowRun(run: AgentWorkflowRun): AgentWorkflowRun {
  return {
    ...run,
    phaseStates: Object.fromEntries(
      Object.entries(run.phaseStates).map(([key, value]) => [
        key,
        { ...value, selectedAgentIds: [...value.selectedAgentIds], outputs: value.outputs.map(output => ({ ...output })) },
      ]),
    ),
  };
}

/**
 * 将用户消息里「@已知专家名」包裹成高亮 span，供 ChatMarkdown（allowHtml）渲染。
 * - 仅替换以空白/行首开头、且后接空白/行尾的完整 @Name，避免误伤代码块等。
 * - 含代码围栏 ``` 的内容整体跳过，降低破坏 markdown 的风险。
 * - isUser=true 时使用适配橙色用户气泡的高对比样式（白字半透明白底）。
 */
function highlightMentions(content: string, names: string[], isUser = false): string {
  if (!content || names.length === 0) return content;
  if (content.includes('```')) return content;
  const open = isUser
    ? '<span style="color:#fff;background:rgba(255,255,255,0.22);border-radius:4px;padding:0 4px;font-weight:600;">'
    : '<span class="agent-mention">';
  const close = '</span>';
  let result = content;
  for (const rawName of names) {
    const name = rawName && rawName.trim();
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|\\s)@${escaped}(?=\\s|$)`, 'gu');
    result = result.replace(re, (_m, prefix: string) => `${prefix}${open}@${name}${close}`);
  }
  return result;
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
    border-bottom: 1px solid ${token.colorBorder};
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
  plannerBadge: css`
    margin-left: 6px;
    font-size: 10px;
    color: #a855f7;
  `,
  cliLogBtnRow: css`
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;
  `,
  cliLogBtn: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: ${token.colorTextSecondary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
    &:hover {
      color: ${token.colorText};
      border-color: ${token.colorBorder};
    }
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
  userAttachmentBubble: css`
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;

    & > div {
      justify-content: flex-end;
      margin-top: 0;
    }
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
  messageBubble: css`
    position: relative;
    & .msg-copy-btn {
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    &:hover .msg-copy-btn {
      opacity: 1;
    }
  `,
  msgCopyBtn: css`
    position: absolute;
    top: 4px;
    right: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 5px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    z-index: 2;
    &:hover {
      color: ${token.colorText};
      background: ${token.colorFillTertiary};
    }
  `,
  phaseBadge: css`
    margin-left: 2px;
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 4px;
    background: rgba(168, 85, 247, 0.12);
    color: #a855f7;
    font-weight: 500;
  `,
  titleProgress: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
  `,
  progressDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f97316;
    animation: agentProgressPulse 1s infinite;
    @keyframes agentProgressPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `,
  jumpButton: css`
    position: absolute;
    right: 24px;
    bottom: 18px;
    z-index: 8;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 36px;
    height: 36px;
    padding: 0 10px;
    border-radius: 999px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.12);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
    &:hover {
      color: #ff6600;
      border-color: rgba(255, 102, 0, 0.4);
    }
  `,
  jumpBadge: css`
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 999px;
    background: #ff6600;
    color: #fff;
    font-size: 10px;
    font-weight: 600;
  `,
  suggestionWrap: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 22px;
    width: 100%;
  `,
  suggestionLabel: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  suggestionChips: css`
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  `,
  suggestionChip: css`
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    border-radius: 999px;
    padding: 6px 14px;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s ease;
    &:hover {
      color: #ff6600;
      border-color: rgba(255, 102, 0, 0.4);
      background: rgba(255, 102, 0, 0.05);
    }
  `,
}));

// Store updateMessage preserves object refs for unchanged messages, so
// React.memo skips historical messages during streaming token updates.
interface AgentMessageItemProps {
  message: ChatSessionMessage;
  members: Record<string, AIMember>;
  userName: string;
  userAvatarDisplaySrc?: string | null;
  basePath?: string;
  hideMessageDetails?: boolean;
  mentionNames?: string[];
  isPendingPlan: boolean;
  isRevisingPlan: boolean;
  onRun?: (messageId: string, force?: boolean) => void;
  onCancel?: (messageId: string) => void;
  onRevise?: (messageId: string, instruction: string) => void;
  onLogClick: (target: { agentTaskId: string; agentName?: string; adapter?: string }) => void;
}

const BASE_AGENT_ID_SUFFIX_RE = /__.+$/;
const BASE_AGENT_ID_ROUND_RE = /_r\d+$/;

function AgentMessageItemComponent({
  message,
  members,
  userName,
  userAvatarDisplaySrc,
  basePath,
  hideMessageDetails,
  mentionNames,
  isPendingPlan,
  isRevisingPlan,
  onRun,
  onCancel,
  onRevise,
  onLogClick,
}: AgentMessageItemProps) {
  const { t } = useTranslation(['chat', 'cli', 'chat:agentWorkflow']);
  const { styles, cx } = useStyles();
  const [copied, setCopied] = useState(false);

  if (message.hidden) return null;

  const isUser = message.sender.name === userName;
  const hasTextContent = (message.content || '').trim().length > 0;
  const hasAttachments = !!message.attachments?.length;
  const isWorkflowMessage = message.sender.id === '__workflow__' || !!message.workflowRun;
  const plannerModelName = message.workflowRun?.plan.plannerModel
    || (isWorkflowMessage ? message.sender.name : undefined);
  const baseAgentId = message.sender.id?.replace(BASE_AGENT_ID_SUFFIX_RE, '').replace(BASE_AGENT_ID_ROUND_RE, '') || '';
  const member = !isUser && baseAgentId
    ? resolveEffectiveMember(members, baseAgentId)
    : undefined;
  const avatarName = member?.name || message.sender.name;
  const a = getAvatarData(avatarName);
  const url = isUser
    ? resolveAvatarByName(userName, userAvatarDisplaySrc ?? undefined, 40)
    : resolveAvatarByName(avatarName, member?.avatar || message.sender.avatar, 40);
  const isStreaming = !!message.isStreaming;
  const phaseLabel = message.phaseLabel;

  const handleCopy = async () => {
    const text = message.content || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  let bubbleClass = styles.bubbleAI;
  if (isUser) bubbleClass = styles.bubbleUser;
  else if (message.isError) bubbleClass = styles.bubbleError;

  const warnings = message.content ? message.content.split('\n').filter(Boolean) : [];

  const handleLogClick = () => {
    onLogClick({
      agentTaskId: message.agentTaskId!,
      agentName: message.sender.name,
      adapter: message.adapter,
    });
  };
  const messageId = String(message.id);
  const handleRun = onRun ? () => onRun(messageId) : undefined;
  const handleCancel = onCancel ? () => onCancel(messageId) : undefined;
  const handleRevise = onRevise ? (instruction: string) => onRevise(messageId, instruction) : undefined;

  return (
    <div
      className={styles.messageRow}
      style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}
    >
      {!isUser && (
        isWorkflowMessage && plannerModelName ? (
          <ModelIcon
            model={plannerModelName}
            type="avatar"
            shape="circle"
            size={40}
            style={{ flexShrink: 0 }}
          />
        ) : (
          <LobeAvatar
            avatar={url || a.text}
            background={a.backgroundColor}
            shape="circle"
            size={40}
            title={message.sender.name}
            style={{ flexShrink: 0 }}
          />
        )
      )}
      <div className={cx(styles.messageBody, isUser && styles.messageBodyUser)}>
        <div className={styles.metaRow} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
          {message.sender.name}
          {!isUser && !isWorkflowMessage && (
            <span className={styles.agentBadge}>{t('chat:agentChat.expertBadge')}</span>
          )}
          {!isUser && isWorkflowMessage && (
            <span className={styles.plannerBadge}>{t('chat:agentWorkflow.plannerBadge', { defaultValue: '规划者' })}</span>
          )}
          {phaseLabel && (
            <span className={styles.phaseBadge}>{phaseLabel}</span>
          )}
        </div>
        {(!isUser || hasTextContent || isWorkflowMessage) && (
          <div className={cx(bubbleClass, styles.messageBubble)}>
            {!isUser && hasTextContent && !message.workflowRun && (
              <button
                type="button"
                className={cx('msg-copy-btn', styles.msgCopyBtn)}
                onClick={handleCopy}
                aria-label={copied ? t('chat:agentChat.copied') : t('chat:agentChat.copy')}
                title={copied ? t('chat:agentChat.copied') : t('chat:agentChat.copy')}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
              </button>
            )}
            {message.workflowRun ? (
              <AgentWorkflowPlanCard
                plan={message.workflowRun.plan}
                run={message.workflowRun}
                warnings={warnings}
                running={message.workflowRun.status === 'running'}
                revising={isRevisingPlan}
                onRun={isPendingPlan ? handleRun : undefined}
                onCancel={isPendingPlan ? handleCancel : undefined}
                onRevise={isPendingPlan ? handleRevise : undefined}
              />
            ) : (
              <ChatMarkdown
                content={isUser ? highlightMentions(message.content || '', mentionNames || [], true) : (message.content || '')}
                isUser={isUser}
                basePath={basePath}
                hideDetails={!isUser && hideMessageDetails}
              />
            )}
            {!isUser && !isWorkflowMessage && (
              <ChatAttachmentList
                attachments={message.attachments}
                unavailableLabel={t('chat:attachments.unavailable', { defaultValue: '文件不可用' })}
              />
            )}
            {isStreaming && (
              <span className={cx('typing-indicator', styles.typingCursor)}>▋</span>
            )}
            {!isUser && !hideMessageDetails && member?.kind === 'cli' && message.agentTaskId && (
              <div className={styles.cliLogBtnRow}>
                <button
                  type="button"
                  className={styles.cliLogBtn}
                  onClick={handleLogClick}
                >
                  {t('cli:taskUI.message.log', { defaultValue: '日志' })}
                </button>
              </div>
            )}
          </div>
        )}
        {isUser && hasAttachments && (
          <div className={styles.userAttachmentBubble}>
            <ChatAttachmentList
              attachments={message.attachments}
              unavailableLabel={t('chat:attachments.unavailable', { defaultValue: '文件不可用' })}
            />
          </div>
        )}
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
}

const AgentMessageItem = memo(AgentMessageItemComponent);

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
  const { styles } = useStyles();
  const members = useAIMemberStore(s => s.members);
  const membersLoading = useAIMemberStore(s => s.loading);
  const loadMembers = useAIMemberStore(s => s.load);
  const plannerSettings = useAgentWorkflowPlannerSettings(s => s.settings);
  const buildPlannerSmartOptions = useCallback(() => {
    if (plannerSettings.mode !== 'llm' || !plannerSettings.providerId || !plannerSettings.model) {
      return undefined;
    }
    return {
      llm: {
        providerId: plannerSettings.providerId,
        model: plannerSettings.model,
        temperature: plannerSettings.temperature,
      },
      llmLabel: plannerSettings.model,
    };
  }, [plannerSettings.mode, plannerSettings.providerId, plannerSettings.model, plannerSettings.temperature]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const currentMemberIds = group.memberIds || [];
  const dbAgents = currentMemberIds
    .map(id => members[id])
    .filter(m => m && (m.kind === 'cli' || m.kind === 'agent'));
  // 兼容遗留 agent group：旧版本把成员内联在 group.agents 中。
  // 若 store 中找不到任何匹配成员，则回退使用 inline 数据，保证旧数据仍可使用。
  const legacyInlineAgents = Array.isArray((group as { agents?: unknown }).agents)
    ? ((group as { agents?: unknown[] }).agents as unknown[]).filter(
        (a): a is { id: string; kind?: string } =>
          !!a && typeof a === 'object' && typeof (a as { id?: unknown }).id === 'string'
      )
    : [];
  const currentAgents = dbAgents.length > 0 ? dbAgents : (legacyInlineAgents as typeof dbAgents);
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

  const [inputMessage, setInputMessage] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<AppSettingsSection>('general');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('conv');
    } catch {
      return null;
    }
  });
  const runningSessionsRef = useRef<Map<string, AbortController>>(new Map());
  const tokenFlushRef = useRef<{
    sessionId: string;
    dirty: Map<string, string>;
    rafId: number | null;
  }>({ sessionId: '', dirty: new Map(), rafId: null });
  const [runningSessionsVersion, setRunningSessionsVersion] = useState(0);
  const bumpRunningSessions = useCallback(() => {
    setRunningSessionsVersion(v => v + 1);
  }, []);
  const isLoading = useMemo(() => {
    void runningSessionsVersion;
    return !!activeSessionId && runningSessionsRef.current.has(activeSessionId);
  }, [runningSessionsVersion, activeSessionId]);
  const runningSessionIds = useMemo<Set<string>>(() => {
    void runningSessionsVersion;
    return new Set(runningSessionsRef.current.keys());
  }, [runningSessionsVersion]);
  const activeSessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);
  const [convSidebarOpen, setConvSidebarOpen] = useState(false);
  const [logTarget, setLogTarget] = useState<{
    agentTaskId: string;
    agentName?: string;
    adapter?: string;
  } | null>(null);

  const createChatSessionInStore = useChatSessionStore(state => state.createSession);
  const appendStoreMessage = useChatSessionStore(state => state.appendMessage);
  const updateStoreMessage = useChatSessionStore(state => state.updateMessage);
  const markStoreSessionUnread = useChatSessionStore(state => state.markUnread);
  const markStoreSessionRead = useChatSessionStore(state => state.markRead);
  const renameChatSession = useChatSessionStore(state => state.renameSession);
  const setChatSessionAutoTitle = useChatSessionStore(state => state.setAutoTitle);
  const deleteChatSession = useChatSessionStore(state => state.deleteSession);
  const toggleChatSessionPinned = useChatSessionStore(state => state.togglePinned);
  const toggleChatSessionArchived = useChatSessionStore(state => state.toggleArchived);

  const groupSessions = useChatSessionStore(
    useShallow(state => state.sessions.filter(s => s.groupId === group.id)),
  );
  const activeSession = useChatSessionStore(state =>
    activeSessionId ? state.sessions.find(s => s.id === activeSessionId) ?? null : null,
  );

  const messages = activeSession?.messages ?? EMPTY_MESSAGES;

  /** 当前群专家名列表（用于用户消息 @mention 高亮；稳定引用以配合 memo） */
  const mentionNames = useMemo(() => mentionCandidates.map(c => c.name), [mentionCandidates]);

  /** 运行中的 workflow 进度（最新一条 running/planned 的 workflowRun） */
  const workflowProgress = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const run = messages[i].workflowRun;
      if (!run) continue;
      if (run.status !== 'running' && run.status !== 'planned') continue;
      const phases = run.plan.phases;
      const states = run.phaseStates || {};
      const total = phases.length;
      const completed = phases.filter(p => {
        const s = states[p.id]?.status;
        return s === 'completed' || s === 'skipped';
      }).length;
      const runningPhase = phases.find(p => states[p.id]?.status === 'running');
      return { total, completed, runningPhaseLabel: runningPhase?.label };
    }
    return null;
  }, [messages]);

  /** 正在流式输出的专家数量（并发感知） */
  const activeExpertsCount = useMemo(
    () => messages.filter(m => m.isStreaming && m.isAI && !m.workflowRun && !m.hidden).length,
    [messages],
  );

  const titleGenRef = useRef<Set<string>>(new Set());
  const pendingWorkflowsRef = useRef<Record<string, PendingWorkflowExecution>>({});
  const [pendingWorkflowsVersion, setPendingWorkflowsVersion] = useState(0);
  const [revisingPlanIds, setRevisingPlanIds] = useState<Set<string>>(() => new Set());
  const bumpPendingWorkflows = useCallback(() => {
    setPendingWorkflowsVersion(v => v + 1);
  }, []);
  const pendingPlanIds = useMemo(() => {
    void pendingWorkflowsVersion;
    return new Set(Object.keys(pendingWorkflowsRef.current));
  }, [pendingWorkflowsVersion]);
  const migratedLegacyRef = useRef(false);
  const userStartedNewRef = useRef(false);
  const rehydratedSessionsRef = useRef<Set<string>>(new Set());

  const updateConvParam = (sessionId: string | null) => {
    try {
      const url = new URL(window.location.href);
      if (sessionId) url.searchParams.set('conv', sessionId);
      else url.searchParams.delete('conv');
      window.history.replaceState({}, '', `${url.pathname}${url.search}`);
    } catch { /* noop */ }
  };

  useEffect(() => {
    if (migratedLegacyRef.current) return;
    migratedLegacyRef.current = true;
    try {
      const keys = Object.keys(localStorage);
      const msgKeys = keys.filter(k => k.startsWith(LEGACY_MSG_KEY_PREFIX));
      if (msgKeys.length === 0) return;
      const store = useChatSessionStore.getState();
      for (const msgKey of msgKeys) {
        const gid = msgKey.slice(LEGACY_MSG_KEY_PREFIX.length);
        const titleKey = `${LEGACY_TITLE_KEY_PREFIX}${gid}`;
        const hasExisting = store.sessions.some(s => s.groupId === gid);
        if (!hasExisting) {
          try {
            const raw = localStorage.getItem(msgKey);
            if (raw) {
              const parsed = JSON.parse(raw) as ChatMessage[];
              if (Array.isArray(parsed) && parsed.length > 0) {
                const legacyTitle = localStorage.getItem(titleKey) || '';
                const stored: ChatSessionMessage[] = parsed.map(m => ({
                  id: m.id,
                  sender: { id: m.sender?.id, name: m.sender?.name },
                  content: m.content || '',
                  isAI: !!m.isAI,
                  isError: !!m.isError,
                }));
                const session = store.createSession(gid, {
                  title: legacyTitle || undefined,
                  messages: stored,
                });
                if (legacyTitle) {
                  store.setAutoTitle(session.id, legacyTitle);
                }
              }
            }
          } catch { /* ignore parse errors */ }
        }
        try { localStorage.removeItem(msgKey); } catch { /* noop */ }
        try { localStorage.removeItem(titleKey); } catch { /* noop */ }
      }
    } catch { /* noop */ }
  }, []);

  const rehydratePendingWorkflows = useCallback((msgs: readonly ChatSessionMessage[], sessionId: string) => {
    let added = false;
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const run = m.workflowRun;
      if (!run) continue;
      if (run.status !== 'planned' && run.status !== 'running') continue;
      if (pendingWorkflowsRef.current[m.id]) continue;
      let userMessage = '';
      for (let j = i - 1; j >= 0; j--) {
        const prior = msgs[j];
        if (!prior.isAI) {
          const attachmentSummary = formatAttachmentsForHistory(prior.attachments);
          userMessage = [prior.content || '', attachmentSummary].filter(Boolean).join('\n');
          break;
        }
      }
      const history = msgs.slice(Math.max(0, i - 20), i)
        .map(prev => {
          const attachmentSummary = formatAttachmentsForHistory(prev.attachments);
          return `${prev.sender.name}: ${[prev.content, attachmentSummary].filter(Boolean).join('\n')}`;
        })
        .join('\n');
      pendingWorkflowsRef.current[m.id] = {
        plan: run.plan,
        userMessage,
        history,
        sessionId,
      };
      added = true;
    }
    if (added) bumpPendingWorkflows();
  }, [bumpPendingWorkflows]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (rehydratedSessionsRef.current.has(activeSessionId)) return;
    if (!activeSession) return;
    rehydratedSessionsRef.current.add(activeSessionId);
    rehydratePendingWorkflows(messages, activeSessionId);
  }, [activeSessionId, activeSession, messages, rehydratePendingWorkflows]);

  useEffect(() => {
    if (!activeSessionId || !activeSession?.unread) return;
    markStoreSessionRead(activeSessionId);
  }, [activeSessionId, activeSession, markStoreSessionRead]);

  useEffect(() => {
    if (!activeSessionId) return;
    if (!activeSession) {
      const hasAnySessionForGroup = groupSessions.some(s => s.groupId === group.id);
      if (!hasAnySessionForGroup) return;
      setActiveSessionId(null);
      updateConvParam(null);
      return;
    }
    if (activeSession.groupId !== group.id) {
      setActiveSessionId(null);
      updateConvParam(null);
    }
  }, [activeSessionId, activeSession, groupSessions, group.id]);

  useEffect(() => {
    if (activeSessionId) return;
    if (userStartedNewRef.current) {
      userStartedNewRef.current = false;
      return;
    }
    const candidates = groupSessions
      .filter(s => !s.archived)
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    if (candidates.length > 0) {
      setActiveSessionId(candidates[0].id);
      updateConvParam(candidates[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id, groupSessions, activeSessionId]);

  useEffect(() => {
    if (!activeSessionId || !activeSession) return;
    if (isLoading) return;
    if (messages.length === 0) return;
    if (activeSession.titleSource === 'manual') return;
    if (activeSession.titleGenerated) return;
    if (titleGenRef.current.has(activeSession.id)) return;
    const userMsg = messages.find(m => !m.isAI && (m.content || '').trim());
    const aiMsg = messages.find(m =>
      m.isAI
      && !m.isError
      && !m.workflowRun
      && !m.hidden
      && m.sender.id !== '__system__'
      && m.sender.id !== '__workflow__'
      && (m.content || '').trim()
    );
    const firstAgent = currentAgents[0] as { model?: string; providerId?: string } | undefined;
    if (!userMsg || !aiMsg || !firstAgent?.model) return;
    const sid = activeSession.id;
    titleGenRef.current.add(sid);
    generateSessionTitle({
      userMessage: userMsg.content,
      aiMessage: aiMsg.content,
      model: firstAgent.model,
      providerId: firstAgent.providerId,
    })
      .then(title => { if (title) setChatSessionAutoTitle(sid, title); })
      .finally(() => { titleGenRef.current.delete(sid); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading, activeSessionId, activeSession]);

  const ensureActiveSession = (firstText: string): string | null => {
    if (activeSessionId && groupSessions.some(s => s.id === activeSessionId)) {
      return activeSessionId;
    }
    const fallbackTitle = truncateSessionTitle(firstText, undefined, t('chat:conversation.untitled'));
    const session = createChatSessionInStore(group.id, { fallbackTitle });
    setActiveSessionId(session.id);
    updateConvParam(session.id);
    return session.id;
  };

  const startNewConversation = () => {
    userStartedNewRef.current = true;
    setActiveSessionId(null);
    updateConvParam(null);
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
    const target = groupSessions.find(s => s.id === sessionId);
    Modal.confirm({
      title: t('chat:conversation.deleteConfirmTitle', { name: target?.title || '' }),
      content: t('chat:conversation.deleteConfirmContent'),
      okText: t('common:actions.delete'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
      onOk: () => {
        deleteChatSession(sessionId);
        if (sessionId === activeSessionId) {
          const remaining = groupSessions
            .filter(s => s.id !== sessionId && !s.archived)
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
  const mutedByGroup = useMutedMembersStore(s => s.byGroup);
  const toggleMutedMember = useMutedMembersStore(s => s.toggle);
  const mutedUsers = mutedByGroup[group.id] || [];

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  const [missedMessageCount, setMissedMessageCount] = useState(0);

  useEffect(() => {
    if (isMobile !== undefined) {
      setSidebarOpen(!isMobile);
      setConvSidebarOpen(!isMobile);
    }
  }, [isMobile]);

  const handleChatAreaScroll = () => {
    const el = chatAreaRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const stuck = distanceToBottom < 80;
    shouldStickToBottomRef.current = stuck;
    setShowJumpToBottom(!stuck);
    if (stuck) setMissedMessageCount(0);
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const handleJumpToBottom = () => {
    shouldStickToBottomRef.current = true;
    setShowJumpToBottom(false);
    setMissedMessageCount(0);
    scrollMessagesToBottom('smooth');
  };

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setShowJumpToBottom(false);
    setMissedMessageCount(0);
    scrollMessagesToBottom('auto');
  }, [group.id, activeSessionId]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollMessagesToBottom('smooth');
    }
  }, [messages]);

  // 仅在「新增消息」时累计未读，避免流式 token 刷新把计数刷爆。
  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      setMissedMessageCount(0);
    } else {
      setMissedMessageCount(c => c + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  const handleToggleMute = (userId: string) => {
    toggleMutedMember(group.id, userId);
  };

  /** 取消正在进行的请求 */
  const handleAbort = useCallback(() => {
    const targetSessionId = activeSessionIdRef.current;
    if (!targetSessionId) return;
    const flush = tokenFlushRef.current;
    if (flush.rafId !== null) {
      cancelAnimationFrame(flush.rafId);
      flush.rafId = null;
    }
    flush.dirty.clear();
    const controller = runningSessionsRef.current.get(targetSessionId);
    if (controller) {
      controller.abort();
      runningSessionsRef.current.delete(targetSessionId);
      bumpRunningSessions();
    }
    const session = useChatSessionStore.getState().getSession(targetSessionId);
    if (session) {
      for (const m of session.messages) {
        if (m.isStreaming) {
          updateStoreMessage(targetSessionId, m.id, { isStreaming: false });
        }
      }
    }
  }, [bumpRunningSessions, updateStoreMessage]);

  useEffect(() => {
    return () => {
      const flush = tokenFlushRef.current;
      if (flush.rafId !== null) cancelAnimationFrame(flush.rafId);
    };
  }, []);

  type TauriAttachmentCandidate = {
    path: string;
    name?: string;
    size?: number;
    mimeType?: string;
    mime_type?: string;
  };

  const handleSelectAttachments = async () => {
    if (isLoading) return;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      antdMessage.warning(t('chat:attachments.tauriOnly', { defaultValue: '附件功能需要在桌面端使用。' }));
      return;
    }

    try {
      const selected = await invoke<TauriAttachmentCandidate[]>('select_chat_attachments');
      if (!selected || selected.length === 0) return;

      setPendingAttachments(prev => {
        const byPath = new Map(prev.map(attachment => [attachment.path, attachment]));
        for (const candidate of selected) {
          if (byPath.size >= MAX_ATTACHMENTS_PER_MESSAGE) {
            antdMessage.warning(t('chat:attachments.maxCount', {
              count: MAX_ATTACHMENTS_PER_MESSAGE,
              defaultValue: `每条消息最多添加 ${MAX_ATTACHMENTS_PER_MESSAGE} 个附件。`,
            }));
            break;
          }

          const attachment = createChatAttachment({
            path: candidate.path,
            name: candidate.name,
            size: candidate.size,
            mimeType: candidate.mimeType || candidate.mime_type,
          });
          const validation = validateAttachmentCandidate(attachment);
          if (!validation.ok && validation.reason === 'file_too_large') {
            antdMessage.warning(t('chat:attachments.fileTooLarge', {
              name: candidate.name || candidate.path,
              defaultValue: `文件过大：${candidate.name || candidate.path}`,
            }));
            continue;
          }
          if (!validation.ok) {
            antdMessage.warning(t('chat:attachments.unsupported', {
              name: candidate.name || candidate.path,
              defaultValue: `不支持的文件类型：${candidate.name || candidate.path}`,
            }));
            continue;
          }
          if (!attachment || byPath.has(attachment.path)) continue;
          byPath.set(attachment.path, attachment);
        }
        return Array.from(byPath.values());
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      antdMessage.error(t('chat:attachments.selectFailed', {
        message,
        defaultValue: `选择附件失败：${message}`,
      }));
    }
  };

  const handleRemovePendingAttachment = (id: string) => {
    setPendingAttachments(prev => prev.filter(attachment => attachment.id !== id));
  };

  const runWorkflowMessage = async (messageId: string, force = false) => {
    const pending = pendingWorkflowsRef.current[messageId];
    if (!pending) return;
    const sessionId = pending.sessionId;
    if (!sessionId) return;
    if (runningSessionsRef.current.has(sessionId) && !force) return;

    const eligibleMembers = currentAgents
      .filter((m): m is NonNullable<typeof m> => !!m && !mutedUsers.includes(m.id));

    const controller = new AbortController();
    runningSessionsRef.current.set(sessionId, controller);
    bumpRunningSessions();

    const agentMsgIds: Record<string, string> = {};
    const agentMsgContents: Record<string, string> = {};
    const updateWorkflowMessage = (run: AgentWorkflowRun) => {
      const sanitized = sanitizeWorkflowRunForStorage(cloneWorkflowRun(run));
      if (sanitized) {
        updateStoreMessage(sessionId, messageId, { workflowRun: sanitized });
      }
    };
    const preferMoreCompleteContent = (current: string, candidate: string): string => {
      const currentText = current || '';
      const candidateText = candidate || '';
      const currentTrimmed = currentText.trim();
      const candidateTrimmed = candidateText.trim();
      if (!candidateTrimmed) return currentText;
      if (!currentTrimmed) return candidateText;
      if (candidateTrimmed === currentTrimmed) return candidateText;
      if (candidateTrimmed.startsWith(currentTrimmed)) return candidateText;
      if (currentTrimmed.startsWith(candidateTrimmed)) return currentText;
      return candidateText.length > currentText.length + 64 ? candidateText : currentText;
    };

    const buildToolSessionKey = (agentId: string) => resolveCliToolSessionKey({
      developmentTaskId: pending.sessionId,
      templateId: group.id,
      agentId,
      workspacePath: group.workspacePath || '',
      sessionPolicy: 'task',
    });
    const toolSessionLookup = (agentId: string): string | null => {
      try {
        return localStorage.getItem(buildToolSessionKey(agentId));
      } catch {
        return null;
      }
    };

    const callbacks: AgentWorkflowRunnerCallbacks = {
      onRunStart: updateWorkflowMessage,
      onPlanUpdate: updateWorkflowMessage,
      onRunEnd: (run) => {
        updateWorkflowMessage(run);
        if (activeSessionIdRef.current !== sessionId) {
          markStoreSessionUnread(sessionId);
        }
      },
      onPhaseStart: () => {},
      onPhaseEnd: () => {},
      onAgentStart: (agentId, agentName, meta) => {
        const id = nextMsgId();
        agentMsgIds[agentId] = id;
        agentMsgContents[id] = '';
        const phaseLabel = meta?.phaseId
          ? pending.plan.phases.find(p => p.id === meta.phaseId)?.label
          : undefined;
        appendStoreMessage(sessionId, {
          id,
          sender: { id: agentId, name: agentName },
          content: '',
          isAI: true,
          isStreaming: true,
          agentTaskId: meta?.agentTaskId,
          adapter: meta?.adapter,
          phaseLabel,
        });
      },
      onToken: (agentId, token) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        const next = (agentMsgContents[msgId] || '') + token;
        agentMsgContents[msgId] = next;
        const flush = tokenFlushRef.current;
        flush.sessionId = sessionId;
        flush.dirty.set(msgId, next);
        if (flush.rafId === null) {
          flush.rafId = requestAnimationFrame(() => {
            const f = tokenFlushRef.current;
            f.rafId = null;
            for (const [id, content] of f.dirty) {
              updateStoreMessage(f.sessionId, id, { content });
            }
            f.dirty.clear();
          });
        }
      },
      onAgentEnd: (agentId, fullContent) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        tokenFlushRef.current.dirty.delete(msgId);
        const streamedContent = agentMsgContents[msgId] || '';
        const finalContent = preferMoreCompleteContent(streamedContent, fullContent || '');
        agentMsgContents[msgId] = finalContent;
        updateStoreMessage(sessionId, msgId, {
          content: finalContent,
          isStreaming: false,
        });
      },
      onError: (agentId, error) => {
        const msgId = agentMsgIds[agentId];
        if (!msgId) return;
        const errorContent = t('chat:errors.appendError', { error });
        agentMsgContents[msgId] = errorContent;
        tokenFlushRef.current.dirty.delete(msgId);
        updateStoreMessage(sessionId, msgId, {
          content: errorContent,
          isError: true,
          isStreaming: false,
        });
      },
      onInfo: (infoMsg) => {
        if (activeSessionIdRef.current === sessionId) {
          antdMessage.info(infoMsg);
        }
      },
      onToolSession: (agentId, adapter, toolSessionId) => {
        if (!supportsCliToolSession(adapter)) return;
        try {
          localStorage.setItem(buildToolSessionKey(agentId), toolSessionId);
        } catch { /* quota / private mode */ }
      },
    };

    try {
      await runAgentWorkflowPlan(group, eligibleMembers, pending.plan, pending.userMessage, callbacks, {
        signal: controller.signal,
        history: pending.history,
        toolSessionLookup,
        locale: i18n.language,
        summaryOptions: plannerSettings.mode === 'llm' && plannerSettings.providerId && plannerSettings.model
          ? {
              providerId: plannerSettings.providerId,
              model: plannerSettings.model,
              temperature: plannerSettings.temperature,
            }
          : undefined,
      });
      delete pendingWorkflowsRef.current[messageId];
      bumpPendingWorkflows();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        if (activeSessionIdRef.current === sessionId) {
          antdMessage.info(t('chat:agentChat.aborted', { defaultValue: '已停止生成' }));
        }
      } else {
        console.error('Agent workflow execution failed:', error);
        const errorMsg = error?.message || t('chat:errors.unknownError', { defaultValue: '未知错误' });
        if (activeSessionIdRef.current === sessionId) {
          antdMessage.error(t('chat:errors.strategyFailed', { defaultValue: `工作流执行失败: ${errorMsg}` }));
        }
        appendStoreMessage(sessionId, {
          id: nextMsgId(),
          sender: { id: '__system__', name: t('chat:agentChat.system', { defaultValue: '系统' }) },
          content: t('chat:errors.strategyFailed', { defaultValue: `工作流执行失败: ${errorMsg}` }),
          isAI: true,
          isError: true,
        });
      }
    } finally {
      runningSessionsRef.current.delete(sessionId);
      bumpRunningSessions();
      const session = useChatSessionStore.getState().getSession(sessionId);
      if (session) {
        for (const m of session.messages) {
          if (m.isStreaming) {
            updateStoreMessage(sessionId, m.id, { isStreaming: false });
          }
        }
      }
    }
  };

  const cancelWorkflowMessage = (messageId: string) => {
    const pending = pendingWorkflowsRef.current[messageId];
    let cancelSessionId: string | null = null;
    if (pending) {
      cancelSessionId = pending.sessionId;
      const controller = runningSessionsRef.current.get(pending.sessionId);
      if (controller) {
        controller.abort();
        runningSessionsRef.current.delete(pending.sessionId);
        bumpRunningSessions();
      }
    }
    delete pendingWorkflowsRef.current[messageId];
    bumpPendingWorkflows();
    if (!cancelSessionId) return;
    const session = useChatSessionStore.getState().getSession(cancelSessionId);
    if (!session) return;
    const stored = session.messages.find(m => String(m.id) === messageId);
    if (!stored?.workflowRun) return;
    const updatedRun: AgentWorkflowRun = {
      ...stored.workflowRun,
      status: 'cancelled',
      updatedAt: Date.now(),
    };
    const sanitized = sanitizeWorkflowRunForStorage(updatedRun);
    if (sanitized) {
      updateStoreMessage(cancelSessionId, messageId, { workflowRun: sanitized });
    }
  };

  const reviseWorkflowMessage = async (messageId: string, instruction: string) => {
    const pending = pendingWorkflowsRef.current[messageId];
    if (!pending || !instruction.trim()) return;
    if (revisingPlanIds.has(messageId)) return;
    setRevisingPlanIds(prev => {
      const next = new Set(prev);
      next.add(messageId);
      return next;
    });
    try {
      const eligibleMembers = currentAgents
        .filter((m): m is NonNullable<typeof m> => !!m && !mutedUsers.includes(m.id));
      const { plan, warnings } = await planAgentWorkflowSmart(
        {
          group,
          members: eligibleMembers,
          userMessage: pending.userMessage,
          history: pending.history,
          mentionedAgentIds: pending.mentionedAgentIds,
          revisionInstruction: instruction.trim(),
          workspaceReady: !!group.workspacePath?.trim(),
          t,
          locale: i18n.language,
        },
        buildPlannerSmartOptions(),
      );
      for (const w of warnings) antdMessage.warning(w);
      pendingWorkflowsRef.current[messageId] = {
        ...pending,
        plan,
        revisionInstruction: instruction.trim(),
      };
      bumpPendingWorkflows();
      const revisedRun = newAgentWorkflowRun(plan);
      const sanitizedRun = sanitizeWorkflowRunForStorage(revisedRun);
      const senderName = plan.plannerModel || activeSession?.messages.find(m => String(m.id) === messageId)?.sender?.name || '';
      updateStoreMessage(pending.sessionId, messageId, {
        sender: { id: '__workflow__', name: senderName },
        content: [instruction.trim(), ...warnings].join('\n'),
        workflowRun: sanitizedRun || revisedRun,
      });
    } catch (error: any) {
      console.error('Agent workflow revision failed:', error);
      const errorMsg = error?.message || t('chat:errors.unknownError', { defaultValue: '未知错误' });
      antdMessage.error(t('chat:errors.strategyFailed', { defaultValue: `工作流规划失败: ${errorMsg}` }));
    } finally {
      setRevisingPlanIds(prev => {
        if (!prev.has(messageId)) return prev;
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    }
  };

  const runWorkflowMessageRef = useRef(runWorkflowMessage);
  runWorkflowMessageRef.current = runWorkflowMessage;
  const cancelWorkflowMessageRef = useRef(cancelWorkflowMessage);
  cancelWorkflowMessageRef.current = cancelWorkflowMessage;
  const reviseWorkflowMessageRef = useRef(reviseWorkflowMessage);
  reviseWorkflowMessageRef.current = reviseWorkflowMessage;
  const stableRunWorkflowMessage = useCallback((messageId: string, force?: boolean) => {
    runWorkflowMessageRef.current(messageId, force);
  }, []);
  const stableCancelWorkflowMessage = useCallback((messageId: string) => {
    cancelWorkflowMessageRef.current(messageId);
  }, []);
  const stableReviseWorkflowMessage = useCallback((messageId: string, instruction: string) => {
    reviseWorkflowMessageRef.current(messageId, instruction);
  }, []);

  const handleSendMessage = async () => {
    if (isLoading) return;
    const attachmentsToSend = pendingAttachments;
    if (!inputMessage.trim() && attachmentsToSend.length === 0) return;

    const userName = userStore.userInfo.nickname || t('settings:aiGroup.selfName');
    const capturedInput = inputMessage;
    const agentInput = composeMessageWithAttachments(capturedInput, attachmentsToSend);

    const sessionId = ensureActiveSession(capturedInput || attachmentsToSend[0]?.name || t('chat:attachments.fallbackTitle', { defaultValue: '附件' }));
    if (!sessionId) return;

    const userMsgId = nextMsgId();
    shouldStickToBottomRef.current = true;
    appendStoreMessage(sessionId, {
      id: userMsgId,
      sender: { id: 'user', name: userName },
      content: capturedInput,
      isAI: false,
      attachments: attachmentsToSend,
    });
    setInputMessage('');
    setPendingAttachments([]);
    const planningController = new AbortController();
    runningSessionsRef.current.set(sessionId, planningController);
    bumpRunningSessions();

    const finishPlanning = () => {
      const current = runningSessionsRef.current.get(sessionId);
      if (current === planningController) {
        runningSessionsRef.current.delete(sessionId);
        bumpRunningSessions();
      }
    };

    const sessionForHistory = useChatSessionStore.getState().getSession(sessionId);
    const history = (sessionForHistory?.messages || [])
      .slice(-20)
      .map(m => {
        const attachmentSummary = formatAttachmentsForHistory(m.attachments);
        return `${m.sender.name}: ${[m.content, attachmentSummary].filter(Boolean).join('\n')}`;
      })
      .join('\n');

    const eligibleMembers = currentAgents
      .filter((m): m is NonNullable<typeof m> => !!m && !mutedUsers.includes(m.id));
    const mentionedAgentIds = extractMentionedCandidateIds(capturedInput, mentionCandidates);
    const llmPlannerActive = plannerSettings.mode === 'llm' && !!plannerSettings.providerId && !!plannerSettings.model;

    if (!llmPlannerActive) {
      const { plan } = planAgentWorkflow({
        group,
        members: eligibleMembers,
        userMessage: agentInput,
        history,
        mentionedAgentIds,
        workspaceReady: !!group.workspacePath?.trim(),
        t,
      });
      if (plan.phases.length === 0) {
        antdMessage.warning(t('chat:agentWorkflow.planner.warnings.noMembers', { defaultValue: '当前群聊没有可用的 agent 成员。' }));
        finishPlanning();
        return;
      }
      const containerMsgId = nextMsgId();
      pendingWorkflowsRef.current[containerMsgId] = {
        plan,
        userMessage: agentInput,
        history,
        sessionId,
        mentionedAgentIds,
      };
      bumpPendingWorkflows();
      const initialRun = newAgentWorkflowRun(plan);
      const sanitizedRun = sanitizeWorkflowRunForStorage(initialRun);
      appendStoreMessage(sessionId, {
        id: containerMsgId,
        sender: { id: '__workflow__', name: '' },
        content: '',
        isAI: true,
        hidden: true,
        workflowRun: sanitizedRun || initialRun,
      });
      finishPlanning();
      await runWorkflowMessage(containerMsgId, true);
      return;
    }

    const planningMsgId = nextMsgId();
    const plannerSenderName = plannerSettings.model || t('chat:agentWorkflow.sender', { defaultValue: '协作计划' });
    appendStoreMessage(sessionId, {
      id: planningMsgId,
      sender: { id: '__workflow__', name: plannerSenderName },
      content: t('chat:agentWorkflow.planning', { defaultValue: '正在生成协作计划…' }),
      isAI: true,
      isStreaming: true,
    });

    try {
      const { plan, warnings } = await planAgentWorkflowSmart(
        {
          group,
          members: eligibleMembers,
          userMessage: agentInput,
          history,
          mentionedAgentIds,
          workspaceReady: !!group.workspacePath?.trim(),
          t,
          locale: i18n.language,
        },
        buildPlannerSmartOptions(),
      );
      for (const w of warnings) antdMessage.warning(w);

      const plannedRun = newAgentWorkflowRun(plan);
      const sanitizedPlannedRun = sanitizeWorkflowRunForStorage(plannedRun);
      const approvalReason = getWorkflowPlanApprovalReason(plan);
      pendingWorkflowsRef.current[planningMsgId] = {
        plan,
        userMessage: agentInput,
        history,
        sessionId,
        mentionedAgentIds,
      };
      bumpPendingWorkflows();

      updateStoreMessage(sessionId, planningMsgId, {
        sender: { id: '__workflow__', name: plan.plannerModel || plannerSenderName },
        content: approvalReason || warnings.join('\n'),
        isStreaming: false,
        workflowRun: sanitizedPlannedRun || plannedRun,
      });

      if (approvalReason || group.workflowDefaults?.alwaysShowPlan || plannerSettings.alwaysConfirmBeforeRun) {
        finishPlanning();
        return;
      }

      finishPlanning();
      await runWorkflowMessage(planningMsgId, true);
    } catch (error: any) {
      console.error('Agent workflow planning failed:', error);
      const errorMsg = error?.message || t('chat:errors.unknownError', { defaultValue: '未知错误' });
      antdMessage.error(t('chat:errors.strategyFailed', { defaultValue: `工作流规划失败: ${errorMsg}` }));
      updateStoreMessage(sessionId, planningMsgId, {
        sender: { id: '__system__', name: t('chat:agentChat.system', { defaultValue: '系统' }) },
        content: t('chat:errors.strategyFailed', { defaultValue: `工作流规划失败: ${errorMsg}` }),
        isStreaming: false,
        isError: true,
      });
      finishPlanning();
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

        <ConversationSidebar
          isOpen={convSidebarOpen}
          toggleSidebar={() => setConvSidebarOpen(false)}
          sessions={groupSessions}
          selectedSessionId={activeSessionId}
          groupName={group.name}
          runningSessionIds={runningSessionIds}
          onSelectSession={handleSelectSession}
          onNewSession={startNewConversation}
          onRenameSession={renameChatSession}
          onDeleteSession={handleDeleteSession}
          onTogglePin={toggleChatSessionPinned}
          onToggleArchive={toggleChatSessionArchived}
        />

        <div className={styles.rightCol}>
          {!convSidebarOpen && (
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
                      {activeSession?.title || group.name}
                    </h1>
                    <span className={styles.memberCount}>
                      ({t('chat:agentChat.expertCount', { count: currentAgents.length })})
                    </span>
                  </div>
                  {workflowProgress && (
                    <div className={styles.titleProgress}>
                      <span className={styles.progressDot} />
                      <span>
                        {t('chat:agentChat.progressPhase', {
                          current: Math.min(workflowProgress.completed + (workflowProgress.runningPhaseLabel ? 1 : 0), workflowProgress.total),
                          total: workflowProgress.total,
                        })}
                      </span>
                      {workflowProgress.runningPhaseLabel && (
                        <span>· {workflowProgress.runningPhaseLabel}</span>
                      )}
                      {activeExpertsCount > 1 && (
                        <span>· {t('chat:agentChat.expertsAnalyzing', { count: activeExpertsCount })}</span>
                      )}
                    </div>
                  )}
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
                {currentAgents.length > 0 && !hasUnresolvedMembers && (
                  <div className={styles.suggestionWrap}>
                    <span className={styles.suggestionLabel}>{t('chat:agentChat.suggestionsLabel')}</span>
                    <div className={styles.suggestionChips}>
                      {[1, 2, 3].map(n => (
                        <button
                          key={n}
                          type="button"
                          className={styles.suggestionChip}
                          onClick={() => setInputMessage(t(`chat:agentChat.suggestion${n}`))}
                        >
                          {t(`chat:agentChat.suggestion${n}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className={styles.messageList}>
              {messages.map((message) => (
                <AgentMessageItem
                  key={message.id}
                  message={message}
                  members={members}
                  userName={userName}
                  userAvatarDisplaySrc={userStore.avatarDisplaySrc || userStore.userInfo?.avatar_url}
                  basePath={group.workspacePath}
                  hideMessageDetails={group.debugMode !== true}
                  mentionNames={mentionNames}
                  isPendingPlan={pendingPlanIds.has(String(message.id))}
                  isRevisingPlan={revisingPlanIds.has(String(message.id))}
                  onRun={stableRunWorkflowMessage}
                  onCancel={stableCancelWorkflowMessage}
                  onRevise={stableReviseWorkflowMessage}
                  onLogClick={setLogTarget}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Scroll-to-bottom floating button */}
          {showJumpToBottom && (
            <button
              type="button"
              className={styles.jumpButton}
              onClick={handleJumpToBottom}
              aria-label={t('chat:agentChat.scrollToBottom')}
              title={t('chat:agentChat.scrollToBottom')}
            >
              <ChevronDown size={16} />
              {missedMessageCount > 0 && (
                <span className={styles.jumpBadge}>{missedMessageCount}</span>
              )}
            </button>
          )}


          {/* Input Area */}
          <div className={styles.inputArea}>
            <ChatAttachmentList
              pending
              attachments={pendingAttachments}
              onRemove={handleRemovePendingAttachment}
            />
            <div className={styles.composeShell}>
              <AntdButton
                type="text"
                onClick={handleSelectAttachments}
                icon={<Paperclip size={16} />}
                disabled={isLoading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                aria-label={t('chat:attachments.add', { defaultValue: '添加附件' })}
                title={t('chat:attachments.add', { defaultValue: '添加附件' })}
              />
              <MentionTextArea
                value={inputMessage}
                onChange={setInputMessage}
                candidates={mentionCandidates}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  // 输入法组词（中文/日文等）回车确认，不应触发发送
                  if (e.nativeEvent && (e.nativeEvent as KeyboardEvent).isComposing) return;
                  if (e.keyCode === 229) return;
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                autoSize={{ minRows: 1, maxRows: 6 }}
                placeholder={t('chat:agentChat.inputPlaceholder')}
                containerStyle={{ flex: 1, minWidth: 0 }}
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
                  disabled={!inputMessage.trim() && pendingAttachments.length === 0}
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

      <CLITaskLogModal
        open={!!logTarget}
        onOpenChange={(open) => { if (!open) setLogTarget(null); }}
        agentTaskId={logTarget?.agentTaskId ?? null}
        agentName={logTarget?.agentName}
        adapter={logTarget?.adapter}
      />
    </>
  );
};

export default AgentChatUI;
