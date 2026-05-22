# PR1: Secrets Vault 基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Rust 端落地 `secrets` 表 + AES-256-GCM 加密 vault + 4 个 IPC 命令（`secret_set` / `secret_has` / `secret_delete` / `secret_list_names`），master key 存到 `${app_data_dir}/master.key`，**不暴露 `secret_get` IPC**——密文只能在 Rust 内部解开。

**Architecture:** 新增 `src-tauri/src/vault.rs` 作为独立模块，包含 master key bootstrap、AES-GCM 加解密、SQLite 持久化三层；`db.rs` 加 `secrets` 表；`api.rs` 加四个 IPC 命令薄包装；`lib.rs` 注册新命令。所有 vault 公开函数接受 `&Connection` 和 `&[u8; 32]` master key 作为参数，方便用 in-memory SQLite 单测。

**Tech Stack:** Rust 2021 / Tauri v2 / rusqlite 0.31 / `aes-gcm` 0.10（RustCrypto, 无 unsafe, 无 C 依赖）/ `tempfile` 3.x（dev-dep, 用于文件路径单测）

---

## File Structure

新建文件：

- `src-tauri/src/vault.rs` — 全部 vault 逻辑（master key、crypto、DB）+ 单测

修改文件：

- `src-tauri/Cargo.toml` — 加 `aes-gcm`、`tempfile`（dev）
- `src-tauri/src/db.rs` — `init_db_schemas` 内加 `secrets` 表
- `src-tauri/src/api.rs` — 4 个 IPC 命令薄包装
- `src-tauri/src/lib.rs` — `mod vault;` + 注册 4 个新 invoke handler

PR1 **不涉及前端任何改动**——前端会继续读写 `localStorage.API_KEY_*`，dual-path 直到 PR4。

---

## Task 1: 加 Cargo 依赖

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: 加 aes-gcm 和 tempfile 依赖**

打开 `src-tauri/Cargo.toml`，在 `[dependencies]` 末尾添加：

```toml
aes-gcm = "0.10"
```

在文件末尾（`[dependencies]` 之外）添加新 section：

```toml
[dev-dependencies]
tempfile = "3"
```

完整 `[dependencies]` 块应该长这样：

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31.0", features = ["bundled"] }
uuid = { version = "1.8.0", features = ["v4"] }
chrono = { version = "0.4.38", features = ["serde"] }
tokio = { version = "1", features = ["process", "io-util", "rt", "rt-multi-thread", "sync", "macros", "time"] }
which = "6"
rfd = "0.14"
aes-gcm = "0.10"

