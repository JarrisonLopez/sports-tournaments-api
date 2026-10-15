resource "google_project_service" "required" {
  for_each = var.services

  project = var.project_id
  service = each.value

  # Las APIs son de proyecto. Desactivarlas al destruir este stack podría
  # afectar a otros componentes que sigan en sports-tournaments-multicloud.
  disable_on_destroy         = false
  disable_dependent_services = false
}
