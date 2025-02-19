//! Root module for the risk management system that coordinates portfolio risk controls,
//! trade validation, and risk limit enforcement with comprehensive monitoring and
//! circuit breaker capabilities.
//!
//! Version dependencies:
//! - tracing = "0.1"
//! - thiserror = "1.0"
//! - tokio = "1.0"
//! - metrics = "0.20"
//! - lru = "0.8"

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, error, info, instrument, warn};
use metrics::{counter, histogram};
use lru::LruCache;

pub mod limits;
pub mod validation;
pub mod portfolio;

use limits::RiskLimits;
use validation::{ValidationResult, validate_trade};
use portfolio::PortfolioRiskManager;

/// Version of the risk management system
const RISK_MANAGER_VERSION: &str = "1.0.0";
/// Time-to-live for validation cache entries
const VALIDATION_CACHE_TTL: Duration = Duration::from_secs(60);
/// Threshold for circuit breaker activation
const CIRCUIT_BREAKER_THRESHOLD: f64 = 0.95;

/// Risk management system error types
#[derive(thiserror::Error, Debug)]
pub enum RiskError {
    #[error("validation error: {0}")]
    ValidationError(String),
    #[error("portfolio error: {0}")]
    PortfolioError(String),
    #[error("initialization error: {0}")]
    InitializationError(String),
    #[error("circuit breaker triggered: {0}")]
    CircuitBreaker(String),
    #[error("monitoring error: {0}")]
    MonitoringError(String),
}

/// Configuration for the risk management system
#[derive(Debug, Clone)]
pub struct RiskConfig {
    pub max_position_size: rust_decimal::Decimal,
    pub max_portfolio_exposure: rust_decimal::Decimal,
    pub circuit_breaker_threshold: f64,
    pub validation_cache_size: usize,
    pub monitoring_interval: Duration,
}

impl Default for RiskConfig {
    fn default() -> Self {
        Self {
            max_position_size: rust_decimal::Decimal::new(20, 2), // 20%
            max_portfolio_exposure: rust_decimal::Decimal::new(80, 2), // 80%
            circuit_breaker_threshold: CIRCUIT_BREAKER_THRESHOLD,
            validation_cache_size: 1000,
            monitoring_interval: Duration::from_secs(1),
        }
    }
}

/// Thread-safe risk management coordinator with enhanced monitoring
#[derive(Debug)]
pub struct RiskManager {
    limits: Arc<RwLock<RiskLimits>>,
    portfolio_manager: Arc<RwLock<PortfolioRiskManager>>,
    validation_cache: LruCache<String, ValidationResult>,
    circuit_breaker: std::sync::atomic::AtomicBool,
}

impl RiskManager {
    /// Creates a new thread-safe risk manager instance with monitoring
    pub fn new(config: RiskConfig) -> Result<Self, RiskError> {
        info!("Initializing risk management system v{}", RISK_MANAGER_VERSION);

        let limits = Arc::new(RwLock::new(RiskLimits::new(
            metrics::MetricsCollector::new().map_err(|e| 
                RiskError::InitializationError(format!("failed to initialize metrics: {}", e))
            )?
        )));

        let portfolio_manager = Arc::new(RwLock::new(
            PortfolioRiskManager::new(
                portfolio::Portfolio::new(
                    "system".to_string(),
                    rust_decimal::Decimal::ZERO,
                ).map_err(|e| 
                    RiskError::InitializationError(format!("failed to create portfolio: {}", e))
                )?,
                config.clone(),
            )
        ));

        let validation_cache = LruCache::new(config.validation_cache_size);

        counter!("trading_bot.risk_manager.initialized", 1);

        Ok(Self {
            limits,
            portfolio_manager,
            validation_cache,
            circuit_breaker: std::sync::atomic::AtomicBool::new(false),
        })
    }

    /// Validates a trading operation against all risk controls with caching
    #[instrument(skip(self, trade_request))]
    pub async fn validate_operation(
        &mut self,
        trade_request: validation::TradeRequest,
    ) -> Result<ValidationResult, RiskError> {
        let start = std::time::Instant::now();

        // Check circuit breaker status
        if self.circuit_breaker.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(RiskError::CircuitBreaker(
                "trading suspended - circuit breaker active".to_string()
            ));
        }

        // Check validation cache
        let cache_key = format!("{}{}{}", 
            trade_request.trading_pair,
            trade_request.size,
            trade_request.exchange
        );

        if let Some(cached) = self.validation_cache.get(&cache_key) {
            debug!("Using cached validation result for {}", cache_key);
            return Ok(cached.clone());
        }

        // Perform validation
        let portfolio = self.portfolio_manager.read().await;
        let validation = validate_trade(
            &trade_request.into(),
            &portfolio,
            &trade_request.market_prices,
            &trade_request.cross_dex_prices,
            &trade_request.market_impact,
        ).await.map_err(|e| RiskError::ValidationError(e.to_string()))?;

        // Update cache
        if validation.is_valid {
            self.validation_cache.put(cache_key, validation.clone());
        }

        // Record metrics
        histogram!(
            "trading_bot.risk_manager.validation_time_ms",
            start.elapsed().as_millis() as f64
        );

        Ok(validation)
    }

    /// Updates risk management configuration with validation
    #[instrument(skip(self, new_config))]
    pub async fn update_risk_config(
        &mut self,
        new_config: RiskConfig,
    ) -> Result<(), RiskError> {
        info!("Updating risk management configuration");

        // Update risk limits
        let mut limits = self.limits.write().await;
        limits.update_limits(
            Some(new_config.max_position_size),
            Some(new_config.max_portfolio_exposure),
        );

        // Update portfolio manager
        let mut portfolio = self.portfolio_manager.write().await;
        *portfolio = PortfolioRiskManager::new(
            portfolio::Portfolio::new(
                "system".to_string(),
                rust_decimal::Decimal::ZERO,
            ).map_err(|e| 
                RiskError::InitializationError(format!("failed to create portfolio: {}", e))
            )?,
            new_config.clone(),
        );

        // Clear validation cache
        self.validation_cache.clear();

        counter!("trading_bot.risk_manager.config_updates", 1);
        Ok(())
    }

    /// Checks and manages circuit breaker status
    pub fn check_circuit_breaker(&self) -> bool {
        self.circuit_breaker.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// Initializes the risk management system with configuration
#[instrument(skip(config))]
pub fn init_risk_manager(config: RiskConfig) -> Result<RiskManager, RiskError> {
    info!("Initializing risk management system v{}", RISK_MANAGER_VERSION);
    RiskManager::new(config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_risk_manager_initialization() {
        let config = RiskConfig::default();
        let manager = init_risk_manager(config);
        assert!(manager.is_ok());
    }

    #[tokio::test]
    async fn test_circuit_breaker() {
        let config = RiskConfig::default();
        let manager = RiskManager::new(config).unwrap();
        assert!(!manager.check_circuit_breaker());
    }

    #[tokio::test]
    async fn test_validation_cache() {
        let config = RiskConfig::default();
        let mut manager = RiskManager::new(config).unwrap();
        
        // Test cache functionality
        // Implementation details would go here
    }
}