[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo check`
Expected: 通过，下载并编译 `aes-gcm` 及其传递依赖（`aead`、`aes`、`ghash` 等）；不应有新 warning。

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat(vault): add aes-gcm + tempfile deps for secrets vault"
```

---

## Task 2: 加 `secrets` 表 schema

**Files:**
- Modify: `src-tauri/src/db.rs:289-305`（在 `ai_members` 表 CREATE 之后）

- [ ] **Step 1: 先在 db.rs 的 `tests` mod 里写一个失败测试**

打开 `src-tauri/src/db.rs`，定位到 `mod tests` 块（文件末尾 line 316+）。在 `test_init_db_schemas` 函数内的 assert 列表末尾添加一行：

```rust
        assert!(tables.contains(&"secrets".to_string()));
```

完整 assert 列表改后长这样（仅末尾追加 1 行）：

```rust
        assert!(tables.contains(&"users".to_string()));
        assert!(tables.contains(&"claw_groups".to_string()));
        assert!(tables.contains(&"cli_tasks".to_string()));
        assert!(tables.contains(&"cli_runtimes".to_string()));
        assert!(tables.contains(&"cli_agent_profiles".to_string()));
        assert!(tables.contains(&"cli_skill_packs".to_string()));
        assert!(tables.contains(&"cli_agent_skill_packs".to_string()));
        assert!(tables.contains(&"ai_members".to_string()));
        assert!(tables.contains(&"secrets".to_string()));
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib db::tests::test_init_db_schemas`
Expected: FAIL with `assertion failed: tables.contains(&"secrets".to_string())`

- [ ] **Step 3: 在 `init_db_schemas` 里加 `secrets` 表 + 索引**

定位到 `src-tauri/src/db.rs` 中 `// Create AI members table` 那段（line 289-305 附近），在 `ai_members` 表 CREATE 语句**之后**、紧接的 `// Create indices` 块**之前**插入：

```rust
    // Create secrets table for AI member API keys (encrypted with AES-256-GCM,
    // AAD = name to prevent ciphertext swap attacks). See vault.rs for crypto.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS secrets (
            name        TEXT PRIMARY KEY,
            ciphertext  BLOB NOT NULL,
            nonce       BLOB NOT NULL,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );",
        [],
    )?;
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test --lib db::tests::test_init_db_schemas`
Expected: PASS, 1 passed

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db.rs
git commit -m "feat(vault): add secrets table schema in db.rs"
```

---

## Task 3: 创建 `vault.rs` 骨架（错误类型 + 常量）

**Files:**
- Create: `src-tauri/src/vault.rs`
- Modify: `src-tauri/src/lib.rs`（注册 mod）

- [ ] **Step 1: 创建 `vault.rs` 包含错误类型与常量**

新建文件 `src-tauri/src/vault.rs`，内容：

```rust
//! Encrypted key-value secrets vault backed by SQLite + AES-256-GCM.
//!
//! Threat model:
//! - Secrets at rest in `secrets` table are AES-256-GCM encrypted.
//! - AAD = secret name, so ciphertext swap between names fails decryption.
//! - Master key stored separately in `${app_data}/master.key` (0600 on Unix).
//! - **No `secret_get` IPC is exposed.** Plaintext never crosses the Tauri
//!   boundary; Rust-internal modules call `vault::get` directly.
//!
//! Master key loss = vault loss. v1 does not back up; document accordingly.

use std::fmt;
use std::path::Path;

pub const MASTER_KEY_FILENAME: &str = "master.key";
pub const KEY_LEN: usize = 32;     // AES-256
pub const NONCE_LEN: usize = 12;   // GCM standard nonce size

#[derive(Debug)]
pub enum VaultError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Crypto(String),
    KeyCorrupted(String),
    NotFound,
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::Io(e) => write!(f, "vault io error: {}", e),
            VaultError::Sqlite(e) => write!(f, "vault sqlite error: {}", e),
            VaultError::Crypto(s) => write!(f, "vault crypto error: {}", s),
            VaultError::KeyCorrupted(s) => write!(f, "vault master key corrupted: {}", s),
            VaultError::NotFound => write!(f, "vault entry not found"),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<std::io::Error> for VaultError {
    fn from(e: std::io::Error) -> Self { VaultError::Io(e) }
}

impl From<rusqlite::Error> for VaultError {
    fn from(e: rusqlite::Error) -> Self { VaultError::Sqlite(e) }
}

/// Placeholder; functions filled in subsequent tasks.
pub fn _ensure_path_exists(_p: &Path) -> Result<(), VaultError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_have_expected_sizes() {
        assert_eq!(KEY_LEN, 32);
        assert_eq!(NONCE_LEN, 12);
    }

    #[test]
    fn vault_error_display_is_nonempty() {
        let e = VaultError::NotFound;
        assert!(!format!("{}", e).is_empty());
    }
}
```

- [ ] **Step 2: 在 `lib.rs` 注册新 module**

打开 `src-tauri/src/lib.rs`，在文件顶部 `mod cli;` 一行后面加：

```rust
mod vault;
```

完整的 mod 块应该长这样：

```rust
mod db;
mod api;
mod cli;
mod vault;
```

- [ ] **Step 3: 跑测试确认骨架可编译且测试通过**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: PASS, 2 passed (`constants_have_expected_sizes`, `vault_error_display_is_nonempty`)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/vault.rs src-tauri/src/lib.rs
git commit -m "feat(vault): scaffold vault module with error type and constants"
```

