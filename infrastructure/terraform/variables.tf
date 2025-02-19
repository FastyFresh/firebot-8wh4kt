# Provider-required variables
variable "project_name" {
  type        = string
  description = "Name of the trading bot project for resource tagging and identification"
  default     = "solana-trading-bot"
}

variable "environment" {
  type        = string
  description = "Deployment environment (dev, staging, prod) affecting resource sizing and configuration"
  
  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Environment must be one of: dev, staging, prod"
  }
}

variable "aws_region" {
  type        = string
  description = "AWS region for infrastructure deployment, optimized for Solana DEX latency"
  default     = "ap-southeast-1"
}

variable "tags" {
  type        = map(string)
  description = "Common tags to be applied to all resources for management and cost tracking"
  default = {
    Project    = "SolanaTradingBot"
    ManagedBy  = "Terraform"
  }
}

# VPC Configuration Variables
variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the VPC network"
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  type        = list(string)
  description = "List of availability zones in Singapore region for high availability"
  default     = ["ap-southeast-1a", "ap-southeast-1b"]
}

variable "private_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for private subnets in each AZ"
  default     = ["10.0.1.0/24", "10.0.2.0/24"]
}

variable "public_subnet_cidrs" {
  type        = list(string)
  description = "CIDR blocks for public subnets in each AZ"
  default     = ["10.0.101.0/24", "10.0.102.0/24"]
}

# ECS Configuration Variables
variable "ecs_cluster_name" {
  type        = string
  description = "Name of the ECS cluster for container orchestration"
}

variable "container_insights" {
  type        = bool
  description = "Enable Container Insights for detailed monitoring"
  default     = true
}

variable "task_cpu" {
  type        = map(number)
  description = "CPU units for ECS tasks by service"
  default = {
    strategy_engine   = 2048
    execution_engine  = 4096
    data_collector    = 2048
  }
}

variable "task_memory" {
  type        = map(number)
  description = "Memory (MiB) for ECS tasks by service"
  default = {
    strategy_engine   = 4096
    execution_engine  = 8192
    data_collector    = 4096
  }
}

# RDS Configuration Variables
variable "rds_config" {
  type        = map(any)
  description = "RDS configuration including instance class, storage, and high availability settings"
  default = {
    instance_class          = "db.r6g.xlarge"
    allocated_storage      = 100
    max_allocated_storage  = 500
    engine                = "postgres"
    engine_version        = "15.0"
    multi_az              = true
    backup_retention_period = 7
    backup_window         = "16:00-17:00"
    maintenance_window    = "Sun:17:00-Sun:18:00"
  }
}

variable "rds_credentials" {
  type        = map(string)
  description = "RDS credentials (to be provided, no defaults)"
  sensitive   = true
}

# Redis Configuration Variables
variable "redis_config" {
  type        = map(any)
  description = "ElastiCache Redis configuration for caching and session management"
  default = {
    node_type                  = "cache.r6g.large"
    num_cache_nodes           = 2
    engine_version            = "7.0"
    parameter_group_family    = "redis7"
    automatic_failover_enabled = true
    multi_az_enabled          = true
    maintenance_window        = "sun:18:00-sun:19:00"
  }
}

# Monitoring Configuration Variables
variable "enable_monitoring" {
  type        = bool
  description = "Enable comprehensive CloudWatch monitoring and logging"
  default     = true
}

variable "retention_in_days" {
  type        = number
  description = "Log retention period in days"
  default     = 30
}

variable "alarm_config" {
  type        = map(any)
  description = "CloudWatch alarm configurations"
  default = {
    cpu_utilization_threshold     = 80
    memory_utilization_threshold  = 80
    disk_queue_depth_threshold    = 10
    evaluation_periods           = 2
    period_seconds              = 300
  }
}

# Security Configuration Variables
variable "ssl_certificate_arn" {
  type        = string
  description = "ARN of SSL certificate for HTTPS endpoints"
  sensitive   = true
}

variable "waf_enabled" {
  type        = bool
  description = "Enable AWS WAF for web application firewall protection"
  default     = true
}

variable "guardduty_enabled" {
  type        = bool
  description = "Enable AWS GuardDuty for threat detection"
  default     = true
}