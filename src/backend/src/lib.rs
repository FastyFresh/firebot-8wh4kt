//! Core library module for the AI-powered Solana trading bot that coordinates all major functionality
//! including execution engine, models, API interfaces, and trading components.
//! 
//! Version: 1.0.0

use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{error, info, instrument, warn};
use metrics::{counter, gauge, histogram};
use thiserror::Error;

// Re-export core components
pub use crate::models::{
    MarketData, Order, Portfolio, Strategy,
    market::validate_price,
    order::validate_order,
    portfolio::calculate_portfolio_value,
};
pub use crate::execution_engine::{
    ExecutionEngine, TradeExecutor,
    error::ExecutionError,
};
pub use crate::api::{init_api, ApiRouter};

// Global constants from specification
pub const VERSION: &str = "1.0.0";
pub const MAX_CONCURRENT_TRADES: usize = 100;
pub const CIRCUIT_BREAKER_THRESHOLD: f64 = 0.15;
pub const MAX_ERROR_RATE: f64 = 0.05;
pub const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(30);

/// Core trading bot error types
#[derive(Error, Debug)]
pub enum Error {
    #[error("execution error: {0}")]
    Execution(#[from] ExecutionError),
    
    #[error("initialization error: {0}")]
    Initialization(String),
    
    #[error("configuration error: {0}")]
    Configuration(String),
    
    #[error("system error: {0}")]
    System(String),
}

/// Main trading bot coordinator
#[derive(Debug)]
pub struct TradingBot {
    execution_engine: Arc<ExecutionEngine>,
    api_router: Arc<ApiRouter>,
    portfolio: Arc<RwLock<Portfolio>>,
    active_strategies: HashMap<String, Strategy>,
    metrics: Arc<MetricsCollector>,
    circuit_breaker: Arc<CircuitBreaker>,
    health_monitor: Arc<HealthMonitor>,
}

impl TradingBot {
    /// Creates new trading bot instance with all required components
    pub fn new(
        execution_engine: ExecutionEngine,
        api_router: ApiRouter,
        config: Config,
    ) -> Result<Self, Error> {
        // Initialize metrics collection
        let metrics = Arc::new(MetricsCollector::new()
            .map_err(|e| Error::Initialization(format!("Failed to initialize metrics: {}", e)))?);

        // Initialize circuit breaker
        let circuit_breaker = Arc::new(CircuitBreaker::new(
            CIRCUIT_BREAKER_THRESHOLD,
            MAX_ERROR_RATE,
        ));

        // Initialize health monitoring
        let health_monitor = Arc::new(HealthMonitor::new(
            HEALTH_CHECK_INTERVAL,
            metrics.clone(),
        ));

        // Create thread-safe components
        let bot = Self {
            execution_engine: Arc::new(execution_engine),
            api_router: Arc::new(api_router),
            portfolio: Arc::new(RwLock::new(Portfolio::new(
                config.wallet_address.clone(),
                config.initial_balance,
            )?)),
            active_strategies: HashMap::new(),
            metrics,
            circuit_breaker,
            health_monitor,
        };

        // Record initialization metrics
        counter!("trading_bot.initialization").increment(1);
        gauge!("trading_bot.version", VERSION.parse::<f64>().unwrap_or(1.0));

        Ok(bot)
    }

    /// Starts the trading bot and all its components
    #[instrument(err)]
    pub async fn start(&self) -> Result<(), Error> {
        info!("Starting Solana trading bot v{}", VERSION);
        
        // Start health monitoring
        self.health_monitor.start().await;

        // Initialize metrics collection
        self.metrics.initialize().await
            .map_err(|e| Error::Initialization(format!("Failed to initialize metrics: {}", e)))?;

        // Start execution engine
        self.execution_engine.start().await
            .map_err(|e| Error::System(format!("Failed to start execution engine: {}", e)))?;

        // Start API server
        self.api_router.start().await
            .map_err(|e| Error::System(format!("Failed to start API server: {}", e)))?;

        info!("Trading bot started successfully");
        Ok(())
    }

    /// Gracefully stops the trading bot and all components
    #[instrument(err)]
    pub async fn stop(&self) -> Result<(), Error> {
        info!("Initiating graceful shutdown");

        // Stop accepting new trades
        self.circuit_breaker.open();

        // Close all active positions
        let mut portfolio = self.portfolio.write().await;
        for (pair, position) in portfolio.positions.iter_mut() {
            if let Err(e) = position.close().await {
                warn!("Failed to close position for {}: {}", pair, e);
            }
        }

        // Stop execution engine
        self.execution_engine.stop().await
            .map_err(|e| Error::System(format!("Failed to stop execution engine: {}", e)))?;

        // Stop API server
        self.api_router.stop().await
            .map_err(|e| Error::System(format!("Failed to stop API server: {}", e)))?;

        // Stop health monitoring
        self.health_monitor.stop().await;

        // Record final metrics
        self.metrics.record_shutdown().await;

        info!("Trading bot shutdown completed");
        Ok(())
    }
}

/// Initializes the complete trading bot system
#[instrument(skip(config), err)]
pub fn init_trading_bot(config: Config) -> Result<TradingBot, Error> {
    // Validate configuration
    if config.initial_balance <= Decimal::ZERO {
        return Err(Error::Configuration("Invalid initial balance".to_string()));
    }

    // Initialize execution engine
    let execution_engine = ExecutionEngine::new(
        config.solana_client.clone(),
        config.execution_config,
    ).map_err(|e| Error::Initialization(format!("Failed to initialize execution engine: {}", e)))?;

    // Initialize API router
    let api_router = ApiRouter::new(config.api_config)
        .map_err(|e| Error::Initialization(format!("Failed to initialize API router: {}", e)))?;

    // Create and initialize trading bot
    TradingBot::new(execution_engine, api_router, config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_trading_bot_lifecycle() {
        let config = Config {
            wallet_address: "test_wallet".to_string(),
            initial_balance: dec!(1000.0),
            solana_client: Arc::new(SolanaClient::new_test()),
            execution_config: ExecutionConfig::default(),
            api_config: ApiConfig::default(),
        };

        let bot = init_trading_bot(config).expect("Failed to initialize trading bot");
        
        assert!(bot.start().await.is_ok());
        assert!(bot.stop().await.is_ok());
    }

    #[tokio::test]
    async fn test_circuit_breaker() {
        let config = Config::default();
        let bot = init_trading_bot(config).expect("Failed to initialize trading bot");
        
        // Simulate errors to trigger circuit breaker
        for _ in 0..100 {
            bot.circuit_breaker.record_error();
        }
        
        assert!(bot.circuit_breaker.is_open());
    }
}