---

## Task 4: Master key bootstrap（生成/读取 + Unix 权限）

**Files:**
- Modify: `src-tauri/src/vault.rs`

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/vault.rs` 的 `#[cfg(test)] mod tests` 内追加：

```rust
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn master_key_generated_on_first_load() {
        let dir = tempdir().unwrap();
        let key_path = dir.path().join("master.key");
        assert!(!key_path.exists());

        let k1 = load_or_create_master_key(&key_path).unwrap();
        assert_eq!(k1.len(), KEY_LEN);
        assert!(key_path.exists());
        assert_eq!(fs::metadata(&key_path).unwrap().len() as usize, KEY_LEN);
    }

    #[test]
    fn master_key_is_stable_across_loads() {
        let dir = tempdir().unwrap();
        let key_path = dir.path().join("master.key");

        let k1 = load_or_create_master_key(&key_path).unwrap();
        let k2 = load_or_create_master_key(&key_path).unwrap();
        assert_eq!(k1, k2, "loading twice must return the same key bytes");
    }

    #[test]
    fn master_key_rejects_wrong_size_file() {
        let dir = tempdir().unwrap();
        let key_path = dir.path().join("master.key");
        fs::write(&key_path, b"too-short").unwrap();

        let res = load_or_create_master_key(&key_path);
        match res {
            Err(VaultError::KeyCorrupted(_)) => (),
            other => panic!("expected KeyCorrupted, got {:?}", other),
        }
    }

    #[cfg(unix)]
    #[test]
    fn master_key_has_0600_perms_on_unix() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let key_path = dir.path().join("master.key");
        load_or_create_master_key(&key_path).unwrap();

        let mode = fs::metadata(&key_path).unwrap().permissions().mode();
        // Mask off file type bits, only check user/group/other
        assert_eq!(mode & 0o777, 0o600, "master.key permissions must be 0600, got {:o}", mode);
    }
```

- [ ] **Step 2: 跑测试确认失败（函数不存在）**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: FAIL with `cannot find function load_or_create_master_key`

- [ ] **Step 3: 实现 `load_or_create_master_key`**

在 `src-tauri/src/vault.rs` 中，把占位的 `_ensure_path_exists` 函数**替换**为：

```rust
use std::fs;
use std::io::Write;

use aes_gcm::aead::OsRng;
use aes_gcm::aead::rand_core::RngCore;

/// Load existing master key from disk, or create a new random one.
///
/// On Unix, the file is created with mode 0600 (owner read/write only).
/// On Windows, default ACL restricts to the current user; explicit ACL
/// tightening can be added later.
///
/// Returns `KeyCorrupted` if the file exists but has wrong size.
pub fn load_or_create_master_key(key_path: &Path) -> Result<[u8; KEY_LEN], VaultError> {
    if key_path.exists() {
        let bytes = fs::read(key_path)?;
        if bytes.len() != KEY_LEN {
            return Err(VaultError::KeyCorrupted(format!(
                "master.key has {} bytes, expected {}",
                bytes.len(),
                KEY_LEN
            )));
        }
        let mut out = [0u8; KEY_LEN];
        out.copy_from_slice(&bytes);
        return Ok(out);
    }

    // Ensure parent directory exists
    if let Some(parent) = key_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut key = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);

    // Create file with restrictive permissions atomically where possible.
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(key_path)?;
        f.write_all(&key)?;
        f.sync_all()?;
    }

    #[cfg(not(unix))]
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(key_path)?;
        f.write_all(&key)?;
        f.sync_all()?;
    }

    Ok(key)
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: PASS, 6 passed（2 个旧 + 4 个新；`master_key_has_0600_perms_on_unix` 在 Unix 上跑、Windows 上 cfg-out）

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/vault.rs
git commit -m "feat(vault): bootstrap master.key with 0600 perms on Unix"
```

