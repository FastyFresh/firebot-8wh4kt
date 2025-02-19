use criterion::{criterion_group, criterion_main, Criterion};
use mockall::predicate::*;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use tokio::sync::RwLock;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::models::portfolio::Portfolio;
use crate::risk_manager::limits::{RiskLimits, RiskError, ValidationResult};
use crate::utils::metrics::MetricsCollector;

// Constants for test configuration
const TEST_WALLET: &str = "test_wallet";
const TEST_TRADING_PAIR: &str = "SOL/USDC";
const LATENCY_THRESHOLD_MS: u64 = 500;
const CONCURRENT_TESTS: usize = 10;

/// Sets up a test portfolio with predefined positions and balances
async fn setup_test_portfolio(initial_balance: Decimal) -> Portfolio {
    Portfolio::new(
        TEST_WALLET.to_string(),
        initial_balance,
    ).expect("Failed to create test portfolio")
}

/// Sets up risk limits with monitoring for testing
async fn setup_risk_limits() -> RiskLimits {
    let metrics = MetricsCollector::new()
        .expect("Failed to initialize metrics collector");
    RiskLimits::new(metrics)
}

#[tokio::test]
async fn test_position_size_validation() {
    let portfolio = setup_test_portfolio(dec!(10000.00)).await;
    let risk_limits = setup_risk_limits().await;

    // Test valid position size (under 20% limit)
    let start = Instant::now();
    let result = risk_limits.validate_trade_async(
        &portfolio,
        dec!(1000.00),
        TEST_TRADING_PAIR.to_string(),
    ).await;

    assert!(result.is_ok(), "Valid position size should be accepted");
    assert!(
        start.elapsed().as_millis() < LATENCY_THRESHOLD_MS as u128,
        "Validation exceeded latency threshold"
    );

    // Test invalid position size (over 20% limit)
    let result = risk_limits.validate_trade_async(
        &portfolio,
        dec!(2500.00),
        TEST_TRADING_PAIR.to_string(),
    ).await;

    assert!(
        matches!(result, Err(RiskError::PositionLimitExceeded(_))),
        "Oversized position should be rejected"
    );
}

#[tokio::test]
async fn test_portfolio_exposure_limits() {
    let portfolio = setup_test_portfolio(dec!(10000.00)).await;
    let risk_limits = setup_risk_limits().await;

    // Add initial position
    portfolio.add_position(
        TEST_TRADING_PAIR.to_string(),
        dec!(5000.00),
        dec!(1.00),
    ).await.expect("Failed to add initial position");

    // Test trade that would exceed max portfolio exposure
    let result = risk_limits.validate_trade_async(
        &portfolio,
        dec!(4000.00),
        TEST_TRADING_PAIR.to_string(),
    ).await;

    assert!(
        matches!(result, Err(RiskError::ExposureLimitExceeded(_))),
        "Trade exceeding portfolio exposure limit should be rejected"
    );
}

#[tokio::test]
async fn test_concurrent_validation() {
    let portfolio = Arc::new(setup_test_portfolio(dec!(100000.00)).await);
    let risk_limits = Arc::new(setup_risk_limits().await);
    let mut handles = Vec::with_capacity(CONCURRENT_TESTS);

    // Launch concurrent validation tasks
    for i in 0..CONCURRENT_TESTS {
        let portfolio = portfolio.clone();
        let risk_limits = risk_limits.clone();
        let trade_size = dec!(1000.00) * Decimal::from(i + 1);

        handles.push(tokio::spawn(async move {
            risk_limits.validate_trade_async(
                &portfolio,
                trade_size,
                TEST_TRADING_PAIR.to_string(),
            ).await
        }));
    }

    // Verify all validations complete successfully
    for handle in handles {
        let result = handle.await.expect("Task panicked");
        match result {
            Ok(validation) => {
                assert!(validation.validation_time_ms < LATENCY_THRESHOLD_MS);
            }
            Err(e) => {
                // Only position/exposure limit errors are acceptable
                assert!(
                    matches!(e, 
                        RiskError::PositionLimitExceeded(_) |
                        RiskError::ExposureLimitExceeded(_)
                    ),
                    "Unexpected error: {:?}", e
                );
            }
        }
    }
}

#[tokio::test]
async fn test_risk_limits_update() {
    let risk_limits = setup_risk_limits().await;
    let portfolio = setup_test_portfolio(dec!(10000.00)).await;

    // Update risk limits
    risk_limits.update_limits(
        Some(dec!(0.15)), // 15% position limit
        Some(dec!(0.70)), // 70% exposure limit
    );

    // Test trade against new limits
    let result = risk_limits.validate_trade_async(
        &portfolio,
        dec!(1600.00), // Should exceed new 15% limit
        TEST_TRADING_PAIR.to_string(),
    ).await;

    assert!(
        matches!(result, Err(RiskError::PositionLimitExceeded(_))),
        "Trade should be rejected with updated position limit"
    );
}

#[tokio::test]
async fn test_circuit_breaker() {
    let risk_limits = setup_risk_limits().await;
    let portfolio = setup_test_portfolio(dec!(10000.00)).await;

    // Add positions to approach circuit breaker threshold
    portfolio.add_position(
        TEST_TRADING_PAIR.to_string(),
        dec!(9000.00),
        dec!(1.00),
    ).await.expect("Failed to add position");

    // Test trade that should trigger circuit breaker
    let result = risk_limits.validate_trade_async(
        &portfolio,
        dec!(500.00),
        TEST_TRADING_PAIR.to_string(),
    ).await;

    assert!(
        matches!(result, Err(RiskError::CircuitBreakerTriggered(_))),
        "Circuit breaker should trigger near threshold"
    );
}

fn criterion_benchmark(c: &mut Criterion) {
    let rt = tokio::runtime::Runtime::new().unwrap();

    c.bench_function("risk_validation_latency", |b| {
        b.iter(|| {
            rt.block_on(async {
                let portfolio = setup_test_portfolio(dec!(10000.00)).await;
                let risk_limits = setup_risk_limits().await;

                risk_limits.validate_trade_async(
                    &portfolio,
                    dec!(1000.00),
                    TEST_TRADING_PAIR.to_string(),
                ).await
            })
        })
    });
}

criterion_group!(benches, criterion_benchmark);
criterion_main!(benches);