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

use std::fs;
use std::io::Write;

use aes_gcm::aead::OsRng;
use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::{Aes256Gcm, Key, Nonce};
use aes_gcm::aead::{Aead, KeyInit, Payload};

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
        assert_eq!(mode & 0o777, 0o600, "master.key permissions must be 0600, got {:o}", mode);
    }

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
}
