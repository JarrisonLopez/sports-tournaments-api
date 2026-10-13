variable "project_id" {
  description = "ID del proyecto donde se habilitan las APIs."
  type        = string
}

variable "services" {
  description = "APIs de GCP que el stack necesita. Destruir el stack no las desactiva."
  type        = set(string)
  default = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    # storage.googleapis.com la administra terraform/bootstrap/.
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "serviceusage.googleapis.com",
  ]
}
