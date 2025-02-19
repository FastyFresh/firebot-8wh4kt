//! Core market data models for high-performance, thread-safe market data handling
//! across multiple Solana DEXs with sub-500ms latency requirements.
//!
//! Version dependencies:
//! - chrono = "0.4"
//! - rust_decimal = "1.30"
//! - uuid = "1.4"
//! - serde = "1.0"
//! - parking_lot = "0.12"
//! - thiserror = "1.0"

use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicUsize, Ordering};
use thiserror::Error;
use uuid::Uuid;

use crate::utils::time::{current_timestamp, is_valid_market_timestamp};

// Exchange-specific precision requirements
const MIN_PRICE_PRECISION: u32 = 8;
const MIN_VOLUME_PRECISION: u32 = 6;
const JUPITER_PRICE_PRECISION: u32 = 10;
const PUMP_FUN_PRICE_PRECISION: u32 = 8;
const DRIFT_PRICE_PRECISION: u32 = 6;

// Performance optimization constants
const ORDER_BOOK_CACHE_SIZE: usize = 1000;
const MAX_ORDER_BOOK_DEPTH: usize = 500;

/// Market-related error types with detailed context
#[derive(Error, Debug)]
pub enum MarketError {
    #[error("invalid price: {0}")]
    InvalidPrice(String),
    #[error("invalid volume: {0}")]
    InvalidVolume(String),
    #[error("invalid exchange: {0}")]
    InvalidExchange(String),
    #[error("invalid trading pair: {0}")]
    InvalidTradingPair(String),
    #[error("order book error: {0}")]
    OrderBookError(String),
    #[error("stale data: {0}")]
    StaleData(String),
}

/// Thread-safe cache for validation results
#[derive(Debug, Clone)]
struct ValidationCache {
    price_cache: HashMap<String, bool>,
    volume_cache: HashMap<String, bool>,
    last_update: DateTime<Utc>,
}

/// High-performance market data point representation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketData {
    id: Uuid,
    trading_pair: String,
    exchange: String,
    price: Decimal,
    volume: Decimal,
    timestamp: DateTime<Utc>,
    #[serde(skip)]
    validation_cache: RwLock<ValidationCache>,
}

impl MarketData {
    /// Creates a new market data point with comprehensive validation
    pub fn new(
        trading_pair: String,
        exchange: String,
        price: Decimal,
        volume: Decimal,
    ) -> Result<Self, MarketError> {
        // Validate inputs
        validate_price(price, &exchange)?;
        validate_volume(volume, &exchange)?;
        
        if trading_pair.split('/').count() != 2 {
            return Err(MarketError::InvalidTradingPair(
                "trading pair must be in format BASE/QUOTE".to_string(),
            ));
        }

        Ok(Self {
            id: Uuid::new_v4(),
            trading_pair,
            exchange,
            price,
            volume,
            timestamp: current_timestamp(),
            validation_cache: RwLock::new(ValidationCache {
                price_cache: HashMap::with_capacity(ORDER_BOOK_CACHE_SIZE),
                volume_cache: HashMap::with_capacity(ORDER_BOOK_CACHE_SIZE),
                last_update: current_timestamp(),
            }),
        })
    }

    /// Validates market data freshness and correctness
    pub fn is_valid(&self) -> Result<bool, MarketError> {
        // Check timestamp freshness
        if !is_valid_market_timestamp(self.timestamp) {
            return Err(MarketError::StaleData(format!(
                "market data from {} is stale",
                self.timestamp
            )));
        }

        // Validate price and volume
        validate_price(self.price, &self.exchange)?;
        validate_volume(self.volume, &self.exchange)?;

        Ok(true)
    }
}

/// Memory-optimized order book implementation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderBook {
    trading_pair: String,
    exchange: String,
    #[serde(skip)]
    bids: RwLock<BTreeMap<Decimal, Decimal>>,
    #[serde(skip)]
    asks: RwLock<BTreeMap<Decimal, Decimal>>,
    timestamp: DateTime<Utc>,
    depth: AtomicUsize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderBookLevel {
    price: Decimal,
    volume: Decimal,
}

