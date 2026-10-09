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

      env {
        name  = "PORT"
        value = tostring(var.container_port)
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

  lifecycle {
    precondition {
      condition     = !strcontains(var.image, "REGION-docker.pkg.dev") && !contains(keys(var.env), "PORT")
      error_message = "La imagen sigue siendo ilustrativa, o env intenta redefinir PORT. Publica la imagen y deja que el módulo fije PORT."
    }
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
