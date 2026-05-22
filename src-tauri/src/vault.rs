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
