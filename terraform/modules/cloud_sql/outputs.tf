output "instance_name" {
  description = "Nombre de la instancia."
  value       = google_sql_database_instance.main.name
}

output "connection_name" {
  description = "PROJECT:REGION:INSTANCE. Sports lo usa como socket /cloudsql/<connection name>."
  value       = google_sql_database_instance.main.connection_name
}

output "database_name" {
  description = "Base creada para Sports."
  value       = google_sql_database.app.name
}
