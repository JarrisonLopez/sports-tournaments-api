output "service_name" {
  description = "Nombre del servicio."
  value       = google_cloud_run_v2_service.service.name
}

output "uri" {
  description = "URL HTTPS asignada por Cloud Run."
  value       = google_cloud_run_v2_service.service.uri

  # Sports lee esta URL. Esperar el binding evita que el cliente quede
  # desplegado antes de poder invocar Object Storage.
  depends_on = [google_cloud_run_v2_service_iam_member.service_invoker]
}
