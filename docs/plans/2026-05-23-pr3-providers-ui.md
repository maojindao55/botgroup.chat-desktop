# PR3: Providers 表 + 管理 UI + 测试连接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在群员库新增「模型服务 (Provider)」管理能力——用户可在界面配置 API 地址、模型列表、密钥（vault）；支持 builtin seed、测试连接。**本 PR 不改 LLM/Agent 成员数据模型**（`providerId` 接线在 PR4）。

**Architecture:** Rust 端加 `providers` 表 + `provider.rs` CRUD IPC；密钥通过已有 `secret_set`/`secret_has` 以 `apiKeyRef`（如 `provider:deepseek`）存入 vault；`provider_test` 与 `llm_proxy` 的 `providerId` 解析读 DB+vault。前端 `providerStore` + `ProviderLibrary`/`ProviderEditor`，挂到 `AIMemberLibrary` 新 Tab。

**Tech Stack:** Rust/Tauri/rusqlite/reqwest（已有）/vault · React/antd/zustand

**前置条件:** PR1 vault + PR2 llm_proxy 已合并到 `main`。

**PR3 交付后用户能做什么：**
- 群员库 → **模型服务** Tab：增删改 Provider、填 baseURL/models、管理密钥、测试连接
- 左下角全局 API Key 弹窗**暂时保留**（PR4 迁移后移除）
- LLM 群员编辑器**仍用旧 model 下拉**（PR4 改为 Provider/Model 联动）

---

## File Structure

新建：
- `src-tauri/src/provider.rs` — Provider 实体、CRUD、seed、provider_test
- `src/config/providers.ts` — TS 类型 + `builtinProviders` seed（由 `modelConfigs` 去重生成）
- `src/store/providerStore.ts` — zustand + invoke 封装
- `src/pages/chat/components/ProviderLibrary.tsx` — 列表
- `src/pages/chat/components/ProviderEditor.tsx` — 编辑抽屉

修改：
- `src-tauri/src/db.rs` — `providers` 表 + schema test
- `src-tauri/src/api.rs` 或 `provider.rs` — IPC 薄包装
- `src-tauri/src/lib.rs` — 注册命令
- `src-tauri/src/llm_proxy.rs` — 实现 `provider_id` 解析（读 providers + vault）
- `src/pages/chat/components/AIMemberLibrary.tsx` — 新 Tab「模型服务」
- `src/utils/request.ts` — `/api/init` 路径增量 seed builtin providers（类似 ai_members）

不在 PR3：
- ❌ `LLMMember.providerId` / Agent 去 inline llm（PR4）
- ❌ 删 UserSection API Key 弹窗（PR4）
- ❌ B-fork / dry-run / 标签整顿（PR5）

---

## Builtin Provider 去重规则

从 `modelConfigs[]` 生成，按 `(baseURL, apiKeyRef)` 合并 models：

| id | name | baseURL | apiKeyRef | models |
|---|---|---|---|---|
| `qwen` | 通义千问 | dashscope... | `provider:qwen` | qwen-plus, qwen-turbo |
| `deepseek` | DeepSeek | api.deepseek.com... | `provider:deepseek` | deepseek-chat |
| `volcengine` | 火山引擎 | ark.cn-beijing... | `provider:volcengine` | deepseek-v3-..., doubao-..., ep-... |
| `hunyuan` | 腾讯混元 | ... | `provider:hunyuan` | hunyuan-turbos-latest |
| `glm` | 智谱 GLM | ... | `provider:glm` | glm-4-air |
| `kimi` | Moonshot Kimi | ... | `provider:kimi` | moonshot-v1-8k |
| `baidu` | 百度千帆 | ... | `provider:baidu` | ernie-3.5-128k |
| `ollama` | Ollama 本地 | `http://localhost:11434/v1` | `provider:ollama` | （空或占位，用户自填） |

`apiKeyRef` 命名：`provider:{id}`，与 vault secret name 一致。

---

## Task 1: `providers` 表 schema

**Files:** `src-tauri/src/db.rs`

- [ ] 在 `secrets` 表 CREATE 之后追加 `providers` 表（见设计文档 §3.1 SQL）
- [ ] `test_init_db_schemas` 断言 `providers` 存在
- [ ] `cargo test db::tests`
- [ ] Commit: `feat(providers): add providers table schema`

---

## Task 2: `provider.rs` — 实体 + CRUD

**Files:** Create `src-tauri/src/provider.rs`, modify `lib.rs`

