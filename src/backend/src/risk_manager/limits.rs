//! Risk limits and constraints implementation for the Solana trading bot with
//! high-performance validation and monitoring capabilities.
//!
//! Version dependencies:
//! - rust_decimal = "1.30"
//! - thiserror = "1.0"
//! - tracing = "0.1"
//! - tokio = "1.28"
//! - parking_lot = "0.12"
//! - cached = "0.42"

use cached::proc_macro::cached;
use parking_lot::RwLock;
use rust_decimal::Decimal;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use thiserror::Error;
use tokio::time::timeout;
use tracing::{debug, error, info, instrument, warn};

use crate::models::portfolio::Portfolio;
use crate::utils::metrics::MetricsCollector;

// Global risk limits with thread-safe access
static MAX_POSITION_SIZE_PERCENT: Decimal = Decimal::new(20, 2); // 20%
static MAX_PORTFOLIO_EXPOSURE: Decimal = Decimal::new(80, 2); // 80%
static MIN_TRADE_INTERVAL_MS: u64 = 500;
static VALIDATION_CACHE_TTL_MS: u64 = 100;
static CIRCUIT_BREAKER_THRESHOLD: Decimal = Decimal::new(95, 2); // 95%

/// Risk-related error types
#[derive(Error, Debug)]
pub enum RiskError {
    #[error("position limit exceeded: {0}")]
    PositionLimitExceeded(String),
    #[error("portfolio exposure limit exceeded: {0}")]
    ExposureLimitExceeded(String),
    #[error("validation timeout: {0}")]
    ValidationTimeout(String),
    #[error("circuit breaker triggered: {0}")]
    CircuitBreakerTriggered(String),
    #[error("rate limit exceeded: {0}")]
    RateLimitExceeded(String),
}

/// Validation result with performance metrics
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub is_valid: bool,
    pub validation_time_ms: u64,
    pub current_exposure: Decimal,
    pub new_exposure: Decimal,
}

/// Circuit breaker for risk management
#[derive(Debug)]
struct CircuitBreaker {
    triggered: AtomicU64,
    last_reset: RwLock<Instant>,
    threshold: Decimal,
}

impl CircuitBreaker {
    fn new(threshold: Decimal) -> Self {
        Self {
            triggered: AtomicU64::new(0),
            last_reset: RwLock::new(Instant::now()),
            threshold,
        }
    }

    fn check(&self, exposure: Decimal) -> bool {
        if exposure >= self.threshold {
            self.triggered.fetch_add(1, Ordering::SeqCst);
            true
        } else {
            false
        }
    }

    fn reset(&self) {
        self.triggered.store(0, Ordering::SeqCst);
        *self.last_reset.write() = Instant::now();
    }
}

/// Thread-safe risk limits manager with enhanced monitoring
#[derive(Debug, Clone)]
pub struct RiskLimits {
    max_position_size: RwLock<Decimal>,
    max_portfolio_exposure: RwLock<Decimal>,
    min_trade_interval: AtomicU64,
    metrics: MetricsCollector,
    breaker: CircuitBreaker,
}

impl RiskLimits {
    /// Creates a new RiskLimits instance with monitoring setup
    pub fn new(metrics: MetricsCollector) -> Self {
        let instance = Self {
            max_position_size: RwLock::new(MAX_POSITION_SIZE_PERCENT),
            max_portfolio_exposure: RwLock::new(MAX_PORTFOLIO_EXPOSURE),
            min_trade_interval: AtomicU64::new(MIN_TRADE_INTERVAL_MS),
            metrics,
            breaker: CircuitBreaker::new(CIRCUIT_BREAKER_THRESHOLD),
        };

        info!("Risk limits initialized with max position size: {}%, max exposure: {}%",
            MAX_POSITION_SIZE_PERCENT, MAX_PORTFOLIO_EXPOSURE);

        instance
    }

