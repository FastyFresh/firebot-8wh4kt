use std::{sync::Arc, time::Duration};
use tokio::{sync::mpsc, time::timeout};
use tracing::{debug, error, info, instrument};

use crate::{
    data_collector::{
        create_collector, Collector, CollectorConfig, DexType, HealthStatus,
        COLLECTION_INTERVAL_MS, MAX_RECONNECT_ATTEMPTS,
    },
    models::market::{MarketData, validate_price, validate_volume},
    utils::{
        metrics::MetricsCollector,
        solana::SolanaClient,
        time::{calculate_duration_ms, current_timestamp},
    },
};

// Test constants
const TEST_TIMEOUT_MS: u64 = 5000;
const TEST_TRADING_PAIRS: &[&str] = &["SOL/USDC", "ORCA/USDC", "RAY/USDC"];
const MAX_LATENCY_MS: u64 = 500;
const CONCURRENT_COLLECTORS: usize = 3;

/// Test context holding shared resources
struct TestContext {
    metrics: Arc<MetricsCollector>,
    solana_client: Arc<SolanaClient>,
    collectors: Vec<Box<dyn Collector>>,
    market_data_rx: mpsc::Receiver<MarketData>,
}

/// Comprehensive test suite for data collection system
#[tokio::test]
async fn test_concurrent_data_collection() -> Result<(), Box<dyn std::error::Error>> {
    // Initialize test environment
    let test_context = setup_test_environment().await?;
    let TestContext {
        metrics,
        collectors,
        mut market_data_rx,
        ..
    } = test_context;

    // Start all collectors concurrently
    for collector in collectors.iter() {
        collector.start_collection().await?;
    }

    // Collect and validate market data with timeout
    let validation_task = tokio::spawn(async move {
        let mut validated_data = Vec::new();
        
        while let Ok(Some(market_data)) = timeout(
            Duration::from_millis(TEST_TIMEOUT_MS),
            market_data_rx.recv()
        ).await {
            // Validate market data
            let validation_start = current_timestamp();
            let validation_result = verify_market_data(market_data.clone(), metrics.clone()).await?;
            
            let latency = calculate_duration_ms(
                validation_start,
                current_timestamp()
            )?;

            // Assert latency requirements
            assert!(
                latency <= MAX_LATENCY_MS,
                "Data collection latency ({} ms) exceeded maximum allowed ({} ms)",
                latency,
                MAX_LATENCY_MS
            );

            validated_data.push(validation_result);
        }
        
        Ok::<_, Box<dyn std::error::Error>>(validated_data)
    });

    // Run test for specified duration
    tokio::time::sleep(Duration::from_millis(TEST_TIMEOUT_MS)).await;

    // Verify results
    let validation_results = validation_task.await??;
    assert!(!validation_results.is_empty(), "No market data was collected");

    Ok(())
}

#[tokio::test]
async fn test_collector_error_recovery() -> Result<(), Box<dyn std::error::Error>> {
    let test_context = setup_test_environment().await?;
    let TestContext {
        metrics,
        collectors,
        ..
    } = test_context;

    // Test error recovery for each collector
    for collector in collectors.iter() {
        // Force stop collector
        collector.stop_collection().await?;

        // Verify health status shows unhealthy
        let health = collector.health_check().await?;
        assert!(!health.is_healthy, "Collector should be unhealthy after forced stop");

        // Attempt restart and verify recovery
        collector.start_collection().await?;
        
        // Allow time for recovery
        tokio::time::sleep(Duration::from_millis(COLLECTION_INTERVAL_MS * 2)).await;

        // Verify health status recovered
        let health = collector.health_check().await?;
        assert!(health.is_healthy, "Collector failed to recover after restart");

        // Verify metrics recorded error and recovery
        let metrics_data = metrics.get_metrics()?;
        assert!(
            metrics_data.contains("collector_recovery_count"),
            "Recovery metrics not recorded"
        );
    }

    Ok(())
}

