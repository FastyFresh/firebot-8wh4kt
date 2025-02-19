# AWS Provider configuration is assumed to be defined in provider.tf
# CloudFront Distribution for Web Dashboard - Version 5.0

locals {
  s3_origin_id     = "${var.project_name}-${var.environment}-origin"
  cloudfront_name  = "${var.project_name}-${var.environment}-cdn"
  domain_prefix    = "${var.environment == "prod" ? "" : "${var.environment}."}"
}

# Origin Access Identity for S3 bucket access
resource "aws_cloudfront_origin_access_identity" "main" {
  comment = "OAI for ${var.project_name} ${var.environment} web dashboard"
}

# Main CloudFront Distribution
resource "aws_cloudfront_distribution" "main" {
  enabled             = true
  is_ipv6_enabled    = true
  comment            = "Web dashboard distribution for ${var.project_name} - ${var.environment}"
  default_root_object = "index.html"
  price_class        = "PriceClass_200" # Best price/performance for Asia coverage
  web_acl_id         = "${aws_wafv2_web_acl.main.arn}"
  aliases            = ["${local.domain_prefix}${var.domain_name}"]

  # Access logging configuration
  logging_config {
    include_cookies = false
    bucket         = "${aws_s3_bucket.logs.bucket_domain_name}"
    prefix         = "cloudfront/"
  }

  # Origin configuration for S3
  origin {
    domain_name = "${aws_s3_bucket.web.bucket_regional_domain_name}"
    origin_id   = local.s3_origin_id

    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.main.cloudfront_access_identity_path
    }
  }

  # Default cache behavior
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = local.s3_origin_id

    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600  # 1 hour
    max_ttl                = 86400 # 24 hours
    compress               = true
  }

  # SPA routing support - redirect all 404s to index.html
  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  # Geo-restriction settings
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  # SSL/TLS configuration
  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate.main.arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # Resource tagging
  tags = {
    Name        = local.cloudfront_name
    Environment = var.environment
    Project     = var.project_name
    ManagedBy   = "terraform"
  }
}

# Enable real-time monitoring for CloudFront
resource "aws_cloudfront_monitoring_subscription" "main" {
  distribution_id = aws_cloudfront_distribution.main.id
  monitoring_subscription {
    realtime_metrics_subscription_config {
      realtime_metrics_subscription_status = "Enabled"
    }
  }
}

# Outputs for use by other modules
output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution for DNS configuration"
  value       = aws_cloudfront_distribution.main.domain_name
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution for cache invalidation"
  value       = aws_cloudfront_distribution.main.id
}