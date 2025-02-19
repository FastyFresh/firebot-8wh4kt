//! High-performance Drift Protocol data collector with connection pooling and comprehensive error handling.
//! 
//! Version dependencies:
//! - tokio = "1.28"
//! - tokio-tungstenite = "0.20"
//! - drift-sdk = "0.5"
//! - tracing = "0.1"

use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use drift_sdk::{
    types::{MarketConfig, OrderBookData, PerpMarketInfo},
    ws::{DriftWsClient, MarketUpdateMessage, OrderBookUpdateMessage},
};
use tokio::{
    sync::{mpsc, RwLock},
    time::sleep,
};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, error, info, instrument, warn};

use crate::{
    data_collector::{
        Collector, CollectorConfig, CollectorError, CollectorMetrics, ConnectionPool, HealthStatus,
    },
    models::market::{MarketData, validate_price, validate_volume},
    utils::solana::SolanaClient,
};

// Constants from globals
const DRIFT_WS_URL: &str = "wss://api.drift.trade/ws";
const DRIFT_RPC_URL: &str = "https://api.drift.trade";
const RECONNECT_DELAY_MS: u64 = 1000;
const MAX_RECONNECT_ATTEMPTS: u32 = 5;
const CONNECTION_POOL_SIZE: usize = 5;
const MESSAGE_BATCH_SIZE: usize = 100;
const HEALTH_CHECK_INTERVAL_MS: u64 = 5000;
const CIRCUIT_BREAKER_THRESHOLD: u32 = 3;

/// High-performance Drift Protocol data collector
#[derive(Debug)]
pub struct DriftCollector {
    ws_pool: Arc<ConnectionPool>,
    solana_client: Arc<SolanaClient>,
    drift_client: Arc<DriftWsClient>,
    metrics: Arc<RwLock<CollectorMetrics>>,
    circuit_breaker: Arc<RwLock<u32>>,
    is_running: AtomicBool,
    config: CollectorConfig,
}

impl DriftCollector {
    /// Creates a new DriftCollector instance with connection pooling and monitoring
    pub fn new(solana_client: Arc<SolanaClient>, config: CollectorConfig) -> Result<Self, CollectorError> {
        let ws_pool = Arc::new(ConnectionPool::new(config.connection_pool_size));
        
        let drift_client = DriftWsClient::new(DRIFT_WS_URL)
            .map_err(|e| CollectorError::ConnectionError(format!("Failed to create Drift client: {}", e)))?;

        Ok(Self {
            ws_pool,
            solana_client,
            drift_client: Arc::new(drift_client),
            metrics: Arc::new(RwLock::new(CollectorMetrics::default())),
            circuit_breaker: Arc::new(RwLock::new(0)),
            is_running: AtomicBool::new(false),
            config,
        })
    }

    /// Handles market data updates with performance optimization
    #[instrument(skip(message))]
    async fn handle_market_update(
        &self,
        message: MarketUpdateMessage,
    ) -> Result<MarketData, CollectorError> {
        let start = Instant::now();

        // Validate message format
        if !message.is_valid() {
            return Err(CollectorError::DataValidationError(
                "Invalid market update message format".to_string(),
            ));
        }

        // Extract and validate price/volume data
        let price = message.price;
        let volume = message.volume;

        validate_price(price, "drift")
            .map_err(|e| CollectorError::DataValidationError(e.to_string()))?;
        validate_volume(volume, "drift")
            .map_err(|e| CollectorError::DataValidationError(e.to_string()))?;

        // Create market data instance
        let market_data = MarketData::new(
            message.market_name,
            "drift".to_string(),
            price,
            volume,
        )?;

        // Record processing metrics
        let processing_time = start.elapsed();
        if processing_time > self.config.validation_timeout {
            warn!(
                "Market update processing exceeded timeout: {:?}",
                processing_time
            );
        }

        debug!(
            "Processed market update in {:?}: {} @ {}",
            processing_time, volume, price
        );

        Ok(market_data)
    }

    /// Processes order book updates with optimized sorting
    #[instrument(skip(message))]
    async fn handle_orderbook_update(
        &self,
        message: OrderBookUpdateMessage,
    ) -> Result<OrderBookData, CollectorError> {
        let start = Instant::now();

        // Validate order book data
        if message.bids.is_empty() && message.asks.is_empty() {
            return Err(CollectorError::DataValidationError(
                "Empty order book update".to_string(),
            ));
        }

        // Process and sort order book levels
        let mut order_book = OrderBookData {
            market_name: message.market_name,
            bids: message.bids,
            asks: message.asks,
            timestamp: chrono::Utc::now(),
        };

        order_book.bids.sort_by(|a, b| b.price.cmp(&a.price));
        order_book.asks.sort_by(|a, b| a.price.cmp(&b.price));

        // Validate price levels
        if !order_book.bids.is_empty() && !order_book.asks.is_empty() {
            if order_book.bids[0].price >= order_book.asks[0].price {
                return Err(CollectorError::DataValidationError(
                    "Invalid order book: crossed prices".to_string(),
                ));
            }
        }

        debug!(
            "Processed order book update in {:?}: {} bids, {} asks",
            start.elapsed(),
            order_book.bids.len(),
            order_book.asks.len()
        );

        Ok(order_book)
    }
}

