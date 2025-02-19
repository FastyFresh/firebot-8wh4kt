//! Root module for the Solana trading bot API that exports and organizes all API-related functionality
//! with enhanced performance monitoring, circuit breaker patterns, and comprehensive security features.
//! Version: 1.0.0

use axum::{
    Router,
    middleware::{self, from_fn},
    routing::IntoMakeService,
}; // v0.6.18
use tower::{
    ServiceBuilder,
    limit::RateLimitLayer,
    timeout::TimeoutLayer,
}; // v0.4.13
use tracing::{error, info, instrument}; // v0.1.37
use metrics::{counter, histogram}; // v0.20.1

use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

// Re-export API components
pub use self::auth::{authenticate_wallet, validate_token, Claims};
pub use self::routes::{create_router, ApiRouter, health_check};
pub use self::middleware::{
    auth_middleware,
    rate_limit_middleware,
    logging_middleware,
    circuit_breaker_middleware,
    correlation_middleware,
};

// Internal modules
mod auth;
mod routes;
mod middleware;

// Global constants
const API_VERSION: &str = "v1";
const BASE_PATH: &str = "/api/v1";
const MAX_REQUEST_TIMEOUT: Duration = Duration::from_millis(500);
const CIRCUIT_BREAKER_THRESHOLD: f64 = 0.5;

/// Initializes the API with enhanced performance monitoring, circuit breaker patterns,
/// and comprehensive middleware chain
#[instrument(skip(app_state), fields(correlation_id = %Uuid::new_v4()))]
pub async fn init_api(app_state: Arc<AppState>) -> Router {
    info!("Initializing API with enhanced security and monitoring");
    
    // Initialize performance metrics
    counter!("api.initialization").increment(1);
    let initialization_timer = histogram!("api.initialization.duration").start_timer();

    // Create base router
    let router = create_router(app_state.clone());

    // Configure comprehensive middleware stack
    let router = router
        // Add correlation IDs for request tracking
        .layer(from_fn(correlation_middleware))
        
        // Circuit breaker for system stability
        .layer(from_fn(move |req, next| {
            circuit_breaker_middleware(
                req,
                next,
                CIRCUIT_BREAKER_THRESHOLD,
            )
        }))
        
        // Request timeout enforcement
        .layer(TimeoutLayer::new(MAX_REQUEST_TIMEOUT))
        
        // Rate limiting with Redis backing
        .layer(from_fn(move |req, next| {
            rate_limit_middleware(
                req,
                next,
                app_state.redis_client.clone(),
            )
        }))
        
        // Authentication and authorization
        .layer(from_fn(auth_middleware))
        
        // Performance monitoring and logging
        .layer(from_fn(logging_middleware))
        
        // Request tracing
        .layer(middleware::from_fn(|req, next| {
            let timer = histogram!("api.request.duration").start_timer();
            async move {
                let response = next.run(req).await;
                timer.stop_and_record();
                response
            }
        }));

    // Configure graceful shutdown
    let router = router.layer(
        ServiceBuilder::new()
            .load_shed()
            .concurrency_limit(app_state.config.max_connections as usize)
            .into_inner(),
    );

    initialization_timer.stop_and_record();
    info!("API initialization completed successfully");
    
    router
}

/// Represents the application state shared across API handlers
#[derive(Clone)]
pub struct AppState {
    pub config: Arc<crate::config::Config>,
    pub redis_client: Arc<redis::Client>,
    pub metrics: Arc<crate::utils::metrics::MetricsCollector>,
}

impl AppState {
    /// Creates a new AppState instance with the provided configuration
    pub fn new(
        config: crate::config::Config,
        redis_client: redis::Client,
        metrics: crate::utils::metrics::MetricsCollector,
    ) -> Self {
        Self {
            config: Arc::new(config),
            redis_client: Arc::new(redis_client),
            metrics: Arc::new(metrics),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_api_initialization() {
        let config = crate::config::Config::default();
        let redis_client = redis::Client::open("redis://localhost").unwrap();
        let metrics = crate::utils::metrics::MetricsCollector::new().unwrap();
        
        let app_state = Arc::new(AppState::new(config, redis_client, metrics));
        let router = init_api(app_state).await;
        
        // Test health endpoint
        let response = router
            .oneshot(Request::builder().uri("/health").body(()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
    }

    #[tokio::test]
    async fn test_circuit_breaker() {
        let app_state = Arc::new(AppState::default());
        let router = init_api(app_state).await;
        
        // Simulate high error rate
        for _ in 0..100 {
            let _ = router
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/v1/error")
                        .body(())
                        .unwrap()
                )
                .await;
        }
        
        // Circuit should be open
        let response = router
            .oneshot(Request::builder().uri("/health").body(()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), 503);
    }
}