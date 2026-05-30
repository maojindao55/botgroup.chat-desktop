# 角色群聊：会话功能与管理功能设计

> 状态：方案设计（待评审）
> 范围：角色群聊（`Group.type === 'ai'`）。设计对 `agent` 群可平滑复用，作为后续阶段。

## 1. 背景与目标

### 1.1 现状

| 群类型 | 组件 | 消息持久化 | 多会话 | 会话管理 |
| --- | --- | --- | --- | --- |
| 角色群 `ai` | `ChatUI.tsx` | ❌ 仅在 `messages` useState | ❌ 单群单会话 | ❌ 无 |
| 专家群 `agent` | `AgentChatUI.tsx` | ✅ localStorage（按 groupId） | ❌ 单群单会话 | ❌ 无 |
| CLI 群 `cli` | `CLITaskUI.tsx` + `cliTaskStore` | ✅ zustand persist | ✅ 多任务 | ✅ 搜索/删除/归档/重命名 |

角色群聊当前的核心问题：

- 消息只存在内存里，刷新页面、切换群、关闭应用后历史全部丢失。
- 一个群只有一条对话线，无法保留多个独立话题的上下文。
- 没有任何会话的新建、切换、命名、删除能力。

### 1.2 目标

**会话功能**

- 持久化消息历史（关闭/刷新后可恢复）。
- 单个角色群支持多个并行会话（不同话题独立上下文）。
- 支持新建会话、切换会话、加载历史会话。

**管理功能**

- 会话重命名（自动标题 + 手动改名）。
- 会话删除（含确认）。
- 会话置顶 / 归档。
- 会话列表搜索。
- 删除群时级联清理其会话。

### 1.3 非目标（本期不做）

- 会话云端同步 / 跨设备（当前为本地 localStorage）。
- 把 `agent` 群迁移到统一模型（列为后续阶段 Phase 3）。
- 会话导出 / 分享。

## 2. 数据模型

新增 `src/config/chatSessions.ts`（纯类型 + 纯函数）与 `src/store/chatSessionStore.ts`（zustand + persist），整体对齐 `cliTasks.ts` / `cliTaskStore.ts` 的写法。

```ts
// src/config/chatSessions.ts
export interface ChatSessionMessage {
  id: string;
  sender: { id: string; name: string; avatar?: string };
  content: string;
  isAI: boolean;
  isError?: boolean;
  createdAt: string;
}

export type ChatSessionTitleSource = 'auto' | 'manual';

export interface ChatSession {
  id: string;
  groupId: string;                  // 所属角色群 id（非 index，稳定引用）
  title: string;
  titleSource: ChatSessionTitleSource;
  pinned?: boolean;
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
  messages: ChatSessionMessage[];
  // 创建会话时的群行为快照，避免后续改群设置影响历史会话语义
  settingsSnapshot?: {
    isGroupDiscussionMode: boolean;
    schedulerStrategy: 'tag' | 'round_robin' | 'all';
  };
}
```

纯函数（便于单测，命名沿用 cliTasks 习惯）：

- `createChatSession(params): ChatSession`
- `truncateSessionTitle(text, maxLen=48): string`
- `deriveSessionTitle(session): string`（从首条用户消息推导）
- `sortChatSessions(sessions): ChatSession[]`（置顶优先 → updatedAt 倒序）
- `filterChatSessions(sessions, { search, showArchived }): ChatSession[]`

## 3. 状态管理（Store）

```ts
// src/store/chatSessionStore.ts
interface ChatSessionStore {
  sessions: ChatSession[];

  getSessionsByGroup(groupId: string): ChatSession[];
  getSession(sessionId: string): ChatSession | undefined;

  createSession(groupId: string, init?: Partial<ChatSession>): ChatSession;
  renameSession(sessionId: string, title: string): void;   // titleSource='manual'
  deleteSession(sessionId: string): void;
  deleteSessionsByGroup(groupId: string): void;             // 删群级联
  togglePinned(sessionId: string): void;
  toggleArchived(sessionId: string): void;

  appendMessage(sessionId: string, msg: ChatSessionMessage): void;
  updateMessage(sessionId: string, messageId: string, patch: Partial<ChatSessionMessage>): void;
  replaceMessages(sessionId: string, messages: ChatSessionMessage[]): void; // 流式提交用
  autoTitleIfNeeded(sessionId: string): void;               // 首条用户消息后赋自动标题
}
```

持久化（zustand `persist`）：

