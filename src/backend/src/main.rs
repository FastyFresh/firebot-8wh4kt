//! Entry point for the AI-powered Solana trading bot that initializes and coordinates
//! all system components with comprehensive monitoring and error handling.
//! Version: 1.0.0

use anyhow::Result;
use tokio::signal;
use tracing::{error, info, warn, instrument};
use tracing_subscriber::{fmt, EnvFilter};

use crate::lib::{TradingBot, init_trading_bot};
use crate::config::init_config;
use crate::utils::metrics::MetricsCollector;

// Global constants from specification
const RUNTIME_THREADS: usize = 16;
const SHUTDOWN_TIMEOUT: tokio::time::Duration = tokio::time::Duration::from_secs(30);

/// Entry point for the trading bot application with comprehensive initialization and error handling
#[tokio::main(worker_threads = 16)]
#[tracing::instrument(err)]
async fn main() -> Result<()> {
    // Initialize logging system with JSON formatting and correlation IDs
    setup_logging().await?;
    info!("Starting Solana trading bot...");

    // Initialize metrics collection
    let metrics = MetricsCollector::new()
        .map_err(|e| anyhow::anyhow!("Failed to initialize metrics: {}", e))?;
    metrics.record_startup().await?;

    // Load and validate configuration
    let config = init_config()
        .await
        .map_err(|e| anyhow::anyhow!("Configuration initialization failed: {}", e))?;

    // Initialize trading bot with all components
    let bot = init_trading_bot(config.clone())
        .map_err(|e| anyhow::anyhow!("Trading bot initialization failed: {}", e))?;

    // Start trading bot components
    bot.start()
        .await
        .map_err(|e| anyhow::anyhow!("Failed to start trading bot: {}", e))?;

    info!("Trading bot started successfully");

    // Handle shutdown signals
    handle_shutdown(bot).await?;

    info!("Trading bot shutdown completed");
    Ok(())
}

/// Configures comprehensive application logging and monitoring system
#[instrument(err)]
async fn setup_logging() -> Result<()> {
    let log_level = std::env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());

    // Configure JSON log formatter for production
    let formatter = fmt::format()
        .with_level(true)
        .with_target(true)
        .with_thread_ids(true)
        .with_file(true)
        .with_line_number(true)
        .json();

    // Set up logging subscriber with filtering
    let subscriber = fmt::Subscriber::builder()
        .with_env_filter(EnvFilter::from_default_env()
            .add_directive(log_level.parse()?)
            .add_directive("tokio=warn".parse()?)
            .add_directive("runtime=warn".parse()?))
        .with_writer(std::io::stdout)
        .with_formatter(formatter)
        .with_ansi(false)
        .with_max_level(tracing::Level::TRACE)
        .try_init()
        .map_err(|e| anyhow::anyhow!("Failed to initialize logging: {}", e))?;

    info!("Logging system initialized successfully");
    Ok(())
}

/// Manages graceful shutdown of all system components
#[instrument(skip(bot), err)]
async fn handle_shutdown(bot: TradingBot) -> Result<()> {
    // Wait for shutdown signal
    let ctrl_c = signal::ctrl_c();
    let terminate = signal::unix::signal(signal::unix::SignalKind::terminate())?;

    tokio::select! {
        _ = ctrl_c => info!("Received Ctrl+C signal"),
        _ = terminate => info!("Received termination signal"),
    }

    info!("Initiating graceful shutdown...");

    // Stop accepting new operations
    warn!("Stopping new operations");

    // Initiate graceful shutdown with timeout
    let shutdown_result = tokio::time::timeout(
        SHUTDOWN_TIMEOUT,
        bot.shutdown()
    ).await;

    match shutdown_result {
        Ok(Ok(_)) => info!("All components shut down successfully"),
        Ok(Err(e)) => error!("Error during shutdown: {}", e),
        Err(_) => error!("Shutdown timed out after {:?}", SHUTDOWN_TIMEOUT),
    }

    // Ensure metrics are flushed
    if let Err(e) = MetricsCollector::flush().await {
        error!("Failed to flush metrics: {}", e);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_logging_setup() {
        assert!(setup_logging().await.is_ok());
    }

    #[tokio::test]
    async fn test_metrics_initialization() {
        let metrics = MetricsCollector::new();
        assert!(metrics.is_ok());
    }

    #[tokio::test]
    async fn test_config_initialization() {
        let config = init_config().await;
        assert!(config.is_ok());
    }
}