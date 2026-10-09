terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Sin backend remoto en esta fase. Un backend GCS exigiría un bucket que
  # todavía no existe. El bootstrap del estado se implementa después, con
  # autorización. .terraform.lock.hcl se versiona cuando un init autorizado
  # lo genere.
}
