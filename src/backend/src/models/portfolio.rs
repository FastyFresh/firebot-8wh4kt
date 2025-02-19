//! Core portfolio model implementation for managing trading positions, balances,
//! and portfolio-wide metrics across multiple DEXs with thread-safe concurrent access.
//!
//! Version dependencies:
//! - rust_decimal = "1.30"
//! - chrono = "0.4"
//! - uuid = "1.4"
//! - serde = "1.0"
//! - tokio = "1.28"
//! - metrics = "0.20"

use chrono::{DateTime, Utc};
use metrics::{counter, histogram};
use rust_decimal::Decimal;
use rust_decimal::prelude::RoundingStrategy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::trade::{Trade, calculate_trade_value};
use crate::models::order::{Order, validate_order};

// Constants for portfolio management
const MIN_PORTFOLIO_VALUE: Decimal = Decimal::new(100, 0); // Minimum 100 USDC
const MAX_POSITION_SIZE_PERCENT: Decimal = Decimal::new(20, 2); // 20% max position size
const CACHE_EXPIRY_SECONDS: i64 = 300; // 5 minutes cache expiry
const MAX_CONCURRENT_OPERATIONS: usize = 100;
const METRICS_PREFIX: &str = "trading_bot.portfolio";

/// Portfolio-related error types
#[derive(Error, Debug)]
pub enum PortfolioError {
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error("balance error: {0}")]
    BalanceError(String),
    #[error("position error: {0}")]
    PositionError(String),
    #[error("calculation error: {0}")]
    CalculationError(String),
}

/// Thread-safe position tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub trading_pair: String,
    pub size: Decimal,
    pub entry_price: Decimal,
    pub last_updated: DateTime<Utc>,
}

/// High-performance portfolio management system
#[derive(Debug, Clone)]
#[metrics(prefix = "portfolio")]
pub struct Portfolio {
    id: Uuid,
    wallet_address: String,
    usdc_balance: Arc<RwLock<Decimal>>,
    positions: Arc<RwLock<HashMap<String, Position>>>,
    last_updated: DateTime<Utc>,
    value_cache: Arc<RwLock<(DateTime<Utc>, Decimal)>>,
}

impl Portfolio {
    /// Creates a new thread-safe portfolio instance
    pub fn new(wallet_address: String, initial_balance: Decimal) -> Result<Self, PortfolioError> {
        if initial_balance < MIN_PORTFOLIO_VALUE {
            return Err(PortfolioError::ValidationError(format!(
                "initial balance {} is below minimum {}",
                initial_balance, MIN_PORTFOLIO_VALUE
            )));
        }

        let portfolio = Self {
            id: Uuid::new_v4(),
            wallet_address,
            usdc_balance: Arc::new(RwLock::new(initial_balance)),
            positions: Arc::new(RwLock::new(HashMap::with_capacity(MAX_CONCURRENT_OPERATIONS))),
            last_updated: Utc::now(),
            value_cache: Arc::new(RwLock::new((Utc::now(), initial_balance))),
        };

        // Initialize metrics
        counter!(format!("{}.created", METRICS_PREFIX), 1);
        histogram!(
            format!("{}.initial_balance", METRICS_PREFIX),
            initial_balance.to_f64().unwrap_or(0.0)
        );

        Ok(portfolio)
    }

    /// Calculates total portfolio value with caching
    #[tracing::instrument(skip(self, market_prices))]
    pub async fn calculate_portfolio_value(
        &self,
        market_prices: &HashMap<String, Decimal>,
    ) -> Result<Decimal, PortfolioError> {
        // Check cache validity
        let cache = self.value_cache.read().await;
        let cache_age = (Utc::now() - cache.0).num_seconds();
        
        if cache_age < CACHE_EXPIRY_SECONDS {
            return Ok(cache.1);
        }
        drop(cache);

        // Calculate new value
        let usdc_balance = *self.usdc_balance.read().await;
        let positions = self.positions.read().await;
        
        let mut total_value = usdc_balance;

        for (trading_pair, position) in positions.iter() {
            let current_price = market_prices
                .get(trading_pair)
                .ok_or_else(|| PortfolioError::CalculationError(
                    format!("no price data for {}", trading_pair)
                ))?;

            let position_value = calculate_trade_value(position.size, *current_price)
                .map_err(|e| PortfolioError::CalculationError(e.to_string()))?;

            total_value += position_value;
        }

        // Update cache
        *self.value_cache.write().await = (Utc::now(), total_value);

        // Record metrics
        histogram!(
            format!("{}.total_value", METRICS_PREFIX),
            total_value.to_f64().unwrap_or(0.0)
        );

        Ok(total_value)
    }

