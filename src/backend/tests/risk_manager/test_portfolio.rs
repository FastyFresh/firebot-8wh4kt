use chrono::Utc;
use mockall::predicate::*;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use tokio::test;

use crate::models::portfolio::Portfolio;
use crate::risk_manager::portfolio::{
    PortfolioHealth, PortfolioRiskManager, RebalanceAction, RebalanceDirection, RiskError,
};
use crate::utils::metrics::MetricsCollector;

// Test constants
const INITIAL_BALANCE: Decimal = dec!(100000.00); // 100k USDC
const REBALANCE_THRESHOLD: Decimal = dec!(0.05); // 5%
const CIRCUIT_BREAKER_THRESHOLD: Decimal = dec!(0.25); // 25%
const PERFORMANCE_THRESHOLD_MS: u64 = 500; // 500ms latency requirement

/// Helper function to create a test portfolio with predefined positions
async fn setup_test_portfolio() -> Portfolio {
    let portfolio = Portfolio::new(
        "test_wallet".to_string(),
        INITIAL_BALANCE,
    ).unwrap();

    // Add test positions
    portfolio.add_position(
        "SOL/USDC".to_string(),
        dec!(100.00),
        dec!(22.50),
    ).await.unwrap();

    portfolio.add_position(
        "ORCA/USDC".to_string(),
        dec!(1000.00),
        dec!(1.20),
    ).await.unwrap();

    portfolio
}

/// Helper function to create mock market data
fn setup_mock_market_data() -> HashMap<String, Decimal> {
    let mut market_data = HashMap::new();
    market_data.insert("SOL/USDC".to_string(), dec!(23.10));
    market_data.insert("ORCA/USDC".to_string(), dec!(1.25));
    market_data
}

#[tokio::test]
async fn test_portfolio_health_check() {
    let portfolio = setup_test_portfolio().await;
    let market_data = setup_mock_market_data();
    let metrics = MetricsCollector::new().unwrap();
    
    let risk_manager = PortfolioRiskManager::new(
        portfolio,
        RiskConfig {
            metrics,
            target_allocations: HashMap::new(),
        },
    );

    let start = Instant::now();
    let health = risk_manager.check_portfolio_health(&market_data).await.unwrap();

    // Verify performance
    assert!(
        start.elapsed().as_millis() < PERFORMANCE_THRESHOLD_MS as u128,
        "Health check exceeded latency threshold"
    );

    // Verify health metrics
    assert!(health.is_healthy);
    assert!(!health.circuit_breaker_active);
    assert!(health.drawdown < dec!(0.20)); // 20% max drawdown
    assert!(health.total_value > INITIAL_BALANCE);
}

#[tokio::test]
async fn test_concurrent_risk_validation() {
    let portfolio = setup_test_portfolio().await;
    let metrics = MetricsCollector::new().unwrap();
    
    let risk_manager = PortfolioRiskManager::new(
        portfolio,
        RiskConfig {
            metrics,
            target_allocations: HashMap::new(),
        },
    );

    // Create multiple concurrent trade requests
    let trade_requests = vec![
        TradeRequest {
            trading_pair: "SOL/USDC".to_string(),
            size: dec!(10.00),
            price: dec!(23.10),
        },
        TradeRequest {
            trading_pair: "ORCA/USDC".to_string(),
            size: dec!(100.00),
            price: dec!(1.25),
        },
    ];

    let start = Instant::now();
    
    // Execute validations concurrently
    let validation_results = futures::future::join_all(
        trade_requests.iter().map(|req| risk_manager.validate_trade_risk(req.clone()))
    ).await;

    // Verify performance
    assert!(
        start.elapsed().as_millis() < PERFORMANCE_THRESHOLD_MS as u128,
        "Concurrent validation exceeded latency threshold"
    );

    // Verify results
    for result in validation_results {
        assert!(result.is_ok());
        let validation = result.unwrap();
        assert!(validation.is_valid);
    }
}

