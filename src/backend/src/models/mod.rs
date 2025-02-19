//! Central module for all model-related types, structs, and utilities used in the
//! AI-powered Solana trading bot. Provides a unified interface for market data,
//! order management, portfolio tracking, strategy execution, and trade processing.
//!
//! Version dependencies:
//! - chrono = "0.4"
//! - rust_decimal = "1.30"
//! - uuid = "1.4"
//! - serde = "1.0"
//! - tokio = "1.28"
//! - metrics = "0.20"

// Re-export market data models
pub mod market;
pub use market::{
    MarketData,
    OrderBook,
    validate_price,
    validate_volume,
};

// Re-export order management models
pub mod order;
pub use order::{
    Order,
    OrderType,
    OrderStatus,
};

// Re-export portfolio management models
pub mod portfolio;
pub use portfolio::{
    Portfolio,
    calculate_portfolio_value,
    get_position_exposure,
};

// Re-export strategy models
pub mod strategy;
pub use strategy::{
    Strategy,
    StrategyType,
    validate_strategy_params,
};

// Re-export trade execution models
pub mod trade;
pub use trade::{
    Trade,
    TradeType,
    calculate_trade_value,
    calculate_slippage,
};

// Common error types for model operations
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ModelError {
    #[error("market error: {0}")]
    Market(#[from] market::MarketError),
    
    #[error("order error: {0}")]
    Order(#[from] order::OrderError),
    
    #[error("portfolio error: {0}")]
    Portfolio(#[from] portfolio::PortfolioError),
    
    #[error("strategy error: {0}")]
    Strategy(#[from] strategy::StrategyError),
    
    #[error("trade error: {0}")]
    Trade(#[from] trade::TradeError),
}

/// Initializes metrics collection for all models
pub fn initialize_metrics() {
    metrics::gauge!("trading_bot.models.initialized", 1.0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn test_model_error_conversion() {
        let market_err = market::MarketError::InvalidPrice("test".to_string());
        let model_err: ModelError = market_err.into();
        assert!(matches!(model_err, ModelError::Market(_)));
    }

    #[test]
    fn test_market_data_reexport() {
        let market_data = MarketData::new(
            "SOL/USDC".to_string(),
            "jupiter".to_string(),
            dec!(23.45678900),
            dec!(100.000000),
        );
        assert!(market_data.is_ok());
    }

    #[test]
    fn test_order_type_reexport() {
        let order_type = OrderType::Market;
        assert_eq!(order_type, OrderType::Market);
    }

    #[test]
    fn test_strategy_type_reexport() {
        let strategy_type = StrategyType::Grid;
        assert_eq!(strategy_type, StrategyType::Grid);
    }

    #[test]
    fn test_trade_type_reexport() {
        let trade_type = TradeType::Market;
        assert_eq!(trade_type, TradeType::Market);
    }
}