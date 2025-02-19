# AWS KMS configuration for the AI-Powered Solana Trading Bot
# Manages encryption keys for database, API secrets, and wallet data

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  resource_prefix = "${var.project_name}-${var.environment}"
}

# Database Encryption KMS Key
resource "aws_kms_key" "database_encryption_key" {
  description             = "KMS key for database encryption"
  deletion_window_in_days = 30
  enable_key_rotation    = true
  is_enabled            = true

  tags = {
    Name        = "${local.resource_prefix}-db-encryption-key"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "database_encryption_key" {
  name          = "alias/${local.resource_prefix}-db-encryption-key"
  target_key_id = aws_kms_key.database_encryption_key.key_id
}

# API Secrets KMS Key
resource "aws_kms_key" "api_secrets_key" {
  description             = "KMS key for API secrets encryption"
  deletion_window_in_days = 30
  enable_key_rotation    = true
  is_enabled            = true

  tags = {
    Name        = "${local.resource_prefix}-api-secrets-key"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "api_secrets_key" {
  name          = "alias/${local.resource_prefix}-api-secrets-key"
  target_key_id = aws_kms_key.api_secrets_key.key_id
}

# Wallet Data KMS Key
resource "aws_kms_key" "wallet_data_key" {
  description             = "KMS key for wallet data encryption"
  deletion_window_in_days = 30
  enable_key_rotation    = true
  is_enabled            = true

  tags = {
    Name        = "${local.resource_prefix}-wallet-data-key"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

resource "aws_kms_alias" "wallet_data_key" {
  name          = "alias/${local.resource_prefix}-wallet-data-key"
  target_key_id = aws_kms_key.wallet_data_key.key_id
}

# Outputs for use in other Terraform configurations
output "database_encryption_key_id" {
  description = "ID of the KMS key used for database encryption"
  value       = aws_kms_key.database_encryption_key.id
}

output "database_encryption_key_arn" {
  description = "ARN of the KMS key used for database encryption"
  value       = aws_kms_key.database_encryption_key.arn
}

output "api_secrets_key_id" {
  description = "ID of the KMS key used for API secrets encryption"
  value       = aws_kms_key.api_secrets_key.id
}

output "api_secrets_key_arn" {
  description = "ARN of the KMS key used for API secrets encryption"
  value       = aws_kms_key.api_secrets_key.arn
}

output "wallet_data_key_id" {
  description = "ID of the KMS key used for wallet data encryption"
  value       = aws_kms_key.wallet_data_key.id
}

output "wallet_data_key_arn" {
  description = "ARN of the KMS key used for wallet data encryption"
  value       = aws_kms_key.wallet_data_key.arn
}