/**
 * HomeView — 首页/欢迎页
 * 新用户冷启动的默认落地视图：引导选择一种协作方式（角色群 / 专家群 / 开发群），
 * 并提供「我的群聊 / 最近开发任务」快速回到现场。
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Puzzle, Terminal, ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { ActionIcon } from '@lobehub/ui';
import { createStyles } from 'antd-style';

import Sidebar from './Sidebar';
import CreateGroupWizard from './CreateGroupWizard';
import { AppSettingsModal } from './AppSettingsModal';
import type { AppSettingsSection } from '@/config/appSettings';
import { useUserStore } from '@/store/userStore';
import { useIsMobile } from '@/hooks/use-mobile';
import { useCLITaskStore } from '@/store/cliTaskStore';
import {
  getTranslatedGroupTypeLabel,
  getTranslatedGroupTypeDescription,
} from '@/i18n/productLabels';
import type { Group, GroupType } from '@/config/groups';
import { isTauriMacOS } from '@/utils/isTauri';

interface HomeViewProps {
  groups: Group[];
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  onSelectGroup: (index: number) => void;
  onCreateGroup: (group: Group) => void;
  onNavigateCLI: () => void;
  onSelectTask: (taskId: string) => void;
}

type WizardType = 'ai' | 'agent';

const MODE_META: Record<GroupType, { icon: typeof Bot; color: string; bg: string }> = {
  ai: { icon: Bot, color: '#ff6600', bg: 'rgba(255, 102, 0, 0.1)' },
  agent: { icon: Puzzle, color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
  cli: { icon: Terminal, color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
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
    gap: 8px;
    height: 46px;
    box-sizing: border-box;
    padding: 0 12px;
  `,
  headerTitle: css`
    font-size: 15px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  mobileMenuBtn: css`
    @media (min-width: 768px) {
      display: none;
    }
  `,
  scroll: css`
    flex: 1;
    overflow: auto;
    background: linear-gradient(180deg, ${token.colorBgContainer} 0%, ${token.colorFillQuaternary} 100%);
  `,
  content: css`
    max-width: 960px;
    margin: 0 auto;
    padding: 28px 22px 48px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  `,
  hero: css`
    display: flex;
    flex-direction: column;
    gap: 4px;
  `,
  greeting: css`
    font-size: 22px;
    font-weight: 700;
    color: ${token.colorText};
    margin: 0;
    line-height: 1.2;
  `,
  subtitle: css`
    font-size: 13px;
    color: ${token.colorTextSecondary};
    margin: 0;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 10px;
  `,
  sectionTitle: css`
    font-size: 11px;
    font-weight: 600;
    color: ${token.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0;
    margin: 0;
  `,
  cardGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 10px;
  `,
  modeCard: css`
    text-align: left;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: all 0.18s ease;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
    &:hover {
      border-color: rgba(255, 102, 0, 0.35);
      background: ${token.colorFillQuaternary};
    }
  `,
  modeIcon: css`
    width: 34px;
    height: 34px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  `,
  modeText: css`
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  modeTitle: css`
    font-size: 14px;
    font-weight: 600;
    color: ${token.colorText};
  `,
  modeDesc: css`
    font-size: 12px;
    color: ${token.colorTextSecondary};
    line-height: 1.45;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  `,
  modeCta: css`
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: #ff6600;
    flex: none;
  `,
  recentGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
  `,
  recentItem: css`
    text-align: left;
    border: 1px solid ${token.colorBorderSecondary};
    border-radius: 8px;
    background: ${token.colorBgContainer};
    padding: 9px 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 10px;
    transition: all 0.15s ease;
    &:hover {
      border-color: rgba(255, 102, 0, 0.35);
      background: ${token.colorFillQuaternary};
    }
  `,
  recentIcon: css`
    width: 28px;
    height: 28px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: none;
  `,
  recentBody: css`
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  `,
  recentName: css`
    font-size: 13px;
    font-weight: 600;
    color: ${token.colorText};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  recentMeta: css`
    font-size: 11px;
    color: ${token.colorTextTertiary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  linkBtn: css`
    align-self: flex-start;
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    color: #ff6600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  `,
}));

const HomeView = ({
  groups,
  sidebarOpen,
  toggleSidebar,
  onSelectGroup,
  onCreateGroup,
  onNavigateCLI,
  onSelectTask,
}: HomeViewProps) => {
  const { styles } = useStyles();
  const { t } = useTranslation(['home', 'product', 'common']);
  const isMobile = useIsMobile();
  const userStore = useUserStore();
  const tasks = useCLITaskStore((s) => s.tasks);

  const [wizardType, setWizardType] = useState<WizardType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<AppSettingsSection>('general');

  const userName = userStore.userInfo?.nickname?.trim() || t('home:hero.defaultName');
  const hideAppHeaderBar = isTauriMacOS() && !isMobile;

  // 用户自建的群聊（排除内置开发群，它通过「开发群」卡片进入）
  const myGroups = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => group.type === 'ai' || group.type === 'agent');

  // 最近开发任务（按更新时间倒序，取前 6 条，排除归档）
  const recentTasks = [...tasks]
    .filter((task) => task.status !== 'archived')
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    .slice(0, 6);

  const modeCards: { type: GroupType; onClick: () => void }[] = [
    { type: 'ai', onClick: () => setWizardType('ai') },
    { type: 'agent', onClick: () => setWizardType('agent') },
    { type: 'cli', onClick: onNavigateCLI },
  ];

  return (
    <>
      <CreateGroupWizard
        key={wizardType ?? 'closed'}
        open={wizardType !== null}
        onOpenChange={(open) => {
          if (!open) setWizardType(null);
        }}
        onCreateGroup={onCreateGroup}
        fixedGroupType={wizardType ?? undefined}
        onOpenSettings={(section) => {
          setWizardType(null);
          setSettingsSection(section ?? 'general');
          setSettingsOpen(true);
        }}
      />

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
          toggleSidebar={toggleSidebar}
          selectedGroupIndex={-1}
          onSelectGroup={onSelectGroup}
          groups={groups}
          onCreateGroup={onCreateGroup}
          onOpenSettings={(section) => {
            setSettingsSection(section ?? 'general');
            setSettingsOpen(true);
          }}
          activeView="home"
          hiddenGroupTypes={['cli']}
          onNavigateHome={() => {
            if (isMobile) toggleSidebar();
          }}
          onNavigateCLI={onNavigateCLI}
        />

        <div className={styles.rightCol}>
          {!hideAppHeaderBar && (
          <div className={styles.headerBar}>
            <div className={styles.headerInner}>
              <span className={styles.mobileMenuBtn}>
                <ActionIcon icon={MenuIcon} size="small" onClick={toggleSidebar} title="" />
              </span>
              <span className={styles.headerTitle}>{t('home:header.title')}</span>
            </div>
          </div>
          )}

          <div className={styles.scroll}>
            <div className={styles.content}>
              <div className={styles.hero}>
                <h1 className={styles.greeting}>{t('home:hero.greeting', { name: userName })}</h1>
                <p className={styles.subtitle}>{t('home:hero.subtitle')}</p>
              </div>

              <div className={styles.section}>
                <p className={styles.sectionTitle}>{t('home:sectionStart')}</p>
                <div className={styles.cardGrid}>
                  {modeCards.map(({ type, onClick }) => {
                    const meta = MODE_META[type];
                    const Icon = meta.icon;
                    const isCreate = type !== 'cli';
                    return (
                      <button key={type} type="button" className={styles.modeCard} onClick={onClick}>
                        <div className={styles.modeIcon} style={{ background: meta.bg }}>
                          <Icon size={18} style={{ color: meta.color }} />
                        </div>
                        <div className={styles.modeText}>
                          <div className={styles.modeTitle}>{getTranslatedGroupTypeLabel(t, type)}</div>
                          <div className={styles.modeDesc}>{getTranslatedGroupTypeDescription(t, type)}</div>
                        </div>
                        <span className={styles.modeCta}>
                          {isCreate ? t('home:cards.create') : t('home:cards.enter')}
                          <ChevronRight size={15} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {myGroups.length > 0 && (
                <div className={styles.section}>
                  <p className={styles.sectionTitle}>{t('home:recent.groupsTitle')}</p>
                  <div className={styles.recentGrid}>
                    {myGroups.map(({ group, index }) => {
                      const meta = MODE_META[group.type as GroupType] ?? MODE_META.ai;
                      const Icon = meta.icon;
                      return (
                        <button
                          key={group.id}
                          type="button"
                          className={styles.recentItem}
                          onClick={() => onSelectGroup(index)}
                        >
                          <div className={styles.recentIcon} style={{ background: meta.bg }}>
                            <Icon size={16} style={{ color: meta.color }} />
                          </div>
                          <div className={styles.recentBody}>
                            <span className={styles.recentName}>{group.name}</span>
                            <span className={styles.recentMeta}>
                              {getTranslatedGroupTypeLabel(t, group.type as GroupType)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {recentTasks.length > 0 && (
                <div className={styles.section}>
                  <p className={styles.sectionTitle}>{t('home:recent.tasksTitle')}</p>
                  <div className={styles.recentGrid}>
                    {recentTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        className={styles.recentItem}
                        onClick={() => onSelectTask(task.id)}
                      >
                        <div className={styles.recentIcon} style={{ background: MODE_META.cli.bg }}>
                          <Terminal size={16} style={{ color: MODE_META.cli.color }} />
                        </div>
                        <div className={styles.recentBody}>
                          <span className={styles.recentName}>
                            {task.title?.trim() || t('home:recent.emptyTaskTitle')}
                          </span>
                          <span className={styles.recentMeta}>{task.templateSnapshot?.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <button type="button" className={styles.linkBtn} onClick={onNavigateCLI}>
                    {t('home:recent.openDevTasks')}
                    <ChevronRight size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HomeView;
