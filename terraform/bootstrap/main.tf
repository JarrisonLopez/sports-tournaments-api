resource "google_project_service" "storage" {
  project = var.project_id
  service = "storage.googleapis.com"

  disable_on_destroy         = false
  disable_dependent_services = false
}

resource "google_storage_bucket" "state" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  versioning {
    enabled = true
  }

  # Borra solo generaciones archivadas cuando ya hay versiones más nuevas.
  # with_state ARCHIVED no alcanza al objeto vivo del estado.
  lifecycle_rule {
    action {
      type = "Delete"
    }

    condition {
      with_state         = "ARCHIVED"
      num_newer_versions = var.noncurrent_versions_to_keep
    }
  }

  soft_delete_policy {
    retention_duration_seconds = 0
  }

  labels = {
    purpose    = "terraform-state"
    managed_by = "terraform"
  }

  lifecycle {
    prevent_destroy = true
  }

  depends_on = [google_project_service.storage]
}
