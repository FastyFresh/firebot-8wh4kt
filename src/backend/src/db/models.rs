//! Core database models and schema definitions for the AI-powered Solana trading bot.
//! Implements SQLx database models with TimescaleDB optimization, comprehensive audit trails,
//! and advanced validation for market data, trades, and portfolio management.
//! Version: 1.0.0

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use sqlx::{postgres::PgPool, FromRow, Pool, Postgres};
use thiserror::Error;
use uuid::Uuid;
use serde::{Serialize, Deserialize};
use tracing::{error, info, instrument};

use crate::config::database::DatabaseConfig;

// Global constants for data retention and batch operations
const MARKET_DATA_RETENTION_DAYS: i32 = 90;
const TRADE_HISTORY_RETENTION_YEARS: i32 = 7;
const MAX_CONNECTION_RETRIES: i32 = 3;
const BATCH_INSERT_SIZE: usize = 1000;

/// Custom error types for database operations
#[derive(Error, Debug)]
pub enum DatabaseError {
    #[error("Database connection failed: {0}")]
    ConnectionError(String),
    #[error("Query execution failed: {0}")]
    QueryError(String),
    #[error("Data validation failed: {0}")]
    ValidationError(String),
    #[error("Schema initialization failed: {0}")]
    SchemaError(String),
}

