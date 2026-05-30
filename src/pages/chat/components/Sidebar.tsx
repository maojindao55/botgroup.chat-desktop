import { useState } from 'react';
import {
  Bot,
  Home as HomeIcon,
  Menu as MenuIcon,
  MessageSquare as MessageSquareIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  PlusCircle as PlusCircleIcon,
  Puzzle,
  Terminal,
  Users as UsersIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from 'antd';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';

import { SidebarPreferences } from './SidebarPreferences';
import { UserSection } from './UserSection';
import CreateGroupWizard from './CreateGroupWizard';
import { getTranslatedGroupTypeShortLabel } from '@/i18n/productLabels';
import type { Group, GroupType } from '@/config/groups';

import '@fontsource/audiowide';

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
    gap: 8px;
    padding: 14px 12px;
    border-bottom: 1px solid ${token.colorBorderSecondary};
    flex: none;
  `,
  headerBrand: css`
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  `,
  brand: css`
    font-family: 'Audiowide', system-ui;
    font-size: 15.8px;
    color: #ff6600;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  headerLogo: css`
    width: 22px;
    height: 22px;
    flex-shrink: 0;
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
  brandRow: css`
    display: flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
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
  activeView?: 'groups' | 'cli-tasks' | 'home';
  onNavigateCLI?: () => void;
  onNavigateHome?: () => void;
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
  activeView = 'groups',
  onNavigateCLI,
  onNavigateHome,
  hiddenGroupTypes = [],
}: SidebarProps) => {
  const { styles, cx } = useStyles();
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const { t } = useTranslation(['sidebar', 'common', 'product']);

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
          <a href="/" className={cx(styles.headerBrand, styles.brandRow)} aria-label="botgroup.chat">
            {isOpen ? (
              <span className={styles.brand}>botgroup.chat</span>
            ) : (
              <Tooltip title="botgroup.chat" placement="right" mouseEnterDelay={0.15}>
                <img src="/img/logo.svg" alt="botgroup.chat" className={styles.headerLogo} />
              </Tooltip>
            )}
          </a>
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
              const isHomeActive = activeView === 'home';
              const homeBtn = (
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (onNavigateHome) {
                      onNavigateHome();
                    } else {
                      window.location.href = '?view=home';
                    }
                  }}
                  className={cx(
                    styles.navItem,
                    isHomeActive && styles.navItemActive,
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
                    <HomeIcon
                      size={16}
                      style={{ color: isHomeActive ? '#ff6600' : undefined, flexShrink: 0 }}
                    />
                    {isOpen && <span className={styles.navItemLabel}>{t('sidebar:nav.home')}</span>}
                  </div>
                </a>
              );
              const homeEntry = !isOpen ? (
                <Tooltip title={t('sidebar:nav.home')} placement="right" mouseEnterDelay={0.15}>
                  {homeBtn}
                </Tooltip>
              ) : (
                homeBtn
              );

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
              const devTasksEntry = !isOpen ? (
                <Tooltip title={t('sidebar:nav.devTasks')} placement="right" mouseEnterDelay={0.15}>
                  {devTasksBtn}
                </Tooltip>
              ) : (
                devTasksBtn
              );
              return (
                <>
                  {homeEntry}
                  {devTasksEntry}
                </>
              );
            })()}
          </div>

          <div className={styles.sectionDivider} />

          <div className={styles.navScrollSection}>
            {isOpen && <div className={styles.sectionLabel}>{t('sidebar:section.groups')}</div>}

            {filteredGroups.map(({ group, originalIndex }) => {
            const Icon = getGroupIcon(group);
            const isSelected = activeView === 'groups' && selectedGroupIndex === originalIndex;
            const item = (
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  onSelectGroup?.(originalIndex);
                }}
                className={cx(
                  styles.navItem,
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
      </div>

      {isOpen && (
        <div className={styles.mobileOverlay} onClick={toggleSidebar} />
      )}
    </>
  );
};

export default Sidebar;
