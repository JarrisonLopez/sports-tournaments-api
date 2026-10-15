output "enabled_services" {
  description = "APIs que este módulo pide habilitar."
  value       = sort(keys(google_project_service.required))
}
