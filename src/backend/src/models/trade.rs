//! Core trade model implementation for high-performance trade execution and tracking
//! across multiple Solana DEXs with comprehensive monitoring and metrics collection.
//!
//! Version dependencies:
//! - chrono = "0.4"
//! - rust_decimal = "1.30"
//! - uuid = "1.4"
//! - serde = "1.0"
//! - metrics = "0.20"

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::RoundingStrategy;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use uuid::Uuid;
use metrics::{counter, histogram};

use crate::models::order::Order;
use crate::models::market::MarketData;

// Constants for trade execution and validation
const MIN_TRADE_SIZE: Decimal = Decimal::new(1, 3); // 0.001 minimum trade size
const MAX_SLIPPAGE_PERCENT: Decimal = Decimal::new(10, 1); // 1.0% maximum slippage
const METRICS_PREFIX: &str = "trading_bot.trade";

// DEX-specific fee rates (in decimal form)
const DEX_FEE_RATES: &[(&str, Decimal)] = &[
    ("jupiter", Decimal::new(3, 4)),    // 0.0003
    ("pump_fun", Decimal::new(4, 4)),   // 0.0004
    ("drift", Decimal::new(2, 4)),      // 0.0002
];

/// Trade-related error types
#[derive(Error, Debug)]
pub enum TradeError {
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error("calculation error: {0}")]
    CalculationError(String),
    #[error("execution error: {0}")]
    ExecutionError(String),
    #[error("fee calculation error: {0}")]
    FeeError(String),
}

/// Supported trade types across DEXs
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TradeType {
    Market,
    Limit,
    StopLoss,
    TakeProfit,
}

/// Core trade model with execution details and performance tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
#[metrics(prefix = "trade")]
pub struct Trade {
    pub id: Uuid,
    pub order_id: Uuid,
    pub trading_pair: String,
    pub exchange: String,
    pub trade_type: TradeType,
    pub expected_price: Decimal,
    pub executed_price: Decimal,
    pub size: Decimal,
    pub fee: Decimal,
    pub transaction_hash: String,
    pub executed_at: DateTime<Utc>,
    pub execution_time: Duration,
}

impl Trade {
    /// Creates a new trade record with comprehensive validation and metrics tracking
    pub fn new(
        order_id: Uuid,
        trading_pair: String,
        exchange: String,
        trade_type: TradeType,
        expected_price: Decimal,
        executed_price: Decimal,
        size: Decimal,
        transaction_hash: String,
    ) -> Result<Self, TradeError> {
        // Validate trade parameters
        if size < MIN_TRADE_SIZE {
            return Err(TradeError::ValidationError(format!(
                "trade size {} is below minimum {}",
                size, MIN_TRADE_SIZE
            )));
        }

        // Calculate trade fee based on exchange
        let fee = calculate_fee(&exchange, size, executed_price)?;

        // Calculate execution time and record metrics
        let execution_time = Duration::from_millis(500); // Example duration
        histogram!(
            format!("{}.execution_time_ms", METRICS_PREFIX),
            execution_time.as_millis() as f64
        );

        let trade = Self {
            id: Uuid::new_v4(),
            order_id,
            trading_pair,
            exchange,
            trade_type,
            expected_price,
            executed_price,
            size,
            fee,
            transaction_hash,
            executed_at: Utc::now(),
            execution_time,
        };

        // Record trade metrics
        counter!(format!("{}.executed", METRICS_PREFIX), 1);
        histogram!(
            format!("{}.size", METRICS_PREFIX),
            trade.size.to_f64().unwrap_or(0.0)
        );

        Ok(trade)
    }

    /// Calculates the price slippage for this trade
    pub fn get_slippage(&self) -> Result<Decimal, TradeError> {
        calculate_slippage(self.expected_price, self.executed_price)
    }

    /// Calculates the total value of this trade including fees
    pub fn get_value(&self) -> Result<Decimal, TradeError> {
        calculate_trade_value(self.size, self.executed_price)
            .map(|value| value - self.fee)
    }
}

/// Calculates the total value of a trade in USDC
#[inline]
fn calculate_trade_value(size: Decimal, price: Decimal) -> Result<Decimal, TradeError> {
    if size <= Decimal::ZERO {
        return Err(TradeError::ValidationError("size must be positive".to_string()));
    }
    if price <= Decimal::ZERO {
        return Err(TradeError::ValidationError("price must be positive".to_string()));
    }

    size.checked_mul(price)
        .ok_or_else(|| TradeError::CalculationError("trade value overflow".to_string()))
        .map(|value| value.round_dp_with_strategy(6, RoundingStrategy::MidpointAwayFromZero))
}

/// Calculates the slippage percentage between expected and executed price
#[inline]
fn calculate_slippage(expected_price: Decimal, executed_price: Decimal) -> Result<Decimal, TradeError> {
    if expected_price <= Decimal::ZERO || executed_price <= Decimal::ZERO {
        return Err(TradeError::ValidationError("prices must be positive".to_string()));
    }

    let slippage = ((executed_price - expected_price) * Decimal::new(100, 0))
        .checked_div(expected_price)
        .ok_or_else(|| TradeError::CalculationError("slippage calculation failed".to_string()))?
        .abs()
        .round_dp_with_strategy(4, RoundingStrategy::MidpointAwayFromZero);

    if slippage > MAX_SLIPPAGE_PERCENT {
        return Err(TradeError::ValidationError(format!(
            "slippage {} exceeds maximum {}%",
            slippage, MAX_SLIPPAGE_PERCENT
        )));
    }

    Ok(slippage)
}

/// Calculates the trade fee based on exchange and trade details
#[inline]
fn calculate_fee(exchange: &str, size: Decimal, price: Decimal) -> Result<Decimal, TradeError> {
    let fee_rate = DEX_FEE_RATES
        .iter()
        .find(|(dex, _)| *dex == exchange.to_lowercase())
        .map(|(_, rate)| *rate)
        .ok_or_else(|| TradeError::FeeError(format!("unknown exchange: {}", exchange)))?;

    calculate_trade_value(size, price)
        .and_then(|value| {
            value
                .checked_mul(fee_rate)
                .ok_or_else(|| TradeError::CalculationError("fee calculation overflow".to_string()))
        })
        .map(|fee| fee.round_dp_with_strategy(6, RoundingStrategy::MidpointAwayFromZero))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_trade_creation() {
        let trade = Trade::new(
            Uuid::new_v4(),
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            TradeType::Market,
            dec!(23.45),
            dec!(23.50),
            dec!(1.5),
            "tx_hash".to_string(),
        );
        assert!(trade.is_ok());
    }

    #[test]
    fn test_slippage_calculation() {
        let slippage = calculate_slippage(dec!(100.00), dec!(101.00));
        assert!(slippage.is_ok());
        assert_eq!(slippage.unwrap(), dec!(1.0000));
    }

    #[test]
    fn test_fee_calculation() {
        let fee = calculate_fee("jupiter", dec!(1.0), dec!(100.00));
        assert!(fee.is_ok());
        assert_eq!(fee.unwrap(), dec!(0.030000)); // 0.03 USDC fee for 100 USDC trade
    }

    #[test]
    fn test_trade_value_calculation() {
        let value = calculate_trade_value(dec!(2.5), dec!(100.00));
        assert!(value.is_ok());
        assert_eq!(value.unwrap(), dec!(250.000000));
    }
}