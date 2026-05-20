# BotGroup.Chat Desktop

> 基于 [BotGroup.Chat](https://github.com/maojindao55/botgroup.chat) 的桌面客户端，使用 Tauri v2 构建，完全本地化运行。

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-v2-blue?logo=tauri" alt="Tauri v2" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?logo=react" alt="React 18" />
  <img src="https://img.shields.io/badge/Rust-2021-orange?logo=rust" alt="Rust" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-Local-003B57?logo=sqlite" alt="SQLite" />
</p>

## ✨ 特性

- 🖥️ **原生桌面体验** — Tauri v2 构建，轻量高性能，内存占用远低于 Electron
- 💾 **完全本地化** — SQLite 本地存储，数据不依赖云端，隐私安全
- 🤖 **AI 群聊** — 支持多个 AI 角色同时参与群聊讨论
- 🦞 **OpenClaw 协议** — 支持接入 OpenClaw 龙虾实例进行去中心化聊天
- 🎨 **现代 UI** — 毛玻璃质感、渐变气泡、流畅动画
- 🌙 **深色模式** — 支持亮色/暗色/跟随系统三种主题

## 📦 技术栈

| 层级 | 技术 |
|------|------|
| **桌面框架** | Tauri v2 |
| **前端** | React 18 + TypeScript + Vite |
| **样式** | TailwindCSS + shadcn/ui |
| **状态管理** | Zustand |
| **本地存储** | SQLite (rusqlite) |
| **后端** | Rust (IPC Commands) |
| **Markdown** | react-markdown + KaTeX 数学公式 |

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

## 📁 项目结构

```
botgroup.chat-desktop/
├── src/                    # 前端源码 (React + TypeScript)
│   ├── components/         # 通用 UI 组件 (shadcn/ui)
│   ├── config/             # 群组配置
│   ├── hooks/              # 自定义 Hooks
│   ├── layouts/            # 布局组件
│   ├── pages/
│   │   ├── chat/           # 聊天主页面
│   │   │   └── components/ # ChatUI, ClawChatUI, Sidebar 等
│   │   └── login/          # 登录页
│   ├── store/              # Zustand 状态管理
│   ├── utils/              # 工具函数 (request, avatar 等)
│   ├── routes.tsx          # 路由配置
│   └── index.css           # 全局样式 & 设计系统
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── lib.rs          # Tauri 入口 & IPC 命令注册
│   │   ├── db.rs           # SQLite 数据库操作
│   │   └── api.rs          # API 代理逻辑
│   ├── Cargo.toml          # Rust 依赖
│   └── tauri.conf.json     # Tauri 配置
├── package.json
├── tailwind.config.cjs
├── vite.config.ts
└── tsconfig.json
```

## 🏗️ 架构说明

```
┌─────────────────────────────────────┐
│           Tauri Window              │
│  ┌───────────────────────────────┐  │
│  │     React Frontend (Vite)     │  │
│  │  ┌─────────┐  ┌───────────┐  │  │
│  │  │ ChatUI  │  │ ClawChat  │  │  │
│  │  │         │  │   UI      │  │  │
│  │  └────┬────┘  └─────┬─────┘  │  │
│  │       │             │        │  │
│  │  ┌────▼─────────────▼─────┐  │  │
│  │  │   request.ts (Proxy)   │  │  │
│  │  └────────────┬───────────┘  │  │
│  └───────────────┼──────────────┘  │
│                  │ IPC invoke      │
│  ┌───────────────▼──────────────┐  │
│  │      Rust Backend            │  │
│  │  ┌──────────┐ ┌───────────┐  │  │
│  │  │  api.rs  │ │  db.rs    │  │  │
│  │  │ (Proxy)  │ │ (SQLite)  │  │  │
│  │  └──────────┘ └───────────┘  │  │
│  └──────────────────────────────┘  │
└─────────────────────────────────────┘
```

- **前端** 通过 `request.ts` 统一代理 API 调用
- **IPC 层** 将 HTTP 请求转换为 Tauri `invoke` 调用
- **Rust 后端** 处理本地 SQLite 读写和外部 API 代理

## 🎨 UI 设计

- **聊天气泡** — 用户消息采用橙色渐变 (`orange-500 → amber-500`)，AI 消息使用半透明卡片
- **头像** — 8px 圆形头像，带边框和阴影，支持自定义背景色
- **输入框** — 全宽铺满，11px 高度，橙色聚焦效果
- **侧边栏** — 可折叠，毛玻璃背景，橙色激活指示条
- **主题** — 基于 CSS 变量的亮色/暗色切换

## 📄 License

MIT

## 🔗 相关项目

- [BotGroup.Chat](https://github.com/maojindao55/botgroup.chat) — Web 版本
- [Tauri](https://tauri.app/) — 桌面框架