/// Market data record with TimescaleDB optimization
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct MarketDataRecord {
    pub id: Uuid,
    pub trading_pair: String,
    pub exchange: String,
    pub price: Decimal,
    pub volume: Decimal,
    pub timestamp: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

impl MarketDataRecord {
    /// Creates a new validated market data record
    pub fn new(
        trading_pair: String,
        exchange: String,
        price: Decimal,
        volume: Decimal,
        timestamp: DateTime<Utc>,
    ) -> Result<Self, DatabaseError> {
        // Validate trading pair format
        if !trading_pair.contains('/') {
            return Err(DatabaseError::ValidationError(
                "Invalid trading pair format".to_string(),
            ));
        }

        // Validate price and volume
        if price <= Decimal::ZERO || volume <= Decimal::ZERO {
            return Err(DatabaseError::ValidationError(
                "Price and volume must be positive".to_string(),
            ));
        }

        Ok(Self {
            id: Uuid::new_v4(),
            trading_pair,
            exchange,
            price,
            volume,
            timestamp,
            created_at: Utc::now(),
            updated_at: None,
        })
    }

    /// Efficiently inserts multiple market data records
    #[instrument(skip(pool, records))]
    pub async fn batch_insert(
        pool: &Pool<Postgres>,
        records: Vec<MarketDataRecord>,
    ) -> Result<Vec<Uuid>, DatabaseError> {
        let mut inserted_ids = Vec::with_capacity(records.len());
        
        for chunk in records.chunks(BATCH_INSERT_SIZE) {
            let mut query_builder = sqlx::QueryBuilder::new(
                "INSERT INTO market_data (id, trading_pair, exchange, price, volume, timestamp, created_at) ",
            );

            query_builder.push_values(chunk, |mut b, record| {
                b.push_bind(record.id)
                    .push_bind(&record.trading_pair)
                    .push_bind(&record.exchange)
                    .push_bind(record.price)
                    .push_bind(record.volume)
                    .push_bind(record.timestamp)
                    .push_bind(record.created_at);
            });

            query_builder
                .push(" RETURNING id")
                .build()
                .fetch_all(pool)
                .await
                .map_err(|e| DatabaseError::QueryError(e.to_string()))?
                .into_iter()
                .map(|row: sqlx::postgres::PgRow| row.get("id"))
                .for_each(|id| inserted_ids.push(id));
        }

        Ok(inserted_ids)
    }
}

/// Portfolio record with risk management parameters
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct PortfolioRecord {
    pub id: Uuid,
    pub wallet_address: String,
    pub balance: Decimal,
    pub risk_params: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Trading position with comprehensive tracking
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct PositionRecord {
    pub id: Uuid,
    pub portfolio_id: Uuid,
    pub trading_pair: String,
    pub size: Decimal,
    pub entry_price: Decimal,
    pub current_price: Decimal,
    pub pnl: Decimal,
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
    pub closed_at: Option<DateTime<Utc>>,
}

/// Trading strategy performance metrics
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct StrategyRecord {
    pub id: Uuid,
    pub name: String,
    pub parameters: serde_json::Value,
    pub performance_score: f64,
    pub win_rate: f64,
    pub created_at: DateTime<Utc>,
    pub updated_at: Option<DateTime<Utc>>,
}

/// Initializes database schema with optimized indexes and partitioning
#[instrument(skip(pool))]
pub async fn initialize_database_schema(pool: &Pool<Postgres>) -> Result<(), DatabaseError> {
    // Enable TimescaleDB extension
    sqlx::query("CREATE EXTENSION IF NOT EXISTS timescaledb")
        .execute(pool)
        .await
        .map_err(|e| DatabaseError::SchemaError(e.to_string()))?;

    // Create market data hypertable
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS market_data (
            id UUID PRIMARY KEY,
            trading_pair TEXT NOT NULL,
            exchange TEXT NOT NULL,
            price DECIMAL NOT NULL,
            volume DECIMAL NOT NULL,
            timestamp TIMESTAMPTZ NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ
        );
        
        SELECT create_hypertable('market_data', 'timestamp', 
            chunk_time_interval => INTERVAL '1 day',
            if_not_exists => TRUE
        );
        
        CREATE INDEX IF NOT EXISTS idx_market_data_pair_time 
        ON market_data (trading_pair, timestamp DESC);
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DatabaseError::SchemaError(e.to_string()))?;

    // Create portfolio table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS portfolios (
            id UUID PRIMARY KEY,
            wallet_address TEXT NOT NULL,
            balance DECIMAL NOT NULL,
            risk_params JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ,
            CONSTRAINT unique_wallet UNIQUE (wallet_address)
        );
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DatabaseError::SchemaError(e.to_string()))?;

    // Create positions table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS positions (
            id UUID PRIMARY KEY,
            portfolio_id UUID NOT NULL,
            trading_pair TEXT NOT NULL,
            size DECIMAL NOT NULL,
            entry_price DECIMAL NOT NULL,
            current_price DECIMAL NOT NULL,
            pnl DECIMAL NOT NULL,
            status TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ,
            CONSTRAINT fk_portfolio
                FOREIGN KEY (portfolio_id)
                REFERENCES portfolios (id)
                ON DELETE CASCADE
        );
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DatabaseError::SchemaError(e.to_string()))?;

    // Create strategies table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS strategies (
            id UUID PRIMARY KEY,
            name TEXT NOT NULL,
            parameters JSONB NOT NULL,
            performance_score DOUBLE PRECISION NOT NULL,
            win_rate DOUBLE PRECISION NOT NULL,
            created_at TIMESTAMPTZ NOT NULL,
            updated_at TIMESTAMPTZ,
            CONSTRAINT unique_strategy_name UNIQUE (name)
        );
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| DatabaseError::SchemaError(e.to_string()))?;

    // Set up retention policies
    sqlx::query(&format!(
        "SELECT add_retention_policy('market_data', INTERVAL '{} days')",
        MARKET_DATA_RETENTION_DAYS
    ))
    .execute(pool)
    .await
    .map_err(|e| DatabaseError::SchemaError(e.to_string()))?;

    info!("Database schema initialized successfully");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_market_data_validation() {
        let valid_record = MarketDataRecord::new(
            "SOL/USDC".to_string(),
            "Jupiter".to_string(),
            dec!(23.45),
            dec!(1000.0),
            Utc::now(),
        );
        assert!(valid_record.is_ok());

        let invalid_pair = MarketDataRecord::new(
            "SOLUSDC".to_string(),
            "Jupiter".to_string(),
            dec!(23.45),
            dec!(1000.0),
            Utc::now(),
        );
        assert!(invalid_pair.is_err());

        let invalid_price = MarketDataRecord::new(
            "SOL/USDC".to_string(),
            "Jupiter".to_string(),
            dec!(-23.45),
            dec!(1000.0),
            Utc::now(),
        );
        assert!(invalid_price.is_err());
    }
}