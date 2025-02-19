#!/bin/bash

# AI-Powered Solana Trading Bot Rollback Script
# Version: 1.0.0
# Dependencies:
# - aws-cli: 2.0+
# - jq: 1.6+

set -euo pipefail

# Source deployment functions
source "$(dirname "$0")/deploy.sh"

# Global variables
export AWS_REGION="ap-southeast-1"
export CLUSTER_NAME="trading-bot-cluster"
export LOG_FILE="/var/log/trading-bot/rollback.log"
export ROLLBACK_TIMEOUT="300"
export HEALTH_CHECK_INTERVAL="5"
export MAX_RETRY_ATTEMPTS="3"

# Logging function with timestamps
log() {
    local level=$1
    local message=$2
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] ${level}: ${message}" | tee -a "${LOG_FILE}"
}

# Validate rollback arguments and permissions
validate_rollback_args() {
    local environment=$1
    local service_name=$2
    local aws_role=$3

    # Validate environment
    if [[ ! "${environment}" =~ ^(dev|staging|prod)$ ]]; then
        log "ERROR" "Invalid environment: ${environment}. Must be dev, staging, or prod"
        return 1
    }

    # Verify service exists in cluster
    if ! aws ecs list-services --cluster "${CLUSTER_NAME}-${environment}" | grep -q "${service_name}"; then
        log "ERROR" "Service ${service_name} not found in cluster ${CLUSTER_NAME}-${environment}"
        return 1
    }

    # Check AWS permissions
    if ! aws sts assume-role --role-arn "${aws_role}" --role-session-name "RollbackValidation" >/dev/null 2>&1; then
        log "ERROR" "Insufficient AWS permissions for role: ${aws_role}"
        return 1
    }

    # Verify deployment window compliance
    local current_hour=$(date +%H)
    if [[ "${environment}" == "prod" && "${current_hour}" -lt 22 && "${current_hour}" -gt 4 ]]; then
        log "ERROR" "Production rollbacks only allowed between 22:00 and 04:00"
        return 1
    }

    return 0
}

# Get previous stable task definition
get_previous_task_definition() {
    local service_name=$1
    local version_constraint=$2

    log "INFO" "Retrieving previous stable task definition for ${service_name}"

    # List task definition revisions
    local task_definitions=$(aws ecs list-task-definitions \
        --family-prefix "${service_name}" \
        --sort DESC \
        --status ACTIVE)

    # Find last known stable version
    local previous_task_def=$(echo "${task_definitions}" | jq -r '.taskDefinitionArns | .[1]')

    if [[ -z "${previous_task_def}" ]]; then
        log "ERROR" "No previous task definition found for ${service_name}"
        return 1
    }

    # Verify task definition compatibility
    if ! aws ecs describe-task-definition --task-definition "${previous_task_def}" \
        --query 'taskDefinition.containerDefinitions[0].image' | grep -q "${version_constraint}"; then
        log "ERROR" "Previous task definition does not meet version constraint: ${version_constraint}"
        return 1
    }

    echo "${previous_task_def}"
    return 0
}

# Stop current deployment with graceful connection draining
stop_current_deployment() {
    local service_name=$1
    local cluster_name=$2
    local drain_timeout=$3

    log "INFO" "Initiating graceful shutdown of current deployment for ${service_name}"

    # Get current running tasks
    local current_tasks=$(aws ecs list-tasks \
        --cluster "${cluster_name}" \
        --service-name "${service_name}" \
        --desired-status RUNNING)

    # Enable connection draining
    aws ecs update-service \
        --cluster "${cluster_name}" \
        --service "${service_name}" \
        --enable-execute-command \
        --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200" \
        --force-new-deployment

    # Wait for connections to drain
    local timeout_counter=0
    while [[ "${timeout_counter}" -lt "${drain_timeout}" ]]; do
        if [[ $(aws ecs describe-services \
            --cluster "${cluster_name}" \
            --services "${service_name}" \
            --query 'services[0].deployments[?status==`PRIMARY`].runningCount' \
            --output text) -eq 0 ]]; then
            log "INFO" "All connections drained successfully"
            return 0
        fi
        sleep 5
        ((timeout_counter+=5))
    done

    log "ERROR" "Connection draining timed out after ${drain_timeout} seconds"
    return 1
}

