output "bucket_name" {
  description = "Nombre del bucket de artifacts."
  value       = google_storage_bucket.artifacts.name
}
