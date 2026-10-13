terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # El bloque backend "gcs" no está activo. El bucket todavía no existe y
  # un backend parcial obligaría a otro init. El ejemplo está en
  # backend.hcl.example. El bucket se declara en bootstrap/.
}
