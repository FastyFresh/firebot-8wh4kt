//! Error handling module for the execution engine, providing comprehensive error types
//! and handling for trade execution, position management, and MEV-related operations.
//!
//! Version dependencies:
//! - thiserror = "1.0"
//! - tracing = "0.1"

use crate::models::order::OrderStatus;
use crate::utils::metrics;
use crate::utils::solana::ClientError;
use chrono::{DateTime, Utc};
use thiserror::Error;
use tracing::{error, warn};
use uuid::Uuid;

/// Comprehensive error enumeration for the execution engine
#[derive(Debug, Error, Clone)]
pub enum ExecutionError {
    #[error("trade execution failed: {1} (context: {0})")]
    TradeExecutionFailed(TradeContext, String),

    #[error("network error (status: {1}): {0}")]
    NetworkError(String, u16),

    #[error("validation error: {0}")]
    ValidationError(String),

    #[error("operation timeout after {0}ms: {1}")]
    TimeoutError(u64, String),

    #[error("rate limit exceeded on {0} (limit: {1} requests/min)")]
    RateLimitError(String, u32),

    #[error("order book error: {0}")]
    OrderBookError(String),

    #[error("MEV bundle submission failed: {0}")]
    MevBundleError(String),

    #[error("position management error: {0}")]
    PositionError(String),

    #[error("insufficient liquidity: {0}")]
    LiquidityError(String),

    #[error("Solana client error: {0}")]
    SolanaError(#[from] ClientError),

    #[error("internal error: {0}")]
    InternalError(String),
}

/// Detailed context information for trade execution errors
#[derive(Debug, Clone)]
pub struct TradeContext {
    pub trading_pair: String,
    pub exchange: String,
    pub status: OrderStatus,
    pub error_message: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub retry_count: u32,
    pub error_code: String,
    pub transaction_id: Option<String>,
    pub order_id: Option<Uuid>,
}

impl TradeContext {
    /// Creates new trade context for error reporting
    pub fn new(trading_pair: String, exchange: String, status: OrderStatus) -> Self {
        Self {
            trading_pair,
            exchange,
            status,
            error_message: None,
            timestamp: Utc::now(),
            retry_count: 0,
            error_code: format!("ERR-{}", Uuid::new_v4().simple()),
            transaction_id: None,
            order_id: None,
        }
    }

    /// Adds error message to context and updates metrics
    pub fn with_error(mut self, message: String) -> Self {
        error!(
            error_code = %self.error_code,
            trading_pair = %self.trading_pair,
            exchange = %self.exchange,
            status = ?self.status,
            error = %message,
            "Trade execution error"
        );

        metrics::increment_error_counter(&format!(
            "trade_error.{}.{}",
            self.exchange,
            self.status
        ));

        self.error_message = Some(message);
        self
    }

    /// Increments retry counter and logs attempt
    pub fn increment_retry(mut self) -> Self {
        self.retry_count += 1;
        warn!(
            error_code = %self.error_code,
            trading_pair = %self.trading_pair,
            exchange = %self.exchange,
            retry = self.retry_count,
            "Retrying trade execution"
        );
        self
    }

    /// Adds transaction ID to context
    pub fn with_transaction_id(mut self, tx_id: String) -> Self {
        self.transaction_id = Some(tx_id);
        self
    }

    /// Adds order ID to context
    pub fn with_order_id(mut self, order_id: Uuid) -> Self {
        self.order_id = Some(order_id);
        self
    }
}

/// Maps Solana client errors to execution engine errors
pub fn map_solana_error(error: ClientError) -> ExecutionError {
    match error {
        ClientError::TransactionError(msg) => ExecutionError::TradeExecutionFailed(
            TradeContext::new(
                "UNKNOWN".to_string(),
                "solana".to_string(),
                OrderStatus::Failed,
            ),
            msg.to_string(),
        ),
        ClientError::Io(err) => ExecutionError::NetworkError(
            err.to_string(),
            500,
        ),
        ClientError::RpcError(err) => ExecutionError::SolanaError(
            ClientError::RpcError(err),
        ),
        _ => ExecutionError::InternalError(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trade_context_creation() {
        let context = TradeContext::new(
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            OrderStatus::Pending,
        );
        assert_eq!(context.trading_pair, "SOL/USDC");
        assert_eq!(context.exchange, "jupiter");
        assert_eq!(context.status, OrderStatus::Pending);
        assert_eq!(context.retry_count, 0);
    }

    #[test]
    fn test_trade_context_with_error() {
        let context = TradeContext::new(
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            OrderStatus::Failed,
        )
        .with_error("Insufficient liquidity".to_string());
        assert!(context.error_message.is_some());
        assert_eq!(context.error_message.unwrap(), "Insufficient liquidity");
    }

    #[test]
    fn test_trade_context_retry_increment() {
        let context = TradeContext::new(
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            OrderStatus::Pending,
        )
        .increment_retry();
        assert_eq!(context.retry_count, 1);
    }

    #[test]
    fn test_solana_error_mapping() {
        let solana_error = ClientError::TransactionError("Transaction simulation failed".to_string());
        let execution_error = map_solana_error(solana_error);
        match execution_error {
            ExecutionError::TradeExecutionFailed(context, msg) => {
                assert_eq!(context.exchange, "solana");
                assert!(msg.contains("Transaction simulation failed"));
            }
            _ => panic!("Expected TradeExecutionFailed variant"),
        }
    }
}