- [ ] `Provider` struct（Serialize/Deserialize, camelCase）
- [ ] `list_providers`, `get_provider`, `upsert_provider`, `delete_provider`
- [ ] `delete_provider`：查 `ai_members.config` JSON 是否含 `"providerId":"<id>"`（字符串 grep 或解析），有引用则 Err
- [ ] 单测：in-memory DB roundtrip
- [ ] Commit: `feat(providers): Rust CRUD for providers table`

---

## Task 3: Provider IPC + lib 注册

**Files:** `src-tauri/src/provider.rs`, `lib.rs`

- [ ] `#[tauri::command]` 包装四个 CRUD + `seed_builtin_providers`
- [ ] 注册到 `invoke_handler`
- [ ] Commit: `feat(providers): expose provider IPC commands`

---

## Task 4: `seed_builtin_providers` + init 增量 seed

**Files:** `provider.rs`, `request.ts` `/api/init`

- [ ] Rust `seed_builtin_providers(providers: Vec<Provider>)` — INSERT OR IGNORE by id（builtin 不覆盖 user 改过的同 id）
- [ ] 前端 `src/config/providers.ts` 导出 `builtinProviders`
- [ ] `/api/init`：list_providers → 缺 id 则 seed_builtin_providers(missing)
- [ ] Commit: `feat(providers): incremental builtin provider seed on init`

---

## Task 5: `llm_proxy` 实现 `providerId` 解析

**Files:** `src-tauri/src/llm_proxy.rs`

- [ ] `resolve_endpoint` 扩展：若 `provider_id` 有值，从 DB 读 Provider，`vault::get(conn, master, api_key_ref)`
- [ ] 密钥缺失 → 明确 BadRequest 错误
- [ ] 单测：mock provider row + vault secret
- [ ] Commit: `feat(llm-proxy): resolve providerId via DB and vault`

---

## Task 6: `provider_test` 命令

**Files:** `provider.rs`

- [ ] `ProviderTestResult { ok, latency_ms, model_echo, error_class, message }`
- [ ] 发最小 non-stream POST `/chat/completions`（messages: hi, max_tokens: 1）
- [ ] 错误分类：auth(401) / network / 5xx / 4xx / ok
- [ ] wiremock 单测
- [ ] Commit: `feat(providers): add provider_test connection ping`

---

## Task 7: 前端 `providerStore.ts`

**Files:** Create `src/store/providerStore.ts`

- [ ] mapFromRust / mapToRust（models JSON 数组）
- [ ] load, get, upsert, remove, testConnection
- [ ] `setProviderSecret(id, value)` → invoke `secret_set` name=`provider:{id}`
- [ ] `hasProviderSecret(id)` → invoke `secret_has`
- [ ] Commit: `feat(providers): frontend providerStore`

---

## Task 8: `ProviderEditor.tsx`

**Files:** Create component

字段：name, baseURL, models（tags 输入）, description, enabled  
按钮：
- **保存** → upsert_provider + 若有 apiKey 输入则 secret_set
- **测试连接** → provider_test（保存后或临时用表单 baseURL+刚设的 key）
- **管理密钥** — Input.Password + secret_has 显示「已配置/未配置」

builtin Provider：只读 + 「克隆并编辑」按钮（创建 user 副本，新 id `user-{orig}-{ts}`）— 轻量 B-fork 仅 Provider 范围

- [ ] Commit: `feat(providers): ProviderEditor drawer`

---

## Task 9: `ProviderLibrary.tsx` + AIMemberLibrary Tab

**Files:** ProviderLibrary, AIMemberLibrary

- [ ] 列表卡片：name, baseURL, models 数量, 密钥状态 ✓/⚠️, builtin badge
- [ ] 新建 / 编辑 / 删除（builtin 不可删）
- [ ] `AIMemberLibrary` Tabs 加第三项「模型服务」或独立 Tab 与 LLM/Agent/CLI 并列
- [ ] Commit: `feat(providers): Provider library tab in member management`

---

## Task 10: 验证 + PR

- [ ] `cargo test` 全绿
- [ ] `npm run build`
- [ ] 手动：新建 Provider → 设密钥 → 测试连接 OK
- [ ] Push + `gh pr create` against main

---

## Execution Handoff

Plan saved to `docs/plans/2026-05-23-pr3-providers-ui.md`.

**Subagent-Driven（推荐）** 或 **Inline Execution** — 与 PR2 相同流程。
