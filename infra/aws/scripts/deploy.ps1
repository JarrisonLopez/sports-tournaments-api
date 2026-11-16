# Despliegue desde Windows (requiere kubectl en PATH).
$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
$Ns = if ($env:SPORTS_NAMESPACE) { $env:SPORTS_NAMESPACE } else { "sports-lab" }
$Image = if ($env:SPORTS_IMAGE) { $env:SPORTS_IMAGE } else { "sports-tournaments-api:4.1.0" }

bash (Join-Path $PSScriptRoot "deploy.sh")
if ($LASTEXITCODE -ne 0) {
  Write-Host "Si bash no está disponible, aplica manualmente con kubectl apply -f k8s/aws/"
  kubectl get ns $Ns 2>$null
  if ($LASTEXITCODE -ne 0) { kubectl apply -f (Join-Path $Root "k8s\aws\namespace.yaml") }
  kubectl -n $Ns get secret sports-api-secrets 2>$null
  if ($LASTEXITCODE -ne 0) {
    kubectl -n $Ns create secret generic sports-api-secrets `
      --from-literal=DB_PASSWORD=sports_password `
      --from-literal=MYSQL_ROOT_PASSWORD=root_lab_password `
      --from-literal=CHAOS_FAULT_TOKEN=chaos-lab-token-minimo-32-chars!!
  }
  kubectl apply -f (Join-Path $Root "k8s\aws\configmap.yaml")
  kubectl apply -f (Join-Path $Root "k8s\aws\mysql\deployment.yaml")
  $deploy = Get-Content (Join-Path $Root "k8s\aws\deployment.yaml") -Raw
  $deploy = $deploy -replace "image: sports-tournaments-api:4.1.0", "image: $Image"
  $tmp = Join-Path $env:TEMP "sports-deploy.yaml"
  Set-Content -Path $tmp -Value $deploy -Encoding utf8
  kubectl apply -f $tmp
  kubectl apply -f (Join-Path $Root "k8s\aws\service.yaml")
  kubectl -n $Ns rollout status deployment/sports-tournaments-api --timeout=180s
}
