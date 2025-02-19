# AWS Provider configuration for monitoring resources
# Provider version: ~> 5.0
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Local variables for monitoring resources
locals {
  monitoring_tags = {
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

# KMS keys for encryption
resource "aws_kms_key" "logs" {
  description             = "KMS key for CloudWatch Logs encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                   = local.monitoring_tags
}

resource "aws_kms_key" "sns" {
  description             = "KMS key for SNS topic encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
  tags                   = local.monitoring_tags
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "application" {
  name              = "/aws/trading-bot/${var.environment}"
  retention_in_days = var.retention_in_days
  kms_key_id        = aws_kms_key.logs.arn
  tags              = local.monitoring_tags
}

resource "aws_cloudwatch_log_group" "prometheus" {
  name              = "/aws/prometheus/${var.environment}"
  retention_in_days = var.retention_in_days
  kms_key_id        = aws_kms_key.logs.arn
  tags              = local.monitoring_tags
}

# Managed Prometheus Workspace
resource "aws_prometheus_workspace" "main" {
  alias = "trading-bot-${var.environment}"
  
  logging_configuration {
    log_group_arn = aws_cloudwatch_log_group.prometheus.arn
    log_retention_in_days = var.retention_in_days
  }
  
  tags = local.monitoring_tags
}

# Managed Grafana Workspace
resource "aws_grafana_workspace" "main" {
  name                  = "trading-bot-${var.environment}"
  account_access_type   = "CURRENT_ACCOUNT"
  authentication_providers = ["AWS_SSO"]
  permission_type       = "SERVICE_MANAGED"
  data_sources         = ["PROMETHEUS", "CLOUDWATCH", "ELASTICSEARCH"]
  
  vpc_configuration {
    subnet_ids         = var.vpc.private_subnets
    security_group_ids = [var.vpc.security_groups.grafana]
  }
  
  tags = local.monitoring_tags
}

# CloudWatch Metric Alarms
resource "aws_cloudwatch_metric_alarm" "trading_latency" {
  alarm_name          = "trading-latency-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TradeExecutionLatency"
  namespace           = "TradingBot"
  period              = 60
  statistic           = "Average"
  threshold           = 500
  alarm_description   = "Trade execution latency exceeds 500ms"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.monitoring_tags
}

resource "aws_cloudwatch_metric_alarm" "strategy_performance" {
  alarm_name          = "strategy-performance-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 12
  metric_name         = "StrategyPerformanceScore"
  namespace           = "TradingBot"
  period              = 300
  statistic           = "Average"
  threshold           = 0.5
  alarm_description   = "Strategy performance score below threshold"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.monitoring_tags
}

resource "aws_cloudwatch_metric_alarm" "ml_model_update" {
  alarm_name          = "ml-model-update-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ModelUpdateLatency"
  namespace           = "TradingBot"
  period              = 3600
  statistic           = "Average"
  threshold           = 3600
  alarm_description   = "ML model update taking longer than expected"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  tags                = local.monitoring_tags
}

# SNS Topic for Alerts
resource "aws_sns_topic" "alerts" {
  name              = "trading-bot-alerts-${var.environment}"
  kms_master_key_id = aws_kms_key.sns.arn
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action = "sns:Publish"
        Resource = "*"
      }
    ]
  })
  
  tags = local.monitoring_tags
}

# SNS Topic Subscriptions
resource "aws_sns_topic_subscription" "email_alerts" {
  for_each  = toset(var.alert_email_endpoints)
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

# Outputs
output "prometheus_endpoint" {
  description = "Prometheus server endpoint"
  value       = aws_prometheus_workspace.main.prometheus_endpoint
}

output "grafana_endpoint" {
  description = "Grafana dashboard endpoint"
  value       = aws_grafana_workspace.main.endpoint
}

output "alert_topic_arn" {
  description = "SNS topic ARN for alerts"
  value       = aws_sns_topic.alerts.arn
}