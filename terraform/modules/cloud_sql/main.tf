resource "google_sql_database_instance" "main" {
  project          = var.project_id
  name             = var.instance_name
  region           = var.region
  database_version = var.database_version

  # Bloqueo de Terraform. Si queda en true, destroy falla dentro de Terraform
  # y no llega a llamar a la API. No sustituye al bloqueo de Cloud SQL.
  deletion_protection = var.deletion_protection

  settings {
    tier = var.tier
    # MySQL 8.4 usa Enterprise Plus si edition no se envía. Los tiers
    # shared-core y el disco PD_SSD de esta instancia pertenecen a Enterprise.
    edition           = "ENTERPRISE"
    availability_type = "ZONAL"
    disk_size         = var.disk_size_gb
    disk_type         = "PD_SSD"
    disk_autoresize   = false
    activation_policy = var.activation_policy

    # Bloqueo de la API de Cloud SQL. Si queda en true, la API rechaza el
    # delete aunque Terraform ya haya pasado su propio chequeo. Los dos
    # flags usan la misma variable para que destroy no dependa de un paso
    # manual en la consola.
    deletion_protection_enabled = var.deletion_protection

    backup_configuration {
      enabled            = false
      binary_log_enabled = false
    }

    ip_configuration {
      # IP pública para el conector de Cloud Run, sin redes autorizadas y
      # sin VPC. El puerto no queda abierto a clientes MySQL arbitrarios.
      ipv4_enabled = true
    }

    user_labels = var.labels
  }

  timeouts {
    create = "30m"
    update = "30m"
    delete = "30m"
  }

  lifecycle {
    precondition {
      condition     = var.database_version != "PENDING_VERIFICATION" && var.tier != "PENDING_VERIFICATION"
      error_message = "database_version y tier siguen en PENDING_VERIFICATION. La documentación vigente indica MYSQL_8_4, edition ENTERPRISE y tier db-f1-micro."
    }
  }
}

resource "google_sql_database" "app" {
  project   = var.project_id
  name      = var.database_name
  instance  = google_sql_database_instance.main.name
  charset   = "utf8mb4"
  collation = "utf8mb4_unicode_ci"
}

# No se declara google_sql_user. El argumento password de ese recurso se
# guarda en el estado. El usuario de aplicación se crea después, fuera de
# Terraform, con la misma contraseña cargada en Secret Manager y con permiso
# DDL sobre esta base: src/config/database.ts arranca con synchronize = true
# y no abre el puerto hasta conectar. La instancia, al destruirse, se lleva
# ese usuario aunque Terraform no lo gestione.
