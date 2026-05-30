/**
 * 角色群聊会话侧栏（方案 A：二级侧栏）
 * 与 CLITaskSidebar 风格一致：新建 / 搜索 / 列表 / 选中 / 重命名 / 置顶 / 归档 / 删除
 */
import { useMemo, useState, useEffect, useRef } from 'react';
import {
  Plus,
  Search,
  MessageSquare,
  X,
  PanelLeftClose,
  Pin,
  PinOff,
  Archive,
  ArchiveRestore,
  Pencil,
  Trash2,
  Clock3,
} from 'lucide-react';
import { Input, Tooltip, Button } from 'antd';
import { BRAND_ON_PRIMARY, brandPrimaryButtonStyle } from '@/lib/theme';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import { useTranslation } from 'react-i18next';
import { formatLocaleDateTime } from '@/i18n/formatLocale';
import type { ChatSession } from '@/config/chatSessions';
import { filterChatSessions, sortChatSessions } from '@/config/chatSessions';

const SIDEBAR_WIDTH = 264;

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease, min-width 0.3s ease;
    width: ${SIDEBAR_WIDTH}px;
    min-width: ${SIDEBAR_WIDTH}px;
  `,
  containerCollapsed: css`
    width: 0;
    min-width: 0;
    border-right: none;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 14px 8px;
    flex: none;
  `,
  title: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  subtitle: css`
    margin-top: 2px;
    font-size: 11px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 170px;
  `,
  topActions: css`
    padding: 0 14px 8px;
    flex: none;
  `,
  searchWrapper: css`
    padding: 0 14px 8px;
    flex: none;
  `,
  toolbar: css`
    padding: 0 14px 8px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex: none;
  `,
  archiveToggle: css`
    height: 26px;
    border-radius: 8px;
    border: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgContainer};
    color: ${token.colorTextSecondary};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 9px;
    font-size: 11px;
    &:hover {
      border-color: #ff6600;
      color: #ff6600;
    }
  `,
  archiveToggleActive: css`
    border-color: rgba(255, 102, 0, 0.45);
    background: rgba(255, 102, 0, 0.08);
    color: #c2410c;
  `,
  navList: css`
    flex: 1;
    overflow: auto;
    padding: 4px 10px 10px;
  `,
  navItem: css`
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 8px;
    background: ${token.colorBgContainer};
    border: 1px solid ${token.colorBorderSecondary};
    cursor: pointer;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;
    margin-bottom: 6px;
    &:hover {
      border-color: rgba(255, 102, 0, 0.35);
      color: ${token.colorText};
      .convActions {
        opacity: 1;
      }
    }
  `,
  navItemActive: css`
    background: ${token.colorBgContainer} !important;
    border-color: rgba(255, 102, 0, 0.45) !important;
    box-shadow: inset 3px 0 0 #ff6600;
    color: ${token.colorText} !important;
  `,
  titleRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-width: 0;
  `,
  titleWrap: css`
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  `,
  sessionTitle: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  pinIcon: css`
    flex: none;
    color: #ff6600;
  `,
  actions: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex: none;
    opacity: 0;
    transition: opacity 0.15s ease;
  `,
  actionsVisible: css`
    opacity: 1;
  `,
  actionBtn: css`
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: ${token.colorTextTertiary};
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s ease, background 0.15s ease;
    &:hover {
      color: #ff6600;
      background: ${token.colorFillTertiary};
    }
  `,
  actionBtnDanger: css`
    &:hover {
      color: #ff4d4f;
      background: ${token.colorErrorBg};
    }
  `,
  metaRow: css`
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  `,
  timeMeta: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: none;
    font-size: 10px;
    color: ${token.colorTextTertiary};
    white-space: nowrap;
  `,
  archivedTag: css`
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10px;
    color: ${token.colorTextQuaternary};
  `,
  preview: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  empty: css`
    text-align: center;
    padding: 36px 16px;
    font-size: 12px;
    color: ${token.colorTextTertiary};
    line-height: 1.6;
    white-space: pre-line;
  `,
}));

interface ConversationSidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  sessions: ChatSession[];
  selectedSessionId: string | null;
  groupName?: string;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onTogglePin: (sessionId: string) => void;
  onToggleArchive: (sessionId: string) => void;
}

export const CONVERSATION_SIDEBAR_WIDTH = SIDEBAR_WIDTH;

