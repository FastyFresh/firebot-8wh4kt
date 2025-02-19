//! Security configuration module for the Solana trading bot
//! Version: 1.0.0
//! Manages authentication, encryption, and security settings with comprehensive validation

use serde::{Deserialize, Serialize}; // v1.0.164
use jsonwebtoken::{DecodingKey, EncodingKey, Algorithm}; // v8.1.1
use aws_sdk_kms::{Client as KmsClient, Region}; // v0.28.0
use tracing::{error, info, instrument, warn}; // v0.1.37

use crate::utils::crypto::{encrypt_sensitive_data, decrypt_sensitive_data};

use std::time::Duration;
use std::collections::HashMap;

// Security configuration constants
const DEFAULT_JWT_EXPIRY: i64 = 3600; // 1 hour
const DEFAULT_REFRESH_EXPIRY: i64 = 604800; // 7 days
const MAX_FAILED_ATTEMPTS: u32 = 5;
const MIN_PASSWORD_LENGTH: usize = 12;
const KMS_KEY_ROTATION_DAYS: i64 = 90;

/// JWT configuration settings
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct JWTConfig {
    pub secret_key: String,
    pub token_expiry: i64,
    pub refresh_expiry: i64,
    pub algorithm: Algorithm,
}

/// AWS KMS configuration
#[derive(Debug, Clone, Deserialize)]
pub struct KMSConfig {
    pub key_id: String,
    pub region: String,
    pub auto_rotation: bool,
    pub rotation_period: i64,
}

/// Rate limiting configuration
#[derive(Debug, Clone, Deserialize)]
pub struct RateLimitConfig {
    pub max_requests: u32,
    pub window_size: Duration,
    pub max_failed_attempts: u32,
}

/// Audit logging configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AuditConfig {
    pub enabled: bool,
    pub log_level: String,
    pub retention_days: u32,
}

/// Access control configuration
#[derive(Debug, Clone, Deserialize)]
pub struct AccessControlConfig {
    pub allowed_ips: Vec<String>,
    pub allowed_origins: Vec<String>,
    pub required_permissions: HashMap<String, Vec<String>>,
}

/// Comprehensive security configuration
#[derive(Debug, Clone, Deserialize)]
pub struct SecurityConfig {
    pub jwt: JWTConfig,
    pub kms: KMSConfig,
    pub rate_limit: RateLimitConfig,
    pub audit: AuditConfig,
    pub access_control: AccessControlConfig,
}

impl SecurityConfig {
    /// Creates a new SecurityConfig instance with validated configurations
    pub fn new(
        jwt_config: JWTConfig,
        kms_config: KMSConfig,
        rate_limit_config: RateLimitConfig,
        audit_config: AuditConfig,
        access_control_config: AccessControlConfig,
    ) -> Result<Self, String> {
        let config = Self {
            jwt: jwt_config,
            kms: kms_config,
            rate_limit: rate_limit_config,
            audit: audit_config,
            access_control: access_control_config,
        };

        config.validate()?;
        Ok(config)
    }

    /// Validates the entire security configuration
    #[instrument(skip(self))]
    pub fn validate(&self) -> Result<(), String> {
        // Validate JWT configuration
        if self.jwt.token_expiry <= 0 || self.jwt.refresh_expiry <= 0 {
            return Err("Invalid JWT expiry settings".to_string());
        }

        if self.jwt.secret_key.len() < MIN_PASSWORD_LENGTH {
            return Err("JWT secret key too short".to_string());
        }

        // Validate KMS configuration
        if self.kms.key_id.is_empty() {
            return Err("KMS key ID is required".to_string());
        }

        if self.kms.rotation_period < KMS_KEY_ROTATION_DAYS {
            return Err("KMS rotation period too short".to_string());
        }

        // Validate rate limiting
        if self.rate_limit.max_requests == 0 || self.rate_limit.window_size.as_secs() == 0 {
            return Err("Invalid rate limiting configuration".to_string());
        }

        if self.rate_limit.max_failed_attempts > MAX_FAILED_ATTEMPTS {
            return Err("Max failed attempts too high".to_string());
        }

        // Validate audit configuration
        if self.audit.enabled && self.audit.retention_days == 0 {
            return Err("Invalid audit log retention period".to_string());
        }

        // Validate access control
        if self.access_control.allowed_origins.is_empty() {
            return Err("No allowed origins specified".to_string());
        }

        Ok(())
    }
}

