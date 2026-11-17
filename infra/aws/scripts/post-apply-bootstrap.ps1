# Post-apply: espera SSH/k3s, construye imagen en EC2, despliega MySQL+Sports, bootstrap schema, verifica HTTP.
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
  ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=25 -i $PemPath "ec2-user@$publicIp" $Cmd
}

Write-Host "== Esperando SSH =="
for ($i = 1; $i -le 36; $i++) {
  try {
    $pong = Invoke-Remote "echo SSH_OK"
    if ($pong -match "SSH_OK") { break }
  } catch { }
  if ($i -eq 36) { throw "Timeout SSH" }
  Start-Sleep -Seconds 10
}

Write-Host "== Asegurar k3s =="
Invoke-Remote "if ! sudo systemctl is-active k3s >/dev/null 2>&1; then curl -sfL https://get.k3s.io | sudo sh -s - --write-kubeconfig-mode 644 --disable traefik; fi; sudo systemctl is-active k3s"

Write-Host "== Docker en EC2 + build imagen =="
Invoke-Remote "sudo dnf install -y docker >/dev/null 2>&1 || true; sudo systemctl enable --now docker"
$tar = Join-Path $env:TEMP "sports-src.tgz"
tar -czf $tar --exclude=node_modules --exclude=.git --exclude=dist --exclude=infra/aws/terraform/.terraform --exclude=infra/aws/terraform/.provider-mirror --exclude=infra/aws/.tools --exclude=coverage -C $Root Dockerfile package.json package-lock.json tsconfig.json src k8s
scp -o StrictHostKeyChecking=accept-new -i $PemPath $tar "ec2-user@${publicIp}:/tmp/sports-src.tgz"
Invoke-Remote "rm -rf /tmp/sports-build && mkdir -p /tmp/sports-build && tar -xzf /tmp/sports-src.tgz -C /tmp/sports-build && cd /tmp/sports-build && sudo docker build -t $Image . && sudo docker save $Image -o /tmp/sports-api.tar && sudo k3s ctr images import /tmp/sports-api.tar"

Write-Host "== Deploy manifiestos en el nodo =="
scp -o StrictHostKeyChecking=accept-new -i $PemPath -r (Join-Path $Root "k8s\aws") "ec2-user@${publicIp}:/tmp/k8s-aws"
Invoke-Remote @"
set -euxo pipefail
sudo k3s kubectl get ns sports-lab >/dev/null 2>&1 || sudo k3s kubectl apply -f /tmp/k8s-aws/namespace.yaml
if ! sudo k3s kubectl -n sports-lab get secret sports-api-secrets >/dev/null 2>&1; then
  sudo k3s kubectl -n sports-lab create secret generic sports-api-secrets \
    --from-literal=DB_PASSWORD=sports_password \
    --from-literal=MYSQL_ROOT_PASSWORD=root_lab_password \
    --from-literal=CHAOS_FAULT_TOKEN=chaos-lab-token-minimo-32-chars!!
fi
sudo k3s kubectl apply -f /tmp/k8s-aws/configmap.yaml
sudo k3s kubectl apply -f /tmp/k8s-aws/mysql/deployment.yaml
sudo k3s kubectl apply -f /tmp/k8s-aws/deployment.yaml
sudo k3s kubectl apply -f /tmp/k8s-aws/service.yaml
sudo k3s kubectl -n sports-lab rollout status deployment/sports-mysql --timeout=300s
sudo k3s kubectl -n sports-lab delete job sports-schema-bootstrap --ignore-not-found
sudo k3s kubectl apply -f /tmp/k8s-aws/schema-bootstrap-job.yaml
sudo k3s kubectl -n sports-lab wait --for=condition=complete job/sports-schema-bootstrap --timeout=180s
sudo k3s kubectl -n sports-lab rollout restart deployment/sports-tournaments-api
sudo k3s kubectl -n sports-lab rollout status deployment/sports-tournaments-api --timeout=180s
sudo k3s kubectl -n sports-lab get pods -o wide
"@

Write-Host "== HTTP checks =="
curl.exe -fsS "$apiUrl/health/live"; Write-Host ""
curl.exe -fsS "$apiUrl/health/ready"; Write-Host ""
curl.exe -fsS "$apiUrl/"; Write-Host ""
curl.exe -fsS "$apiUrl/api/v2/torneos"; Write-Host ""
Write-Host "BOOTSTRAP OK api=$apiUrl"
