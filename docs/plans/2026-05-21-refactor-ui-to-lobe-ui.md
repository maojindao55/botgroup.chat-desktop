# 将 UI 重构为 @lobehub/ui 实施方案

> **致执行方（人或 Agent）：** 本方案按任务粒度切分，每个任务自带文件清单、代码片段、验证命令与提交点。建议每完成一个 Task 进行一次 `git commit`，便于逐步回滚与代码评审。
>
> **执行模式：** 推荐使用 superpowers:subagent-driven-development 逐任务执行；如果选择 inline 执行，请在每个 Phase 结束后做一次 checkpoint。

**目标：** 将 `botgroup-chat-desktop`（Tauri + React 18 + shadcn/ui + Tailwind）的 UI 层重构到 [@lobehub/ui](https://github.com/lobehub/lobe-ui) v5.x，保留全部业务功能与交互（聊天流式渲染、Markdown/KaTeX、CLI/Agent/AI 三种群聊、群创建向导、设置抽屉、分享海报、登录、主题切换、API Key 管理、Tauri IPC 等）。

**架构思路：**
1. **并行共存**：先把 lobe-ui（Antd v6 + antd-style + motion）与现有 shadcn/Tailwind 同时引入，新组件用 lobe-ui，旧组件保持可工作。
2. **自底向上替换**：先把 `App.tsx` 包上 ConfigProvider/ThemeProvider/AntdApp，再换叶子组件（按钮、头像、输入、对话框），再换容器（Sidebar、Header），最后换页面（ChatUI、AgentChatUI、Login、Wizard、Settings）。
3. **业务逻辑零侵入**：所有 `useState`、`useEffect`、`request`、`engine/agentEngine`、`store/userStore`、Tauri `invoke` 调用、SSE 流处理、`dom-to-image` 海报生成等业务代码保持不变；只替换渲染层。
4. **主题对齐**：把现有 `#ff6600` 主色与亮/暗/系统切换映射到 antd-style `createStyles` + `ThemeProvider` 的 `themeMode` / `customToken`。

**技术栈变更：**

| 项目 | 之前 | 之后 |
|------|------|------|
| UI 组件库 | shadcn/ui (Radix Primitives) | @lobehub/ui v5 + antd v6 |
| 样式方案 | TailwindCSS + CSS Variables | antd-style (Emotion CSS-in-JS) + Tailwind（仅保留布局原子类） |
| 动画 | tailwindcss-animate | motion (formerly framer-motion) |
| 图标 | lucide-react 0.263 | lucide-react ≥1.11（lobe-ui peerDep）+ @lobehub/icons |
| Markdown | react-markdown@9 + remark/rehype | `<Markdown />` from `@lobehub/ui` |
| React | 18.2 | 19.x（lobe-ui v5 peerDep `react ^19`） |

**关键风险与缓解：**
- **lobe-ui v5 仅支持 React 19**，必须升级 React 与 react-dom，并验证 Radix、Zustand、react-router-dom@7、Tauri 等是否兼容（实测均兼容 React 19）。
- **ESM-only**：Vite 直接支持，无需额外配置。Tauri 也不影响。
- **Tailwind 与 Antd 样式冲突**：Antd v6 不再注入全局 reset；Tailwind preflight 会覆盖 antd 字号/行高。要在 `tailwind.config.cjs` 中关闭 preflight 或仅启用 `corePlugins.preflight=false`，并仅在 layout 处保留 `flex/grid` 等无副作用原子类。
- **`scale=esnext`** 已在 vite.config.ts 配置，满足 lobe-ui ESM。

---

## 文件结构

迁移过程中会改动/新增的关键文件：

```
src/
├── App.tsx                              [改] 添加 ThemeProvider / ConfigProvider / AntdApp
├── main.tsx                             [改] (按需) 引入 motion LazyMotion
├── index.css                            [改] 删除大量 @apply / CSS 变量，保留少量全局 reset
├── lib/
│   ├── utils.ts                          [保留] cn() 仍可用
│   └── theme.ts                         [新建] 统一导出 customToken/themeMode 计算
├── hooks/
│   ├── use-theme.ts                     [改] 输出值同时驱动 lobe-ui ThemeProvider
│   └── use-mobile.tsx                   [保留]
├── layouts/
│   └── BasicLayout.tsx                  [改] 用 @lobehub/ui Layout
├── components/
│   ├── ui/*                             [保留] 暂不删，迁移完成的 Task 末尾再删
│   └── AuthGuard.jsx                    [保留]
├── pages/
│   ├── login/index.jsx                  [改] Button/Center/Logo 来自 @lobehub/ui
│   └── chat/
│       ├── index.tsx                    [保留]
│       └── components/
│           ├── ChatUI.tsx               [大改] ChatItem/ChatInputArea/Markdown
│           ├── AgentChatUI.tsx          [大改] 同上
│           ├── Sidebar.tsx              [大改] SideNav/ActionIcon
│           ├── Header.tsx               [改] Header
│           ├── UserSection.tsx          [改] Avatar/EditableText/Modal/Form
│           ├── CreateGroupWizard.tsx    [大改] FormModal + Form steps
│           ├── AIGroupSettings.tsx      [改] Drawer + Form
│           ├── CLIGroupSettings.tsx     [改] Drawer + Form
│           ├── AgentGroupSettings.tsx   [改] Drawer + Collapse/Form
│           ├── SharePoster.tsx          [改] Modal
│           └── AdSection.tsx            [保留] 用 Block/Tag
docs/
└── plans/2026-05-21-refactor-ui-to-lobe-ui.md   [新建] (本文件)
package.json                             [改] 升级 react/添加 antd/lobe-ui/antd-style/motion
tailwind.config.cjs                       [改] 关闭 preflight、移除 sidebar/chart 颜色
postcss.config.cjs                        [保留]
```

> 替换叶子组件时，旧的 `@/components/ui/*` 文件先**保留**，待该 Phase 全部页面替换完毕、回归通过后再统一删除（避免半成品状态构建失败）。

---

## Phase 0 — 依赖与运行时基座

### Task 0.1: 升级 React 到 19 并安装 lobe-ui 全家桶

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 在工作目录运行依赖升级命令**

```bash
cd /workspace
npm pkg set dependencies.react="^19.0.0"
npm pkg set dependencies.react-dom="^19.0.0"
npm pkg set devDependencies.@types/react="^19.0.0"
npm pkg set devDependencies.@types/react-dom="^19.0.0"
npm install --save \
  @lobehub/ui@^5.14.3 \
  @lobehub/icons@^5.6.0 \
  @lobehub/fluent-emoji@^4.1.0 \
  antd@^6.1.1 \
  antd-style@^4.1.0 \
  motion@^12.0.0
npm install
```

- [ ] **Step 2: 校验** — `node -e "require('@lobehub/ui/package.json')"`（应无报错）。

- [ ] **Step 3: 启动 dev 验证基础启动**

```bash
npm run dev
```

预期：Vite 启动至 `http://localhost:1420`，浏览器打开页面应仍是旧的 shadcn/UI，没有运行时错误（控制台允许有 React 19 act() warning）。

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): upgrade react to 19, add lobe-ui antd antd-style motion"
```

---

### Task 0.2: 在 App 根节点注入 ConfigProvider / ThemeProvider / AntdApp

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Create: `src/lib/theme.ts`

- [ ] **Step 1: 创建主题映射**

```ts
// src/lib/theme.ts
import type { ThemeProviderProps } from '@lobehub/ui';