# Execute service rollback with progressive traffic shifting
rollback_service() {
    local service_name=$1
    local task_definition_arn=$2
    local traffic_config=$3

    log "INFO" "Initiating rollback to task definition: ${task_definition_arn}"

    # Update service with previous task definition
    aws ecs update-service \
        --cluster "${CLUSTER_NAME}" \
        --service "${service_name}" \
        --task-definition "${task_definition_arn}" \
        --force-new-deployment

    # Monitor deployment progress
    local deployment_status
    local timeout_counter=0
    while [[ "${timeout_counter}" -lt "${ROLLBACK_TIMEOUT}" ]]; do
        deployment_status=$(aws ecs describe-services \
            --cluster "${CLUSTER_NAME}" \
            --services "${service_name}" \
            --query 'services[0].deployments[?status==`PRIMARY`].rolloutState' \
            --output text)

        if [[ "${deployment_status}" == "COMPLETED" ]]; then
            log "INFO" "Rollback deployment completed successfully"
            return 0
        elif [[ "${deployment_status}" == "FAILED" ]]; then
            log "ERROR" "Rollback deployment failed"
            return 1
        fi

        sleep "${HEALTH_CHECK_INTERVAL}"
        ((timeout_counter+="${HEALTH_CHECK_INTERVAL}"))
    done

    log "ERROR" "Rollback timed out after ${ROLLBACK_TIMEOUT} seconds"
    return 1
}

# Verify system health after rollback
verify_rollback() {
    local service_name=$1
    local health_check_config=$2

    log "INFO" "Verifying system health after rollback"

    # Check service health metrics
    local retry_count=0
    while [[ "${retry_count}" -lt "${MAX_RETRY_ATTEMPTS}" ]]; do
        # Verify service is running
        if ! aws ecs describe-services \
            --cluster "${CLUSTER_NAME}" \
            --services "${service_name}" \
            --query 'services[0].runningCount' \
            --output text | grep -q '^[1-9][0-9]*$'; then
            log "ERROR" "Service ${service_name} is not running"
            ((retry_count++))
            sleep "${HEALTH_CHECK_INTERVAL}"
            continue
        fi

        # Check trading system functionality
        if ! curl -sf "http://${service_name}/health" >/dev/null; then
            log "ERROR" "Health check failed for ${service_name}"
            ((retry_count++))
            sleep "${HEALTH_CHECK_INTERVAL}"
            continue
        fi

        log "INFO" "System health verification passed"
        return 0
    done

    log "ERROR" "System health verification failed after ${MAX_RETRY_ATTEMPTS} attempts"
    return 1
}

# Main rollback function
main() {
    if [[ $# -ne 3 ]]; then
        echo "Usage: $0 <environment> <service_name> <aws_role>"
        exit 1
    fi

    local environment=$1
    local service_name=$2
    local aws_role=$3

    log "INFO" "Starting rollback process for ${service_name} in ${environment}"

    # Validate arguments and permissions
    if ! validate_rollback_args "${environment}" "${service_name}" "${aws_role}"; then
        log "ERROR" "Rollback validation failed"
        exit 1
    fi

    # Get previous stable task definition
    local previous_task_def
    if ! previous_task_def=$(get_previous_task_definition "${service_name}" "v[0-9]+\.[0-9]+\.[0-9]+"); then
        log "ERROR" "Failed to get previous task definition"
        exit 1
    fi

    # Stop current deployment
    if ! stop_current_deployment "${service_name}" "${CLUSTER_NAME}-${environment}" 300; then
        log "ERROR" "Failed to stop current deployment"
        exit 1
    fi

    # Execute rollback
    if ! rollback_service "${service_name}" "${previous_task_def}" '{"type":"LINEAR","interval":30,"percentage":10}'; then
        log "ERROR" "Rollback failed"
        exit 1
    fi

    # Verify rollback
    if ! verify_rollback "${service_name}" "${health_check_config}"; then
        log "ERROR" "Rollback verification failed"
        exit 1
    fi

    log "INFO" "Rollback completed successfully"
    return 0
}

# Execute main function with error handling
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    trap 'log "ERROR" "Rollback failed with error on line $LINENO"' ERR
    main "$@"
fi