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

resource "google_artifact_registry_repository_iam_member" "deploy_writer" {
  project    = var.project_id
  location   = var.artifact_registry_location
  repository = var.artifact_registry_repository_id
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_storage_bucket_iam_member" "deploy_tfstate" {
  bucket = var.terraform_state_bucket_name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_project_iam_member" "deploy_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_act_as_sports" {
  service_account_id = google_service_account.sports.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

resource "google_service_account_iam_member" "deploy_act_as_object_storage" {
  service_account_id = google_service_account.object_storage.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deploy.email}"
}

# El pool y el provider WIF ya existen fuera de este módulo.
# deploy actualiza Cloud Run con run.developer y ActAs sobre las runtime.
# run.developer no incluye setIamPolicy del binding run.invoker; si el apply
# falla al refrescar ese IAM, haría falta un permiso aparte (no se concede aquí).
# No hay run.admin, editor, owner ni secretAccessor para deploy.