impl OrderBook {
    /// Creates a new order book with depth management
    pub fn new(
        trading_pair: String,
        exchange: String,
        bids: Vec<OrderBookLevel>,
        asks: Vec<OrderBookLevel>,
    ) -> Result<Self, MarketError> {
        let mut bid_map = BTreeMap::new();
        let mut ask_map = BTreeMap::new();

        // Process bids with depth limit
        for level in bids.iter().take(MAX_ORDER_BOOK_DEPTH) {
            validate_price(level.price, &exchange)?;
            validate_volume(level.volume, &exchange)?;
            bid_map.insert(level.price, level.volume);
        }

        // Process asks with depth limit
        for level in asks.iter().take(MAX_ORDER_BOOK_DEPTH) {
            validate_price(level.price, &exchange)?;
            validate_volume(level.volume, &exchange)?;
            ask_map.insert(level.price, level.volume);
        }

        Ok(Self {
            trading_pair,
            exchange,
            bids: RwLock::new(bid_map),
            asks: RwLock::new(ask_map),
            timestamp: current_timestamp(),
            depth: AtomicUsize::new(0),
        })
    }

    /// Calculates current bid-ask spread atomically
    pub fn get_spread(&self) -> Result<Option<Decimal>, MarketError> {
        let bids = self.bids.read();
        let asks = self.asks.read();

        match (bids.iter().next_back(), asks.iter().next()) {
            (Some((bid_price, _)), Some((ask_price, _))) => {
                if bid_price >= ask_price {
                    return Err(MarketError::OrderBookError(
                        "invalid order book: bid price >= ask price".to_string(),
                    ));
                }
                Ok(Some(ask_price - bid_price))
            }
            _ => Ok(None),
        }
    }
}

/// Validates price against exchange requirements
#[inline]
pub fn validate_price(price: Decimal, exchange: &str) -> Result<(), MarketError> {
    if price <= Decimal::ZERO {
        return Err(MarketError::InvalidPrice("price must be positive".to_string()));
    }

    let required_precision = match exchange.to_lowercase().as_str() {
        "jupiter" => JUPITER_PRICE_PRECISION,
        "pump_fun" => PUMP_FUN_PRICE_PRECISION,
        "drift" => DRIFT_PRICE_PRECISION,
        _ => return Err(MarketError::InvalidExchange(format!("unknown exchange: {}", exchange))),
    };

    if price.scale() < MIN_PRICE_PRECISION || price.scale() > required_precision {
        return Err(MarketError::InvalidPrice(format!(
            "price precision must be between {} and {} for {}",
            MIN_PRICE_PRECISION, required_precision, exchange
        )));
    }

    Ok(())
}

/// Validates volume against exchange requirements
#[inline]
pub fn validate_volume(volume: Decimal, exchange: &str) -> Result<(), MarketError> {
    if volume <= Decimal::ZERO {
        return Err(MarketError::InvalidVolume("volume must be positive".to_string()));
    }

    if volume.scale() < MIN_VOLUME_PRECISION {
        return Err(MarketError::InvalidVolume(format!(
            "volume precision must be at least {}",
            MIN_VOLUME_PRECISION
        )));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_market_data_creation() {
        let market_data = MarketData::new(
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            dec!(23.45678900),
            dec!(100.000000),
        );
        assert!(market_data.is_ok());
    }

    #[test]
    fn test_invalid_price_precision() {
        let result = validate_price(dec!(23.4), "jupiter");
        assert!(result.is_err());
    }

    #[test]
    fn test_order_book_spread() {
        let order_book = OrderBook::new(
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            vec![OrderBookLevel {
                price: dec!(23.45678900),
                volume: dec!(100.000000),
            }],
            vec![OrderBookLevel {
                price: dec!(23.55678900),
                volume: dec!(100.000000),
            }],
        )
        .unwrap();

        let spread = order_book.get_spread().unwrap();
        assert!(spread.is_some());
    }
}