#[async_trait::async_trait]
impl Collector for DriftCollector {
    /// Starts the data collection process with connection pooling and health checks
    async fn start_collection(&self) -> Result<(), CollectorError> {
        if self.is_running.load(Ordering::SeqCst) {
            return Err(CollectorError::CollectionError(
                "Collector already running".to_string(),
            ));
        }

        self.is_running.store(true, Ordering::SeqCst);
        info!("Starting Drift data collection");

        // Initialize connection pool
        let (tx, mut rx) = mpsc::channel(MESSAGE_BATCH_SIZE);
        let ws_pool = self.ws_pool.clone();
        let metrics = self.metrics.clone();
        let circuit_breaker = self.circuit_breaker.clone();

        // Spawn market data collection task
        let collection_task = tokio::spawn(async move {
            while let Some(message) = rx.recv().await {
                let conn = match ws_pool.acquire().await {
                    Ok(conn) => conn,
                    Err(e) => {
                        error!("Failed to acquire connection: {}", e);
                        continue;
                    }
                };

                match message {
                    Message::Text(text) => {
                        if let Ok(market_update) = serde_json::from_str::<MarketUpdateMessage>(&text) {
                            // Process market update
                            let start = Instant::now();
                            if let Err(e) = self.handle_market_update(market_update).await {
                                error!("Failed to process market update: {}", e);
                                let mut cb = circuit_breaker.write().await;
                                *cb += 1;
                                if *cb >= CIRCUIT_BREAKER_THRESHOLD {
                                    error!("Circuit breaker triggered");
                                    break;
                                }
                            }
                            metrics.write().await.average_latency = start.elapsed();
                        }
                    }
                    Message::Close(frame) => {
                        warn!("WebSocket connection closed: {:?}", frame);
                        break;
                    }
                    _ => {}
                }

                ws_pool.release(conn).await;
            }
        });

        // Spawn health check task
        let health_task = tokio::spawn({
            let is_running = self.is_running.clone();
            async move {
                while is_running.load(Ordering::SeqCst) {
                    if let Err(e) = self.health_check().await {
                        error!("Health check failed: {}", e);
                    }
                    sleep(Duration::from_millis(HEALTH_CHECK_INTERVAL_MS)).await;
                }
            }
        });

        tokio::try_join!(collection_task, health_task)
            .map_err(|e| CollectorError::CollectionError(format!("Collection task failed: {}", e)))?;

        Ok(())
    }

    /// Gracefully stops the data collection process
    async fn stop_collection(&self) -> Result<(), CollectorError> {
        info!("Stopping Drift data collection");
        self.is_running.store(false, Ordering::SeqCst);
        
        // Close all connections in the pool
        let mut reconnect_attempts = 0;
        while reconnect_attempts < MAX_RECONNECT_ATTEMPTS {
            if let Err(e) = self.drift_client.close().await {
                warn!("Failed to close Drift client: {}", e);
                reconnect_attempts += 1;
                sleep(Duration::from_millis(RECONNECT_DELAY_MS)).await;
            } else {
                break;
            }
        }

        Ok(())
    }

    /// Performs health check of collector and its connections
    async fn health_check(&self) -> Result<HealthStatus, CollectorError> {
        let metrics = self.metrics.read().await;
        let circuit_breaker = self.circuit_breaker.read().await;

        Ok(HealthStatus {
            is_healthy: *circuit_breaker < CIRCUIT_BREAKER_THRESHOLD,
            connection_count: self.config.connection_pool_size,
            last_collection_latency: metrics.average_latency,
            error_count: metrics.connection_errors,
            last_error: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_drift_collector_creation() {
        let solana_client = Arc::new(
            SolanaClient::new("http://localhost:8899".to_string(), None, None)
                .await
                .unwrap(),
        );
        let config = CollectorConfig::default();
        let collector = DriftCollector::new(solana_client, config);
        assert!(collector.is_ok());
    }

    #[tokio::test]
    async fn test_market_update_handling() {
        let solana_client = Arc::new(
            SolanaClient::new("http://localhost:8899".to_string(), None, None)
                .await
                .unwrap(),
        );
        let collector = DriftCollector::new(solana_client, CollectorConfig::default()).unwrap();

        let message = MarketUpdateMessage {
            market_name: "SOL-PERP".to_string(),
            price: dec!(23.456789),
            volume: dec!(100.000000),
            timestamp: chrono::Utc::now(),
        };

        let result = collector.handle_market_update(message).await;
        assert!(result.is_ok());
    }
}