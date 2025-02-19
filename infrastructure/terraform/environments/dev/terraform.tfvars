# Core Project Variables
project_name = "solana-trading-bot"
environment  = "dev"
aws_region   = "ap-southeast-1"

# VPC Configuration - Single AZ for Development
vpc_variables = {
  vpc_cidr            = "10.0.0.0/16"
  availability_zones  = ["ap-southeast-1a"]
  private_subnets     = ["10.0.1.0/24"]
  public_subnets      = ["10.0.101.0/24"]
}

# ECS Configuration - Minimal Resources for Development
ecs_variables = {
  ecs_cluster_name    = "solana-trading-bot-dev"
  container_insights  = true
  task_cpu           = 256  # Reduced CPU units for dev environment
  task_memory        = 512  # Reduced memory allocation for dev environment
}

# RDS Configuration - Single Instance, Minimal Resources
rds_variables = {
  rds_config = {
    instance_class           = "db.t3.large"
    allocated_storage       = 20
    engine                 = "postgres"
    engine_version         = "15.0"
    multi_az               = false  # Single AZ for dev
    backup_retention_period = 1     # Minimal backup retention
    deletion_protection    = false  # Allow deletion in dev
    skip_final_snapshot    = true   # Skip final snapshot in dev
  }
}

# Redis Configuration - Single Node Setup
redis_variables = {
  redis_config = {
    node_type                  = "cache.t3.medium"
    num_cache_nodes           = 1            # Single node for dev
    engine_version            = "7.0"
    parameter_group_family    = "redis7"
    automatic_failover_enabled = false       # Disabled for single node
    multi_az_enabled          = false        # Single AZ deployment
    snapshot_retention_limit  = 1            # Minimal snapshot retention
  }
}

# Monitoring Configuration - Basic Monitoring with Reduced Retention
monitoring_variables = {
  enable_monitoring         = true
  retention_in_days        = 7              # Reduced log retention period
  alarm_evaluation_periods = 2              # Standard evaluation periods
  alarm_threshold          = 80             # Standard threshold for alerts
}