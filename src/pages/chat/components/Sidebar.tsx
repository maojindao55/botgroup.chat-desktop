import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { MessageSquareIcon, PlusCircleIcon, MenuIcon, PanelLeftCloseIcon, Sun, Moon, Monitor, Bot, Terminal, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";
import GitHubButton from 'react-github-btn';
import '@fontsource/audiowide';
import { UserSection } from './UserSection';
import { useTheme } from '@/hooks/use-theme';
import CreateGroupWizard from './CreateGroupWizard';

import type { Group } from '@/config/groups';


// 根据群聊类型获取图标
const getGroupIcon = (group: Group) => {
  switch (group.type) {
    case 'ai': return Bot;
    case 'cli': return Terminal;
    case 'agent': return Puzzle;
    default: return MessageSquareIcon;
  }
};

// 群类型分类标题
const GROUP_TYPE_LABELS: Record<string, string> = {
  ai: '🤖 AI 群聊',
  cli: '🛠️ CLI Agent',
  agent: '🧩 Agent 群',
};

interface SidebarProps {
  isOpen: boolean;
  toggleSidebar: () => void;
  selectedGroupIndex?: number;
  onSelectGroup?: (index: number) => void;
  groups: Group[];
  onCreateGroup?: (group: Group) => void;
}

const Sidebar = ({ isOpen, toggleSidebar, selectedGroupIndex = 0, onSelectGroup, groups, onCreateGroup }: SidebarProps) => {
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [version, setVersion] = useState('');
  const { theme, resolvedTheme, setTheme } = useTheme();

  const colorScheme = resolvedTheme === 'dark'
    ? 'no-preference: dark; light: dark; dark: dark;'
    : 'no-preference: light; light: light; dark: light;';

  useEffect(() => {
    fetch('https://api.github.com/repos/maojindao55/botgroup.chat/releases/latest')
      .then(r => r.json())
      .then(data => { if (data.tag_name) setVersion(data.tag_name); })
      .catch(() => {});
  }, []);

  const handleCreateGroup = (group: Group) => {
    onCreateGroup?.(group);
  };


  // 按类型分组
  const groupsByType = groups.reduce<Record<string, { group: Group; originalIndex: number }[]>>((acc, group, idx) => {
    const type = group.type || 'ai';
    if (!acc[type]) acc[type] = [];
    acc[type].push({ group, originalIndex: idx });
    return acc;
  }, {});

  // 排序：ai → cli → agent
  const typeOrder = ['ai', 'cli', 'agent'];
  const sortedTypes = typeOrder.filter(t => groupsByType[t]?.length > 0);

  return (
    <>
      {/* 创建群聊向导 */}
      <CreateGroupWizard
        open={showCreateWizard}
        onOpenChange={setShowCreateWizard}
        onCreateGroup={handleCreateGroup}
      />

      {/* 侧边栏 */}
      <div
        className={cn(
          "transition-all duration-300 ease-in-out",
          "fixed md:relative z-20 h-full",
          isOpen ? "w-48 translate-x-0" : "w-0 md:w-14 -translate-x-full md:translate-x-0"
        )}
      >
        <div className="h-full border-r border-border/60 bg-slate-50 dark:bg-zinc-900 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-3.5 border-b border-border/60">
            <div className="flex-1 flex items-center">
              <span className={cn(
                "font-semibold text-sm tracking-wide text-foreground/90 transition-all duration-200 whitespace-nowrap overflow-hidden",
                isOpen ? "opacity-100 max-w-full mr-2 pl-2" : "opacity-0 max-w-0 md:max-w-0"
              )}>
                工作空间
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className={cn(
                  "text-muted-foreground hover:text-primary h-7 w-7 rounded-lg hover:bg-accent/60",
                  isOpen ? "ml-auto" : "mx-auto md:ml-auto"
                )}
              >
                {isOpen ? <PanelLeftCloseIcon className="h-4 w-4" /> : <MenuIcon className="h-4 w-4" />}
              </Button>
            </div>
          </div>


          <div className="flex-1 overflow-auto p-2">
            <nav className="space-y-1">
              {sortedTypes.map(type => (
                <div key={type}>
                  {/* 分类标题 - 仅侧边栏展开时显示 */}
                  <div className={cn(
                    "px-3 py-1.5 transition-all duration-200",
                    isOpen ? "opacity-100" : "opacity-0 h-0 overflow-hidden"
                  )}>
                    <span className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
                      {GROUP_TYPE_LABELS[type]}
                    </span>
                  </div>

                  {groupsByType[type].map(({ group, originalIndex }) => {
                    const Icon = getGroupIcon(group);
                    return (
                      <a
                        key={group.id}
                        href="#"
                        onClick={(e) => {
                          e.preventDefault();
                          onSelectGroup?.(originalIndex);
                        }}
                        className={cn(
                          "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all group relative overflow-hidden",
                          !isOpen && "md:justify-center",
                          selectedGroupIndex === originalIndex
                            ? "bg-[#ff6600]/10 text-[#ff6600] font-semibold dark:bg-[#ff6600]/15"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                        )}
                      >
                        {selectedGroupIndex === originalIndex && (
                          <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 bg-[#ff6600] rounded-r-full" />
                        )}
                        <Icon
                          className={cn(
                            "h-4 w-4 flex-shrink-0 transition-transform group-hover:scale-110 duration-200",
                            selectedGroupIndex === originalIndex ? "text-[#ff6600]" : "text-muted-foreground/80 group-hover:text-foreground"
                          )}
                        />
                        <span className={cn(
                          "transition-all duration-200 whitespace-nowrap overflow-hidden text-ellipsis",
                          isOpen ? "opacity-100 max-w-full" : "opacity-0 max-w-0 md:max-w-0"
                        )}>{group.name}</span>
                      </a>
                    );
                  })}
                </div>
              ))}

              {/* 创建新群聊按钮 */}
              <a
                href="#"
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-all hover:bg-accent/40 group mt-3",
                  !isOpen && "md:justify-center"
                )}
                onClick={(e) => {
                  e.preventDefault();
                  setShowCreateWizard(true);
                }}
              >
                <PlusCircleIcon className="h-4 w-4 flex-shrink-0 text-amber-500 group-hover:scale-110 transition-transform duration-200" />
                <span className={cn(
                  "transition-all duration-200 whitespace-nowrap overflow-hidden text-foreground/80",
                  isOpen ? "opacity-100 max-w-full" : "opacity-0 max-w-0 md:max-w-0"
                )}>创建新群聊</span>
              </a>
            </nav>
          </div>


          {/* 用户信息模块 */}
          <UserSection isOpen={isOpen} />

          {/* 暗黑模式切换 */}
          <div className={cn(
            "px-3 py-2 border-t border-border/60 bg-white/50 dark:bg-zinc-950/50",
            !isOpen && "flex justify-center"
          )}>
            {isOpen ? (
              <div className="flex items-center gap-0.5 bg-secondary/80 backdrop-blur-sm rounded-xl p-0.5 w-full justify-between">
                <Button variant="ghost" size="icon" onClick={() => setTheme('system')}
                  className={cn("h-6 flex-1 rounded-lg text-muted-foreground hover:text-foreground transition-all text-xs",
                    theme === 'system' && "bg-background shadow-sm text-foreground font-medium")}>
                  <Monitor className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setTheme('light')}
                  className={cn("h-6 flex-1 rounded-lg text-muted-foreground hover:text-foreground transition-all text-xs",
                    theme === 'light' && "bg-background shadow-sm text-foreground font-medium")}>
                  <Sun className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setTheme('dark')}
                  className={cn("h-6 flex-1 rounded-lg text-muted-foreground hover:text-foreground transition-all text-xs",
                    theme === 'dark' && "bg-background shadow-sm text-foreground font-medium")}>
                  <Moon className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <Button variant="ghost" size="icon" onClick={() => setTheme('system')}
                  className={cn("h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground",
                    theme === 'system' && "bg-background shadow-sm text-foreground")}>
                  <Monitor className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setTheme('light')}
                  className={cn("h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground",
                    theme === 'light' && "bg-background shadow-sm text-foreground")}>
                  <Sun className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" onClick={() => setTheme('dark')}
                  className={cn("h-6 w-6 rounded-lg text-muted-foreground hover:text-foreground",
                    theme === 'dark' && "bg-background shadow-sm text-foreground")}>
                  <Moon className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>


          {/* GitHub Star Button */}
          <div className="px-3 py-3 bg-muted/40">
            <div className="flex items-center justify-left mb-2.5">
              <a href="/" className="flex items-center gap-1.5">
                <span
                  style={{ fontFamily: 'Audiowide, system-ui', color: '#ff6600' }}
                  className={cn(
                    "transition-all duration-200 whitespace-nowrap overflow-hidden font-semibold tracking-wide",
                    isOpen ? "text-base" : "text-xs max-w-0 opacity-0 md:max-w-0"
                  )}
                >
                  botgroup.chat
                </span>
                {isOpen && version && (
                  <span className="text-[9px] text-muted-foreground/60 self-end mb-0.5">{version}</span>
                )}
              </a>
            </div>

            {isOpen && (
              <div className="flex items-center justify-left h-7 scale-90 -ml-1">
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
      </div>

      {/* 移动设备遮罩层 */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-10 md:hidden"
          onClick={toggleSidebar}
        />
      )}
    </>
  );
};

export default Sidebar;
