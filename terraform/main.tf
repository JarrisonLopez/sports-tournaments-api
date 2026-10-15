locals {
  labels = {
    environment = var.environment
    managed_by  = "terraform"
    component   = "entrega3"
  }

  artifact_repository_id            = "${var.resource_prefix}-images"
  database_instance_name            = "${var.resource_prefix}-mysql"
  db_password_secret_id             = "${var.resource_prefix}-db-password"
  sports_service_account_id         = "${var.resource_prefix}-api"
  object_storage_service_account_id = "${var.resource_prefix}-storage"
  deploy_service_account_id         = "${var.resource_prefix}-deploy"
  sports_service_name               = "${var.resource_prefix}-api"
  object_storage_service_name       = "${var.resource_prefix}-storage"
  github_actions_deploy_subject     = "repo:${var.github_repository}:ref:${var.github_deploy_ref}"

  otel_env = var.otel_exporter_otlp_endpoint != "" ? {
    OTEL_EXPORTER_OTLP_ENDPOINT = var.otel_exporter_otlp_endpoint
  } : {}

  sports_integration_env = merge(
    var.hotel_api_url != "" ? { HOTEL_API_URL = var.hotel_api_url } : {},
    var.cine_api_url != "" ? { CINE_API_URL = var.cine_api_url } : {},
    local.otel_env,
  )
}

module "project_services" {
  source = "./modules/project_services"

  project_id = var.project_id
}

module "artifact_registry" {
  source = "./modules/artifact_registry"

  project_id    = var.project_id
  region        = var.region
  repository_id = local.artifact_repository_id
  labels        = local.labels

  depends_on = [module.project_services]
}

module "cloud_storage" {
  source = "./modules/cloud_storage"

  project_id    = var.project_id
  region        = var.region
  bucket_name   = var.artifacts_bucket_name
  force_destroy = var.artifacts_force_destroy
  labels        = local.labels

  depends_on = [module.project_services]
}

module "secret_manager" {
  source = "./modules/secret_manager"

  project_id = var.project_id
  region     = var.region
  secret_id  = local.db_password_secret_id
  labels     = local.labels

  depends_on = [module.project_services]
}

module "cloud_sql" {
  source = "./modules/cloud_sql"

  project_id          = var.project_id
  region              = var.region
  instance_name       = local.database_instance_name
  database_name       = var.database_name
  database_version    = var.database_version
  tier                = var.database_tier
  disk_size_gb        = var.database_disk_size_gb
  activation_policy   = var.database_activation_policy
  deletion_protection = var.database_deletion_protection
  labels              = local.labels

  depends_on = [module.project_services]
}

module "iam" {
  source = "./modules/iam"

  project_id                      = var.project_id
  project_number                  = var.project_number
  sports_account_id               = local.sports_service_account_id
  object_storage_account_id       = local.object_storage_service_account_id
  deploy_account_id               = local.deploy_service_account_id
  workload_identity_pool_id       = var.workload_identity_pool_id
  github_actions_subject          = local.github_actions_deploy_subject
  db_password_secret_id           = module.secret_manager.secret_id
  artifacts_bucket_name           = module.cloud_storage.bucket_name
  artifact_registry_location      = var.region
  artifact_registry_repository_id = module.artifact_registry.repository_id
  terraform_state_bucket_name     = var.terraform_state_bucket_name

  depends_on = [module.project_services, module.artifact_registry]
}

module "object_storage_service" {
  source = "./modules/cloud_run_service"
  count  = var.deploy_applications ? 1 : 0

  project_id                    = var.project_id
  region                        = var.region
  service_name                  = local.object_storage_service_name
  image                         = var.object_storage_image
  service_account_email         = module.iam.object_storage_service_account_email
  invoker_service_account_email = module.iam.sports_service_account_email
  min_instance_count            = var.object_storage_min_instances
  allow_unauthenticated         = var.object_storage_allow_unauthenticated
  startup_failure_threshold     = 3
  labels                        = local.labels

  env = merge(
    {
      GCS_BUCKET_NAME = module.cloud_storage.bucket_name
    },
    local.otel_env,
  )

  depends_on = [module.project_services, module.iam]
}

module "sports_api" {
  source = "./modules/cloud_run_service"
  count  = var.deploy_applications ? 1 : 0

  project_id            = var.project_id
  region                = var.region
  service_name          = local.sports_service_name
  image                 = var.sports_image
  service_account_email = module.iam.sports_service_account_email
  min_instance_count    = var.sports_min_instances
  allow_unauthenticated = var.sports_allow_unauthenticated
  labels                = local.labels

  # Object Storage no llama a Sports. La URL sale del otro servicio en el
  # mismo apply. No hay ciclo: este módulo depende del otro, no al revés.
  env = merge(
    {
      CLOUD_SQL_CONNECTION_NAME = module.cloud_sql.connection_name
      DB_USER                   = var.database_user
      DB_NAME                   = var.database_name
      OBJECT_STORAGE_API_URL    = coalesce(one(module.object_storage_service[*].uri), "")
    },
    local.sports_integration_env,
  )

  secret_env = [
    {
      name    = "DB_PASSWORD"
      secret  = module.secret_manager.secret_id
      version = "latest"
    },
  ]

  cloud_sql_instances = [module.cloud_sql.connection_name]

  depends_on = [module.project_services, module.iam]
}
