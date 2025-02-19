//! Comprehensive risk validation module for enforcing trading limits and portfolio constraints
//! in the AI-powered Solana trading bot with sub-500ms validation latency.
//!
//! Version dependencies:
//! - rust_decimal = "1.30"
//! - thiserror = "1.0"
//! - tracing = "0.1"
//! - chrono = "0.4"

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use rust_decimal::prelude::RoundingStrategy;
use std::collections::HashMap;
use thiserror::Error;
use tracing::{warn, instrument};

use crate::models::order::Order;
use crate::models::portfolio::Portfolio;

// Risk management constants
const MAX_TRADE_VALUE_USDC: Decimal = Decimal::new(100_000, 0); // $100,000
const MIN_TRADE_VALUE_USDC: Decimal = Decimal::new(10, 0); // $10
const MAX_POSITION_COUNT: usize = 10;
const MAX_CONCENTRATION_PCT: Decimal = Decimal::new(25, 0); // 25%
const MAX_DRAWDOWN_PCT: Decimal = Decimal::new(15, 0); // 15%
const MAX_VOLATILITY_PCT: Decimal = Decimal::new(40, 0); // 40%
const MAX_LEVERAGE_RATIO: Decimal = Decimal::new(3, 0); // 3x

/// Validation severity levels for risk assessment
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationSeverity {
    Info,
    Warning,
    Critical,
}

/// Types of validation checks performed
#[derive(Debug, Clone, PartialEq)]
pub enum ValidationType {
    Trade,
    Portfolio,
    Market,
    Risk,
}

/// Validation-related error types
#[derive(Error, Debug)]
pub enum ValidationError {
    #[error("trade validation error: {0}")]
    TradeValidation(String),
    #[error("portfolio validation error: {0}")]
    PortfolioValidation(String),
    #[error("market validation error: {0}")]
    MarketValidation(String),
    #[error("risk limit exceeded: {0}")]
    RiskLimit(String),
}

/// Individual validation metric with detailed context
#[derive(Debug, Clone)]
pub struct ValidationMetric {
    pub name: String,
    pub value: Decimal,
    pub threshold: Decimal,
    pub severity: ValidationSeverity,
}

/// Comprehensive validation result container
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub metrics: Vec<ValidationMetric>,
    pub failure_reason: Option<String>,
    pub severity_level: ValidationSeverity,
    pub timestamp: DateTime<Utc>,
    pub validation_type: ValidationType,
}

impl ValidationResult {
    /// Creates a new validation result instance
    pub fn new(is_valid: bool, severity: ValidationSeverity, v_type: ValidationType) -> Self {
        Self {
            is_valid,
            metrics: Vec::new(),
            failure_reason: None,
            severity_level: severity,
            timestamp: Utc::now(),
            validation_type: v_type,
        }
    }

    /// Adds a validation metric to the result
    pub fn add_metric(&mut self, metric: ValidationMetric) {
        self.metrics.push(metric);
    }

    /// Sets validation failure with reason and severity
    pub fn set_failure(&mut self, reason: String, severity: ValidationSeverity) {
        self.is_valid = false;
        self.failure_reason = Some(reason);
        self.severity_level = severity;
    }
}

