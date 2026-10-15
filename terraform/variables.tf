variable "project_id" {
  description = "ID del proyecto de Google Cloud. Esta declaración no selecciona credenciales ni crea recursos."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.project_id))
    error_message = "project_id debe ser un ID de proyecto de GCP de 6 a 30 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "project_number" {
  description = "Número del proyecto GCP. Se usa solo para el principal WIF de la cuenta de deploy."
  type        = string
  default     = "171179411205"

  validation {
    condition     = can(regex("^[0-9]{6,12}$", var.project_number))
    error_message = "project_number debe ser el número numérico del proyecto de GCP."
  }
}

variable "workload_identity_pool_id" {
  description = "ID del pool WIF existente. No se crea ni se modifica desde este stack."
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

variable "github_deploy_ref" {
  description = "Ref de Git autorizada a impersonar la cuenta de deploy. Solo se acepta refs/heads/main."
  type        = string
  default     = "refs/heads/main"

  validation {
    condition     = var.github_deploy_ref == "refs/heads/main"
    error_message = "github_deploy_ref debe ser exactamente refs/heads/main."
  }
}

variable "region" {
  description = "Región prevista para recursos regionales como Cloud Run y Artifact Registry."
  type        = string

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]$", var.region))
    error_message = "region debe tener forma de región de GCP, por ejemplo us-central1."
  }
}

variable "environment" {
  description = "Etiqueta corta del entorno. El ejemplo de esta entrega usa demo."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.environment))
    error_message = "environment debe tener de 2 a 16 caracteres: empezar por letra y usar minúsculas, dígitos o guiones."
  }
}

variable "resource_prefix" {
  description = "Prefijo de nombres. Minúsculas y guiones, para reutilizarlo en Cloud Run, buckets y Artifact Registry."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,20}[a-z0-9]$", var.resource_prefix))
    error_message = "resource_prefix debe tener de 3 a 22 caracteres, empezar por letra, terminar en letra o dígito, y usar solo minúsculas, dígitos o guiones."
  }
}

variable "database_name" {
  description = "Nombre de la base MySQL de Sports. No es una contraseña."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9_]{0,63}$", var.database_name))
    error_message = "database_name debe ser un identificador MySQL de hasta 64 caracteres."
  }
}

variable "database_user" {
  description = "Usuario de aplicación de MySQL. La contraseña no se declara en Terraform en esta fase."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9_]{0,31}$", var.database_user)) && var.database_user != "root"
    error_message = "database_user debe ser un identificador MySQL de hasta 32 caracteres y no puede ser root."
  }
}

variable "database_version" {
  description = "Enum database_version de Cloud SQL. El valor confirmado para esta entrega es MYSQL_8_4. Sin edition ENTERPRISE, Cloud SQL elige Enterprise Plus."
  type        = string

  validation {
    condition     = can(regex("^[A-Z][A-Z0-9_]{1,63}$", var.database_version))
    error_message = "database_version debe ser un enum en mayúsculas, o PENDING_VERIFICATION hasta confirmarlo."
  }
}

variable "database_tier" {
  description = "Tier de Cloud SQL Enterprise. db-f1-micro es el shared-core de menor costo compatible con disco PD_SSD. Enterprise Plus no acepta este tier."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z][A-Za-z0-9_-]{1,62}$", var.database_tier))
    error_message = "database_tier debe ser un identificador de tier, o PENDING_VERIFICATION hasta confirmarlo."
  }
}

variable "database_disk_size_gb" {
  description = "Tamaño del disco de Cloud SQL en GB. El tope de 20 GB evita un disco grande mientras esa decisión no esté autorizada."
  type        = number
  default     = 10

  validation {
    condition     = var.database_disk_size_gb >= 10 && var.database_disk_size_gb <= 20 && floor(var.database_disk_size_gb) == var.database_disk_size_gb
    error_message = "database_disk_size_gb debe ser un entero entre 10 y 20."
  }
}

variable "sports_image" {
  description = "Referencia de la imagen de Sports API. En esta fase es ilustrativa: no publica ni despliega la imagen."
  type        = string

  validation {
    condition     = length(trimspace(var.sports_image)) > 0 && length(var.sports_image) <= 512
    error_message = "sports_image no puede estar vacío ni superar 512 caracteres."
  }
}

variable "object_storage_image" {
  description = "Referencia de la imagen de Object Storage. En esta fase es ilustrativa: no publica ni despliega la imagen."
  type        = string

  validation {
    condition     = length(trimspace(var.object_storage_image)) > 0 && length(var.object_storage_image) <= 512
    error_message = "object_storage_image no puede estar vacío ni superar 512 caracteres."
  }
}

