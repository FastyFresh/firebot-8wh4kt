//! Core utilities module for the Solana trading bot providing centralized access to essential functionality.
//! 
//! This module organizes and re-exports utility functions for:
//! - Cryptographic operations (AES-256-GCM encryption, wallet signatures)
//! - Structured logging with ELK Stack integration
//! - Prometheus-based metrics collection
//! - Solana blockchain interactions and MEV optimization
//! - High-precision time management
//!
//! Version: 1.0.0
//! Security Notice: Contains critical security and trading functions - handle with care

// Re-export cryptographic utilities with version compatibility tracking
pub mod crypto;
pub use crypto::{
    encrypt_sensitive_data,
    decrypt_sensitive_data,
    verify_wallet_signature,
    generate_nonce,
    EncryptedData,
};

// Re-export logging utilities with structured logging support
pub mod logger;
pub use logger::{
    init_logger,
    log_trade_execution,
    log_error,
    LogFormatter,
};

// Re-export metrics collection utilities with Prometheus integration
pub mod metrics;
pub use metrics::{
    MetricsCollector,
    init_metrics,
    record_trade_execution,
    expose_metrics,
};

// Re-export Solana blockchain utilities with MEV optimization support
pub mod solana;
pub use solana::{
    SolanaClient,
    create_rpc_client,
    sign_and_send_transaction,
    submit_mev_bundle,
    SolanaError,
    HealthStatus,
};

// Re-export time management utilities with high-precision timestamp support
pub mod time;
pub use time::{
    current_timestamp,
    to_trading_timezone,
    is_valid_market_timestamp,
    calculate_duration_ms,
    format_timestamp,
    TimeError,
};

// Version compatibility tracking for utility modules
const CRYPTO_MODULE_VERSION: &str = "1.0.0";
const LOGGER_MODULE_VERSION: &str = "1.0.0";
const METRICS_MODULE_VERSION: &str = "1.0.0";
const SOLANA_MODULE_VERSION: &str = "1.0.0";
const TIME_MODULE_VERSION: &str = "1.0.0";

/// Validates version compatibility across utility modules
pub fn validate_module_versions() -> bool {
    let versions = [
        CRYPTO_MODULE_VERSION,
        LOGGER_MODULE_VERSION,
        METRICS_MODULE_VERSION,
        SOLANA_MODULE_VERSION,
        TIME_MODULE_VERSION,
    ];
    
    versions.iter().all(|&v| v == "1.0.0")
}

/// Initializes all utility modules with proper configuration
pub async fn init_utils(config: &crate::config::environment::EnvironmentConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Initialize logging system
    logger::init_logger(config)?;
    
    // Initialize metrics collection
    metrics::init_metrics()?;
    
    // Validate module versions
    if !validate_module_versions() {
        return Err("Module version mismatch detected".into());
    }
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::environment::EnvironmentConfig;

    #[test]
    fn test_version_validation() {
        assert!(validate_module_versions());
    }

    #[tokio::test]
    async fn test_utils_initialization() {
        let config = EnvironmentConfig::new();
        assert!(init_utils(&config).await.is_ok());
    }
}