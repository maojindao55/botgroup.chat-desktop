# BotGroup.Chat CLI Agent Plugins

CLI Agent Plugins 让你以**解耦、插件化**的方式把任何 CLI 编码工具接入群聊。

## 架构

```
App (Tauri)
  └─ Agent Bridge (Rust, localhost:19816)
       ├── WebSocket endpoint: ws://localhost:19816/agent
       └── HTTP endpoint: POST http://localhost:19816/agent/status

Plugin (独立进程, 任何语言)
  └── 连接 ws://localhost:19816/agent?name=codex
       ├── 接收: { type: "prompt", id, text, cwd }
       ├── 发送: { type: "chunk", id, content }  (流式)
       ├── 发送: { type: "done", id, exit_code }
       └── 发送: { type: "error", id, message }
```

## 使用方式

1. 启动 App（bridge 自动在 19816 端口启动）
2. 在终端里运行 plugin：
   ```bash
   node plugins/codex-plugin.mjs
   # 或
   node plugins/claude-plugin.mjs
   ```
3. Plugin 会自动注册为群聊成员，在 UI 上显示"在线"
4. 你发消息后，调度器选中该 Agent → Bridge 推送 prompt → Plugin 执行 CLI → 输出回流到群聊气泡

## 好处

- **鉴权解耦**：每个 CLI 的登录/API Key 由 plugin 进程自己管理
- **语言无关**：Plugin 可以用 Node/Python/Shell/Go 写
- **崩溃隔离**：一个 plugin 挂了不影响 App 和其他 plugin
- **远程 plugin**（可选）：理论上 plugin 可以跑在远端机器，通过 SSH tunnel 连过来
- **热插拔**：不用重启 App，启动/停止 plugin 即可上下线 Agent

## 协议（WebSocket 消息格式）

### Plugin → Bridge

```json
// 注册（连接后立即发送）
{ "type": "register", "name": "codex", "version": "0.132.0" }

// 流式输出
{ "type": "chunk", "id": "<task_id>", "content": "一行输出\n" }

// 错误输出（渲染为 stderr/thinking）
{ "type": "stderr", "id": "<task_id>", "content": "thinking..." }

// 任务完成
{ "type": "done", "id": "<task_id>", "exit_code": 0 }

// 任务失败
{ "type": "error", "id": "<task_id>", "message": "spawn failed" }
```

### Bridge → Plugin

```json
// 分配任务
{ "type": "prompt", "id": "<task_id>", "text": "用户输入+历史", "cwd": "/path/to/repo" }

// 取消任务（用户点了停止）
{ "type": "cancel", "id": "<task_id>" }
```
