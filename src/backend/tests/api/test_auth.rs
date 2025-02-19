use mockall::predicate::*;
use serde_json::json;
use test_context::{test_context, AsyncTestContext};
use tokio::sync::Mutex;
use std::sync::Arc;
use std::time::Duration;

use crate::api::auth::{
    authenticate_wallet,
    generate_auth_nonce,
    refresh_token,
    AuthRequest,
    RefreshRequest,
};
use crate::config::security::{SecurityConfig, JWTConfig, RateLimitConfig};
use crate::utils::crypto::verify_wallet_signature;

// Test constants
const TEST_WALLET_ADDRESS: &str = "DxPv2QMA5cWR5Xj7BHt45Xx3vXvHGkTGVZen2Y3pVH9L";
const TEST_SIGNATURE: &str = "5j3TPrfzXP5GUHwzxEZqHqbQxGVHGgpZe9TUpeaCbNwJKWKzRJKNX9PeQWJrV5bz3Qj8Y5TJ8dWZxJGVJGKrJNpe";
const TEST_NONCE: &str = "9XDtxJv2DKKyfAHJGvZ9MFt5bKyXbfQPqHrhPF9zNNfw";

/// Enhanced test context with security testing capabilities
pub struct TestContext {
    pub security_config: Arc<SecurityConfig>,
    pub redis_client: Arc<redis::Client>,
    pub rate_limiter: Arc<Mutex<HashMap<String, (u32, Instant)>>>,
    pub audit_logs: Arc<Mutex<Vec<String>>>,
}

impl AsyncTestContext for TestContext {
    async fn setup() -> Self {
        // Initialize test JWT config
        let jwt_config = JWTConfig {
            secret_key: "test_secret_key_for_jwt_token_generation_and_validation".to_string(),
            token_expiry: 3600,
            refresh_expiry: 86400,
            algorithm: jsonwebtoken::Algorithm::HS256,
        };

        // Initialize test rate limit config
        let rate_limit_config = RateLimitConfig {
            max_requests: 5,
            window_size: Duration::from_secs(60),
            max_failed_attempts: 3,
        };

        // Create test security config
        let security_config = Arc::new(SecurityConfig::new(
            jwt_config,
            Default::default(), // KMS config not needed for tests
            rate_limit_config,
            Default::default(), // Audit config
            Default::default(), // Access control config
        ).unwrap());

        // Initialize test Redis client
        let redis_client = Arc::new(redis::Client::open("redis://127.0.0.1:6379").unwrap());

        // Initialize rate limiter and audit logs for testing
        let rate_limiter = Arc::new(Mutex::new(HashMap::new()));
        let audit_logs = Arc::new(Mutex::new(Vec::new()));

        Self {
            security_config,
            redis_client,
            rate_limiter,
            audit_logs,
        }
    }

    async fn teardown(self) {
        // Clean up test data from Redis
        let mut conn = self.redis_client.get_async_connection().await.unwrap();
        let _: () = redis::cmd("FLUSHDB").query_async(&mut conn).await.unwrap();
    }
}

#[tokio::test]
async fn test_wallet_authentication_success() {
    let ctx = TestContext::setup().await;
    
    // Generate test nonce and store in Redis
    let nonce = generate_auth_nonce();
    let mut conn = ctx.redis_client.get_async_connection().await.unwrap();
    let _: () = redis::cmd("SET")
        .arg(format!("auth:nonce:{}", TEST_WALLET_ADDRESS))
        .arg(&nonce)
        .query_async(&mut conn)
        .await
        .unwrap();

    // Create valid authentication request
    let auth_request = AuthRequest {
        wallet_address: TEST_WALLET_ADDRESS.to_string(),
        signature: TEST_SIGNATURE.to_string(),
        nonce: nonce.clone(),
        device_id: Some("test_device".to_string()),
    };

    // Test authentication
    let result = authenticate_wallet(
        "127.0.0.1:8000".parse().unwrap(),
        serde_json::to_value(auth_request).unwrap().into(),
        ctx.redis_client.clone(),
        ctx.security_config.clone(),
    ).await;

    assert!(result.is_ok());
    let (headers, response) = result.unwrap();

    // Verify response headers
    assert_eq!(headers.get("X-Content-Type-Options").unwrap(), "nosniff");
    assert_eq!(headers.get("X-Frame-Options").unwrap(), "DENY");

    // Verify JWT tokens
    let response = response.0;
    assert!(!response.access_token.is_empty());
    assert!(!response.refresh_token.is_empty());
    assert_eq!(response.expires_in, ctx.security_config.jwt.token_expiry);

    ctx.teardown().await;
}

