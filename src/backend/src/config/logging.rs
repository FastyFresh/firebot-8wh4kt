use serde::{Deserialize, Serialize};
use tracing::{Level, Subscriber};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use serde_json::json;
use async_trait::async_trait;
use std::path::PathBuf;
use std::time::Duration;
use std::collections::HashSet;

use crate::config::environment::EnvironmentConfig;

// Package versions:
// serde = "1.0.164"
// tracing = "0.1.37"
// tracing-appender = "0.2.2"
// serde_json = "1.0.96"
// async-trait = "0.1.68"

// Global constants
const DEFAULT_LOG_LEVEL: &str = "INFO";
const LOG_FILE_PATH: &str = "/var/log/trading-bot";
const LOG_FILE_PREFIX: &str = "trading-bot";
const LOG_DATE_FORMAT: &str = "%Y-%m-%d %H:%M:%S%.3f";
const MAX_LOG_SIZE_MB: u32 = 500;
const DEFAULT_RETENTION_DAYS: u32 = 30;
const SENSITIVE_FIELDS: [&str; 3] = ["private_key", "wallet_key", "signature"];

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct LogConfig {
    pub log_level: String,
    pub log_file_path: String,
    pub json_format: bool,
    pub elk_enabled: bool,
    pub elk_endpoint: String,
    pub rotation_size_mb: u32,
    pub retention_days: u32,
    pub enable_async: bool,
    pub sampling_rate: u32,
    pub enable_compression: bool,
    pub sensitive_fields: Vec<String>,
    pub backup_endpoint: Option<String>,
}

impl LogConfig {
    pub fn new(env_config: &EnvironmentConfig) -> Self {
        let is_prod = env_config.is_production();
        
        LogConfig {
            log_level: env_config.log_level.clone()
                .unwrap_or_else(|| DEFAULT_LOG_LEVEL.to_string()),
            log_file_path: LOG_FILE_PATH.to_string(),
            json_format: is_prod,
            elk_enabled: is_prod,
            elk_endpoint: if is_prod {
                "http://elk:9200".to_string()
            } else {
                String::new()
            },
            rotation_size_mb: MAX_LOG_SIZE_MB,
            retention_days: DEFAULT_RETENTION_DAYS,
            enable_async: is_prod,
            sampling_rate: if is_prod { 100 } else { 1 },
            enable_compression: is_prod,
            sensitive_fields: SENSITIVE_FIELDS.iter()
                .map(|&s| s.to_string())
                .collect(),
            backup_endpoint: if is_prod {
                Some("s3://trading-bot-logs-backup".to_string())
            } else {
                None
            },
        }
    }

    pub fn validate(&self) -> Result<(), Box<dyn std::error::Error>> {
        // Validate log level
        match self.log_level.to_uppercase().as_str() {
            "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE" => (),
            _ => return Err("Invalid log level specified".into()),
        }

        // Validate file path
        let path = PathBuf::from(&self.log_file_path);
        if !path.exists() {
            std::fs::create_dir_all(&path)?;
        }

        // Validate ELK configuration
        if self.elk_enabled {
            if self.elk_endpoint.is_empty() {
                return Err("ELK endpoint must be specified when ELK is enabled".into());
            }
            url::Url::parse(&self.elk_endpoint)?;
        }

        // Validate rotation and retention settings
        if self.rotation_size_mb < 1 || self.rotation_size_mb > 1000 {
            return Err("Invalid rotation size".into());
        }
        if self.retention_days < 1 || self.retention_days > 365 {
            return Err("Invalid retention period".into());
        }

        // Validate sampling rate
        if self.sampling_rate < 1 || self.sampling_rate > 1000 {
            return Err("Invalid sampling rate".into());
        }

        // Validate backup endpoint if configured
        if let Some(endpoint) = &self.backup_endpoint {
            if !endpoint.starts_with("s3://") {
                return Err("Backup endpoint must be an S3 URL".into());
            }
        }

        Ok(())
    }
}

