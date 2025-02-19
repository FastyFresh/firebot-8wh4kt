use chrono::Utc;
use futures::{SinkExt, StreamExt};
use mockall::predicate::*;
use rust_decimal_macros::dec;
use serde_json::json;
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::RwLock;
use tokio_tungstenite::{
    connect_async,
    tungstenite::protocol::Message,
    WebSocketStream,
};
use uuid::Uuid;

use crate::api::websocket::{WebSocketServer, WsError};
use crate::models::market::{MarketData, OrderBook, OrderBookLevel};

// Constants for test configuration
const TEST_AUTH_TOKEN: &str = "test_auth_token";
const TEST_TIMEOUT_MS: u64 = 5000;
const TEST_MARKET_PAIR: &str = "SOL/USDC";
const TEST_EXCHANGES: &[&str] = &["jupiter", "pump_fun", "drift"];

/// Enhanced test client for WebSocket testing
struct TestClient {
    ws_stream: WebSocketStream<TcpStream>,
    auth_token: String,
    subscriptions: HashMap<String, Subscription>,
    metrics: Arc<metrics::Metrics>,
}

#[derive(Debug)]
struct Subscription {
    market_pair: String,
    exchanges: Vec<String>,
    last_update: Instant,
}

impl TestClient {
    /// Creates new test client with enhanced capabilities
    async fn new(server_addr: SocketAddr, auth_token: String) -> Result<Self, Box<dyn std::error::Error>> {
        let url = format!("ws://{}/ws", server_addr);
        let (ws_stream, _) = connect_async(url).await?;

        Ok(Self {
            ws_stream,
            auth_token,
            subscriptions: HashMap::new(),
            metrics: Arc::new(metrics::Metrics::new()),
        })
    }

    /// Subscribes to market data for testing
    async fn subscribe_to_market(
        &mut self,
        market_pair: String,
        exchanges: Vec<String>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let subscription_msg = json!({
            "type": "subscribe",
            "market_pair": market_pair,
            "exchanges": exchanges,
        });

        self.ws_stream.send(Message::Text(subscription_msg.to_string())).await?;

        // Wait for subscription confirmation
        let response = self.ws_stream.next().await
            .ok_or("No response received")??;

        match response {
            Message::Text(text) => {
                let response: serde_json::Value = serde_json::from_str(&text)?;
                if response["type"] == "subscribed" {
                    self.subscriptions.insert(market_pair.clone(), Subscription {
                        market_pair,
                        exchanges,
                        last_update: Instant::now(),
                    });
                    Ok(())
                } else {
                    Err("Subscription failed".into())
                }
            }
            _ => Err("Invalid response type".into()),
        }
    }

    /// Validates market data message
    fn validate_market_data(&self, data: &MarketData) -> bool {
        data.is_valid().unwrap_or(false)
            && data.trading_pair == TEST_MARKET_PAIR
            && TEST_EXCHANGES.contains(&data.exchange.as_str())
    }
}

/// Sets up test server with mock metrics
async fn setup_test_server() -> Result<(Arc<WebSocketServer>, SocketAddr), Box<dyn std::error::Error>> {
    let metrics = Arc::new(metrics::Metrics::new());
    let server = Arc::new(WebSocketServer::new(metrics.clone()));
    
    // Bind to random port
    let addr: SocketAddr = "127.0.0.1:0".parse()?;
    let server_clone = server.clone();
    
    tokio::spawn(async move {
        server_clone.start(addr).await.expect("Failed to start server");
    });

    tokio::time::sleep(Duration::from_millis(100)).await;
    Ok((server, addr))
}

#[tokio::test]
async fn test_websocket_connection() -> Result<(), Box<dyn std::error::Error>> {
    let (server, addr) = setup_test_server().await?;
    let client = TestClient::new(addr, TEST_AUTH_TOKEN.to_string()).await?;
    
    assert!(!client.subscriptions.is_empty(), "Client should connect successfully");
    Ok(())
}