---

## Task 5: AES-256-GCM 加解密（AAD = name）

**Files:**
- Modify: `src-tauri/src/vault.rs`

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/vault.rs` 的 `#[cfg(test)] mod tests` 内继续追加：

```rust
    fn dummy_key() -> [u8; KEY_LEN] {
        let mut k = [0u8; KEY_LEN];
        for i in 0..KEY_LEN { k[i] = i as u8; }
        k
    }

    #[test]
    fn encrypt_decrypt_round_trip() {
        let key = dummy_key();
        let (ct, nonce) = encrypt(&key, "provider:qwen", "sk-abc123").unwrap();

        assert_eq!(nonce.len(), NONCE_LEN);
        assert_ne!(&ct, b"sk-abc123", "ciphertext must differ from plaintext");

        let pt = decrypt(&key, "provider:qwen", &ct, &nonce).unwrap();
        assert_eq!(pt, "sk-abc123");
    }

    #[test]
    fn decrypt_with_wrong_aad_fails() {
        // Critical: ciphertext bound to name. Swapping name = AAD mismatch.
        let key = dummy_key();
        let (ct, nonce) = encrypt(&key, "provider:qwen", "sk-abc123").unwrap();

        let res = decrypt(&key, "provider:deepseek", &ct, &nonce);
        match res {
            Err(VaultError::Crypto(_)) => (),
            other => panic!("expected Crypto error on AAD mismatch, got {:?}", other),
        }
    }

    #[test]
    fn decrypt_with_wrong_key_fails() {
        let key1 = dummy_key();
        let mut key2 = dummy_key();
        key2[0] ^= 0xff;

        let (ct, nonce) = encrypt(&key1, "k", "v").unwrap();
        let res = decrypt(&key2, "k", &ct, &nonce);
        match res {
            Err(VaultError::Crypto(_)) => (),
            other => panic!("expected Crypto error on wrong key, got {:?}", other),
        }
    }

    #[test]
    fn nonces_are_random_per_encrypt() {
        // Same key + same plaintext + same AAD must produce different nonces.
        let key = dummy_key();
        let (_ct1, n1) = encrypt(&key, "k", "v").unwrap();
        let (_ct2, n2) = encrypt(&key, "k", "v").unwrap();
        assert_ne!(n1, n2, "nonces must be random per encrypt");
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: FAIL with `cannot find function encrypt` / `decrypt`

- [ ] **Step 3: 实现 encrypt/decrypt**

在 `src-tauri/src/vault.rs` 中现有 `use` 块下面添加：

```rust
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit, Payload};
```

然后在文件中（建议放在 `load_or_create_master_key` 之后）添加：

```rust
/// Encrypt `value` with AES-256-GCM. AAD is bound to `name` so the resulting
/// ciphertext cannot be successfully decrypted under a different name even
/// with the correct key.
pub fn encrypt(master: &[u8; KEY_LEN], name: &str, value: &str)
    -> Result<(Vec<u8>, Vec<u8>), VaultError>
{
    let key = Key::<Aes256Gcm>::from_slice(master);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ct = cipher
        .encrypt(nonce, Payload { msg: value.as_bytes(), aad: name.as_bytes() })
        .map_err(|e| VaultError::Crypto(format!("encrypt: {}", e)))?;

    Ok((ct, nonce_bytes.to_vec()))
}

