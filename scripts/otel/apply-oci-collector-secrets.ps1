<#
.SYNOPSIS
  Crea/actualiza secrets OTEL para el Collector OCI de Samuel (sin imprimir secretos).

.PARAMETER Token
  Token/password HTTP Basic del usuario otel-lab (canal privado).

.PARAMETER CaCertPath
  Ruta al PEM otel-lab-ca.crt entregado por Samuel.

.PARAMETER SshHost
  Destino SSH del nodo k3s AWS.

.PARAMETER PemPath
  Clave SSH del lab.

.EXAMPLE
  .\scripts\otel\apply-oci-collector-secrets.ps1 -Token $env:OTEL_LAB_TOKEN -CaCertPath .\otel-lab-ca.crt
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$Token,
  [Parameter(Mandatory = $true)]
  [string]$CaCertPath,
  [string]$User = "otel-lab",
  [string]$SshHost = "ec2-user@3.21.120.51",
  [string]$PemPath = "$env:USERPROFILE\.ssh\sports-chaos-k3s.pem",
  [string]$Namespace = "sports-lab"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $CaCertPath)) {
  throw "CA cert no encontrado: $CaCertPath"
}
if (-not (Test-Path -LiteralPath $PemPath)) {
  throw "PEM SSH no encontrado: $PemPath"
}
if ([string]::IsNullOrWhiteSpace($Token)) {
  throw "Token vacío"
}

$pair = "{0}:{1}" -f $User, $Token
$basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
# Formato OTEL: key=value separados por coma. Un solo header Authorization.
$headersValue = "Authorization=Basic $basic"

$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20", "-i", $PemPath, $SshHost)

Write-Host "Aplicando sports-otel-secrets (headers) en $Namespace..."
# stdin remoto: no echo del valor
$headerB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($headersValue))
& ssh @sshArgs "echo $headerB64 | base64 -d | sudo kubectl -n $Namespace create secret generic sports-otel-secrets --from-file=OTEL_EXPORTER_OTLP_HEADERS=/dev/stdin --dry-run=client -o yaml | sudo kubectl apply -f -"
if ($LASTEXITCODE -ne 0) { throw "Fallo al aplicar sports-otel-secrets" }

Write-Host "Aplicando sports-otel-ca desde $CaCertPath..."
Get-Content -LiteralPath $CaCertPath -Raw | & ssh @sshArgs "cat > /tmp/otel-lab-ca.crt && sudo kubectl -n $Namespace create secret generic sports-otel-ca --from-file=otel-lab-ca.crt=/tmp/otel-lab-ca.crt --dry-run=client -o yaml | sudo kubectl apply -f - && shred -u /tmp/otel-lab-ca.crt 2>/dev/null || rm -f /tmp/otel-lab-ca.crt"
if ($LASTEXITCODE -ne 0) { throw "Fallo al aplicar sports-otel-ca" }

Write-Host "Reinicio controlado del Deployment (rollout)..."
& ssh @sshArgs "sudo kubectl -n $Namespace rollout restart deployment/sports-tournaments-api && sudo kubectl -n $Namespace rollout status deployment/sports-tournaments-api --timeout=180s"
if ($LASTEXITCODE -ne 0) { throw "Rollout falló" }

Write-Host "OK: secrets OTEL aplicados. Verificar exportación sin imprimir credenciales."
Write-Host "Rollback OTLP: kubectl apply -f k8s/aws/configmap.otel-rollback.yaml && rollout restart"
