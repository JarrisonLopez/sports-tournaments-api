<#
.SYNOPSIS
  Alterna Baseline / R0 / R1 / status / rollback para el experimento Hotel OCI HTTP 503.

.DESCRIPTION
  Solo toca Sports en AWS (namespace sports-lab).
  Conserva Hotel OCI + Cine GCP reales.
  CHAOS_LAB_ENABLED=false (Samuel activa el 503 en OCI; no inyección de latencia Sports).
  No arma fallos. No toca Terraform.

.PARAMETER Mode
  baseline | r0 | r1 | status | rollback

.EXAMPLE
  .\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode status
  .\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode r0
  .\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode r1
  .\scripts\chaos\set_aws_hotel503_mode.ps1 -Mode rollback
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("baseline", "r0", "r1", "status", "rollback")]
  [string]$Mode,

  [string]$SshHost = "ec2-user@3.21.120.51",
  [string]$PemPath = "$env:USERPROFILE\.ssh\sports-chaos-k3s.pem",
  [string]$BaseUrl = "http://3.21.120.51:30080",
  [string]$ExpectedHotel = "149.130.165.30",
  [string]$ExpectedCine = "35.239.107.54",
  [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

if (-not (Test-Path $PemPath)) {
  throw "PEM not found: $PemPath"
}

$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20", "-i", $PemPath, $SshHost)
$helperRemote = "/tmp/aws-lab-helpers.sh"

if (-not $EvidenceDir) {
  $stamp = Get-Date -Format "yyyyMMddHHmmss"
  $EvidenceDir = Join-Path $Root "docs\seguimiento-4\evidence\aws-hotel503\mode-$Mode-$stamp"
}
New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null

function Invoke-Remote([string]$RemoteCmd) {
  & ssh @sshArgs $RemoteCmd
  if ($LASTEXITCODE -ne 0) { throw "SSH failed ($LASTEXITCODE): $RemoteCmd" }
}

function Upload-Helper {
  scp @("-o", "StrictHostKeyChecking=no", "-i", $PemPath) `
    (Join-Path $Root "scripts\chaos\aws-lab-helpers.sh") `
    "${SshHost}:$helperRemote"
  Invoke-Remote "sed -i 's/\r$//' $helperRemote && chmod +x $helperRemote"
}

function Apply-ConfigMap(
  [string]$LocalYaml,
  [string]$Label,
  [string]$ExpectResilience,
  [string]$ExpectFallback
) {
  Write-Host "=== Apply ConfigMap $Label (res=$ExpectResilience fb=$ExpectFallback) ==="
  Invoke-Remote "sh $helperRemote clear-env"
  Get-Content -Raw $LocalYaml | & ssh @sshArgs "sudo kubectl apply -f -"
  if ($LASTEXITCODE -ne 0) { throw "kubectl apply failed for $Label" }
  # ConfigMap via envFrom requires pod restart to pick new values.
  Invoke-Remote "sh $helperRemote rollout"
  Invoke-Remote "sh $helperRemote wait-ready"
  $verify = & ssh @sshArgs "sh $helperRemote verify-env-hotel503 $ExpectedHotel $ExpectedCine $ExpectResilience $ExpectFallback"
  $verify | Tee-Object -FilePath (Join-Path $EvidenceDir "verify-$Label.txt")
  if ($LASTEXITCODE -ne 0) { throw "verify-env-hotel503 failed for $Label" }
  # Explicit dual-pod Ready assertion already in wait-ready; snapshot for evidence.
  & ssh @sshArgs "sh $helperRemote snapshot" |
    Out-File (Join-Path $EvidenceDir "k8s-$Label.txt") -Encoding utf8
}

function Show-Status {
  Write-Host "=== status sports-lab ==="
  $ready = & ssh @sshArgs "sh $helperRemote wait-ready"
  $ready | Tee-Object -FilePath (Join-Path $EvidenceDir "ready.txt")
  $verify = & ssh @sshArgs "sh $helperRemote verify-env-hotel503 $ExpectedHotel $ExpectedCine"
  $verify | Tee-Object -FilePath (Join-Path $EvidenceDir "verify-status.txt")
  if ($LASTEXITCODE -ne 0) { throw "verify-env-hotel503 failed" }
  curl.exe -s -o (Join-Path $EvidenceDir "ready-http.body") -w "http=%{http_code}`n" "$BaseUrl/health/ready" |
    Tee-Object -FilePath (Join-Path $EvidenceDir "ready-http.meta")
  Write-Host "Evidence: $EvidenceDir"
}

Upload-Helper

switch ($Mode) {
  "baseline" {
    # Baseline = config estable (resiliencia ON, caos OFF, URLs reales) — Hotel normal.
    Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.yaml") "baseline" "true" "true"
    Show-Status
  }
  "r0" {
    Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-hotel503-r0.yaml") "r0" "false" "false"
    Show-Status
  }
  "r1" {
    Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-hotel503-r1.yaml") "r1" "true" "true"
    Show-Status
  }
  "rollback" {
    Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.yaml") "rollback" "true" "true"
    Show-Status
  }
  "status" {
    Show-Status
  }
}

Write-Host "OK mode=$Mode evidence=$EvidenceDir"
Write-Host "NOTE: No se activa HTTP 503 en OCI. Esperar ventana de Samuel."