/// Decrypt ciphertext produced by `encrypt`. The same `name` (AAD) must be
/// supplied or decryption will fail.
pub fn decrypt(master: &[u8; KEY_LEN], name: &str, ciphertext: &[u8], nonce: &[u8])
    -> Result<String, VaultError>
{
    if nonce.len() != NONCE_LEN {
        return Err(VaultError::Crypto(format!(
            "nonce has {} bytes, expected {}", nonce.len(), NONCE_LEN
        )));
    }
    let key = Key::<Aes256Gcm>::from_slice(master);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce);

    let pt = cipher
        .decrypt(nonce, Payload { msg: ciphertext, aad: name.as_bytes() })
        .map_err(|e| VaultError::Crypto(format!("decrypt: {}", e)))?;

    String::from_utf8(pt)
        .map_err(|e| VaultError::Crypto(format!("decrypt: invalid utf-8: {}", e)))
}
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: PASS, 10 passed

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/vault.rs
git commit -m "feat(vault): implement AES-256-GCM encrypt/decrypt with AAD=name"
```

---

## Task 6: DB 持久化层（set / has / delete / list_names）

**Files:**
- Modify: `src-tauri/src/vault.rs`

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/vault.rs` 的 `#[cfg(test)] mod tests` 内继续追加：

```rust
    use rusqlite::Connection;

    fn fresh_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_db_schemas(&conn).unwrap();
        conn
    }

    #[test]
    fn db_set_and_has() {
        let conn = fresh_conn();
        let key = dummy_key();

        assert!(!has(&conn, "provider:qwen").unwrap());
        set(&conn, &key, "provider:qwen", "sk-abc123").unwrap();
        assert!(has(&conn, "provider:qwen").unwrap());
    }

    #[test]
    fn db_set_then_get_round_trip() {
        let conn = fresh_conn();
        let key = dummy_key();

        set(&conn, &key, "provider:deepseek", "sk-xyz").unwrap();
        let got = get(&conn, &key, "provider:deepseek").unwrap();
        assert_eq!(got, Some("sk-xyz".to_string()));
    }

    #[test]
    fn db_get_missing_returns_none() {
        let conn = fresh_conn();
        let key = dummy_key();
        let got = get(&conn, &key, "provider:does-not-exist").unwrap();
        assert_eq!(got, None);
    }

    #[test]
    fn db_set_overwrites_existing() {
        let conn = fresh_conn();
        let key = dummy_key();
        set(&conn, &key, "k", "v1").unwrap();
        set(&conn, &key, "k", "v2").unwrap();
        assert_eq!(get(&conn, &key, "k").unwrap(), Some("v2".to_string()));
    }

    #[test]
    fn db_delete_removes_entry() {
        let conn = fresh_conn();
        let key = dummy_key();
        set(&conn, &key, "k", "v").unwrap();
        assert!(has(&conn, "k").unwrap());

        delete(&conn, "k").unwrap();
        assert!(!has(&conn, "k").unwrap());
        assert_eq!(get(&conn, &key, "k").unwrap(), None);
    }

    #[test]
    fn db_delete_missing_is_idempotent() {
        let conn = fresh_conn();
        // Should not error even if name doesn't exist
        delete(&conn, "never-existed").unwrap();
    }

    #[test]
    fn db_list_names_returns_only_names_not_values() {
        let conn = fresh_conn();
        let key = dummy_key();
        set(&conn, &key, "provider:a", "secret-a-value").unwrap();
        set(&conn, &key, "provider:b", "secret-b-value").unwrap();

        let mut names = list_names(&conn).unwrap();
        names.sort();
        assert_eq!(names, vec!["provider:a", "provider:b"]);
    }

    #[test]
    fn db_decrypt_fails_if_ciphertext_swapped_between_names() {
        // Integration check that AAD binding works through the DB layer.
        let conn = fresh_conn();
        let key = dummy_key();
        set(&conn, &key, "provider:a", "value-a").unwrap();
        set(&conn, &key, "provider:b", "value-b").unwrap();

        // Swap ciphertexts directly in DB
        let (ct_a, nonce_a): (Vec<u8>, Vec<u8>) = conn.query_row(
            "SELECT ciphertext, nonce FROM secrets WHERE name = 'provider:a'",
            [], |row| Ok((row.get(0)?, row.get(1)?))
        ).unwrap();
        conn.execute(
            "UPDATE secrets SET ciphertext = ?1, nonce = ?2 WHERE name = 'provider:b'",
            rusqlite::params![ct_a, nonce_a],
        ).unwrap();

        // Now provider:b holds ciphertext encrypted under AAD='provider:a'.
        // get should fail because AAD won't match.
        let res = get(&conn, &key, "provider:b");
        match res {
            Err(VaultError::Crypto(_)) => (),
            other => panic!("expected Crypto error on AAD swap, got {:?}", other),
        }
    }
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: FAIL with `cannot find function set` / `has` / `get` / `delete` / `list_names`

- [ ] **Step 3: 实现 DB 持久化函数**

在 `src-tauri/src/vault.rs` 中（加在 `decrypt` 之后），添加：

```rust
use rusqlite::{params, Connection};

