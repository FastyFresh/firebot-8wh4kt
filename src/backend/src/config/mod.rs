//! Root configuration module for the AI-powered Solana trading bot.
//! Provides comprehensive configuration management with validation, monitoring,
//! versioning, and disaster recovery capabilities.
//! Version: 1.0.0

use chrono::{DateTime, Utc};
use dotenv::dotenv; // v0.15.0
use prometheus::{Registry, register_gauge}; // v0.13.3
use serde::{Deserialize, Serialize}; // v1.0.164
use tracing::{error, info, instrument, warn}; // v0.1.37

use crate::config::database::DatabaseConfig;
use crate::config::environment::EnvironmentConfig;
use crate::config::logging::LogConfig;
use crate::config::security::SecurityConfig;

// Global constants
const CONFIG_ERROR: &str = "Configuration error";
const CONFIG_VERSION: &str = "1.0.0";

// Initialize global metrics registry
lazy_static::lazy_static! {
    static ref CONFIG_METRICS: Registry = Registry::new();
    static ref CONFIG_CHANGES: prometheus::Gauge = register_gauge!(
        "config_changes_total",
        "Total number of configuration changes"
    ).unwrap();
}

/// Main application configuration structure with enhanced capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppConfig {
    pub environment: EnvironmentConfig,
    pub database: DatabaseConfig,
    pub logging: LogConfig,
    pub security: SecurityConfig,
    pub version: String,
    pub last_updated: DateTime<Utc>,
}

impl AppConfig {
    /// Creates new AppConfig instance with validation and monitoring
    #[instrument(skip(env_config, db_config, log_config, security_config))]
    pub fn new(
        env_config: EnvironmentConfig,
        db_config: DatabaseConfig,
        log_config: LogConfig,
        security_config: SecurityConfig,
    ) -> Result<Self, String> {
        let config = Self {
            environment: env_config,
            database: db_config,
            logging: log_config,
            security: security_config,
            version: CONFIG_VERSION.to_string(),
            last_updated: Utc::now(),
        };

        // Validate configuration
        validate_config(&config)?;

        // Update metrics
        CONFIG_CHANGES.inc();

        info!("Configuration initialized successfully");
        Ok(config)
    }

    /// Checks if application is running in production environment
    pub fn is_production(&self) -> bool {
        self.environment.is_production()
    }

    /// Reloads configuration with validation and monitoring
    #[instrument(skip(self))]
    pub async fn reload_config(&mut self) -> Result<(), String> {
        info!("Reloading configuration");

        // Load new configurations
        let env_config = EnvironmentConfig::from_env()
            .map_err(|e| format!("Failed to reload environment config: {}", e))?;
        
        let db_config = DatabaseConfig::new();
        
        let log_config = LogConfig::new(&env_config);
        
        let security_config = SecurityConfig::load_security_config()
            .await
            .map_err(|e| format!("Failed to reload security config: {}", e))?;

        // Validate new configurations
        let new_config = AppConfig::new(
            env_config,
            db_config,
            log_config,
            security_config,
        )?;

        // Update configuration
        *self = new_config;
        self.last_updated = Utc::now();

        // Update metrics
        CONFIG_CHANGES.inc();

        info!("Configuration reloaded successfully");
        Ok(())
    }
}

/// Initializes all configuration components with comprehensive validation and monitoring
#[instrument]
pub async fn init_config() -> Result<AppConfig, String> {
    info!("Initializing configuration");

    // Load environment variables
    dotenv().ok();

    // Initialize environment configuration
    let env_config = EnvironmentConfig::from_env()
        .map_err(|e| format!("Environment configuration error: {}", e))?;

    // Initialize database configuration
    let db_config = DatabaseConfig::new();

    // Initialize logging configuration
    let log_config = LogConfig::new(&env_config);

    // Initialize security configuration
    let security_config = SecurityConfig::load_security_config()
        .await
        .map_err(|e| format!("Security configuration error: {}", e))?;

    // Create and validate complete configuration
    let config = AppConfig::new(
        env_config,
        db_config,
        log_config,
        security_config,
    )?;

    info!("Configuration initialized successfully");
    Ok(config)
}

/// Performs comprehensive validation of all configuration components
#[instrument(skip(config))]
pub fn validate_config(config: &AppConfig) -> Result<(), String> {
    info!("Validating configuration");

    // Validate environment configuration
    if let Err(e) = config.environment.validate_environment(&config.environment) {
        error!("Environment validation failed: {}", e);
        return Err(format!("{}: environment validation failed", CONFIG_ERROR));
    }

    // Validate database configuration
    if let Err(e) = config.database.validate_config() {
        error!("Database validation failed: {}", e);
        return Err(format!("{}: database validation failed", CONFIG_ERROR));
    }

    // Validate logging configuration
    if let Err(e) = config.logging.validate() {
        error!("Logging validation failed: {}", e);
        return Err(format!("{}: logging validation failed", CONFIG_ERROR));
    }

    // Validate security configuration
    if let Err(e) = config.security.validate() {
        error!("Security validation failed: {}", e);
        return Err(format!("{}: security validation failed", CONFIG_ERROR));
    }

    // Cross-component validation
    if config.is_production() {
        // Additional production-specific validations
        if config.logging.json_format != true {
            warn!("Production environment should use JSON logging format");
        }
        if !config.security.audit.enabled {
            return Err(format!("{}: audit logging must be enabled in production", CONFIG_ERROR));
        }
    }

    info!("Configuration validation completed successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_config_initialization() {
        let config = init_config().await;
        assert!(config.is_ok());
    }

    #[test]
    fn test_config_validation() {
        let env_config = EnvironmentConfig::new();
        let db_config = DatabaseConfig::new();
        let log_config = LogConfig::new(&env_config);
        let security_config = SecurityConfig::new(
            // Add test values for security config components
            Default::default(),
            Default::default(),
            Default::default(),
            Default::default(),
            Default::default(),
        ).unwrap();

        let config = AppConfig::new(
            env_config,
            db_config,
            log_config,
            security_config,
        );
        assert!(config.is_ok());
    }

    #[tokio::test]
    async fn test_config_reload() {
        let mut config = init_config().await.unwrap();
        assert!(config.reload_config().await.is_ok());
    }
}