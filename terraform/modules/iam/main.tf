resource "google_service_account" "sports" {
  project      = var.project_id
  account_id   = var.sports_account_id
  display_name = "Sports API runtime"
  description  = "Cuenta de ejecución de Cloud Run para Sports API."
}

resource "google_service_account" "object_storage" {
  project      = var.project_id
  account_id   = var.object_storage_account_id
  display_name = "Object Storage runtime"
  description  = "Cuenta de ejecución de Cloud Run para Object Storage."
}

resource "google_project_iam_member" "sports_cloudsql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.sports.email}"
}

resource "google_secret_manager_secret_iam_member" "sports_secret_accessor" {
  project   = var.project_id
  secret_id = var.db_password_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.sports.email}"
}

resource "google_storage_bucket_iam_member" "object_storage_objects" {
  bucket = var.artifacts_bucket_name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.object_storage.email}"
}

# Workload Identity Federation para GitHub Actions no se crea aquí.
# Faltan, a propósito, el pool, el provider OIDC y el binding
# roles/iam.workloadIdentityUser. Tampoco hay llaves JSON de estas cuentas.
# Una fase posterior puede atar el repositorio de GitHub a otra cuenta de
# despliegue, con permiso para actuar como estas dos cuentas de ejecución.
# Estas cuentas no deben recibir roles/editor ni roles/owner.
