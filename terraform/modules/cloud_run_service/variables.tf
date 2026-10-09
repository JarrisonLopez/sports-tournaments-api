variable "project_id" {
  description = "ID del proyecto de Google Cloud."
  type        = string
}

variable "region" {
  description = "Región del servicio."
  type        = string
}

variable "service_name" {
  description = "Nombre del servicio de Cloud Run."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,47}[a-z0-9]$", var.service_name))
    error_message = "service_name debe tener de 2 a 49 caracteres, en minúsculas, dígitos o guiones."
  }
}

variable "image" {
  description = "Imagen ya publicada. El marcador REGION-docker.pkg.dev no es desplegable."
  type        = string
}

variable "service_account_email" {
  description = "Cuenta de ejecución del servicio. No es una llave JSON."
  type        = string
}

variable "container_port" {
  description = "Puerto del contenedor. El módulo publica la variable PORT con este mismo valor, que es el que leen src/index.ts y object-storage/src/index.ts."
  type        = number
  default     = 8080

  validation {
    condition     = var.container_port >= 1 && var.container_port <= 65535
    error_message = "container_port debe estar entre 1 y 65535."
  }
}

variable "min_instance_count" {
  description = "Mínimo de instancias. 0 permite escala a cero."
  type        = number

  validation {
    condition     = var.min_instance_count >= 0
    error_message = "min_instance_count no puede ser negativo."
  }
}

variable "max_instance_count" {
  description = "Tope de instancias para limitar el costo de un pico."
  type        = number
  default     = 2

  validation {
    condition     = var.max_instance_count >= 1 && var.max_instance_count <= 2
    error_message = "max_instance_count debe ser 1 o 2 hasta que se autorice un tope mayor."
  }
}

variable "cpu" {
  description = "Límite de CPU del contenedor."
  type        = string
  default     = "1"
}

variable "memory" {
  description = "Límite de memoria del contenedor."
  type        = string
  default     = "512Mi"
}

variable "env" {
  description = "Variables de entorno literales. No poner secretos aquí."
  type        = map(string)
  default     = {}
}

variable "secret_env" {
  description = "Variables inyectadas desde Secret Manager. El estado guarda el identificador y la versión, no el valor."
  type = list(object({
    name    = string
    secret  = string
    version = string
  }))
  default = []
}

variable "cloud_sql_instances" {
  description = "Connection names montados en /cloudsql. Vacío si el servicio no usa MySQL."
  type        = list(string)
  default     = []
}

variable "allow_unauthenticated" {
  description = "Si es true, concede roles/run.invoker a allUsers. El valor por defecto deja el servicio en 403 anónimo."
  type        = bool
  default     = false
}

variable "ingress" {
  description = "Tráfico que Cloud Run acepta. No concede por sí solo acceso anónimo."
  type        = string
  default     = "INGRESS_TRAFFIC_ALL"
}

variable "liveness_path" {
  description = "Ruta HTTP de liveness. Sports y Object Storage exponen /health/live."
  type        = string
  default     = "/health/live"
}

variable "startup_failure_threshold" {
  description = "Intentos de la sonda TCP de arranque, cada 10 segundos. Sports no escucha hasta conectar con MySQL."
  type        = number
  default     = 12
}

variable "labels" {
  description = "Etiquetas del servicio."
  type        = map(string)
  default     = {}
}
