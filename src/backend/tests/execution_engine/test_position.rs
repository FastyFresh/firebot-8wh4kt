//! Comprehensive test suite for position management functionality, validating creation,
//! updates, calculations, risk management, and performance requirements.
//!
//! Version dependencies:
//! - rust_decimal = "1.30"
//! - tokio-test = "0.4"
//! - test-case = "3.1"

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use test_case::test_case;
use tokio::time::{Duration, Instant};

use crate::execution_engine::position::{Position, PositionStatus};
use crate::models::trade::Trade;
use crate::execution_engine::error::ExecutionError;

/// Tests position creation with comprehensive parameter validation
#[tokio::test]
#[test_case("SOL/USDC", dec!(1.5), dec!(23.45) ; "valid parameters")]
#[test_case("ETH/USDC", dec!(100.0), dec!(1850.75) ; "large position")]
#[test_case("ORCA/USDC", dec!(0.001), dec!(1.23) ; "minimum size")]
async fn test_position_creation(
    trading_pair: &str,
    size: Decimal,
    entry_price: Decimal,
) -> Result<(), ExecutionError> {
    let start = Instant::now();

    // Create position
    let position = Position::new(
        trading_pair.to_string(),
        size,
        entry_price,
    )?;

    // Verify basic attributes
    assert_eq!(position.trading_pair, trading_pair);
    assert_eq!(*position.size.read().await, size);
    assert_eq!(position.entry_price, entry_price);
    assert!(position.id.to_string().len() > 0);

    // Verify initial metrics
    let metrics = position.get_metrics().await?;
    assert_eq!(metrics.unrealized_pnl, dec!(0));
    assert_eq!(metrics.realized_pnl, dec!(0));
    assert_eq!(metrics.max_drawdown, dec!(0));
    assert_eq!(metrics.entry_value, size * entry_price);

    // Verify status
    assert_eq!(*position.status.read().await, PositionStatus::Opening);

    // Verify performance requirement
    assert!(start.elapsed() < Duration::from_millis(500));

    Ok(())
}

/// Tests concurrent position updates with market price changes
#[tokio::test]
async fn test_position_update_concurrent() -> Result<(), ExecutionError> {
    let mut position = Position::new(
        "SOL/USDC".to_string(),
        dec!(2.0),
        dec!(25.00),
    )?;

    // Create multiple concurrent update tasks
    let mut handles = vec![];
    for price in [dec!(26.00), dec!(24.50), dec!(25.75), dec!(25.25)] {
        let pos_clone = position.clone();
        handles.push(tokio::spawn(async move {
            pos_clone.update_position(dec!(2.0), price).await
        }));
    }

    // Wait for all updates to complete
    for handle in handles {
        handle.await.unwrap()?;
    }

    // Verify final state
    let metrics = position.get_metrics().await?;
    assert!(metrics.update_count > 0);
    assert!(*position.current_price.read().await > dec!(0));
    assert_eq!(*position.size.read().await, dec!(2.0));

    Ok(())
}

/// Tests position risk management and limit enforcement
#[tokio::test]
#[test_case(dec!(100.00), dec!(85.00), true ; "emergency closure trigger")]
#[test_case(dec!(100.00), dec!(95.00), false ; "within limits")]
#[test_case(dec!(100.00), dec!(75.00), true ; "severe drawdown")]
async fn test_position_risk_limits(
    entry_price: Decimal,
    update_price: Decimal,
    should_trigger: bool,
) -> Result<(), ExecutionError> {
    let mut position = Position::new(
        "SOL/USDC".to_string(),
        dec!(1.5),
        entry_price,
    )?;

    // Attempt price update
    let result = position.update_position(dec!(1.5), update_price).await;

    if should_trigger {
        // Verify emergency closure triggered
        assert!(result.is_err());
        assert_eq!(*position.status.read().await, PositionStatus::EmergencyClosing);

        // Verify metrics recorded drawdown
        let metrics = position.get_metrics().await?;
        assert!(metrics.max_drawdown > dec!(0));
    } else {
        // Verify update succeeded
        assert!(result.is_ok());
        assert_eq!(*position.status.read().await, PositionStatus::Opening);
    }

    Ok(())
}

/// Tests complete position lifecycle including creation, updates, and closure
#[tokio::test]
async fn test_position_lifecycle() -> Result<(), ExecutionError> {
    let start = Instant::now();

    // Create position
    let mut position = Position::new(
        "SOL/USDC".to_string(),
        dec!(3.0),
        dec!(24.00),
    )?;

    // Perform series of updates
    let updates = vec![
        (dec!(3.0), dec!(24.50)),
        (dec!(2.0), dec!(25.00)), // Partial close
        (dec!(2.0), dec!(24.75)),
    ];

    for (size, price) in updates {
        position.update_position(size, price).await?;
        assert!(start.elapsed() < Duration::from_millis(500));
    }

    // Verify partial closure
    assert_eq!(*position.size.read().await, dec!(2.0));
    
    // Close position
    position.close().await?;
    
    // Verify final state
    assert_eq!(*position.status.read().await, PositionStatus::Closed);
    assert!(position.closed_at.is_some());
    
    let metrics = position.get_metrics().await?;
    assert_eq!(metrics.realized_pnl, metrics.unrealized_pnl);

    // Verify overall performance
    assert!(start.elapsed() < Duration::from_millis(2000));

    Ok(())
}

/// Tests invalid position parameters
#[tokio::test]
async fn test_position_validation() {
    // Test zero size
    assert!(Position::new(
        "SOL/USDC".to_string(),
        dec!(0),
        dec!(25.00),
    ).is_err());

    // Test negative price
    assert!(Position::new(
        "SOL/USDC".to_string(),
        dec!(1.0),
        dec!(-25.00),
    ).is_err());

    // Test excessive size
    assert!(Position::new(
        "SOL/USDC".to_string(),
        dec!(1000001),
        dec!(25.00),
    ).is_err());
}

/// Tests position metrics calculation accuracy
#[tokio::test]
async fn test_position_metrics_calculation() -> Result<(), ExecutionError> {
    let mut position = Position::new(
        "SOL/USDC".to_string(),
        dec!(2.0),
        dec!(100.00),
    )?;

    // Update with 10% profit
    position.update_position(dec!(2.0), dec!(110.00)).await?;
    let metrics = position.get_metrics().await?;
    assert_eq!(metrics.unrealized_pnl, dec!(10.0)); // 10% profit
    assert_eq!(metrics.peak_value, dec!(220.00)); // 2.0 * 110.00

    // Update with 5% drawdown from peak
    position.update_position(dec!(2.0), dec!(104.50)).await?;
    let metrics = position.get_metrics().await?;
    assert_eq!(metrics.max_drawdown, dec!(5.0)); // (220 - 209) / 220 * 100

    Ok(())
}