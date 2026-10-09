resource "google_storage_bucket" "artifacts" {
  project                     = var.project_id
  name                        = var.bucket_name
  location                    = var.region
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = var.force_destroy
  labels                      = var.labels

  # Sin versionado ni retención: ambos aumentan el almacenamiento o bloquean
  # el destroy de la demo. El objeto flujos/{traceId}.json se sobrescribe.
}