#[tracing::instrument]
pub async fn build_logger(config: &LogConfig) -> Result<Box<dyn Subscriber + Send + Sync>, Box<dyn std::error::Error>> {
    // Validate configuration
    config.validate()?;

    // Set up file appender with rotation
    let file_appender = RollingFileAppender::new(
        Rotation::new(
            PathBuf::from(&config.log_file_path),
            LOG_FILE_PREFIX.to_string(),
            Duration::from_secs(config.rotation_size_mb as u64 * 1024 * 1024),
        ),
        config.enable_compression,
    );

    // Configure log filtering
    let log_level = match config.log_level.to_uppercase().as_str() {
        "ERROR" => Level::ERROR,
        "WARN" => Level::WARN,
        "INFO" => Level::INFO,
        "DEBUG" => Level::DEBUG,
        "TRACE" => Level::TRACE,
        _ => Level::INFO,
    };

    // Set up JSON formatting if enabled
    let formatter = if config.json_format {
        Box::new(JsonFormatter::new(config.sensitive_fields.clone()))
    } else {
        Box::new(PlainFormatter::new())
    };

    // Configure subscriber with all components
    let subscriber = tracing_subscriber::fmt()
        .with_file(true)
        .with_line_number(true)
        .with_thread_ids(true)
        .with_target(true)
        .with_max_level(log_level)
        .with_writer(file_appender)
        .with_timer(tracing_subscriber::fmt::time::ChronoUtc::with_format(
            String::from(LOG_DATE_FORMAT),
        ))
        .with_formatter(formatter)
        .with_filter(|metadata| {
            // Implement sampling based on configuration
            if config.sampling_rate > 1 {
                rand::random::<u32>() % config.sampling_rate == 0
            } else {
                true
            }
        });

    // Configure async logging if enabled
    let subscriber = if config.enable_async {
        subscriber.with_async_writer()
    } else {
        subscriber
    };

    // Set up ELK integration if enabled
    if config.elk_enabled {
        setup_elk_shipping(config).await?;
    }

    // Initialize the subscriber
    let subscriber = subscriber.build();

    Ok(Box::new(subscriber))
}

#[async_trait]
trait LogFormatter: Send + Sync {
    fn format(&self, record: &tracing::Record) -> String;
    fn sanitize_sensitive_data(&self, input: &str) -> String;
}

struct JsonFormatter {
    sensitive_fields: HashSet<String>,
}

impl JsonFormatter {
    fn new(sensitive_fields: Vec<String>) -> Self {
        JsonFormatter {
            sensitive_fields: sensitive_fields.into_iter().collect(),
        }
    }
}

#[async_trait]
impl LogFormatter for JsonFormatter {
    fn format(&self, record: &tracing::Record) -> String {
        let log_entry = json!({
            "timestamp": chrono::Utc::now().format(LOG_DATE_FORMAT).to_string(),
            "level": record.level().to_string(),
            "target": record.target().to_string(),
            "message": self.sanitize_sensitive_data(&record.args().to_string()),
            "file": record.file().unwrap_or("unknown"),
            "line": record.line().unwrap_or(0),
        });

        serde_json::to_string(&log_entry).unwrap_or_else(|_| "{}".to_string())
    }

    fn sanitize_sensitive_data(&self, input: &str) -> String {
        let mut sanitized = input.to_string();
        for field in &self.sensitive_fields {
            let pattern = format!(r#""{}":\s*"[^"]*""#, field);
            if let Ok(regex) = regex::Regex::new(&pattern) {
                sanitized = regex.replace_all(&sanitized, format!(r#""{field}":"*****""#)).to_string();
            }
        }
        sanitized
    }
}

struct PlainFormatter;

impl PlainFormatter {
    fn new() -> Self {
        PlainFormatter
    }
}

#[async_trait]
impl LogFormatter for PlainFormatter {
    fn format(&self, record: &tracing::Record) -> String {
        format!(
            "{} [{}] {} - {}:{} {}",
            chrono::Utc::now().format(LOG_DATE_FORMAT),
            record.level(),
            record.target(),
            record.file().unwrap_or("unknown"),
            record.line().unwrap_or(0),
            record.args()
        )
    }

    fn sanitize_sensitive_data(&self, input: &str) -> String {
        input.to_string()
    }
}

async fn setup_elk_shipping(config: &LogConfig) -> Result<(), Box<dyn std::error::Error>> {
    // ELK setup implementation would go here
    // This is a placeholder for the actual implementation
    Ok(())
}