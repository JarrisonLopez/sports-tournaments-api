variable "project_id" {
  description = "ID del proyecto de Google Cloud."
  type        = string
}

variable "region" {
  description = "Región del repositorio Docker."
  type        = string
}

variable "repository_id" {
  description = "ID del repositorio. No es la ruta completa de una imagen."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,61}[a-z0-9]$", var.repository_id))
    error_message = "repository_id debe tener de 3 a 63 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "labels" {
  description = "Etiquetas del repositorio."
  type        = map(string)
  default     = {}
}
