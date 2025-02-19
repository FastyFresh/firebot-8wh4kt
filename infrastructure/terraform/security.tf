# AWS Provider configuration with required version constraint
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Local variables for resource naming and tagging
locals {
  resource_prefix = "${var.project_name}-${var.environment}"
  common_tags = {
    Project             = var.project_name
    Environment         = var.environment
    ManagedBy          = "terraform"
    SecurityCompliance = "ISO27001"
    DataClassification = "confidential"
  }
}

# Enhanced ECS Task Execution Role
resource "aws_iam_role" "ecs_task_role" {
  name = "${local.resource_prefix}-ecs-task-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
        Condition = {
          ArnLike = {
            "aws:SourceArn": "arn:aws:ecs:ap-southeast-1:*:*"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

# ECS Task Role Policy with enhanced security permissions
resource "aws_iam_role_policy" "ecs_task_policy" {
  name = "${local.resource_prefix}-ecs-task-policy"
  role = aws_iam_role.ecs_task_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "ssm:GetParameters",
          "cloudwatch:PutMetricData",
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

# KMS Key for data encryption
resource "aws_kms_key" "app_encryption" {
  description             = "${local.resource_prefix} encryption key"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  
  tags = local.common_tags
}

# Security Group for application containers
resource "aws_security_group" "app_security_group" {
  name        = "${local.resource_prefix}-app-sg"
  description = "Security group for trading bot application with monitoring"
  vpc_id      = var.vpc_id

  ingress {
    description     = "HTTPS from ALB"
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
  }

  ingress {
    description     = "Prometheus metrics"
    from_port       = 9090
    to_port         = 9090
    protocol        = "tcp"
    security_groups = [aws_security_group.monitoring_security_group.id]
  }

  ingress {
    description     = "Health check"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [var.alb_security_group_id]
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# Security Group for monitoring services
resource "aws_security_group" "monitoring_security_group" {
  name        = "${local.resource_prefix}-monitoring-sg"
  description = "Security group for monitoring services"
  vpc_id      = var.vpc_id

  ingress {
    description = "Prometheus access"
    from_port   = 9090
    to_port     = 9090
    protocol    = "tcp"
    self        = true
  }

  egress {
    description = "Allow all outbound traffic"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# WAF Web ACL for application protection
resource "aws_wafv2_web_acl" "app_waf" {
  name        = "${local.resource_prefix}-waf"
  description = "WAF rules for trading bot application"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "RateLimit"
    priority = 1

    override_action {
      none {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "${local.resource_prefix}-rate-limit"
      sampled_requests_enabled  = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name               = "${local.resource_prefix}-waf-metrics"
    sampled_requests_enabled  = true
  }

  tags = local.common_tags
}

# GuardDuty Detector for threat detection
resource "aws_guardduty_detector" "main" {
  enable = true

  datasources {
    s3_logs {
      enable = true
    }
    kubernetes {
      audit_logs {
        enable = true
      }
    }
  }

  tags = local.common_tags
}

# CloudWatch Log Group for security monitoring
resource "aws_cloudwatch_log_group" "security_logs" {
  name              = "/aws/security/${local.resource_prefix}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.app_encryption.arn

  tags = local.common_tags
}

# Outputs for use in other modules
output "ecs_task_role_arn" {
  description = "ARN of the enhanced ECS task execution role"
  value       = aws_iam_role.ecs_task_role.arn
}

output "app_security_group_id" {
  description = "ID of the application security group with monitoring access"
  value       = aws_security_group.app_security_group.id
}

output "monitoring_security_group_id" {
  description = "ID of the monitoring services security group"
  value       = aws_security_group.monitoring_security_group.id
}

output "kms_key_arn" {
  description = "ARN of the KMS key for data encryption"
  value       = aws_kms_key.app_encryption.arn
}

output "waf_web_acl_arn" {
  description = "ARN of the WAF Web ACL"
  value       = aws_wafv2_web_acl.app_waf.arn
}