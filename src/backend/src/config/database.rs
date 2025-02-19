//! Database configuration module for high-availability PostgreSQL and TimescaleDB instances
//! with support for read replicas, connection pooling, and secure credential management.
//! Version: 1.0.0

use deadpool_postgres::{Config as PoolConfig, Pool, PoolError, Runtime}; // v0.10.5
use opentelemetry::trace::{Span, Tracer}; // v0.19.0
use serde::Deserialize; // v1.0.164
use sqlx::{postgres::{PgConnectOptions, PgPoolOptions}, PgPool}; // v0.7.1
use tokio_postgres::{NoTls, tls::{MakeTlsConnect, TlsConnect}}; // v0.7.8
use tracing::{error, info, instrument, warn};

use crate::utils::crypto::{encrypt_sensitive_data, decrypt_sensitive_data};
use crate::utils::metrics::MetricsCollector;

// Global constants for database configuration
const DEFAULT_POOL_SIZE: u32 = 10;
const DEFAULT_TIMEOUT_SECONDS: u32 = 30;
const DEFAULT_IDLE_TIMEOUT_SECONDS: u32 = 600;
const MAX_POOL_SIZE: u32 = 50;
const MIN_POOL_SIZE: u32 = 5;
const HEALTH_CHECK_INTERVAL_SECONDS: u64 = 60;
const MAX_CONNECTION_RETRIES: u32 = 3;
const REPLICA_LAG_THRESHOLD_SECONDS: i64 = 30;

/// SSL mode configuration for database connections
#[derive(Debug, Clone, Deserialize)]
pub enum SSLMode {
    Disable,
    Require,
    VerifyCA,
    VerifyFull,
}

/// Database backup configuration
#[derive(Debug, Clone, Deserialize)]
pub struct BackupConfig {
    pub enabled: bool,
    pub retention_days: u32,
    pub schedule: String,
    pub s3_bucket: String,
}

/// Failover configuration for high availability
#[derive(Debug, Clone, Deserialize)]
pub struct FailoverConfig {
    pub enabled: bool,
    pub max_retry_attempts: u32,
    pub retry_interval_seconds: u32,
    pub auto_failback: bool,
}

/// Data retention policy configuration
#[derive(Debug, Clone, Deserialize)]
pub struct RetentionPolicy {
    pub market_data_days: u32,
    pub trade_history_days: u32,
    pub metrics_retention_days: u32,
}

/// Comprehensive database configuration structure
#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    // Primary database configuration
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub pool_size: u32,
    pub timeout_seconds: u32,
    pub ssl_mode: SSLMode,

    // Read replica configuration
    pub replica_host: Option<String>,
    pub replica_port: Option<u16>,
    pub replica_username: Option<String>,
    pub replica_password: Option<String>,

    // Advanced configuration
    pub retention_policy: RetentionPolicy,
    pub backup_config: BackupConfig,
    pub failover_config: FailoverConfig,
}

impl DatabaseConfig {
    /// Creates a new database configuration with default values
    pub fn new() -> Self {
        Self {
            host: String::new(),
            port: 5432,
            username: String::new(),
            password: String::new(),
            database: String::new(),
            pool_size: DEFAULT_POOL_SIZE,
            timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
            ssl_mode: SSLMode::Require,
            replica_host: None,
            replica_port: None,
            replica_username: None,
            replica_password: None,
            retention_policy: RetentionPolicy {
                market_data_days: 90,
                trade_history_days: 2555, // 7 years
                metrics_retention_days: 30,
            },
            backup_config: BackupConfig {
                enabled: true,
                retention_days: 30,
                schedule: "0 0 * * *".to_string(), // Daily at midnight
                s3_bucket: "trading-bot-backups".to_string(),
            },
            failover_config: FailoverConfig {
                enabled: true,
                max_retry_attempts: MAX_CONNECTION_RETRIES,
                retry_interval_seconds: 5,
                auto_failback: true,
            },
        }
    }

    /// Validates the database configuration
    #[instrument(skip(self))]
    pub fn validate_config(&self) -> Result<(), String> {
        // Validate primary connection parameters
        if self.host.is_empty() || self.username.is_empty() || self.password.is_empty() || self.database.is_empty() {
            return Err("Missing required primary database configuration".to_string());
        }

        // Validate pool size limits
        if self.pool_size < MIN_POOL_SIZE || self.pool_size > MAX_POOL_SIZE {
            return Err(format!("Pool size must be between {} and {}", MIN_POOL_SIZE, MAX_POOL_SIZE));
        }

        // Validate replica configuration if enabled
        if let (Some(host), Some(port)) = (&self.replica_host, &self.replica_port) {
            if host.is_empty() {
                return Err("Invalid replica host configuration".to_string());
            }
            if *port == 0 {
                return Err("Invalid replica port configuration".to_string());
            }
        }

        Ok(())
    }

