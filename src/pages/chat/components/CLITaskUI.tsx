/**
 * CLI 开发任务 UI — 以任务为主对象的聊天界面
 * Phase 1: 团队模板来自 CLIGroup，任务消息本地持久化，执行走 executeCLIStrategy
 */
import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PanelLeftOpen,
  Terminal,
  Info,
  GitCompare,
  FolderOpen,
  FolderPlus,
  Plus,
  Loader2,
} from 'lucide-react';
import { Input as AntdInput, Button as AntdButton, Tag, Modal, Select, Tooltip } from 'antd';
import { ActionIcon, Avatar as LobeAvatar } from '@lobehub/ui';
import { ChatInputArea } from '@lobehub/ui/chat';
import { createStyles } from 'antd-style';
import {
  BRAND_ON_PRIMARY,
  BRAND_PRIMARY,
  BRAND_PRIMARY_HOVER,
  brandPrimaryButtonProps,
  brandPrimaryButtonStyle,
} from '@/lib/theme';
import { request } from '@/utils/request';
import { executeCLIStrategy } from '@/engine/cliEngine';
import { decideCliPreflight } from '@/engine/cliPreflight';
import { isCodeChangeIntent } from '@/engine/cliIntent';
import { buildCliUserPrompt } from '@/engine/cliPrompt';
import { resolveCliToolSessionKey, withCliToolSession } from '@/engine/cliToolSessions';
import type { CLIAgent } from '@/config/aiCharacters';
import { mapAIMemberToLegacy } from '@/config/aiCharacters';
import { ChatMarkdown } from '@/components/Markdown';
import CLIGroupSettings from './CLIGroupSettings';
import CLITaskInfoPanel from './CLITaskInfoPanel';
import CLITemplateListPanel from './CLITemplateListPanel';
import CLIRaceResultsDrawer from './CLIRaceResultsDrawer';
import CLITaskLogModal from './CLITaskLogModal';
import CLITaskSidebar from './CLITaskSidebar';
import CreateGroupWizard from './CreateGroupWizard';
import {
  MentionSuggestionPanel,
  MentionTextArea,
  useMentionAutocomplete,
} from './MentionAutocomplete';
import Sidebar from './Sidebar';
import { AdBanner, AdBannerMobile } from './AdSection';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { AppSettingsModal } from './AppSettingsModal';
import type { AppSettingsSection } from '@/config/appSettings';
import { useAIMemberStore } from '@/store/aiMemberStore';
import { getAvatarData, resolveAvatarByName } from '@/utils/avatar';
import { resolveEffectiveMember } from '@/utils/aiMemberDisplay';
import { shouldBlockMentionAutocompleteSend } from '@/utils/mentionAutocomplete';
import type { Group, CLIGroup } from '@/config/groups';
import { resolveExecutionPlan } from '@/config/groups';
import {
  templateSnapshotToCLIGroup,
  cliTaskMemberSnapshotToAgent,
  createCLITaskMemberSnapshots,
  parseAgentMention,
  getLatestAgentRoundMessages,
  inferCliModelFromArgs,
  isRaceTask,
  getRaceWorktreeEntries,
  canMutateTask,
  type CLIDevelopmentTask,
  type CLITaskStatus,
} from '@/config/cliTasks';
import {
  useCLITaskStore,
  getTeamTemplatesFromGroups,
  taskMessageToChatRow,
} from '@/store/cliTaskStore';
import {
  scheduleCLITaskTitleSync,
  scheduleOpenCodeTaskTitleSync,
} from '@/utils/opencodeSessionTitle';
import { openPath } from '@tauri-apps/plugin-opener';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import {
  readLastCliWorkspace,
  writeLastCliWorkspace,
  resolveDraftCliWorkspace,
  parentDirectoryPath,
  defaultNewWorkspaceFolderName,
} from '@/utils/cliWorkspaceStorage';
import { getCLIWorkflowLabel } from '@/config/groupProduct';
import { adapterUsesOpenCodeSessionTitle, supportsCliToolSession } from '@/config/cliAdapters';
import { saveLastView } from '@/utils/lastViewStorage';
import { reconstructCliOutputFromLogEntries } from '@/utils/cliLogOutput';

interface CLITaskUIProps {
  groups: Group[];
  cliGroups: CLIGroup[];
  selectedGroupIndex: number;
  onSelectGroup: (index: number) => void;
  onCreateGroup?: (group: Group) => void;
  onUpdateCLIGroup?: (group: CLIGroup) => void;
  onDeleteCLIGroup?: (templateId: string) => void;
  onNavigateHome?: () => void;
  initialTaskId?: string | null;
}

const DRAFT_COMPOSE_KEY = '__draft__';

const resolveComposeKey = (taskId: string | null) => taskId ?? DRAFT_COMPOSE_KEY;

const splitAgentDisplayName = (name: string, stageLabel?: string) => {
  const marker = stageLabel ? ` · ${stageLabel}` : '';
  if (marker && name.endsWith(marker)) {
    return { baseName: name.slice(0, -marker.length), stageName: stageLabel };
  }
  const parts = name.split(' · ');
  return parts.length > 1
    ? { baseName: parts[0], stageName: parts.slice(1).join(' · ') }
    : { baseName: name, stageName: stageLabel };
};

const appendCliModelHint = (baseName: string, modelHint?: string) => {
  if (!modelHint || baseName.includes(` · ${modelHint}`)) return baseName;
  return `${baseName} · ${modelHint}`;
};

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
  taskSidebarExpandHandle: css`
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
  `,
  headerTitleRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  `,
  headerActions: css`
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    min-width: 0;
    flex: 1 1 auto;
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
  composeBox: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    overflow: hidden;
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    transition: border-color 0.2s, box-shadow 0.2s;
    &:focus-within {
      border-color: #ff6600;
      box-shadow: 0 0 0 2px rgba(255, 102, 0, 0.12);
    }
  `,
  composeTextarea: css`
    textarea {
      border: none !important;
      box-shadow: none !important;
      resize: none;
      padding: 10px 12px 4px !important;
      background: transparent !important;
    }
  `,
  composeHint: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    line-height: 1.4;
  `,
  composeSendBar: css`
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px 10px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
  composeSendBarLeft: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
  `,
  composeSendBarRight: css`
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  `,
  composeBrandBtn: css`
    &&& {
      background: ${BRAND_PRIMARY} !important;
      border-color: ${BRAND_PRIMARY} !important;
      color: ${BRAND_ON_PRIMARY} !important;
      border-radius: 7px;
      box-shadow: none;

      &,
      & * {
        color: ${BRAND_ON_PRIMARY} !important;
      }

      &:hover:not(:disabled) {
        background: ${BRAND_PRIMARY_HOVER} !important;
        border-color: ${BRAND_PRIMARY_HOVER} !important;
        color: ${BRAND_ON_PRIMARY} !important;
      }

      &:disabled {
        background: ${BRAND_PRIMARY} !important;
        border-color: ${BRAND_PRIMARY} !important;
        opacity: 0.65;
      }
    }
  `,
  composeBtnSpin: css`
    animation: cliComposeBtnSpin 0.9s linear infinite;
    @keyframes cliComposeBtnSpin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
  `,
  composeWorkspaceRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid ${token.colorBorderSecondary};
    flex-wrap: wrap;
  `,
  composeWorkspaceLabel: css`
    font-size: 11px;
    font-weight: 500;
    color: ${token.colorTextSecondary};
    flex: none;
  `,
  composeWorkspaceInput: css`
    flex: 1;
    min-width: 160px;
    font-family: ${token.fontFamilyCode} !important;
    font-size: 12px !important;
  `,
  cliWorktreeInfo: css`
    margin-top: 8px;
    padding: 8px 10px;
    background: ${token.colorFillTertiary};
    border-radius: 8px;
    font-size: 11px;
    color: ${token.colorTextSecondary};
    display: flex;
    flex-direction: column;
    gap: 4px;
    word-break: break-all;
  `,
  cliWorktreePath: css`
    font-family: var(--ant-font-family-code);
    font-size: 11px;
    color: ${token.colorTextSecondary};
    word-break: break-all;
  `,
  cliWorktreeActionBtn: css`
    align-self: flex-start;
    padding: 0 8px;
    height: 22px;
    line-height: 22px;
    font-size: 11px;
    background: transparent;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 6px;
    cursor: pointer;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  bubbleUser: css`
    background: #ff6600;
    color: #fff;
    border: 1px solid rgba(194, 65, 12, 0.22);
    border-radius: 8px;
    border-top-right-radius: 4px;
    padding: 9px 12px;
    margin-top: 4px;
    text-align: left;
    line-height: 1.58;
  `,
  bubbleAI: css`
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    border-top-left-radius: 4px;
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
  typingCursor: css`
    margin-left: 4px;
    color: #ff6600;
  `,
  emptyState: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 80px 24px;
    color: ${token.colorTextTertiary};
    text-align: center;
    gap: 12px;
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
    min-width: 0;
    max-width: 300px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    @media (min-width: 640px) {
      max-width: 520px;
    }
  `,
  streaming: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    color: #f97316;
  `,
  streamingDot: css`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f97316;
    animation: pulse 1s infinite;
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
  `,
  cliTaskFooter: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid ${token.colorBorderSecondary};
    font-size: 11px;
    gap: 16px;
  `,
  cliTaskStatus: css`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 500;
  `,
  cliActionBtnRetry: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: ${token.colorPrimary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
  `,
  cliActionBtnCancel: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: #ff4d4f;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
  `,
  cliActionBtnLog: css`
    padding: 0 6px;
    height: 18px;
    font-size: 10px;
    background: transparent;
    color: ${token.colorTextSecondary};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 3px;
    cursor: pointer;
  `,
  cliTaskActions: css`
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
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
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
  mobileOverlay: css`
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10;
    @media (min-width: 768px) { display: none; }
  `,
  desktopOnly: css`
    @media (max-width: 767px) { display: none; }
  `,
  mobileOnly: css`
    @media (min-width: 768px) { display: none; }
  `,
  creationFormContainer: css`
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 20px 0;
    min-height: 100%;
  `,
  creationFormCard: css`
    width: 100%;
    max-width: 680px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    box-shadow: none;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  `,
  creationHeader: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    padding-bottom: 16px;
  `,
  creationTitle: css`
    font-size: 18px;
    font-weight: 600;
    color: ${token.colorText};
    margin: 0;
  `,
  creationSubtitle: css`
    font-size: 12px;
    color: ${token.colorTextTertiary};
  `,
  formField: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
  `,
  formFieldHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  formLabel: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorTextSecondary};
  `,
  templateGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin-top: 4px;
  `,
  templateCard: css`
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    padding: 12px;
    background: ${token.colorFillQuaternary};
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    flex-direction: column;
    gap: 6px;
    position: relative;
    &:hover {
      border-color: rgba(255, 102, 0, 0.35);
      background: ${token.colorFillTertiary};
    }
  `,
  templateCardActive: css`
    border-color: #ff6600 !important;
    background: rgba(255, 102, 0, 0.04) !important;
    box-shadow: 0 0 0 2px rgba(255, 102, 0, 0.1);
  `,
  templateCardTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  templateCardMeta: css`
    font-size: 10px;
    color: ${token.colorTextTertiary};
    display: flex;
    align-items: center;
    gap: 6px;
  `,
  templateMemberRow: css`
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 2px;
  `,
  templateMemberChip: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px 2px 3px;
    border-radius: 999px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    font-size: 10px;
    font-weight: 500;
    color: ${token.colorText};
    max-width: 100%;
  `,
  templateMemberName: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 88px;
  `,
  templateCardDesc: css`
    font-size: 11px;
    color: ${token.colorTextSecondary};
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  `,
  templateEmpty: css`
    border: 1px dashed ${token.colorBorder};
    border-radius: 12px;
    padding: 24px;
    text-align: center;
    color: ${token.colorTextTertiary};
    font-size: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  `,
  workspaceRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
  `,
  workspaceInput: css`
    font-family: ${token.fontFamilyCode} !important;
    font-size: 12px !important;
  `,
  submitBtnRow: css`
    margin-top: 12px;
    border-top: 1px solid ${token.colorBorderSecondary};
  `,
}));