export const ConversationSidebar = ({
  isOpen,
  toggleSidebar,
  sessions,
  selectedSessionId,
  groupName,
  onSelectSession,
  onNewSession,
  onRenameSession,
  onDeleteSession,
  onTogglePin,
  onToggleArchive,
}: ConversationSidebarProps) => {
  const { styles, cx } = useStyles();
  const { t } = useTranslation(['chat', 'common']);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const editInputRef = useRef<any>(null);

  const filteredSessions = useMemo(() => {
    return sortChatSessions(
      filterChatSessions(sessions, { search: searchQuery, showArchived }),
    );
  }, [sessions, searchQuery, showArchived]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus?.();
      editInputRef.current.select?.();
    }
  }, [editingId]);

  const formatTime = (iso: string) =>
    formatLocaleDateTime(iso, {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  const startRename = (session: ChatSession) => {
    setEditingId(session.id);
    setEditingTitle(session.title);
  };

  const commitRename = () => {
    if (editingId) {
      const trimmed = editingTitle.trim();
      if (trimmed) onRenameSession(editingId, trimmed);
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditingTitle('');
  };

  const previewText = (session: ChatSession): string => {
    const last = session.messages[session.messages.length - 1];
    if (!last) return t('chat:conversation.emptyPreview');
    const prefix = last.isAI ? '' : `${t('chat:conversation.youPrefix')}: `;
    return `${prefix}${last.content}`.replace(/\s+/g, ' ').trim();
  };

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

  return (
    <div className={cx(styles.container, !isOpen && styles.containerCollapsed)}>
      {isOpen && (
        <>
          <div className={styles.headerRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <MessageSquare size={16} color="#ff6600" />
              <div style={{ minWidth: 0 }}>
                <span className={styles.title}>{t('chat:conversation.title')}</span>
                {groupName && <div className={styles.subtitle}>{groupName}</div>}
              </div>
            </div>
            <ActionIcon icon={PanelLeftClose} size="small" onClick={toggleSidebar} title="" />
          </div>

          <div className={styles.topActions}>
            <Button
              icon={<Plus size={14} color={BRAND_ON_PRIMARY} />}
              onClick={onNewSession}
              block
              style={{ ...brandPrimaryButtonStyle, height: 36, borderRadius: 10 }}
              styles={{
                content: { color: BRAND_ON_PRIMARY },
                icon: { color: BRAND_ON_PRIMARY },
              }}
            >
              {t('chat:conversation.new')}
            </Button>
          </div>

          <div className={styles.searchWrapper}>
            <Input
              size="small"
              placeholder={t('chat:conversation.searchPlaceholder')}
              prefix={<Search size={14} style={{ opacity: 0.6 }} />}
              suffix={
                searchQuery ? (
                  <X size={12} onClick={() => setSearchQuery('')} style={{ cursor: 'pointer' }} />
                ) : (
                  <span />
                )
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ borderRadius: 10, height: 34 }}
            />
          </div>

          <div className={styles.toolbar}>
            <button
              type="button"
              className={cx(styles.archiveToggle, showArchived && styles.archiveToggleActive)}
              onClick={() => setShowArchived(v => !v)}
            >
              <Archive size={12} />
              {t('chat:conversation.showArchived')}
            </button>
          </div>

          <nav className={styles.navList}>
            {filteredSessions.length === 0 && (
              <div className={styles.empty}>
                {searchQuery
                  ? t('chat:conversation.emptySearch')
                  : t('chat:conversation.empty')}
              </div>
            )}
            {filteredSessions.map(session => {
              const isSelected = selectedSessionId === session.id;
              const isEditing = editingId === session.id;
              return (
                <div
                  key={session.id}
                  className={cx(styles.navItem, isSelected && styles.navItemActive)}
                  onClick={() => { if (!isEditing) onSelectSession(session.id); }}
                >
                  <div className={styles.titleRow}>
                    <div className={styles.titleWrap}>
                      {session.pinned && <Pin size={12} className={styles.pinIcon} />}
                      {isEditing ? (
                        <Input
                          ref={editInputRef}
                          size="small"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          onPressEnter={commitRename}
                          onBlur={commitRename}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelRename(); }}
                          onClick={stop}
                          maxLength={48}
                          style={{ borderRadius: 6, height: 26 }}
                        />
                      ) : (
                        <span className={styles.sessionTitle} title={session.title}>
                          {session.title}
                        </span>
                      )}
                    </div>
                    {!isEditing && (
                      <span className={cx(styles.actions, 'convActions', isSelected && styles.actionsVisible)}>
                        <Tooltip title={t('chat:conversation.rename')}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            aria-label={t('chat:conversation.rename')}
                            onClick={(e) => { stop(e); startRename(session); }}
                          >
                            <Pencil size={13} />
                          </button>
                        </Tooltip>
                        <Tooltip title={session.pinned ? t('chat:conversation.unpin') : t('chat:conversation.pin')}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            aria-label={session.pinned ? t('chat:conversation.unpin') : t('chat:conversation.pin')}
                            onClick={(e) => { stop(e); onTogglePin(session.id); }}
                          >
                            {session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                          </button>
                        </Tooltip>
                        <Tooltip title={session.archived ? t('chat:conversation.unarchive') : t('chat:conversation.archive')}>
                          <button
                            type="button"
                            className={styles.actionBtn}
                            aria-label={session.archived ? t('chat:conversation.unarchive') : t('chat:conversation.archive')}
                            onClick={(e) => { stop(e); onToggleArchive(session.id); }}
                          >
                            {session.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                          </button>
                        </Tooltip>
                        <Tooltip title={t('chat:conversation.delete')}>
                          <button
                            type="button"
                            className={cx(styles.actionBtn, styles.actionBtnDanger)}
                            aria-label={t('chat:conversation.delete')}
                            onClick={(e) => { stop(e); onDeleteSession(session.id); }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </Tooltip>
                      </span>
                    )}
                  </div>

                  {!isEditing && (
                    <>
                      <div className={styles.preview} title={previewText(session)}>
                        {previewText(session)}
                      </div>
                      <div className={styles.metaRow}>
                        <span className={styles.timeMeta}>
                          <Clock3 size={10} style={{ opacity: 0.65 }} />
                          {formatTime(session.updatedAt)}
                        </span>
                        {session.archived && (
                          <span className={styles.archivedTag}>
                            <Archive size={10} />
                            {t('chat:conversation.archivedTag')}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </nav>
        </>
      )}
    </div>
  );
};

export default ConversationSidebar;
