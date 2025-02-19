# AWS Provider configuration for RDS resources
# Provider version: ~> 5.0
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Local variables for resource naming and configuration
locals {
  db_name             = "${var.project_name}-${var.environment}"
  db_identifier       = "${var.project_name}-${var.environment}-postgresql"
  db_username         = "trading_bot_admin"
  backup_window       = "03:00-04:00"
  maintenance_window  = "Mon:04:00-Mon:05:00"
}

# RDS subnet group for database instances
resource "aws_db_subnet_group" "main" {
  name        = "${local.db_identifier}-subnet-group"
  subnet_ids  = var.database_subnets
  
  tags = {
    Name        = "${local.db_identifier}-subnet-group"
    Environment = var.environment
  }
}

# RDS parameter group for PostgreSQL configuration
resource "aws_db_parameter_group" "main" {
  family = "postgres15"
  name   = "${local.db_identifier}-pg"
  
  parameter {
    name  = "shared_buffers"
    value = "8GB"
  }
  
  parameter {
    name  = "max_connections"
    value = "1000"
  }
  
  parameter {
    name  = "work_mem"
    value = "64MB"
  }
  
  parameter {
    name  = "maintenance_work_mem"
    value = "2GB"
  }
  
  parameter {
    name  = "effective_cache_size"
    value = "24GB"
  }
  
  parameter {
    name  = "timescaledb.max_background_workers"
    value = "8"
  }
  
  parameter {
    name  = "autovacuum_max_workers"
    value = "10"
  }
  
  parameter {
    name  = "random_page_cost"
    value = "1.1"
  }
}

# IAM role for RDS enhanced monitoring
resource "aws_iam_role" "rds_monitoring" {
  name = "${local.db_identifier}-monitoring-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "monitoring.rds.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}

# Primary RDS instance
resource "aws_db_instance" "main" {
  identifier                  = local.db_identifier
  engine                     = var.rds_config.engine
  engine_version             = var.rds_config.engine_version
  instance_class             = var.rds_config.instance_class
  allocated_storage          = var.rds_config.allocated_storage
  max_allocated_storage      = 1000
  db_name                    = local.db_name
  username                   = local.db_username
  multi_az                   = var.rds_config.multi_az
  db_subnet_group_name       = aws_db_subnet_group.main.name
  parameter_group_name       = aws_db_parameter_group.main.name
  backup_retention_period    = 35
  backup_window             = local.backup_window
  maintenance_window        = local.maintenance_window
  storage_encrypted         = true
  storage_type              = "gp3"
  iops                      = 12000
  performance_insights_enabled = true
  performance_insights_retention_period = 7
  monitoring_interval       = 60
  monitoring_role_arn      = aws_iam_role.rds_monitoring.arn
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]
  auto_minor_version_upgrade = true
  deletion_protection      = true
  skip_final_snapshot     = false
  final_snapshot_identifier = "${local.db_identifier}-final"
  copy_tags_to_snapshot   = true
  
  tags = {
    Name        = local.db_identifier
    Environment = var.environment
  }
}

# Read replica instance
resource "aws_db_instance" "replica" {
  identifier                  = "${local.db_identifier}-replica"
  instance_class             = var.rds_config.instance_class
  replicate_source_db        = aws_db_instance.main.id
  multi_az                   = false
  parameter_group_name       = aws_db_parameter_group.main.name
  monitoring_interval        = 60
  monitoring_role_arn        = aws_iam_role.rds_monitoring.arn
  performance_insights_enabled = true
  performance_insights_retention_period = 7
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot     = true
  
  tags = {
    Name        = "${local.db_identifier}-replica"
    Environment = var.environment
  }
}

# Output the RDS endpoints
output "rds_endpoint" {
  description = "The connection endpoint for the primary RDS instance"
  value       = aws_db_instance.main.endpoint
}

output "rds_replica_endpoint" {
  description = "The connection endpoint for the read replica RDS instance"
  value       = aws_db_instance.replica.endpoint
}