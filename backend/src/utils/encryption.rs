use aes_gcm::{aead::Aead, aead::KeyInit, Aes256Gcm, Nonce};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rand_core::OsRng;
use rand_core::RngCore;

const NONCE_LEN: usize = 12;

#[derive(thiserror::Error, Debug)]
pub enum EncryptionError {
    #[error("encryption key must be 32 bytes")]
    InvalidKeyLength,
    #[error("failed to encrypt secret")]
    Encrypt,
    #[error("failed to decrypt secret")]
    Decrypt,
    #[error("invalid ciphertext encoding")]
    InvalidEncoding,
}

pub fn decode_key(key_b64: &str) -> Result<Vec<u8>, EncryptionError> {
    let decoded = STANDARD
        .decode(key_b64)
        .map_err(|_| EncryptionError::InvalidEncoding)?;
    if decoded.len() != 32 {
        return Err(EncryptionError::InvalidKeyLength);
    }
    Ok(decoded)
}

pub fn encrypt_secret(key: &[u8], plaintext: &str) -> Result<String, EncryptionError> {
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| EncryptionError::InvalidKeyLength)?;

    let mut nonce_bytes = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| EncryptionError::Encrypt)?;

    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);

    Ok(STANDARD.encode(combined))
}

pub fn decrypt_secret(key: &[u8], ciphertext_b64: &str) -> Result<String, EncryptionError> {
    let data = STANDARD
        .decode(ciphertext_b64)
        .map_err(|_| EncryptionError::InvalidEncoding)?;
    if data.len() <= NONCE_LEN {
        return Err(EncryptionError::InvalidEncoding);
    }
    let (nonce_bytes, ciphertext) = data.split_at(NONCE_LEN);
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| EncryptionError::InvalidKeyLength)?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| EncryptionError::Decrypt)?;
    String::from_utf8(plaintext).map_err(|_| EncryptionError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::{decode_key, decrypt_secret, encrypt_secret, EncryptionError};
    use base64::Engine;

    #[test]
    fn round_trip() {
        let key_raw = vec![42u8; 32];
        let encoded = base64::engine::general_purpose::STANDARD.encode(&key_raw);
        let key = decode_key(&encoded).unwrap();
        let secret = "super-secret";
        let encrypted = encrypt_secret(&key, secret).unwrap();
        assert_ne!(encrypted, secret);
        let decrypted = decrypt_secret(&key, &encrypted).unwrap();
        assert_eq!(decrypted, secret);
    }

    #[test]
    fn invalid_key_length_errors() {
        let err = encrypt_secret(&[1, 2, 3], "nope");
        assert!(matches!(err, Err(EncryptionError::InvalidKeyLength)));

        let key = vec![0u8; 32];
        let err = decrypt_secret(&key, "abc");
        assert!(matches!(err, Err(EncryptionError::InvalidEncoding)));
    }
}
