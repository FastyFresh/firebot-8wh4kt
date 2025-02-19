//! High-performance Jupiter DEX data collector module for real-time market data aggregation
//! with advanced performance monitoring and reliability features.
//!
//! Version dependencies:
//! - tokio = "1.28"
//! - rust_decimal = "1.30"
//! - serde_json = "1.0"
//! - tungstenite = "0.20"
//! - metrics = "0.20"

use crate::models::market::{MarketData, OrderBook};
use crate::utils::metrics::MetricsCollector;
use crate::utils::solana::SolanaClient;
use crate::utils::time::{current_timestamp, calculate_duration_ms};

use futures_util::stream::{SplitSink, SplitStream};
use metrics::{counter, gauge, histogram};
use parking_lot::RwLock;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, WebSocketStream};
use tracing::{debug, error, info, instrument, warn};

// Global constants
const JUPITER_WS_URL: &str = "wss://price.jup.ag/v1/stream";
const JUPITER_REST_URL: &str = "https://price.jup.ag/v1";
const RECONNECT_DELAY_MS: u64 = 5000;
const MAX_BATCH_SIZE: usize = 100;
const METRICS_PREFIX: &str = "jupiter_collector";
const CACHE_TTL_MS: u64 = 1000;
const MAX_RECONNECT_ATTEMPTS: u8 = 5;
const MEMORY_POOL_SIZE: usize = 1000;

/// Error types for Jupiter data collection
#[derive(Error, Debug)]
pub enum CollectorError {
    #[error("websocket error: {0}")]
    WebSocketError(String),
    #[error("parse error: {0}")]
    ParseError(String),
    #[error("connection error: {0}")]
    ConnectionError(String),
    #[error("validation error: {0}")]
    ValidationError(String),
}

/// Market data subscription message
#[derive(Debug, Serialize)]
struct SubscriptionMessage {
    op: String,
    trading_pairs: Vec<String>,
}

/// Memory-efficient market data cache
#[derive(Debug)]
struct DataCache {
    entries: HashMap<String, (MarketData, i64)>,
    queue: VecDeque<String>,
    capacity: usize,
}

/// High-performance Jupiter DEX data collector
#[derive(Debug)]
pub struct JupiterCollector {
    ws_stream: Option<(SplitSink<WebSocketStream<TcpStream>, tungstenite::Message>, 
                      SplitStream<WebSocketStream<TcpStream>>)>,
    solana_client: Arc<SolanaClient>,
    trading_pairs: Vec<String>,
    market_data_tx: mpsc::Sender<MarketData>,
    metrics: Arc<MetricsCollector>,
    memory_pool: Arc<RwLock<Vec<MarketData>>>,
    data_cache: Arc<RwLock<DataCache>>,
    reconnect_backoff: ExponentialBackoff,
}

impl JupiterCollector {
    /// Creates a new Jupiter data collector instance
    pub fn new(
        trading_pairs: Vec<String>,
        solana_client: Arc<SolanaClient>,
        market_data_tx: mpsc::Sender<MarketData>,
        metrics_config: MetricsConfig,
    ) -> Self {
        let memory_pool = Arc::new(RwLock::new(Vec::with_capacity(MEMORY_POOL_SIZE)));
        let data_cache = Arc::new(RwLock::new(DataCache {
            entries: HashMap::new(),
            queue: VecDeque::new(),
            capacity: MAX_BATCH_SIZE,
        }));

        Self {
            ws_stream: None,
            solana_client,
            trading_pairs,
            market_data_tx,
            metrics: Arc::new(MetricsCollector::new().unwrap()),
            memory_pool,
            data_cache,
            reconnect_backoff: ExponentialBackoff::new(RECONNECT_DELAY_MS),
        }
    }

    /// Starts the market data collection process
    #[instrument(skip(self))]
    pub async fn start_collection(&mut self) -> Result<(), CollectorError> {
        info!("Starting Jupiter market data collection for {} pairs", self.trading_pairs.len());
        
        let mut reconnect_attempts = 0;
        
        loop {
            match self.connect_websocket().await {
                Ok((sink, stream)) => {
                    self.ws_stream = Some((sink, stream));
                    reconnect_attempts = 0;
                    
                    if let Err(e) = self.subscribe_to_market_data().await {
                        error!("Failed to subscribe to market data: {}", e);
                        self.ws_stream = None;
                        continue;
                    }
                    
                    if let Err(e) = self.process_market_data().await {
                        error!("Market data processing error: {}", e);
                        self.ws_stream = None;
                    }
                }
                Err(e) => {
                    error!("WebSocket connection error: {}", e);
                    reconnect_attempts += 1;
                    
                    if reconnect_attempts >= MAX_RECONNECT_ATTEMPTS {
                        return Err(CollectorError::ConnectionError(
                            "Max reconnection attempts reached".to_string()
                        ));
                    }
                    
                    let delay = self.reconnect_backoff.next_delay();
                    warn!("Reconnecting in {}ms...", delay);
                    tokio::time::sleep(tokio::time::Duration::from_millis(delay)).await;
                }
            }
        }
    }

