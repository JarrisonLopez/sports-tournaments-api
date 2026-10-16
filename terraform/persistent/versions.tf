terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # bucket y prefix llegan por -backend-config=backend.hcl.
  # Prefijo previsto: entrega3/persistent (independiente de entrega3/main).
  backend "gcs" {}
}