- `name: 'ai_chat_sessions'`，`partialize` 仅存 `sessions`。
- 体积控制（localStorage ~5MB 上限）：
  - 每个会话保留最近 `MAX_MESSAGES_PER_SESSION`（建议 200）条；
  - 每个群保留最多 `MAX_SESSIONS_PER_GROUP`（建议 50）条，超出按 `updatedAt` 淘汰未置顶的最旧会话；
  - 与 `AgentChatUI` 现用的 `.slice(-100)` 思路一致。

## 4. 流式写入的性能策略（关键点）

角色群聊是逐 token 流式输出。若每个 token 都写 zustand persist → 触发一次 `localStorage.setItem`，会造成明显卡顿。

策略：**「内存渲染 + 安全点提交」**

1. 当前活跃会话的消息保留一份组件内 `messages` 本地 state，用于实时流式渲染（沿用现有逻辑，改动最小）。
2. 仅在以下安全点把本地 `messages` 同步进 store（从而落盘）：
   - 用户发送消息后；
   - 单个 AI 回复结束（`onAgentEnd` / catch / 最终兜底）；
   - 切换会话 / 卸载组件前 flush。
3. store 写入用 `replaceMessages(sessionId, messages)`，避免逐 token I/O。
4. 加载会话时从 store 读出 → 注入本地 `messages` state。

这样既保证历史持久化，又不影响流式体验。

## 5. UI / 交互方案

需要在「角色群」内提供会话列表的入口。给出三种布局，并推荐方案。

### 方案 A（推荐）：二级会话侧栏（与 CLI 体验对齐）

- 在现有「群列表 Sidebar」与「聊天区」之间，新增 **`ConversationSidebar`**（仿 `CLITaskSidebar`），仅当选中角色群时显示。
- 顶部：「+ 新建会话」按钮 + 搜索框。
- 列表项：标题、最后更新时间、置顶/归档标记；hover 显示重命名/删除/置顶操作；选中项高亮。
- 移动端：会话列表以抽屉（Drawer）呈现，Header 显示当前会话标题 + 切换入口。
- 优点：与 CLI 任务区一致的产品心智；扩展性好（搜索/筛选/归档天然有位置）。
- 成本：新增一栏，需处理桌面三栏 + 移动端抽屉与窗口宽度联动（`adjustWindowWidthForPanel`）。

### 方案 B：主 Sidebar 群项下手风琴展开会话子列表

- 优点：不增加栏。缺点：群多时拥挤，操作（重命名/删除）空间局促，移动端体验差。

### 方案 C（轻量过渡）：Header 会话下拉切换器 + 新建按钮

- 在 ChatUI Header 放「会话 ▾」下拉（列出本群会话）+「+ 新建」。
- 管理操作放下拉内的小菜单。
- 优点：改动最小、移动端友好。缺点：会话多时下拉不便，弱于列表浏览。

> **推荐**：以 **方案 A** 为目标形态。若要快速见效可先落 **方案 C** 再演进到 A；二者共用同一 store/数据模型，UI 可平滑替换。

### 5.1 URL 与路由

- 现有：`?id=<groupIndex>` 选群。
- 新增：`?id=<groupIndex>&conv=<sessionId>` 指定活跃会话。
- 进入角色群时：
  - 带 `conv` → 加载该会话；
  - 不带 → 选中该群「最近更新」的会话；若该群无会话 → 进入「空会话」草稿态。

### 5.2 会话懒创建

- 不在「点新建」时立即落盘空会话，而是进入空态（显示「开始新会话」占位）。
- **首条用户消息发送时**才真正 `createSession` 并写入，避免空会话堆积（符合主流聊天产品习惯）。
- 已存在会话则直接 `appendMessage`。

### 5.3 自动标题（服务端总结）

- 会话首轮（首条用户消息 + 首条 AI 回复）完成后，**异步**调用 LLM 总结生成标题：`titleSource='auto'`、`titleGenerated=true`。
- 模型取当前群首个可用成员（`groupAiCharacters[0]`）的 `model` / `providerId`，经 `llmChatComplete` 返回简短标题（限制长度、去除多余标点/换行）。
- 生成失败 / 无可用模型 → 回退为 `truncateSessionTitle(首条用户消息)`。
- 用户手动改名：`titleSource='manual'`，后续自动逻辑不再覆盖；`titleGenerated` 已为 true 时不重复生成。

## 6. ChatUI 改造点

集中在 `src/pages/chat/components/ChatUI.tsx`（AI 分支）：

