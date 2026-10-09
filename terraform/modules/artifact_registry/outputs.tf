output "repository_id" {
  description = "ID corto del repositorio."
  value       = google_artifact_registry_repository.docker.repository_id
}

output "repository_url" {
  description = "Prefijo Docker donde se publican las imágenes. No afirma que esas imágenes ya existan."
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}
