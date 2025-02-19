# Main Terraform configuration for AI-Powered Solana Trading Bot infrastructure
# Version: 1.0.0

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws" # ~> 5.0
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random" # ~> 3.5
      version = "~> 3.5"
    }
  }

  backend "s3" {
    bucket                  = "${var.project_name}-${var.environment}-tfstate"
    key                     = "terraform.tfstate"
    region                  = "ap-southeast-1"
    encrypt                 = true
    dynamodb_table         = "${var.project_name}-${var.environment}-tfstate-lock"
    kms_key_id             = "${var.state_encryption_key_arn}"
    versioning             = true
    acl                    = "private"
    server_side_encryption = "aws:kms"
  }
}

# Provider configuration
provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }

  allowed_account_ids = [var.aws_account_id]
  
  assume_role {
    role_arn     = var.terraform_role_arn
    session_name = "terraform-deployment"
  }
}

# Common resource tags
locals {
  common_tags = {
    Project          = var.project_name
    Environment      = var.environment
    ManagedBy        = "terraform"
    SecurityLevel    = "high"
    ComplianceLevel  = "financial"
    CostCenter       = "trading-bot"
  }
}

# VPC Module
module "vpc" {
  source = "./vpc"

  project_name    = var.project_name
  environment     = var.environment
  vpc_cidr        = var.vpc_cidr
  availability_zones = var.availability_zones

  enable_flow_logs     = true
  enable_vpc_endpoints = true
  nat_gateway_redundancy = true
}

# ECS Module
module "ecs" {
  source = "./ecs"

  project_name    = var.project_name
  environment     = var.environment
  vpc_id          = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets

  capacity_providers      = ["FARGATE", "FARGATE_SPOT"]
  enable_container_insights = true
  enable_execute_command   = false

  depends_on = [module.vpc]
}

# RDS Module
module "rds" {
  source = "./rds"

  project_name    = var.project_name
  environment     = var.environment
  vpc_id          = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets
  rds_config      = var.rds_config

  multi_az                = true
  backup_retention_period = 7
  deletion_protection     = true

  depends_on = [module.vpc]
}

# Redis Module
module "redis" {
  source = "./redis"

  project_name    = var.project_name
  environment     = var.environment
  vpc_id          = module.vpc.vpc_id
  private_subnets = module.vpc.private_subnets
  redis_config    = var.redis_config

  cluster_mode_enabled         = true
  automatic_failover_enabled   = true
  at_rest_encryption_enabled   = true

  depends_on = [module.vpc]
}

# VPC Outputs
output "vpc_outputs" {
  value = {
    vpc_id             = module.vpc.vpc_id
    private_subnets    = module.vpc.private_subnets
    public_subnets     = module.vpc.public_subnets
    availability_zones = module.vpc.availability_zones
  }
  description = "VPC infrastructure outputs for cross-module reference"
}

# ECS Outputs
output "ecs_outputs" {
  value = {
    cluster_id          = module.ecs.cluster_id
    execution_role_arn  = module.ecs.execution_role_arn
    cluster_name        = module.ecs.cluster_name
  }
  description = "ECS infrastructure outputs for service deployment"
}