/// Loads and validates security configuration from environment variables
#[instrument]
pub async fn load_security_config() -> Result<SecurityConfig, String> {
    info!("Loading security configuration");

    // Load JWT configuration
    let jwt_config = JWTConfig {
        secret_key: std::env::var("JWT_SECRET_KEY")
            .map_err(|_| "JWT secret key not found")?,
        token_expiry: std::env::var("JWT_TOKEN_EXPIRY")
            .unwrap_or_else(|_| DEFAULT_JWT_EXPIRY.to_string())
            .parse()
            .map_err(|_| "Invalid JWT token expiry")?,
        refresh_expiry: std::env::var("JWT_REFRESH_EXPIRY")
            .unwrap_or_else(|_| DEFAULT_REFRESH_EXPIRY.to_string())
            .parse()
            .map_err(|_| "Invalid JWT refresh expiry")?,
        algorithm: Algorithm::HS256,
    };

    // Load KMS configuration
    let kms_config = KMSConfig {
        key_id: std::env::var("KMS_KEY_ID")
            .map_err(|_| "KMS key ID not found")?,
        region: std::env::var("AWS_REGION")
            .unwrap_or_else(|_| "ap-southeast-1".to_string()),
        auto_rotation: std::env::var("KMS_AUTO_ROTATION")
            .unwrap_or_else(|_| "true".to_string())
            .parse()
            .unwrap_or(true),
        rotation_period: std::env::var("KMS_ROTATION_PERIOD")
            .unwrap_or_else(|_| KMS_KEY_ROTATION_DAYS.to_string())
            .parse()
            .map_err(|_| "Invalid KMS rotation period")?,
    };

    // Load rate limiting configuration
    let rate_limit_config = RateLimitConfig {
        max_requests: std::env::var("RATE_LIMIT_MAX_REQUESTS")
            .unwrap_or_else(|_| "1000".to_string())
            .parse()
            .map_err(|_| "Invalid rate limit max requests")?,
        window_size: Duration::from_secs(
            std::env::var("RATE_LIMIT_WINDOW_SECS")
                .unwrap_or_else(|_| "60".to_string())
                .parse()
                .map_err(|_| "Invalid rate limit window size")?,
        ),
        max_failed_attempts: std::env::var("RATE_LIMIT_MAX_FAILED")
            .unwrap_or_else(|_| MAX_FAILED_ATTEMPTS.to_string())
            .parse()
            .map_err(|_| "Invalid max failed attempts")?,
    };

    // Load audit configuration
    let audit_config = AuditConfig {
        enabled: std::env::var("AUDIT_ENABLED")
            .unwrap_or_else(|_| "true".to_string())
            .parse()
            .unwrap_or(true),
        log_level: std::env::var("AUDIT_LOG_LEVEL")
            .unwrap_or_else(|_| "INFO".to_string()),
        retention_days: std::env::var("AUDIT_RETENTION_DAYS")
            .unwrap_or_else(|_| "90".to_string())
            .parse()
            .map_err(|_| "Invalid audit retention days")?,
    };

    // Load access control configuration
    let access_control_config = AccessControlConfig {
        allowed_ips: std::env::var("ALLOWED_IPS")
            .unwrap_or_else(|_| "".to_string())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        allowed_origins: std::env::var("ALLOWED_ORIGINS")
            .map_err(|_| "Allowed origins not configured")?
            .split(',')
            .map(|s| s.trim().to_string())
            .collect(),
        required_permissions: HashMap::new(), // Loaded from database or config file
    };

    // Create and validate security configuration
    let config = SecurityConfig::new(
        jwt_config,
        kms_config,
        rate_limit_config,
        audit_config,
        access_control_config,
    )?;

    validate_security_config(&config).await?;
    info!("Security configuration loaded successfully");
    Ok(config)
}

/// Performs comprehensive validation of security configuration parameters
#[instrument(skip(config))]
pub async fn validate_security_config(config: &SecurityConfig) -> Result<(), String> {
    info!("Validating security configuration");

    // Validate KMS key accessibility
    let kms_client = KmsClient::new(Region::from_static(&config.kms.region));
    match kms_client
        .describe_key()
        .key_id(&config.kms.key_id)
        .send()
        .await
    {
        Ok(response) => {
            if !response.key_metadata.unwrap().enabled {
                return Err("KMS key is disabled".to_string());
            }
        }
        Err(e) => {
            error!("Failed to validate KMS key: {}", e);
            return Err("KMS key validation failed".to_string());
        }
    }

    // Test JWT token generation
    let test_data = "test".to_string();
    if let Err(e) = encrypt_sensitive_data(test_data, config.kms.key_id.clone()).await {
        error!("Encryption test failed: {}", e);
        return Err("Encryption validation failed".to_string());
    }

    // Validate rate limiting configuration
    if config.rate_limit.window_size.as_secs() < 1 {
        return Err("Rate limit window size too small".to_string());
    }

    info!("Security configuration validated successfully");
    Ok(())
}