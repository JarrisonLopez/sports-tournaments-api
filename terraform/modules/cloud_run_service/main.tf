resource "google_cloud_run_v2_service" "service" {
  project  = var.project_id
  name     = var.service_name
  location = var.region
  ingress  = var.ingress
  labels   = var.labels

  # Sin este false, varias versiones 6.x del provider bloquean el destroy
  # del servicio dentro de Terraform.
  deletion_protection = false

  template {
    service_account       = var.service_account_email
    execution_environment = "EXECUTION_ENVIRONMENT_GEN2"
    timeout               = "120s"

    scaling {
      min_instance_count = var.min_instance_count
      max_instance_count = var.max_instance_count
    }

    dynamic "volumes" {
      for_each = length(var.cloud_sql_instances) == 0 ? [] : [1]

      content {
        name = "cloudsql"

        cloud_sql_instance {
          instances = var.cloud_sql_instances
        }
      }
    }

    containers {
      image = var.image

      ports {
        container_port = var.container_port
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
        cpu_idle = true
      }

      dynamic "env" {
        for_each = { for key, value in var.env : key => value if trimspace(value) != "" }

        content {
          name  = env.key
          value = env.value
        }
      }

      dynamic "env" {
        for_each = var.secret_env

        content {
          name = env.value.name

          value_source {
            secret_key_ref {
              secret  = env.value.secret
              version = env.value.version
            }
          }
        }
      }

      dynamic "volume_mounts" {
        for_each = length(var.cloud_sql_instances) == 0 ? [] : [1]

        content {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }

      startup_probe {
        tcp_socket {
          port = var.container_port
        }
        initial_delay_seconds = 0
        period_seconds        = 10
        timeout_seconds       = 5
        failure_threshold     = var.startup_failure_threshold
      }

      liveness_probe {
        http_get {
          path = var.liveness_path
          port = var.container_port
        }
        period_seconds    = 30
        timeout_seconds   = 5
        failure_threshold = 3
      }
    }
  }

  dynamic "traffic" {
    for_each = trimspace(var.service_traffic_tag) == "" ? [] : [var.service_traffic_tag]

    content {
      percent = 100
      tag     = traffic.value
      # LATEST solo en el create inicial. Un update de template con este
      # tipo movería el 100% a la revisión nueva. Por eso el validador
      # rechaza cualquier update de sports-demo-api y GitHub Actions fija
      # después los porcentajes por nombre de revisión, nunca por latest.
      type = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    }
  }

  lifecycle {
    precondition {
      condition = (
        !strcontains(var.image, "REGION-docker.pkg.dev")
        && !contains(keys(var.env), "PORT")
        && !contains(keys(var.env), "DB_HOST")
        && !contains(keys(var.env), "FAULT_INJECTION_ENABLED")
      )
      error_message = "La imagen sigue siendo ilustrativa, o env define PORT, DB_HOST o FAULT_INJECTION_ENABLED. DB_HOST forzaría TCP local dentro de Cloud Run. PORT lo asigna Cloud Run. Fault injection no entra en la plantilla de Terraform."
    }

    # scaling: provider google 6.50 rellena el scaling de SERVICIO con
    # min_instance_count=0 y manual_instance_count=0. El permadiff 0 -> null
    # no cambia template.scaling. No se sube el provider a 7.x aquí.
    #
    # traffic: se evaluó contra el recurso google_cloud_run_v2_service del
    # provider ~> 6.0, sin plan remoto. ignore_changes omite traffic del
    # update mask para que un apply posterior no reescriba los porcentajes
    # que fija Actions. No basta por sí solo: si el tráfico de estado sigue
    # siendo LATEST, un cambio de template crea una revisión y la API le
    # asigna el 100%. Ese update lo bloquea el validador del workflow.
    ignore_changes = [scaling, traffic]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_unauthenticated ? 1 : 0

  project  = var.project_id
  location = google_cloud_run_v2_service.service.location
  name     = google_cloud_run_v2_service.service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "service_invoker" {
  count = var.invoker_service_account_email == "" ? 0 : 1

  project  = var.project_id
  location = google_cloud_run_v2_service.service.location
  name     = google_cloud_run_v2_service.service.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.invoker_service_account_email}"
}
