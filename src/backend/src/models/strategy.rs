//! Core strategy models and types for AI-powered Solana trading bot with comprehensive
//! lifecycle management and performance tracking.
//!
//! Version dependencies:
//! - chrono = "0.4"
//! - rust_decimal = "1.30"
//! - uuid = "1.4"
//! - serde = "1.0"
//! - tokio = "1.28"

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::RoundingStrategy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::models::market::MarketData;
use crate::models::trade::Trade;

// Strategy configuration constants
const MIN_GRID_LEVELS: u32 = 5;
const MAX_GRID_LEVELS: u32 = 100;
const MIN_POSITION_SIZE_BPS: u32 = 100; // 1%
const MAX_POSITION_SIZE_BPS: u32 = 5000; // 50%
const PERFORMANCE_HISTORY_DAYS: i64 = 30;
const MIN_TRADE_INTERVAL_MS: u64 = 100;
const RISK_FREE_RATE_BPS: u32 = 200; // 2%

/// Strategy-related error types
#[derive(Error, Debug)]
pub enum StrategyError {
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error("execution error: {0}")]
    ExecutionError(String),
    #[error("performance error: {0}")]
    PerformanceError(String),
}

/// Supported strategy types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StrategyType {
    Grid,
    Arbitrage,
    MLBased,
}

/// Strategy lifecycle states
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StrategyState {
    Inactive,
    Active,
    Paused,
    Terminated,
}

/// Strategy configuration parameters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategyParams {
    pub position_size_bps: u32,
    pub grid_levels: Option<u32>,
    pub stop_loss_pct: Decimal,
    pub take_profit_pct: Decimal,
    pub max_slippage_bps: u32,
    pub exchanges: Vec<String>,
    pub risk_factor: Decimal,
}

/// Performance metrics for strategy evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceMetrics {
    pub total_trades: u32,
    pub win_rate: Decimal,
    pub profit_factor: Decimal,
    pub sharpe_ratio: Decimal,
    pub max_drawdown: Decimal,
    pub avg_trade_duration: i64,
    pub roi: Decimal,
}

/// Core strategy model with comprehensive lifecycle management
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Strategy {
    pub id: Uuid,
    pub strategy_type: StrategyType,
    pub parameters: StrategyParams,
    pub state: StrategyState,
    pub trading_pairs: Vec<String>,
    pub performance_score: Decimal,
    pub metrics: PerformanceMetrics,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    #[serde(skip)]
    trade_history: RwLock<Vec<Trade>>,
    pub risk_metrics: HashMap<String, Decimal>,
}

impl Strategy {
    /// Creates a new strategy instance with validated parameters
    pub fn new(
        strategy_type: StrategyType,
        parameters: StrategyParams,
        trading_pairs: Vec<String>,
    ) -> Result<Self, StrategyError> {
        // Validate strategy parameters
        validate_strategy_params(&parameters, None)?;

        Ok(Self {
            id: Uuid::new_v4(),
            strategy_type,
            parameters,
            state: StrategyState::Inactive,
            trading_pairs,
            performance_score: Decimal::ZERO,
            metrics: PerformanceMetrics {
                total_trades: 0,
                win_rate: Decimal::ZERO,
                profit_factor: Decimal::ONE,
                sharpe_ratio: Decimal::ZERO,
                max_drawdown: Decimal::ZERO,
                avg_trade_duration: 0,
                roi: Decimal::ZERO,
            },
            created_at: Utc::now(),
            updated_at: Utc::now(),
            trade_history: RwLock::new(Vec::new()),
            risk_metrics: HashMap::new(),
        })
    }

    /// Updates strategy performance metrics with new trade data
    pub async fn update_performance(&mut self, new_trades: Vec<Trade>) -> Result<PerformanceMetrics, StrategyError> {
        let mut trade_history = self.trade_history.write().await;
        trade_history.extend(new_trades);

        // Prune old trades beyond performance history window
        let cutoff = Utc::now() - chrono::Duration::days(PERFORMANCE_HISTORY_DAYS);
        trade_history.retain(|trade| trade.executed_at > cutoff);

        // Calculate performance metrics
        let metrics = calculate_risk_adjusted_returns(
            &trade_history,
            Decimal::new(RISK_FREE_RATE_BPS as i64, 4),
        )?;

        self.metrics = metrics.clone();
        self.updated_at = Utc::now();
        self.performance_score = calculate_performance_score(&metrics)?;

        Ok(metrics)
    }

    /// Executes strategy logic based on current market conditions
    pub async fn execute(&mut self, market_data: &MarketData) -> Result<Vec<Trade>, StrategyError> {
        if self.state != StrategyState::Active {
            return Err(StrategyError::ExecutionError(
                "strategy must be active to execute trades".to_string(),
            ));
        }

        // Validate market data freshness
        if !market_data.is_valid()? {
            return Err(StrategyError::ExecutionError("stale market data".to_string()));
        }

        let trades = match self.strategy_type {
            StrategyType::Grid => execute_grid_strategy(self, market_data)?,
            StrategyType::Arbitrage => execute_arbitrage_strategy(self, market_data)?,
            StrategyType::MLBased => execute_ml_strategy(self, market_data)?,
        };

        Ok(trades)
    }
}