export const lobeCustomToken: ThemeProviderProps['customToken'] = () => ({
  colorBrandPrimary: '#ff6600',
  colorBrandSecondary: '#f59e0b',
  colorBrandHover: '#e65c00',
});

export const lobeThemeConfig: ThemeProviderProps['theme'] = () => ({
  token: {
    colorPrimary: '#ff6600',
    borderRadius: 12,
    fontFamily: '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
});
```

- [ ] **Step 2: 改 App.tsx**

```tsx
// src/App.tsx
import { RouterProvider } from 'react-router-dom';
import { App as AntdApp } from 'antd';
import { ThemeProvider, ConfigProvider } from '@lobehub/ui';
import { motion } from 'motion/react';
import { Toaster } from 'sonner';
import { router } from './routes';
import { useTheme } from './hooks/use-theme';
import { lobeCustomToken, lobeThemeConfig } from './lib/theme';

function App() {
  const { resolvedTheme } = useTheme();
  return (
    <ConfigProvider motion={motion}>
      <ThemeProvider
        themeMode={resolvedTheme === 'dark' ? 'dark' : 'light'}
        customToken={lobeCustomToken}
        theme={lobeThemeConfig}
      >
        <AntdApp>
          <RouterProvider router={router} />
          <Toaster position="top-center" richColors theme={resolvedTheme}
            toastOptions={{ style: { fontSize: '14px', fontWeight: '500' } }} />
        </AntdApp>
      </ThemeProvider>
    </ConfigProvider>
  );
}
export default App;
```

- [ ] **Step 3: 验证渲染**

```bash
npm run dev
```

打开页面 → 控制台无 `ThemeProvider not found` / `ConfigProvider not found` 警告，UI 视觉无明显改变（旧 shadcn 仍在渲染）。

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/lib/theme.ts
git commit -m "feat(theme): wrap app with lobe-ui ConfigProvider/ThemeProvider/AntdApp"
```

---

### Task 0.3: 关闭 Tailwind preflight 防止与 Antd 冲突

**Files:**
- Modify: `tailwind.config.cjs`
- Modify: `src/index.css`

- [ ] **Step 1: 修改 tailwind.config.cjs，关闭 preflight，避免重置 antd 默认样式**

```js
module.exports = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],
  corePlugins: {
    preflight: false,
  },
  theme: { extend: { /* 保留现有 colors/borderRadius */ } },
  plugins: [require('@tailwindcss/typography'), require('tailwindcss-animate')],
};
```

- [ ] **Step 2: 在 index.css 仅保留必要全局 reset**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@import url('https://fonts.googleapis.com/css2?family=Audiowide:wght@400&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');

html { font-size: 17px; }
body { font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
code, pre, kbd, samp, .font-mono {
  font-family: 'JetBrains Mono', Menlo, Monaco, Consolas, monospace !important;
}

/* 保留：流式光标 / scrollbar / details 渐进披露样式 */
.typing-indicator { display: inline-block; animation: blink 1s step-end infinite; }
@keyframes blink { 50% { opacity: 0; } }
```

> 注意：删除现有的 `:root { --background ... }` 全部 HSL 变量、`.dark { ... }` 块，由 `ThemeProvider` 接管。`.chat-message details` 等暂时保留，待 Markdown 组件替换时再决定是否删除。

- [ ] **Step 3: 验证页面仍可渲染、不破坏字体**

`npm run dev` → 视觉上 shadcn 控件可能"轻微"变样（边框/聚焦色失常），但布局应保持。

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.cjs src/index.css
git commit -m "style(tailwind): disable preflight to coexist with antd v6 reset"
```

---

## Phase 1 — 主壳层（Layout / Header / Sidebar）

### Task 1.1: 重写 Header（顶部主题切换 + GitHub Star）

**Files:**
- Modify: `src/pages/chat/components/Header.tsx`

- [ ] **Step 1: 替换为 lobe-ui Header + ActionIcon 三态切换**

```tsx
// src/pages/chat/components/Header.tsx
import { ActionIcon, Header as LobeHeader, Segmented } from '@lobehub/ui';
import { Sun, Moon, Monitor } from 'lucide-react';
import GitHubButton from 'react-github-btn';
import { useTheme } from '@/hooks/use-theme';
import '@fontsource/audiowide';

const Header: React.FC = () => {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const colorScheme = resolvedTheme === 'dark' ? 'dark' : 'light';

  return (
    <LobeHeader
      logo={
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/img/logo.svg" alt="logo" style={{ width: 24, height: 24 }} />
          <span style={{ fontFamily: 'Audiowide, system-ui', color: '#ff6600', fontSize: 22 }}>
            botgroup.chat
          </span>
        </a>
      }
      actions={[
        <Segmented
          key="theme"
          value={theme}
          onChange={(v) => setTheme(v as any)}
          options={[
            { value: 'system', icon: <Monitor size={14} /> },
            { value: 'light',  icon: <Sun size={14} /> },
            { value: 'dark',   icon: <Moon size={14} /> },
          ]}
          size="small"
          shape="round"
        />,
        <GitHubButton key="star"
          href="https://github.com/maojindao55/botgroup.chat"
          data-color-scheme={`no-preference: ${colorScheme}; light: ${colorScheme}; dark: ${colorScheme};`}
          data-size="large" data-show-count="true"
          aria-label="Star maojindao55/botgroup.chat on GitHub">Star</GitHubButton>,
      ]}
    />
  );
};
export default Header;
```

- [ ] **Step 2: 视觉走查** — `npm run dev` → 顶部 Header 显示 logo、主题三态切换可用、Star 按钮渲染。

- [ ] **Step 3: Commit**

```bash
git add src/pages/chat/components/Header.tsx
git commit -m "refactor(ui): port Header to @lobehub/ui Header+Segmented"
```

---

### Task 1.2: 重写 Sidebar（左侧群聊列表 + 搜索 + 主题切换 + 用户区）

**Files:**
- Modify: `src/pages/chat/components/Sidebar.tsx`

> 因为 Sidebar 涉及移动端遮罩、折叠动画、群聊筛选、底部用户区，建议先**保留状态/筛选/事件**，仅替换渲染层。

- [ ] **Step 1: 把容器换成 lobe-ui Flexbox + DraggableSideNav (或 Block)**，群项用 `Menu` + `Avatar` + `Tag`，搜索框用 `Input.Search`（来自 `antd`）：

```tsx
import { Flexbox } from 'react-layout-kit';
import { Avatar, ActionIcon, Tag, Block } from '@lobehub/ui';
import { Input, Menu, Tooltip, Segmented } from 'antd';
import {
  PanelLeftClose as PanelLeftCloseIcon,
  Menu as MenuIcon, Search, X,
  Bot, Terminal, Puzzle, MessageSquare, PlusCircle,
  Sun, Moon, Monitor,
} from 'lucide-react';

// 保留 getGroupIcon / getGroupTag / filteredGroups 逻辑，仅替换 JSX：
// - 群项: <Menu items={...} selectedKeys={[String(selectedGroupIndex)]} onClick={...} />
// - 主题切换: <Segmented options={...} />
// - 折叠按钮: <ActionIcon icon={isOpen ? PanelLeftCloseIcon : MenuIcon} onClick={toggleSidebar} />
// - 创建按钮: <ActionIcon icon={PlusCircle} title="创建新群聊" onClick={() => setShowCreateWizard(true)} />
```

> **核心约束**：保留 `isOpen` 折叠状态、移动端 fixed + 遮罩、`onSelectGroup` 回调、`searchQuery` 筛选、`UserSection` 嵌入位置。

- [ ] **Step 2: 用 antd-style createStyles 抽离 Sidebar 自有样式**（不再依赖 `cn()` 与 Tailwind 颜色类）：

```tsx
import { createStyles } from 'antd-style';
const useStyles = createStyles(({ token, css }) => ({
  container: css`
    width: 192px;
    height: 100%;
    border-right: 1px solid ${token.colorBorderSecondary};
    background: ${token.colorBgLayout};
    transition: width .2s ease;
  `,
  collapsed: css` width: 56px; `,
  brand: css` font-family: 'Audiowide', system-ui; color: #ff6600; font-size: 16px; `,
  active: css` color: #ff6600 !important; background: rgba(255,102,0,0.1) !important; `,
  // ...
}));
```

- [ ] **Step 3: 验证** — `npm run dev`，依次测试：
  1. 桌面端：点击折叠按钮，宽度从 192px 收到 56px；
  2. 移动端：调浏览器到 mobile 视口，遮罩出现；
  3. 群聊筛选：输入"AI"，列表过滤；
  4. 选中群聊：左侧出现橙色指示条；
  5. 主题切换：light/dark/system 三态生效。

- [ ] **Step 4: Commit**

```bash
git add src/pages/chat/components/Sidebar.tsx
git commit -m "refactor(ui): port Sidebar to @lobehub/ui + antd-style createStyles"
```

---

### Task 1.3: BasicLayout 改为 lobe-ui Layout

**Files:**
- Modify: `src/layouts/BasicLayout.tsx`

- [ ] **Step 1: 替换实现**

```tsx
// src/layouts/BasicLayout.tsx
import { Outlet, useNavigate } from 'react-router-dom';
import { Layout } from '@lobehub/ui';
import { Button } from 'antd';

