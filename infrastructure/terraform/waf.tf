# AWS WAF configuration for protecting web application and API endpoints
# Provider version: hashicorp/aws ~> 5.0

# Local variables for resource naming
locals {
  waf_name = "${var.project_name}-${var.environment}-waf"
}

# Main WAF Web ACL with enhanced security rules and metrics
resource "aws_wafv2_web_acl" "main" {
  name        = local.waf_name
  description = "Enhanced WAF protection for ${var.project_name} ${var.environment}"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  # Rate limiting rule - 1000 requests per IP
  rule {
    name     = "RateLimit"
    priority = 1

    override_action {
      none {}
    }

    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "RateLimitMetric"
      sampled_requests_enabled  = true
    }
  }

  # AWS Managed Rules - Common Rule Set
  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 2

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        version     = "Version_2.0"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "AWSManagedRulesCommonRuleSetMetric"
      sampled_requests_enabled  = true
    }
  }

  # AWS Managed Rules - Known Bad Inputs
  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 3

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        version     = "Version_1.0"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "AWSManagedRulesKnownBadInputsRuleSetMetric"
      sampled_requests_enabled  = true
    }
  }

  # AWS Managed Rules - SQL Injection Protection
  rule {
    name     = "AWSManagedRulesSQLiRuleSet"
    priority = 4

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesSQLiRuleSet"
        version     = "Version_2.0"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "AWSManagedRulesSQLiRuleSetMetric"
      sampled_requests_enabled  = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name               = "${local.waf_name}-metric"
    sampled_requests_enabled  = true
  }

  tags = {
    Name           = local.waf_name
    Environment    = var.environment
    Project        = var.project_name
    ManagedBy      = "terraform"
    SecurityLevel  = "High"
  }
}

# KMS key for WAF logs encryption
resource "aws_kms_key" "waf_logs" {
  description             = "KMS key for WAF logs encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  tags = {
    Name        = "${local.waf_name}-logs-key"
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

# CloudWatch Log Group for WAF logs
resource "aws_cloudwatch_log_group" "waf" {
  name              = "/aws/waf/${local.waf_name}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.waf_logs.arn

  tags = {
    Name             = "/aws/waf/${local.waf_name}"
    Environment      = var.environment
    Project          = var.project_name
    ManagedBy        = "terraform"
    DataSensitivity  = "High"
  }
}

# WAF Logging Configuration
resource "aws_wafv2_web_acl_logging_configuration" "main" {
  log_destination_configs = [aws_cloudwatch_log_group.waf.arn]
  resource_arn           = aws_wafv2_web_acl.main.arn

  logging_filter {
    default_behavior = "KEEP"

    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition {
          action = "BLOCK"
        }
      }
    }

    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        rate_based_condition {
          action = "COUNT"
        }
      }
    }
  }
}

# Output the WAF Web ACL ARN for use in other resources
output "waf_web_acl_arn" {
  description = "ARN of the WAF Web ACL for CloudFront and ALB integration"
  value       = aws_wafv2_web_acl.main.arn
}