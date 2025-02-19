//! Authentication module for Solana trading bot API with enhanced security features
//! Version: 1.0.0
//! Security Notice: This module handles sensitive authentication operations

use axum::{
    extract::ClientIp,
    Json,
    http::{HeaderMap, StatusCode},
}; // v0.6.18
use jsonwebtoken::{encode, decode, Header, Validation, EncodingKey, DecodingKey}; // v8.1.1
use redis::{Client as RedisClient, AsyncCommands}; // v0.23.0
use serde::{Deserialize, Serialize}; // v1.0.164
use tracing::{error, info, instrument, warn}; // v0.1.37
use validator::Validate; // v0.16.0

use crate::utils::crypto::{verify_wallet_signature, generate_nonce};
use crate::config::security::SecurityConfig;

use std::net::IpAddr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

// Global constants for authentication
const AUTH_NONCE_PREFIX: &str = "auth:nonce:";
const AUTH_SESSION_PREFIX: &str = "auth:session:";
const AUTH_BLACKLIST_PREFIX: &str = "auth:blacklist:";
const MAX_AUTH_ATTEMPTS: u32 = 5;
const RATE_LIMIT_WINDOW: u32 = 300;

/// Authentication request with validation
#[derive(Debug, Deserialize, Validate)]
pub struct AuthRequest {
    #[validate(length(min = 32, max = 44))]
    pub wallet_address: String,
    #[validate(length(min = 88, max = 88))]
    pub signature: String,
    #[validate(length(min = 32, max = 44))]
    pub nonce: String,
    pub device_id: Option<String>,
}

/// Authentication response containing JWT tokens
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    access_token: String,
    refresh_token: String,
    expires_in: i64,
}

/// Token refresh request
#[derive(Debug, Deserialize, Validate)]
pub struct RefreshRequest {
    #[validate(length(min = 1))]
    pub refresh_token: String,
}

/// Token refresh response
#[derive(Debug, Serialize)]
pub struct RefreshResponse {
    access_token: String,
    expires_in: i64,
}

/// JWT claims structure
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String, // wallet address
    exp: i64,    // expiration time
    iat: i64,    // issued at
    device_id: Option<String>,
}

