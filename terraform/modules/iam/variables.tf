variable "project_id" {
  description = "ID del proyecto de Google Cloud."
  type        = string
}

variable "sports_account_id" {
  description = "account_id de la cuenta de ejecución de Sports API."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.sports_account_id))
    error_message = "sports_account_id debe tener de 6 a 30 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "object_storage_account_id" {
  description = "account_id de la cuenta de ejecución de Object Storage."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.object_storage_account_id))
    error_message = "object_storage_account_id debe tener de 6 a 30 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "deploy_account_id" {
  description = "account_id de la cuenta exclusiva de CI/CD. No es una cuenta de ejecución de Cloud Run."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.deploy_account_id))
    error_message = "deploy_account_id debe tener de 6 a 30 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "project_number" {
  description = "Número del proyecto GCP. Forma parte del principal WIF. No es una credencial."
  type        = string

  validation {
    condition     = can(regex("^[0-9]{6,12}$", var.project_number))
    error_message = "project_number debe ser el número numérico del proyecto de GCP."
  }
}

variable "workload_identity_pool_id" {
  description = "ID del pool WIF existente. Este módulo no crea el pool ni el provider."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,62}[a-z0-9]$", var.workload_identity_pool_id))
    error_message = "workload_identity_pool_id debe ser un ID de pool de Workload Identity."
  }
}

variable "github_actions_subject" {
  description = "Valor de assertion.sub de GitHub Actions autorizado a impersonar la cuenta de deploy. Debe ser exactamente la ref de main."
  type        = string

  validation {
    condition = can(regex(
      "^repo:[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+:ref:refs/heads/main$",
      var.github_actions_subject,
    ))
    error_message = "github_actions_subject debe ser repo:OWNER/REPO:ref:refs/heads/main."
  }
}

variable "db_password_secret_id" {
  description = "ID corto del secreto de la contraseña. El rol se concede solo sobre ese secreto."
  type        = string
}

variable "artifacts_bucket_name" {
  description = "Bucket cuyos objetos puede leer y escribir Object Storage."
  type        = string
}
