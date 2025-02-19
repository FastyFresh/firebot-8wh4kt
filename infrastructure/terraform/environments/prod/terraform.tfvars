# Project and Environment Configuration
project_name = "solana-trading-bot"
environment  = "prod"
aws_region   = "ap-southeast-1"

# VPC Configuration
vpc_cidr = "10.0.0.0/16"
availability_zones = [
  "ap-southeast-1a",
  "ap-southeast-1b"
]

# ECS Configuration
ecs_cluster_name    = "solana-trading-bot-prod"
container_insights  = true
task_cpu           = 4096  # 4 vCPU
task_memory        = 8192  # 8GB RAM

# RDS Configuration
rds_config = {
  instance_class            = "db.r6g.xlarge"    # Production-grade instance with 4 vCPU, 32GB RAM
  allocated_storage        = 100                 # 100GB storage
  engine                  = "postgres"
  engine_version          = "15.0"              # Latest stable PostgreSQL version
  multi_az                = true                # High availability configuration
  backup_retention_period = 30                  # 30 days backup retention
  performance_insights_enabled = true           # Enable performance monitoring
  deletion_protection     = true                # Prevent accidental deletion
  storage_encrypted      = true                # Enable storage encryption
}

# Redis Configuration
redis_config = {
  node_type                  = "cache.r6g.large"  # Production-grade instance with 2 vCPU, 13GB RAM
  num_cache_nodes           = 2                   # Multi-node for high availability
  engine_version            = "7.0"               # Latest stable Redis version
  parameter_group_family    = "redis7"
  automatic_failover_enabled = true               # Enable automatic failover
  multi_az_enabled          = true                # Multi-AZ deployment
  at_rest_encryption_enabled = true               # Enable encryption at rest
  transit_encryption_enabled = true               # Enable encryption in transit
}

# Monitoring Configuration
enable_monitoring  = true
retention_in_days = 30                            # 30 days log retention

# CloudWatch Alarm Configuration
alarm_config = {
  cpu_utilization_threshold      = 80             # 80% CPU utilization threshold
  memory_utilization_threshold   = 80             # 80% memory utilization threshold
  disk_queue_depth_threshold     = 10             # IO performance threshold
  freeable_memory_threshold      = 256            # 256MB minimum free memory
  swap_usage_threshold          = 256            # 256MB maximum swap usage
}