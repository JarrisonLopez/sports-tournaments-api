output "secret_id" {
  description = "ID corto del contenedor. No contiene la contraseña."
  value       = google_secret_manager_secret.db_password.secret_id
}

output "secret_name" {
  description = "Nombre completo del secreto en Secret Manager."
  value       = google_secret_manager_secret.db_password.name
}
