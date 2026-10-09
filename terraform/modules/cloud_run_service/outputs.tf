output "service_name" {
  description = "Nombre del servicio."
  value       = google_cloud_run_v2_service.service.name
}

output "uri" {
  description = "URL HTTPS asignada por Cloud Run."
  value       = google_cloud_run_v2_service.service.uri
}
