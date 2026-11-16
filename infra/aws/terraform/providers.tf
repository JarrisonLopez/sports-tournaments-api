provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "sports-tournaments-api"
      Environment = var.environment
      ManagedBy   = "terraform"
      Seguimiento = "4"
    }
  }
}
