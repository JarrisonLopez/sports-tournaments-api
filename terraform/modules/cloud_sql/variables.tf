variable "project_id" {
  description = "ID del proyecto de Google Cloud."
  type        = string
}

variable "region" {
  description = "Región de la instancia zonal."
  type        = string
}

variable "instance_name" {
  description = "Nombre de la instancia de Cloud SQL."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,96}[a-z0-9]$", var.instance_name))
    error_message = "instance_name debe tener de 2 a 98 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "database_name" {
  description = "Base que usa Sports API."
  type        = string
}

variable "database_version" {
  description = "Enum database_version de Cloud SQL. Para esta entrega el valor confirmado es MYSQL_8_4."
  type        = string
}

variable "tier" {
  description = "Tier de Cloud SQL Enterprise. El shared-core de menor costo documentado es db-f1-micro. No usar tiers db-perf-optimized, que pertenecen a Enterprise Plus."
  type        = string
}

variable "disk_size_gb" {
  description = "Disco SSD en GB. Sin crecimiento automático."
  type        = number
}

variable "activation_policy" {
  description = "ALWAYS mantiene la instancia facturando. NEVER detiene el cómputo y conserva el disco."
  type        = string

  validation {
    condition     = contains(["ALWAYS", "NEVER"], var.activation_policy)
    error_message = "activation_policy debe ser ALWAYS o NEVER."
  }
}

variable "deletion_protection" {
  description = "Aplica a la vez el bloqueo de Terraform y el de Cloud SQL. false permite terraform destroy en un solo paso y borra los datos."
  type        = bool
}

variable "labels" {
  description = "Etiquetas de la instancia."
  type        = map(string)
  default     = {}
}
