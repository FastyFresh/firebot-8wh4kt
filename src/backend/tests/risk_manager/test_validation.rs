use chrono::Utc;
use mockall::predicate::*;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use std::collections::HashMap;
use std::error::Error;
use std::sync::Arc;
use tokio::time::{Duration, Instant};

use crate::models::order::{Order, OrderType};
use crate::models::portfolio::{Portfolio, PortfolioError};
use crate::models::market::{MarketData, OrderBook, OrderBookLevel};
use crate::risk_manager::validation::{
    validate_trade, validate_portfolio_metrics, ValidationResult, ValidationSeverity, ValidationType,
};

// Mock DEX connector for testing
mock! {
    DEXConnector {
        fn get_market_data(&self, trading_pair: &str) -> Result<MarketData, Box<dyn Error>>;
        fn get_order_book(&self, trading_pair: &str) -> Result<OrderBook, Box<dyn Error>>;
    }
}

/// Test context with comprehensive mock data management
struct TestContext {
    portfolio: Portfolio,
    market_prices: HashMap<String, Decimal>,
    dex_connector: MockDEXConnector,
    metrics_cache: HashMap<String, Decimal>,
}

impl TestContext {
    async fn new() -> Result<Self, Box<dyn Error>> {
        // Initialize portfolio with test data
        let portfolio = Portfolio::new(
            "test_wallet".to_string(),
            dec!(10000.00), // 10,000 USDC initial balance
        )?;

        // Set up market prices
        let mut market_prices = HashMap::new();
        market_prices.insert("SOL/USDC".to_string(), dec!(23.45));
        market_prices.insert("ORCA/USDC".to_string(), dec!(1.23));
        market_prices.insert("RAY/USDC".to_string(), dec!(0.85));

        // Configure mock DEX connector
        let mut dex_connector = MockDEXConnector::new();
        dex_connector
            .expect_get_market_data()
            .returning(|trading_pair| {
                Ok(MarketData::new(
                    trading_pair.to_string(),
                    "jupiter".to_string(),
                    dec!(23.45),
                    dec!(100000.00),
                )?)
            });

        // Initialize metrics cache
        let mut metrics_cache = HashMap::new();
        metrics_cache.insert("concentration".to_string(), dec!(15.00));
        metrics_cache.insert("drawdown".to_string(), dec!(5.00));
        metrics_cache.insert("volatility".to_string(), dec!(25.00));
        metrics_cache.insert("leverage".to_string(), dec!(1.50));

        Ok(Self {
            portfolio,
            market_prices,
            dex_connector,
            metrics_cache,
        })
    }

    async fn setup_portfolio_with_positions(
        &mut self,
        positions: Vec<(String, Decimal, Decimal)>,
    ) -> Result<(), Box<dyn Error>> {
        for (trading_pair, size, entry_price) in positions {
            self.portfolio.add_position(trading_pair, size, entry_price).await?;
        }
        Ok(())
    }
}

#[tokio::test]
#[tracing_test::traced_test]
#[timeout(1000)]
async fn test_validate_trade_size_limits() -> Result<(), Box<dyn Error>> {
    let mut ctx = TestContext::new().await?;

    // Set up test portfolio with initial position
    ctx.setup_portfolio_with_positions(vec![
        ("SOL/USDC".to_string(), dec!(10.00), dec!(23.45)),
    ]).await?;

    // Test trade above size limit (expect failure)
    let large_order = Order::new(
        "SOL/USDC".to_string(),
        "jupiter".to_string(),
        OrderType::Market,
        dec!(23.45),
        dec!(5000.00), // Very large order
    )?;

    let start = Instant::now();
    let result = validate_trade(
        &large_order,
        &ctx.portfolio,
        &ctx.market_prices,
        &HashMap::new(), // Cross-DEX prices
        &HashMap::new(), // Market impact
    ).await?;

    // Verify execution time
    assert!(start.elapsed() < Duration::from_millis(500), "Validation exceeded 500ms latency requirement");

    // Verify validation failure
    assert!(!result.is_valid);
    assert_eq!(result.severity_level, ValidationSeverity::Critical);
    assert!(result.failure_reason.unwrap().contains("trade value"));

    // Test valid trade size
    let valid_order = Order::new(
        "SOL/USDC".to_string(),
        "jupiter".to_string(),
        OrderType::Market,
        dec!(23.45),
        dec!(10.00),
    )?;

    let result = validate_trade(
        &valid_order,
        &ctx.portfolio,
        &ctx.market_prices,
        &HashMap::new(),
        &HashMap::new(),
    ).await?;

    assert!(result.is_valid);

    Ok(())
}

