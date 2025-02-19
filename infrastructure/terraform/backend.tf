# Backend configuration for Terraform state management
# Version: AWS Provider >= 4.0.0

terraform {
  backend "s3" {
    bucket         = "${var.project_name}-${var.environment}-tfstate"
    key            = "terraform.tfstate"
    region         = "ap-southeast-1"
    encrypt        = true
    dynamodb_table = "${var.project_name}-${var.environment}-tfstate-lock"
    kms_key_id     = "${var.project_name}-${var.environment}-tfstate-key"
  }
}