export default function BasicLayout() {
  const navigate = useNavigate();
  const handleLogout = () => { localStorage.removeItem('token'); navigate('/login'); };
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}
```

> 注：现有 `BasicLayout` 中的"退出登录" header 实际未被使用（ChatUI 全屏覆盖了），可以删除；保留为 `<Outlet />` 即可。

- [ ] **Step 2: 验证** — `npm run dev` → 页面布局结构无破坏。

- [ ] **Step 3: Commit**

```bash
git add src/layouts/BasicLayout.tsx
git commit -m "refactor(ui): simplify BasicLayout via @lobehub/ui Layout"
```

---

## Phase 2 — 聊天核心（ChatUI / AgentChatUI / Markdown）

### Task 2.1: 引入统一的 Markdown 渲染组件，替换两处巨型 ReactMarkdown

**Files:**
- Create: `src/components/Markdown.tsx`
- Modify: `src/pages/chat/components/ChatUI.tsx` (line ~586-686)
- Modify: `src/pages/chat/components/AgentChatUI.tsx` (line ~290-352)

- [ ] **Step 1: 创建复用组件**

```tsx
// src/components/Markdown.tsx
import { Markdown as LobeMarkdown } from '@lobehub/ui';

export interface ChatMarkdownProps {
  content: string;
  isUser?: boolean;
}

