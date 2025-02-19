use serde::Deserialize;
use dotenv::dotenv;
use log::{error, info, warn};
use url::Url;
use std::env;
use std::time::Duration;

// Package versions in use:
// serde = "1.0.164"
// dotenv = "0.15.0"
// log = "0.4.17"
// url = "2.3.1"

// Environment constants
pub const PRODUCTION_ENV: &str = "production";
pub const STAGING_ENV: &str = "staging";
pub const DEVELOPMENT_ENV: &str = "development";
pub const DEFAULT_AWS_REGION: &str = "ap-southeast-1";
pub const DEFAULT_API_PORT: u16 = 8080;

// Required environment variables
const REQUIRED_ENV_VARS: &[&str] = &[
    "NODE_ENV",
    "AWS_REGION",
    "JUPITER_API_ENDPOINT",
    "PUMP_FUN_API_ENDPOINT",
    "DRIFT_API_ENDPOINT",
    "JITO_API_ENDPOINT"
];

#[derive(Debug, Clone, Deserialize)]
pub struct EnvironmentConfig {
    pub node_env: String,
    pub aws_region: String,
    pub jupiter_api_endpoint: String,
    pub pump_fun_api_endpoint: String,
    pub drift_api_endpoint: String,
    pub jito_api_endpoint: String,
    pub api_port: u16,
    pub debug_mode: bool,
    pub log_level: Option<String>,
    pub allowed_origins: Vec<String>,
    pub request_timeout_ms: u32,
    pub max_connections: u32,
}

impl EnvironmentConfig {
    pub fn new() -> Self {
        EnvironmentConfig {
            node_env: DEVELOPMENT_ENV.to_string(),
            aws_region: DEFAULT_AWS_REGION.to_string(),
            jupiter_api_endpoint: String::new(),
            pump_fun_api_endpoint: String::new(),
            drift_api_endpoint: String::new(),
            jito_api_endpoint: String::new(),
            api_port: DEFAULT_API_PORT,
            debug_mode: true,
            log_level: Some("debug".to_string()),
            allowed_origins: vec![],
            request_timeout_ms: 30000,
            max_connections: 1000,
        }
    }

    pub fn is_production(&self) -> bool {
        let is_prod = self.node_env == PRODUCTION_ENV;
        if is_prod {
            // Additional production environment validations
            if self.aws_region != DEFAULT_AWS_REGION {
                warn!("Production environment detected but not running in {}", DEFAULT_AWS_REGION);
                return false;
            }
            if self.debug_mode {
                warn!("Production environment detected but debug mode is enabled");
                return false;
            }
        }
        is_prod
    }

    pub fn is_staging(&self) -> bool {
        self.node_env == STAGING_ENV
    }

    pub fn is_development(&self) -> bool {
        self.node_env == DEVELOPMENT_ENV
    }

    pub fn from_env() -> Result<Self, Box<dyn std::error::Error>> {
        // Load .env file if present
        dotenv().ok();

        // Validate required environment variables
        for var in REQUIRED_ENV_VARS {
            if env::var(var).is_err() {
                return Err(format!("Missing required environment variable: {}", var).into());
            }
        }

        let node_env = env::var("NODE_ENV")?;
        if ![PRODUCTION_ENV, STAGING_ENV, DEVELOPMENT_ENV].contains(&node_env.as_str()) {
            return Err("Invalid NODE_ENV value".into());
        }

        let aws_region = env::var("AWS_REGION").unwrap_or_else(|_| DEFAULT_AWS_REGION.to_string());
        if node_env == PRODUCTION_ENV && aws_region != DEFAULT_AWS_REGION {
            return Err(format!("Production environment must run in {} region", DEFAULT_AWS_REGION).into());
        }

        let config = EnvironmentConfig {
            node_env,
            aws_region,
            jupiter_api_endpoint: env::var("JUPITER_API_ENDPOINT")?,
            pump_fun_api_endpoint: env::var("PUMP_FUN_API_ENDPOINT")?,
            drift_api_endpoint: env::var("DRIFT_API_ENDPOINT")?,
            jito_api_endpoint: env::var("JITO_API_ENDPOINT")?,
            api_port: env::var("API_PORT")
                .unwrap_or_else(|_| DEFAULT_API_PORT.to_string())
                .parse()?,
            debug_mode: env::var("DEBUG_MODE")
                .map(|v| v == "true")
                .unwrap_or(false),
            log_level: env::var("LOG_LEVEL").ok(),
            allowed_origins: env::var("ALLOWED_ORIGINS")
                .map(|v| v.split(',').map(String::from).collect())
                .unwrap_or_else(|_| vec![]),
            request_timeout_ms: env::var("REQUEST_TIMEOUT_MS")
                .unwrap_or_else(|_| "30000".to_string())
                .parse()?,
            max_connections: env::var("MAX_CONNECTIONS")
                .unwrap_or_else(|_| "1000".to_string())
                .parse()?,
        };

        validate_environment(&config)?;
        Ok(config)
    }
}

pub fn validate_environment(config: &EnvironmentConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Validate API endpoints
    let endpoints = [
        (&config.jupiter_api_endpoint, "Jupiter API"),
        (&config.pump_fun_api_endpoint, "Pump Fun API"),
        (&config.drift_api_endpoint, "Drift API"),
        (&config.jito_api_endpoint, "Jito API"),
    ];

    for (endpoint, name) in endpoints.iter() {
        if let Err(e) = Url::parse(endpoint) {
            return Err(format!("Invalid {} endpoint URL: {}", name, e).into());
        }
    }

    // Validate port number
    if config.api_port < 1024 || config.api_port > 65535 {
        return Err("Invalid API port number".into());
    }

    // Environment-specific validations
    match config.node_env.as_str() {
        PRODUCTION_ENV => {
            if config.debug_mode {
                return Err("Debug mode must be disabled in production".into());
            }
            if config.aws_region != DEFAULT_AWS_REGION {
                return Err(format!("Production must run in {} region", DEFAULT_AWS_REGION).into());
            }
            if config.allowed_origins.is_empty() {
                return Err("Production requires explicit CORS configuration".into());
            }
        }
        STAGING_ENV => {
            info!("Running in staging environment");
        }
        DEVELOPMENT_ENV => {
            info!("Running in development environment");
        }
        _ => return Err("Invalid environment".into()),
    }

    // Validate timeout and connection limits
    if config.request_timeout_ms < 1000 || config.request_timeout_ms > 60000 {
        return Err("Invalid request timeout value".into());
    }
    if config.max_connections < 10 || config.max_connections > 10000 {
        return Err("Invalid max connections value".into());
    }

    info!("Environment configuration validated successfully");
    Ok(())
}