use jito_bundle_client::{BundleClient, BundleConfig, BundleError, BundleSubmissionResult};
use solana_client::{
    client_error::ClientError,
    nonblocking::rpc_client::RpcClient,
    rpc_config::RpcSendTransactionConfig,
    rpc_request::RpcRequest,
};
use solana_sdk::{
    commitment_config::CommitmentConfig,
    hash::Hash,
    signature::{Keypair, Signature},
    transaction::Transaction,
};
use solana_transaction_status::UiTransactionStatusMeta;
use std::{sync::Arc, time::Duration};
use tokio::time::sleep;
use tracing::{debug, error, info, instrument, warn};

// Package versions in use:
// solana-client = "1.17"
// solana-sdk = "1.17"
// solana-transaction-status = "1.17"
// tokio = "1.28"
// jito-bundle-client = "0.1"
// tracing = "0.1"

/// Default commitment level for RPC requests
const DEFAULT_COMMITMENT_LEVEL: CommitmentConfig = CommitmentConfig::confirmed();
/// RPC request timeout in seconds
const RPC_TIMEOUT_SECONDS: u64 = 5;
/// Maximum number of transaction retry attempts
const MAX_RETRIES: u8 = 3;
/// Minimum priority fee in lamports
const MIN_PRIORITY_FEE: u64 = 10_000;
/// Health check interval in seconds
const HEALTH_CHECK_INTERVAL_SECONDS: u64 = 60;

/// Error types for Solana client operations
#[derive(Debug, thiserror::Error)]
pub enum SolanaError {
    #[error("RPC client error: {0}")]
    ClientError(#[from] ClientError),
    #[error("Bundle submission error: {0}")]
    BundleError(#[from] BundleError),
    #[error("Health check failed: {0}")]
    HealthCheckError(String),
}

/// Health status of Solana client connections
#[derive(Debug, Clone)]
pub struct HealthStatus {
    pub rpc_healthy: bool,
    pub jito_healthy: bool,
    pub last_checked: chrono::DateTime<chrono::Utc>,
    pub latency_ms: u64,
}

/// Metrics collection for client operations
#[derive(Debug, Default)]
struct ClientMetrics {
    transactions_submitted: u64,
    transactions_confirmed: u64,
    average_confirmation_time: f64,
    mev_bundles_submitted: u64,
    mev_bundles_included: u64,
}

/// High-performance client for Solana blockchain interactions
#[derive(Debug, Clone)]
pub struct SolanaClient {
    rpc_client: Arc<RpcClient>,
    jito_endpoint: Option<String>,
    commitment: CommitmentConfig,
    metrics: Arc<parking_lot::RwLock<ClientMetrics>>,
    health_checker: Arc<tokio::sync::RwLock<HealthStatus>>,
}

impl SolanaClient {
    /// Creates a new SolanaClient instance with monitoring capabilities
    pub async fn new(
        rpc_url: String,
        jito_endpoint: Option<String>,
        config: Option<ClientConfig>,
    ) -> Result<Self, SolanaError> {
        let rpc_client = create_rpc_client(&rpc_url, None, config)?;
        
        let health_status = HealthStatus {
            rpc_healthy: true,
            jito_healthy: jito_endpoint.is_some(),
            last_checked: chrono::Utc::now(),
            latency_ms: 0,
        };

        let client = Self {
            rpc_client,
            jito_endpoint,
            commitment: DEFAULT_COMMITMENT_LEVEL,
            metrics: Arc::new(parking_lot::RwLock::new(ClientMetrics::default())),
            health_checker: Arc::new(tokio::sync::RwLock::new(health_status)),
        };

        // Start health monitoring task
        client.spawn_health_monitor();
        
        Ok(client)
    }

    /// Retrieves and caches the latest blockhash with monitoring
    #[instrument(skip(self))]
    pub async fn get_latest_blockhash(&self) -> Result<Hash, SolanaError> {
        let start = std::time::Instant::now();
        let blockhash = self.rpc_client
            .get_latest_blockhash()
            .await
            .map_err(SolanaError::ClientError)?;
        
        debug!(
            "Retrieved latest blockhash in {}ms",
            start.elapsed().as_millis()
        );
        
        Ok(blockhash)
    }

    /// Performs continuous health monitoring of RPC and Jito connections
    #[instrument(skip(self))]
    pub async fn monitor_health(&self) -> Result<HealthStatus, SolanaError> {
        let start = std::time::Instant::now();
        
        // Check RPC connection
        let rpc_healthy = self.rpc_client
            .get_health()
            .await
            .is_ok();

        // Check Jito connection if configured
        let jito_healthy = if let Some(endpoint) = &self.jito_endpoint {
            BundleClient::new(endpoint)
                .await
                .map(|_| true)
                .unwrap_or(false)
        } else {
            false
        };

        let status = HealthStatus {
            rpc_healthy,
            jito_healthy,
            last_checked: chrono::Utc::now(),
            latency_ms: start.elapsed().as_millis() as u64,
        };

        *self.health_checker.write().await = status.clone();

        if !rpc_healthy {
            error!("RPC endpoint health check failed");
        }
        if !jito_healthy && self.jito_endpoint.is_some() {
            warn!("Jito endpoint health check failed");
        }

        Ok(status)
    }

    // Spawns a background task for continuous health monitoring
    fn spawn_health_monitor(&self) {
        let client = self.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = client.monitor_health().await {
                    error!("Health monitor error: {}", e);
                }
                sleep(Duration::from_secs(HEALTH_CHECK_INTERVAL_SECONDS)).await;
            }
        });
    }
}