export function ChatMarkdown({ content, isUser }: ChatMarkdownProps) {
  return (
    <LobeMarkdown
      enableImageGallery
      enableLatex
      enableMermaid
      variant={isUser ? 'chat' : 'chat'}
      style={isUser ? { color: '#fff' } : undefined}
    >
      {content}
    </LobeMarkdown>
  );
}
```

> `@lobehub/ui` 的 `<Markdown>` 已内置 `remark-gfm` / `remark-math` / `rehype-katex` / shiki 高亮，无需再手动拼装 remark/rehype 插件，也无需 KaTeXStyle hack。

- [ ] **Step 2: 在 ChatUI.tsx 与 AgentChatUI.tsx 中替换 `<ReactMarkdown ...>` 那一整块 className 为：**

```tsx
<ChatMarkdown content={message.content} isUser={message.sender.name === userName} />
```

- [ ] **Step 3: 删除两个文件顶部的 `import ReactMarkdown` / `remarkGfm` / `remarkMath` / `rehypeKatex` / `rehypeRaw` / `KaTeXStyle` 引用**，以及 `<KaTeXStyle />` 渲染。

- [ ] **Step 4: 验证流式输出**

`npm run dev` → 进入一个 AI 群发送消息：
  1. 流式 token 实时追加；
  2. 代码块带语法高亮；
  3. 数学公式 `$\frac{a}{b}$` 正确渲染；
  4. `<details><summary>` 块（CLI 执行过程）可折叠；
  5. 用户气泡仍为橙色渐变。

- [ ] **Step 5: Commit**

```bash
git add src/components/Markdown.tsx src/pages/chat/components/ChatUI.tsx src/pages/chat/components/AgentChatUI.tsx
git commit -m "refactor(chat): unify markdown rendering via @lobehub/ui Markdown"
```

---

### Task 2.2: ChatUI 主体：ChatItem / ChatInputArea / Avatar 替换

**Files:**
- Modify: `src/pages/chat/components/ChatUI.tsx`

> 这是工作量最大的一个 Task。建议**先在分支上备份原文件** (`cp ChatUI.tsx ChatUI.tsx.bak` 仅本地，不入库)，再分小段替换。

- [ ] **Step 1: 替换 imports**

```tsx
import { ChatItem, ChatInputArea, ActionIcon, Avatar as LobeAvatar, Tag } from '@lobehub/ui';
import { Tooltip } from 'antd';
import { Send, Share2, Settings2, ChevronLeft, Bot, Terminal } from 'lucide-react';
import { ChatMarkdown } from '@/components/Markdown';
```

- [ ] **Step 2: 替换 Header 区域（line ~480-547）**：将自定义 header 改为 `@lobehub/ui` 的 `Header`（参考 Task 1.1 样式），把"群聊名称 + 成员数 + 头像组 + 设置按钮"挪到 `actions` 槽位。Avatar 组用 `<Avatar.Group>`（来自 antd v6）。

- [ ] **Step 3: 替换消息列表（line ~556-704）**：

```tsx
{messages.map((message) => {
  const isUser = message.sender.name === userName;
  const isStreaming = message.isAI && isLoading
    && messages[messages.length - 1]?.id === message.id;
  return (
    <ChatItem
      key={message.id}
      placement={isUser ? 'right' : 'left'}
      avatar={{
        avatar: resolveAvatarByName(message.sender.name, message.sender.avatar),
        title: message.sender.name,
        background: getAvatarData(message.sender.name).backgroundColor,
      }}
      loading={isStreaming && message.content === ''}
      messageExtra={isStreaming && message.content !== '' && (
        <Tag color="orange">
          {message.sender?.id?.startsWith('cli-') ? '执行中' : '输出中'}
        </Tag>
      )}
      renderMessage={() => <ChatMarkdown content={message.content} isUser={isUser} />}
    />
  );
})}
```

> `ChatItem` 内部已经实现"头像 + 名称 + 时间 + 气泡 + extra"的布局；右侧 `placement="right"` 自动渲染用户消息样式。**保留**外层 `space-y-4` ScrollArea。

- [ ] **Step 4: 替换输入区（line ~712-748）**：

```tsx
<ChatInputArea
  value={inputMessage}
  onInput={setInputMessage}
  onSend={handleSendMessage}
  loading={isLoading}
  placeholder={isCLIGroup ? '输入指令，CLI Agent 将在 workspace 中执行...' : '输入消息...'}
  leftActions={messages.length > 0 ? [
    <ActionIcon key="share" icon={Share2} title="分享聊天记录" onClick={() => setShowPoster(true)} />,
  ] : undefined}
