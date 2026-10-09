resource "google_secret_manager_secret" "db_password" {
  project   = var.project_id
  secret_id = var.secret_id
  labels    = var.labels

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
}

# No hay google_secret_manager_secret_version. El argumento secret_data
# quedaría en el estado de Terraform aunque se marcara sensitive.
# La versión se carga después, fuera de este estado: un archivo temporal
# que no esté en el repositorio, una sola versión añadida al secret_id,
# y el archivo borrado a continuación. Cloud Run solo referencia el
# identificador y la versión "latest".
