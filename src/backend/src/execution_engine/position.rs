//! Thread-safe position management system for high-performance trading operations
//! with comprehensive risk tracking and performance monitoring.
//!
//! Version dependencies:
//! - rust_decimal = "1.30"
//! - chrono = "0.4"
//! - tokio = "1.28"
//! - uuid = "1.4"
//! - metrics = "0.20"

use chrono::{DateTime, Utc};
use metrics::{counter, gauge, histogram};
use rust_decimal::Decimal;
use rust_decimal::prelude::RoundingStrategy;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::execution_engine::error::{ExecutionError, TradeContext};
use crate::models::trade::Trade;

// Position management constants
const MIN_POSITION_SIZE: Decimal = Decimal::new(1, 3); // 0.001 minimum position size
const MAX_POSITION_SIZE: Decimal = Decimal::new(1000000, 0); // 1,000,000 maximum position size
const POSITION_UPDATE_TIMEOUT: std::time::Duration = std::time::Duration::from_millis(500);
const EMERGENCY_CLOSURE_THRESHOLD: Decimal = Decimal::new(20, 2); // 20% drawdown threshold
const METRICS_PREFIX: &str = "trading_bot.position";

/// Position status tracking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PositionStatus {
    Opening,
    Open,
    Closing,
    Closed,
    EmergencyClosing,
    Error,
}

/// Comprehensive position performance metrics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PositionMetrics {
    pub unrealized_pnl: Decimal,
    pub realized_pnl: Decimal,
    pub max_drawdown: Decimal,
    pub peak_value: Decimal,
    pub entry_value: Decimal,
    pub current_value: Decimal,
    pub update_count: u64,
    pub last_update: DateTime<Utc>,
}

impl PositionMetrics {
    fn new(entry_value: Decimal) -> Self {
        Self {
            unrealized_pnl: Decimal::ZERO,
            realized_pnl: Decimal::ZERO,
            max_drawdown: Decimal::ZERO,
            peak_value: entry_value,
            entry_value,
            current_value: entry_value,
            update_count: 0,
            last_update: Utc::now(),
        }
    }

    fn update(&mut self, new_value: Decimal) {
        self.current_value = new_value;
        self.unrealized_pnl = calculate_pnl(self.entry_value, new_value);
        
        if new_value > self.peak_value {
            self.peak_value = new_value;
        }

        let current_drawdown = calculate_drawdown(self.peak_value, new_value);
        if current_drawdown > self.max_drawdown {
            self.max_drawdown = current_drawdown;
        }

        self.update_count += 1;
        self.last_update = Utc::now();

        // Record metrics
        gauge!(
            format!("{}.unrealized_pnl", METRICS_PREFIX),
            self.unrealized_pnl.to_f64().unwrap_or(0.0)
        );
        gauge!(
            format!("{}.max_drawdown", METRICS_PREFIX),
            self.max_drawdown.to_f64().unwrap_or(0.0)
        );
    }
}

/// Thread-safe position management with comprehensive tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Position {
    pub id: Uuid,
    pub trading_pair: String,
    size: Arc<RwLock<Decimal>>,
    entry_price: Decimal,
    current_price: Arc<RwLock<Decimal>>,
    pub opened_at: DateTime<Utc>,
    pub closed_at: Option<DateTime<Utc>>,
    status: Arc<RwLock<PositionStatus>>,
    metrics: Arc<RwLock<PositionMetrics>>,
}

impl Position {
    /// Creates a new position with comprehensive validation and metrics initialization
    pub fn new(
        trading_pair: String,
        size: Decimal,
        entry_price: Decimal,
    ) -> Result<Self, ExecutionError> {
        // Validate position parameters
        validate_position_size(size)?;
        validate_price(entry_price)?;

        let entry_value = calculate_position_value(size, entry_price)?;
        
        let position = Self {
            id: Uuid::new_v4(),
            trading_pair,
            size: Arc::new(RwLock::new(size)),
            entry_price,
            current_price: Arc::new(RwLock::new(entry_price)),
            opened_at: Utc::now(),
            closed_at: None,
            status: Arc::new(RwLock::new(PositionStatus::Opening)),
            metrics: Arc::new(RwLock::new(PositionMetrics::new(entry_value))),
        };

        // Record creation metrics
        counter!(format!("{}.created", METRICS_PREFIX), 1);
        gauge!(
            format!("{}.size", METRICS_PREFIX),
            size.to_f64().unwrap_or(0.0)
        );

        Ok(position)
    }

