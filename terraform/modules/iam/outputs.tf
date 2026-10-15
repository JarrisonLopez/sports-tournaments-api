output "sports_service_account_email" {
  description = "Email de la cuenta de ejecución de Sports API."
  value       = google_service_account.sports.email
}

output "object_storage_service_account_email" {
  description = "Email de la cuenta de ejecución de Object Storage."
  value       = google_service_account.object_storage.email
}

output "deploy_service_account_email" {
  description = "Email de la cuenta de CI/CD. No es un secreto."
  value       = google_service_account.deploy.email
}
