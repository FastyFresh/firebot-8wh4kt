#!/bin/bash

# AI-Powered Solana Trading Bot - System Health Monitor
# Version: 1.0.0
# Dependencies:
# - curl 7.88.1
# - jq 1.6

set -euo pipefail
IFS=$'\n\t'

# Global Configuration
PROMETHEUS_URL="http://localhost:9090"
ALERT_THRESHOLD_CPU=80
ALERT_THRESHOLD_MEMORY=85
ALERT_THRESHOLD_LATENCY=500
ALERT_THRESHOLD_DISK=90
LOG_FILE="/var/log/trading-bot/health.log"
METRIC_COLLECTION_INTERVAL=5
ALERT_RETRY_COUNT=3
ALERT_CHANNELS="slack,email,pagerduty"
MAINTENANCE_WINDOW="0 2 * * 0"

# Monitoring targets configuration
declare -A SERVICES=(
    ["execution_engine"]="8080|/metrics|5s|3|2000|true"
    ["strategy_engine"]="8081|/metrics|10s|3|5000|true"
    ["risk_manager"]="8082|/metrics|15s|2|3000|true"
    ["data_collector"]="8083|/metrics|5s|3|1000|true"
)

# Initialize logging
setup_logging() {
    local log_dir=$(dirname "$LOG_FILE")
    if [[ ! -d "$log_dir" ]]; then
        mkdir -p "$log_dir"
        chmod 755 "$log_dir"
    fi
    touch "$LOG_FILE"
    chmod 644 "$LOG_FILE"
}

# Enhanced logging with timestamp and severity
log() {
    local level=$1
    local message=$2
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%3NZ")
    echo "$timestamp [$level] $message" >> "$LOG_FILE"
    
    if [[ "$level" == "ERROR" ]]; then
        echo "$timestamp [$level] $message" >&2
    fi
}

# Advanced service health check with response time validation
check_service_health() {
    local service_name=$1
    local endpoint=$2
    local retry_count=$3
    local timeout=$4
    
    local attempt=1
    local status=0
    local response_time=0
    
    while [[ $attempt -le $retry_count ]]; do
        log "INFO" "Checking health of $service_name (attempt $attempt/$retry_count)"
        
        local start_time=$(date +%s%N)
        if response=$(curl -s -w "%{http_code}" -m "$((timeout/1000))" "http://localhost:${endpoint%|*}${endpoint#*|}" 2>/dev/null); then
            local end_time=$(date +%s%N)
            response_time=$(( (end_time - start_time) / 1000000 )) # Convert to milliseconds
            
            if [[ "${response: -3}" == "200" ]]; then
                log "INFO" "$service_name is healthy (response time: ${response_time}ms)"
                
                # Record metrics
                if [[ "$response_time" -gt $ALERT_THRESHOLD_LATENCY ]]; then
                    trigger_alert "WARN" "$service_name response time exceeded threshold: ${response_time}ms"
                fi
                
                return 0
            fi
        fi
        
        log "WARN" "$service_name health check failed (attempt $attempt)"
        ((attempt++))
        sleep $((2 ** (attempt - 1))) # Exponential backoff
    done
    
    trigger_alert "ERROR" "$service_name is unhealthy after $retry_count attempts"
    return 1
}

