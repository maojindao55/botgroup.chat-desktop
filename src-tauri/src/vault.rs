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

use std::fmt;
use std::path::Path;

pub const MASTER_KEY_FILENAME: &str = "master.key";
pub const KEY_LEN: usize = 32; // AES-256
pub const NONCE_LEN: usize = 12; // GCM standard nonce size

// `allow(dead_code)`: some variants are constructed only by code paths not yet
// wired up in PR1 (e.g., `NotFound` is reserved for higher-level wrappers in
// PR2). The variants are part of the public API contract for the module.
#[allow(dead_code)]
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
    fn from(e: std::io::Error) -> Self {
        VaultError::Io(e)
    }
}

impl From<rusqlite::Error> for VaultError {
    fn from(e: rusqlite::Error) -> Self {
        VaultError::Sqlite(e)
    }
}

use std::fs;
use std::io::Write;

use tauri::{AppHandle, Manager};

/// Load or create the app master key from `${app_data}/master.key`.
pub fn load_master_key(app: &AppHandle) -> Result<[u8; KEY_LEN], String> {
    let mut path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("vault: cannot resolve app_data_dir: {}", e))?;
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    path.push(MASTER_KEY_FILENAME);
    load_or_create_master_key(&path).map_err(|e| e.to_string())
}

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::OsRng;
use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Key, Nonce};

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

/// Encrypt `value` with AES-256-GCM. AAD is bound to `name` so the resulting
/// ciphertext cannot be successfully decrypted under a different name even
/// with the correct key.
pub fn encrypt(
    master: &[u8; KEY_LEN],
    name: &str,
    value: &str,
) -> Result<(Vec<u8>, Vec<u8>), VaultError> {
    let key = Key::<Aes256Gcm>::from_slice(master);
    let cipher = Aes256Gcm::new(key);

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ct = cipher
        .encrypt(
            nonce,
            Payload {
                msg: value.as_bytes(),
                aad: name.as_bytes(),
            },
        )
        .map_err(|e| VaultError::Crypto(format!("encrypt: {}", e)))?;

    Ok((ct, nonce_bytes.to_vec()))
}

/// Decrypt ciphertext produced by `encrypt`. The same `name` (AAD) must be
/// supplied or decryption will fail.
///
/// `allow(dead_code)`: PR1 ships the function but no Rust-side caller exists
/// yet; PR2 (`llm_proxy.rs`) is the first consumer. Remove the attribute then.
#[allow(dead_code)]
pub fn decrypt(
    master: &[u8; KEY_LEN],
    name: &str,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<String, VaultError> {
    if nonce.len() != NONCE_LEN {
        return Err(VaultError::Crypto(format!(
            "nonce has {} bytes, expected {}",
            nonce.len(),
            NONCE_LEN
        )));
    }
    let key = Key::<Aes256Gcm>::from_slice(master);
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(nonce);

    let pt = cipher
        .decrypt(
            nonce,
            Payload {
                msg: ciphertext,
                aad: name.as_bytes(),
            },
        )
        .map_err(|e| VaultError::Crypto(format!("decrypt: {}", e)))?;

    String::from_utf8(pt).map_err(|e| VaultError::Crypto(format!("decrypt: invalid utf-8: {}", e)))
}

use rusqlite::{params, Connection};

/// Upsert: encrypt `value` and store under `name` (overwriting if exists).
pub fn set(
    conn: &Connection,
    master: &[u8; KEY_LEN],
    name: &str,
    value: &str,
) -> Result<(), VaultError> {
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
pub fn get(
    conn: &Connection,
    master: &[u8; KEY_LEN],
    name: &str,
) -> Result<Option<String>, VaultError> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

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
        assert_eq!(
            mode & 0o777,
            0o600,
            "master.key permissions must be 0600, got {:o}",
            mode
        );
    }

    fn dummy_key() -> [u8; KEY_LEN] {
        let mut k = [0u8; KEY_LEN];
        for i in 0..KEY_LEN {
            k[i] = i as u8;
        }
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
        let (ct_a, nonce_a): (Vec<u8>, Vec<u8>) = conn
            .query_row(
                "SELECT ciphertext, nonce FROM secrets WHERE name = 'provider:a'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        conn.execute(
            "UPDATE secrets SET ciphertext = ?1, nonce = ?2 WHERE name = 'provider:b'",
            rusqlite::params![ct_a, nonce_a],
        )
        .unwrap();

        // Now provider:b holds ciphertext encrypted under AAD='provider:a'.
        // get should fail because AAD won't match.
        let res = get(&conn, &key, "provider:b");
        match res {
            Err(VaultError::Crypto(_)) => (),
            other => panic!("expected Crypto error on AAD swap, got {:?}", other),
        }
    }
}
