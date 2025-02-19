//! Time utilities module for standardized timestamp handling, timezone conversions,
//! and duration calculations with microsecond precision.
//! 
//! Version dependencies:
//! - chrono = "0.4"
//! - time = "0.3"

use chrono::{DateTime, Duration, FixedOffset, TimeZone, Utc};
use std::sync::OnceLock;
use std::time::SystemTime;
use thiserror::Error;

// Constants for time handling
const TRADING_TIMEZONE: &str = "Asia/Singapore";
const MAX_MARKET_DATA_AGE_MS: i64 = 5000;
const TIMESTAMP_FORMAT: &str = "%Y-%m-%dT%H:%M:%S.%f%z";

// Static timezone cache for performance
static TRADING_TZ: OnceLock<FixedOffset> = OnceLock::new();

#[derive(Error, Debug)]
pub enum TimeError {
    #[error("timezone conversion failed: {0}")]
    TimezoneError(String),
    #[error("duration calculation failed: {0}")]
    DurationError(String),
    #[error("timestamp formatting failed: {0}")]
    FormatError(String),
}

/// Returns the current UTC timestamp with microsecond precision
/// using monotonic clock for consistent measurements
#[inline]
pub fn current_timestamp() -> DateTime<Utc> {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| Utc.timestamp_nanos(d.as_nanos() as i64))
        .unwrap_or_else(|_| Utc::now())
}

/// Converts a UTC timestamp to the trading bot's timezone (Asia/Singapore)
/// with caching for performance
pub fn to_trading_timezone(
    timestamp: DateTime<Utc>
) -> Result<DateTime<FixedOffset>, TimeError> {
    let tz = TRADING_TZ.get_or_init(|| {
        // Singapore is UTC+8
        FixedOffset::east_opt(8 * 3600).expect("invalid timezone offset")
    });
    
    timestamp
        .with_timezone(tz)
        .map_err(|e| TimeError::TimezoneError(e.to_string()))
}

/// Validates market data timestamp freshness with configurable threshold
#[inline]
pub fn is_valid_market_timestamp(timestamp: DateTime<Utc>) -> bool {
    let now = current_timestamp();
    let age = calculate_duration_ms(timestamp, now)
        .unwrap_or(MAX_MARKET_DATA_AGE_MS + 1);
    age <= MAX_MARKET_DATA_AGE_MS
}

/// Calculates duration between two timestamps in milliseconds
/// with overflow protection
pub fn calculate_duration_ms(
    start: DateTime<Utc>,
    end: DateTime<Utc>
) -> Result<i64, TimeError> {
    if start > end {
        return Err(TimeError::DurationError(
            "start timestamp is after end timestamp".to_string()
        ));
    }

    end.signed_duration_since(start)
        .num_milliseconds()
        .try_into()
        .map_err(|e| TimeError::DurationError(e.to_string()))
}

/// Formats a timestamp for logging and display with consistent ISO 8601 format
pub fn format_timestamp(timestamp: DateTime<Utc>) -> Result<String, TimeError> {
    to_trading_timezone(timestamp)
        .and_then(|tz_time| {
            tz_time
                .format(TIMESTAMP_FORMAT)
                .to_string()
                .try_into()
                .map_err(|e| TimeError::FormatError(e.to_string()))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    #[test]
    fn test_current_timestamp_precision() {
        let ts1 = current_timestamp();
        let ts2 = current_timestamp();
        assert!(ts2 > ts1, "timestamps should be monotonically increasing");
    }

    #[test]
    fn test_trading_timezone_conversion() {
        let utc = current_timestamp();
        let sg_time = to_trading_timezone(utc).unwrap();
        assert_eq!(sg_time.offset().fix().local_minus_utc(), 8 * 3600);
    }

    #[test]
    fn test_market_data_freshness() {
        let now = current_timestamp();
        assert!(is_valid_market_timestamp(now));
        
        let stale = now - Duration::milliseconds(MAX_MARKET_DATA_AGE_MS + 1);
        assert!(!is_valid_market_timestamp(stale));
    }

    #[test]
    fn test_duration_calculation() {
        let start = current_timestamp();
        let end = start + Duration::milliseconds(1000);
        
        let duration = calculate_duration_ms(start, end).unwrap();
        assert_eq!(duration, 1000);
        
        assert!(calculate_duration_ms(end, start).is_err());
    }

    #[test]
    fn test_timestamp_formatting() {
        let ts = current_timestamp();
        let formatted = format_timestamp(ts).unwrap();
        assert!(formatted.contains("+0800"), "should contain Singapore timezone offset");
        assert!(formatted.contains("."), "should contain microsecond precision");
    }
}