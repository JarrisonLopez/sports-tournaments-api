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

resource "google_service_account" "deploy" {
  project      = var.project_id
  account_id   = var.deploy_account_id
  display_name = "Entrega 3 GitHub Actions deploy"
  description  = "Cuenta exclusiva de CI/CD de Entrega 3. Solo GitHub Actions en main puede impersonarla."
}

locals {
  # Pool y provider ya existen. No se declaran aquí. El mapping del provider
  # es google.subject = assertion.sub, así que el principal exacto usa subject/.
  github_actions_deploy_member = format(
    "principal://iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/subject/%s",
    var.project_number,
    var.workload_identity_pool_id,
    var.github_actions_subject,
  )
}

resource "google_service_account_iam_member" "deploy_github_main" {
  service_account_id = google_service_account.deploy.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_actions_deploy_member
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

# El pool github-actions-pool y el provider github-provider ya existen fuera
# de este módulo. Aquí solo se liga sports-demo-deploy a un subject de main.
# No hay principalSet por repositorio ni llaves JSON. Los roles de proyecto
# para Artifact Registry, Cloud Run y el bucket de estado van en otra tarea.
# sports y object_storage no reciben workloadIdentityUser.