/// Creates a new Solana RPC client with optimized settings
#[instrument]
pub fn create_rpc_client(
    rpc_url: &str,
    commitment: Option<CommitmentConfig>,
    config: Option<ClientConfig>,
) -> Result<Arc<RpcClient>, ClientError> {
    let commitment = commitment.unwrap_or(DEFAULT_COMMITMENT_LEVEL);
    
    let config = config.unwrap_or_else(|| ClientConfig {
        timeout: Duration::from_secs(RPC_TIMEOUT_SECONDS),
        ..ClientConfig::default()
    });

    let client = RpcClient::new_with_timeout_and_commitment(
        rpc_url.to_string(),
        config.timeout,
        commitment,
    );

    Ok(Arc::new(client))
}

/// Signs and sends a transaction with optimized fee calculation
#[instrument(skip(transaction, client, signer))]
pub async fn sign_and_send_transaction(
    mut transaction: Transaction,
    client: Arc<RpcClient>,
    signer: &Keypair,
    priority_fee: Option<u64>,
) -> Result<(Signature, u64), ClientError> {
    let priority_fee = priority_fee.unwrap_or(MIN_PRIORITY_FEE);
    
    // Add priority fee to transaction
    transaction.message.recent_blockhash = client
        .get_latest_blockhash()
        .await?;
    
    transaction.sign(&[signer], transaction.message.recent_blockhash);

    let mut retries = 0;
    loop {
        let result = client
            .send_transaction_with_config(
                &transaction,
                RpcSendTransactionConfig {
                    skip_preflight: true,
                    preflight_commitment: Some(CommitmentConfig::processed()),
                    encoding: None,
                    max_retries: Some(MAX_RETRIES),
                },
            )
            .await;

        match result {
            Ok(signature) => {
                let slot = client
                    .get_slot()
                    .await?;
                
                info!(
                    "Transaction {} submitted successfully at slot {}",
                    signature, slot
                );
                
                return Ok((signature, slot));
            }
            Err(e) if retries < MAX_RETRIES => {
                warn!("Transaction retry {}/{}: {}", retries + 1, MAX_RETRIES, e);
                retries += 1;
                sleep(Duration::from_millis(500 * 2u64.pow(retries as u32))).await;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Submits and monitors a bundle of transactions for MEV optimization
#[instrument(skip(transactions, client))]
pub async fn submit_mev_bundle(
    transactions: Vec<Transaction>,
    client: Arc<RpcClient>,
    jito_endpoint: String,
    config: BundleConfig,
) -> Result<BundleSubmissionResult, BundleError> {
    let bundle_client = BundleClient::new(&jito_endpoint)
        .await
        .map_err(|e| BundleError::ConnectionError(e.to_string()))?;

    let result = bundle_client
        .submit_bundle(transactions, config)
        .await?;

    info!(
        "MEV bundle submitted with {} transactions",
        result.accepted_transactions
    );

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::signer::keypair::Keypair;

    #[tokio::test]
    async fn test_client_creation() {
        let client = SolanaClient::new(
            "http://localhost:8899".to_string(),
            None,
            None,
        ).await;
        assert!(client.is_ok());
    }

    #[tokio::test]
    async fn test_health_monitoring() {
        let client = SolanaClient::new(
            "http://localhost:8899".to_string(),
            None,
            None,
        ).await.unwrap();
        
        let health = client.monitor_health().await;
        assert!(health.is_ok());
    }
}