//! API routes configuration for Solana trading bot with comprehensive security and monitoring
//! Version: 1.0.0

use axum::{
    routing::{get, post},
    Router,
    Extension,
    middleware::{self, from_fn},
}; // v0.6.18
use tower::{ServiceBuilder, limit::RateLimitLayer}; // v0.4.13
use metrics::{counter, histogram}; // v0.20.1

use std::sync::Arc;
use std::time::Duration;

use crate::api::endpoints::{
    handle_auth_challenge,
    handle_create_order,
};
use crate::api::middleware::{
    auth_middleware,
    rate_limit_middleware,
    CircuitBreaker,
};
use crate::utils::logger::log_error;
use crate::utils::metrics::MetricsCollector;
use crate::config::security::SecurityConfig;

// API configuration constants
const API_VERSION: &str = "v1";
const BASE_PATH: &str = "/api/v1";
const REQUEST_TIMEOUT_MS: u64 = 500; // 500ms max latency requirement
const MAX_REQUESTS_PER_MINUTE: u32 = 1000;

/// Enhanced API router with comprehensive monitoring and security features
#[derive(Debug)]
pub struct ApiRouter {
    router: Router,
    state: Arc<AppState>,
    circuit_breaker: CircuitBreaker,
    metrics: Arc<MetricsCollector>,
}

impl ApiRouter {
    /// Creates a new API router with enhanced configuration
    #[tracing::instrument(skip(state))]
    pub fn new(state: Arc<AppState>) -> Self {
        let metrics = Arc::new(MetricsCollector::new().expect("Failed to initialize metrics"));
        
        Self {
            router: Router::new(),
            state,
            circuit_breaker: CircuitBreaker::new(),
            metrics,
        }
    }

    /// Configures comprehensive middleware chain
    #[tracing::instrument(skip(self))]
    fn configure_middleware(&mut self) -> &mut Self {
        let middleware_stack = ServiceBuilder::new()
            // Circuit breaker for system stability
            .layer(from_fn(move |req, next| {
                let cb = self.circuit_breaker.clone();
                async move {
                    cb.check_health().await?;
                    next.run(req).await
                }
            }))
            // Request timeout enforcement
            .timeout(Duration::from_millis(REQUEST_TIMEOUT_MS))
            // Rate limiting
            .layer(RateLimitLayer::new(
                MAX_REQUESTS_PER_MINUTE,
                Duration::from_secs(60),
            ))
            // Authentication
            .layer(from_fn(auth_middleware))
            // Request tracing
            .layer(middleware::from_fn(|req, next| {
                counter!("api.requests.total").increment(1);
                let timer = histogram!("api.request.duration").start_timer();
                async move {
                    let response = next.run(req).await;
                    timer.stop_and_record();
                    response
                }
            }));

        self.router = self.router.layer(middleware_stack);
        self
    }

    /// Configures trading-related routes with monitoring
    #[tracing::instrument(skip(self))]
    fn configure_trading_routes(&mut self) -> &mut Self {
        self.router = self.router
            .route(
                &format!("{}/order", BASE_PATH),
                post(handle_create_order)
                    .layer(from_fn(|req, next| {
                        let timer = histogram!("api.trade.execution_time").start_timer();
                        async move {
                            let response = next.run(req).await;
                            timer.stop_and_record();
                            response
                        }
                    }))
            );
        self
    }

    /// Configures authentication routes with security measures
    #[tracing::instrument(skip(self))]
    fn configure_auth_routes(&mut self) -> &mut Self {
        self.router = self.router
            .route(
                &format!("{}/auth/challenge", BASE_PATH),
                post(handle_auth_challenge)
            );
        self
    }

    /// Configures health check endpoint
    #[tracing::instrument(skip(self))]
    fn configure_health_routes(&mut self) -> &mut Self {
        self.router = self.router
            .route("/health", get(|| async { "OK" }));
        self
    }

    /// Builds the final router with all configurations
    #[tracing::instrument(skip(self))]
    pub fn build(mut self) -> Router {
        self.configure_middleware()
            .configure_trading_routes()
            .configure_auth_routes()
            .configure_health_routes();

        self.router
            .layer(Extension(self.state.clone()))
            .layer(Extension(self.metrics.clone()))
    }
}

/// Creates and configures the main API router
#[tracing::instrument(skip(app_state))]
pub fn create_router(app_state: Arc<AppState>) -> Router {
    ApiRouter::new(app_state).build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use tower::ServiceExt;

    #[tokio::test]
    async fn test_router_configuration() {
        let state = Arc::new(AppState::default());
        let router = create_router(state);
        
        // Test health endpoint
        let response = router
            .oneshot(Request::builder().uri("/health").body(()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
    }

    #[tokio::test]
    async fn test_rate_limiting() {
        let state = Arc::new(AppState::default());
        let router = create_router(state);
        
        // Send requests at rate higher than limit
        for _ in 0..MAX_REQUESTS_PER_MINUTE + 1 {
            let response = router
                .clone()
                .oneshot(Request::builder().uri("/health").body(()).unwrap())
                .await
                .unwrap();
            
            if response.status() == 429 {
                return; // Rate limit worked
            }
        }
        
        panic!("Rate limiting did not trigger");
    }
}