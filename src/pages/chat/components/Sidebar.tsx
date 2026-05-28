import { useEffect, useState } from 'react';
import {
  Bot,
  Menu as MenuIcon,
  MessageSquare as MessageSquareIcon,
  MoreHorizontal,
  PanelLeftClose as PanelLeftCloseIcon,
  PlusCircle as PlusCircleIcon,
  Puzzle,
  Terminal,
  Users as UsersIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Dropdown, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';
import GitHubButton from 'react-github-btn';
import '@fontsource/audiowide';

import { SidebarPreferences } from './SidebarPreferences';
import { UserSection } from './UserSection';
import { useTheme } from '@/hooks/use-theme';
import CreateGroupWizard from './CreateGroupWizard';
import { getTranslatedGroupTypeShortLabel } from '@/i18n/productLabels';
import { isBuiltinGroupId } from '@/config/groupStorage';
import type { Group, GroupType } from '@/config/groups';

const getGroupIcon = (group: Group) => {
  switch (group.type) {
    case 'ai':
      return Bot;
    case 'cli':
      return Terminal;
    case 'agent':
      return Puzzle;
    default:
      return MessageSquareIcon;
  }
};

const useStyles = createStyles(({ token, css }) => ({
  container: css`
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: width 0.3s ease, transform 0.3s ease;
  `,
  headerRow: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
  `,
  brand: css`
    font-family: 'Audiowide', system-ui;
    color: #ff6600;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
    overflow: hidden;
  `,
  workspaceTitle: css`
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: ${token.colorText};
    white-space: nowrap;
    overflow: hidden;
  `,
  navList: css`
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 8px;
  `,
  navSection: css`
    flex: none;
  `,
  navScrollSection: css`
    flex: 1;
    min-height: 0;
    overflow: auto;
    margin: 0 -8px;
    padding: 0 8px;
  `,
  sectionDivider: css`
    height: 1px;
    background: ${token.colorBorderSecondary};
    margin: 6px 8px;
    flex: none;
  `,
  sectionLabel: css`
    padding: 2px 12px 8px;
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextTertiary};
  `,
  navItem: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 12px;
    cursor: pointer;
    color: ${token.colorTextSecondary};
    transition: all 0.15s ease;
    position: relative;
    overflow: hidden;
    margin-bottom: 4px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
  `,
  navItemActive: css`
    background: rgba(255, 102, 0, 0.1) !important;
    color: #ff6600 !important;
    font-weight: 600;
    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 10px;
      bottom: 10px;
      width: 2px;
      background: #ff6600;
      border-radius: 0 2px 2px 0;
    }
  `,
  navItemCollapsed: css`
    justify-content: center;
    padding: 10px 0;
  `,
  navItemLabel: css`
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  `,
  navItemRow: css`
    display: flex;
    align-items: center;
    gap: 2px;
    margin-bottom: 4px;

    &:hover .nav-menu-btn {
      opacity: 1;
    }
  `,
  navItemMain: css`
    flex: 1;
    min-width: 0;
    margin-bottom: 0 !important;
  `,
  navMenuBtn: css`
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    background: transparent;
    border-radius: 8px;
    cursor: pointer;
    color: ${token.colorTextTertiary};
    opacity: 0;
    transition: all 0.15s ease;

    &:hover {
      background: ${token.colorFillTertiary};
      color: ${token.colorText};
    }
  `,
  createBtn: css`
    margin-top: 12px;
  `,
  tag: css`
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    white-space: nowrap;
    flex-shrink: 0;
  `,
  tagAi: css`
    background: rgba(255, 102, 0, 0.12);
    color: #ff6600;
  `,
  tagCli: css`
    background: rgba(16, 185, 129, 0.12);
    color: ${token.colorSuccess};
  `,
  tagAgent: css`
    background: rgba(59, 130, 246, 0.12);
    color: ${token.colorInfo};
  `,
  starWrapper: css`
    padding: 12px;
    background: ${token.colorFillQuaternary};
    flex: none;
  `,
  brandRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
  `,
  versionBadge: css`
    font-size: 10px;
    color: ${token.colorTextTertiary};
    align-self: flex-end;
    margin-bottom: 2px;
  `,
  starButtonWrapper: css`
    margin-top: 8px;
    transform: scale(0.9);
    transform-origin: left center;
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
}));