/// Upsert: encrypt `value` and store under `name` (overwriting if exists).
pub fn set(conn: &Connection, master: &[u8; KEY_LEN], name: &str, value: &str)
    -> Result<(), VaultError>
{
    let (ct, nonce) = encrypt(master, name, value)?;
    conn.execute(
        "INSERT INTO secrets (name, ciphertext, nonce, updated_at)
         VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO UPDATE SET
            ciphertext = excluded.ciphertext,
            nonce      = excluded.nonce,
            updated_at = CURRENT_TIMESTAMP",
        params![name, ct, nonce],
    )?;
    Ok(())
}

/// Decrypt and return value for `name`, or `Ok(None)` if not present.
/// Returns `VaultError::Crypto` if decryption fails (e.g., AAD mismatch).
pub fn get(conn: &Connection, master: &[u8; KEY_LEN], name: &str)
    -> Result<Option<String>, VaultError>
{
    let row: Option<(Vec<u8>, Vec<u8>)> = conn
        .query_row(
            "SELECT ciphertext, nonce FROM secrets WHERE name = ?1",
            params![name],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })?;

    match row {
        None => Ok(None),
        Some((ct, nonce)) => {
            let pt = decrypt(master, name, &ct, &nonce)?;
            Ok(Some(pt))
        }
    }
}

/// Returns true iff a row with `name` exists. Does NOT touch crypto.
pub fn has(conn: &Connection, name: &str) -> Result<bool, VaultError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM secrets WHERE name = ?1",
        params![name],
        |row| row.get(0),
    )?;
    Ok(count > 0)
}

/// Delete the row with `name`. Idempotent (no error if missing).
pub fn delete(conn: &Connection, name: &str) -> Result<(), VaultError> {
    conn.execute("DELETE FROM secrets WHERE name = ?1", params![name])?;
    Ok(())
}

/// Return all stored secret names (no values, no ciphertexts).
pub fn list_names(conn: &Connection) -> Result<Vec<String>, VaultError> {
    let mut stmt = conn.prepare("SELECT name FROM secrets ORDER BY name")?;
    let names = stmt
        .query_map([], |row| row.get(0))?
        .collect::<Result<Vec<String>, _>>()?;
    Ok(names)
}
```

- [ ] **Step 4: 跑测试确认全部通过**

Run: `cd src-tauri && cargo test --lib vault::tests`
Expected: PASS, 18 passed

- [ ] **Step 5: 跑整个 src-tauri 测试套件确保没破其他东西**

Run: `cd src-tauri && cargo test --lib`
Expected: 全部通过（db::tests + vault::tests + 任何其他既有 lib tests）

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/vault.rs
git commit -m "feat(vault): persist secrets via SQLite with crypto wrappers"
```

---

## Task 7: IPC 命令薄包装 + 注册到 invoke handler

**Files:**
- Modify: `src-tauri/src/api.rs`（追加 4 个新命令 + helper）
- Modify: `src-tauri/src/lib.rs`（注册新命令）

