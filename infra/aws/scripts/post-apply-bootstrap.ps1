# Post-apply: espera k3s, importa imagen, despliega Sports+MySQL, verifica HTTP/K8s.
# Requiere: terraform apply ya hecho, Docker local, OpenSSH, PEM en OutPem.
param(
  [string]$PemPath = (Join-Path $env:USERPROFILE ".ssh\sports-chaos-k3s.pem"),
  [string]$Image = "sports-tournaments-api:4.1.1",
  [string]$TfDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..\..")
if (-not $TfDir) { $TfDir = Join-Path $Root "infra\aws\terraform" }

. (Join-Path $PSScriptRoot "with-aws-creds.ps1") -Profile sports-chaos -Region us-east-2
$env:TF_CLI_CONFIG_FILE = Join-Path $TfDir "terraform.rc.lab"

Push-Location $TfDir
$publicIp = (terraform output -raw public_ip).Trim()
$apiUrl = (terraform output -raw api_url_hint).Trim()
Pop-Location

if (-not (Test-Path $PemPath)) { throw "Falta PEM: $PemPath" }
Write-Host "Host=$publicIp API=$apiUrl"

function Invoke-Remote([string]$Cmd) {
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -i $PemPath "ec2-user@$publicIp" $Cmd
}

Write-Host "== Esperando SSH/k3s =="
for ($i = 1; $i -le 36; $i++) {
  try {
    $st = Invoke-Remote "test -f /opt/sports/bootstrap.status && sudo systemctl is-active k3s"
    if ($st -match "active") { Write-Host "k3s listo"; break }
  } catch { }
  if ($i -eq 36) { throw "Timeout esperando k3s" }
  Start-Sleep -Seconds 10
}

Write-Host "== Build + import imagen =="
Push-Location $Root
docker build -t $Image .
$tar = Join-Path $env:TEMP "sports-api-aws.tar"
docker save $Image -o $tar
Pop-Location
scp -o StrictHostKeyChecking=accept-new -i $PemPath $tar "ec2-user@${publicIp}:/tmp/sports-api.tar"
Invoke-Remote "sudo k3s ctr images import /tmp/sports-api.tar && rm -f /tmp/sports-api.tar"

Write-Host "== kubeconfig local temporal =="
$kube = Join-Path $env:TEMP "sports-k3s.yaml"
$raw = Invoke-Remote "sudo cat /etc/rancher/k3s/k3s.yaml"
$raw = $raw -replace "127\.0\.0\.1", $publicIp -replace "localhost", $publicIp
Set-Content -Path $kube -Value $raw -Encoding utf8
$env:KUBECONFIG = $kube

Write-Host "== Deploy manifiestos =="
$env:SPORTS_IMAGE = $Image
$env:SPORTS_NAMESPACE = "sports-lab"
& (Join-Path $PSScriptRoot "deploy.ps1")

Write-Host "== Verify réplicas + HTTP =="
$env:SPORTS_BASE_URL = $apiUrl
# verify.sh necesita bash; fallback PowerShell
kubectl -n sports-lab get pods -o wide
$ready = kubectl -n sports-lab get deploy sports-tournaments-api -o jsonpath='{.status.readyReplicas}'
if ([int]$ready -lt 2) { throw "Réplicas ready=$ready (se esperan 2)" }
curl.exe -fsS "$apiUrl/health/live"; Write-Host ""
curl.exe -fsS "$apiUrl/health/ready"; Write-Host ""
curl.exe -fsS "$apiUrl/"; Write-Host ""
Write-Host "BOOTSTRAP OK api=$apiUrl replicas=$ready kubeconfig=$kube"