    /// Opens a new position or updates existing one
    #[tracing::instrument(skip(self, size, entry_price))]
    pub async fn add_position(
        &self,
        trading_pair: String,
        size: Decimal,
        entry_price: Decimal,
    ) -> Result<(), PortfolioError> {
        // Validate position parameters
        if size <= Decimal::ZERO {
            return Err(PortfolioError::ValidationError("position size must be positive".to_string()));
        }

        // Calculate position value
        let position_value = calculate_trade_value(size, entry_price)
            .map_err(|e| PortfolioError::CalculationError(e.to_string()))?;

        // Check portfolio limits
        let total_value = self.calculate_portfolio_value(&HashMap::new()).await?;
        let position_percentage = (position_value * Decimal::new(100, 0)) / total_value;

        if position_percentage > MAX_POSITION_SIZE_PERCENT {
            return Err(PortfolioError::ValidationError(format!(
                "position size {}% exceeds maximum {}%",
                position_percentage, MAX_POSITION_SIZE_PERCENT
            )));
        }

        // Update position
        let mut positions = self.positions.write().await;
        positions.insert(trading_pair.clone(), Position {
            trading_pair,
            size,
            entry_price,
            last_updated: Utc::now(),
        });

        // Invalidate value cache
        self.value_cache.write().await.0 = Utc::now() - chrono::Duration::seconds(CACHE_EXPIRY_SECONDS + 1);

        // Record metrics
        counter!(format!("{}.positions_updated", METRICS_PREFIX), 1);
        histogram!(
            format!("{}.position_size", METRICS_PREFIX),
            position_value.to_f64().unwrap_or(0.0)
        );

        Ok(())
    }

    /// Updates portfolio USDC balance with thread safety
    #[tracing::instrument(skip(self, new_balance))]
    pub async fn update_balance(&self, new_balance: Decimal) -> Result<(), PortfolioError> {
        if new_balance < Decimal::ZERO {
            return Err(PortfolioError::ValidationError("balance cannot be negative".to_string()));
        }

        let mut balance = self.usdc_balance.write().await;
        *balance = new_balance;

        // Invalidate value cache
        self.value_cache.write().await.0 = Utc::now() - chrono::Duration::seconds(CACHE_EXPIRY_SECONDS + 1);

        // Record metrics
        histogram!(
            format!("{}.usdc_balance", METRICS_PREFIX),
            new_balance.to_f64().unwrap_or(0.0)
        );

        Ok(())
    }

    /// Closes an existing position
    #[tracing::instrument(skip(self))]
    pub async fn close_position(&self, trading_pair: &str) -> Result<(), PortfolioError> {
        let mut positions = self.positions.write().await;
        
        if positions.remove(trading_pair).is_none() {
            return Err(PortfolioError::PositionError(
                format!("position {} not found", trading_pair)
            ));
        }

        // Invalidate value cache
        self.value_cache.write().await.0 = Utc::now() - chrono::Duration::seconds(CACHE_EXPIRY_SECONDS + 1);

        // Record metrics
        counter!(format!("{}.positions_closed", METRICS_PREFIX), 1);

        Ok(())
    }

    /// Returns current portfolio metrics
    pub async fn get_metrics(&self) -> Result<PortfolioMetrics, PortfolioError> {
        let positions = self.positions.read().await;
        let usdc_balance = *self.usdc_balance.read().await;

        Ok(PortfolioMetrics {
            total_positions: positions.len(),
            usdc_balance,
            last_updated: self.last_updated,
        })
    }
}

/// Portfolio performance metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortfolioMetrics {
    pub total_positions: usize,
    pub usdc_balance: Decimal,
    pub last_updated: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_portfolio_creation() {
        let portfolio = Portfolio::new(
            "wallet123".to_string(),
            dec!(1000.00),
        );
        assert!(portfolio.is_ok());
    }

    #[tokio::test]
    async fn test_add_position() {
        let portfolio = Portfolio::new(
            "wallet123".to_string(),
            dec!(1000.00),
        ).unwrap();

        let result = portfolio.add_position(
            "SOL/USDC".to_string(),
            dec!(1.5),
            dec!(100.00),
        ).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_portfolio_value_calculation() {
        let portfolio = Portfolio::new(
            "wallet123".to_string(),
            dec!(1000.00),
        ).unwrap();

        let mut prices = HashMap::new();
        prices.insert("SOL/USDC".to_string(), dec!(100.00));

        let value = portfolio.calculate_portfolio_value(&prices).await;
        assert!(value.is_ok());
    }
}