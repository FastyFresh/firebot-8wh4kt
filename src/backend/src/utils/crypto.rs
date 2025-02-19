//! Cryptographic utility module providing FIPS 140-2 compliant encryption and security functions
//! Version: 1.0.0
//! Security Notice: This module handles sensitive cryptographic operations and should be audited regularly

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
}; // v0.10.1
use aws_sdk_kms::{Client as KmsClient, Region}; // v0.28.0
use base58::{FromBase58, ToBase58}; // v0.2.0
use ed25519_dalek::{PublicKey, Signature, Verifier}; // v1.0.1
use rand::{rngs::OsRng, RngCore}; // v0.8.5
use tracing::{error, info, instrument, warn}; // v0.1.37

use std::time::Duration;
use std::convert::TryFrom;
use std::sync::atomic::{AtomicU32, Ordering};

// Security constants
const NONCE_LENGTH: usize = 32;
const AES_KEY_LENGTH: usize = 32;
const GCM_NONCE_LENGTH: usize = 12;
const MAX_KMS_RETRIES: u32 = 3;
const KMS_TIMEOUT_MS: u64 = 1000;
const MAX_ENCRYPTION_SIZE: usize = 1048576; // 1MB
const WALLET_ADDRESS_LENGTH: usize = 32;

// Rate limiting for signature verification
static FAILED_ATTEMPTS: AtomicU32 = AtomicU32::new(0);

/// Represents encrypted data with its GCM nonce
#[derive(Debug, Clone, Eq, PartialEq)]
pub struct EncryptedData {
    pub ciphertext: Vec<u8>,
    pub nonce: Vec<u8>,
}

impl EncryptedData {
    /// Creates a new validated EncryptedData instance
    pub fn new(ciphertext: Vec<u8>, nonce: Vec<u8>) -> Result<Self, String> {
        if nonce.len() != GCM_NONCE_LENGTH {
            return Err(format!("Invalid nonce length: {}", nonce.len()));
        }
        if ciphertext.is_empty() {
            return Err("Ciphertext cannot be empty".to_string());
        }
        Ok(Self { ciphertext, nonce })
    }
}

/// Encrypts sensitive data using FIPS 140-2 compliant AES-256-GCM
#[instrument(skip(data, kms_key_id), fields(data_size = %data.len()))]
pub async fn encrypt_sensitive_data(
    data: String,
    kms_key_id: String,
) -> Result<EncryptedData, String> {
    if data.len() > MAX_ENCRYPTION_SIZE {
        error!("Data size exceeds maximum allowed size");
        return Err("Data size exceeds maximum allowed size".to_string());
    }

    let kms_client = KmsClient::new(Region::ApSoutheast1);
    let mut retries = 0;

    // Request encryption key from AWS KMS with retry mechanism
    let key = loop {
        match kms_client
            .generate_data_key()
            .key_id(kms_key_id.clone())
            .key_spec("AES_256")
            .send()
            .await
        {
            Ok(response) => {
                break response.plaintext().unwrap_or_default().to_vec();
            }
            Err(e) => {
                retries += 1;
                if retries >= MAX_KMS_RETRIES {
                    error!("Failed to generate KMS key after {} retries: {}", MAX_KMS_RETRIES, e);
                    return Err("KMS key generation failed".to_string());
                }
                tokio::time::sleep(Duration::from_millis(KMS_TIMEOUT_MS)).await;
            }
        }
    };

    // Generate secure GCM nonce
    let mut nonce = vec![0u8; GCM_NONCE_LENGTH];
    OsRng.fill_bytes(&mut nonce);

    // Initialize AES-256-GCM cipher
    let cipher = match Aes256Gcm::new_from_slice(&key) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to initialize cipher: {}", e);
            return Err("Cipher initialization failed".to_string());
        }
    };

    // Perform encryption
    let ciphertext = match cipher.encrypt(Nonce::from_slice(&nonce), data.as_bytes()) {
        Ok(ct) => ct,
        Err(e) => {
            error!("Encryption failed: {}", e);
            return Err("Encryption operation failed".to_string());
        }
    };

    // Securely wipe key material
    for byte in key.iter_mut() {
        *byte = 0;
    }

    info!("Data encrypted successfully");
    EncryptedData::new(ciphertext, nonce)
}

