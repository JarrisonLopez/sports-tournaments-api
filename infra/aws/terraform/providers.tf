provider "aws" {
  region = var.aws_region
  # Vacío cuando se usan credenciales temporales en el entorno
  # (scripts/with-aws-creds.ps1). El perfil login_session de `aws login`
  # no es compatible de forma fiable con el provider Terraform.
  profile = var.aws_profile == "" ? null : var.aws_profile

  default_tags {
    tags = {
      Project     = "sports-tournaments-api"
      Environment = var.environment
      ManagedBy   = "terraform"
      Seguimiento = "4"
      Region      = var.aws_region
    }
  }
}
