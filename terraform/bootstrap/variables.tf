variable "project_id" {
  description = "ID del proyecto de Google Cloud. No selecciona credenciales."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id debe ser un ID de proyecto de GCP de 6 a 30 caracteres."
  }
}

variable "region" {
  description = "Región del bucket de estado."
  type        = string
  default     = "us-central1"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]$", var.region))
    error_message = "region debe tener forma de región de GCP, por ejemplo us-central1."
  }
}

variable "bucket_name" {
  description = "Nombre global del bucket de estado. No es el bucket de artifacts JSON."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name debe tener de 3 a 63 caracteres, en minúsculas, dígitos, guiones o guiones bajos."
  }
}

variable "noncurrent_versions_to_keep" {
  description = "Cantidad de versiones más nuevas que deben existir antes de borrar una versión archivada. La versión viva del estado no entra en esa regla."
  type        = number
  default     = 10

  validation {
    condition     = var.noncurrent_versions_to_keep >= 5 && var.noncurrent_versions_to_keep <= 30 && floor(var.noncurrent_versions_to_keep) == var.noncurrent_versions_to_keep
    error_message = "noncurrent_versions_to_keep debe ser un entero entre 5 y 30."
  }
}
