output "instance_id" {
  value       = aws_instance.k3s.id
  description = "ID de la EC2 k3s."
}

output "public_ip" {
  value       = var.create_elastic_ip ? aws_eip.k3s[0].public_ip : aws_instance.k3s.public_ip
  description = "IP pública para demos y NodePort."
}

output "api_url_hint" {
  value       = "http://${var.create_elastic_ip ? aws_eip.k3s[0].public_ip : aws_instance.k3s.public_ip}:30080"
  description = "URL sugerida del Service NodePort Sports."
}

output "ssh_hint" {
  value       = "ssh ec2-user@${var.create_elastic_ip ? aws_eip.k3s[0].public_ip : aws_instance.k3s.public_ip}"
  description = "Comando SSH de administración."
}

output "architecture_note" {
  value       = "Single-node k3s: 2 replicas fulfill the rubric but do not survive node loss."
  description = "Limitación de HA."
}
