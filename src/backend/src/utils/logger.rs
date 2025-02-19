use std::sync::Once;
use tracing::{info, error, Level, Metadata, Subscriber};
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_elastic::ElasticSubscriber;
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::config::environment::EnvironmentConfig;

// Package versions:
// tracing = "0.1.37"
// tracing-appender = "0.2.2"
// serde_json = "1.0.96"
// tracing-elastic = "0.1.0"

static INIT: Once = Once::new();
static DEFAULT_LOG_LEVEL: &str = "INFO";
static LOG_DATE_FORMAT: &str = "%Y-%m-%d %H:%M:%S%.3f";
const MAX_LOG_FILE_SIZE: u64 = 100 * 1024 * 1024; // 100MB
static LOG_ROTATION_DURATION: &str = "1d";

#[derive(Debug, Clone)]
pub struct LogFormatter {
    include_file_line: bool,
    include_timestamps: bool,
    json_format: bool,
    elk_compatible: bool,
    environment: Option<String>,
}

impl LogFormatter {
    pub fn new(
        include_file_line: bool,
        include_timestamps: bool,
        json_format: bool,
        elk_compatible: bool,
        environment: Option<String>,
    ) -> Self {
        Self {
            include_file_line,
            include_timestamps,
            json_format,
            elk_compatible,
            environment,
        }
    }

    pub fn format(&self, record: &tracing::log::Record) -> String {
        let timestamp = if self.include_timestamps {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
                .to_string()
        } else {
            String::new()
        };

        let log_entry = json!({
            "@timestamp": timestamp,
            "level": record.level().to_string(),
            "message": record.args().to_string(),
            "target": record.target().to_string(),
            "location": if self.include_file_line {
                format!("{}:{}", record.file().unwrap_or("unknown"), record.line().unwrap_or(0))
            } else {
                "".to_string()
            },
            "environment": self.environment.clone().unwrap_or_else(|| "unknown".to_string()),
            "service": "solana-trading-bot",
        });

        if self.json_format {
            serde_json::to_string(&log_entry).unwrap_or_else(|_| record.args().to_string())
        } else {
            format!("{} - {}", timestamp, record.args())
        }
    }
}

pub fn init_logger(config: &EnvironmentConfig) -> Result<(), Box<dyn std::error::Error>> {
    INIT.call_once(|| {
        let log_level = match config.log_level.as_deref() {
            Some("DEBUG") => Level::DEBUG,
            Some("INFO") => Level::INFO,
            Some("WARN") => Level::WARN,
            Some("ERROR") => Level::ERROR,
            _ => Level::INFO,
        };

        let file_appender = RollingFileAppender::new(
            Rotation::new(LOG_ROTATION_DURATION.parse().unwrap(), MAX_LOG_FILE_SIZE),
            "logs",
            "trading-bot.log",
        );

        let formatter = LogFormatter::new(
            !config.is_production(),
            true,
            true,
            config.is_production(),
            Some(config.node_env.clone()),
        );

        let subscriber = tracing_subscriber::fmt()
            .with_file(true)
            .with_line_number(true)
            .with_thread_ids(true)
            .with_target(true)
            .with_max_level(log_level)
            .with_writer(file_appender)
            .with_ansi(false)
            .event_format(move |event| {
                formatter.format(&tracing::log::Record::new(
                    &event.metadata(),
                    &format_args!("{:?}", event),
                ))
            });

        if config.is_production() {
            // Initialize ELK Stack integration for production
            let elastic_subscriber = ElasticSubscriber::new(
                "http://elasticsearch:9200",
                "trading-bot-logs",
            );
            
            let multi_subscriber = tracing_subscriber::registry()
                .with(subscriber)
                .with(elastic_subscriber);

            tracing::subscriber::set_global_default(multi_subscriber)
                .expect("Failed to set global subscriber");
        } else {
            tracing::subscriber::set_global_default(subscriber)
                .expect("Failed to set global subscriber");
        }
    });

    Ok(())
}

pub fn log_trade_execution(trade_info: Value, correlation_id: String) {
    let log_entry = json!({
        "event_type": "trade_execution",
        "correlation_id": correlation_id,
        "trade_details": trade_info,
        "timestamp": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    });

    info!(target: "trade_execution", "{}", serde_json::to_string(&log_entry).unwrap());
}

pub fn log_error(error: Box<dyn std::error::Error>, context: String, correlation_id: Option<String>) {
    let error_entry = json!({
        "event_type": "error",
        "error_message": error.to_string(),
        "error_context": context,
        "correlation_id": correlation_id,
        "stack_trace": format!("{:?}", error),
        "timestamp": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis(),
    });

    error!(target: "error", "{}", serde_json::to_string(&error_entry).unwrap());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::environment::EnvironmentConfig;

    #[test]
    fn test_log_formatter() {
        let formatter = LogFormatter::new(
            true,
            true,
            true,
            false,
            Some("test".to_string()),
        );

        let record = tracing::log::Record::builder()
            .args(format_args!("Test message"))
            .level(Level::INFO)
            .target("test_target")
            .file(Some("test.rs"))
            .line(Some(42))
            .build();

        let formatted = formatter.format(&record);
        let parsed: Value = serde_json::from_str(&formatted).unwrap();

        assert!(parsed.get("@timestamp").is_some());
        assert_eq!(parsed["level"], "INFO");
        assert_eq!(parsed["message"], "Test message");
        assert_eq!(parsed["environment"], "test");
    }

    #[test]
    fn test_init_logger() {
        let config = EnvironmentConfig::new();
        assert!(init_logger(&config).is_ok());
    }
}