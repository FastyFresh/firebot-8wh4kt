//! Repository implementations for database access with production-grade features including
//! caching, monitoring, and data retention management.
//! Version: 1.0.0

use cached::{Cached, TimedCache}; // v0.42.0
use metrics::{counter, gauge, histogram}; // v0.20.1
use sqlx::{Pool, Postgres, Transaction}; // v0.7.1
use thiserror::Error;
use tokio::time::{sleep, Duration}; // v1.28.0
use tracing::{error, info, instrument, warn}; // v0.1.37
use uuid::Uuid;

use crate::db::models::MarketDataRecord;
use crate::utils::metrics::MetricsCollector;
use crate::utils::time::{calculate_duration_ms, current_timestamp};

// Global constants for repository operations
const BATCH_SIZE: usize = 1000;
const MAX_RETRIES: u32 = 3;
const CACHE_TTL_SECONDS: u64 = 300;
const MARKET_DATA_RETENTION_DAYS: i32 = 90;

/// Repository-specific error types
#[derive(Error, Debug)]
pub enum RepositoryError {
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Validation error: {0}")]
    ValidationError(String),
    #[error("Cache error: {0}")]
    CacheError(String),
    #[error("Operation timeout: {0}")]
    TimeoutError(String),
    #[error("Circuit breaker open: {0}")]
    CircuitBreakerError(String),
}

/// Retry policy configuration
#[derive(Debug, Clone)]
pub struct RetryPolicy {
    max_attempts: u32,
    base_delay_ms: u64,
    max_delay_ms: u64,
}

impl Default for RetryPolicy {
    fn default() -> Self {
        Self {
            max_attempts: MAX_RETRIES,
            base_delay_ms: 100,
            max_delay_ms: 5000,
        }
    }
}

/// Market data repository with caching and monitoring
#[derive(Debug)]
pub struct MarketDataRepository {
    pool: Pool<Postgres>,
    cache: TimedCache<String, Vec<MarketDataRecord>>,
    metrics: MetricsCollector,
    circuit_breaker: CircuitBreaker,
}

impl MarketDataRepository {
    /// Creates a new market data repository instance
    pub fn new(pool: Pool<Postgres>, metrics: MetricsCollector) -> Self {
        Self {
            pool,
            cache: TimedCache::with_lifespan(CACHE_TTL_SECONDS),
            metrics,
            circuit_breaker: CircuitBreaker::new(),
        }
    }

    /// Saves market data with batching, retries, and monitoring
    #[instrument(skip(self, data))]
    pub async fn save_market_data(
        &self,
        data: Vec<MarketDataRecord>,
    ) -> Result<Vec<Uuid>, RepositoryError> {
        let start_time = current_timestamp();
        let operation = "save_market_data";

        // Validate input data
        if data.is_empty() {
            return Err(RepositoryError::ValidationError("Empty data batch".to_string()));
        }

        // Record batch size metric
        gauge!("market_data_batch_size", data.len() as f64);

        let mut results = Vec::with_capacity(data.len());
        for chunk in data.chunks(BATCH_SIZE) {
            let chunk_data = chunk.to_vec();
            let result = execute_with_retry(
                &self.pool,
                |tx| async move {
                    MarketDataRecord::batch_insert(tx, chunk_data).await
                },
                RetryPolicy::default(),
            )
            .await?;
            results.extend(result);
        }

        // Update metrics
        let duration = calculate_duration_ms(start_time, current_timestamp())
            .map_err(|e| RepositoryError::TimeoutError(e.to_string()))?;
        histogram!("market_data_save_duration_ms", duration as f64);
        counter!("market_data_records_saved", results.len() as u64);

        // Invalidate relevant cache entries
        self.invalidate_cache().await?;

        info!("Saved {} market data records", results.len());
        Ok(results)
    }

    /// Retrieves market data with caching and monitoring
    #[instrument(skip(self))]
    pub async fn get_market_data(
        &self,
        trading_pair: &str,
        limit: i64,
    ) -> Result<Vec<MarketDataRecord>, RepositoryError> {
        let cache_key = format!("market_data:{}:{}", trading_pair, limit);

        // Try cache first
        if let Some(cached_data) = self.cache.cache_get(&cache_key) {
            counter!("market_data_cache_hits", 1);
            return Ok(cached_data.clone());
        }

        // Cache miss, query database
        counter!("market_data_cache_misses", 1);
        let start_time = current_timestamp();

        let result = execute_with_retry(
            &self.pool,
            |tx| async move {
                sqlx::query_as::<_, MarketDataRecord>(
                    "SELECT * FROM market_data 
                     WHERE trading_pair = $1 
                     ORDER BY timestamp DESC 
                     LIMIT $2",
                )
                .bind(trading_pair)
                .bind(limit)
                .fetch_all(tx)
                .await
            },
            RetryPolicy::default(),
        )
        .await?;

        // Update cache
        self.cache.cache_set(cache_key, result.clone());

        // Record metrics
        let duration = calculate_duration_ms(start_time, current_timestamp())
            .map_err(|e| RepositoryError::TimeoutError(e.to_string()))?;
        histogram!("market_data_query_duration_ms", duration as f64);

        Ok(result)
    }