#[tokio::test]
async fn test_rate_limiting() {
    let ctx = TestContext::setup().await;
    let client_ip = "127.0.0.1:8000".parse().unwrap();

    // Attempt authentication multiple times
    for i in 0..6 {
        let auth_request = AuthRequest {
            wallet_address: TEST_WALLET_ADDRESS.to_string(),
            signature: "invalid_signature".to_string(),
            nonce: TEST_NONCE.to_string(),
            device_id: None,
        };

        let result = authenticate_wallet(
            client_ip,
            serde_json::to_value(auth_request).unwrap().into(),
            ctx.redis_client.clone(),
            ctx.security_config.clone(),
        ).await;

        if i < 5 {
            assert!(result.is_err());
            assert_eq!(result.unwrap_err().0, axum::http::StatusCode::UNAUTHORIZED);
        } else {
            assert!(result.is_err());
            assert_eq!(result.unwrap_err().0, axum::http::StatusCode::TOO_MANY_REQUESTS);
        }
    }

    ctx.teardown().await;
}

#[tokio::test]
async fn test_token_refresh() {
    let ctx = TestContext::setup().await;

    // Generate initial tokens
    let auth_request = AuthRequest {
        wallet_address: TEST_WALLET_ADDRESS.to_string(),
        signature: TEST_SIGNATURE.to_string(),
        nonce: TEST_NONCE.to_string(),
        device_id: None,
    };

    let (_, initial_response) = authenticate_wallet(
        "127.0.0.1:8000".parse().unwrap(),
        serde_json::to_value(auth_request).unwrap().into(),
        ctx.redis_client.clone(),
        ctx.security_config.clone(),
    ).await.unwrap();

    // Test token refresh
    let refresh_request = RefreshRequest {
        refresh_token: initial_response.0.refresh_token,
    };

    let refresh_result = refresh_token(
        serde_json::to_value(refresh_request).unwrap().into(),
        ctx.redis_client.clone(),
        ctx.security_config.clone(),
    ).await;

    assert!(refresh_result.is_ok());
    let new_tokens = refresh_result.unwrap().0;
    assert!(!new_tokens.access_token.is_empty());
    assert_ne!(new_tokens.access_token, initial_response.0.access_token);

    ctx.teardown().await;
}

#[tokio::test]
async fn test_invalid_nonce() {
    let ctx = TestContext::setup().await;

    let auth_request = AuthRequest {
        wallet_address: TEST_WALLET_ADDRESS.to_string(),
        signature: TEST_SIGNATURE.to_string(),
        nonce: "invalid_nonce".to_string(),
        device_id: None,
    };

    let result = authenticate_wallet(
        "127.0.0.1:8000".parse().unwrap(),
        serde_json::to_value(auth_request).unwrap().into(),
        ctx.redis_client.clone(),
        ctx.security_config.clone(),
    ).await;

    assert!(result.is_err());
    assert_eq!(result.unwrap_err().0, axum::http::StatusCode::UNAUTHORIZED);

    ctx.teardown().await;
}

#[tokio::test]
async fn test_security_audit_logging() {
    let ctx = TestContext::setup().await;
    
    // Enable audit logging for test
    let mut audit_logs = ctx.audit_logs.lock().await;
    
    // Test successful authentication
    let auth_request = AuthRequest {
        wallet_address: TEST_WALLET_ADDRESS.to_string(),
        signature: TEST_SIGNATURE.to_string(),
        nonce: TEST_NONCE.to_string(),
        device_id: Some("test_device".to_string()),
    };

    let _ = authenticate_wallet(
        "127.0.0.1:8000".parse().unwrap(),
        serde_json::to_value(auth_request).unwrap().into(),
        ctx.redis_client.clone(),
        ctx.security_config.clone(),
    ).await;

    // Verify audit logs
    assert!(!audit_logs.is_empty());
    let last_log = audit_logs.last().unwrap();
    assert!(last_log.contains(TEST_WALLET_ADDRESS));
    assert!(last_log.contains("Authentication attempt"));

    ctx.teardown().await;
}