variable "sports_min_instances" {
  description = "Mínimo de instancias de Cloud Run para Sports API. Solo se acepta 0, para no dejar cómputo residente sin autorización."
  type        = number
  default     = 0

  validation {
    condition     = var.sports_min_instances == 0
    error_message = "sports_min_instances debe ser 0 hasta una autorización explícita para mantener instancias activas."
  }
}

variable "object_storage_min_instances" {
  description = "Mínimo de instancias de Cloud Run para Object Storage. Solo se acepta 0, para no dejar cómputo residente sin autorización."
  type        = number
  default     = 0

  validation {
    condition     = var.object_storage_min_instances == 0
    error_message = "object_storage_min_instances debe ser 0 hasta una autorización explícita para mantener instancias activas."
  }
}

variable "artifacts_bucket_name" {
  description = "Nombre global del bucket de artifacts. Tiene que ser único en Cloud Storage y no es el bucket de estado."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$", var.artifacts_bucket_name))
    error_message = "artifacts_bucket_name debe tener de 3 a 63 caracteres, en minúsculas, dígitos, guiones o guiones bajos."
  }
}

variable "terraform_state_bucket_name" {
  description = "Nombre del bucket de estado creado por bootstrap/. Este stack no lo crea; solo concede IAM a la cuenta de deploy."
  type        = string
  default     = "sports-tournaments-multicloud-tfstate"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9_-]{1,61}[a-z0-9]$", var.terraform_state_bucket_name))
    error_message = "terraform_state_bucket_name debe tener de 3 a 63 caracteres, en minúsculas, dígitos, guiones o guiones bajos."
  }
}

variable "artifacts_force_destroy" {
  description = "Si es true, terraform destroy borra los objetos del bucket de artifacts antes de borrar el bucket. Esos JSON no se recuperan."
  type        = bool
  default     = true
}

variable "database_deletion_protection" {
  description = "Protección de Terraform y de Cloud SQL a la vez. false permite un destroy sin pasos en la consola y elimina la base."
  type        = bool
  default     = false
}

variable "database_activation_policy" {
  description = "ALWAYS deja Cloud SQL facturando cómputo. NEVER lo detiene y conserva el disco."
  type        = string
  default     = "ALWAYS"

  validation {
    condition     = contains(["ALWAYS", "NEVER"], var.database_activation_policy)
    error_message = "database_activation_policy debe ser ALWAYS o NEVER."
  }
}

variable "deploy_applications" {
  description = "Crea los dos Cloud Run. Permanece en false hasta que existan imágenes publicadas, una versión del secreto y el usuario MySQL, todos fuera del estado."
  type        = bool
  default     = false

  validation {
    condition = (
      !var.deploy_applications ||
      (
        var.database_version != "PENDING_VERIFICATION" &&
        var.database_tier != "PENDING_VERIFICATION" &&
        !strcontains(var.sports_image, "REGION-docker.pkg.dev") &&
        !strcontains(var.object_storage_image, "REGION-docker.pkg.dev")
      )
    )
    error_message = "deploy_applications exige database_version, database_tier y las dos imágenes ya verificados."
  }
}

variable "sports_allow_unauthenticated" {
  description = "Concede invoker anónimo a Sports API. false responde 403 sin identidad."
  type        = bool
  default     = false
}

variable "object_storage_allow_unauthenticated" {
  description = "Concede invoker anónimo a Object Storage. false responde 403 sin identidad. El servicio no autentica x-trace-id."
  type        = bool
  default     = false
}

variable "hotel_api_url" {
  description = "URL base de Hotel. Vacía hasta que el equipo la confirme. No forma parte del flujo CRUD."
  type        = string
  default     = ""

  validation {
    condition     = var.hotel_api_url == "" || can(regex("^https?://[^[:space:]]+$", var.hotel_api_url))
    error_message = "hotel_api_url debe estar vacía o ser una URL http o https."
  }
}

variable "cine_api_url" {
  description = "URL base de Cine. Vacía hasta que el equipo la confirme. No forma parte del flujo CRUD."
  type        = string
  default     = ""

  validation {
    condition     = var.cine_api_url == "" || can(regex("^https?://[^[:space:]]+$", var.cine_api_url))
    error_message = "cine_api_url debe estar vacía o ser una URL http o https."
  }
}

variable "otel_exporter_otlp_endpoint" {
  description = "Endpoint OTLP opcional. Vacío deja las trazas en un procesador nulo y no exporta métricas."
  type        = string
  default     = ""

  validation {
    condition     = var.otel_exporter_otlp_endpoint == "" || can(regex("^https?://[^[:space:]]+$", var.otel_exporter_otlp_endpoint))
    error_message = "otel_exporter_otlp_endpoint debe estar vacío o ser una URL http o https."
  }
}
