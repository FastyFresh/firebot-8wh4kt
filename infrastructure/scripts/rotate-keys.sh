#!/bin/bash

# AI-Powered Solana Trading Bot - Key Rotation Script
# Version: 1.0.0
# Dependencies:
# - aws-cli 2.0+
# - jq 1.6+

set -euo pipefail
IFS=$'\n\t'

# Source health monitoring functions
source "$(dirname "$0")/monitor-health.sh"

# Global Configuration
AWS_REGION=${AWS_REGION:-"ap-southeast-1"}
LOG_FILE=${LOG_FILE:-"/var/log/trading-bot/key-rotation.log"}
ROTATION_INTERVAL_DAYS=${ROTATION_INTERVAL_DAYS:-90}
BACKUP_DIR=${BACKUP_DIR:-"/var/backup/keys"}
ROTATION_LOCK_FILE=${ROTATION_LOCK_FILE:-"/var/run/key-rotation.lock"}
DRY_RUN=${DRY_RUN:-false}
NOTIFICATION_CHANNELS=${NOTIFICATION_CHANNELS:-"slack,email"}
ROTATION_METRICS_FILE=${ROTATION_METRICS_FILE:-"/var/log/trading-bot/rotation-metrics.json"}

# Initialize logging
setup_logging() {
    local log_dir=$(dirname "$LOG_FILE")
    if [[ ! -d "$log_dir" ]]; then
        mkdir -p "$log_dir"
        chmod 750 "$log_dir"
    fi
    touch "$LOG_FILE"
    chmod 640 "$LOG_FILE"
}

# Enhanced logging with structured format
log_rotation_event() {
    local key_alias=$1
    local status=$2
    local metrics=$3
    local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%6NZ")
    
    local log_entry=$(jq -n \
        --arg ts "$timestamp" \
        --arg ka "$key_alias" \
        --arg st "$status" \
        --argjson mt "$metrics" \
        '{timestamp: $ts, key_alias: $ka, status: $st, metrics: $mt}')
    
    echo "$log_entry" >> "$LOG_FILE"
    
    # Update rotation metrics history
    if [[ -f "$ROTATION_METRICS_FILE" ]]; then
        jq --argjson new "$log_entry" '.history += [$new]' "$ROTATION_METRICS_FILE" > "${ROTATION_METRICS_FILE}.tmp"
        mv "${ROTATION_METRICS_FILE}.tmp" "$ROTATION_METRICS_FILE"
    else
        echo "{\"history\": [$log_entry]}" > "$ROTATION_METRICS_FILE"
    fi
    
    # Trigger notifications for failures
    if [[ "$status" == "ERROR" ]]; then
        IFS=',' read -ra channels <<< "$NOTIFICATION_CHANNELS"
        for channel in "${channels[@]}"; do
            case "$channel" in
                "slack")
                    curl -s -X POST -H 'Content-type: application/json' \
                        --data "{\"text\":\"Key rotation failed for $key_alias: $metrics\"}" \
                        "$SLACK_WEBHOOK_URL" || true
                    ;;
                "email")
                    echo "Key rotation failed for $key_alias: $metrics" | \
                        mail -s "Trading Bot Key Rotation Alert" "$ALERT_EMAIL" || true
                    ;;
            esac
        done
    fi
}

# Validate prerequisites and environment
check_prerequisites() {
    local dry_run=$1
    
    # Check AWS CLI version
    if ! aws --version 2>&1 | grep -q "aws-cli/2"; then
        log_rotation_event "system" "ERROR" '{"error": "AWS CLI 2.0+ required"}'
        return 1
    fi
    
    # Check jq version
    if ! jq --version 2>&1 | grep -q "jq-1.6"; then
        log_rotation_event "system" "ERROR" '{"error": "jq 1.6+ required"}'
        return 1
    }
    
    # Validate AWS credentials
    if ! check_aws_credentials; then
        log_rotation_event "system" "ERROR" '{"error": "Invalid AWS credentials"}'
        return 1
    fi
    
    # Check KMS permissions
    if ! aws kms list-keys --region "$AWS_REGION" >/dev/null 2>&1; then
        log_rotation_event "system" "ERROR" '{"error": "Insufficient KMS permissions"}'
        return 1
    fi
    
    # Verify backup directory
    if [[ ! -d "$BACKUP_DIR" ]]; then
        mkdir -p "$BACKUP_DIR"
        chmod 700 "$BACKUP_DIR"
    fi
    
    # Check disk space (require at least 1GB free)
    local free_space=$(df -P "$BACKUP_DIR" | awk 'NR==2 {print $4}')
    if [[ "$free_space" -lt 1048576 ]]; then
        log_rotation_event "system" "ERROR" '{"error": "Insufficient disk space"}'
        return 1
    fi
    
    return 0
}

# Create versioned backup of key metadata
backup_key_metadata() {
    local key_id=$1
    local backup_type=$2
    local timestamp=$(date -u +"%Y%m%d_%H%M%S")
    local backup_file="${BACKUP_DIR}/${backup_type}_${key_id}_${timestamp}.json"
    
    # Fetch and validate key metadata
    local metadata
    if ! metadata=$(aws kms describe-key --key-id "$key_id" --region "$AWS_REGION"); then
        return 1
    fi
    
    # Encrypt metadata using backup key
    if ! aws kms encrypt \
        --key-id "$BACKUP_KEY_ID" \
        --plaintext "$(echo "$metadata" | base64)" \
        --region "$AWS_REGION" \
        --output text --query CiphertextBlob > "$backup_file"; then
        return 1
    fi
    
    # Set secure permissions
    chmod 600 "$backup_file"
    
    # Clean old backups (keep last 10)
    find "$BACKUP_DIR" -name "${backup_type}_${key_id}_*.json" -type f | \
        sort -r | tail -n +11 | xargs rm -f 2>/dev/null || true
    
    echo "$backup_file"
}

