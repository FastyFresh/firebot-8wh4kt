#!/bin/bash

# AI-Powered Solana Trading Bot Deployment Script
# Version: 1.0.0
# AWS CLI Version: 2.0+
# Docker Version: 24.0+
# Terraform Version: 1.5+

set -euo pipefail

# Global variables
export AWS_REGION="ap-southeast-1"
export ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
export PROJECT_NAME="trading-bot"
export LOG_LEVEL="INFO"
export DEPLOYMENT_TIMEOUT="1800"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Logging function
log() {
    local level=$1
    local message=$2
    echo -e "[$(date +'%Y-%m-%d %H:%M:%S')] ${level}: ${message}"
}

# Enhanced prerequisites check
check_prerequisites() {
    log "${LOG_LEVEL}" "Checking deployment prerequisites..."
    
    # Check AWS CLI
    if ! aws --version >/dev/null 2>&1; then
        log "ERROR" "AWS CLI not found. Please install AWS CLI v2.0+"
        return 1
    fi

    # Verify AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log "ERROR" "Invalid AWS credentials. Please configure AWS CLI"
        return 1
    fi

    # Check Docker
    if ! docker --version >/dev/null 2>&1; then
        log "ERROR" "Docker not found. Please install Docker 24.0+"
        return 1
    fi

    # Check Terraform
    if ! terraform version >/dev/null 2>&1; then
        log "ERROR" "Terraform not found. Please install Terraform 1.5+"
        return 1
    }

    # Verify required environment variables
    local required_vars=("AWS_ACCOUNT_ID" "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY")
    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            log "ERROR" "Required environment variable $var is not set"
            return 1
        fi
    done

    log "INFO" "All prerequisites satisfied"
    return 0
}

# Build and scan Docker images
build_images() {
    local version_tag=$1
    log "INFO" "Building Docker images with version: ${version_tag}"

    # Build backend image
    log "INFO" "Building backend image..."
    docker build \
        --build-arg RUST_VERSION=1.70 \
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        --build-arg VERSION="${version_tag}" \
        --tag "${ECR_REGISTRY}/${PROJECT_NAME}/backend:${version_tag}" \
        --tag "${ECR_REGISTRY}/${PROJECT_NAME}/backend:latest" \
        --file backend/Dockerfile .

    # Build web dashboard image
    log "INFO" "Building web dashboard image..."
    docker build \
        --build-arg NODE_VERSION=18 \
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \
        --build-arg VERSION="${version_tag}" \
        --tag "${ECR_REGISTRY}/${PROJECT_NAME}/web:${version_tag}" \
        --tag "${ECR_REGISTRY}/${PROJECT_NAME}/web:latest" \
        --file web/Dockerfile .

    # Run security scans
    log "INFO" "Running security scans on images..."
    for image in "backend" "web"; do
        if ! docker scan "${ECR_REGISTRY}/${PROJECT_NAME}/${image}:${version_tag}"; then
            log "ERROR" "Security vulnerabilities found in ${image} image"
            return 1
        fi
    done

    # Push images to ECR
    log "INFO" "Pushing images to ECR..."
    aws ecr get-login-password --region "${AWS_REGION}" | \
        docker login --username AWS --password-stdin "${ECR_REGISTRY}"

    for image in "backend" "web"; do
        docker push "${ECR_REGISTRY}/${PROJECT_NAME}/${image}:${version_tag}"
        docker push "${ECR_REGISTRY}/${PROJECT_NAME}/${image}:latest"
    done

    return 0
}

# Deploy infrastructure using Terraform
deploy_infrastructure() {
    local environment=$1
    log "INFO" "Deploying infrastructure for environment: ${environment}"

    cd terraform/

    # Initialize Terraform
    log "INFO" "Initializing Terraform..."
    terraform init \
        -backend-config="bucket=${PROJECT_NAME}-terraform-state" \
        -backend-config="key=${environment}/terraform.tfstate" \
        -backend-config="region=${AWS_REGION}"

    # Select workspace
    terraform workspace select "${environment}" || terraform workspace new "${environment}"

    # Plan and apply changes
    log "INFO" "Planning infrastructure changes..."
    terraform plan -out=tfplan

    log "INFO" "Applying infrastructure changes..."
    terraform apply -auto-approve tfplan

    cd ..
    return 0
}

# Deploy services to ECS
deploy_services() {
    local version_tag=$1
    local environment=$2
    log "INFO" "Deploying services with version ${version_tag} to ${environment}"

    # Update task definitions
    log "INFO" "Updating ECS task definitions..."
    for service in "backend" "web"; do
        aws ecs register-task-definition \
            --family "${PROJECT_NAME}-${service}" \
            --cli-input-json file://ecs/task-definitions/${service}.json \
            --region "${AWS_REGION}"
    done

    # Deploy services with blue-green strategy
    log "INFO" "Starting blue-green deployment..."
    for service in "backend" "web"; do
        aws ecs update-service \
            --cluster "${PROJECT_NAME}-${environment}" \
            --service "${PROJECT_NAME}-${service}" \
            --task-definition "${PROJECT_NAME}-${service}" \
            --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200" \
            --region "${AWS_REGION}"
    done

    # Monitor deployment
    log "INFO" "Monitoring deployment status..."
    timeout "${DEPLOYMENT_TIMEOUT}" bash -c '
        until aws ecs describe-services \
            --cluster "${PROJECT_NAME}-${environment}" \
            --services "${PROJECT_NAME}-backend" "${PROJECT_NAME}-web" \
            --region "${AWS_REGION}" \
            --query "services[?deployments[?status=='PRIMARY']].deployments[?status=='PRIMARY'].runningCount" \
            --output text | grep -q "3"; do
            echo "Waiting for services to stabilize..."
            sleep 30
        done
    '

    return 0
}

# Rollback function
rollback() {
    local previous_version=$1
    log "WARNING" "Initiating rollback to version ${previous_version}"

    # Stop current deployment
    log "INFO" "Stopping current deployment..."
    for service in "backend" "web"; do
        aws ecs update-service \
            --cluster "${PROJECT_NAME}-${ENVIRONMENT}" \
            --service "${PROJECT_NAME}-${service}" \
            --task-definition "${PROJECT_NAME}-${service}:${previous_version}" \
            --region "${AWS_REGION}"
    done

    log "INFO" "Rollback completed to version ${previous_version}"
    return 0
}

# Main deployment function
main() {
    local version_tag=$1
    local environment=$2

    log "INFO" "Starting deployment process for version ${version_tag} in ${environment}"

    # Check prerequisites
    if ! check_prerequisites; then
        log "ERROR" "Prerequisites check failed"
        exit 1
    fi

    # Build and push images
    if ! build_images "${version_tag}"; then
        log "ERROR" "Image build failed"
        exit 1
    fi

    # Deploy infrastructure
    if ! deploy_infrastructure "${environment}"; then
        log "ERROR" "Infrastructure deployment failed"
        exit 1
    fi

    # Deploy services
    if ! deploy_services "${version_tag}" "${environment}"; then
        log "ERROR" "Service deployment failed"
        rollback "$(aws ecs describe-services \
            --cluster "${PROJECT_NAME}-${environment}" \
            --services "${PROJECT_NAME}-backend" \
            --query 'services[0].taskDefinition' \
            --output text | cut -d':' -f2)"
        exit 1
    fi

    log "INFO" "Deployment completed successfully"
    return 0
}

# Script execution
if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <version_tag> <environment>"
    echo "Example: $0 v1.0.0 production"
    exit 1
fi

main "$1" "$2"