variable "project_id" {
  description = "ID del proyecto de Google Cloud."
  type        = string
}

variable "region" {
  description = "Región del bucket."
  type        = string
}

variable "bucket_name" {
  description = "Nombre global del bucket de artifacts. Tiene que ser único en Cloud Storage."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$", var.bucket_name))
    error_message = "bucket_name debe tener de 3 a 63 caracteres, en minúsculas, dígitos, guiones o guiones bajos."
  }
}

variable "force_destroy" {
  description = "Si es true, terraform destroy borra los objetos del bucket y después el bucket. Esos artifacts no se recuperan."
  type        = bool
  default     = false
}

variable "labels" {
  description = "Etiquetas del bucket."
  type        = map(string)
  default     = {}
}
