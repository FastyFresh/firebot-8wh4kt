//! Database module providing centralized connection management and error handling
//! for the AI-powered Solana trading bot with support for PostgreSQL and TimescaleDB.
//! Version: 1.0.0

use deadpool_postgres::{Config as PoolConfig, Pool, Runtime}; // v0.10.0
use opentelemetry::trace::{Span, Tracer}; // v0.19.0
use sqlx::{postgres::{PgConnectOptions, PgPoolOptions}, PgPool}; // v0.7.1
use tokio::time::{Duration, sleep}; // v1.28.0
use tracing::{error, info, instrument, warn}; // v0.1.37

use crate::config::database::{DatabaseConfig, SSLMode};

// Re-export submodules
pub mod models;
pub mod repositories;

// Global constants
const DB_POOL_MAX_CONNECTIONS: u32 = 20;
const DB_CONNECTION_TIMEOUT_SECONDS: u64 = 30;
const DB_RETRY_ATTEMPTS: u32 = 3;
const DB_HEALTH_CHECK_INTERVAL_SECONDS: u64 = 60;
const DB_STATEMENT_CACHE_SIZE: u32 = 100;

/// Enhanced error type for database operations with context and recovery options
#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error("Connection error: {message}")]
    ConnectionError {
        message: String,
        source: Option<sqlx::Error>,
        retryable: bool,
    },
    
    #[error("Query error: {message}")]
    QueryError {
        message: String,
        source: Option<sqlx::Error>,
        query_type: String,
    },
    
    #[error("Pool error: {message}")]
    PoolError {
        message: String,
        source: Option<sqlx::Error>,
    },
    
    #[error("Migration error: {message}")]
    MigrationError {
        message: String,
        source: Option<sqlx::Error>,
    },
}

impl DatabaseError {
    /// Creates a new database error with context
    pub fn new_connection_error(message: String, source: Option<sqlx::Error>, retryable: bool) -> Self {
        error!(?source, retryable, "Database connection error: {}", message);
        DatabaseError::ConnectionError {
            message,
            source,
            retryable,
        }
    }

    /// Converts SQLx error to DatabaseError with context
    pub fn from_sqlx_error(error: sqlx::Error, context: &str) -> Self {
        match error {
            sqlx::Error::Database(ref db_error) => {
                error!(error = ?db_error, "Database error occurred: {}", context);
                DatabaseError::QueryError {
                    message: context.to_string(),
                    source: Some(error),
                    query_type: "database".to_string(),
                }
            }
            sqlx::Error::PoolTimedOut => {
                warn!("Database pool timeout: {}", context);
                DatabaseError::PoolError {
                    message: "Connection pool timeout".to_string(),
                    source: Some(error),
                }
            }
            _ => {
                error!(?error, "Unexpected database error: {}", context);
                DatabaseError::QueryError {
                    message: context.to_string(),
                    source: Some(error),
                    query_type: "unknown".to_string(),
                }
            }
        }
    }
}

