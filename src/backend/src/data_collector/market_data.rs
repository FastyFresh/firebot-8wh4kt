//! Core market data collection module for high-performance aggregation of real-time
//! price and order book data from multiple Solana DEXs.
//!
//! Version dependencies:
//! - tokio = "1.28"
//! - rust_decimal = "1.30"
//! - async-trait = "0.1"
//! - thiserror = "1.0"

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rust_decimal::Decimal;
use thiserror::Error;
use tokio::{sync::RwLock, task::JoinHandle, time};

use crate::models::market::{MarketData, MarketError};
use crate::utils::metrics::MetricsCollector;
use crate::utils::time::{current_timestamp, is_valid_market_timestamp};

// Collection configuration constants
const COLLECTION_INTERVAL_MS: u64 = 100;
const MAX_BATCH_SIZE: usize = 1000;
const MAX_RETRIES: u32 = 3;
const RETRY_DELAY_MS: u64 = 50;
const ERROR_THRESHOLD: f64 = 0.1;
const CIRCUIT_BREAKER_THRESHOLD: f64 = 0.2;

// Supported trading pairs
const SUPPORTED_PAIRS: [&str; 3] = ["SOL/USDC", "ORCA/USDC", "RAY/USDC"];

/// Error types for market data collection operations
#[derive(Error, Debug)]
pub enum CollectionError {
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error("collection error: {0}")]
    CollectionError(String),
    #[error("processing error: {0}")]
    ProcessingError(String),
    #[error("circuit breaker triggered: {0}")]
    CircuitBreakerError(String),
}

/// Configuration for DEX-specific collection parameters
#[derive(Debug, Clone)]
struct ExchangeConfig {
    base_url: String,
    websocket_url: String,
    api_key: Option<String>,
    rate_limit: u32,
}

/// Circuit breaker for preventing cascading failures
#[derive(Debug)]
struct CircuitBreaker {
    error_count: Arc<RwLock<u32>>,
    last_reset: Arc<RwLock<chrono::DateTime<chrono::Utc>>>,
    threshold: f64,
}

impl CircuitBreaker {
    fn new(threshold: f64) -> Self {
        Self {
            error_count: Arc::new(RwLock::new(0)),
            last_reset: Arc::new(RwLock::new(current_timestamp())),
            threshold,
        }
    }

    async fn record_error(&self) -> bool {
        let mut count = self.error_count.write().await;
        *count += 1;
        let error_rate = *count as f64 / MAX_BATCH_SIZE as f64;
        error_rate > self.threshold
    }

    async fn reset(&self) {
        let mut count = self.error_count.write().await;
        *count = 0;
        let mut last_reset = self.last_reset.write().await;
        *last_reset = current_timestamp();
    }
}

/// High-performance market data collector with error handling and metrics
#[derive(Debug)]
pub struct MarketDataCollector {
    metrics: MetricsCollector,
    trading_pairs: Vec<String>,
    collection_interval: Duration,
    dex_configs: HashMap<String, ExchangeConfig>,
    circuit_breaker: CircuitBreaker,
    retry_policy: RetryPolicy,
}

#[derive(Debug)]
struct RetryPolicy {
    max_retries: u32,
    delay: Duration,
}

impl MarketDataCollector {
    /// Creates new collector with configuration and error handling
    pub fn new(
        trading_pairs: Vec<String>,
        metrics: MetricsCollector,
        dex_configs: HashMap<String, ExchangeConfig>,
    ) -> Result<Self, CollectionError> {
        // Validate trading pairs
        for pair in &trading_pairs {
            validate_trading_pair(pair)?;
        }

        Ok(Self {
            metrics,
            trading_pairs,
            collection_interval: Duration::from_millis(COLLECTION_INTERVAL_MS),
            dex_configs,
            circuit_breaker: CircuitBreaker::new(CIRCUIT_BREAKER_THRESHOLD),
            retry_policy: RetryPolicy {
                max_retries: MAX_RETRIES,
                delay: Duration::from_millis(RETRY_DELAY_MS),
            },
        })
    }

