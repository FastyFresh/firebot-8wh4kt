#!/bin/bash
set -euo pipefail

# Version: 1.0.0
# Description: Enterprise-grade database backup management script for PostgreSQL and TimescaleDB
# Dependencies: postgresql-client v15.0, aws-cli v2.0

# Global configuration
BACKUP_ROOT="/var/backups/trading-bot"
S3_BUCKET="trading-bot-backups-ap-southeast-1"
RETENTION_DAYS_MARKET=90
RETENTION_DAYS_TRADE=2555  # 7 years
MAX_RETRIES=3
BACKUP_CHUNK_SIZE="5GB"
KMS_KEY_ID="arn:aws:kms:ap-southeast-1:account:key/backup-key"

# Logging configuration
LOG_FILE="/var/log/trading-bot/backup_audit.log"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Database configuration - sourced from database.rs
DB_HOST="localhost"
DB_PORT=5432
DB_USER="trading_bot"
DB_NAME="trading_bot"

# Logging function with CloudWatch integration
log() {
    local level=$1
    local message=$2
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    local log_entry="{\"timestamp\":\"${timestamp}\",\"level\":\"${level}\",\"message\":\"${message}\"}"
    
    echo "${log_entry}" | tee -a "${LOG_FILE}"
    aws cloudwatch put-metric-data \
        --namespace "TradingBot/Backup" \
        --metric-name "BackupStatus" \
        --value "$([ "${level}" = "ERROR" ] && echo 0 || echo 1)" \
        --timestamp "${timestamp}"
}

# Validate environment and dependencies
validate_environment() {
    local required_commands=("pg_dump" "pg_restore" "aws" "pigz")
    
    for cmd in "${required_commands[@]}"; do
        if ! command -v "${cmd}" &> /dev/null; then
            log "ERROR" "Required command not found: ${cmd}"
            exit 1
        fi
    done

    # Validate backup directory
    if [[ ! -d "${BACKUP_ROOT}" ]]; then
        mkdir -p "${BACKUP_ROOT}"
        chmod 700 "${BACKUP_ROOT}"
    fi
}

# Create backup with integrity validation
create_backup() {
    local database=$1
    local backup_type=$2
    local backup_dir="${BACKUP_ROOT}/${backup_type}/${TIMESTAMP}"
    local backup_file="${backup_dir}/${database}_${TIMESTAMP}.sql.gz"
    local metadata_file="${backup_dir}/metadata.json"
    local checksum_file="${backup_dir}/sha256sums"
    
    mkdir -p "${backup_dir}"
    
    log "INFO" "Starting backup of ${database} (${backup_type})"
    
    # Perform backup with parallel compression
    PGPASSWORD="${DB_PASSWORD}" pg_dump \
        -h "${DB_HOST}" \
        -p "${DB_PORT}" \
        -U "${DB_USER}" \
        -d "${database}" \
        -F custom \
        -Z 0 \
        -j 4 \
        | pigz -p 4 > "${backup_file}"
    
    if [[ $? -ne 0 ]]; then
        log "ERROR" "Backup failed for ${database}"
        return 1
    fi
    
    # Calculate checksum
    sha256sum "${backup_file}" > "${checksum_file}"
    
    # Generate metadata
    cat > "${metadata_file}" << EOF
{
    "database": "${database}",
    "type": "${backup_type}",
    "timestamp": "${TIMESTAMP}",
    "size": "$(stat -f %z "${backup_file}")",
    "checksum": "$(cat "${checksum_file}" | cut -d' ' -f1)"
}
EOF
    
    log "INFO" "Backup completed successfully for ${database}"
    return 0
}

# Upload backup to S3 with encryption
upload_to_s3() {
    local backup_dir=$1
    local s3_path="s3://${S3_BUCKET}/$(basename "${backup_dir}")"
    local retry_count=0
    
    log "INFO" "Starting upload to S3: ${s3_path}"
    
    while [[ ${retry_count} -lt ${MAX_RETRIES} ]]; do
        if aws s3 sync "${backup_dir}" "${s3_path}" \
            --sse aws:kms \
            --sse-kms-key-id "${KMS_KEY_ID}" \
            --metadata "timestamp=${TIMESTAMP}" \
            --only-show-errors; then
            
            log "INFO" "Upload completed successfully"
            return 0
        fi
        
        retry_count=$((retry_count + 1))
        log "WARN" "Upload failed, attempt ${retry_count} of ${MAX_RETRIES}"
        sleep $((2 ** retry_count))
    done
    
    log "ERROR" "Upload failed after ${MAX_RETRIES} attempts"
    return 1
}

# Clean up old backups based on retention policy
cleanup_old_backups() {
    local backup_type=$1
    local retention_days=$2
    
    log "INFO" "Starting cleanup for ${backup_type} backups older than ${retention_days} days"
    
    # Clean local backups
    find "${BACKUP_ROOT}/${backup_type}" -type d -mtime "+${retention_days}" -exec rm -rf {} \;
    
    # Clean S3 backups
    aws s3 ls "s3://${S3_BUCKET}/${backup_type}/" | while read -r line; do
        local backup_date=$(echo "${line}" | awk '{print $1}')
        local days_old=$(( ($(date +%s) - $(date -d "${backup_date}" +%s)) / 86400 ))
        
        if [[ ${days_old} -gt ${retention_days} ]]; then
            aws s3 rm "s3://${S3_BUCKET}/${backup_type}/${line##* }" --recursive
            log "INFO" "Removed old backup: ${line##* }"
        fi
    done
}

# Main backup process
main() {
    validate_environment
    
    # Export required environment variables
    export AWS_DEFAULT_REGION="ap-southeast-1"
    
    # Market data backup (90 days retention)
    if create_backup "market_data" "market"; then
        upload_to_s3 "${BACKUP_ROOT}/market/${TIMESTAMP}"
        cleanup_old_backups "market" "${RETENTION_DAYS_MARKET}"
    else
        log "ERROR" "Market data backup failed"
        exit 1
    fi
    
    # Trade history backup (7 years retention)
    if create_backup "trade_history" "trade"; then
        upload_to_s3 "${BACKUP_ROOT}/trade/${TIMESTAMP}"
        cleanup_old_backups "trade" "${RETENTION_DAYS_TRADE}"
    else
        log "ERROR" "Trade history backup failed"
        exit 1
    fi
    
    # Update CloudWatch metrics
    aws cloudwatch put-metric-data \
        --namespace "TradingBot/Backup" \
        --metric-name "BackupSuccess" \
        --value 1 \
        --timestamp "${TIMESTAMP}"
    
    log "INFO" "Backup process completed successfully"
}

# Execute main function
main

exit 0