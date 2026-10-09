resource "google_artifact_registry_repository" "docker" {
  project       = var.project_id
  location      = var.region
  repository_id = var.repository_id
  description   = "Imágenes de Sports API y Object Storage."
  format        = "DOCKER"
  labels        = var.labels

  # Sin cleanup_policies: una política de limpieza borraría imágenes sin
  # que esta entrega lo haya pedido.
}