#[tokio::test]
async fn test_market_data_streaming() -> Result<(), Box<dyn std::error::Error>> {
    let (server, addr) = setup_test_server().await?;
    let mut client = TestClient::new(addr, TEST_AUTH_TOKEN.to_string()).await?;

    // Subscribe to test market
    client.subscribe_to_market(
        TEST_MARKET_PAIR.to_string(),
        TEST_EXCHANGES.iter().map(|&s| s.to_string()).collect(),
    ).await?;

    // Create test market data
    let market_data = MarketData::new(
        TEST_MARKET_PAIR.to_string(),
        "jupiter".to_string(),
        dec!(23.45),
        dec!(1000.00),
    )?;

    // Broadcast market data
    server.broadcast_market_data(vec![market_data]).await?;

    // Validate received data
    let timeout = tokio::time::sleep(Duration::from_millis(TEST_TIMEOUT_MS));
    tokio::pin!(timeout);

    tokio::select! {
        Some(msg) = client.ws_stream.next() => {
            match msg? {
                Message::Text(text) => {
                    let data: MarketData = serde_json::from_str(&text)?;
                    assert!(client.validate_market_data(&data), "Invalid market data received");
                }
                _ => panic!("Unexpected message type"),
            }
        }
        _ = &mut timeout => {
            panic!("Timeout waiting for market data");
        }
    }

    Ok(())
}

#[tokio::test]
async fn test_performance_metrics() -> Result<(), Box<dyn std::error::Error>> {
    let (server, addr) = setup_test_server().await?;
    let mut client = TestClient::new(addr, TEST_AUTH_TOKEN.to_string()).await?;

    // Subscribe and generate load
    for _ in 0..10 {
        let market_data = MarketData::new(
            TEST_MARKET_PAIR.to_string(),
            "jupiter".to_string(),
            dec!(23.45),
            dec!(1000.00),
        )?;

        let start = Instant::now();
        server.broadcast_market_data(vec![market_data]).await?;
        
        assert!(start.elapsed() < Duration::from_millis(500), 
            "Broadcast latency exceeds 500ms requirement");
    }

    Ok(())
}

#[tokio::test]
async fn test_connection_management() -> Result<(), Box<dyn std::error::Error>> {
    let (server, addr) = setup_test_server().await?;
    
    // Test connection limits
    let mut clients = vec![];
    for i in 0..6 {
        match TestClient::new(addr, format!("test_token_{}", i)).await {
            Ok(client) => clients.push(client),
            Err(e) if i >= 5 => {
                // Expected error for exceeding connection limit
                assert!(e.to_string().contains("connection limit exceeded"));
            }
            Err(e) => return Err(e),
        }
    }

    // Test connection cleanup
    drop(clients);
    tokio::time::sleep(Duration::from_secs(1)).await;
    
    let new_client = TestClient::new(addr, "test_token_new".to_string()).await?;
    assert!(!new_client.subscriptions.is_empty(), "Should allow new connection after cleanup");

    Ok(())
}

#[tokio::test]
async fn test_error_handling() -> Result<(), Box<dyn std::error::Error>> {
    let (server, addr) = setup_test_server().await?;
    let mut client = TestClient::new(addr, TEST_AUTH_TOKEN.to_string()).await?;

    // Test invalid subscription
    let invalid_msg = json!({
        "type": "subscribe",
        "market_pair": "INVALID/PAIR",
        "exchanges": ["unknown_dex"],
    });

    client.ws_stream.send(Message::Text(invalid_msg.to_string())).await?;

    let response = client.ws_stream.next().await
        .ok_or("No response received")??;

    match response {
        Message::Text(text) => {
            let error: serde_json::Value = serde_json::from_str(&text)?;
            assert_eq!(error["type"], "error", "Should receive error response");
        }
        _ => panic!("Unexpected message type"),
    }

    Ok(())
}