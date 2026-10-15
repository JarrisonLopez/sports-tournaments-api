terraform {
  required_version = ">= 1.9.0, < 2.0.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }

  # Este root no usa backend GCS. El bucket que declara es el que después
  # guardará el estado del stack principal. Su propio estado queda en local
  # y .gitignore impide versionarlo.
}
