# Network Infrastructure Outputs
output "vpc_id" {
  description = "The ID of the VPC"
  value       = module.vpc.vpc_id
}

output "private_subnet_ids" {
  description = "List of private subnet IDs for service deployment"
  value       = module.vpc.private_subnets
  sensitive   = false
}

output "public_subnet_ids" {
  description = "List of public subnet IDs for load balancer deployment"
  value       = module.vpc.public_subnets
  sensitive   = false
}

# Database Infrastructure Outputs
output "rds_endpoint" {
  description = "The connection endpoint for the primary RDS instance"
  value       = module.rds.rds_endpoint
  sensitive   = true
}

output "rds_port" {
  description = "The port number for RDS connections"
  value       = module.rds.rds_port
  sensitive   = true
}

# Cache Infrastructure Outputs
output "redis_endpoint" {
  description = "The primary endpoint for Redis cluster"
  value       = module.redis.endpoint
  sensitive   = true
}

# Container Infrastructure Outputs
output "ecs_cluster_name" {
  description = "The name of the ECS cluster for service deployment"
  value       = module.ecs.cluster_name
  sensitive   = false
}

# CDN Infrastructure Outputs
output "cloudfront_distribution_id" {
  description = "The ID of the CloudFront distribution for CDN management"
  value       = aws_cloudfront_distribution.main.id
  sensitive   = false
}

# DNS Infrastructure Outputs
output "route53_zone_id" {
  description = "The ID of the Route53 hosted zone for DNS management"
  value       = aws_route53_zone.main.zone_id
  sensitive   = false
}

# Load Balancer Outputs
output "alb_dns_name" {
  description = "The DNS name of the application load balancer"
  value       = aws_lb.main.dns_name
  sensitive   = false
}

# Additional Infrastructure Outputs
output "kms_key_arn" {
  description = "The ARN of the KMS key used for encryption"
  value       = aws_kms_key.main.arn
  sensitive   = true
}

output "log_group_name" {
  description = "The name of the CloudWatch log group for application logs"
  value       = aws_cloudwatch_log_group.main.name
  sensitive   = false
}

output "service_discovery_namespace" {
  description = "The ID of the service discovery namespace for container services"
  value       = aws_service_discovery_private_dns_namespace.main.id
  sensitive   = false
}

output "ecr_repository_url" {
  description = "The URL of the ECR repository for container images"
  value       = aws_ecr_repository.main.repository_url
  sensitive   = false
}

output "waf_web_acl_id" {
  description = "The ID of the WAF web ACL for application protection"
  value       = aws_wafv2_web_acl.main.id
  sensitive   = false
}