    /// Updates position details with thread-safe operations and validation
    pub async fn update_position(
        &mut self,
        new_size: Decimal,
        new_price: Decimal,
    ) -> Result<(), ExecutionError> {
        let _start = std::time::Instant::now();

        // Validate inputs
        validate_position_size(new_size)?;
        validate_price(new_price)?;

        // Acquire locks with timeout protection
        let size_lock = self.size.clone();
        let price_lock = self.current_price.clone();
        let metrics_lock = self.metrics.clone();
        let status_lock = self.status.clone();

        let mut size = size_lock.write().await;
        let mut price = price_lock.write().await;
        let mut metrics = metrics_lock.write().await;
        let mut status = status_lock.write().await;

        // Calculate new position value
        let new_value = calculate_position_value(new_size, new_price)?;

        // Check emergency closure threshold
        let drawdown = calculate_drawdown(metrics.peak_value, new_value);
        if drawdown >= EMERGENCY_CLOSURE_THRESHOLD {
            *status = PositionStatus::EmergencyClosing;
            counter!(format!("{}.emergency_closures", METRICS_PREFIX), 1);
            return Err(ExecutionError::PositionError(
                format!("Emergency closure triggered: drawdown {:.2}% exceeds threshold", drawdown)
            ));
        }

        // Update position data
        *size = new_size;
        *price = new_price;
        metrics.update(new_value);

        // Record update metrics
        histogram!(
            format!("{}.update_duration_ms", METRICS_PREFIX),
            _start.elapsed().as_millis() as f64
        );

        Ok(())
    }

    /// Retrieves current position metrics
    pub async fn get_metrics(&self) -> Result<PositionMetrics, ExecutionError> {
        Ok(self.metrics.read().await.clone())
    }

    /// Closes the position and finalizes metrics
    pub async fn close(&mut self) -> Result<(), ExecutionError> {
        let mut status = self.status.write().await;
        let mut metrics = self.metrics.write().await;

        *status = PositionStatus::Closed;
        self.closed_at = Some(Utc::now());
        metrics.realized_pnl = metrics.unrealized_pnl;

        counter!(format!("{}.closed", METRICS_PREFIX), 1);
        
        Ok(())
    }
}

/// Calculates position value with high-precision decimal arithmetic
#[inline]
fn calculate_position_value(size: Decimal, price: Decimal) -> Result<Decimal, ExecutionError> {
    size.checked_mul(price)
        .ok_or_else(|| ExecutionError::PositionError("position value calculation overflow".to_string()))
        .map(|value| value.round_dp_with_strategy(6, RoundingStrategy::MidpointAwayFromZero))
}

/// Validates position size against limits
#[inline]
fn validate_position_size(size: Decimal) -> Result<(), ExecutionError> {
    if size < MIN_POSITION_SIZE || size > MAX_POSITION_SIZE {
        return Err(ExecutionError::PositionError(
            format!("position size {} outside allowed range [{}, {}]",
                size, MIN_POSITION_SIZE, MAX_POSITION_SIZE)
        ));
    }
    Ok(())
}

/// Validates price value
#[inline]
fn validate_price(price: Decimal) -> Result<(), ExecutionError> {
    if price <= Decimal::ZERO {
        return Err(ExecutionError::PositionError("price must be positive".to_string()));
    }
    Ok(())
}

/// Calculates profit/loss percentage
#[inline]
fn calculate_pnl(entry_value: Decimal, current_value: Decimal) -> Decimal {
    if entry_value.is_zero() {
        return Decimal::ZERO;
    }
    ((current_value - entry_value) * Decimal::new(100, 0)) / entry_value
}

/// Calculates drawdown percentage
#[inline]
fn calculate_drawdown(peak_value: Decimal, current_value: Decimal) -> Decimal {
    if peak_value.is_zero() {
        return Decimal::ZERO;
    }
    ((peak_value - current_value) * Decimal::new(100, 0)) / peak_value
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_position_creation() {
        let position = Position::new(
            "SOL/USDC".to_string(),
            dec!(1.5),
            dec!(23.45),
        ).unwrap();
        
        assert_eq!(position.trading_pair, "SOL/USDC");
        assert_eq!(*position.size.read().await, dec!(1.5));
        assert_eq!(position.entry_price, dec!(23.45));
    }

    #[tokio::test]
    async fn test_position_update() {
        let mut position = Position::new(
            "SOL/USDC".to_string(),
            dec!(1.5),
            dec!(23.45),
        ).unwrap();

        position.update_position(dec!(2.0), dec!(24.00)).await.unwrap();
        
        assert_eq!(*position.size.read().await, dec!(2.0));
        assert_eq!(*position.current_price.read().await, dec!(24.00));
    }

    #[tokio::test]
    async fn test_emergency_closure() {
        let mut position = Position::new(
            "SOL/USDC".to_string(),
            dec!(1.5),
            dec!(100.00),
        ).unwrap();

        let result = position.update_position(dec!(1.5), dec!(75.00)).await;
        assert!(result.is_err());
        assert_eq!(*position.status.read().await, PositionStatus::EmergencyClosing);
    }
}