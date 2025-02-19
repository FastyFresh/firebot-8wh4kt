# AWS Route 53 Configuration for AI-Powered Solana Trading Bot - Version 5.0

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  domain_prefix = var.environment == "prod" ? "" : "${var.environment}."
}

# Main hosted zone for the trading bot domain
resource "aws_route53_zone" "main" {
  name          = var.domain_name
  comment       = "Hosted zone for ${var.project_name} - ${var.environment} environment"
  force_destroy = false

  # Enable DNSSEC for enhanced security
  dnssec_config {
    signing_status = "SIGNING"
  }

  tags = {
    Name         = "${var.project_name}-${var.environment}-zone"
    Environment  = var.environment
    Project      = var.project_name
    ManagedBy    = "terraform"
    CostCenter   = "infrastructure"
    BackupPlan   = "included"
    DR           = "required"
  }
}

# Web dashboard DNS records with CloudFront distribution
resource "aws_route53_record" "web" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${local.domain_prefix}${var.domain_name}"
  type    = "A"

  alias {
    name                   = data.aws_cloudfront_distribution.main.domain_name
    zone_id               = data.aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = true
  }
}

# IPv6 support for web dashboard
resource "aws_route53_record" "web_ipv6" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "${local.domain_prefix}${var.domain_name}"
  type    = "AAAA"

  alias {
    name                   = data.aws_cloudfront_distribution.main.domain_name
    zone_id               = data.aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = true
  }
}

# Health check for API endpoint with enhanced monitoring
resource "aws_route53_health_check" "api" {
  fqdn              = "api.${local.domain_prefix}${var.domain_name}"
  port              = 443
  type              = "HTTPS"
  resource_path     = "/health"
  failure_threshold = "2"
  request_interval  = "30"
  
  regions = [
    "ap-southeast-1", # Primary region
    "ap-east-1"      # Secondary region for redundancy
  ]

  search_string = "\"status\":\"healthy\""
  
  enable_sni    = true
  
  tags = {
    Name          = "${var.project_name}-${var.environment}-api-health"
    Environment   = var.environment
    Project       = var.project_name
    ManagedBy     = "terraform"
    CostCenter    = "monitoring"
    AlertPriority = "high"
  }
}

# Primary API endpoint with latency-based routing
resource "aws_route53_record" "api_primary" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${local.domain_prefix}${var.domain_name}"
  type    = "A"
  
  set_identifier = "primary"
  health_check_id = aws_route53_health_check.api.id

  latency_routing_policy {
    region = "ap-southeast-1"
  }

  failover_routing_policy {
    type = "PRIMARY"
  }

  alias {
    name                   = aws_lb.api_primary.dns_name
    zone_id               = aws_lb.api_primary.zone_id
    evaluate_target_health = true
  }
}

# Secondary API endpoint for disaster recovery
resource "aws_route53_record" "api_secondary" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${local.domain_prefix}${var.domain_name}"
  type    = "A"
  
  set_identifier = "secondary"

  latency_routing_policy {
    region = "ap-east-1"
  }

  failover_routing_policy {
    type = "SECONDARY"
  }

  alias {
    name                   = aws_lb.api_secondary.dns_name
    zone_id               = aws_lb.api_secondary.zone_id
    evaluate_target_health = true
  }
}

# Output the zone ID for reference by other resources
output "route53_zone_id" {
  description = "ID of the Route 53 hosted zone"
  value       = aws_route53_zone.main.zone_id
}

# Output the environment-specific domain name
output "domain_name" {
  description = "Full domain name for the environment including prefix"
  value       = "${local.domain_prefix}${var.domain_name}"
}