/>
```

> `ChatInputArea` 自动支持 `Enter` 发送、Shift+Enter 换行、loading 态发送按钮。需要在 `onSend` 中**保持**现有 `handleSendMessage` 不动。

- [ ] **Step 5: 保留初始化加载/错误页**（line ~188-207），仅把 `bg-gradient-to-br ...` 换成 antd-style 等价样式（或保留 Tailwind 也可）。

- [ ] **Step 6: 验证功能（关键回归清单）**

```
[ ] 进入页面 → 默认群聊 "硅碳生命体交流群" 正常展示
[ ] 发送 "你好" → AI 接龙回复，流式打字效果在
[ ] CLI 群（AI Coding 工作组）→ workspace path 显示在 header 子行
[ ] 头部头像组：≤4 全显，>4 显示 +N
[ ] 双击 header 上的 workspace 路径打开 CLIGroupSettings
[ ] 点击右上设置 → AIGroupSettings 抽屉打开
[ ] 点击分享按钮 → SharePoster 弹出
[ ] 移动端：宽度 < 768px 自动收起 Sidebar
[ ] 切换暗黑模式 → 所有气泡/输入区/header 均跟随
```

- [ ] **Step 7: Commit**

```bash
git add src/pages/chat/components/ChatUI.tsx
git commit -m "refactor(chat): port ChatUI to @lobehub/ui ChatItem+ChatInputArea+Avatar"
```

---

### Task 2.3: AgentChatUI 同步改造

**Files:**
- Modify: `src/pages/chat/components/AgentChatUI.tsx`

- [ ] **Step 1: 重复 Task 2.2 同样替换**（header → ChatItem → ChatInputArea），区别：
  - Header 显示 `Puzzle` 图标 + `({group.agents.length} agents)` + 策略 Tag；
  - 空态用 `@lobehub/ui` 的 `<Empty>` 组件，文案保持"Agent 协作群 + 描述 + 角色标签 + 策略 | 最大轮数"；
  - 没有 SharePoster 入口（保持原状）。

- [ ] **Step 2: 验证 Agent 群流程**

```
[ ] 创建一个 sequential 策略的 Agent 群
[ ] 发送消息 → onAgentStart 创建 ChatItem 占位
[ ] onToken 实时追加 → 文字增长
[ ] 多 Agent 顺序响应不串号
[ ] 错误态 isError 显示红色气泡
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/chat/components/AgentChatUI.tsx
git commit -m "refactor(chat): port AgentChatUI to lobe-ui components"
```

---

## Phase 3 — 设置面板（三种群聊的 Drawer）

### Task 3.1: AIGroupSettings — Sheet → Drawer + Form

**Files:**
- Modify: `src/pages/chat/components/AIGroupSettings.tsx`

- [ ] **Step 1: 替换容器**

```tsx
import { Drawer, Switch, ActionIcon, Form, Avatar as LobeAvatar } from '@lobehub/ui';
import { Button } from 'antd';
// 删除 Sheet/ScrollArea/cn 等 shadcn imports

<Drawer
  open={open}
  onClose={() => onOpenChange(false)}
  title="AI 群聊配置"
  width={400}
>
  {/* 保留 全员讨论模式 / 调度策略 / 成员管理 三段，但用 Form.Item + lobe-ui Switch/Avatar */}
</Drawer>
```

- [ ] **Step 2: 调度策略 / 全员讨论 — 用 `<Form>` + `<Form.Item>` + `<Switch>` + `<Segmented>`**：

```tsx
<Form layout="vertical">
  <Form.Item label="全员讨论模式" help="开启后全员每轮回复">
    <Switch checked={isGroupDiscussionMode} onChange={onToggleGroupDiscussion} />
  </Form.Item>
  {!isGroupDiscussionMode && (
    <Form.Item label="调度策略">
      <Segmented value={schedulerStrategy} onChange={onStrategyChange as any}
        options={[
          { label: '标签匹配',   value: 'tag' },
          { label: '轮询',       value: 'round_robin' },
          { label: '全员',       value: 'all' },
        ]} block />
    </Form.Item>
  )}
</Form>
```

- [ ] **Step 3: 成员列表用 antd `List` + lobe-ui `Avatar` + `ActionIcon`**（Mic/MicOff/X）。

- [ ] **Step 4: 验证**：抽屉打开/关闭、Switch 切换、策略 Segmented 切换、Mute/Remove 操作正常。

- [ ] **Step 5: Commit**

```bash
git add src/pages/chat/components/AIGroupSettings.tsx
git commit -m "refactor(settings): port AIGroupSettings to lobe-ui Drawer+Form"
```

---

### Task 3.2: CLIGroupSettings

**Files:**
- Modify: `src/pages/chat/components/CLIGroupSettings.tsx`

- [ ] **Step 1: Drawer + Form.Item 替换**：
  - workspace 路径用 `<Input>` + 末尾 `<Button icon={<FolderOpen/>}>` 调用 Tauri `invoke('select_directory')`（**逻辑不变**）；
  - 审批模式用 `<Switch>`；
  - 超时用 `<InputNumber>`（antd v6 内置）；
  - 执行策略用 `<Segmented>`；
  - CLI Agent 列表 + 安装检测保留状态机，仅换渲染（lobe-ui `Avatar` + `Tag` "已安装/未安装"）。

- [ ] **Step 2: 验证** — 选择目录、超时输入、策略切换、CLI 状态检测均正常。

- [ ] **Step 3: Commit**

```bash
git add src/pages/chat/components/CLIGroupSettings.tsx
git commit -m "refactor(settings): port CLIGroupSettings to lobe-ui"
```

---

### Task 3.3: AgentGroupSettings

**Files:**
- Modify: `src/pages/chat/components/AgentGroupSettings.tsx`

- [ ] **Step 1: Drawer + Form**，Agent 列表用 lobe-ui 的 `<Collapse>` 实现折叠面板（每个 Agent 一项），展开后里面是 `<Form>`：
  - Agent 名称 / 角色 — `<Input>`；
  - LLM 配置 — Grid 两列 `Input`，API Key 用 `<Input.Password>`；
  - System Prompt — `<Input.TextArea>` autosize；
  - 工具能力 — `<Checkbox.Group>`；
  - Temperature / MaxTurns — `<InputNumber>`；
  - 删除按钮 — `<Button danger ghost>`。

- [ ] **Step 2: 策略选择**：8 种策略用 `<Segmented block>` 两行渲染（lobe-ui 不支持多行，可降级为 antd `Radio.Group`，或保留按钮组 + antd-style）。

- [ ] **Step 3: 验证** — 添加 Agent、展开/折叠、字段编辑、删除、监督者徽章显示。

- [ ] **Step 4: Commit**

```bash
git add src/pages/chat/components/AgentGroupSettings.tsx
git commit -m "refactor(settings): port AgentGroupSettings to lobe-ui Drawer+Collapse+Form"
```

---

### Task 3.4: CreateGroupWizard（多步向导）

**Files:**
- Modify: `src/pages/chat/components/CreateGroupWizard.tsx`

- [ ] **Step 1: Dialog → lobe-ui `<FormModal>` 或 antd v6 `<Modal>` + 自管步骤**：保留 5 步 wizard 状态机不变，仅换组件：

```tsx
import { Modal, Steps, Form, Input, Button, Segmented, Switch, InputNumber } from 'antd';
import { Avatar as LobeAvatar } from '@lobehub/ui';

