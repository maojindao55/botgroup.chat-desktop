import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { MessageSquareIcon, PlusCircleIcon, MenuIcon, PanelLeftCloseIcon, Sun, Moon, Monitor, Bot, Terminal, Puzzle, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import GitHubButton from 'react-github-btn';
import '@fontsource/audiowide';
import { UserSection } from './UserSection';
import { useTheme } from '@/hooks/use-theme';
import CreateGroupWizard from './CreateGroupWizard';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

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

// 根据群聊类型获取 Tag 标签
const getGroupTag = (type: string) => {
  switch (type) {
    case 'ai':
      return (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#ff6600]/10 text-[#ff6600]">
          AI
        </span>
      );
    case 'cli':
      return (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
          CLI
        </span>
      );
    case 'agent':
      return (
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400">
          Agent
        </span>
      );
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


  // 搜索状态
  const [searchQuery, setSearchQuery] = useState('');

  // 过滤群聊并保留原始索引
  const filteredGroups = groups
    .map((group, originalIndex) => ({ group, originalIndex }))
    .filter(({ group }) =>
      group.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

  return (
    <TooltipProvider>
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

          {/* 搜索框 */}
          {isOpen ? (
            <div className="px-3 pt-3 pb-1 relative flex-none">
              <div className="relative flex items-center bg-muted/50 dark:bg-zinc-800/50 border border-border/40 focus-within:border-[#ff6600]/40 rounded-xl transition-all h-9">
                <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground/60" />
                <input
                  type="text"
                  placeholder="搜索群聊..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border-0 outline-none text-xs pl-8 pr-7 text-foreground placeholder:text-muted-foreground/50 h-full"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 text-muted-foreground/60 hover:text-foreground p-0.5 rounded-full hover:bg-muted"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="px-2 pt-2 pb-1 flex justify-center flex-none">
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60"
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-auto p-2">
            <nav className="space-y-1">
              {filteredGroups.length === 0 && searchQuery.trim() !== '' && (
                <div className="text-center py-6 px-4">
                  <p className="text-xs text-muted-foreground/60">未找到匹配的群聊</p>
                </div>
              )}

              {filteredGroups.map(({ group, originalIndex }) => {
                const Icon = getGroupIcon(group);
                const isSelected = selectedGroupIndex === originalIndex;
                const itemContent = (
                  <a
                    key={group.id}
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectGroup?.(originalIndex);
                    }}
                    className={cn(
                      "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium transition-all group relative overflow-hidden",
                      !isOpen && "md:justify-center",
                      isSelected
                        ? "bg-[#ff6600]/10 text-[#ff6600] font-semibold dark:bg-[#ff6600]/15"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/40"
                    )}
                  >
                    {isSelected && (
                      <span className="absolute left-0 top-2.5 bottom-2.5 w-0.5 bg-[#ff6600] rounded-r-full" />
                    )}
                    
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <Icon
                        className={cn(
                          "h-4 w-4 flex-shrink-0 transition-transform group-hover:scale-110 duration-200",
                          isSelected ? "text-[#ff6600]" : "text-muted-foreground/80 group-hover:text-foreground"
                        )}
                      />
                      <span className={cn(
                        "transition-all duration-200 whitespace-nowrap overflow-hidden text-ellipsis",
                        isOpen ? "opacity-100 max-w-full" : "opacity-0 max-w-0 md:max-w-0"
                      )}>
                        {group.name}
                      </span>
                    </div>

                    {isOpen && (
                      <div className="flex-shrink-0 ml-2 transition-opacity duration-200 opacity-90 group-hover:opacity-100">
                        {getGroupTag(group.type || 'ai')}
                      </div>
                    )}
                  </a>
                );

                // 收起状态下增加提示
                if (!isOpen) {
                  return (
                    <Tooltip key={group.id} delayDuration={150}>
                      <TooltipTrigger asChild>
                        {itemContent}
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {group.name}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return itemContent;
              })}

              {/* 创建新群聊按钮 */}
              {(() => {
                const createBtn = (
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
                );

                if (!isOpen) {
                  return (
                    <Tooltip delayDuration={150}>
                      <TooltipTrigger asChild>
                        {createBtn}
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        创建新群聊
                      </TooltipContent>
                    </Tooltip>
                  );
                }
                return createBtn;
              })()}
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
                  <span className="text-[10px] text-muted-foreground/60 self-end mb-0.5">{version}</span>
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
    </TooltipProvider>
  );
};

export default Sidebar;
