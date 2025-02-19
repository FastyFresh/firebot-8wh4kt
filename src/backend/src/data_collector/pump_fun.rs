//! Pump Fun DEX data collector implementation with enhanced connection pooling,
//! health monitoring, and performance optimization.
//!
//! Version dependencies:
//! - tokio = "1.28"
//! - tracing = "0.1"
//! - metrics = "0.20"
//! - r2d2 = "0.8"

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use async_trait::async_trait;
use metrics::{counter, gauge, histogram};
use r2d2::Pool;
use tokio::{
    sync::RwLock,
    time::{sleep, timeout},
};
use tracing::{debug, error, info, instrument, warn};

use crate::{
    data_collector::{Collector, CollectorError, HealthStatus},
    models::market::{MarketData, validate_price, validate_volume},
    utils::{
        solana::SolanaClient,
        time::{current_timestamp, is_valid_market_timestamp},
    },
};

// Program constants
const PUMP_FUN_PROGRAM_ID: &str = "pf1xyPydBXyPxGZwpvpuXNB1K3zMqCVbJKfihvQhKGE";
const MARKET_REFRESH_INTERVAL_MS: u64 = 100;
const MAX_RETRIES: u8 = 3;
const BACKOFF_BASE_MS: u64 = 50;
const CONNECTION_POOL_SIZE: u32 = 10;

/// Enhanced error types for Pump Fun data collection
#[derive(Debug, thiserror::Error)]
pub enum PumpFunError {
    #[error("Connection error: {0}")]
    ConnectionError(String),
    #[error("Market data error: {0}")]
    MarketDataError(String),
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Performance error: {0}")]
    PerformanceError(String),
}

/// Cached market state for performance optimization
#[derive(Debug, Clone)]
struct MarketState {
    last_update: chrono::DateTime<chrono::Utc>,
    last_price: rust_decimal::Decimal,
    last_volume: rust_decimal::Decimal,
    update_count: u64,
}

/// Health monitoring for the collector
#[derive(Debug)]
struct HealthMonitor {
    last_check: chrono::DateTime<chrono::Utc>,
    connection_errors: u64,
    validation_errors: u64,
    average_latency: Duration,
}

/// Enhanced implementation of the Collector trait for Pump Fun DEX
#[derive(Debug)]
pub struct PumpFunCollector {
    connection_pool: Arc<Pool<SolanaClient>>,
    market_states: RwLock<HashMap<String, MarketState>>,
    is_running: AtomicBool,
    health_monitor: RwLock<HealthMonitor>,
}

impl PumpFunCollector {
    /// Creates a new PumpFunCollector instance with connection pooling
    pub fn new(solana_client: Arc<SolanaClient>) -> Result<Self, CollectorError> {
        let pool_config = r2d2::Pool::builder()
            .max_size(CONNECTION_POOL_SIZE)
            .connection_timeout(Duration::from_secs(5))
            .build_unchecked(solana_client);

        let collector = Self {
            connection_pool: Arc::new(pool_config),
            market_states: RwLock::new(HashMap::new()),
            is_running: AtomicBool::new(false),
            health_monitor: RwLock::new(HealthMonitor {
                last_check: current_timestamp(),
                connection_errors: 0,
                validation_errors: 0,
                average_latency: Duration::from_millis(0),
            }),
        };

        // Initialize metrics
        gauge!("pump_fun_collector.pool_size", CONNECTION_POOL_SIZE as f64);
        counter!("pump_fun_collector.init", 1);

        Ok(collector)
    }

    /// Collects market data with caching and parallel processing
    #[instrument(skip(self, market_account))]
    async fn collect_market_data(
        &self,
        market_account: solana_sdk::pubkey::Pubkey,
    ) -> Result<MarketData, PumpFunError> {
        let start_time = std::time::Instant::now();

        // Get connection from pool with timeout
        let conn = timeout(
            Duration::from_secs(5),
            self.connection_pool.get(),
        )
        .await
        .map_err(|e| PumpFunError::ConnectionError(e.to_string()))?
        .map_err(|e| PumpFunError::ConnectionError(e.to_string()))?;

        // Fetch account data with retries
        let mut retries = 0;
        let account_data = loop {
            match conn.get_account(&market_account).await {
                Ok(Some(account)) => break account,
                Ok(None) => {
                    return Err(PumpFunError::MarketDataError(
                        "Market account not found".to_string(),
                    ))
                }
                Err(e) if retries < MAX_RETRIES => {
                    warn!("Retrying market data collection: {}", e);
                    retries += 1;
                    sleep(Duration::from_millis(BACKOFF_BASE_MS * 2u64.pow(retries as u32))).await;
                }
                Err(e) => {
                    counter!("pump_fun_collector.connection_errors", 1);
                    return Err(PumpFunError::ConnectionError(e.to_string()));
                }
            }
        };

        // Parse and validate market data
        let market_data = self.parse_market_account(
            &account_data,
            self.market_states.read().await.get(&market_account.to_string()).cloned(),
        ).await?;

        // Update market state
        let mut states = self.market_states.write().await;
        states.insert(
            market_account.to_string(),
            MarketState {
                last_update: current_timestamp(),
                last_price: market_data.price,
                last_volume: market_data.volume,
                update_count: states
                    .get(&market_account.to_string())
                    .map_or(1, |s| s.update_count + 1),
            },
        );

        // Record metrics
        let elapsed = start_time.elapsed();
        histogram!("pump_fun_collector.collection_time", elapsed);
        counter!("pump_fun_collector.successful_collections", 1);

        Ok(market_data)
    }

