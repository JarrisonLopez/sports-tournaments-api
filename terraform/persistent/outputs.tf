output "provision_service_account_email" {
  description = "Email de la SA persistente de Provision/Destroy. No es un secreto."
  value       = google_service_account.provision.email
}

output "provision_service_account_id" {
  description = "account_id corto de la SA de provision."
  value       = google_service_account.provision.account_id
}

output "github_actions_provision_subject" {
  description = "Valor esperado de assertion.sub autorizado a impersonar la SA de provision."
  value       = local.github_actions_provision_subject
}

output "github_actions_provision_member" {
  description = "Principal WIF completo con roles/iam.workloadIdentityUser sobre la SA de provision."
  value       = local.github_actions_provision_member
}

output "provision_project_role" {
  description = "Rol de proyecto concedido a la SA de provision. Temporal; retirar al cerrar la demo."
  value       = google_project_iam_member.provision_owner.role
}