# Comprehensive performance metric collection
collect_performance_metrics() {
    local collection_start=$(date +%s%N)
    log "INFO" "Starting performance metric collection"
    
    # System metrics
    local cpu_usage=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d. -f1)
    local memory_usage=$(free | grep Mem | awk '{print ($3/$2) * 100}')
    local disk_usage=$(df -h / | awk 'NR==2 {print $5}' | cut -d% -f1)
    
    # Trading performance metrics
    local trade_latency=$(curl -s "$PROMETHEUS_URL/api/v1/query?query=trade_execution_time_bucket" | jq -r '.data.result[0].value[1]')
    local strategy_performance=$(curl -s "$PROMETHEUS_URL/api/v1/query?query=strategy_performance" | jq -r '.data.result[0].value[1]')
    
    # Check thresholds and trigger alerts
    if [[ "$cpu_usage" -gt $ALERT_THRESHOLD_CPU ]]; then
        trigger_alert "WARN" "CPU usage above threshold: ${cpu_usage}%"
    fi
    
    if [[ "${memory_usage%.*}" -gt $ALERT_THRESHOLD_MEMORY ]]; then
        trigger_alert "WARN" "Memory usage above threshold: ${memory_usage%.*}%"
    fi
    
    if [[ "$disk_usage" -gt $ALERT_THRESHOLD_DISK ]]; then
        trigger_alert "WARN" "Disk usage above threshold: ${disk_usage}%"
    fi
    
    # Record collection duration
    local collection_end=$(date +%s%N)
    local collection_duration=$(( (collection_end - collection_start) / 1000000 ))
    log "INFO" "Metric collection completed in ${collection_duration}ms"
    
    # Export metrics for Prometheus
    echo "# HELP trading_bot_system_metrics System performance metrics"
    echo "# TYPE trading_bot_system_metrics gauge"
    echo "trading_bot_cpu_usage $cpu_usage"
    echo "trading_bot_memory_usage $memory_usage"
    echo "trading_bot_disk_usage $disk_usage"
    echo "trading_bot_trade_latency $trade_latency"
    echo "trading_bot_strategy_performance $strategy_performance"
}

# Intelligent alert management with deduplication
trigger_alert() {
    local severity=$1
    local message=$2
    local timestamp=$(date +%s)
    
    # Deduplicate alerts within 5-minute window
    local alert_key="${severity}_${message}"
    local last_alert=$(grep "$alert_key" "$LOG_FILE" 2>/dev/null | tail -n1 | cut -d'[' -f1)
    
    if [[ -n "$last_alert" ]]; then
        local time_diff=$((timestamp - $(date -d "$last_alert" +%s)))
        if [[ "$time_diff" -lt 300 ]]; then
            log "INFO" "Suppressing duplicate alert: $message"
            return
        fi
    fi
    
    log "$severity" "ALERT: $message"
    
    # Distribute alerts to configured channels
    IFS=',' read -ra CHANNELS <<< "$ALERT_CHANNELS"
    for channel in "${CHANNELS[@]}"; do
        case "$channel" in
            "slack")
                curl -s -X POST -H 'Content-type: application/json' \
                    --data "{\"text\":\"[$severity] $message\"}" \
                    "$SLACK_WEBHOOK_URL" >/dev/null
                ;;
            "email")
                echo "[$severity] $message" | mail -s "Trading Bot Alert" "$ALERT_EMAIL"
                ;;
            "pagerduty")
                curl -s -X POST -H 'Content-type: application/json' \
                    --data "{\"incident\":{\"title\":\"[$severity] $message\"}}" \
                    "$PAGERDUTY_API_URL" >/dev/null
                ;;
        esac
    done
}

# Main monitoring loop
main() {
    setup_logging
    log "INFO" "Starting system health monitoring"
    
    while true; do
        # Check if we're in maintenance window
        if [[ $(date +%H:%M) =~ ^02:.. ]] && [[ $(date +%w) -eq 0 ]]; then
            log "INFO" "In maintenance window, continuing monitoring"
        fi
        
        # Service health checks
        for service in "${!SERVICES[@]}"; do
            IFS='|' read -r port path interval retries timeout critical <<< "${SERVICES[$service]}"
            if ! check_service_health "$service" "$port|$path" "$retries" "$timeout"; then
                if [[ "$critical" == "true" ]]; then
                    trigger_alert "ERROR" "Critical service $service is down"
                else
                    trigger_alert "WARN" "Non-critical service $service is down"
                fi
            fi
        done
        
        # Collect and analyze performance metrics
        collect_performance_metrics
        
        sleep "$METRIC_COLLECTION_INTERVAL"
    done
}

# Trap signals for graceful shutdown
trap 'log "INFO" "Shutting down monitoring"; exit 0' SIGTERM SIGINT

# Start monitoring
main