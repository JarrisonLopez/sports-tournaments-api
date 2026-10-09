variable "project_id" {
  description = "ID del proyecto de Google Cloud."
  type        = string
}

variable "region" {
  description = "Región de la réplica del secreto."
  type        = string
}

variable "secret_id" {
  description = "ID del contenedor. No es el valor de la contraseña."
  type        = string

  validation {
    condition     = can(regex("^[a-zA-Z0-9_-]{1,255}$", var.secret_id))
    error_message = "secret_id debe usar letras, dígitos, guiones o guiones bajos, con un máximo de 255 caracteres."
  }
}

variable "labels" {
  description = "Etiquetas del secreto."
  type        = map(string)
  default     = {}
}