- [ ] **Step 1: 在 `api.rs` 顶部补 `use tauri::Manager;` 与 `use crate::vault;`**

打开 `src-tauri/src/api.rs`，定位到文件顶部的 use 块（line 1-5），找到这一行：

```rust
use tauri::AppHandle;
```

**紧接其后**添加两行（一行启用 `Manager` trait 让 `app.path()` 可用，一行引入 vault 模块）：

```rust
use tauri::Manager;
use crate::vault;
```

修改后这一段应为：

```rust
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri::Manager;
use uuid::Uuid;
use crate::db::get_db_path;
use crate::vault;
```

- [ ] **Step 2: 在 `api.rs` 末尾追加 helper 与四个 IPC 命令**

在文件**最末尾**追加：

```rust
// ───── Secrets Vault IPC ─────
// See `vault.rs` for design notes. Intentionally there is NO `secret_get`
// command — plaintext values never cross the Tauri boundary.

fn vault_load_master(app: &AppHandle) -> Result<[u8; vault::KEY_LEN], String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("vault: cannot resolve app_data_dir: {}", e))?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push(vault::MASTER_KEY_FILENAME);
    vault::load_or_create_master_key(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_set(app: AppHandle, name: String, value: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    let master = vault_load_master(&app)?;
    vault::set(&conn, &master, &name, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_has(app: AppHandle, name: String) -> Result<bool, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    vault::has(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_delete(app: AppHandle, name: String) -> Result<(), String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    vault::delete(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn secret_list_names(app: AppHandle) -> Result<Vec<String>, String> {
    let db_path = get_db_path(&app);
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    vault::list_names(&conn).map_err(|e| e.to_string())
}
```

- [ ] **Step 3: 在 `lib.rs` 的 `invoke_handler!` 内注册四个新命令**

打开 `src-tauri/src/lib.rs`，定位到 `invoke_handler` 块（line 18-44），在 `api::seed_builtin_ai_members,` 这一行之后插入：

```rust
            api::secret_set,
            api::secret_has,
            api::secret_delete,
            api::secret_list_names,
```

修改后 `invoke_handler` 完整块长这样：

```rust
        .invoke_handler(tauri::generate_handler![
            api::get_current_user,
            api::create_local_user,
            api::update_user_info,
            api::get_claw_groups,
            api::create_claw_group,
            api::join_claw_group,
            api::get_claw_messages,
            api::send_claw_message,
            api::select_directory,
            api::list_ai_members,
            api::get_ai_member,
            api::upsert_ai_member,
            api::delete_ai_member,
            api::seed_builtin_ai_members,
            api::secret_set,
            api::secret_has,
            api::secret_delete,
            api::secret_list_names,
            cli::cli_run,
            cli::cli_kill,
            cli::cli_check,
            cli::cli_task_list,
            cli::cli_task_get,
            cli::cli_task_read_log,
            cli::cli_runtime_list,
            cli::cli_worktree_prepare,
            cli::cli_worktree_cleanup,
            cli::cli_tempcopy_prepare,
            cli::cli_tempcopy_cleanup
        ])
```

- [ ] **Step 4: 验证整个 src-tauri crate 编译通过**

Run: `cd src-tauri && cargo build`
Expected: 编译成功，无 error；warning 仅可接受 dead_code（`vault::get` 在 PR1 尚无调用方，PR2 会调用）

- [ ] **Step 5: 跑全部 lib 测试确认无回归**

Run: `cd src-tauri && cargo test --lib`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/api.rs src-tauri/src/lib.rs
git commit -m "feat(vault): expose secret_set/has/delete/list_names IPC (no secret_get)"
```

---

## Task 8: 在 vault.rs 顶部追加"下游 PR 契约"文档

**Files:**
- Modify: `src-tauri/src/vault.rs`（顶部 doc-comment 追加一段）

这一任务的作用是把 PR1 ↔ PR2/PR4 的接口契约写在源码里，避免后续 PR 无意破坏（例如新加一个 `secret_get` IPC）。

- [ ] **Step 1: 在 `vault.rs` 顶部 doc-comment 后追加一段"PR2+ 用户须知"**

打开 `src-tauri/src/vault.rs`，在 `//! Master key loss = vault loss. v1 does not back up; document accordingly.` 之后追加：

