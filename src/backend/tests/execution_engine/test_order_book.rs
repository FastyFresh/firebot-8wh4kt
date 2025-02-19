//! Comprehensive test suite for the order book implementation with sub-500ms latency requirements.
//! 
//! Version dependencies:
//! - tokio-test = "0.4"
//! - rust_decimal = "1.30"
//! - mockall = "0.11"
//! - criterion = "0.4"

use std::sync::Arc;
use std::time::{Duration, Instant};
use chrono::Utc;
use mockall::predicate::*;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use tokio::sync::RwLock;
use tokio::time::sleep;

use crate::execution_engine::order_book::{
    LiveOrderBook, OrderBookError, ExecutionPlan, ExecutionRoute,
};
use crate::models::order::{Order, OrderType, OrderStatus};
use crate::models::market::{OrderBook, OrderBookLevel, MarketData};
use crate::utils::solana::SolanaClient;
use crate::utils::time::current_timestamp;

// Test constants
const TEST_LATENCY_THRESHOLD_MS: u64 = 500;
const TEST_CONCURRENT_UPDATES: usize = 100;
const TEST_ORDER_BOOK_DEPTH: usize = 50;
const TEST_TRADING_PAIR: &str = "SOL/USDC";

/// Test environment setup
struct TestEnvironment {
    order_book: LiveOrderBook,
    solana_client: Arc<SolanaClient>,
    test_orders: Vec<Order>,
}

/// Sets up test environment with mock dependencies
async fn setup_test_environment() -> TestEnvironment {
    // Create mock Solana client
    let solana_client = Arc::new(SolanaClient::new(
        "http://localhost:8899".to_string(),
        Some("http://localhost:8900".to_string()),
        None,
    ).await.unwrap());

    // Initialize order book
    let order_book = LiveOrderBook::new(solana_client.clone(), Default::default());

    // Generate test orders
    let test_orders = generate_test_orders();

    TestEnvironment {
        order_book,
        solana_client,
        test_orders,
    }
}

/// Generates test orders with various parameters
fn generate_test_orders() -> Vec<Order> {
    let mut orders = Vec::new();
    
    // Market orders
    orders.push(Order::new(
        TEST_TRADING_PAIR.to_string(),
        "jupiter".to_string(),
        OrderType::Market,
        dec!(23.50),
        dec!(100.00),
    ).unwrap());

    // Limit orders
    orders.push(Order::new(
        TEST_TRADING_PAIR.to_string(),
        "pump_fun".to_string(),
        OrderType::Limit,
        dec!(23.45),
        dec!(50.00),
    ).unwrap());

    orders
}

/// Generates test order book data
fn generate_test_order_book() -> OrderBook {
    let mut bids = Vec::new();
    let mut asks = Vec::new();

    // Generate bid levels
    for i in 0..TEST_ORDER_BOOK_DEPTH {
        bids.push(OrderBookLevel {
            price: dec!(23.45) - Decimal::new(i as i64, 2),
            volume: dec!(100.00),
        });
    }

    // Generate ask levels
    for i in 0..TEST_ORDER_BOOK_DEPTH {
        asks.push(OrderBookLevel {
            price: dec!(23.55) + Decimal::new(i as i64, 2),
            volume: dec!(100.00),
        });
    }

    OrderBook::new(
        TEST_TRADING_PAIR.to_string(),
        "jupiter".to_string(),
        bids,
        asks,
    ).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_order_book_initialization() {
        let env = setup_test_environment().await;
        
        // Verify order book is properly initialized
        let test_book = generate_test_order_book();
        let result = env.order_book.update_book(
            TEST_TRADING_PAIR.to_string(),
            test_book,
        ).await;
        
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_order_matching_latency() {
        let env = setup_test_environment().await;
        let test_book = generate_test_order_book();
        
        // Update order book
        env.order_book.update_book(
            TEST_TRADING_PAIR.to_string(),
            test_book,
        ).await.unwrap();

        // Test order matching latency
        for order in &env.test_orders {
            let start = Instant::now();
            let result = env.order_book.get_best_execution(order).await;
            let duration = start.elapsed();

            assert!(result.is_ok());
            assert!(
                duration.as_millis() < TEST_LATENCY_THRESHOLD_MS as u128,
                "Order matching exceeded latency threshold: {:?}ms",
                duration.as_millis()
            );
        }
    }

    #[tokio::test]
    async fn test_concurrent_updates() {
        let env = setup_test_environment().await;
        let test_book = generate_test_order_book();

        // Spawn concurrent update tasks
        let mut handles = Vec::new();
        for i in 0..TEST_CONCURRENT_UPDATES {
            let order_book = env.order_book.clone();
            let mut book = test_book.clone();
            book.timestamp = current_timestamp();

            handles.push(tokio::spawn(async move {
                sleep(Duration::from_millis(i as u64)).await;
                order_book.update_book(
                    TEST_TRADING_PAIR.to_string(),
                    book,
                ).await
            }));
        }

        // Wait for all updates to complete
        for handle in handles {
            let result = handle.await.unwrap();
            assert!(
                result.is_ok() || 
                matches!(result, Err(OrderBookError::UpdateError(_))),
                "Unexpected error: {:?}",
                result
            );
        }
    }

    #[tokio::test]
    async fn test_order_execution_routing() {
        let env = setup_test_environment().await;
        let test_book = generate_test_order_book();

        // Update order book
        env.order_book.update_book(
            TEST_TRADING_PAIR.to_string(),
            test_book,
        ).await.unwrap();

        // Test execution routing for different order types
        for order in &env.test_orders {
            let execution_plan = env.order_book.get_best_execution(order).await.unwrap();
            
            assert!(execution_plan.route.steps.len() > 0);
            assert!(execution_plan.route.estimated_execution_time <= Duration::from_millis(500));
            assert!(execution_plan.estimated_price > Decimal::ZERO);
        }
    }

    #[tokio::test]
    async fn test_stale_data_handling() {
        let env = setup_test_environment().await;
        let mut test_book = generate_test_order_book();

        // Set stale timestamp
        test_book.timestamp = Utc::now() - chrono::Duration::seconds(10);

        // Attempt to update with stale data
        let result = env.order_book.update_book(
            TEST_TRADING_PAIR.to_string(),
            test_book,
        ).await;

        assert!(matches!(result, Err(OrderBookError::StaleDataError(_))));
    }

    #[tokio::test]
    async fn test_error_handling() {
        let env = setup_test_environment().await;

        // Test invalid trading pair
        let result = env.order_book.get_best_execution(
            &Order::new(
                "INVALID/PAIR".to_string(),
                "jupiter".to_string(),
                OrderType::Market,
                dec!(23.50),
                dec!(100.00),
            ).unwrap()
        ).await;

        assert!(matches!(result, Err(OrderBookError::MarketError(_))));
    }
}

#[cfg(test)]
mod benchmarks {
    use super::*;
    use criterion::{criterion_group, criterion_main, Criterion};

    pub fn benchmark_order_matching(c: &mut Criterion) {
        let rt = tokio::runtime::Runtime::new().unwrap();
        
        c.bench_function("order_matching", |b| {
            b.iter(|| {
                rt.block_on(async {
                    let env = setup_test_environment().await;
                    let test_book = generate_test_order_book();
                    
                    env.order_book.update_book(
                        TEST_TRADING_PAIR.to_string(),
                        test_book,
                    ).await.unwrap();

                    for order in &env.test_orders {
                        env.order_book.get_best_execution(order).await.unwrap();
                    }
                })
            })
        });
    }

    criterion_group!(benches, benchmark_order_matching);
    criterion_main!(benches);
}