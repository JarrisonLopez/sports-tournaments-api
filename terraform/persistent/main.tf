locals {
  provision_account_id = coalesce(
    var.provision_account_id != "" ? var.provision_account_id : null,
    "${var.resource_prefix}-provision",
  )

  github_owner_name      = split("/", var.github_repository)[0]
  github_repository_name = split("/", var.github_repository)[1]

  # Subject OIDC real verificado para este repositorio (IDs numéricos).
  # Debe coincidir con assertion.sub de GitHub Actions en refs/heads/main.
  github_actions_provision_subject = format(
    "repo:%s@%s/%s@%s:ref:%s",
    local.github_owner_name,
    var.github_owner_id,
    local.github_repository_name,
    var.github_repository_id,
    var.github_actions_ref,
  )

  # Pool y provider ya existen fuera de este root. El mapping del provider
  # es google.subject = assertion.sub, así que el principal usa subject/.
  github_actions_provision_member = format(
    "principal://iam.googleapis.com/projects/%s/locations/global/workloadIdentityPools/%s/subject/%s",
    var.project_number,
    var.workload_identity_pool_id,
    local.github_actions_provision_subject,
  )
}

# Identidad persistente para workflows futuros de Provision y Destroy.
# Sobrevive a terraform destroy del stack principal (entrega3/main).
resource "google_service_account" "provision" {
  project      = var.project_id
  account_id   = local.provision_account_id
  display_name = "Entrega 3 GitHub Actions provision"
  description  = "Cuenta persistente de Provision/Destroy. Solo GitHub Actions en main puede impersonarla vía WIF. Sin llaves JSON. roles/owner del proyecto es temporal (demo académica)."
}

resource "google_service_account_iam_member" "provision_github_main" {
  service_account_id = google_service_account.provision.name
  role               = "roles/iam.workloadIdentityUser"
  member             = local.github_actions_provision_member
}

# Temporal: proyecto académico dedicado a la Entrega 3.
# Retirar roles/owner (o destruir este root) al terminar la demostración.
# No se concede a sports-demo-deploy; solo a esta SA de provision.
resource "google_project_iam_member" "provision_owner" {
  project = var.project_id
  role    = "roles/owner"
  member  = "serviceAccount:${google_service_account.provision.email}"
}