    /// Parses Pump Fun DEX market account data with enhanced validation
    #[instrument(skip(account_data, cached_state))]
    async fn parse_market_account(
        &self,
        account_data: &[u8],
        cached_state: Option<MarketState>,
    ) -> Result<MarketData, PumpFunError> {
        let start_time = std::time::Instant::now();

        // Deserialize market data
        let market_info: PumpFunMarketInfo = borsh::BorshDeserialize::deserialize(&mut &account_data[..])
            .map_err(|e| PumpFunError::MarketDataError(format!("Failed to deserialize market data: {}", e)))?;

        // Validate price and volume
        validate_price(market_info.price, "pump_fun")
            .map_err(|e| PumpFunError::ValidationError(e.to_string()))?;
        validate_volume(market_info.volume, "pump_fun")
            .map_err(|e| PumpFunError::ValidationError(e.to_string()))?;

        // Create market data instance
        let market_data = MarketData::new(
            market_info.trading_pair,
            "pump_fun".to_string(),
            market_info.price,
            market_info.volume,
        ).map_err(|e| PumpFunError::ValidationError(e.to_string()))?;

        // Anomaly detection using cached state
        if let Some(cached) = cached_state {
            let price_change_pct = ((market_info.price - cached.last_price) / cached.last_price * 100.0)
                .abs()
                .to_f64()
                .unwrap_or(0.0);

            if price_change_pct > 10.0 {
                warn!(
                    "Large price change detected: {}% for pair {}",
                    price_change_pct, market_info.trading_pair
                );
                counter!("pump_fun_collector.price_anomalies", 1);
            }
        }

        // Record parsing metrics
        let elapsed = start_time.elapsed();
        histogram!("pump_fun_collector.parsing_time", elapsed);

        Ok(market_data)
    }
}

#[async_trait]
impl Collector for PumpFunCollector {
    #[instrument(skip(self))]
    async fn start_collection(&self) -> Result<(), CollectorError> {
        if self.is_running.load(Ordering::SeqCst) {
            return Ok(());
        }

        info!("Starting Pump Fun market data collection");
        self.is_running.store(true, Ordering::SeqCst);

        let collector = self.clone();
        tokio::spawn(async move {
            while collector.is_running.load(Ordering::SeqCst) {
                if let Err(e) = collector.collect_all_markets().await {
                    error!("Market collection error: {}", e);
                    counter!("pump_fun_collector.collection_errors", 1);
                }
                sleep(Duration::from_millis(MARKET_REFRESH_INTERVAL_MS)).await;
            }
        });

        Ok(())
    }

    #[instrument(skip(self))]
    async fn stop_collection(&self) -> Result<(), CollectorError> {
        info!("Stopping Pump Fun market data collection");
        self.is_running.store(false, Ordering::SeqCst);
        Ok(())
    }

    #[instrument(skip(self))]
    async fn health_check(&self) -> Result<HealthStatus, CollectorError> {
        let monitor = self.health_monitor.read().await;
        
        Ok(HealthStatus {
            is_healthy: monitor.connection_errors < 100 && monitor.validation_errors < 50,
            connection_count: self.connection_pool.state().connections as usize,
            last_collection_latency: monitor.average_latency,
            error_count: monitor.connection_errors + monitor.validation_errors,
            last_error: None,
        })
    }
}

/// Market information structure for Pump Fun DEX
#[derive(Debug, borsh::BorshDeserialize)]
struct PumpFunMarketInfo {
    trading_pair: String,
    price: rust_decimal::Decimal,
    volume: rust_decimal::Decimal,
    timestamp: i64,
}