#[tokio::test]
async fn test_multi_dex_consistency() -> Result<(), Box<dyn std::error::Error>> {
    let test_context = setup_test_environment().await?;
    let TestContext {
        metrics,
        collectors,
        mut market_data_rx,
        ..
    } = test_context;

    // Start collectors
    for collector in collectors.iter() {
        collector.start_collection().await?;
    }

    // Collect market data from all DEXs
    let mut dex_data = std::collections::HashMap::new();
    
    while let Ok(Some(market_data)) = timeout(
        Duration::from_millis(TEST_TIMEOUT_MS),
        market_data_rx.recv()
    ).await {
        dex_data
            .entry(market_data.trading_pair.clone())
            .or_insert_with(Vec::new)
            .push(market_data);
    }

    // Verify price consistency across DEXs
    for (trading_pair, data_points) in dex_data {
        if data_points.len() >= 2 {
            let price_diff_percentage = calculate_price_difference(&data_points);
            
            // Assert price differences are within acceptable range (1%)
            assert!(
                price_diff_percentage <= 1.0,
                "Price inconsistency detected for {}: {}%",
                trading_pair,
                price_diff_percentage
            );
        }
    }

    Ok(())
}

/// Sets up the test environment with metrics and collectors
#[instrument]
async fn setup_test_environment() -> Result<TestContext, Box<dyn std::error::Error>> {
    // Initialize metrics
    let metrics = Arc::new(MetricsCollector::new()?);

    // Initialize Solana client
    let solana_client = Arc::new(
        SolanaClient::new(
            "https://api.mainnet-beta.solana.com".to_string(),
            None,
            None,
        )
        .await?
    );

    // Create collector config
    let config = CollectorConfig {
        collection_interval: Duration::from_millis(COLLECTION_INTERVAL_MS),
        connection_pool_size: CONCURRENT_COLLECTORS,
        max_reconnect_attempts: MAX_RECONNECT_ATTEMPTS,
        validation_timeout: Duration::from_millis(MAX_LATENCY_MS),
    };

    // Create market data channel
    let (market_data_tx, market_data_rx) = mpsc::channel(100);

    // Initialize collectors for each DEX
    let collectors = vec![
        create_collector(DexType::Jupiter, solana_client.clone(), config.clone())?,
        create_collector(DexType::PumpFun, solana_client.clone(), config.clone())?,
        create_collector(DexType::Drift, solana_client.clone(), config.clone())?,
    ];

    Ok(TestContext {
        metrics,
        solana_client,
        collectors,
        market_data_rx,
    })
}

/// Verifies market data validity and performance
#[instrument(skip(market_data, metrics))]
async fn verify_market_data(
    market_data: MarketData,
    metrics: Arc<MetricsCollector>,
) -> Result<ValidationReport, Box<dyn std::error::Error>> {
    let start_time = current_timestamp();

    // Validate price and volume
    validate_price(market_data.price, &market_data.exchange)?;
    validate_volume(market_data.volume, &market_data.exchange)?;

    // Verify trading pair format
    assert!(
        TEST_TRADING_PAIRS.contains(&market_data.trading_pair.as_str()),
        "Invalid trading pair: {}",
        market_data.trading_pair
    );

    // Record validation metrics
    let validation_time = calculate_duration_ms(start_time, current_timestamp())?;
    metrics.record_trade_execution(
        &market_data.trading_pair,
        "validation",
        validation_time as u64,
        true,
    )?;

    Ok(ValidationReport {
        trading_pair: market_data.trading_pair,
        validation_time,
        is_valid: true,
    })
}

/// Validation report structure
#[derive(Debug)]
struct ValidationReport {
    trading_pair: String,
    validation_time: i64,
    is_valid: bool,
}

/// Calculates percentage price difference between data points
fn calculate_price_difference(data_points: &[MarketData]) -> f64 {
    let max_price = data_points
        .iter()
        .map(|d| d.price)
        .max()
        .unwrap_or_default();
    
    let min_price = data_points
        .iter()
        .map(|d| d.price)
        .min()
        .unwrap_or_default();

    if min_price.is_zero() {
        return f64::MAX;
    }

    ((max_price - min_price) / min_price * 100.0)
        .to_f64()
        .unwrap_or(f64::MAX)
}