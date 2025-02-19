//! Metrics collection and monitoring system for the Solana trading bot.
//! Provides real-time performance tracking, system health monitoring, and trading analytics
//! through Prometheus integration with thread-safe concurrent access.
//!
//! Version dependencies:
//! - prometheus = "0.13"
//! - lazy_static = "1.4"
//! - tokio = "1.28"

use crate::utils::time::{current_timestamp, calculate_duration_ms};
use lazy_static::lazy_static;
use prometheus::{
    core::{AtomicF64, GenericCounter},
    exponential_buckets, opts, register_histogram_vec, register_gauge_vec,
    register_int_counter_vec, Histogram, HistogramVec, GaugeVec, IntCounterVec,
    Registry,
};
use std::sync::{Arc, RwLock};
use thiserror::Error;
use tokio::sync::Mutex;

// Error handling for metrics operations
#[derive(Error, Debug)]
pub enum MetricsError {
    #[error("metrics initialization failed: {0}")]
    InitializationError(String),
    #[error("metric recording failed: {0}")]
    RecordingError(String),
    #[error("metric aggregation failed: {0}")]
    AggregationError(String),
}

// Global metrics registry with thread-safe access
lazy_static! {
    static ref METRICS_REGISTRY: RwLock<Registry> = RwLock::new(Registry::new());
    
    // Trade execution metrics with phase tracking
    static ref TRADE_EXECUTION_HISTOGRAM: HistogramVec = register_histogram_vec!(
        opts!("trade_execution_time", "Trade execution latency breakdown by phase"),
        &["trading_pair", "phase"],
        exponential_buckets(0.001, 2.0, 10).unwrap()
    ).unwrap();
    
    // Strategy performance metrics
    static ref STRATEGY_PERFORMANCE_GAUGE: GaugeVec = register_gauge_vec!(
        opts!("strategy_performance", "Strategy performance metrics"),
        &["strategy", "metric_type"]
    ).unwrap();
    
    // System health metrics
    static ref SYSTEM_HEALTH_GAUGE: GaugeVec = register_gauge_vec!(
        opts!("system_health", "System health and resource metrics"),
        &["component", "metric"]
    ).unwrap();
    
    // Trade success/failure counters
    static ref TRADE_RESULT_COUNTER: IntCounterVec = register_int_counter_vec!(
        opts!("trade_results", "Trade execution success and failure counts"),
        &["trading_pair", "result"]
    ).unwrap();
}

/// Thread-safe metrics collector with optimized performance
#[derive(Debug)]
pub struct MetricsCollector {
    registry: Arc<RwLock<Registry>>,
    execution_metrics: Arc<HistogramVec>,
    performance_metrics: Arc<GaugeVec>,
    health_metrics: Arc<GaugeVec>,
    trade_counters: Arc<IntCounterVec>,
    aggregation_lock: Mutex<()>,
}

impl MetricsCollector {
    /// Creates a new metrics collector instance with thread-safe access
    pub fn new() -> Result<Self, MetricsError> {
        let registry = Arc::new(RwLock::new(Registry::new()));
        
        Ok(Self {
            registry: registry.clone(),
            execution_metrics: Arc::new(TRADE_EXECUTION_HISTOGRAM.clone()),
            performance_metrics: Arc::new(STRATEGY_PERFORMANCE_GAUGE.clone()),
            health_metrics: Arc::new(SYSTEM_HEALTH_GAUGE.clone()),
            trade_counters: Arc::new(TRADE_RESULT_COUNTER.clone()),
            aggregation_lock: Mutex::new(()),
        })
    }

    /// Records strategy performance metrics with risk-adjusted calculations
    pub async fn record_strategy_performance(
        &self,
        strategy_name: String,
        returns: f64,
        risk_score: f64,
        win_rate: f64,
    ) -> Result<(), MetricsError> {
        let _lock = self.aggregation_lock.lock().await;
        
        self.performance_metrics
            .with_label_values(&[&strategy_name, "returns"])
            .set(returns);
            
        self.performance_metrics
            .with_label_values(&[&strategy_name, "risk_score"])
            .set(risk_score);
            
        self.performance_metrics
            .with_label_values(&[&strategy_name, "win_rate"])
            .set(win_rate);
            
        Ok(())
    }

    /// Records trade execution metrics with phase tracking
    pub fn record_trade_execution(
        &self,
        trading_pair: &str,
        phase: &str,
        execution_time: u64,
        success: bool,
    ) -> Result<(), MetricsError> {
        // Record execution time for the specific phase
        self.execution_metrics
            .with_label_values(&[trading_pair, phase])
            .observe(execution_time as f64 / 1000.0); // Convert to seconds
            
        // Update success/failure counter
        let result = if success { "success" } else { "failure" };
        self.trade_counters
            .with_label_values(&[trading_pair, result])
            .inc();
            
        Ok(())
    }

    /// Updates system health metrics
    pub fn update_system_health(
        &self,
        component: &str,
        metric: &str,
        value: f64,
    ) -> Result<(), MetricsError> {
        self.health_metrics
            .with_label_values(&[component, metric])
            .set(value);
            
        Ok(())
    }

    /// Retrieves current metrics for reporting
    pub fn get_metrics(&self) -> Result<String, MetricsError> {
        let mut buffer = Vec::new();
        let encoder = prometheus::TextEncoder::new();
        
        let registry = self.registry.read().map_err(|e| 
            MetricsError::RecordingError(format!("Failed to acquire registry lock: {}", e))
        )?;
        
        encoder.encode(&registry.gather(), &mut buffer).map_err(|e|
            MetricsError::RecordingError(format!("Failed to encode metrics: {}", e))
        )?;
        
        String::from_utf8(buffer).map_err(|e|
            MetricsError::RecordingError(format!("Failed to convert metrics to string: {}", e))
        )
    }
}

/// Initializes the metrics collection system
pub fn init_metrics() -> Result<MetricsCollector, MetricsError> {
    let collector = MetricsCollector::new()?;
    
    // Register default metrics
    collector.update_system_health("system", "startup_time", 
        current_timestamp().timestamp_millis() as f64)?;
    
    Ok(collector)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::test;

    #[test]
    async fn test_metrics_initialization() {
        let collector = init_metrics().expect("Failed to initialize metrics");
        assert!(collector.get_metrics().is_ok());
    }

    #[test]
    async fn test_trade_execution_recording() {
        let collector = MetricsCollector::new().unwrap();
        
        collector.record_trade_execution(
            "SOL/USDC",
            "order_placement",
            100,
            true
        ).expect("Failed to record trade execution");
        
        let metrics = collector.get_metrics().unwrap();
        assert!(metrics.contains("trade_execution_time"));
    }

    #[test]
    async fn test_strategy_performance_recording() {
        let collector = MetricsCollector::new().unwrap();
        
        collector.record_strategy_performance(
            "grid_trading".to_string(),
            0.15,
            0.05,
            0.75
        ).await.expect("Failed to record strategy performance");
        
        let metrics = collector.get_metrics().unwrap();
        assert!(metrics.contains("strategy_performance"));
    }

    #[test]
    async fn test_system_health_recording() {
        let collector = MetricsCollector::new().unwrap();
        
        collector.update_system_health(
            "memory",
            "usage_percent",
            65.5
        ).expect("Failed to update system health");
        
        let metrics = collector.get_metrics().unwrap();
        assert!(metrics.contains("system_health"));
    }
}