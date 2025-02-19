//! Core module for managing real-time market data collection from multiple Solana DEXs.
//! Provides high-performance data collection with sub-500ms latency requirements.
//!
//! Version dependencies:
//! - tokio = "1.28"
//! - tracing = "0.1"
//! - async-trait = "0.1"

use std::sync::Arc;
use tokio::{
    sync::{mpsc, RwLock},
    time::{sleep, Duration},
};
use tracing::{debug, error, info, instrument, warn};
use async_trait::async_trait;

use crate::{
    models::market::{MarketData, validate_price, validate_volume},
    utils::solana::SolanaClient,
};

// Performance optimization constants
pub const COLLECTION_INTERVAL_MS: u64 = 100;
pub const MAX_RECONNECT_ATTEMPTS: u8 = 5;
pub const RECONNECT_DELAY_MS: u64 = 1000;
pub const CONNECTION_POOL_SIZE: usize = 10;
pub const VALIDATION_TIMEOUT_MS: u64 = 50;

/// Supported DEX types for data collection
#[derive(Debug, Clone, PartialEq)]
pub enum DexType {
    Jupiter,
    PumpFun,
    Drift,
}

/// Configuration for data collectors
#[derive(Debug, Clone)]
pub struct CollectorConfig {
    pub collection_interval: Duration,
    pub connection_pool_size: usize,
    pub max_reconnect_attempts: u8,
    pub validation_timeout: Duration,
}

impl Default for CollectorConfig {
    fn default() -> Self {
        Self {
            collection_interval: Duration::from_millis(COLLECTION_INTERVAL_MS),
            connection_pool_size: CONNECTION_POOL_SIZE,
            max_reconnect_attempts: MAX_RECONNECT_ATTEMPTS,
            validation_timeout: Duration::from_millis(VALIDATION_TIMEOUT_MS),
        }
    }
}

/// Comprehensive error types for data collection operations
#[derive(Debug, thiserror::Error)]
pub enum CollectorError {
    #[error("Connection error: {0}")]
    ConnectionError(String),
    #[error("Data validation error: {0}")]
    DataValidationError(String),
    #[error("Collection error: {0}")]
    CollectionError(String),
    #[error("Connection pool exhausted: {0}")]
    PoolExhaustedError(String),
    #[error("Rate limit exceeded: {0}")]
    RateLimitError(String),
    #[error("Performance error: {0}")]
    PerformanceError(String),
}

/// Health status of a collector
#[derive(Debug, Clone)]
pub struct HealthStatus {
    pub is_healthy: bool,
    pub connection_count: usize,
    pub last_collection_latency: Duration,
    pub error_count: u64,
    pub last_error: Option<String>,
}

/// Performance metrics for data collection
#[derive(Debug, Default)]
struct CollectorMetrics {
    samples_collected: u64,
    validation_failures: u64,
    average_latency: Duration,
    connection_errors: u64,
    last_collection_time: Option<chrono::DateTime<chrono::Utc>>,
}

/// Common interface for DEX-specific data collectors
#[async_trait]
pub trait Collector: Send + Sync {
    /// Starts the market data collection process
    #[instrument(skip(self))]
    async fn start_collection(&self) -> Result<(), CollectorError>;

    /// Stops the market data collection process
    #[instrument(skip(self))]
    async fn stop_collection(&self) -> Result<(), CollectorError>;

    /// Performs health check of collector and its connections
    #[instrument(skip(self))]
    async fn health_check(&self) -> Result<HealthStatus, CollectorError>;
}

/// Creates appropriate DEX collector with connection pooling
#[instrument(skip(solana_client, config))]
pub fn create_collector(
    dex_type: DexType,
    solana_client: Arc<SolanaClient>,
    config: CollectorConfig,
) -> Result<Box<dyn Collector>, CollectorError> {
    match dex_type {
        DexType::Jupiter => {
            info!("Creating Jupiter collector");
            Ok(Box::new(jupiter::JupiterCollector::new(solana_client, config)?))
        }
        DexType::PumpFun => {
            info!("Creating Pump Fun collector");
            Ok(Box::new(pump_fun::PumpFunCollector::new(solana_client, config)?))
        }
        DexType::Drift => {
            info!("Creating Drift collector");
            Ok(Box::new(drift::DriftCollector::new(solana_client, config)?))
        }
    }
}

/// Connection pool for managing DEX websocket connections
#[derive(Debug)]
struct ConnectionPool {
    connections: Vec<RwLock<Option<WebSocketConnection>>>,
    metrics: Arc<RwLock<CollectorMetrics>>,
}

impl ConnectionPool {
    /// Creates a new connection pool with specified size
    fn new(size: usize) -> Self {
        let connections = (0..size)
            .map(|_| RwLock::new(None))
            .collect();

        Self {
            connections,
            metrics: Arc::new(RwLock::new(CollectorMetrics::default())),
        }
    }

    /// Acquires a connection from the pool
    async fn acquire(&self) -> Result<WebSocketConnection, CollectorError> {
        for conn in &self.connections {
            let mut conn_guard = conn.write().await;
            if conn_guard.is_none() {
                let new_conn = WebSocketConnection::new().await?;
                *conn_guard = Some(new_conn.clone());
                return Ok(new_conn);
            }
        }
        Err(CollectorError::PoolExhaustedError(
            "no available connections in pool".to_string(),
        ))
    }

    /// Releases a connection back to the pool
    async fn release(&self, conn: WebSocketConnection) {
        for conn_slot in &self.connections {
            let mut conn_guard = conn_slot.write().await;
            if conn_guard.is_none() {
                *conn_guard = Some(conn);
                break;
            }
        }
    }
}

/// Represents a websocket connection to a DEX
#[derive(Debug, Clone)]
struct WebSocketConnection {
    id: uuid::Uuid,
    created_at: chrono::DateTime<chrono::Utc>,
}

impl WebSocketConnection {
    async fn new() -> Result<Self, CollectorError> {
        Ok(Self {
            id: uuid::Uuid::new_v4(),
            created_at: chrono::Utc::now(),
        })
    }
}

// Re-export collector implementations
pub mod jupiter;
pub mod pump_fun;
pub mod drift;

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn test_collector_creation() {
        let solana_client = Arc::new(
            SolanaClient::new(
                "http://localhost:8899".to_string(),
                None,
                None,
            )
            .await
            .unwrap(),
        );

        let config = CollectorConfig::default();
        let collector = create_collector(DexType::Jupiter, solana_client, config);
        assert!(collector.is_ok());
    }

    #[tokio::test]
    async fn test_connection_pool() {
        let pool = ConnectionPool::new(2);
        
        // Acquire connections
        let conn1 = pool.acquire().await;
        assert!(conn1.is_ok());
        
        let conn2 = pool.acquire().await;
        assert!(conn2.is_ok());
        
        // Pool should be exhausted
        let conn3 = pool.acquire().await;
        assert!(conn3.is_err());
        
        // Release connection
        pool.release(conn1.unwrap()).await;
        
        // Should be able to acquire again
        let conn4 = pool.acquire().await;
        assert!(conn4.is_ok());
    }
}