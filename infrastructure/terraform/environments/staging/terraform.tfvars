# Project and Environment Configuration
project_name = "solana-trading-bot"
environment  = "staging"
aws_region   = "ap-southeast-1"

# VPC Configuration
vpc_cidr            = "10.0.0.0/16"
availability_zones  = ["ap-southeast-1a", "ap-southeast-1b"]
private_subnet_cidrs = ["10.0.1.0/24", "10.0.2.0/24"]
public_subnet_cidrs  = ["10.0.101.0/24", "10.0.102.0/24"]

# ECS Configuration
ecs_cluster_name    = "solana-trading-bot-staging"
container_insights  = true

task_cpu = {
  strategy_engine  = 2048
  execution_engine = 4096
  data_collector   = 2048
}

task_memory = {
  strategy_engine  = 4096
  execution_engine = 8192
  data_collector   = 4096
}

# RDS Configuration
rds_config = {
  instance_class           = "db.r6g.xlarge"
  allocated_storage       = 100
  max_allocated_storage   = 500
  engine                 = "postgres"
  engine_version         = "15.0"
  multi_az               = true
  backup_retention_period = 7
  backup_window          = "16:00-17:00"
  maintenance_window     = "Sun:17:00-Sun:18:00"
}

# Redis Configuration
redis_config = {
  node_type                  = "cache.r6g.large"
  num_cache_nodes           = 2
  engine_version            = "7.0"
  parameter_group_family    = "redis7"
  automatic_failover_enabled = true
  multi_az_enabled          = true
  maintenance_window        = "sun:18:00-sun:19:00"
}

# Monitoring Configuration
enable_monitoring = true
retention_in_days = 30

alarm_config = {
  cpu_utilization_threshold    = 80
  memory_utilization_threshold = 80
  disk_queue_depth_threshold   = 10
  evaluation_periods          = 2
  period_seconds             = 300
}

# Security Configuration
waf_enabled       = true
guardduty_enabled = true

# Common Tags
tags = {
  Project     = "SolanaTradingBot"
  Environment = "staging"
  ManagedBy   = "Terraform"
  Region      = "ap-southeast-1"
}