/// Creates and initializes a PostgreSQL connection pool with monitoring
#[instrument(level = "info")]
pub async fn create_pool(config: DatabaseConfig) -> Result<Pool, DatabaseError> {
    info!("Initializing database connection pool");

    // Validate configuration
    config.validate_config()
        .map_err(|e| DatabaseError::new_connection_error(
            format!("Invalid database configuration: {}", e),
            None,
            false
        ))?;

    let mut pool_config = PoolConfig::new();
    
    // Configure primary connection
    pool_config.host = Some(config.host.clone());
    pool_config.port = Some(config.port);
    pool_config.user = Some(config.username.clone());
    pool_config.password = Some(config.password.clone());
    pool_config.dbname = Some(config.database.clone());

    // Configure SSL mode
    match config.ssl_mode {
        SSLMode::Require => pool_config.ssl_mode = Some("require".to_string()),
        SSLMode::VerifyCA => pool_config.ssl_mode = Some("verify-ca".to_string()),
        SSLMode::VerifyFull => pool_config.ssl_mode = Some("verify-full".to_string()),
        SSLMode::Disable => pool_config.ssl_mode = Some("disable".to_string()),
    }

    // Configure pool settings
    pool_config.pool = Some(deadpool_postgres::PoolConfig {
        max_size: DB_POOL_MAX_CONNECTIONS,
        timeouts: deadpool_postgres::Timeouts {
            wait: Some(Duration::from_secs(DB_CONNECTION_TIMEOUT_SECONDS)),
            create: Some(Duration::from_secs(DB_CONNECTION_TIMEOUT_SECONDS)),
            recycle: Some(Duration::from_secs(600)), // 10 minutes
        },
    });

    // Create pool with retry mechanism
    let mut last_error = None;
    for attempt in 1..=DB_RETRY_ATTEMPTS {
        match pool_config.create_pool(Some(Runtime::Tokio1), tokio_postgres::NoTls) {
            Ok(pool) => {
                // Verify connectivity
                if let Err(e) = pool.get().await {
                    last_error = Some(e);
                    warn!("Failed to verify pool connectivity on attempt {}", attempt);
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }

                info!("Database connection pool initialized successfully");
                
                // Initialize health check task
                tokio::spawn(periodic_health_check(pool.clone()));
                
                return Ok(pool);
            }
            Err(e) => {
                last_error = Some(e);
                warn!("Failed to create connection pool on attempt {}", attempt);
                sleep(Duration::from_secs(1)).await;
            }
        }
    }

    Err(DatabaseError::new_connection_error(
        "Failed to create database connection pool after multiple attempts".to_string(),
        None,
        true
    ))
}

/// Initializes database schema and runs migrations
#[instrument(skip(pool), level = "info")]
pub async fn initialize_database(pool: Pool) -> Result<(), DatabaseError> {
    info!("Initializing database schema and running migrations");

    let client = pool.get().await.map_err(|e| 
        DatabaseError::new_connection_error(
            "Failed to get connection for initialization".to_string(),
            Some(sqlx::Error::PoolTimedOut),
            true
        ))?;

    // Initialize TimescaleDB extension
    client.execute("CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE", &[])
        .await
        .map_err(|e| DatabaseError::MigrationError {
            message: "Failed to initialize TimescaleDB extension".to_string(),
            source: Some(sqlx::Error::Database(Box::new(e))),
        })?;

    // Run migrations using sqlx
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(|e| DatabaseError::MigrationError {
            message: "Failed to run database migrations".to_string(),
            source: Some(e),
        })?;

    info!("Database initialization completed successfully");
    Ok(())
}

/// Performs periodic health checks on the database connection
async fn periodic_health_check(pool: Pool) {
    loop {
        sleep(Duration::from_secs(DB_HEALTH_CHECK_INTERVAL_SECONDS)).await;

        match pool.get().await {
            Ok(client) => {
                match client.execute("SELECT 1", &[]).await {
                    Ok(_) => info!("Database health check passed"),
                    Err(e) => error!("Database health check failed: {}", e),
                }
            }
            Err(e) => error!("Failed to get connection for health check: {}", e),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::test;

    #[test]
    async fn test_database_error_creation() {
        let error = DatabaseError::new_connection_error(
            "test error".to_string(),
            None,
            true
        );
        
        match error {
            DatabaseError::ConnectionError { message, retryable, .. } => {
                assert_eq!(message, "test error");
                assert!(retryable);
            }
            _ => panic!("Wrong error type"),
        }
    }

    #[test]
    async fn test_pool_creation_validation() {
        let invalid_config = DatabaseConfig::new();
        let result = create_pool(invalid_config).await;
        assert!(result.is_err());
    }

    #[test]
    async fn test_error_conversion() {
        let sqlx_error = sqlx::Error::PoolTimedOut;
        let error = DatabaseError::from_sqlx_error(sqlx_error, "test context");
        
        match error {
            DatabaseError::PoolError { message, .. } => {
                assert!(message.contains("timeout"));
            }
            _ => panic!("Wrong error type"),
        }
    }
}