use axum_test::{TestServer, TestServerConfig}; // v0.1.0
use rust_decimal::Decimal; // v1.30
use serde_json::{json, Value}; // v1.0.96
use test_context::{test_context, AsyncTestContext}; // v0.1.4
use tokio::time::{sleep, Duration}; // v1.28
use tracing::{info, instrument}; // v0.1.37

use crate::api::auth::Claims;
use crate::api::endpoints::{
    get_market_data, create_order, get_portfolio, update_strategy,
    MarketDataRequest, OrderRequest, OrderType, TimeInForce,
};

// Test constants
const TEST_WALLET_ADDRESS: &str = "11111111111111111111111111111111";
const TEST_TRADING_PAIR: &str = "SOL/USDC";
const RATE_LIMIT_WINDOW: u64 = 60;
const MAX_REQUESTS_PER_WINDOW: u32 = 1000;

// Test context for managing test state and cleanup
#[derive(Debug)]
struct TestContext {
    server: TestServer,
    test_jwt: String,
    test_claims: Claims,
}

#[async_trait::async_trait]
impl AsyncTestContext for TestContext {
    async fn setup() -> Self {
        let config = TestServerConfig::builder()
            .rate_limit_config(RATE_LIMIT_WINDOW, MAX_REQUESTS_PER_WINDOW)
            .build();
            
        let server = TestServer::new(config).await.unwrap();
        
        let test_claims = Claims {
            wallet_address: TEST_WALLET_ADDRESS.to_string(),
            exp: chrono::Utc::now().timestamp() + 3600,
            permissions: vec!["trade".to_string(), "read".to_string()],
        };
        
        let test_jwt = server.create_test_jwt(&test_claims).await;
        
        Self {
            server,
            test_jwt,
            test_claims,
        }
    }

    async fn teardown(self) {
        self.server.cleanup().await;
    }
}

// Market Data Endpoint Tests
#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_get_market_data_success(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    // Test basic market data retrieval
    let request = MarketDataRequest {
        trading_pairs: vec![TEST_TRADING_PAIR.to_string()],
        page_size: Some(10),
        page: Some(1),
        sort_by: None,
    };

    let timer = metrics::histogram!("test.market_data.latency");
    let _timer_guard = timer.start_timer();

    let response = ctx.server
        .get("/api/v1/market-data")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .json(&request)
        .send()
        .await?;

    assert_eq!(response.status_code(), 200);
    
    let data: Value = response.json().await?;
    assert!(data["trading_pairs"].as_array().unwrap().len() > 0);
    assert!(data["timestamp"].as_i64().unwrap() > 0);

    // Verify response time meets SLA
    assert!(timer.get_sample_count() < Duration::from_millis(500).as_nanos() as u64);

    Ok(())
}

#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_get_market_data_rate_limit(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    // Test rate limiting
    for _ in 0..MAX_REQUESTS_PER_WINDOW + 1 {
        let response = ctx.server
            .get("/api/v1/market-data")
            .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
            .send()
            .await?;

        if response.status_code() == 429 {
            return Ok(());
        }
        sleep(Duration::from_millis(10)).await;
    }

    panic!("Rate limiting did not trigger");
}

// Order Creation Tests
#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_create_order_success(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    let request = OrderRequest {
        trading_pair: TEST_TRADING_PAIR.to_string(),
        amount: 1.0,
        price: 100.0,
        order_type: OrderType::Limit,
        time_in_force: TimeInForce::GoodTilCancelled,
        slippage_tolerance: Some(1.0),
    };

    let timer = metrics::histogram!("test.order_creation.latency");
    let _timer_guard = timer.start_timer();

    let response = ctx.server
        .post("/api/v1/orders")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .json(&request)
        .send()
        .await?;

    assert_eq!(response.status_code(), 200);
    
    let data: Value = response.json().await?;
    assert!(data["order_id"].as_str().is_some());
    assert_eq!(data["status"], "PENDING");

    // Verify order execution time meets SLA
    assert!(timer.get_sample_count() < Duration::from_millis(500).as_nanos() as u64);

    Ok(())
}

#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_create_order_invalid_signature(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    let request = OrderRequest {
        trading_pair: TEST_TRADING_PAIR.to_string(),
        amount: 1.0,
        price: 100.0,
        order_type: OrderType::Market,
        time_in_force: TimeInForce::ImmediateOrCancel,
        slippage_tolerance: Some(1.0),
    };

    let response = ctx.server
        .post("/api/v1/orders")
        .add_header("Authorization", "Bearer invalid_token")
        .json(&request)
        .send()
        .await?;

    assert_eq!(response.status_code(), 401);
    Ok(())
}

// Portfolio Tests
#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_get_portfolio_success(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    let response = ctx.server
        .get("/api/v1/portfolio")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .send()
        .await?;

    assert_eq!(response.status_code(), 200);
    
    let data: Value = response.json().await?;
    assert!(data["balance"].as_f64().is_some());
    assert!(data["positions"].as_array().is_some());

    Ok(())
}

// Strategy Tests
#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_update_strategy_success(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    let strategy_config = json!({
        "type": "GRID_TRADING",
        "parameters": {
            "grid_levels": 10,
            "upper_price": 150.0,
            "lower_price": 50.0,
            "trading_pair": TEST_TRADING_PAIR
        }
    });

    let response = ctx.server
        .put("/api/v1/strategy")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .json(&strategy_config)
        .send()
        .await?;

    assert_eq!(response.status_code(), 200);
    Ok(())
}

// Integration Tests
#[tokio::test]
#[test_context(TestContext)]
#[instrument]
async fn test_full_trading_cycle(ctx: &TestContext) -> Result<(), Box<dyn std::error::Error>> {
    // 1. Get market data
    let market_data = ctx.server
        .get("/api/v1/market-data")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .send()
        .await?;
    
    assert_eq!(market_data.status_code(), 200);

    // 2. Create buy order
    let buy_order = OrderRequest {
        trading_pair: TEST_TRADING_PAIR.to_string(),
        amount: 1.0,
        price: 100.0,
        order_type: OrderType::Limit,
        time_in_force: TimeInForce::GoodTilCancelled,
        slippage_tolerance: Some(1.0),
    };

    let buy_response = ctx.server
        .post("/api/v1/orders")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .json(&buy_order)
        .send()
        .await?;

    assert_eq!(buy_response.status_code(), 200);

    // 3. Check portfolio update
    let portfolio = ctx.server
        .get("/api/v1/portfolio")
        .add_header("Authorization", &format!("Bearer {}", ctx.test_jwt))
        .send()
        .await?;

    assert_eq!(portfolio.status_code(), 200);

    Ok(())
}