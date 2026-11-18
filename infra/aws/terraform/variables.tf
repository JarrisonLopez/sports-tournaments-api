variable "aws_region" {
  type        = string
  description = "Región AWS del proyecto (Open Horizons → us-east-2)."
  default     = "us-east-2"
}

variable "aws_profile" {
  type        = string
  description = "Perfil AWS CLI/SDK (credenciales temporales via aws login)."
  default     = "sports-chaos"
}

variable "environment" {
  type        = string
  description = "Etiqueta de entorno."
  default     = "lab"
}

variable "project_name" {
  type        = string
  description = "Prefijo de nombres de recurso."
  default     = "sports-chaos"
}

variable "instance_type" {
  type        = string
  description = "Tipo EC2 Free Tier eligible. c7i-flex.large (4 GiB) para k3s+MySQL+2 réplicas; t3.small (2 GiB) si hace falta ahorrar."
  default     = "c7i-flex.large"
}

variable "ssh_ingress_cidr" {
  type        = string
  description = "CIDR autorizado para SSH (restringir a IP propia)."
  default     = "0.0.0.0/0"
}

variable "api_ingress_cidr" {
  type        = string
  description = "CIDR autorizado para HTTP NodePort de la API."
  default     = "0.0.0.0/0"
}

variable "key_name" {
  type        = string
  description = "Nombre del key pair EC2 existente. Vacío = sin SSH key."
  default     = ""
}

variable "create_elastic_ip" {
  type        = bool
  description = "Asocia EIP para URL estable de demo."
  default     = true
}