<Modal
  open={open}
  onCancel={() => { reset(); onOpenChange(false); }}
  title={stepTitles[step]}
  width={520}
  footer={<>
    {step !== 'type' && <Button onClick={prevStep}>上一步</Button>}
    {step === 'config'
      ? <Button type="primary" onClick={handleCreate} disabled={!canProceed()}>创建群聊</Button>
      : <Button type="primary" onClick={nextStep} disabled={!canProceed()}>下一步</Button>}
  </>}
>
  <Steps current={stepNumbers[step] - 1} size="small" items={[
    { title: '类型' }, { title: '基础' }, { title: '成员' }, { title: '配置' },
  ]} />
  <div style={{ marginTop: 24 }}>
    {step === 'type' && renderTypeStep()}
    {/* ... */}
  </div>
</Modal>
```

- [ ] **Step 2: 各 step 内部**：
  - `renderTypeStep` — 用 lobe-ui `<GuideCard>` 或 antd `<Card hoverable>` 三张卡片；
  - `renderBasicStep` — `<Form.Item>` 包 `<Input>` / `<Input.TextArea>`；
  - `renderAIMembersStep` / `renderCLIMembersStep` — 列表用 antd `<List>` + 选中状态；
  - `renderAgentMembersStep` — lobe-ui `<Collapse>` 嵌套表单；
  - `renderAIConfigStep` / `renderCLIConfigStep` / `renderAgentConfigStep` — Form + Segmented + Switch + InputNumber。
  - **Tauri `invoke('select_directory')` 调用保持原样**。

- [ ] **Step 3: 验证 5 步走通**

```
[ ] 选择 AI 类型 → 填名称 → 选成员 → 选策略 → 创建成功
[ ] 选择 CLI 类型 → 填 workspace + 审批模式 → 创建成功
[ ] 选择 Agent 类型 → 配置至少一个 LLM → 创建成功
[ ] 上一步/下一步按钮禁用逻辑（canProceed）正确
```

- [ ] **Step 4: Commit**

```bash
git add src/pages/chat/components/CreateGroupWizard.tsx
git commit -m "refactor(wizard): port CreateGroupWizard to antd Modal+Steps+Form"
```

---

## Phase 4 — 周边页面与组件

### Task 4.1: Login 页

**Files:**
- Modify: `src/pages/login/index.jsx`

- [ ] **Step 1: 三个 OAuth 按钮替换为 antd `<Button block icon={...} size="large">`，外层用 lobe-ui `<Center>` 或 `<Flexbox>`**：

```tsx
import { Flexbox } from 'react-layout-kit';
import { Button } from 'antd';
import { GoogleOutlined, GithubOutlined } from '@ant-design/icons';

<Flexbox padding={24} gap={12} width={isMobile ? 320 : 400} style={{ margin: 'auto' }}>
  <span style={{ fontFamily: 'Audiowide', color: '#ff6600', fontSize: 32, textAlign: 'center' }}>
    botgroup.chat
  </span>
  <div style={{ textAlign: 'center', color: '#888' }}>登录以继续</div>
  <Button block size="large" icon={<GoogleOutlined />} onClick={handleGoogleLogin}>使用 Google 账号登录</Button>
  <Button block size="large" icon={<GithubOutlined />} onClick={handleGithubLogin}>使用 GitHub 账号登录</Button>
  <Button block size="large" icon={<LinuxDoIcon />} onClick={handleLinuxdoLogin}>使用 Linux.do 账号登录</Button>
</Flexbox>
```

Linux.do 没有标准 icon，可保留现有的 inline SVG 包成 `<LinuxDoIcon>` 组件。

- [ ] **Step 2: 保留 useEffect token 处理逻辑**；保留 ICP 备案号渲染。

- [ ] **Step 3: 验证**：三种登录跳转 URL 不变；ICP 显示位置正确；token 解析后跳转 `/`。

- [ ] **Step 4: Commit**

```bash
git add src/pages/login/index.jsx
git commit -m "refactor(login): port OAuth buttons to antd Button + lobe-ui Flexbox"
```

---

### Task 4.2: UserSection（侧栏用户区 + API Key Modal）

**Files:**
- Modify: `src/pages/chat/components/UserSection.tsx`

- [ ] **Step 1: 头像区** — `<Avatar>` (lobe-ui) + hover 编辑提示用 `<ActionIcon>` 浮层；昵称行用 `<EditableText>`（lobe-ui 内置编辑组件，节省自实现的 inline edit 状态）：

```tsx
import { Avatar, EditableText, ActionIcon } from '@lobehub/ui';
import { Modal, Input, Button, Form } from 'antd';

