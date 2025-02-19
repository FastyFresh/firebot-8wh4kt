terraform {
  # Terraform version constraint to ensure compatibility with HCL2 syntax and latest features
  required_version = ">= 1.0.0"

  # Required providers with version constraints
  required_providers {
    # AWS provider for infrastructure deployment in Singapore region
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }

    # Random provider for generating unique identifiers and resource names
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }
}

# Configure AWS provider for Singapore region deployment
provider "aws" {
  region = "ap-southeast-1"  # Singapore region

  default_tags {
    tags = {
      Project     = "solana-trading-bot"
      Environment = terraform.workspace
      ManagedBy   = "terraform"
    }
  }
}

# Configure random provider
provider "random" {}