/// Decrypts AES-256-GCM encrypted data using AWS KMS
#[instrument(skip(encrypted_data, kms_key_id), fields(data_size = %encrypted_data.ciphertext.len()))]
pub async fn decrypt_sensitive_data(
    encrypted_data: EncryptedData,
    kms_key_id: String,
) -> Result<String, String> {
    let kms_client = KmsClient::new(Region::ApSoutheast1);
    let mut retries = 0;

    // Request decryption key from KMS
    let key = loop {
        match kms_client
            .decrypt()
            .key_id(kms_key_id.clone())
            .ciphertext_blob(encrypted_data.ciphertext.clone())
            .send()
            .await
        {
            Ok(response) => {
                break response.plaintext().unwrap_or_default().to_vec();
            }
            Err(e) => {
                retries += 1;
                if retries >= MAX_KMS_RETRIES {
                    error!("Failed to decrypt KMS key after {} retries: {}", MAX_KMS_RETRIES, e);
                    return Err("KMS key decryption failed".to_string());
                }
                tokio::time::sleep(Duration::from_millis(KMS_TIMEOUT_MS)).await;
            }
        }
    };

    // Initialize cipher for decryption
    let cipher = match Aes256Gcm::new_from_slice(&key) {
        Ok(c) => c,
        Err(e) => {
            error!("Failed to initialize cipher for decryption: {}", e);
            return Err("Cipher initialization failed".to_string());
        }
    };

    // Perform decryption
    let plaintext = match cipher.decrypt(
        Nonce::from_slice(&encrypted_data.nonce),
        encrypted_data.ciphertext.as_ref(),
    ) {
        Ok(pt) => pt,
        Err(e) => {
            error!("Decryption failed: {}", e);
            return Err("Decryption operation failed".to_string());
        }
    };

    // Securely wipe key material
    for byte in key.iter_mut() {
        *byte = 0;
    }

    match String::from_utf8(plaintext) {
        Ok(text) => {
            info!("Data decrypted successfully");
            Ok(text)
        }
        Err(e) => {
            error!("Invalid UTF-8 in decrypted data: {}", e);
            Err("Invalid UTF-8 in decrypted data".to_string())
        }
    }
}

/// Verifies Solana wallet signatures using constant-time Ed25519
#[instrument(skip(message, signature), fields(wallet_address = %wallet_address))]
pub fn verify_wallet_signature(
    message: String,
    signature: String,
    wallet_address: String,
) -> Result<bool, String> {
    // Check rate limiting
    if FAILED_ATTEMPTS.load(Ordering::Relaxed) > 10 {
        warn!("Rate limit exceeded for signature verification");
        return Err("Rate limit exceeded".to_string());
    }

    // Validate wallet address
    let public_key_bytes = match wallet_address.from_base58() {
        Ok(bytes) => {
            if bytes.len() != WALLET_ADDRESS_LENGTH {
                error!("Invalid wallet address length");
                return Err("Invalid wallet address length".to_string());
            }
            bytes
        }
        Err(e) => {
            error!("Invalid wallet address encoding: {}", e);
            return Err("Invalid wallet address encoding".to_string());
        }
    };

    // Parse public key
    let public_key = match PublicKey::from_bytes(&public_key_bytes) {
        Ok(pk) => pk,
        Err(e) => {
            error!("Invalid public key: {}", e);
            return Err("Invalid public key".to_string());
        }
    };

    // Decode signature
    let signature_bytes = match signature.from_base58() {
        Ok(bytes) => bytes,
        Err(e) => {
            error!("Invalid signature encoding: {}", e);
            FAILED_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
            return Err("Invalid signature encoding".to_string());
        }
    };

    let signature = match Signature::try_from(signature_bytes.as_slice()) {
        Ok(sig) => sig,
        Err(e) => {
            error!("Invalid signature format: {}", e);
            FAILED_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
            return Err("Invalid signature format".to_string());
        }
    };

    // Verify signature in constant time
    match public_key.verify(message.as_bytes(), &signature) {
        Ok(_) => {
            info!("Signature verified successfully");
            FAILED_ATTEMPTS.store(0, Ordering::Relaxed);
            Ok(true)
        }
        Err(e) => {
            warn!("Signature verification failed: {}", e);
            FAILED_ATTEMPTS.fetch_add(1, Ordering::Relaxed);
            Ok(false)
        }
    }
}

/// Generates cryptographically secure random nonces
#[instrument]
pub fn generate_nonce() -> String {
    let mut rng = OsRng;
    let mut nonce = vec![0u8; NONCE_LENGTH];
    rng.fill_bytes(&mut nonce);
    
    let encoded = nonce.to_base58();
    info!("Generated new nonce");
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_encryption_decryption_cycle() {
        let test_data = "sensitive data".to_string();
        let kms_key_id = "test-key-id".to_string();
        
        let encrypted = encrypt_sensitive_data(test_data.clone(), kms_key_id.clone())
            .await
            .unwrap();
        
        let decrypted = decrypt_sensitive_data(encrypted, kms_key_id)
            .await
            .unwrap();
        
        assert_eq!(test_data, decrypted);
    }

    #[test]
    fn test_nonce_generation() {
        let nonce1 = generate_nonce();
        let nonce2 = generate_nonce();
        
        assert_ne!(nonce1, nonce2);
        assert!(nonce1.from_base58().unwrap().len() == NONCE_LENGTH);
    }

    #[test]
    fn test_encrypted_data_validation() {
        let valid_nonce = vec![0u8; GCM_NONCE_LENGTH];
        let valid_ciphertext = vec![1u8; 32];
        
        assert!(EncryptedData::new(valid_ciphertext.clone(), valid_nonce.clone()).is_ok());
        assert!(EncryptedData::new(vec![], valid_nonce).is_err());
        assert!(EncryptedData::new(valid_ciphertext, vec![0u8; 16]).is_err());
    }
}