const CLITaskUI = ({
  groups,
  cliGroups,
  selectedGroupIndex,
  onSelectGroup,
  onCreateGroup,
  onUpdateCLIGroup,
  onDeleteCLIGroup,
  onNavigateHome,
  initialTaskId,
}: CLITaskUIProps) => {
  const { t } = useTranslation(['cli', 'common', 'product', 'settings']);
  const userStore = useUserStore();
  const isMobile = useIsMobile();
  const { styles, cx } = useStyles();
  const aiMembers = useAIMemberStore(s => s.members);
  const { load: loadAIMembers } = useAIMemberStore();

  const tasks = useCLITaskStore(s => s.tasks);
  const createTask = useCLITaskStore(s => s.createTask);
  const updateTask = useCLITaskStore(s => s.updateTask);
  const appendMessage = useCLITaskStore(s => s.appendMessage);
  const updateMessage = useCLITaskStore(s => s.updateMessage);
  const archiveTask = useCLITaskStore(s => s.archiveTask);
  const restoreTask = useCLITaskStore(s => s.restoreTask);
  const deleteTask = useCLITaskStore(s => s.deleteTask);

  const templates = useMemo(() => getTeamTemplatesFromGroups(cliGroups), [cliGroups]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId || null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(templates[0]?.id || '');
  const [draftWorkspacePath, setDraftWorkspacePath] = useState(() => readLastCliWorkspace());
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceParent, setCreateWorkspaceParent] = useState('');
  const [createWorkspaceName, setCreateWorkspaceName] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [executingTaskIds, setExecutingTaskIds] = useState<Set<string>>(() => new Set());
  const [isStopping, setIsStopping] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(!isMobile);
  const [taskSidebarOpen, setTaskSidebarOpen] = useState(!isMobile);
  const [taskInfoOpen, setTaskInfoOpen] = useState(false);
  const [templateSettingsOpen, setTemplateSettingsOpen] = useState(false);
  const [templateListOpen, setTemplateListOpen] = useState(false);
  const [templateSettingsReturnTo, setTemplateSettingsReturnTo] = useState<'template-list' | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [forkModalOpen, setForkModalOpen] = useState(false);
  const [forkTemplateId, setForkTemplateId] = useState('');
  const [createTemplateOpen, setCreateTemplateOpen] = useState(false);
  const [raceDrawerOpen, setRaceDrawerOpen] = useState(false);
  const [logTarget, setLogTarget] = useState<{
    agentTaskId: string;
    messageId: string;
    agentName: string;
    adapter?: string;
    prompt?: string;
    status?: string;
  } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<AppSettingsSection>('general');
  const [showAd, setShowAd] = useState(false);
  const [mutedUsers, setMutedUsers] = useState<string[]>([]);

  const chatAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const executionControllersRef = useRef(new Map<string, AbortController>());
  const hydratedLogMessageIdsRef = useRef(new Set<string>());

  const selectedTask = tasks.find(t => t.id === selectedTaskId) || null;
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];
  const draftTemplate = selectedTemplate;
  const composeKey = resolveComposeKey(selectedTaskId);
  const isComposeBusy = executingTaskIds.has(composeKey);

  useEffect(() => {
    if (selectedTaskId) return;
    setDraftWorkspacePath((prev) => {
      if (prev.trim()) return prev;
      return resolveDraftCliWorkspace(draftTemplate?.workspacePath);
    });
  }, [selectedTaskId, selectedTemplateId, draftTemplate?.workspacePath]);

  const handleDraftWorkspaceChange = (path: string) => {
    setDraftWorkspacePath(path);
    writeLastCliWorkspace(path);
  };

  const handleSelectDraftWorkspace = async () => {
    try {
      const selected = await invoke<string | null>('select_directory');
      if (selected) handleDraftWorkspaceChange(selected);
    } catch (e) {
      console.error('Failed to select directory:', e);
    }
  };

  const openCreateWorkspaceModal = () => {
    const current = draftWorkspacePath.trim();
    const parent = parentDirectoryPath(current) || current;
    setCreateWorkspaceParent(parent);
    setCreateWorkspaceName(defaultNewWorkspaceFolderName());
    setCreateWorkspaceOpen(true);
  };

  const handleSelectCreateWorkspaceParent = async () => {
    try {
      const selected = await invoke<string | null>('select_directory');
      if (selected) setCreateWorkspaceParent(selected);
    } catch (e) {
      console.error('Failed to select parent directory:', e);
    }
  };

  const handleCreateWorkspaceDirectory = async () => {
    const parent = createWorkspaceParent.trim();
    const name = createWorkspaceName.trim();
    if (!parent) {
      toast.error(t('cli:taskUI.toast.workspaceParentRequired'));
      return;
    }
    if (!name) {
      toast.error(t('cli:taskUI.toast.workspaceNameRequired'));
      return;
    }
    if (/[\\/]/.test(name)) {
      toast.error(t('cli:taskUI.toast.workspaceNameInvalid'));
      return;
    }

    setCreatingWorkspace(true);
    try {
      const created = await invoke<string>('create_workspace_directory', { parent, name });
      handleDraftWorkspaceChange(created);
      setCreateWorkspaceOpen(false);
      toast.success(t('cli:taskUI.toast.workspaceCreated'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('cli:taskUI.toast.workspaceCreateFailed'));
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const createWorkspacePreview = useMemo(() => {
    const parent = createWorkspaceParent.trim().replace(/\\/g, '/').replace(/\/+$/, '');
    const name = createWorkspaceName.trim();
    if (!parent || !name) return '';
    return `${parent}/${name}`;
  }, [createWorkspaceParent, createWorkspaceName]);

  const beginTaskExecution = useCallback((key: string) => {
    setExecutingTaskIds(prev => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const endTaskExecution = useCallback((key: string) => {
    setExecutingTaskIds(prev => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const transferTaskExecution = useCallback((from: string, to: string) => {
    setExecutingTaskIds(prev => {
      const next = new Set(prev);
      next.delete(from);
      next.add(to);
      return next;
    });
    const controller = executionControllersRef.current.get(from);
    if (controller) {
      executionControllersRef.current.delete(from);
      executionControllersRef.current.set(to, controller);
    }
  }, []);

  const workspacePath = selectedTask
    ? selectedTask.workspacePath
    : draftWorkspacePath;

  const userName = userStore.userInfo.nickname || t('settings:aiGroup.selfName');

  const chatMessages = useMemo(() => {
    if (!selectedTask) return [];
    return selectedTask.messages.map(m => taskMessageToChatRow(m, userName));
  }, [selectedTask, userName]);

  const editingCLIGroup = editingTemplateId
    ? cliGroups.find(g => g.id === editingTemplateId) || null
    : null;
  const editingTemplateMembers = (editingCLIGroup?.memberIds || [])
    .map(id => resolveEffectiveMember(aiMembers, id))
    .filter(m => m && m.kind === 'cli')
    .map(m => mapAIMemberToLegacy(m) as CLIAgent);

  const taskCountByTemplate = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const task of tasks) {
      counts[task.templateId] = (counts[task.templateId] || 0) + 1;
    }
    return counts;
  }, [tasks]);

  const raceEntries = useMemo(() => {
    if (!selectedTask || !isRaceTask(selectedTask)) return [];
    return getRaceWorktreeEntries(selectedTask, workspacePath);
  }, [selectedTask, workspacePath]);

  useEffect(() => { loadAIMembers(); }, [loadAIMembers]);
  useEffect(() => { if (isMobile !== undefined) { setSidebarOpen(!isMobile); setTaskSidebarOpen(!isMobile); } }, [isMobile]);

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
  }, [selectedTaskId]);

  useEffect(() => {
    if (shouldStickToBottomRef.current) {
      scrollMessagesToBottom('smooth');
    }
  }, [chatMessages]);

  useEffect(() => {
    if (!selectedTask) return;
    const emptyLoggedMessages = selectedTask.messages.filter(message =>
      message.role === 'agent'
      && !!message.agentTaskId
      && !message.content.trim()
      && message.status !== 'running'
    );
    if (emptyLoggedMessages.length === 0) return;

    let cancelled = false;
    const includeStderr = selectedTask.templateSnapshot.showStderr !== false;

    emptyLoggedMessages.forEach((message) => {
      const hydrateKey = `${selectedTask.id}:${message.id}:${message.agentTaskId}`;
      if (hydratedLogMessageIdsRef.current.has(hydrateKey)) return;
      hydratedLogMessageIdsRef.current.add(hydrateKey);

      void (async () => {
        try {
          const res = await request(`/api/cli/tasks/log?taskId=${encodeURIComponent(message.agentTaskId!)}`);
          const json = await res.json();
          const lines = Array.isArray(json?.data?.lines) ? json.data.lines : [];
          const output = reconstructCliOutputFromLogEntries(lines, { includeStderr });
          if (!cancelled && output) {
            updateMessage(selectedTask.id, message.id, { content: output });
          }
        } catch {
          // Historical hydration is best-effort; the log modal remains available for diagnosis.
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [selectedTask, updateMessage]);

  // 仅在外部 URL 的 taskId 变化时同步选中项；tasks 更新时不应覆盖用户在侧栏的手动选择
  // （navigateToTask 用 replaceState 更新 URL，不会触发 ChatUI 重渲染，initialTaskId 可能滞后）
  const lastSyncedInitialTaskIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (initialTaskId === lastSyncedInitialTaskIdRef.current) return;
    lastSyncedInitialTaskIdRef.current = initialTaskId;
    if (initialTaskId && tasks.some(t => t.id === initialTaskId)) {
      setSelectedTaskId(initialTaskId);
    }
  }, [initialTaskId, tasks]);

  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  const navigateToTask = (taskId: string) => {
    setSelectedTaskId(taskId);
    const search = `?view=cli-task&taskId=${encodeURIComponent(taskId)}`;
    window.history.replaceState({}, '', search);
    saveLastView(search);
  };

  const navigateToList = () => {
    setSelectedTaskId(null);
    setInputMessage('');
    closeManagementPanels();
    window.history.replaceState({}, '', '?view=cli-tasks');
    saveLastView('?view=cli-tasks');
  };

  const startNewTask = () => {
    setSelectedTaskId(null);
    setInputMessage('');
    navigateToList();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const getSessionKey = useCallback((developmentTask: CLIDevelopmentTask, agentId: string) => {
    const snapshot = developmentTask.templateSnapshot;
    const ws = developmentTask.workspacePath || snapshot.workspacePath || '';
    return resolveCliToolSessionKey({
      developmentTaskId: developmentTask.id,
      templateId: snapshot.id,
      agentId,
      workspacePath: ws,
      sessionPolicy: snapshot.sessionPolicy,
    });
  }, []);

  const runExecution = async (
    developmentTask: CLIDevelopmentTask,
    promptText: string,
    retryAgentId?: string,
    execKeyOverride?: string,
  ) => {
    const snapshot = developmentTask.templateSnapshot;
    const execGroup = templateSnapshotToCLIGroup(snapshot);
    const ws = developmentTask.workspacePath || snapshot.workspacePath || '';

    const snapshotAgents = developmentTask.memberSnapshots?.length
      ? developmentTask.memberSnapshots.map(memberSnapshot => cliTaskMemberSnapshotToAgent(memberSnapshot) as CLIAgent)
      : null;
    const memberIds = snapshot.memberIds;
    let activeAgents = snapshotAgents || memberIds
      .map(id => resolveEffectiveMember(aiMembers, id))
      .filter(m => m && m.kind === 'cli')
      .map(m => mapAIMemberToLegacy(m) as CLIAgent);

    activeAgents = activeAgents.filter(agent => !mutedUsers.includes(agent.id));

    if (retryAgentId) {
      activeAgents = activeAgents.filter(a => a.id === retryAgentId);
    }

    activeAgents = activeAgents.map(agent => withCliToolSession(
      agent,
      localStorage.getItem(getSessionKey(developmentTask, agent.id)),
    ));

    if (activeAgents.length === 0) {
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: t('cli:taskUI.system.noAgents'),
        isError: true,
      });
      return;
    }

    const taskPrompt = buildCliUserPrompt(promptText, ws);

    if (snapshot.strategy === 'discussion' && isCodeChangeIntent(promptText)) {
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: t('cli:taskUI.system.discussionReadOnly'),
        isError: true,
      });
      return;
    }

    // 发送前 pre-flight：本地未安装对应 CLI 时的处理
    // - 独立模式（router/race/sequential/mapreduce）：自动跳过未安装成员，用其余成员继续
    // - 角色型（pipeline/review/discussion）：任一缺失则整单拦截
    const interchangeable =
      resolveExecutionPlan({ strategy: snapshot.strategy, executionPlan: snapshot.executionPlan })
        .collaboration === 'independent';
    const preflight = await decideCliPreflight(activeAgents, { interchangeable });
    if (preflight.message) {
      const blocked = preflight.action === 'block';
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: preflight.message,
        isError: preflight.isError,
        ...(blocked ? { status: 'failed' as CLITaskStatus } : {}),
      });
    }
    if (preflight.action === 'block') {
      return;
    }
    activeAgents = preflight.agents;

    if (snapshot.approvalMode === 'ask') {
      const names = activeAgents.map(a => a.name).join('、');
      const confirmed = window.confirm(
        t('cli:taskUI.system.approvalConfirm', {
          names,
          workspace: ws || t('cli:taskUI.system.defaultWorkspace'),
        }),
      );
      if (!confirmed) return;
    }

    updateTask(developmentTask.id, { status: 'running' });

    const customGroup: CLIGroup = {
      ...execGroup,
      strategy: snapshot.strategy,
      timeout: snapshot.timeout,
      approvalMode: snapshot.approvalMode,
      showStderr: snapshot.showStderr,
      executionPlan: snapshot.executionPlan,
      reviewLoopRoles: snapshot.reviewLoopRoles,
    };

    const messageIdByAgentTask = new Map<string, string>();
    const agentIdByAgentTask = new Map<string, string>();
    const opencodeSessionByAgentTask = new Map<string, string>();
    const openCodeLedThisRun = activeAgents.length > 0 && adapterUsesOpenCodeSessionTitle(activeAgents[0].cli?.adapter);
    const resolveRuntimeMember = (agentId: string) => {
      const memberSnapshot = developmentTask.memberSnapshots?.find(member => member.id === agentId);
      if (memberSnapshot) {
        return { kind: 'cli', cli: memberSnapshot.cli };
      }
      return resolveEffectiveMember(aiMembers, agentId);
    };

    const flushOpenCodeTitleSync = () => {
      const seen = new Set<string>();
      const schedule = (agentId: string, sessionId: string) => {
        const key = `${agentId}:${sessionId}`;
        if (seen.has(key)) return;
        seen.add(key);
        scheduleOpenCodeTaskTitleSync({
          taskId: developmentTask.id,
          agentId,
          sessionId,
          openCodeLedThisRun,
          getTask: () => useCLITaskStore.getState().getTask(developmentTask.id),
          resolveMember: resolveRuntimeMember,
          updateTask,
        });
      };

      for (const [agentTaskId, sessionId] of opencodeSessionByAgentTask.entries()) {
        const agentId = agentIdByAgentTask.get(agentTaskId);
        if (agentId && sessionId) schedule(agentId, sessionId);
      }

      const latestTask = useCLITaskStore.getState().getTask(developmentTask.id);
      latestTask?.messages.forEach(message => {
        if (message.agentId && message.toolSessionId) {
          schedule(message.agentId, message.toolSessionId);
        }
      });
    };

    const execKey = execKeyOverride ?? resolveComposeKey(developmentTask.id);
    const abortController = new AbortController();
    executionControllersRef.current.set(execKey, abortController);

    try {
      await executeCLIStrategy(
        customGroup,
        activeAgents,
        taskPrompt,
        ws,
        {
          onAgentStart: (agentTaskId, agentId, agentName, meta) => {
            if (abortController.signal.aborted) return;
            agentIdByAgentTask.set(agentTaskId, agentId);
            const agentInfo = activeAgents.find(agent => agent.id === agentId);
            const baseName = agentInfo?.name || agentName;
            const msgId = `msg-${agentTaskId}`;
            messageIdByAgentTask.set(agentTaskId, msgId);

            appendMessage(developmentTask.id, {
              id: msgId,
              taskId: developmentTask.id,
              role: 'agent',
              agentId,
              agentName: meta?.stageLabel ? `${baseName} · ${meta.stageLabel}` : baseName,
              content: '',
              status: 'running',
              agentTaskId,
              prompt: taskPrompt,
              stageLabel: meta?.stageLabel,
              cliCwd: meta?.cwd,
              cliBranch: meta?.branch,
              baseSha: meta?.baseSha,
            });

            const currentTask = useCLITaskStore.getState().getTask(developmentTask.id);
            updateTask(developmentTask.id, {
              agentTaskIds: [...(currentTask?.agentTaskIds || []), agentTaskId],
            });
          },
          onToolSession: (agentTaskId, agentId, adapter, sessionId) => {
            if (abortController.signal.aborted) return;
            if (supportsCliToolSession(adapter)) {
              localStorage.setItem(getSessionKey(developmentTask, agentId), sessionId);
            }
            if (adapterUsesOpenCodeSessionTitle(adapter)) {
              opencodeSessionByAgentTask.set(agentTaskId, sessionId);
              const msgId = messageIdByAgentTask.get(agentTaskId);
              if (msgId) {
                updateMessage(developmentTask.id, msgId, { toolSessionId: sessionId });
              }
            }
          },
          onToken: (agentTaskId, token) => {
            if (abortController.signal.aborted) return;
            const msgId = messageIdByAgentTask.get(agentTaskId);
            if (!msgId) return;
            const task = useCLITaskStore.getState().getTask(developmentTask.id);
            const msg = task?.messages.find(m => m.id === msgId);
            if (msg) {
              updateMessage(developmentTask.id, msgId, { content: msg.content + token });
            }
          },
          onAgentEnd: (agentTaskId, fullContent) => {
            if (abortController.signal.aborted) return;
            const msgId = messageIdByAgentTask.get(agentTaskId);
            if (!msgId) return;
            const task = useCLITaskStore.getState().getTask(developmentTask.id);
            const msg = task?.messages.find(m => m.id === msgId);
            let finalContent = (msg?.content?.length || 0) > fullContent.length
              ? msg.content
              : fullContent;
            if (finalContent.includes('<details open>')) {
              finalContent = finalContent.replace(/<details open>/g, '<details>');
            }
            updateMessage(developmentTask.id, msgId, {
              content: finalContent,
              status: 'completed',
            });
          },
          onError: (agentTaskId, error) => {
            if (abortController.signal.aborted) return;
            const msgId = messageIdByAgentTask.get(agentTaskId);
            if (!msgId) return;
            const task = useCLITaskStore.getState().getTask(developmentTask.id);
            const msg = task?.messages.find(m => m.id === msgId);
            const normalized = String(error || '').toLowerCase();
            const status = normalized.includes('timeout')
              ? 'timeout' as const
              : normalized.includes('cancel')
                ? 'cancelled' as const
                : 'failed' as const;
            updateMessage(developmentTask.id, msgId, {
              content: msg?.content
                ? msg.content + `\n\n${t('cli:taskUI.system.errorPrefix', { error })}`
                : t('cli:taskUI.system.errorPrefix', { error }),
              status,
              isError: true,
            });
          },
        },
        {
          timeoutMs: snapshot.timeout,
          approvalMode: snapshot.approvalMode,
          showStderr: snapshot.showStderr,
          signal: abortController.signal,
        },
      );
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        return;
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      appendMessage(developmentTask.id, {
        id: `sys-${Date.now()}`,
        taskId: developmentTask.id,
        role: 'system',
        content: t('cli:taskUI.system.executionFailed', { error: errMsg }),
        isError: true,
      });
    } finally {
      executionControllersRef.current.delete(execKey);
      flushOpenCodeTitleSync();
      scheduleCLITaskTitleSync({
        taskId: developmentTask.id,
        getTask: () => useCLITaskStore.getState().getTask(developmentTask.id),
        updateTask,
      });
      useCLITaskStore.getState().syncTaskStatus(developmentTask.id);
    }
  };

  const handleSendMessage = async () => {
    if (isComposeBusy || !inputMessage.trim()) return;
    const liveTemplate = draftTemplate;
    if (!liveTemplate && !selectedTask) return;

    const rawInput = inputMessage.trim();
    const memberIds = selectedTask?.templateSnapshot.memberIds ?? liveTemplate?.memberIds ?? [];
    const parsed = parseAgentMention(rawInput, memberIds, id => resolveEffectiveMember(aiMembers, id)?.name);
    const executionPrompt = parsed.prompt;
    const targetAgentId = parsed.agentId;

    setInputMessage('');
    shouldStickToBottomRef.current = true;

    let activeScope = composeKey;
    beginTaskExecution(activeScope);

    try {
      let task = selectedTask;

      if (!task) {
        if (!liveTemplate) return;
        const ws = draftWorkspacePath.trim() || liveTemplate.workspacePath?.trim() || '';
        if (!ws) {
          toast.error(t('cli:taskUI.toast.workspaceRequired'));
          return;
        }
        writeLastCliWorkspace(ws);
        task = createTask({
          prompt: rawInput,
          template: liveTemplate,
          workspacePath: ws,
          memberSnapshots: createCLITaskMemberSnapshots(
            liveTemplate.memberIds.map(id => resolveEffectiveMember(aiMembers, id)),
          ),
        });
        const createdTaskId = task.id;
        scheduleCLITaskTitleSync({
          taskId: createdTaskId,
          prompt: rawInput,
          getTask: () => useCLITaskStore.getState().getTask(createdTaskId),
          updateTask,
        });
        if (activeScope === DRAFT_COMPOSE_KEY) {
          transferTaskExecution(DRAFT_COMPOSE_KEY, task.id);
          activeScope = task.id;
        }
        navigateToTask(task.id);
      } else {
        appendMessage(task.id, {
          id: `msg-${Date.now()}-user`,
          taskId: task.id,
          role: 'user',
          content: rawInput,
        });
        updateTask(task.id, { prompt: executionPrompt });
      }

      await runExecution(task, executionPrompt, targetAgentId, activeScope);
    } finally {
      endTaskExecution(activeScope);
    }
  };

  const handleAdoptRaceResult = (messageId: string) => {
    if (!selectedTask) return;
    updateMessage(selectedTask.id, messageId, { adopted: true });
  };

  const handleCleanupWorktree = async (path: string, agentName?: string) => {
    const confirmed = window.confirm(
      t('cli:taskUI.worktree.cleanupConfirm', {
        agent: agentName ? t('cli:taskUI.worktree.cleanupConfirmAgent', { agentName }) : '',
        path,
      }),
    );
    if (!confirmed) return;
    try {
      const res = await request('/api/cli/worktree/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths: [path] }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message || t('cli:taskUI.toast.cleanupFailed'));
      toast.success(t('cli:taskUI.toast.worktreeCleaned'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('cli:taskUI.toast.cleanupFailed'));
    }
  };

  const headerTeamMembers = useMemo(() => {
    const memberIds = selectedTask
      ? selectedTask.templateSnapshot.memberIds
      : draftTemplate?.memberIds ?? [];
    return memberIds
      .map(id => resolveEffectiveMember(aiMembers, id))
      .filter(member => member && member.kind === 'cli')
      .map(member => {
        const agent = mapAIMemberToLegacy(member) as CLIAgent;
        return { id: agent.id, name: agent.name, avatar: agent.avatar };
      });
  }, [selectedTask, draftTemplate, aiMembers]);
  const taskMention = useMentionAutocomplete({
    value: inputMessage,
    candidates: headerTeamMembers,
    onChange: setInputMessage,
    getCaret: () => inputRef.current?.selectionStart ?? inputMessage.length,
    setCaret: (caret) => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(caret, caret);
    },
  });
  const handleTaskComposeSend = () => {
    if (shouldBlockMentionAutocompleteSend(taskMention.open)) return;
    handleSendMessage();
  };

  const openTaskLog = (message: ReturnType<typeof taskMessageToChatRow>) => {
    if (!message.taskId) return;
    const member = message.sender.id?.startsWith('cli-') ? resolveEffectiveMember(aiMembers, message.sender.id) : undefined;
    const adapter = member?.kind === 'cli' ? member.cli?.adapter : undefined;
    setLogTarget({
      agentTaskId: message.taskId,
      messageId: message.id,
      agentName: message.sender.name,
      adapter,
      prompt: message.prompt,
      status: message.status,
    });
  };

  const cancelAgentTask = useCallback(async (agentTaskId: string, taskId?: string) => {
    await request('/api/cli/tasks/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: agentTaskId }),
    });
    const tid = taskId ?? selectedTask?.id;
    if (!tid) return;
    const task = useCLITaskStore.getState().getTask(tid);
    const msg = task?.messages.find(m => m.agentTaskId === agentTaskId);
    if (msg) {
      updateMessage(tid, msg.id, { status: 'cancelled' });
    }
  }, [selectedTask?.id, updateMessage]);

  const handleCancelTask = async (agentTaskId: string) => {
    try {
      await cancelAgentTask(agentTaskId);
    } catch (e) {
      console.error('Failed to cancel task:', e);
      toast.error(t('cli:taskUI.compose.stopFailed'));
    }
  };

  const handleStopExecution = async () => {
    if (!isComposeBusy) return;

    const execKey = composeKey;
    const taskId = selectedTask?.id;
    executionControllersRef.current.get(execKey)?.abort();
    endTaskExecution(execKey);

    setIsStopping(true);
    try {
      const task = taskId ? useCLITaskStore.getState().getTask(taskId) : null;
      const roundMessages = task ? getLatestAgentRoundMessages(task.messages) : [];
      const runningIds = [
        ...new Set(
          roundMessages
            .filter(m => m.status === 'running' && m.agentTaskId)
            .map(m => m.agentTaskId!),
        ),
      ];

      await Promise.allSettled(runningIds.map(id => cancelAgentTask(id, taskId)));

      if (taskId && task) {
        roundMessages.forEach(msg => {
          if (msg.status === 'running') {
            updateMessage(taskId, msg.id, { status: 'cancelled' });
          }
        });
        updateTask(taskId, { status: 'cancelled' });
      }

      toast.success(t('cli:taskUI.compose.stopped'));
    } catch (e) {
      console.error('Failed to stop execution:', e);
      toast.error(t('cli:taskUI.compose.stopFailed'));
    } finally {
      setIsStopping(false);
    }
  };

  const stopLabel = t('cli:taskUI.compose.stop');

  const renderComposeSendBar = (sendLabel: string, leftAddons?: ReactNode) => (
    <div className={styles.composeSendBar}>
      <div className={styles.composeSendBarLeft}>{leftAddons}</div>
      <div className={styles.composeSendBarRight}>
        {isComposeBusy || isStopping ? (
          <AntdButton
            className={styles.composeBrandBtn}
            style={brandPrimaryButtonStyle}
            styles={{ content: { color: BRAND_ON_PRIMARY }, icon: { color: BRAND_ON_PRIMARY } }}
            icon={(
              <Loader2
                size={16}
                color={BRAND_ON_PRIMARY}
                className={styles.composeBtnSpin}
              />
            )}
            onClick={handleStopExecution}
            disabled={isStopping}
          >
            {stopLabel}
          </AntdButton>
        ) : (
          <AntdButton
            className={styles.composeBrandBtn}
            style={brandPrimaryButtonStyle}
            styles={{ content: { color: BRAND_ON_PRIMARY } }}
            onClick={handleSendMessage}
          >
            {sendLabel}
          </AntdButton>
        )}
      </div>
    </div>
  );

  const handleRetryTask = async (msg: ReturnType<typeof taskMessageToChatRow>) => {
    if (!selectedTask || !msg.prompt || !msg.sender?.id) return;
    if (executingTaskIds.has(selectedTask.id)) return;

    beginTaskExecution(selectedTask.id);
    try {
      await runExecution(selectedTask, msg.prompt, msg.sender.id, selectedTask.id);
    } finally {
      endTaskExecution(selectedTask.id);
    }
  };

  const handleUpdateEditingTemplate = (updates: Partial<CLIGroup>) => {
    if (!editingCLIGroup || !onUpdateCLIGroup) return;
    const { workspacePath: _ignored, ...rest } = updates;
    onUpdateCLIGroup({ ...editingCLIGroup, ...rest, workspacePath: '' });
  };

  const closeTemplateSettings = () => {
    const shouldReturnToList = templateSettingsReturnTo === 'template-list';
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setTemplateSettingsReturnTo(null);
    if (shouldReturnToList) {
      setTemplateListOpen(true);
    }
  };

  const performDeleteTemplate = (templateId: string) => {
    if (!onDeleteCLIGroup) return;

    onDeleteCLIGroup(templateId);

    if (editingTemplateId === templateId) {
      closeTemplateSettings();
    }

    if (selectedTemplateId === templateId) {
      const remaining = cliGroups.filter(g => g.id !== templateId);
      setSelectedTemplateId(remaining[0]?.id || '');
    }

    toast.success(t('cli:taskUI.deleteTemplate.deleted'));
  };

  const handleDeleteTemplate = (templateId: string) => {
    if (!onDeleteCLIGroup) return;
    const template = templates.find(tmpl => tmpl.id === templateId);
    const taskCount = taskCountByTemplate[templateId] || 0;
    const name = template?.name || t('cli:taskUI.deleteTemplate.unnamed');
    const description = taskCount > 0
      ? t('cli:taskUI.deleteTemplate.descWithTasks', { count: taskCount })
      : t('cli:taskUI.deleteTemplate.descNoTasks');

    Modal.confirm({
      title: t('cli:taskUI.deleteTemplate.title', { name }),
      content: description,
      okText: t('common:actions.delete'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
      centered: true,
      zIndex: 2100,
      getContainer: () => document.body,
      onOk: () => {
        performDeleteTemplate(templateId);
      },
    });
  };

  useEffect(() => {
    if (!editingTemplateId) return;
    if (!cliGroups.some(group => group.id === editingTemplateId)) {
      setTemplateSettingsOpen(false);
      setEditingTemplateId(null);
      setTemplateSettingsReturnTo(null);
    }
  }, [cliGroups, editingTemplateId]);

  const openTemplateSettings = (templateId: string) => {
    setEditingTemplateId(templateId);
    if (templateListOpen) {
      setTemplateSettingsReturnTo('template-list');
    } else {
      setTaskInfoOpen(false);
      setSettingsOpen(false);
      setTemplateListOpen(false);
      setTemplateSettingsReturnTo(null);
    }
    setTemplateSettingsOpen(true);
  };

  const openTemplateList = () => {
    setTaskInfoOpen(false);
    setSettingsOpen(false);
    if (templateSettingsOpen) {
      setTemplateSettingsOpen(false);
      setEditingTemplateId(null);
      setTemplateSettingsReturnTo(null);
    }
    setTemplateListOpen(true);
  };

  const openCreateTemplate = () => {
    setCreateTemplateOpen(true);
  };

  const handleCreateTemplateGroup = (group: Group) => {
    onCreateGroup?.(group);
    if (group.type === 'cli') {
      setSelectedTemplateId(group.id);
    }
  };

  const handleCreateTaskFromThis = () => {
    if (!selectedTask) return;
    setForkTemplateId(selectedTask.templateId);
    setForkModalOpen(true);
  };

  const confirmForkTask = () => {
    if (!selectedTask) return;
    const tmpl = templates.find(t => t.id === forkTemplateId);
    if (!tmpl) return;
    setInputMessage(selectedTask.prompt);
    setSelectedTemplateId(forkTemplateId);
    setSelectedTaskId(null);
    setTaskInfoOpen(false);
    setForkModalOpen(false);
    navigateToList();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleArchiveTask = () => {
    if (!selectedTask) return;
    if (archiveTask(selectedTask.id)) {
      handleToggleTaskInfo(false);
    }
  };

  const handleRestoreTask = () => {
    if (!selectedTask) return;
    restoreTask(selectedTask.id);
  };

  const confirmDeleteTask = useCallback((taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    if (!canMutateTask(task)) {
      toast.error(t('cli:taskUI.deleteTask.runningError'));
      return;
    }

    Modal.confirm({
      title: t('cli:taskUI.deleteTask.title'),
      content: (
        <div>
          <p>{t('cli:taskUI.deleteTask.content', { title: task.title })}</p>
          <p style={{ margin: 0, color: '#999', fontSize: 12 }}>{t('cli:taskUI.deleteTask.warning')}</p>
        </div>
      ),
      okText: t('cli:taskUI.deleteTask.ok'),
      okType: 'danger',
      cancelText: t('common:actions.cancel'),
      onOk: () => {
        if (!deleteTask(taskId)) {
          toast.error(t('cli:taskUI.deleteTask.failed'));
          return;
        }
        if (selectedTaskId === taskId) {
          setSelectedTaskId(null);
          navigateToList();
          setTaskInfoOpen(false);
        }
        toast.success(t('cli:taskUI.deleteTask.success'));
      },
    });
  }, [tasks, deleteTask, selectedTaskId, t]);

  const handleDeleteTask = () => {
    if (!selectedTask) return;
    confirmDeleteTask(selectedTask.id);
  };

  const statusTag = (status: string) => {
    const map: Record<string, { color: string; labelKey: string }> = {
      running: { color: 'processing', labelKey: 'cli:status.running' },
      completed: { color: 'success', labelKey: 'cli:status.completed' },
      failed: { color: 'error', labelKey: 'cli:status.failed' },
      cancelled: { color: 'warning', labelKey: 'cli:status.cancelled' },
      timeout: { color: 'error', labelKey: 'cli:status.timeout' },
      queued: { color: 'default', labelKey: 'cli:status.queued' },
      archived: { color: 'default', labelKey: 'cli:status.archived' },
    };
    const info = map[status] || map.queued;
    return <Tag color={info.color} style={{ flex: 'none' }}>{t(info.labelKey)}</Tag>;
  };

  const closeManagementPanels = () => {
    setTaskInfoOpen(false);
    setTemplateListOpen(false);
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setTemplateSettingsReturnTo(null);
    setSettingsOpen(false);
  };

  const openAppSettings = (section: AppSettingsSection = 'general') => {
    closeManagementPanels();
    setSettingsSection(section);
    setSettingsOpen(true);
  };

  const handleToggleTaskInfo = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTaskInfoOpen(false);
      return;
    }
    setTemplateListOpen(false);
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setSettingsOpen(false);
    setTaskInfoOpen(true);
  };

  const handleToggleTemplateList = (nextOpen: boolean) => {
    if (!nextOpen) {
      setTemplateListOpen(false);
      if (templateSettingsOpen) {
        setTemplateSettingsOpen(false);
        setEditingTemplateId(null);
        setTemplateSettingsReturnTo(null);
      }
      return;
    }
    setTaskInfoOpen(false);
    setTemplateSettingsOpen(false);
    setEditingTemplateId(null);
    setTemplateSettingsReturnTo(null);
    setSettingsOpen(false);
    setTemplateListOpen(true);
  };

  const handleToggleTemplateSettings = (nextOpen: boolean) => {
    if (!nextOpen) {
      closeTemplateSettings();
      return;
    }
    setTaskInfoOpen(false);
    setTemplateListOpen(false);
    setSettingsOpen(false);
    setTemplateSettingsReturnTo(null);
    setTemplateSettingsOpen(true);
  };

  return (
    <>
      <Modal
        title={t('cli:taskUI.forkModal.title')}
        open={forkModalOpen}
        onCancel={() => setForkModalOpen(false)}
        onOk={confirmForkTask}
        okText={t('cli:taskUI.forkModal.ok')}
        cancelText={t('common:actions.cancel')}
      >
        <p style={{ fontSize: 13, marginBottom: 12, opacity: 0.75 }}>
          {t('cli:taskUI.forkModal.desc')}
        </p>
        <Select
          value={forkTemplateId || undefined}
          onChange={setForkTemplateId}
          style={{ width: '100%' }}
          options={templates.map(t => ({ value: t.id, label: t.name }))}
        />
      </Modal>

      <Modal
        title={t('cli:taskUI.create.createWorkspaceModal.title')}
        open={createWorkspaceOpen}
        onCancel={() => setCreateWorkspaceOpen(false)}
        onOk={handleCreateWorkspaceDirectory}
        okText={t('cli:taskUI.create.createWorkspaceModal.create')}
        cancelText={t('common:actions.cancel')}
        confirmLoading={creatingWorkspace}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              {t('cli:taskUI.create.createWorkspaceModal.parentLabel')}
            </div>
            <div className={styles.workspaceRow}>
              <AntdInput
                className={styles.workspaceInput}
                placeholder={t('cli:taskUI.create.createWorkspaceModal.parentPlaceholder')}
                value={createWorkspaceParent}
                onChange={(e) => setCreateWorkspaceParent(e.target.value)}
              />
              <AntdButton
                icon={<FolderOpen size={14} />}
                onClick={handleSelectCreateWorkspaceParent}
                style={{ height: 36, borderRadius: 10, flexShrink: 0 }}
              >
                {t('cli:taskUI.create.selectWorkspace')}
              </AntdButton>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
              {t('cli:taskUI.create.createWorkspaceModal.nameLabel')}
            </div>
            <AntdInput
              placeholder={t('cli:taskUI.create.createWorkspaceModal.namePlaceholder')}
              value={createWorkspaceName}
              onChange={(e) => setCreateWorkspaceName(e.target.value)}
            />
          </div>
          {createWorkspacePreview && (
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
              <span style={{ fontWeight: 500 }}>{t('cli:taskUI.create.createWorkspaceModal.previewLabel')}：</span>
              <span style={{ fontFamily: 'monospace' }}>{createWorkspacePreview}</span>
            </div>
          )}
        </div>
      </Modal>

      <CreateGroupWizard
        open={createTemplateOpen}
        onOpenChange={setCreateTemplateOpen}
        onCreateGroup={handleCreateTemplateGroup}
        fixedGroupType="cli"
        onOpenSettings={(section) => openAppSettings(section ?? 'cli')}
      />

      <CLIRaceResultsDrawer
        open={raceDrawerOpen}
        onOpenChange={setRaceDrawerOpen}
        task={selectedTask}
        workspacePath={workspacePath}
        onAdopt={handleAdoptRaceResult}
      />

      <CLITaskLogModal
        open={!!logTarget}
        onOpenChange={(open) => { if (!open) setLogTarget(null); }}
        agentTaskId={logTarget?.agentTaskId ?? null}
        agentName={logTarget?.agentName}
        adapter={logTarget?.adapter}
        prompt={logTarget?.prompt}
        status={logTarget?.status}
        onStatusChange={(status) => {
          if (logTarget && selectedTask) {
            updateMessage(selectedTask.id, logTarget.messageId, { status: status as CLITaskStatus });
            setLogTarget(prev => (prev ? { ...prev, status } : null));
          }
        }}
        onCancel={logTarget ? () => handleCancelTask(logTarget.agentTaskId) : undefined}
      />

      <CLITaskInfoPanel
        open={taskInfoOpen}
        onOpenChange={handleToggleTaskInfo}
        task={selectedTask}
        members={aiMembers}
        onCreateTaskFromThis={selectedTask ? handleCreateTaskFromThis : undefined}
        onArchiveTask={handleArchiveTask}
        onRestoreTask={handleRestoreTask}
        onDeleteTask={handleDeleteTask}
      />

      <CLITemplateListPanel
        open={templateListOpen}
        onOpenChange={handleToggleTemplateList}
        templates={templates}
        taskCountByTemplate={taskCountByTemplate}
        onOpenTemplateSettings={openTemplateSettings}
        onCreateTemplate={openCreateTemplate}
        onDeleteTemplate={handleDeleteTemplate}
      />

      {editingCLIGroup && (
        <CLIGroupSettings
          open={templateSettingsOpen}
          onOpenChange={handleToggleTemplateSettings}
          mode="template"
          group={editingCLIGroup}
          members={editingTemplateMembers}
          mutedUsers={mutedUsers}
          onToggleMute={(id) => setMutedUsers(prev =>
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
          )}
          workspacePath={editingCLIGroup.workspacePath || ''}
          onWorkspacePathChange={(p) => handleUpdateEditingTemplate({ workspacePath: p })}
          approvalMode={editingCLIGroup.approvalMode || 'auto'}
          onApprovalModeChange={(mode) => handleUpdateEditingTemplate({ approvalMode: mode })}
          timeout={editingCLIGroup.timeout ?? 300000}
          onTimeoutChange={(t) => handleUpdateEditingTemplate({ timeout: t })}
          showStderr={editingCLIGroup.showStderr !== false}
          onShowStderrChange={(v) => handleUpdateEditingTemplate({ showStderr: v })}
          strategy={editingCLIGroup.strategy || 'sequential'}
          onStrategyChange={(s) => handleUpdateEditingTemplate({ strategy: s })}
          onWorkflowTemplateChange={(workflowTemplateId) => handleUpdateEditingTemplate({ workflowTemplateId })}
          onExecutionPlanChange={(p) => handleUpdateEditingTemplate({ executionPlan: p })}
          onMembersChange={(ids) => handleUpdateEditingTemplate({ memberIds: ids })}
          onNameChange={(name) => handleUpdateEditingTemplate({ name })}
          onDescriptionChange={(description) => handleUpdateEditingTemplate({ description })}
          onReviewLoopRolesChange={(reviewLoopRoles) => handleUpdateEditingTemplate({ reviewLoopRoles })}
          sessionPolicy={editingCLIGroup.sessionPolicy || 'task'}
          onSessionPolicyChange={(policy) => handleUpdateEditingTemplate({ sessionPolicy: policy })}
          onBack={templateSettingsReturnTo === 'template-list' ? closeTemplateSettings : undefined}
          backLabel={t('cli:taskUI.backLabel')}
          linkedTaskCount={taskCountByTemplate[editingCLIGroup.id] || 0}
          onDeleteTemplate={handleDeleteTemplate}
          onSaveTemplate={handleUpdateEditingTemplate}
        />
      )}

      <AppSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        groups={groups}
        initialSection={settingsSection}
      />

      <div className={styles.page}>
        <div className={styles.container}>
          <Sidebar
            isOpen={sidebarOpen}
            toggleSidebar={() => setSidebarOpen(!sidebarOpen)}
            selectedGroupIndex={selectedGroupIndex}
            onSelectGroup={onSelectGroup}
            groups={groups}
            onCreateGroup={onCreateGroup}
            onOpenSettings={(section) => openAppSettings(section ?? 'cli')}
            activeView="cli-tasks"
            onNavigateCLI={() => navigateToList()}
            onNavigateHome={onNavigateHome ?? (() => { window.location.href = '?view=home'; })}
            hiddenGroupTypes={['cli']}
          />

          <CLITaskSidebar
            isOpen={taskSidebarOpen}
            toggleSidebar={() => setTaskSidebarOpen(!taskSidebarOpen)}
            tasks={tasks}
            selectedTaskId={selectedTaskId}
            onSelectTask={navigateToTask}
            onNewTask={startNewTask}
            onOpenTemplateList={openTemplateList}
            onDeleteTask={confirmDeleteTask}
          />

          <div className={styles.rightCol}>
            {!taskSidebarOpen && (
              <Tooltip title={t('cli:taskUI.expandTaskList')} placement="right">
                <button
                  type="button"
                  className={styles.taskSidebarExpandHandle}
                  onClick={() => setTaskSidebarOpen(true)}
                  aria-label={t('cli:taskUI.expandTaskListAria')}
                >
                  <PanelLeftOpen size={14} />
                </button>
              </Tooltip>
            )}
            <header className={styles.headerBar}>
              <div className={styles.headerInner}>
                <div className={styles.headerTitleRow}>
                  <Terminal size={16} color="#ff6600" style={{ flex: 'none' }} />
                  <h1 style={{ margin: 0, fontWeight: 600, fontSize: 14, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedTask ? selectedTask.title : t('cli:taskUI.title')}
                  </h1>
                  {selectedTask && statusTag(selectedTask.status)}
                </div>
                <div className={styles.headerActions}>
                  {workspacePath && (
                    <div className={styles.headerCwd}>
                      <span className={styles.cwdLabel}>CWD:</span>
                      <span className={styles.cwdPath} title={workspacePath}>
                        {workspacePath}
                      </span>
                    </div>
                  )}
                  <div className={styles.desktopOnly}>
                    <AdBanner show={showAd} closeAd={() => setShowAd(false)} />
                  </div>
                  {headerTeamMembers.length > 0 && (
                    <div className={styles.avatarStack}>
                      {headerTeamMembers.slice(0, 4).map((member) => {
                        const a = getAvatarData(member.name);
                        const url = resolveAvatarByName(member.name, member.avatar, 32);
                        return (
                          <Tooltip key={member.id} title={member.name}>
                            <LobeAvatar
                              avatar={url || a.text}
                              background={a.backgroundColor}
                              shape="circle"
                              size={32}
                              title={member.name}
                              style={{ flexShrink: 0 }}
                            />
                          </Tooltip>
                        );
                      })}
                      {headerTeamMembers.length > 4 && (
                        <div className={styles.avatarMore}>+{headerTeamMembers.length - 4}</div>
                      )}
                    </div>
                  )}
                  {selectedTask && (
                    <ActionIcon
                      icon={Info}
                      size="small"
                      onClick={() => handleToggleTaskInfo(!taskInfoOpen)}
                      title={t('cli:taskUI.taskInfo')}
                    />
                  )}
                  {raceEntries.length > 0 && (
                    <ActionIcon
                      icon={GitCompare}
                      size="small"
                      onClick={() => setRaceDrawerOpen(true)}
                      title={t('cli:taskUI.raceCompare')}
                    />
                  )}
                </div>
              </div>
            </header>

            <div
              ref={chatAreaRef}
              className={styles.chatArea}
              onScroll={handleChatAreaScroll}
            >
              {!selectedTask && (
                <div className={styles.creationFormContainer}>
                  <div className={styles.creationFormCard}>
                    <div className={styles.creationHeader}>
                      <h2 className={styles.creationTitle}>{t('cli:taskUI.create.title')}</h2>
                      <span className={styles.creationSubtitle}>{t('cli:taskUI.create.subtitle')}</span>
                    </div>

                    <div className={styles.formField}>
                      <span className={styles.formLabel}>{t('cli:taskUI.create.promptLabel')}</span>
                      <MentionTextArea
                        value={inputMessage}
                        onChange={setInputMessage}
                        candidates={headerTeamMembers}
                        placeholder={t('cli:taskUI.create.promptPlaceholder')}
                        autoSize={{ minRows: 4, maxRows: 8 }}
                        disabled={isComposeBusy}
                        style={{ borderRadius: 10, padding: '10px 12px' }}
                      />
                    </div>

                    <div className={styles.formField}>
                      <div className={styles.formFieldHeader}>
                        <span className={styles.formLabel}>{t('cli:taskUI.create.templateLabel')}</span>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <AntdButton
                            type="link"
                            size="small"
                            onClick={openCreateTemplate}
                            icon={<Plus size={12} />}
                            style={{ padding: 0, height: 'auto', fontSize: 12 }}
                          >
                            {t('cli:taskUI.create.newTemplate')}
                          </AntdButton>
                          {templates.length > 0 && (
                            <AntdButton
                              type="link"
                              size="small"
                              onClick={openTemplateList}
                              style={{ padding: 0, height: 'auto', fontSize: 12 }}
                            >
                              {t('cli:taskUI.create.manageTemplates')}
                            </AntdButton>
                          )}
                        </div>
                      </div>

                      {templates.length === 0 ? (
                        <div className={styles.templateEmpty}>
                          <span>{t('cli:taskUI.create.emptyTemplates')}</span>
                          <AntdButton
                            size="small"
                            onClick={openCreateTemplate}
                            icon={<Plus size={14} color={BRAND_ON_PRIMARY} />}
                            {...brandPrimaryButtonProps}
                          >
                            {t('cli:templateList.create')}
                          </AntdButton>
                        </div>
                      ) : (
                        <div className={styles.templateGrid}>
                          {templates.map(tmpl => {
                            const isCardSelected = selectedTemplateId === tmpl.id;
                            const workflowLabel = getCLIWorkflowLabel(tmpl.strategy, tmpl.workflowTemplateId);
                            const workflowKey = tmpl.workflowTemplateId;
                            const templateMembers = tmpl.memberIds
                              .map((id) => resolveEffectiveMember(aiMembers, id))
                              .filter((member) => member && member.kind === 'cli');
                            return (
                              <div
                                key={tmpl.id}
                                className={cx(styles.templateCard, isCardSelected && styles.templateCardActive)}
                                onClick={() => setSelectedTemplateId(tmpl.id)}
                              >
                                <div className={styles.templateCardTitle}>{tmpl.name}</div>
                                <div className={styles.templateCardMeta}>
                                  <span>
                                    {workflowKey
                                      ? t(`product:cliWorkflowTemplates.${workflowKey}.label`, { defaultValue: workflowLabel })
                                      : workflowLabel}
                                  </span>
                                </div>
                                <div className={styles.templateMemberRow}>
                                  {templateMembers.length > 0 ? (
                                    templateMembers.map((member) => {
                                      const avatar = getAvatarData(member.name);
                                      const url = resolveAvatarByName(member.name, member.avatar, 16);
                                      return (
                                        <span
                                          key={member.id}
                                          className={styles.templateMemberChip}
                                          title={member.name}
                                        >
                                          <LobeAvatar
                                            avatar={url || avatar.text}
                                            background={avatar.backgroundColor}
                                            shape="circle"
                                            size={16}
                                            title={member.name}
                                            style={{ flexShrink: 0 }}
                                          />
                                          <span className={styles.templateMemberName}>{member.name}</span>
                                        </span>
                                      );
                                    })
                                  ) : (
                                    <span className={styles.templateCardMeta}>
                                      {t('cli:taskUI.create.memberCount', { count: tmpl.memberIds.length })}
                                    </span>
                                  )}
                                </div>
                                {tmpl.description && (
                                  <div className={styles.templateCardDesc} title={tmpl.description}>
                                    {tmpl.description}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className={styles.formField}>
                      <span className={styles.formLabel}>{t('cli:taskUI.create.workspaceLabel')}</span>
                      <div className={styles.workspaceRow}>
                        <AntdInput
                          className={styles.workspaceInput}
                          placeholder={t('cli:groupSettings.workspace.placeholder')}
                          value={draftWorkspacePath}
                          onChange={(e) => handleDraftWorkspaceChange(e.target.value)}
                          style={{ borderRadius: 10, height: 36 }}
                        />
                        <AntdButton
                          icon={<FolderOpen size={14} />}
                          onClick={handleSelectDraftWorkspace}
                          style={{ height: 36, borderRadius: 10 }}
                        >
                          {t('cli:taskUI.create.selectWorkspace')}
                        </AntdButton>
                        <AntdButton
                          icon={<FolderPlus size={14} />}
                          onClick={openCreateWorkspaceModal}
                          style={{ height: 36, borderRadius: 10 }}
                        >
                          {t('cli:taskUI.create.createWorkspace')}
                        </AntdButton>
                      </div>
                    </div>

                    <div className={styles.submitBtnRow}>
                      {renderComposeSendBar(t('cli:taskUI.create.submit'))}
                    </div>
                  </div>
                </div>
              )}

              {selectedTask && (
                <div className={styles.messageList}>
                  {chatMessages.map((message, idx) => {
                    const isUser = !message.isAI;
                    const cliMember = message.sender?.id?.startsWith?.('cli-')
                      ? resolveEffectiveMember(aiMembers, message.sender.id)
                      : undefined;
                    const cliAgentInfo = cliMember?.kind === 'cli'
                      ? mapAIMemberToLegacy(cliMember) as CLIAgent
                      : undefined;
                    const snapshotMember = selectedTask.memberSnapshots?.find(member => member.id === message.sender.id);
                    const modelHint = snapshotMember?.modelHint
                      || (cliMember?.kind === 'cli' ? inferCliModelFromArgs(cliMember.cli?.extraArgs) : undefined);
                    const displayNameParts = splitAgentDisplayName(message.sender.name, message.stageLabel);
                    const senderDisplayName = isUser
                      ? message.sender.name
                      : modelHint && message.sender.name.includes(` · ${modelHint}`)
                        ? message.sender.name
                        : [
                            appendCliModelHint(displayNameParts.baseName, modelHint),
                            displayNameParts.stageName,
                          ].filter(Boolean).join(' · ');
                    const avatarName = cliAgentInfo?.name || message.sender.name;
                    const a = getAvatarData(avatarName);
                    const url = resolveAvatarByName(avatarName, cliAgentInfo?.avatar, 40);
                    const isLatest = idx === chatMessages.length - 1;
                    const isStreaming = message.isAI && (
                      message.status === 'running'
                      || (executingTaskIds.has(selectedTask!.id) && isLatest)
                    );
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
                          />
                        )}
                        <div className={cx(styles.messageBody, isUser && styles.messageBodyUser)}>
                          <div className={styles.metaRow} style={{ justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                            {senderDisplayName}
                            {isStreaming && (
                              <span className={styles.streaming}>
                                <span className={styles.streamingDot} />
                                {message.content === '' ? t('cli:taskUI.message.thinking') : t('cli:taskUI.message.executing')}
                              </span>
                            )}
                          </div>
                          <div className={cx(bubbleClass, 'chat-message')}>
                            <ChatMarkdown content={message.content} isUser={isUser} />
                            {isStreaming && (
                              <span className={cx('typing-indicator', styles.typingCursor)}>▋</span>
                            )}
                            {message.taskId && (
                              <div className={styles.cliTaskFooter}>
                                <span className={styles.cliTaskStatus}>
                                  {message.status === 'running' && (
                                    <>
                                      <span className={styles.spinnerIcon} />
                                      <span>{t('cli:taskUI.message.executing')}</span>
                                    </>
                                  )}
                                  {message.status === 'completed' && <span style={{ color: '#52c41a' }}>{t('cli:taskUI.message.completed')}</span>}
                                  {message.status === 'failed' && <span style={{ color: '#ff4d4f' }}>{t('cli:taskUI.message.failed')}</span>}
                                  {message.status === 'cancelled' && <span style={{ color: '#faad14' }}>{t('cli:taskUI.message.cancelled')}</span>}
                                  {message.status === 'timeout' && <span style={{ color: '#ff4d4f' }}>{t('cli:taskUI.message.timeout')}</span>}
                                </span>
                                <div className={styles.cliTaskActions}>
                                  <button
                                    type="button"
                                    className={styles.cliActionBtnLog}
                                    onClick={() => openTaskLog(message)}
                                  >
                                    {t('cli:taskUI.message.log')}
                                  </button>
                                  {message.status === 'running' && message.taskId && isComposeBusy && (
                                    <button
                                      type="button"
                                      className={styles.cliActionBtnCancel}
                                      onClick={handleStopExecution}
                                    >
                                      {t('cli:taskUI.message.stop')}
                                    </button>
                                  )}
                                  {['failed', 'cancelled', 'timeout'].includes(message.status || '') && (
                                    <button
                                      type="button"
                                      className={styles.cliActionBtnRetry}
                                      onClick={() => handleRetryTask(message)}
                                    >
                                      {t('cli:taskUI.message.retry')}
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                            {message.cliCwd && message.cliCwd !== workspacePath && (
                              <div className={styles.cliWorktreeInfo}>
                                <div style={{ fontWeight: 500 }}>{t('cli:taskUI.message.worktreeTitle')}</div>
                                <div className={styles.cliWorktreePath}>{message.cliCwd}</div>
                                {message.cliBranch && (
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{t('cli:taskUI.message.branch')}</span>
                                    <span className={styles.cliWorktreePath}>{message.cliBranch}</span>
                                  </div>
                                )}
                                {message.baseSha && (
                                  <div>
                                    <span style={{ fontWeight: 500 }}>{t('cli:taskUI.message.base')}</span>
                                    <span className={styles.cliWorktreePath}>{message.baseSha.slice(0, 8)}</span>
                                  </div>
                                )}
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                                  <button
                                    type="button"
                                    className={styles.cliWorktreeActionBtn}
                                    onClick={() => openPath(message.cliCwd!).catch(() => {})}
                                  >
                                    {t('cli:taskUI.message.openPath')}
                                  </button>
                                  {message.status === 'completed' && !message.adopted && (
                                    <button
                                      type="button"
                                      className={styles.cliWorktreeActionBtn}
                                      style={{ color: '#52c41a', borderColor: '#b7eb8f' }}
                                      onClick={() => handleAdoptRaceResult(message.id)}
                                    >
                                      {t('cli:taskUI.message.markAdopted')}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className={styles.cliWorktreeActionBtn}
                                    style={{ color: '#ff4d4f', borderColor: '#ffccc7' }}
                                    onClick={() => handleCleanupWorktree(message.cliCwd!, message.sender.name)}
                                  >
                                    {t('cli:taskUI.message.cleanup')}
                                  </button>
                                  {message.adopted && (
                                    <span style={{ fontSize: 11, color: '#52c41a', fontWeight: 600 }}>
                                      {t('cli:taskUI.message.adopted')}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {selectedTask && (
              <div className={styles.inputArea}>
                <div style={{ position: 'relative' }}>
                  <MentionSuggestionPanel
                    open={taskMention.open}
                    suggestions={taskMention.suggestions}
                    selectedIndex={taskMention.selectedIndex}
                    onHover={taskMention.setSelectedIndex}
                    onSelect={taskMention.selectCandidate}
                  />
                  <div className={styles.composeBox}>
                    <ChatInputArea.Inner
                      ref={inputRef}
                      className={styles.composeTextarea}
                      value={inputMessage}
                      onInput={setInputMessage}
                      onSend={handleTaskComposeSend}
                      onKeyDown={(event) => {
                        taskMention.handleKeyDown(event);
                      }}
                      loading={isComposeBusy}
                      placeholder={t('cli:taskUI.compose.placeholder')}
                      disabled={isComposeBusy}
                      autoSize={{ minRows: 4, maxRows: 12 }}
                      variant="borderless"
                    />
                    {renderComposeSendBar(
                      t('cli:taskUI.compose.send'),
                      <>
                        <Tag color="orange">{selectedTask.templateSnapshot.name}</Tag>
                        <span className={styles.composeHint}>
                          {t('cli:taskUI.compose.hint')}
                        </span>
                      </>,
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {isMobile && sidebarOpen && (
          <div className={styles.mobileOverlay} onClick={() => setSidebarOpen(false)} />
        )}
      </div>
    </>
  );
};

export default CLITaskUI;