<EditableText
  value={userStore.userInfo?.nickname || '本地用户'}
  onChange={(v) => { setNewNickname(v); updateNickname(); }}
/>
```

- [ ] **Step 2: API Key Modal** — Dialog → antd `<Modal>`，里面 8 个字段用 `<Form>` + `<Input.Password>`。保存逻辑（localStorage）保持。

- [ ] **Step 3: 验证**：昵称行内编辑、API Key 弹窗 8 个字段填写后保存生效、保存提示 toast 正常。

- [ ] **Step 4: Commit**

```bash
git add src/pages/chat/components/UserSection.tsx
git commit -m "refactor(user): port UserSection to lobe-ui Avatar/EditableText + antd Form"
```

---

### Task 4.3: SharePoster

**Files:**
- Modify: `src/pages/chat/components/SharePoster.tsx`

- [ ] **Step 1: Dialog → antd `<Modal>`** （仅外壳；`dom-to-image` 生成逻辑完全保留）：

```tsx
import { Modal, Button } from 'antd';

<Modal
  open={isOpen}
  onCancel={onClose}
  width="50vw"
  footer={<Button type="primary" onClick={handleDownload}>保存聊天海报</Button>}
>
  <img src={posterImage} alt="Share Poster" style={{ width: '100%' }} />
</Modal>
```

- [ ] **Step 2: 验证**：发送几条消息后点击分享 → 海报弹出 → 点击保存下载图片。

- [ ] **Step 3: Commit**

```bash
git add src/pages/chat/components/SharePoster.tsx
git commit -m "refactor(share): port SharePoster modal shell to antd"
```

---

### Task 4.4: AdSection 与 AuthGuard

**Files:**
- Modify: `src/pages/chat/components/AdSection.tsx`
- Modify: `src/components/AuthGuard.jsx`

- [ ] **Step 1: AdSection** — Popover 用 antd `<Popover>` 替换，整体样式（背景图、按钮）保留：

```tsx
import { Popover } from 'antd';
// 替换 PopoverTrigger/PopoverContent 包裹，content 属性传二维码 img
```

- [ ] **Step 2: AuthGuard** — 仅是个守卫组件，无 UI；保持现状。

- [ ] **Step 3: Commit**

```bash
git add src/pages/chat/components/AdSection.tsx
git commit -m "refactor(ad): port Popover in AdSection to antd"
```

---

## Phase 5 — 清理与回归

### Task 5.1: 删除残留 shadcn/Radix 组件与 Tailwind 自定义颜色

**Files:**
- Delete: `src/components/ui/` 整个目录（avatar.tsx, button.tsx, dialog.tsx, ...）
- Modify: `package.json` — 移除 `@radix-ui/react-*`, `@shadcn/ui`, `class-variance-authority`, `tailwindcss-animate`, `tailwind-scrollbar-hide`, `tailwind-merge`（仅保留 `clsx`）
- Modify: `tailwind.config.cjs` — 移除 `colors.{background, foreground, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, chart, sidebar}` 全部，只保留 typography 插件
- Modify: `components.json` — 删除（不再使用 shadcn CLI）

- [ ] **Step 1: 用 ripgrep 确认无残留引用**

```bash
rg "@/components/ui" src
rg "from \"@radix-ui" src
```

期望：无输出。如有引用，找出对应 Task 漏改。

- [ ] **Step 2: 执行删除**

```bash
rm -rf src/components/ui components.json
npm uninstall \
  @radix-ui/react-avatar @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-popover @radix-ui/react-scroll-area @radix-ui/react-separator \
  @radix-ui/react-slot @radix-ui/react-switch @radix-ui/react-tooltip \
  @shadcn/ui class-variance-authority tailwindcss-animate tailwind-scrollbar-hide
```

- [ ] **Step 3: 构建** — `npm run build`，期望无 TS 错误。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(cleanup): remove shadcn/ui and radix deps"
```

---

### Task 5.2: 移除 react-markdown / remark / rehype（已由 lobe-ui Markdown 替代）

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 卸载**

```bash
npm uninstall react-markdown remark-gfm remark-math rehype-katex rehype-raw katex
```

> 注意：`@lobehub/ui` 本身 dep 了 `react-markdown@10` 与 `rehype-katex@7`，运行时不会缺。

- [ ] **Step 2: 构建验证**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(cleanup): drop direct react-markdown/remark/rehype deps"
```

---

### Task 5.3: 全量功能回归 + 视觉走查

按以下清单逐项过：

```
[功能回归]
 [ ] 登录 — Google/GitHub/Linux.do 三种入口跳转正常；ICP 显示
 [ ] AI 群聊
     [ ] 默认群 "硅碳生命体交流群" 可发送消息
     [ ] SSE 流式 token 实时显示
     [ ] @多个 AI 顺序回复（tag 策略）
     [ ] 全员讨论模式切换生效
     [ ] 静音/解除静音生效
     [ ] 添加成员/移除成员持久化
 [ ] CLI 群
     [ ] workspace 路径点击"选择"调用 Tauri 文件夹选择器
     [ ] CLI agent 安装状态检测显示
     [ ] sequential/router/race/pipeline 四种策略可切
     [ ] Codex/Claude/OpenCode 实际执行返回 <details> 折叠块
 [ ] Agent 群
     [ ] 8 种策略可选
     [ ] 添加/删除 Agent
     [ ] System Prompt / API Key / Temperature 字段保存
     [ ] sequential 策略下多 Agent 顺序响应不串号
 [ ] 创建群聊向导
     [ ] 5 步流程走通三种类型
     [ ] 步骤校验 canProceed
     [ ] 创建后立即跳转到新群
 [ ] 分享海报
     [ ] 发送消息后点击分享
     [ ] dom-to-image 生成成功
     [ ] PC 端下载 PNG；移动端调用 share API
 [ ] 用户区
     [ ] 昵称内联编辑
     [ ] API Key 弹窗 8 字段保存
 [ ] 主题
     [ ] light/dark/system 切换全局生效
     [ ] 系统模式跟随 prefers-color-scheme
 [ ] 移动端
     [ ] viewport < 768 自动隐藏 Sidebar
     [ ] 点击遮罩关闭 Sidebar