#[tokio::test]
async fn test_rebalancing_calculation() {
    let portfolio = setup_test_portfolio().await;
    let metrics = MetricsCollector::new().unwrap();
    
    // Set target allocations
    let mut target_allocations = HashMap::new();
    target_allocations.insert("SOL/USDC".to_string(), dec!(0.40)); // 40%
    target_allocations.insert("ORCA/USDC".to_string(), dec!(0.30)); // 30%

    let risk_manager = PortfolioRiskManager::new(
        portfolio,
        RiskConfig {
            metrics,
            target_allocations: target_allocations.clone(),
        },
    );

    let start = Instant::now();
    let rebalance_actions = risk_manager
        .calculate_rebalance_requirements(&target_allocations)
        .await
        .unwrap();

    // Verify performance
    assert!(
        start.elapsed().as_millis() < PERFORMANCE_THRESHOLD_MS as u128,
        "Rebalancing calculation exceeded latency threshold"
    );

    // Verify rebalancing actions
    assert!(!rebalance_actions.is_empty());
    for action in rebalance_actions {
        assert!(action.size > Decimal::ZERO);
        assert!(target_allocations.contains_key(&action.trading_pair));
    }
}

#[tokio::test]
async fn test_circuit_breaker_conditions() {
    let mut portfolio = setup_test_portfolio().await;
    let metrics = MetricsCollector::new().unwrap();
    
    let risk_manager = PortfolioRiskManager::new(
        portfolio.clone(),
        RiskConfig {
            metrics,
            target_allocations: HashMap::new(),
        },
    );

    // Simulate significant drawdown
    portfolio.update_balance(INITIAL_BALANCE * dec!(0.70)).await.unwrap(); // 30% drawdown

    let result = risk_manager.monitor_portfolio().await;
    assert!(matches!(result, Err(RiskError::CircuitBreaker(_))));

    // Verify circuit breaker activation
    let health = risk_manager.check_portfolio_health(&HashMap::new()).await.unwrap();
    assert!(health.circuit_breaker_active);
    assert!(!health.is_healthy);
}

#[tokio::test]
async fn test_risk_metrics_validation() {
    let portfolio = setup_test_portfolio().await;
    let market_data = setup_mock_market_data();
    let metrics = MetricsCollector::new().unwrap();
    
    let risk_manager = PortfolioRiskManager::new(
        portfolio,
        RiskConfig {
            metrics,
            target_allocations: HashMap::new(),
        },
    );

    let health = risk_manager.check_portfolio_health(&market_data).await.unwrap();

    // Verify risk metrics
    assert!(health.concentration < dec!(0.40)); // Max 40% concentration
    assert!(health.volatility < dec!(0.30)); // Max 30% volatility
    assert!(health.leverage < dec!(3.00)); // Max 3x leverage
}

#[tokio::test]
async fn test_performance_under_load() {
    let portfolio = setup_test_portfolio().await;
    let metrics = MetricsCollector::new().unwrap();
    
    let risk_manager = PortfolioRiskManager::new(
        portfolio,
        RiskConfig {
            metrics,
            target_allocations: HashMap::new(),
        },
    );

    let start = Instant::now();

    // Execute multiple operations concurrently
    let operations = futures::future::join_all(vec![
        risk_manager.check_portfolio_health(&setup_mock_market_data()),
        risk_manager.validate_trade_risk(TradeRequest {
            trading_pair: "SOL/USDC".to_string(),
            size: dec!(10.00),
            price: dec!(23.10),
        }),
        risk_manager.calculate_rebalance_requirements(&HashMap::new()),
    ]).await;

    // Verify overall performance
    assert!(
        start.elapsed().as_millis() < PERFORMANCE_THRESHOLD_MS as u128,
        "Combined operations exceeded latency threshold"
    );

    // Verify all operations succeeded
    for result in operations {
        assert!(result.is_ok());
    }
}