#[tokio::test]
#[tracing_test::traced_test]
#[timeout(1000)]
async fn test_validate_portfolio_exposure() -> Result<(), Box<dyn Error>> {
    let mut ctx = TestContext::new().await?;

    // Set up diverse portfolio positions
    ctx.setup_portfolio_with_positions(vec![
        ("SOL/USDC".to_string(), dec!(100.00), dec!(23.45)),
        ("ORCA/USDC".to_string(), dec!(1000.00), dec!(1.23)),
        ("RAY/USDC".to_string(), dec!(500.00), dec!(0.85)),
    ]).await?;

    // Test concurrent position validation
    let start = Instant::now();
    let result = validate_portfolio_metrics(
        &ctx.portfolio,
        &ctx.metrics_cache,
    ).await?;

    // Verify performance
    assert!(start.elapsed() < Duration::from_millis(500));

    // Verify exposure validation
    assert!(result.is_valid);
    assert!(result.metrics.iter().any(|m| m.name == "concentration"));

    // Test exposure with high concentration
    ctx.metrics_cache.insert("concentration".to_string(), dec!(30.00)); // Above 25% limit

    let result = validate_portfolio_metrics(
        &ctx.portfolio,
        &ctx.metrics_cache,
    ).await?;

    assert!(!result.is_valid);
    assert_eq!(result.severity_level, ValidationSeverity::Critical);

    Ok(())
}

#[tokio::test]
#[tracing_test::traced_test]
#[timeout(1000)]
async fn test_validate_portfolio_metrics() -> Result<(), Box<dyn Error>> {
    let mut ctx = TestContext::new().await?;

    // Test drawdown limit validation
    ctx.metrics_cache.insert("drawdown".to_string(), dec!(20.00)); // Above 15% limit

    let result = validate_portfolio_metrics(
        &ctx.portfolio,
        &ctx.metrics_cache,
    ).await?;

    assert!(!result.is_valid);
    assert_eq!(result.severity_level, ValidationSeverity::Critical);
    assert!(result.failure_reason.unwrap().contains("drawdown"));

    // Test volatility threshold
    ctx.metrics_cache.insert("drawdown".to_string(), dec!(10.00)); // Reset drawdown
    ctx.metrics_cache.insert("volatility".to_string(), dec!(45.00)); // Above 40% limit

    let result = validate_portfolio_metrics(
        &ctx.portfolio,
        &ctx.metrics_cache,
    ).await?;

    assert!(!result.is_valid);
    assert_eq!(result.severity_level, ValidationSeverity::Warning);
    assert!(result.failure_reason.unwrap().contains("volatility"));

    // Test leverage limits
    ctx.metrics_cache.insert("volatility".to_string(), dec!(25.00)); // Reset volatility
    ctx.metrics_cache.insert("leverage".to_string(), dec!(4.00)); // Above 3x limit

    let result = validate_portfolio_metrics(
        &ctx.portfolio,
        &ctx.metrics_cache,
    ).await?;

    assert!(!result.is_valid);
    assert_eq!(result.severity_level, ValidationSeverity::Critical);
    assert!(result.failure_reason.unwrap().contains("leverage"));

    Ok(())
}