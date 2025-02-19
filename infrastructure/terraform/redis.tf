# AWS Provider configuration for Redis resources
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Local variables for Redis configuration
locals {
  redis_cluster_name       = "${var.project_name}-${var.environment}-redis"
  redis_port              = 6379
  redis_maintenance_window = "sun:03:00-sun:04:00"
  redis_snapshot_window   = "02:00-03:00"
}

# Security group for Redis cluster
resource "aws_security_group" "redis" {
  name_prefix = "${local.redis_cluster_name}-sg"
  vpc_id      = data.aws_vpc.main.id

  ingress {
    from_port       = local.redis_port
    to_port         = local.redis_port
    protocol        = "tcp"
    security_groups = [] # To be populated by application security groups
  }

  tags = {
    Name        = "${local.redis_cluster_name}-sg"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Subnet group for Redis deployment
resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.redis_cluster_name}-subnet-group"
  subnet_ids = data.aws_subnet.database_subnets.*.id

  tags = {
    Name        = "${local.redis_cluster_name}-subnet-group"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Parameter group for Redis configuration
resource "aws_elasticache_parameter_group" "main" {
  family      = var.redis_config.parameter_group_family
  name        = "${local.redis_cluster_name}-params"
  description = "Custom parameter group for ${local.redis_cluster_name}"

  parameter {
    name  = "maxmemory-policy"
    value = "allkeys-lru"
  }

  parameter {
    name  = "notify-keyspace-events"
    value = "Ex"
  }

  parameter {
    name  = "tcp-keepalive"
    value = "300"
  }

  parameter {
    name  = "maxmemory-samples"
    value = "10"
  }

  tags = {
    Name        = "${local.redis_cluster_name}-params"
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Redis replication group
resource "aws_elasticache_replication_group" "main" {
  replication_group_id          = local.redis_cluster_name
  description                   = "Redis cluster for ${var.project_name} ${var.environment}"
  node_type                     = var.redis_config.node_type
  num_cache_clusters           = var.redis_config.num_cache_nodes
  port                         = local.redis_port
  parameter_group_name         = aws_elasticache_parameter_group.main.name
  subnet_group_name            = aws_elasticache_subnet_group.main.name
  security_group_ids           = [aws_security_group.redis.id]
  automatic_failover_enabled   = true
  multi_az_enabled            = true
  engine                       = "redis"
  engine_version              = var.redis_config.engine_version
  at_rest_encryption_enabled  = true
  transit_encryption_enabled  = true
  maintenance_window          = local.redis_maintenance_window
  snapshot_window             = local.redis_snapshot_window
  snapshot_retention_limit    = 7

  tags = {
    Name        = local.redis_cluster_name
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}

# Outputs
output "redis_endpoint" {
  description = "Primary endpoint for Redis cluster"
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_port" {
  description = "Redis port number"
  value       = local.redis_port
}

output "redis_security_group_id" {
  description = "Security group ID for Redis cluster"
  value       = aws_security_group.redis.id
}