const renderGroupTag = (
  type: string,
  styles: ReturnType<typeof useStyles>['styles'],
  cx: ReturnType<typeof useStyles>['cx'],
  shortLabel: string,
) => {
  switch (type) {
    case 'ai':
      return <span className={cx(styles.tag, styles.tagAi)}>{shortLabel}</span>;
    case 'cli':
      return <span className={cx(styles.tag, styles.tagCli)}>{shortLabel}</span>;
    case 'agent':
      return <span className={cx(styles.tag, styles.tagAgent)}>{shortLabel}</span>;
    default:
      return null;
  }
};

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  selectedGroupIndex?: number;
  onSelectGroup?: (index: number) => void;
  groups: Group[];
  onCreateGroup?: (group: Group) => void;
  onOpenLibrary?: () => void;
  onEditGroup?: (index: number) => void;
  onDeleteGroup?: (group: Group, index: number) => void;
  activeView?: 'groups' | 'cli-tasks';
  onNavigateCLI?: () => void;
  hiddenGroupTypes?: GroupType[];
}

const Sidebar = ({
  isOpen,
  toggleSidebar,
  selectedGroupIndex = 0,
  onSelectGroup,
  groups,
  onCreateGroup,
  onOpenLibrary,
  onEditGroup,
  onDeleteGroup,
  activeView = 'groups',
  onNavigateCLI,
  hiddenGroupTypes = [],
}: SidebarProps) => {
  const { styles, cx } = useStyles();
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [version, setVersion] = useState('');
  const { t } = useTranslation(['sidebar', 'common', 'product']);
  const { resolvedTheme } = useTheme();

  const colorScheme =
    resolvedTheme === 'dark'
      ? 'no-preference: dark; light: dark; dark: dark;'
      : 'no-preference: light; light: light; dark: light;';

  useEffect(() => {
    fetch('https://api.github.com/repos/maojindao55/botgroup.chat/releases/latest')
      .then((r) => r.json())
      .then((data) => {
        if (data.tag_name) setVersion(data.tag_name);
      })
      .catch(() => {});
  }, []);

  const handleCreateGroup = (group: Group) => {
    onCreateGroup?.(group);
  };

  const filteredGroups = groups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .filter(({ group }) => !hiddenGroupTypes.includes(group.type || 'ai'));

  return (
    <>
      <CreateGroupWizard
        open={showCreateWizard}
        onOpenChange={setShowCreateWizard}
        onCreateGroup={handleCreateGroup}
        allowedGroupTypes={['ai', 'agent']}
        onOpenLibrary={() => {
          setShowCreateWizard(false);
          onOpenLibrary?.();
        }}
      />

      <div
        style={{
          width: isOpen ? 192 : 56,
        }}
        className={cx(
          'fixed md:relative z-20 h-full md:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
          styles.container,
        )}
      >
        <div className={styles.headerRow}>
          {isOpen && <span className={styles.workspaceTitle}>{t('sidebar:workspaceTitle')}</span>}
          <ActionIcon
            icon={isOpen ? PanelLeftCloseIcon : MenuIcon}
            size="small"
            onClick={toggleSidebar}
            title=""
          />
        </div>

        <nav className={styles.navList}>
          <div className={styles.navSection}>
            {isOpen && <div className={styles.sectionLabel}>{t('sidebar:section.workspace')}</div>}
            {(() => {
              const isCliActive = activeView === 'cli-tasks';
              const devTasksBtn = (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigateCLI?.();
                  }}
                  className={cx(
                    styles.navItem,
                    isCliActive && styles.navItemActive,
                    !isOpen && styles.navItemCollapsed,
                  )}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minWidth: 0,
                      flex: 1,
                      justifyContent: isOpen ? 'flex-start' : 'center',
                    }}
                  >
                    <Terminal
                      size={16}
                      style={{ color: isCliActive ? '#ff6600' : undefined, flexShrink: 0 }}
                    />
                    {isOpen && (
                      <span className={styles.navItemLabel}>{t('sidebar:nav.devTasks')}</span>
                    )}
                  </div>
                </a>
              );
              return !isOpen ? (
                <Tooltip title={t('sidebar:nav.devTasks')} placement="right" mouseEnterDelay={0.15}>
                  {devTasksBtn}
                </Tooltip>
              ) : (
                devTasksBtn
              );
            })()}
          </div>

          <div className={styles.sectionDivider} />

          <div className={styles.navScrollSection}>
            {isOpen && <div className={styles.sectionLabel}>{t('sidebar:section.groups')}</div>}

            {filteredGroups.map(({ group, originalIndex }) => {
            const Icon = getGroupIcon(group);
            const isSelected = activeView === 'groups' && selectedGroupIndex === originalIndex;
            const canManage = !isBuiltinGroupId(group.id) && (group.type === 'ai' || group.type === 'agent');
            const menuItems: MenuProps['items'] = [
              {
                key: 'edit',
                label: t('sidebar:actions.editGroup'),
                onClick: () => onEditGroup?.(originalIndex),
              },
              {
                key: 'delete',
                label: t('sidebar:actions.deleteGroup'),
                danger: true,
                onClick: () => onDeleteGroup?.(group, originalIndex),
              },
            ];
            const item = (
              <div className={styles.navItemRow}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onSelectGroup?.(originalIndex);
                  }}
                  className={cx(
                    styles.navItem,
                    styles.navItemMain,
                    isSelected && styles.navItemActive,
                    !isOpen && styles.navItemCollapsed,
                  )}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minWidth: 0,
                      flex: 1,
                      justifyContent: isOpen ? 'flex-start' : 'center',
                    }}
                  >
                    <Icon
                      size={16}
                      style={{
                        flexShrink: 0,
                        color: isSelected ? '#ff6600' : undefined,
                      }}
                    />
                    {isOpen && (
                      <span className={styles.navItemLabel}>{group.name}</span>
                    )}
                  </div>
                  {isOpen && renderGroupTag(
                    group.type || 'ai',
                    styles,
                    cx,
                    getTranslatedGroupTypeShortLabel(t, group.type || 'ai'),
                  )}
                </a>
                {isOpen && canManage && (onEditGroup || onDeleteGroup) && (
                  <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
                    <button
                      type="button"
                      className={cx(styles.navMenuBtn, 'nav-menu-btn')}
                      aria-label={t('sidebar:actions.groupMenu')}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </Dropdown>
                )}
              </div>
            );
            return !isOpen ? (
              <Tooltip
                key={group.id}
                title={group.name}
                placement="right"
                mouseEnterDelay={0.15}
              >
                {item}
              </Tooltip>
            ) : (
              <div key={group.id}>{item}</div>
            );
          })}

          {(() => {
            const btn = (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  setShowCreateWizard(true);
                }}
                className={cx(
                  styles.navItem,
                  styles.createBtn,
                  !isOpen && styles.navItemCollapsed,
                )}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    minWidth: 0,
                    flex: 1,
                    justifyContent: isOpen ? 'flex-start' : 'center',
                  }}
                >
                  <PlusCircleIcon
                    size={16}
                    style={{ color: '#f59e0b', flexShrink: 0 }}
                  />
                  {isOpen && (
                    <span className={styles.navItemLabel}>{t('sidebar:nav.createGroup')}</span>
                  )}
                </div>
              </a>
            );
            return !isOpen ? (
              <Tooltip
                title={t('sidebar:nav.createGroup')}
                placement="right"
                mouseEnterDelay={0.15}
              >
                {btn}
              </Tooltip>
            ) : (
              btn
            );
          })()}
          </div>

          <div className={styles.sectionDivider} />

          <div className={styles.navSection}>
            {isOpen && <div className={styles.sectionLabel}>{t('sidebar:section.resources')}</div>}
            {(() => {
              const libraryBtn = (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenLibrary?.();
                  }}
                  className={cx(
                    styles.navItem,
                    !isOpen && styles.navItemCollapsed,
                  )}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      minWidth: 0,
                      flex: 1,
                      justifyContent: isOpen ? 'flex-start' : 'center',
                    }}
                  >
                    <UsersIcon
                      size={16}
                      style={{ color: '#ff6600', flexShrink: 0 }}
                    />
                    {isOpen && (
                      <span className={styles.navItemLabel}>{t('sidebar:nav.library')}</span>
                    )}
                  </div>
                </a>
              );
              return !isOpen ? (
                <Tooltip
                  title={t('sidebar:nav.library')}
                  placement="right"
                  mouseEnterDelay={0.15}
                >
                  {libraryBtn}
                </Tooltip>
              ) : (
                libraryBtn
              );
            })()}
          </div>
        </nav>

        <UserSection isOpen={isOpen} />

        <SidebarPreferences isOpen={isOpen} />

        <div className={styles.starWrapper}>
          <a href="/" className={styles.brandRow}>
            <span
              className={styles.brand}
              style={
                isOpen
                  ? { fontSize: 16 }
                  : {
                      fontSize: 12,
                      maxWidth: 0,
                      opacity: 0,
                    }
              }
            >
              botgroup.chat
            </span>
            {isOpen && version && (
              <span className={styles.versionBadge}>{version}</span>
            )}
          </a>
          {isOpen && (
            <div className={styles.starButtonWrapper}>
              <GitHubButton
                href="https://github.com/maojindao55/botgroup.chat"
                data-color-scheme={colorScheme}
                data-size="large"
                data-show-count="true"
                aria-label="Star maojindao55/botgroup.chat on GitHub"
              >
                Star
              </GitHubButton>
            </div>
          )}
        </div>
      </div>

      {isOpen && (
        <div className={styles.mobileOverlay} onClick={toggleSidebar} />
      )}
    </>
  );
};

export default Sidebar;
