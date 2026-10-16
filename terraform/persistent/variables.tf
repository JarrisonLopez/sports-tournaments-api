variable "project_id" {
  description = "ID del proyecto de Google Cloud. Esta declaración no selecciona credenciales ni crea recursos."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id debe ser un ID de proyecto de GCP de 6 a 30 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "project_number" {
  description = "Número del proyecto GCP. Forma parte del principal WIF. No es una credencial."
  type        = string
  default     = "171179411205"

  validation {
    condition     = can(regex("^[0-9]{6,12}$", var.project_number))
    error_message = "project_number debe ser el número numérico del proyecto de GCP."
  }
}

variable "region" {
  description = "Región por defecto del provider google. Este root no crea recursos regionales de aplicación."
  type        = string

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]$", var.region))
    error_message = "region debe tener forma de región de GCP, por ejemplo us-central1."
  }
}

variable "resource_prefix" {
  description = "Prefijo de nombres. Con sports-demo la cuenta es sports-demo-provision."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}$", var.resource_prefix))
    error_message = "resource_prefix debe empezar por letra y usar minúsculas, dígitos o guiones."
  }
}

variable "provision_account_id" {
  description = "account_id de la SA persistente de Provision/Destroy. Vacío usa resource_prefix-provision (p. ej. sports-demo-provision)."
  type        = string
  default     = ""

  validation {
    condition     = var.provision_account_id == "" || can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.provision_account_id))
    error_message = "provision_account_id debe estar vacío o tener de 6 a 30 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "workload_identity_pool_id" {
  description = "ID del pool WIF existente. Este root no crea el pool ni el provider."
  type        = string
  default     = "github-actions-pool"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,62}[a-z0-9]$", var.workload_identity_pool_id))
    error_message = "workload_identity_pool_id debe ser un ID de pool de Workload Identity."
  }
}

variable "github_repository" {
  description = "Repositorio de GitHub con forma OWNER/REPO. Los IDs numéricos del subject OIDC van aparte."
  type        = string
  default     = "JarrisonLopez/sports-tournaments-api"

  validation {
    condition     = can(regex("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", var.github_repository))
    error_message = "github_repository debe tener forma OWNER/REPO."
  }
}

variable "github_owner_id" {
  description = "ID numérico del owner en el claim sub de GitHub Actions (OWNER@ID)."
  type        = string
  default     = "140736138"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_owner_id))
    error_message = "github_owner_id debe ser un identificador numérico de GitHub."
  }
}

variable "github_repository_id" {
  description = "ID numérico del repositorio en el claim sub de GitHub Actions (REPO@ID)."
  type        = string
  default     = "1349259895"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id debe ser un identificador numérico de GitHub."
  }
}

variable "github_actions_ref" {
  description = "Ref de Git autorizada a impersonar la cuenta de provision. Solo se acepta refs/heads/main."
  type        = string
  default     = "refs/heads/main"

  validation {
    condition     = var.github_actions_ref == "refs/heads/main"
    error_message = "github_actions_ref debe ser exactamente refs/heads/main."
  }
}