    /// Starts continuous market data collection with error handling
    pub async fn start_collection(&self) -> Result<JoinHandle<()>, CollectionError> {
        let collector = self.clone();
        
        let handle = tokio::spawn(async move {
            let mut interval = time::interval(collector.collection_interval);
            
            loop {
                interval.tick().await;
                match collector.collect_market_data().await {
                    Ok(data) => {
                        // Process collected data
                        for market_data in data {
                            if let Err(e) = process_market_data(market_data) {
                                collector.metrics.record_collection_error("processing_error");
                            }
                        }
                        collector.circuit_breaker.reset().await;
                    }
                    Err(e) => {
                        collector.metrics.record_collection_error("collection_error");
                        if collector.circuit_breaker.record_error().await {
                            break;
                        }
                    }
                }
            }
        });

        Ok(handle)
    }

    /// Collects market data with retries and error handling
    pub async fn collect_market_data(&self) -> Result<Vec<MarketData>, CollectionError> {
        let mut collected_data = Vec::with_capacity(self.trading_pairs.len());
        let start_time = current_timestamp();

        for pair in &self.trading_pairs {
            let mut retries = 0;
            let mut last_error = None;

            while retries < self.retry_policy.max_retries {
                match self.collect_single_pair(pair).await {
                    Ok(data) => {
                        collected_data.push(data);
                        break;
                    }
                    Err(e) => {
                        last_error = Some(e);
                        retries += 1;
                        time::sleep(self.retry_policy.delay).await;
                    }
                }
            }

            if retries == self.retry_policy.max_retries {
                return Err(CollectionError::CollectionError(format!(
                    "max retries exceeded for pair {}: {:?}",
                    pair,
                    last_error
                )));
            }
        }

        let collection_time = current_timestamp()
            .signed_duration_since(start_time)
            .num_milliseconds();
        self.metrics.record_collection_latency(collection_time as f64);
        self.metrics.record_batch_size(collected_data.len() as f64);

        Ok(collected_data)
    }

    async fn collect_single_pair(&self, pair: &str) -> Result<MarketData, CollectionError> {
        // Implementation would include actual DEX API calls
        // This is a placeholder for the interface
        Err(CollectionError::CollectionError("not implemented".to_string()))
    }
}

/// Validates if a trading pair is supported and properly formatted
fn validate_trading_pair(trading_pair: &str) -> Result<(), CollectionError> {
    if !SUPPORTED_PAIRS.contains(&trading_pair) {
        return Err(CollectionError::ValidationError(format!(
            "unsupported trading pair: {}",
            trading_pair
        )));
    }

    let parts: Vec<&str> = trading_pair.split('/').collect();
    if parts.len() != 2 {
        return Err(CollectionError::ValidationError(
            "invalid trading pair format".to_string(),
        ));
    }

    Ok(())
}

/// Processes and validates collected market data with error handling
fn process_market_data(data: MarketData) -> Result<MarketData, CollectionError> {
    // Validate trading pair
    validate_trading_pair(&data.trading_pair)?;

    // Validate data freshness
    if !is_valid_market_timestamp(data.timestamp) {
        return Err(CollectionError::ProcessingError(
            "market data is stale".to_string(),
        ));
    }

    // Validate market data
    if let Err(e) = data.is_valid() {
        return Err(CollectionError::ProcessingError(e.to_string()));
    }

    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_market_data_collector_creation() {
        let metrics = MetricsCollector::new().unwrap();
        let trading_pairs = vec!["SOL/USDC".to_string()];
        let dex_configs = HashMap::new();

        let collector = MarketDataCollector::new(trading_pairs, metrics, dex_configs);
        assert!(collector.is_ok());
    }

    #[test]
    fn test_trading_pair_validation() {
        assert!(validate_trading_pair("SOL/USDC").is_ok());
        assert!(validate_trading_pair("INVALID").is_err());
    }
}