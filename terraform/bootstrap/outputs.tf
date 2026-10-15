output "bucket_name" {
  description = "Nombre del bucket de estado. No es el bucket de artifacts."
  value       = google_storage_bucket.state.name
}

output "bucket_url" {
  description = "URL gs:// del bucket de estado."
  value       = google_storage_bucket.state.url
}