    /// Validates trade against position limits with caching
    #[cached(
        time = 100,
        key = "String",
        convert = r#"{ format!("{}{}{}", portfolio.id, trade_size, trading_pair) }"#
    )]
    #[instrument(skip(self, portfolio))]
    pub async fn validate_position_limits(
        &self,
        portfolio: &Portfolio,
        trade_size: Decimal,
        trading_pair: String,
    ) -> Result<ValidationResult, RiskError> {
        let start = Instant::now();

        // Check circuit breaker
        let current_exposure = timeout(
            Duration::from_millis(VALIDATION_CACHE_TTL_MS),
            portfolio.calculate_portfolio_value(&Default::default())
        ).await.map_err(|_| RiskError::ValidationTimeout("portfolio value calculation timeout".into()))??;

        if self.breaker.check(current_exposure) {
            error!("Circuit breaker triggered at {}% exposure", current_exposure);
            return Err(RiskError::CircuitBreakerTriggered(
                format!("current exposure: {}%", current_exposure)
            ));
        }

        // Validate position size
        let max_position_size = *self.max_position_size.read();
        let position_percentage = (trade_size * Decimal::new(100, 0)) / current_exposure;

        if position_percentage > max_position_size {
            warn!(
                "Position size {}% exceeds limit of {}%",
                position_percentage, max_position_size
            );
            return Err(RiskError::PositionLimitExceeded(
                format!("size {}% exceeds {}%", position_percentage, max_position_size)
            ));
        }

        // Calculate new exposure
        let new_exposure = current_exposure + trade_size;
        let max_exposure = *self.max_portfolio_exposure.read();

        if new_exposure > max_exposure {
            warn!(
                "New exposure {}% exceeds limit of {}%",
                new_exposure, max_exposure
            );
            return Err(RiskError::ExposureLimitExceeded(
                format!("exposure {}% exceeds {}%", new_exposure, max_exposure)
            ));
        }

        let validation_time = start.elapsed().as_millis() as u64;
        
        // Record metrics
        self.metrics.record_validation_latency(validation_time).await?;

        debug!(
            "Position validation completed in {}ms: {}% exposure",
            validation_time, new_exposure
        );

        Ok(ValidationResult {
            is_valid: true,
            validation_time_ms: validation_time,
            current_exposure,
            new_exposure,
        })
    }

    /// Updates risk limits with thread safety
    pub fn update_limits(
        &self,
        new_position_size: Option<Decimal>,
        new_portfolio_exposure: Option<Decimal>,
    ) {
        if let Some(size) = new_position_size {
            *self.max_position_size.write() = size;
        }
        if let Some(exposure) = new_portfolio_exposure {
            *self.max_portfolio_exposure.write() = exposure;
        }
        
        info!(
            "Risk limits updated - position: {}%, exposure: {}%",
            self.max_position_size.read(),
            self.max_portfolio_exposure.read()
        );
    }

    /// Asynchronous trade validation with performance optimization
    #[instrument(skip(self, portfolio))]
    pub async fn validate_trade_async(
        &self,
        portfolio: &Portfolio,
        trade_size: Decimal,
        trading_pair: String,
    ) -> Result<ValidationResult, RiskError> {
        let start = Instant::now();

        // Enforce minimum trade interval
        let min_interval = self.min_trade_interval.load(Ordering::Relaxed);
        if start.elapsed().as_millis() as u64 < min_interval {
            return Err(RiskError::RateLimitExceeded(
                format!("minimum interval {}ms not elapsed", min_interval)
            ));
        }

        // Perform validation
        let result = self.validate_position_limits(portfolio, trade_size, trading_pair).await?;

        // Record performance metrics
        self.metrics.record_strategy_performance(
            "risk_validation".into(),
            result.current_exposure.to_f64().unwrap_or(0.0),
            result.new_exposure.to_f64().unwrap_or(0.0),
            100.0,
        ).await?;

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_risk_limits_validation() {
        let metrics = MetricsCollector::new().unwrap();
        let limits = RiskLimits::new(metrics);
        
        let portfolio = Portfolio::new(
            "test_wallet".to_string(),
            dec!(1000.00),
        ).unwrap();

        let result = limits.validate_trade_async(
            &portfolio,
            dec!(100.00),
            "SOL/USDC".to_string(),
        ).await;
        
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_circuit_breaker() {
        let metrics = MetricsCollector::new().unwrap();
        let limits = RiskLimits::new(metrics);
        
        let portfolio = Portfolio::new(
            "test_wallet".to_string(),
            dec!(1000.00),
        ).unwrap();

        // Test with exposure above circuit breaker threshold
        let result = limits.validate_trade_async(
            &portfolio,
            dec!(960.00),
            "SOL/USDC".to_string(),
        ).await;
        
        assert!(matches!(result, Err(RiskError::CircuitBreakerTriggered(_))));
    }
}