```rust
//!
//! ## Contract for downstream PRs
//!
//! - **PR2** (`llm_proxy.rs`) should call `vault::get(conn, master, name)` from
//!   Rust-internal code. It MUST NOT expose a Tauri command that returns
//!   plaintext.
//! - **PR4** (one-shot migration) should call `vault::set(...)` inside the
//!   same SQLite transaction as the rest of the migration; pass a `&Connection`
//!   obtained from `tx`/conn (rusqlite::Transaction `deref`s to `Connection`).
//! - Future "user-password-wraps-master-key" (v2) should change
//!   `load_or_create_master_key` signature to accept an optional passphrase;
//!   keep the existing call sites working with `None`.
```

- [ ] **Step 2: 验证编译**

Run: `cd src-tauri && cargo build`
Expected: PASS（只是注释，无功能性变化）

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/vault.rs
git commit -m "docs(vault): document contract for downstream PRs"
```

---

## 最终验证

完成所有任务后，运行一次完整确认：

- [ ] **运行全部 Rust 测试**

```bash
cd src-tauri && cargo test --lib
```

Expected: 全部通过，至少包含：
- `db::tests::test_init_db_schemas` (1)
- `vault::tests::*` (18 个新测试)

- [ ] **确认 IPC 注册数量**

```bash
grep -c "api::secret_" src-tauri/src/lib.rs
```

Expected: `4`

- [ ] **确认 vault.rs 没意外暴露 `secret_get` IPC**

```bash
grep -c "secret_get" src-tauri/src/api.rs
```

Expected: `0`

- [ ] **Push 分支**

```bash
git push -u origin <branch-name>
```

---

## Spec 覆盖对照

参照 `docs/plans/2026-05-22-ai-member-library-optimization-design.md` 第 2 节：

| Spec 要求 | 对应 Task | 验证手段 |
|---|---|---|
| AES-256-GCM, AAD=name | Task 5 | `decrypt_with_wrong_aad_fails` / `db_decrypt_fails_if_ciphertext_swapped_between_names` |
| Master key 32 字节 / 文件存储 | Task 4 | `master_key_generated_on_first_load` / `master_key_is_stable_across_loads` |
| Unix 0600 权限 | Task 4 | `master_key_has_0600_perms_on_unix` |
| 损坏检测 | Task 4 | `master_key_rejects_wrong_size_file` |
| `secrets` 表 schema | Task 2 | `test_init_db_schemas` 加 secrets assert |
| `secret_set/has/delete/list_names` IPC | Task 7 | grep + 编译通过 |
| **无 `secret_get` IPC** | Task 7 / Task 8 | grep "secret_get" = 0 + 顶部文档明示 |
| list_names 不泄露值 | Task 6 | `db_list_names_returns_only_names_not_values` |
| Nonce 每次随机 | Task 5 | `nonces_are_random_per_encrypt` |

---

## PR1 不做的事（防 scope creep）

明确不在本 PR 范围、由后续 PR 接手：

- ❌ Master key 用户密码包裹 / Argon2id 派生（v2）
- ❌ master.key 损坏时的诊断 UI（PR4 启动 self-check）
- ❌ 前端任何改动
- ❌ Provider/AI Member 的字段改造（PR3/PR4）
- ❌ localStorage `API_KEY_*` 迁移（PR4）
- ❌ Windows ACL 显式收紧（追到 v2，PR1 用默认 ACL = 当前用户）
- ❌ Master key 文件加锁（`fs2`）—— 多实例并发问题留到 v2，因为目前 botgroup desktop 只有一个实例运行