/// Validates strategy parameters against defined constraints
#[tracing::instrument(skip(params, market_data))]
fn validate_strategy_params(
    params: &StrategyParams,
    market_data: Option<&MarketData>,
) -> Result<ValidationReport, StrategyError> {
    // Validate position size
    if params.position_size_bps < MIN_POSITION_SIZE_BPS || params.position_size_bps > MAX_POSITION_SIZE_BPS {
        return Err(StrategyError::ValidationError(format!(
            "position size must be between {} and {} bps",
            MIN_POSITION_SIZE_BPS, MAX_POSITION_SIZE_BPS
        )));
    }

    // Validate grid levels if applicable
    if let Some(levels) = params.grid_levels {
        if levels < MIN_GRID_LEVELS || levels > MAX_GRID_LEVELS {
            return Err(StrategyError::ValidationError(format!(
                "grid levels must be between {} and {}",
                MIN_GRID_LEVELS, MAX_GRID_LEVELS
            )));
        }
    }

    // Validate stop loss and take profit
    if params.stop_loss_pct >= Decimal::ZERO || params.take_profit_pct <= Decimal::ZERO {
        return Err(StrategyError::ValidationError(
            "invalid stop loss or take profit levels".to_string(),
        ));
    }

    Ok(ValidationReport {
        is_valid: true,
        warnings: Vec::new(),
    })
}

/// Calculates risk-adjusted performance metrics
fn calculate_risk_adjusted_returns(
    trades: &[Trade],
    risk_free_rate: Decimal,
) -> Result<PerformanceMetrics, StrategyError> {
    if trades.is_empty() {
        return Ok(PerformanceMetrics {
            total_trades: 0,
            win_rate: Decimal::ZERO,
            profit_factor: Decimal::ONE,
            sharpe_ratio: Decimal::ZERO,
            max_drawdown: Decimal::ZERO,
            avg_trade_duration: 0,
            roi: Decimal::ZERO,
        });
    }

    // Calculate basic metrics
    let total_trades = trades.len() as u32;
    let winning_trades = trades.iter().filter(|t| t.get_value().unwrap_or(Decimal::ZERO) > Decimal::ZERO).count();
    let win_rate = Decimal::new(winning_trades as i64 * 100, 2) / Decimal::new(total_trades as i64, 0);

    // Calculate returns and volatility
    let returns: Vec<Decimal> = trades.iter()
        .map(|t| t.get_value().unwrap_or(Decimal::ZERO))
        .collect();

    let roi = returns.iter().sum::<Decimal>() / Decimal::new(total_trades as i64, 0);
    let volatility = calculate_volatility(&returns)?;
    let sharpe_ratio = (roi - risk_free_rate) / volatility;

    Ok(PerformanceMetrics {
        total_trades,
        win_rate,
        profit_factor: calculate_profit_factor(&returns)?,
        sharpe_ratio,
        max_drawdown: calculate_max_drawdown(&returns)?,
        avg_trade_duration: calculate_avg_duration(trades),
        roi,
    })
}

/// Calculates overall strategy performance score
fn calculate_performance_score(metrics: &PerformanceMetrics) -> Result<Decimal, StrategyError> {
    let score = (metrics.sharpe_ratio * Decimal::new(4, 1))
        .checked_add(metrics.win_rate * Decimal::new(3, 1))
        .and_then(|s| s.checked_sub(metrics.max_drawdown * Decimal::new(2, 1)))
        .ok_or_else(|| StrategyError::PerformanceError("performance score calculation failed".to_string()))?;

    Ok(score.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero))
}

#[derive(Debug)]
struct ValidationReport {
    is_valid: bool,
    warnings: Vec<String>,
}

// Strategy-specific execution functions
fn execute_grid_strategy(strategy: &Strategy, market_data: &MarketData) -> Result<Vec<Trade>, StrategyError> {
    // Grid strategy implementation
    todo!("Implement grid strategy execution")
}

fn execute_arbitrage_strategy(strategy: &Strategy, market_data: &MarketData) -> Result<Vec<Trade>, StrategyError> {
    // Arbitrage strategy implementation
    todo!("Implement arbitrage strategy execution")
}

fn execute_ml_strategy(strategy: &Strategy, market_data: &MarketData) -> Result<Vec<Trade>, StrategyError> {
    // ML-based strategy implementation
    todo!("Implement ML strategy execution")
}

// Helper functions for performance calculations
fn calculate_volatility(returns: &[Decimal]) -> Result<Decimal, StrategyError> {
    // Volatility calculation implementation
    todo!("Implement volatility calculation")
}

fn calculate_profit_factor(returns: &[Decimal]) -> Result<Decimal, StrategyError> {
    // Profit factor calculation implementation
    todo!("Implement profit factor calculation")
}

fn calculate_max_drawdown(returns: &[Decimal]) -> Result<Decimal, StrategyError> {
    // Max drawdown calculation implementation
    todo!("Implement max drawdown calculation")
}

fn calculate_avg_duration(trades: &[Trade]) -> i64 {
    // Average duration calculation implementation
    todo!("Implement average duration calculation")
}