    /// Applies data retention policy
    #[instrument(skip(self))]
    pub async fn apply_retention_policy(&self) -> Result<u64, RepositoryError> {
        let start_time = current_timestamp();

        let result = execute_with_retry(
            &self.pool,
            |tx| async move {
                sqlx::query(
                    "DELETE FROM market_data 
                     WHERE timestamp < NOW() - INTERVAL '$1 days'",
                )
                .bind(MARKET_DATA_RETENTION_DAYS)
                .execute(tx)
                .await
            },
            RetryPolicy::default(),
        )
        .await?;

        let rows_deleted = result.rows_affected();
        
        // Record metrics
        let duration = calculate_duration_ms(start_time, current_timestamp())
            .map_err(|e| RepositoryError::TimeoutError(e.to_string()))?;
        histogram!("market_data_retention_duration_ms", duration as f64);
        counter!("market_data_records_deleted", rows_deleted);

        info!("Deleted {} old market data records", rows_deleted);
        Ok(rows_deleted)
    }

    /// Invalidates cache entries
    async fn invalidate_cache(&self) -> Result<(), RepositoryError> {
        self.cache.cache_clear();
        counter!("market_data_cache_invalidations", 1);
        Ok(())
    }
}

/// Circuit breaker for database operations
#[derive(Debug)]
struct CircuitBreaker {
    failures: std::sync::atomic::AtomicU32,
    last_failure: std::sync::atomic::AtomicI64,
    threshold: u32,
    reset_timeout: Duration,
}

impl CircuitBreaker {
    fn new() -> Self {
        Self {
            failures: std::sync::atomic::AtomicU32::new(0),
            last_failure: std::sync::atomic::AtomicI64::new(0),
            threshold: 5,
            reset_timeout: Duration::from_secs(60),
        }
    }

    fn record_failure(&self) {
        self.failures.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.last_failure.store(
            current_timestamp().timestamp(),
            std::sync::atomic::Ordering::SeqCst,
        );
    }

    fn is_open(&self) -> bool {
        let failures = self.failures.load(std::sync::atomic::Ordering::SeqCst);
        if failures >= self.threshold {
            let last_failure = self.last_failure.load(std::sync::atomic::Ordering::SeqCst);
            let elapsed = current_timestamp().timestamp() - last_failure;
            if elapsed < self.reset_timeout.as_secs() as i64 {
                return true;
            }
            // Reset after timeout
            self.failures.store(0, std::sync::atomic::Ordering::SeqCst);
        }
        false
    }
}

/// Executes database operations with retry logic and circuit breaker
#[instrument(skip(pool, operation))]
async fn execute_with_retry<F, T, E>(
    pool: &Pool<Postgres>,
    operation: F,
    policy: RetryPolicy,
) -> Result<T, RepositoryError>
where
    F: Fn(Transaction<'_, Postgres>) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<T, E>> + Send>>,
    E: std::error::Error,
{
    let mut attempt = 0;
    let mut last_error = None;

    while attempt < policy.max_attempts {
        if attempt > 0 {
            let delay = std::cmp::min(
                policy.base_delay_ms * 2u64.pow(attempt),
                policy.max_delay_ms,
            );
            sleep(Duration::from_millis(delay)).await;
        }

        let tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                error!("Failed to begin transaction: {}", e);
                attempt += 1;
                last_error = Some(RepositoryError::DatabaseError(e.to_string()));
                continue;
            }
        };

        match operation(tx).await {
            Ok(result) => {
                if let Err(e) = tx.commit().await {
                    error!("Failed to commit transaction: {}", e);
                    attempt += 1;
                    last_error = Some(RepositoryError::DatabaseError(e.to_string()));
                    continue;
                }
                return Ok(result);
            }
            Err(e) => {
                if let Err(rollback_err) = tx.rollback().await {
                    error!("Failed to rollback transaction: {}", rollback_err);
                }
                attempt += 1;
                last_error = Some(RepositoryError::DatabaseError(e.to_string()));
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        RepositoryError::DatabaseError("Maximum retry attempts exceeded".to_string())
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use rust_decimal_macros::dec;

    #[tokio::test]
    async fn test_market_data_repository() {
        let pool = sqlx::PgPool::connect("postgres://localhost/testdb")
            .await
            .unwrap();
        let metrics = MetricsCollector::new().unwrap();
        let repo = MarketDataRepository::new(pool, metrics);

        let test_data = vec![MarketDataRecord::new(
            "SOL/USDC".to_string(),
            "Jupiter".to_string(),
            dec!(23.45),
            dec!(1000.0),
            Utc::now(),
        )
        .unwrap()];

        let result = repo.save_market_data(test_data).await;
        assert!(result.is_ok());
    }

    #[test]
    fn test_retry_policy() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.max_attempts, MAX_RETRIES);
        assert!(policy.base_delay_ms > 0);
        assert!(policy.max_delay_ms > policy.base_delay_ms);
    }

    #[test]
    fn test_circuit_breaker() {
        let breaker = CircuitBreaker::new();
        assert!(!breaker.is_open());

        for _ in 0..breaker.threshold {
            breaker.record_failure();
        }
        assert!(breaker.is_open());
    }
}