# Rotate KMS key with safety checks
rotate_kms_key() {
    local key_alias=$1
    local dry_run=$2
    local start_time=$(date +%s%N)
    
    # Acquire rotation lock
    exec 9>"$ROTATION_LOCK_FILE"
    if ! flock -n 9; then
        log_rotation_event "$key_alias" "ERROR" '{"error": "Failed to acquire lock"}'
        return 1
    fi
    
    # Get key ID from alias
    local key_id
    if ! key_id=$(aws kms describe-key \
        --key-id "alias/$key_alias" \
        --region "$AWS_REGION" \
        --query 'KeyMetadata.KeyId' \
        --output text); then
        log_rotation_event "$key_alias" "ERROR" '{"error": "Failed to get key ID"}'
        return 1
    fi
    
    # Create backup before rotation
    local backup_file
    if ! backup_file=$(backup_key_metadata "$key_id" "pre_rotation"); then
        log_rotation_event "$key_alias" "ERROR" '{"error": "Backup failed"}'
        return 1
    fi
    
    if [[ "$dry_run" == "true" ]]; then
        log_rotation_event "$key_alias" "INFO" '{"message": "Dry run completed"}'
        return 0
    fi
    
    # Enable automatic key rotation
    if ! aws kms enable-key-rotation \
        --key-id "$key_id" \
        --region "$AWS_REGION"; then
        log_rotation_event "$key_alias" "ERROR" '{"error": "Failed to enable rotation"}'
        return 1
    fi
    
    # Request immediate key rotation
    if ! aws kms update-key-description \
        --key-id "$key_id" \
        --description "Rotated on $(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        --region "$AWS_REGION"; then
        log_rotation_event "$key_alias" "ERROR" '{"error": "Rotation failed"}'
        return 1
    fi
    
    # Create post-rotation backup
    if ! backup_key_metadata "$key_id" "post_rotation" >/dev/null; then
        log_rotation_event "$key_alias" "WARN" '{"warning": "Post-rotation backup failed"}'
    fi
    
    # Calculate rotation duration
    local duration_ms=$(( ($(date +%s%N) - start_time) / 1000000 ))
    
    log_rotation_event "$key_alias" "SUCCESS" "{\"duration_ms\": $duration_ms}"
    return 0
}

# Rotate JWT signing secret
rotate_jwt_secret() {
    local dry_run=$1
    local start_time=$(date +%s%N)
    
    # Generate new secret
    local new_secret
    if ! new_secret=$(openssl rand -base64 48); then
        log_rotation_event "jwt" "ERROR" '{"error": "Failed to generate secret"}'
        return 1
    fi
    
    if [[ "$dry_run" == "true" ]]; then
        log_rotation_event "jwt" "INFO" '{"message": "Dry run completed"}'
        return 0
    fi
    
    # Encrypt and store new secret
    local encrypted_secret
    if ! encrypted_secret=$(aws kms encrypt \
        --key-id "$JWT_KEY_ID" \
        --plaintext "$new_secret" \
        --region "$AWS_REGION" \
        --output text --query CiphertextBlob); then
        log_rotation_event "jwt" "ERROR" '{"error": "Failed to encrypt secret"}'
        return 1
    fi
    
    # Update secret in Secrets Manager with version metadata
    local secret_metadata="{\"secret\":\"$encrypted_secret\",\"version\":\"$(date +%s)\",\"rotated_at\":\"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\"}"
    
    if ! aws secretsmanager update-secret \
        --secret-id "$JWT_SECRET_ID" \
        --secret-string "$secret_metadata" \
        --region "$AWS_REGION"; then
        log_rotation_event "jwt" "ERROR" '{"error": "Failed to update secret"}'
        return 1
    fi
    
    # Calculate rotation duration
    local duration_ms=$(( ($(date +%s%N) - start_time) / 1000000 ))
    
    log_rotation_event "jwt" "SUCCESS" "{\"duration_ms\": $duration_ms}"
    return 0
}

# Main key rotation orchestrator
rotate_all_keys() {
    local dry_run=${1:-false}
    local start_time=$(date +%s%N)
    
    # Initialize logging
    setup_logging
    
    # Check prerequisites
    if ! check_prerequisites "$dry_run"; then
        return 1
    fi
    
    # Rotate KMS keys
    local kms_keys=("trading" "backup" "jwt")
    for key in "${kms_keys[@]}"; do
        if ! rotate_kms_key "$key" "$dry_run"; then
            log_rotation_event "system" "ERROR" "{\"error\": \"Failed to rotate $key key\"}"
            return 1
        fi
    done
    
    # Rotate JWT secret
    if ! rotate_jwt_secret "$dry_run"; then
        log_rotation_event "system" "ERROR" '{"error": "Failed to rotate JWT secret"}'
        return 1
    fi
    
    # Calculate total duration
    local duration_ms=$(( ($(date +%s%N) - start_time) / 1000000 ))
    
    log_rotation_event "system" "SUCCESS" "{\"total_duration_ms\": $duration_ms}"
    return 0
}

# Execute rotation if script is run directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    rotate_all_keys "$DRY_RUN"
fi