//! Middleware components for the Solana trading bot API providing authentication,
//! request logging, metrics collection, and rate limiting with Redis cluster support.
//! Version: 1.0.0

use axum::{
    extract::{Request, Next},
    http::{HeaderMap, StatusCode},
    response::Response,
}; // v0.6.18
use tower::{Service, ServiceBuilder}; // v0.4.13
use tracing::{error, info, instrument, warn}; // v0.1.37
use redis::{
    cluster::ClusterClient as RedisClusterClient,
    AsyncCommands,
}; // v0.23.0
use circuit_breaker::{CircuitBreaker, CircuitBreakerConfig}; // v0.1.0
use uuid::Uuid;

use crate::api::auth::validate_token;
use crate::utils::logger::log_error;
use crate::utils::metrics::MetricsCollector;

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

// Global constants
const RATE_LIMIT_PREFIX: &str = "rate:limit:";
const REQUEST_TIMEOUT_MS: u64 = 30000;
const MAX_RETRIES: u32 = 3;
const CIRCUIT_BREAKER_THRESHOLD: f64 = 0.5;

/// Rate limiter implementation with Redis cluster support and circuit breaker
#[derive(Debug, Clone)]
pub struct RateLimiter {
    redis_client: Arc<RedisClusterClient>,
    circuit_breaker: Arc<CircuitBreaker>,
    max_requests: u32,
    window_seconds: u32,
    metrics: Arc<MetricsCollector>,
}

impl RateLimiter {
    /// Creates new rate limiter instance with cluster support
    pub fn new(
        redis_client: RedisClusterClient,
        max_requests: u32,
        window_seconds: u32,
        metrics: Arc<MetricsCollector>,
    ) -> Self {
        let circuit_breaker_config = CircuitBreakerConfig::new()
            .failure_threshold(CIRCUIT_BREAKER_THRESHOLD)
            .retry_timeout(std::time::Duration::from_secs(60));

        Self {
            redis_client: Arc::new(redis_client),
            circuit_breaker: Arc::new(CircuitBreaker::new(circuit_breaker_config)),
            max_requests,
            window_seconds,
            metrics,
        }
    }

    /// Checks if request is within rate limits using sliding window
    #[instrument(skip(self))]
    async fn check_rate_limit(&self, key: String) -> Result<bool, String> {
        if !self.circuit_breaker.can_execute() {
            return Err("Circuit breaker is open".to_string());
        }

        let mut redis_conn = self.redis_client.get_async_connection().await
            .map_err(|e| format!("Redis connection failed: {}", e))?;

        let current_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u32;

        let window_start = current_time - self.window_seconds;

        // Atomic rate limit check and update
        let pipeline_result: Result<(u32, ()), _> = redis::pipe()
            .atomic()
            .zremrangebyscore(&key, 0, window_start as i64)
            .zadd(&key, current_time.to_string(), current_time as i64)
            .zcard(&key)
            .expire(&key, self.window_seconds as usize)
            .query_async(&mut redis_conn)
            .await;

        match pipeline_result {
            Ok((count, _)) => {
                let within_limit = count <= self.max_requests;
                self.metrics.record_rate_limit_hit(!within_limit).await.ok();
                Ok(within_limit)
            }
            Err(e) => {
                self.circuit_breaker.record_failure();
                Err(format!("Rate limit check failed: {}", e))
            }
        }
    }
}

/// Authentication middleware with enhanced security features
#[instrument(skip(request, next), fields(correlation_id))]
pub async fn auth_middleware(
    mut request: Request,
    next: Next,
) -> Result<Response, (StatusCode, String)> {
    // Generate and attach correlation ID
    let correlation_id = Uuid::new_v4().to_string();
    request.extensions_mut().insert(correlation_id.clone());

    // Extract and validate JWT token
    let token = match request.headers().get("Authorization") {
        Some(auth_header) => {
            let auth_str = auth_header.to_str().map_err(|_| {
                (StatusCode::UNAUTHORIZED, "Invalid authorization header".to_string())
            })?;
            auth_str.replace("Bearer ", "")
        }
        None => return Err((StatusCode::UNAUTHORIZED, "Missing authorization header".to_string())),
    };

    // Validate token with comprehensive security checks
    let wallet_data = validate_token(&token).map_err(|e| {
        log_error(Box::new(e), "Token validation failed".into(), Some(correlation_id.clone()));
        (StatusCode::UNAUTHORIZED, "Invalid token".to_string())
    })?;

    // Add wallet address and permissions to request extensions
    request.extensions_mut().insert(wallet_data);

    // Forward request to next middleware
    Ok(next.run(request).await)
}

/// Advanced rate limiting middleware with Redis cluster support
#[instrument(skip(request, next, rate_limiter), fields(correlation_id))]
pub async fn rate_limit_middleware(
    request: Request,
    next: Next,
    rate_limiter: Arc<RateLimiter>,
) -> Result<Response, (StatusCode, String)> {
    let correlation_id = request.extensions()
        .get::<String>()
        .map(|id| id.clone())
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    // Extract client IP for rate limiting
    let client_ip = request
        .headers()
        .get("X-Forwarded-For")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("unknown");

    let rate_limit_key = format!("{}{}", RATE_LIMIT_PREFIX, client_ip);

    // Check rate limit with circuit breaker protection
    match rate_limiter.check_rate_limit(rate_limit_key).await {
        Ok(true) => {
            // Request is within limits
            Ok(next.run(request).await)
        }
        Ok(false) => {
            warn!("Rate limit exceeded for IP: {}", client_ip);
            Err((
                StatusCode::TOO_MANY_REQUESTS,
                "Rate limit exceeded. Please try again later.".to_string(),
            ))
        }
        Err(e) => {
            error!("Rate limit check failed: {}", e);
            log_error(
                Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)),
                "Rate limit check failed".into(),
                Some(correlation_id),
            );
            Err((
                StatusCode::SERVICE_UNAVAILABLE,
                "Service temporarily unavailable".to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_auth_middleware() {
        let request = Request::builder()
            .header("Authorization", "Bearer valid_token")
            .body(())
            .unwrap();

        let response = auth_middleware(request, Next::new()).await;
        assert!(response.is_ok());
    }

    #[tokio::test]
    async fn test_rate_limiter() {
        let redis_client = RedisClusterClient::new(vec!["redis://localhost"]).unwrap();
        let metrics = Arc::new(MetricsCollector::new().unwrap());
        
        let rate_limiter = RateLimiter::new(
            redis_client,
            100,
            60,
            metrics,
        );

        let result = rate_limiter.check_rate_limit("test_key".to_string()).await;
        assert!(result.is_ok());
    }
}