    /// Establishes WebSocket connection with Jupiter
    #[instrument(skip(self))]
    async fn connect_websocket(&self) -> Result<
        (SplitSink<WebSocketStream<TcpStream>, tungstenite::Message>,
         SplitStream<WebSocketStream<TcpStream>>),
        CollectorError
    > {
        let start = current_timestamp();
        
        let (ws_stream, _) = connect_async(JUPITER_WS_URL)
            .await
            .map_err(|e| CollectorError::ConnectionError(e.to_string()))?;
            
        let (sink, stream) = ws_stream.split();
        
        let duration = calculate_duration_ms(start, current_timestamp())
            .unwrap_or(0);
            
        self.metrics.record_trade_execution(
            "connection",
            "websocket_connect",
            duration as u64,
            true
        )?;
        
        Ok((sink, stream))
    }

    /// Subscribes to market data for configured trading pairs
    #[instrument(skip(self))]
    async fn subscribe_to_market_data(&mut self) -> Result<(), CollectorError> {
        if let Some((sink, _)) = &mut self.ws_stream {
            let subscription = SubscriptionMessage {
                op: "subscribe".to_string(),
                trading_pairs: self.trading_pairs.clone(),
            };
            
            let message = serde_json::to_string(&subscription)
                .map_err(|e| CollectorError::ParseError(e.to_string()))?;
                
            sink.send(tungstenite::Message::Text(message))
                .await
                .map_err(|e| CollectorError::WebSocketError(e.to_string()))?;
                
            info!("Subscribed to {} trading pairs", self.trading_pairs.len());
        }
        
        Ok(())
    }

    /// Processes incoming market data with batching and validation
    #[instrument(skip(self))]
    async fn process_market_data(&mut self) -> Result<(), CollectorError> {
        let mut batch = Vec::with_capacity(MAX_BATCH_SIZE);
        
        if let Some((_, stream)) = &mut self.ws_stream {
            while let Some(message) = stream.next().await {
                let message = message
                    .map_err(|e| CollectorError::WebSocketError(e.to_string()))?;
                    
                if let tungstenite::Message::Text(data) = message {
                    let start = current_timestamp();
                    
                    match self.parse_market_data(serde_json::from_str(&data)?) {
                        Ok(market_data) => {
                            batch.push(market_data);
                            
                            if batch.len() >= MAX_BATCH_SIZE {
                                self.process_batch(&mut batch).await?;
                            }
                        }
                        Err(e) => {
                            warn!("Failed to parse market data: {}", e);
                            self.metrics.record_trade_execution(
                                "parsing",
                                "error",
                                0,
                                false
                            )?;
                        }
                    }
                    
                    let duration = calculate_duration_ms(start, current_timestamp())
                        .unwrap_or(0);
                        
                    self.metrics.record_trade_execution(
                        "processing",
                        "market_data",
                        duration as u64,
                        true
                    )?;
                }
            }
        }
        
        Ok(())
    }

    /// Parses raw market data with validation and caching
    #[instrument(skip(raw_data))]
    fn parse_market_data(&self, raw_data: Value) -> Result<MarketData, CollectorError> {
        let start = current_timestamp();
        
        // Check cache for recent identical data
        let cache_key = raw_data.to_string();
        {
            let cache = self.data_cache.read();
            if let Some((data, timestamp)) = cache.entries.get(&cache_key) {
                if current_timestamp().timestamp_millis() - timestamp < CACHE_TTL_MS as i64 {
                    return Ok(data.clone());
                }
            }
        }
        
        let trading_pair = raw_data["trading_pair"]
            .as_str()
            .ok_or_else(|| CollectorError::ParseError("missing trading pair".to_string()))?
            .to_string();
            
        let price = raw_data["price"]
            .as_str()
            .ok_or_else(|| CollectorError::ParseError("missing price".to_string()))?;
            
        let volume = raw_data["volume"]
            .as_str()
            .ok_or_else(|| CollectorError::ParseError("missing volume".to_string()))?;
            
        let market_data = MarketData::new(
            trading_pair,
            "jupiter".to_string(),
            Decimal::from_str(price)?,
            Decimal::from_str(volume)?,
        )?;
        
        // Update cache
        {
            let mut cache = self.data_cache.write();
            cache.entries.insert(
                cache_key,
                (market_data.clone(), current_timestamp().timestamp_millis())
            );
            cache.queue.push_back(cache_key);
            
            if cache.queue.len() > cache.capacity {
                if let Some(old_key) = cache.queue.pop_front() {
                    cache.entries.remove(&old_key);
                }
            }
        }
        
        let duration = calculate_duration_ms(start, current_timestamp())
            .unwrap_or(0);
            
        self.metrics.record_trade_execution(
            "parsing",
            "market_data",
            duration as u64,
            true
        )?;
        
        Ok(market_data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_market_data_parsing() {
        let collector = JupiterCollector::new(
            vec!["SOL/USDC".to_string()],
            Arc::new(SolanaClient::new(
                "https://api.mainnet-beta.solana.com".to_string(),
                None,
                None
            ).await.unwrap()),
            mpsc::channel(100).0,
            MetricsConfig::default(),
        );

        let raw_data = serde_json::json!({
            "trading_pair": "SOL/USDC",
            "price": "23.45678900",
            "volume": "100.000000"
        });

        let result = collector.parse_market_data(raw_data);
        assert!(result.is_ok());
    }
}