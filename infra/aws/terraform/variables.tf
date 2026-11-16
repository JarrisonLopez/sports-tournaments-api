variable "aws_region" {
  type        = string
  description = "Región AWS del laboratorio."
  default     = "us-east-1"
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
  description = "Tipo EC2. t3.small basta para k3s + 2 pods + MySQL lab."
  default     = "t3.small"
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