- 引入 `useChatSessionStore`；读取 URL `conv`，维护 `activeSessionId`。
- `handleSendMessage` 流程：若无活跃会话 → 懒创建；用户消息与 AI 回复在安全点写 store；首条后 `autoTitleIfNeeded`。
- 渲染区不变（继续用本地 `messages`）；新增「加载/切换会话」副作用：`conv` 变化 → 从 store 读取注入本地 state。
- 切群（`handleSelectGroup`）：清空当前 `messages` 并按目标群选默认会话。
- 删群（`confirmDeleteGroup`）：调用 `deleteSessionsByGroup(group.id)` 级联清理。
- 新增 `ConversationSidebar` 接线（方案 A）或 Header 下拉（方案 C）。
- CLI / Agent 分支不受影响（CLI 走自己的任务模型；Agent 暂保持现状）。

## 7. 边界与异常

- 删除当前活跃会话 → 自动切到本群下一条（按排序）；无剩余 → 空态。
- 群成员中途变更 → 历史消息保留发送时的 sender 快照，不回溯。
- localStorage 超额（quota）→ try/catch 静默；淘汰策略见 §3。
- 流式中途切换会话 / 关闭 → 先 flush 当前内容到 store，标记非 streaming。
- 旧数据：角色群此前无持久化，无迁移负担；agent 群迁移列入后续阶段。

## 8. 国际化

`src/i18n/resources/{zh-CN,en-US}/chat.json` 新增 `conversation` 命名空间：

- `conversation.new`（新建会话）
- `conversation.untitled`（未命名会话）
- `conversation.rename` / `delete` / `pin` / `unpin` / `archive`
- `conversation.searchPlaceholder`
- `conversation.empty` / `conversation.emptySearch`
- `conversation.deleteConfirmTitle` / `conversation.deleteConfirmContent`
- 占位符 `placeholders.aiInput` 已存在，复用。

## 9. 测试

沿用仓库 `.test.mjs`（node test）约定：

- `src/config/chatSessions.test.mjs`
  - `truncateSessionTitle` 边界（超长/换行/空）。
  - `createChatSession` 字段完整性。
  - `sortChatSessions` 置顶 + 时间排序。
  - `filterChatSessions` 搜索 / 归档过滤。
- store 纯逻辑（如可抽出 reducer）：create/append/update/rename/delete/级联删除。

UI 交互以手动验证 + 现有 e2e 范围为主（本期不引入新 UI 测试框架）。

## 10. 涉及文件清单

新增：

- `src/config/chatSessions.ts`
- `src/store/chatSessionStore.ts`
- `src/pages/chat/components/ConversationSidebar.tsx`（方案 A）
- `src/config/chatSessions.test.mjs`

修改：

- `src/pages/chat/components/ChatUI.tsx`（接 store、会话切换、级联删除、侧栏接线）
- `src/i18n/resources/zh-CN/chat.json`、`src/i18n/resources/en-US/chat.json`

可选 / 后续：

- `src/pages/chat/components/AgentChatUI.tsx`（迁移到统一会话模型）

## 11. 实施阶段

- **Phase 1（核心）**：数据模型 + store + 持久化 + 会话新建/切换/删除/重命名 + 列表入口（方案 A 或先 C）。
- **Phase 2（管理增强）**：置顶 / 归档 / 搜索 / 自动标题优化。
- **Phase 3（统一）**：`agent` 群迁移到同一会话模型；服务端总结标题；导出。

## 12. 已确认决策（评审通过）

1. **UI 布局**：采用 **方案 A**（二级会话侧栏，与 CLI 任务区一致）。
2. **范围**：本期 **仅角色群 `ai`**；`agent` 专家群迁移列入后续阶段（Phase 3）。
3. **存储上限**：**每会话保留最近 200 条消息**，**每群最多 50 个会话**；超额按 `updatedAt` 淘汰未置顶的最旧会话。
4. **会话标题**：采用 **服务端 LLM 总结生成标题**。
   - 实现：复用 `llmChatComplete`（`@/utils/llmClient`）+ `resolveLlmCredentials`，模型取当前群首个可用成员（`groupAiCharacters[0]`）的 `model` / `providerId`。
   - 时机：会话首轮（首条用户消息 + 首条 AI 回复）完成后异步生成一次。
   - 回退：生成失败 / 无可用模型 → 回退为首条用户消息截断标题。
   - 锁定：用户手动重命名后 `titleSource='manual'`，不再被自动标题覆盖；自动生成成功后置 `titleGenerated=true`，不重复生成。

> 实现常量（`src/config/chatSessions.ts`）：
> `MAX_MESSAGES_PER_SESSION = 200`，`MAX_SESSIONS_PER_GROUP = 50`。