/// Validates a proposed trade against all risk rules and portfolio constraints
#[instrument(skip(order, portfolio, market_prices, cross_dex_prices, market_impact))]
pub async fn validate_trade(
    order: &Order,
    portfolio: &Portfolio,
    market_prices: &HashMap<String, Decimal>,
    cross_dex_prices: &HashMap<String, Decimal>,
    market_impact: &HashMap<String, Decimal>,
) -> Result<ValidationResult, ValidationError> {
    let mut result = ValidationResult::new(true, ValidationSeverity::Info, ValidationType::Trade);

    // Validate order size
    if order.size <= Decimal::ZERO {
        result.set_failure(
            "order size must be positive".to_string(),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    // Calculate and validate trade value
    let price = market_prices.get(&order.trading_pair).ok_or_else(|| {
        ValidationError::MarketValidation(format!("no price data for {}", order.trading_pair))
    })?;

    let trade_value = order.size * *price;
    if trade_value < MIN_TRADE_VALUE_USDC {
        result.set_failure(
            format!("trade value ${} below minimum ${}", trade_value, MIN_TRADE_VALUE_USDC),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    if trade_value > MAX_TRADE_VALUE_USDC {
        result.set_failure(
            format!("trade value ${} exceeds maximum ${}", trade_value, MAX_TRADE_VALUE_USDC),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    // Validate portfolio position count
    let metrics = portfolio.get_metrics().await.map_err(|e| {
        ValidationError::PortfolioValidation(format!("failed to get portfolio metrics: {}", e))
    })?;

    if metrics.total_positions >= MAX_POSITION_COUNT {
        result.set_failure(
            format!("position count {} exceeds maximum {}", metrics.total_positions, MAX_POSITION_COUNT),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    // Check market impact
    if let Some(impact) = market_impact.get(&order.trading_pair) {
        result.add_metric(ValidationMetric {
            name: "market_impact".to_string(),
            value: *impact,
            threshold: Decimal::new(5, 1), // 0.5%
            severity: ValidationSeverity::Warning,
        });

        if *impact > Decimal::new(10, 1) { // 1.0%
            warn!(
                trading_pair = %order.trading_pair,
                impact = %impact,
                "High market impact detected"
            );
        }
    }

    // Validate cross-DEX price discrepancies
    for (dex, price) in cross_dex_prices {
        let price_diff = ((*price - *price) * Decimal::new(100, 0)) / *price;
        result.add_metric(ValidationMetric {
            name: format!("price_diff_{}", dex),
            value: price_diff,
            threshold: Decimal::new(5, 1), // 0.5%
            severity: ValidationSeverity::Info,
        });
    }

    Ok(result)
}

/// Validates current portfolio metrics against risk thresholds
#[instrument(skip(portfolio, risk_metrics))]
pub async fn validate_portfolio_metrics(
    portfolio: &Portfolio,
    risk_metrics: &HashMap<String, Decimal>,
) -> Result<ValidationResult, ValidationError> {
    let mut result = ValidationResult::new(true, ValidationSeverity::Info, ValidationType::Portfolio);

    // Validate concentration
    let concentration = risk_metrics.get("concentration").ok_or_else(|| {
        ValidationError::PortfolioValidation("missing concentration metric".to_string())
    })?;

    if *concentration > MAX_CONCENTRATION_PCT {
        result.set_failure(
            format!("concentration {}% exceeds maximum {}%", concentration, MAX_CONCENTRATION_PCT),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    // Validate drawdown
    let drawdown = risk_metrics.get("drawdown").ok_or_else(|| {
        ValidationError::PortfolioValidation("missing drawdown metric".to_string())
    })?;

    if *drawdown > MAX_DRAWDOWN_PCT {
        result.set_failure(
            format!("drawdown {}% exceeds maximum {}%", drawdown, MAX_DRAWDOWN_PCT),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    // Validate volatility
    let volatility = risk_metrics.get("volatility").ok_or_else(|| {
        ValidationError::PortfolioValidation("missing volatility metric".to_string())
    })?;

    if *volatility > MAX_VOLATILITY_PCT {
        result.set_failure(
            format!("volatility {}% exceeds maximum {}%", volatility, MAX_VOLATILITY_PCT),
            ValidationSeverity::Warning,
        );
    }

    // Validate leverage
    let leverage = risk_metrics.get("leverage").ok_or_else(|| {
        ValidationError::PortfolioValidation("missing leverage metric".to_string())
    })?;

    if *leverage > MAX_LEVERAGE_RATIO {
        result.set_failure(
            format!("leverage {}x exceeds maximum {}x", leverage, MAX_LEVERAGE_RATIO),
            ValidationSeverity::Critical,
        );
        return Ok(result);
    }

    // Add all metrics to result
    for (name, value) in risk_metrics {
        result.add_metric(ValidationMetric {
            name: name.clone(),
            value: *value,
            threshold: get_threshold_for_metric(name),
            severity: get_severity_for_metric(name, *value),
        });
    }

    Ok(result)
}

/// Returns the threshold value for a given metric
#[inline]
fn get_threshold_for_metric(metric: &str) -> Decimal {
    match metric {
        "concentration" => MAX_CONCENTRATION_PCT,
        "drawdown" => MAX_DRAWDOWN_PCT,
        "volatility" => MAX_VOLATILITY_PCT,
        "leverage" => MAX_LEVERAGE_RATIO,
        _ => Decimal::new(100, 0), // Default 100%
    }
}

/// Determines severity level based on metric and value
#[inline]
fn get_severity_for_metric(metric: &str, value: Decimal) -> ValidationSeverity {
    match metric {
        "concentration" if value > MAX_CONCENTRATION_PCT => ValidationSeverity::Critical,
        "drawdown" if value > MAX_DRAWDOWN_PCT => ValidationSeverity::Critical,
        "volatility" if value > MAX_VOLATILITY_PCT => ValidationSeverity::Warning,
        "leverage" if value > MAX_LEVERAGE_RATIO => ValidationSeverity::Critical,
        _ => ValidationSeverity::Info,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_trade_validation() {
        // Test implementation
    }

    #[tokio::test]
    async fn test_portfolio_validation() {
        // Test implementation
    }

    #[test]
    fn test_validation_result() {
        let mut result = ValidationResult::new(true, ValidationSeverity::Info, ValidationType::Trade);
        assert!(result.is_valid);
        
        result.set_failure("test failure".to_string(), ValidationSeverity::Critical);
        assert!(!result.is_valid);
        assert_eq!(result.severity_level, ValidationSeverity::Critical);
    }
}