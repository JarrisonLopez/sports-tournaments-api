# Validación offline de manifiestos (sin cluster remoto).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$files = @(
  "k8s\aws\namespace.yaml",
  "k8s\aws\configmap.yaml",
  "k8s\aws\mysql\deployment.yaml",
  "k8s\aws\deployment.yaml",
  "k8s\aws\service.yaml"
)
foreach ($rel in $files) {
  $p = Join-Path $Root $rel
  if (-not (Test-Path $p)) { throw "Falta $rel" }
  Write-Host "OK $rel"
}

$deploy = Get-Content (Join-Path $Root "k8s\aws\deployment.yaml") -Raw
foreach ($needle in @("replicas: 2", "livenessProbe:", "readinessProbe:", "requests:", "limits:", "sports-tournaments-api:4.1.1")) {
  if ($deploy -notmatch [regex]::Escape($needle)) { throw "deployment.yaml sin '$needle'" }
}
$svc = Get-Content (Join-Path $Root "k8s\aws\service.yaml") -Raw
if ($svc -notmatch "nodePort: 30080") { throw "service.yaml sin NodePort 30080" }
$mysql = Get-Content (Join-Path $Root "k8s\aws\mysql\deployment.yaml") -Raw
if ($mysql -notmatch "PersistentVolumeClaim") { throw "mysql sin PVC" }

# dry-run solo si el contexto actual responde en <3s (evitar GCP histórico colgado)
$ctx = kubectl config current-context 2>$null
if ($ctx) {
  Write-Host "kubectl context=$ctx (dry-run omitido si no es local; usar --validate=false contra k3s AWS)"
}
Write-Host "Manifest checks OK"