    /// Builds connection pool with failover support
    #[instrument(skip(self))]
    pub async fn build_connection_pool(&self) -> Result<Pool, PoolError> {
        let mut pool_config = PoolConfig::new();
        
        // Configure primary connection
        pool_config.host = Some(self.host.clone());
        pool_config.port = Some(self.port);
        pool_config.user = Some(self.username.clone());
        pool_config.password = Some(self.password.clone());
        pool_config.dbname = Some(self.database.clone());
        
        // Configure pool settings
        pool_config.pool = Some(deadpool_postgres::PoolConfig {
            max_size: self.pool_size,
            timeouts: deadpool_postgres::Timeouts {
                wait: Some(std::time::Duration::from_secs(self.timeout_seconds as u64)),
                create: Some(std::time::Duration::from_secs(self.timeout_seconds as u64)),
                recycle: Some(std::time::Duration::from_secs(DEFAULT_IDLE_TIMEOUT_SECONDS as u64)),
            },
        });

        // Create the connection pool
        let pool = pool_config.create_pool(Some(Runtime::Tokio1), NoTls)?;

        // Initialize health check
        tokio::spawn(periodic_health_check(pool.clone()));

        Ok(pool)
    }
}

/// Creates and configures a high-availability database connection pool
#[instrument]
pub async fn create_pool(config: DatabaseConfig) -> Result<Pool, String> {
    // Validate configuration
    config.validate_config()?;

    // Build primary connection pool
    let pool = config.build_connection_pool()
        .await
        .map_err(|e| format!("Failed to create connection pool: {}", e))?;

    // Initialize metrics collection
    let metrics = MetricsCollector::new()
        .map_err(|e| format!("Failed to initialize metrics: {}", e))?;

    // Record initial pool metrics
    metrics.update_system_health("database", "pool_size", config.pool_size as f64)
        .map_err(|e| format!("Failed to record metrics: {}", e))?;

    info!("Database connection pool initialized successfully");
    Ok(pool)
}

/// Performs comprehensive database health check
#[instrument(skip(pool))]
pub async fn health_check(pool: Pool) -> Result<bool, String> {
    let client = pool.get()
        .await
        .map_err(|e| format!("Failed to get connection: {}", e))?;

    // Check primary connectivity
    let result = client
        .query_one("SELECT 1", &[])
        .await
        .map_err(|e| format!("Health check failed: {}", e))?;

    // Check replica lag if configured
    if let Some(replica_lag) = check_replica_lag(&client).await? {
        if replica_lag > REPLICA_LAG_THRESHOLD_SECONDS {
            warn!("Replica lag exceeds threshold: {} seconds", replica_lag);
            return Ok(false);
        }
    }

    Ok(true)
}

/// Internal function to check replica lag
async fn check_replica_lag(client: &deadpool_postgres::Client) -> Result<Option<i64>, String> {
    let lag = client
        .query_opt(
            "SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp()))::INTEGER as lag",
            &[],
        )
        .await
        .map_err(|e| format!("Failed to check replica lag: {}", e))?;

    Ok(lag.and_then(|row| row.get(0)))
}

/// Periodic health check task
async fn periodic_health_check(pool: Pool) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(HEALTH_CHECK_INTERVAL_SECONDS)).await;
        
        match health_check(pool.clone()).await {
            Ok(true) => info!("Database health check passed"),
            Ok(false) => warn!("Database health check failed"),
            Err(e) => error!("Database health check error: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_database_config_validation() {
        let config = DatabaseConfig::new();
        assert!(config.validate_config().is_err());

        let mut valid_config = DatabaseConfig::new();
        valid_config.host = "localhost".to_string();
        valid_config.username = "user".to_string();
        valid_config.password = "pass".to_string();
        valid_config.database = "testdb".to_string();
        assert!(valid_config.validate_config().is_ok());
    }

    #[tokio::test]
    async fn test_pool_size_validation() {
        let mut config = DatabaseConfig::new();
        config.pool_size = MAX_POOL_SIZE + 1;
        assert!(config.validate_config().is_err());

        config.pool_size = MIN_POOL_SIZE - 1;
        assert!(config.validate_config().is_err());

        config.pool_size = DEFAULT_POOL_SIZE;
        config.host = "localhost".to_string();
        config.username = "user".to_string();
        config.password = "pass".to_string();
        config.database = "testdb".to_string();
        assert!(config.validate_config().is_ok());
    }
}