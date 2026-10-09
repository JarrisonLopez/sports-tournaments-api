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

variable "db_password_secret_id" {
  description = "ID corto del secreto de la contraseña. El rol se concede solo sobre ese secreto."
  type        = string
}

variable "artifacts_bucket_name" {
  description = "Bucket cuyos objetos puede leer y escribir Object Storage."
  type        = string
}
