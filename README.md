# BotGroup.Chat Desktop

> 基于 [BotGroup.Chat](https://github.com/maojindao55/botgroup.chat) 的桌面客户端，使用 Tauri v2 构建，完全本地化运行。

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-Local-003B57?logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/i18n-中%20%2F%20EN-success" alt="i18n" />
</p>

## ✨ 特性

### 三类群聊

- 🤖 **角色群** — 邀请不同角色和模型一起聊天、脑暴、做观点碰撞，支持智能点名 / 轮流发言 / 全员圆桌三种发言方式
- 🧠 **专家群** — 让具备职责分工的专家群友按「群规」协作（专家会诊 / 方案产出 / 评审决策 / 接力修改 / 自动处理）产出方案与结论
- 💻 **开发群** — 让 Codex、Claude Code、OpenCode、Cursor Agent、Qoder CLI 等开发群友在本地 workspace 协作改代码，支持快速响应、写完再审、隔离竞赛等多种群规

### 会话与协作

- 💬 **多会话管理** — 角色群消息本地持久化，单个群支持多个并行话题；可新建、切换、重命名、置顶、归档、搜索会话，并自动生成会话标题
- 🛠️ **CLI 任务管理** — 开发群以任务为单位执行，提供任务侧栏、执行日志、git diff 查看、worktree 隔离与多群友竞赛结果对比
- 📚 **资源库** — 统一管理角色库、专家库、开发群友与模型服务

### 平台能力

- 🖥️ **原生桌面体验** — Tauri v2 构建，轻量高性能，内存占用远低于 Electron
- 💾 **完全本地化** — SQLite + 本地存储，数据不依赖云端，隐私安全
- 🔐 **密钥保险箱** — API Key 通过本地保险箱（Vault）加密存储，前端只引用密钥别名，不落明文
- 🧩 **模型服务管理** — 自定义 baseURL / 模型，内置 DeepSeek、通义千问、火山引擎、腾讯混元、智谱 GLM、Moonshot Kimi、百度千帆、OpenAI、Ollama 等服务商预设
- 🌐 **多语言** — 简体中文 / English / 跟随系统，Ant Design 组件文案同步切换
- 🎨 **现代 UI** — 基于 Ant Design + Lobe UI，毛玻璃质感、渐变气泡、流畅动画
- 🌙 **深色模式** — 支持亮色 / 暗色 / 跟随系统三种主题

## 📦 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Tauri v2 |
| **前端** | React 19 + TypeScript + Vite |
| **UI / 样式** | Ant Design 6 + @lobehub/ui + antd-style + TailwindCSS |
| **状态管理** | Zustand |
| **国际化** | i18next + react-i18next（zh-CN / en-US） |
| **动画** | motion |
| **本地存储** | SQLite (rusqlite) + localStorage（会话 / 任务） |
| **后端** | Rust（Tauri IPC Commands） |
| **LLM** | OpenAI 兼容 SDK + Rust 流式代理 |
| **Markdown** | @lobehub/ui Markdown（KaTeX 公式 / Mermaid 图表 / shiki 高亮） |

## 🚀 快速开始

### 环境要求

- **Node.js** >= 18
- **Rust** >= 1.70 (通过 [rustup](https://rustup.rs/) 安装)
- **系统依赖** — 参考 [Tauri 环境配置](https://tauri.app/start/prerequisites/)

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/maojindao55/botgroup.chat-desktop.git
cd botgroup.chat-desktop

# 安装前端依赖
npm install

# 开发模式运行
npm run tauri dev

# 构建安装包
npm run tauri build
```

### 运行测试

```bash
npm run test:cli       # CLI 适配器 / 任务 / 引擎模式
npm run test:llm       # LLM 客户端 / 各 CLI 流解析
npm run test:product   # 群聊产品分类与文案
npm run test:i18n      # 中英文翻译键对称性
```

## 📁 项目结构

```
botgroup.chat-desktop/
├── src/                    # 前端源码 (React + TypeScript)
│   ├── components/         # 通用组件 (Markdown, AuthGuard, 验证码)
│   ├── config/             # 群聊/成员/CLI/会话/服务商配置与产品分类
│   ├── engine/             # 群聊调度引擎 (agent/cli/blackboard/intent/prompt)
│   ├── hooks/              # 自定义 Hooks (use-theme, use-locale 等)
│   ├── i18n/               # 国际化资源与运行时 (zh-CN / en-US)
│   ├── layouts/            # 布局组件
│   ├── lib/                # 主题与通用工具
│   ├── pages/
│   │   ├── chat/           # 聊天主页面
│   │   │   └── components/ # ChatUI, AgentChatUI, CLITaskUI, 各类 Sidebar/Settings/Library
│   │   └── login/          # 登录页
│   ├── store/              # Zustand 状态 (aiMember/provider/cliTask/chatSession/user)
│   ├── styles/             # 样式
│   ├── types/              # 类型定义
│   ├── utils/              # 工具 (request, 各 CLI 流解析, 头像, 凭证解析)
│   ├── routes.tsx          # 路由配置
│   └── index.css           # 全局样式 & 设计系统
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── lib.rs          # Tauri 入口 & IPC 命令注册
│   │   ├── db.rs           # SQLite 数据库操作
│   │   ├── api.rs          # 用户/成员/群组/本地文件等命令
│   │   ├── provider.rs     # 模型服务管理
│   │   ├── vault.rs        # 密钥保险箱 (API Key 加密存储)
│   │   ├── llm_proxy.rs    # LLM 流式代理
│   │   ├── cli.rs          # CLI Agent 执行 (运行/检测/worktree/diff/日志)
│   │   └── migrate.rs      # 数据迁移
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── package.json
├── tailwind.config.cjs
├── vite.config.ts
└── tsconfig.json
```

## 🏗️ 架构说明

```
┌──────────────────────────────────────────────┐
│                 Tauri Window                  │
│  ┌────────────────────────────────────────┐  │
│  │          React Frontend (Vite)          │  │
│  │  ┌────────┐ ┌───────────┐ ┌──────────┐ │  │
│  │  │ ChatUI │ │AgentChatUI│ │CLITaskUI │ │  │
│  │  │ (角色) │ │  (专家)   │ │ (开发)   │ │  │
│  │  └───┬────┘ └─────┬─────┘ └────┬─────┘ │  │
│  │      └───────────┬┴────────────┘       │  │
│  │            ┌─────▼──────┐               │  │
│  │            │ request.ts │ (IPC Proxy)   │  │
│  │            └─────┬──────┘               │  │
│  └──────────────────┼──────────────────────┘  │
│                     │ IPC invoke               │
│  ┌──────────────────▼──────────────────────┐  │
│  │              Rust Backend                │  │
│  │  ┌────────┐ ┌──────────┐ ┌────────────┐ │  │
│  │  │ api.rs │ │provider  │ │ llm_proxy  │ │  │
│  │  │  db.rs │ │  vault   │ │   cli.rs   │ │  │
│  │  └────────┘ └──────────┘ └────────────┘ │  │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

- **前端** 三类群聊界面通过 `request.ts` 统一代理调用，由 `engine/` 负责群内成员的调度与协作
- **IPC 层** 将请求转换为 Tauri `invoke` 调用
- **Rust 后端** 处理本地 SQLite 读写、模型服务与密钥管理、LLM 流式代理，以及 CLI Agent 的本地执行

## 🔐 密钥与模型服务

- API Key 写入本地**保险箱（Vault）**加密存储，配置中仅保存密钥别名（`apiKeyRef`），避免明文落盘。
- 在「资源库 → 模型服务」中新建服务商，可从内置预设快速填入 API 地址，模型列表按需自行填写。
- 旧版本以 localStorage 明文保存的 Key 会在启动时自动迁移到保险箱。

## 🎨 UI 设计

- **聊天气泡** — 用户消息采用橙色渐变 (`orange-500 → amber-500`)，AI 消息使用半透明卡片
- **头像** — 圆形头像，带边框和阴影，内置角色按品牌图标渲染，自定义头像回退为首字母色块
- **侧边栏** — 可折叠，毛玻璃背景，橙色激活指示条，开发群另有任务侧栏、角色群另有会话侧栏
- **主题** — 基于 CSS 变量的亮色 / 暗色切换，支持跟随系统

## 📄 License

MIT

## 🔗 相关项目

- [BotGroup.Chat](https://github.com/maojindao55/botgroup.chat) — Web 版本
- [Tauri](https://tauri.app/) — 桌面框架