/// Authenticates a Solana wallet with rate limiting and audit logging
#[instrument(skip(auth_request, redis_client, security_config))]
pub async fn authenticate_wallet(
    client_ip: ClientIp,
    Json(auth_request): Json<AuthRequest>,
    redis_client: Arc<RedisClient>,
    security_config: Arc<SecurityConfig>,
) -> Result<(HeaderMap, Json<AuthResponse>), (StatusCode, String)> {
    // Validate request format
    if let Err(e) = auth_request.validate() {
        error!("Invalid authentication request: {}", e);
        return Err((StatusCode::BAD_REQUEST, "Invalid request format".to_string()));
    }

    // Check rate limiting
    let rate_key = format!("rate:auth:{}", client_ip.0);
    let mut redis_conn = redis_client.get_async_connection().await
        .map_err(|e| {
            error!("Redis connection failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Authentication service unavailable".to_string())
        })?;

    let attempts: u32 = redis_conn.get(&rate_key).await.unwrap_or(0);
    if attempts >= MAX_AUTH_ATTEMPTS {
        warn!("Rate limit exceeded for IP: {}", client_ip.0);
        return Err((StatusCode::TOO_MANY_REQUESTS, "Rate limit exceeded".to_string()));
    }

    // Verify stored nonce
    let nonce_key = format!("{}{}", AUTH_NONCE_PREFIX, auth_request.wallet_address);
    let stored_nonce: Option<String> = redis_conn.get(&nonce_key).await.map_err(|e| {
        error!("Nonce verification failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed".to_string())
    })?;

    if stored_nonce.as_deref() != Some(&auth_request.nonce) {
        warn!("Invalid nonce for wallet: {}", auth_request.wallet_address);
        return Err((StatusCode::UNAUTHORIZED, "Invalid nonce".to_string()));
    }

    // Verify wallet signature
    let message = format!("Sign in to Trading Bot with nonce: {}", auth_request.nonce);
    if !verify_wallet_signature(message, auth_request.signature, auth_request.wallet_address.clone())
        .map_err(|e| (StatusCode::BAD_REQUEST, e))? {
        redis_conn.incr(&rate_key, 1).await.ok();
        redis_conn.expire(&rate_key, RATE_LIMIT_WINDOW).await.ok();
        return Err((StatusCode::UNAUTHORIZED, "Invalid signature".to_string()));
    }

    // Generate JWT tokens
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let claims = Claims {
        sub: auth_request.wallet_address.clone(),
        exp: now + security_config.jwt.token_expiry,
        iat: now,
        device_id: auth_request.device_id.clone(),
    };

    let refresh_claims = Claims {
        sub: auth_request.wallet_address.clone(),
        exp: now + security_config.jwt.refresh_expiry,
        iat: now,
        device_id: auth_request.device_id,
    };

    let access_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(security_config.jwt.secret_key.as_bytes()),
    ).map_err(|e| {
        error!("Token generation failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed".to_string())
    })?;

    let refresh_token = encode(
        &Header::default(),
        &refresh_claims,
        &EncodingKey::from_secret(security_config.jwt.secret_key.as_bytes()),
    ).map_err(|e| {
        error!("Refresh token generation failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed".to_string())
    })?;

    // Store session information
    let session_key = format!("{}{}", AUTH_SESSION_PREFIX, auth_request.wallet_address);
    redis_conn.set(&session_key, &refresh_token).await.map_err(|e| {
        error!("Session storage failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Authentication failed".to_string())
    })?;
    redis_conn.expire(&session_key, security_config.jwt.refresh_expiry as usize).await.ok();

    // Clean up nonce
    redis_conn.del(&nonce_key).await.ok();

    // Set security headers
    let mut headers = HeaderMap::new();
    headers.insert("X-Content-Type-Options", "nosniff".parse().unwrap());
    headers.insert("X-Frame-Options", "DENY".parse().unwrap());
    headers.insert("X-XSS-Protection", "1; mode=block".parse().unwrap());

    info!("Authentication successful for wallet: {}", auth_request.wallet_address);
    Ok((headers, Json(AuthResponse {
        access_token,
        refresh_token,
        expires_in: security_config.jwt.token_expiry,
    })))
}

/// Refreshes access token using a valid refresh token
#[instrument(skip(refresh_request, redis_client, security_config))]
pub async fn refresh_token(
    Json(refresh_request): Json<RefreshRequest>,
    redis_client: Arc<RedisClient>,
    security_config: Arc<SecurityConfig>,
) -> Result<Json<RefreshResponse>, (StatusCode, String)> {
    // Validate refresh token
    let validation = Validation::default();
    let token_data = decode::<Claims>(
        &refresh_request.refresh_token,
        &DecodingKey::from_secret(security_config.jwt.secret_key.as_bytes()),
        &validation,
    ).map_err(|e| {
        error!("Invalid refresh token: {}", e);
        (StatusCode::UNAUTHORIZED, "Invalid refresh token".to_string())
    })?;

    // Check if token is blacklisted
    let mut redis_conn = redis_client.get_async_connection().await
        .map_err(|e| {
            error!("Redis connection failed: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, "Token refresh failed".to_string())
        })?;

    let blacklist_key = format!("{}{}", AUTH_BLACKLIST_PREFIX, refresh_request.refresh_token);
    let is_blacklisted: bool = redis_conn.exists(&blacklist_key).await.unwrap_or(false);
    if is_blacklisted {
        return Err((StatusCode::UNAUTHORIZED, "Token has been revoked".to_string()));
    }

    // Generate new access token
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let claims = Claims {
        sub: token_data.claims.sub,
        exp: now + security_config.jwt.token_expiry,
        iat: now,
        device_id: token_data.claims.device_id,
    };

    let access_token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(security_config.jwt.secret_key.as_bytes()),
    ).map_err(|e| {
        error!("Token generation failed: {}", e);
        (StatusCode::INTERNAL_SERVER_ERROR, "Token refresh failed".to_string())
    })?;

    info!("Token refreshed successfully for wallet: {}", claims.sub);
    Ok(Json(RefreshResponse {
        access_token,
        expires_in: security_config.jwt.token_expiry,
    }))
}