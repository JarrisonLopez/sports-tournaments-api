output "sports_api_url" {
  description = "URL HTTPS de Sports API. Es null mientras deploy_applications es false."
  value       = one(module.sports_api[*].uri)
}

output "object_storage_url" {
  description = "URL HTTPS de Object Storage. Es null mientras deploy_applications es false."
  value       = one(module.object_storage_service[*].uri)
}

output "cloud_sql_connection_name" {
  description = "Connection name para el socket /cloudsql de Sports API."
  value       = module.cloud_sql.connection_name
}

output "artifact_registry_repository" {
  description = "Prefijo Docker del repositorio de imágenes."
  value       = module.artifact_registry.repository_url
}

output "artifacts_bucket_name" {
  description = "Bucket de artifacts. No es el bucket de estado."
  value       = module.cloud_storage.bucket_name
}

output "db_password_secret_id" {
  description = "ID del contenedor de la contraseña. No incluye el valor."
  value       = module.secret_manager.secret_id
}

output "sports_service_account" {
  description = "Cuenta de ejecución de Sports API."
  value       = module.iam.sports_service_account_email
}

output "object_storage_service_account" {
  description = "Cuenta de ejecución de Object Storage."
  value       = module.iam.object_storage_service_account_email
}

output "deploy_service_account" {
  description = "Cuenta de CI/CD de Entrega 3. Solo main puede impersonarla vía WIF."
  value       = module.iam.deploy_service_account_email
}