[视觉走查]
 [ ] 主色仍为 #ff6600 橙
 [ ] 用户气泡为橙黄渐变
 [ ] AI 气泡为浅灰带边框
 [ ] 错误气泡红色背景
 [ ] 代码块 shiki 高亮可读
 [ ] KaTeX 公式正确渲染
 [ ] details/summary 块可折叠
```

- [ ] **Step 1: 手动逐项过**，发现 bug 直接修，每个 fix 一次 commit。

- [ ] **Step 2: 跑 build**

```bash
npm run build
```

期望：`tsc` + `vite build` 全绿，`dist/` 产出可加载。

- [ ] **Step 3: Tauri 打包测试**

```bash
npm run tauri build -- --debug
```

期望：能正常打出 debug 包，启动后 UI 与 Web 一致。

- [ ] **Step 4: 最终 Commit + PR**

```bash
git add -A
git commit -m "test: verify full functional regression on lobe-ui refactor"
git push -u origin cursor/refactor-ui-to-lobe-ui-d51d
```

---

## 附录 A：lobe-ui 关键组件映射表

| 现有（shadcn/Radix） | 替换为 | 说明 |
|---|---|---|
| `Button` | `antd/Button` | lobe-ui 的 Button 是对 antd Button 的封装，可直接用 antd |
| `Input` | `antd/Input` | 同上 |
| `Avatar`/`AvatarImage`/`AvatarFallback` | `@lobehub/ui/Avatar` | 支持 avatar URL + background fallback + Emoji，单一组件 |
| `Dialog`/`DialogContent` | `antd/Modal` 或 `@lobehub/ui/Modal` | |
| `Sheet`/`SheetContent` | `@lobehub/ui/Drawer` | 默认右侧抽屉 |
| `ScrollArea` | 原生 `overflow: auto` + lobe-ui `Scrollbar` | 或直接 div |
| `Switch` | `antd/Switch` | |
| `Tooltip`/`TooltipProvider` | `antd/Tooltip` | 不需要 Provider |
| `DropdownMenu` | `antd/Dropdown` | |
| `Popover` | `antd/Popover` | |
| `Separator` | `antd/Divider` | |
| `Tabs` | `antd/Tabs` | |
| (自定义) `ChatMessage` 大段 className | `@lobehub/ui/chat/ChatItem` | 头像+名称+气泡+extra 一键齐全 |
| (自定义) Input + Send Button | `@lobehub/ui/chat/ChatInputArea` | Enter 发送、loading、左/右插槽 |
| `<header>` 自实现 | `@lobehub/ui/Header` | logo + nav + actions |
| `<aside>` 自实现 | `@lobehub/ui/SideNav` 或 `Block` | |
| `ReactMarkdown` 巨长 className | `@lobehub/ui/Markdown` | 内置 gfm/math/katex/shiki/mermaid |
| `lucide-react` ActionButton 包装 | `@lobehub/ui/ActionIcon` | icon + title + size 一行搞定 |

---

## 附录 B：主题变量映射

将原 CSS HSL 变量迁移到 antd-style `customToken`：

| 原变量（HSL） | 对应 antd token | 备注 |
|---|---|---|
| `--background` `0 0% 100%` | `colorBgLayout` | 顶层背景 |
| `--card` | `colorBgContainer` | 卡片/气泡 |
| `--primary` `#ff6600` | `colorPrimary` + customToken.colorBrandPrimary | 主色 |
| `--secondary` | `colorFillSecondary` | |
| `--muted` | `colorFillTertiary` | |
| `--border` | `colorBorderSecondary` | |
| `--ring` | `colorPrimaryBorderHover` | |
| `--destructive` | `colorError` | |
| `--radius` `1rem` | `borderRadius: 12` | |

---

## 附录 C：常见问题排查

| 现象 | 原因 | 解决 |
|---|---|---|
| antd 组件字号变小或行高不对 | Tailwind preflight 未关 | `corePlugins.preflight=false` |
| `ThemeProvider not found` 警告 | App.tsx 没包 ThemeProvider | 检查 Task 0.2 |
| `motion is required` | 没传 motion 到 ConfigProvider | `<ConfigProvider motion={motion}>` |
| `react.createContext is not a function` | React 18 与 19 类型混用 | 删 node_modules + lock 后重装 |
| Drawer/Modal 蒙层穿透 | Antd v6 默认 z-index 1000，与 fixed sidebar 冲突 | 给 Drawer 加 `zIndex={1100}` |
| `KaTeX` 公式不渲染 | lobe-ui Markdown 未启用 enableLatex | `<Markdown enableLatex>` |
| Tauri 打包后某图片 404 | public 路径仍正确，但 base64 嵌入失败 | 海报生成处保持原有 fetch+FileReader 逻辑 |

---

## 执行选项

完成本文件后，提供两种执行方式：

**1) Subagent-Driven（推荐）** — 每个 Task 派发独立 subagent，逐任务执行 + 评审，回滚成本低。

**2) Inline 执行** — 在同一会话内顺序执行所有 Task，每个 Phase 末做 checkpoint。

请选择执行模式。
