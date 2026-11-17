<#
.SYNOPSIS
  Baseline → R0 → R1 contra Sports en k3s AWS usando mocks de laboratorio.
#>
param(
  [string]$BaseUrl = "http://3.21.120.51:30080",
  [string]$SshHost = "ec2-user@3.21.120.51",
  [string]$PemPath = "$env:USERPROFILE\.ssh\sports-chaos-k3s.pem",
  [string]$ChaosToken = "chaos-lab-token-minimo-32-chars!!",
  [int]$LatencyMs = 800,
  [int]$TtlMs = 120000,
  [string]$RunId = ""
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

if (-not $RunId) {
  $RunId = "aws-rounds-" + (Get-Date -Format "yyyyMMddHHmmss")
}

$Evidence = Join-Path $Root "docs\seguimiento-4\evidence\aws-rounds\$RunId"
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "load\results") | Out-Null

$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20", "-i", $PemPath, $SshHost)
$helperRemote = "/tmp/aws-lab-helpers.sh"

function Invoke-Remote([string]$RemoteCmd) {
  & ssh @sshArgs $RemoteCmd
  if ($LASTEXITCODE -ne 0) { throw "SSH failed ($LASTEXITCODE): $RemoteCmd" }
}

function Invoke-Helper([string]$HelperArgs) {
  $cmd = "CHAOS_FAULT_TOKEN='$ChaosToken' CHAOS_HOTEL_LATENCY_MS='$LatencyMs' CHAOS_HOTEL_LATENCY_TTL_MS='$TtlMs' sh $helperRemote $HelperArgs"
  Invoke-Remote $cmd
}

function Apply-ConfigMap([string]$LocalYaml, [string]$Label, [string]$ExpectHotel) {
  Write-Host "=== Apply ConfigMap $Label ==="
  Invoke-Helper "clear-env"
  Get-Content -Raw $LocalYaml | & ssh @sshArgs "sudo kubectl apply -f -"
  if ($LASTEXITCODE -ne 0) { throw "kubectl apply failed for $Label" }
  Invoke-Helper "rollout"
  $verify = & ssh @sshArgs "CHAOS_FAULT_TOKEN='$ChaosToken' sh $helperRemote verify-env $ExpectHotel"
  $verify | Tee-Object -FilePath (Join-Path $Evidence "verify-$Label.txt")
  if ($LASTEXITCODE -ne 0) { throw "verify-env failed for $Label" }
}

function Save-K8sSnapshot([string]$Name) {
  & ssh @sshArgs "sh $helperRemote snapshot" | Out-File (Join-Path $Evidence $Name) -Encoding utf8
}

function Invoke-HttpGet([string]$Url, [string]$OutFile) {
  curl.exe -s -D "$OutFile.headers" -o "$OutFile.body" -w "http_code=%{http_code}`ntime_total=%{time_total}`n" $Url |
    Out-File "$OutFile.meta" -Encoding utf8
  if (Test-Path "$OutFile.body") {
    Get-Content "$OutFile.body" -Raw | Out-File $OutFile -Encoding utf8
  }
}

function Set-Chaos([string]$Action, [string]$Round) {
  if ($Action -eq "on") {
    Invoke-Remote "CHAOS_FAULT_TOKEN='$ChaosToken' CHAOS_HOTEL_LATENCY_MS='$LatencyMs' CHAOS_HOTEL_LATENCY_TTL_MS='$TtlMs' sh $helperRemote arm" |
      Tee-Object -FilePath (Join-Path $Evidence "chaos-arm-$Round.txt")
  } else {
    Invoke-Remote "CHAOS_FAULT_TOKEN='$ChaosToken' sh $helperRemote disarm" |
      Tee-Object -FilePath (Join-Path $Evidence "chaos-disarm-$Round.txt")
  }
}

function Invoke-K6Round([string]$Round) {
  Write-Host "=== k6 $Round ==="
  $env:BASE_URL = $BaseUrl
  $env:TORNEO_ID = "1"
  $env:HABITACION_ID = "1"
  $env:PELICULA_ID = "1"
  $env:RUN_ID = $RunId
  $env:ROUND = $Round
  $stdout = Join-Path $Evidence "k6-$Round-stdout.txt"
  & k6 run (Join-Path $Root "load\k6\flujo-profile.js") 2>&1 | Tee-Object -FilePath $stdout
  $summarySrc = Join-Path $Root "load\results\$Round-$RunId.json"
  if (Test-Path $summarySrc) {
    Copy-Item $summarySrc (Join-Path $Evidence "k6-$Round-summary.json") -Force
  }
}

function Capture-Logs([string]$Name) {
  & ssh @sshArgs "sh $helperRemote logs" | Out-File (Join-Path $Evidence $Name) -Encoding utf8
}

Write-Host "RunId=$RunId Evidence=$Evidence"

# Upload helper (LF)
scp @("-o", "StrictHostKeyChecking=no", "-i", $PemPath) `
  (Join-Path $Root "scripts\chaos\aws-lab-helpers.sh") `
  "${SshHost}:$helperRemote"
Invoke-Remote "sed -i 's/\r$//' $helperRemote && chmod +x $helperRemote"

# --- BEFORE (may still be multicloud) ---
Save-K8sSnapshot "00-before-k8s.txt"
Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "00-before-ready")
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "00-before-flujo")

# --- BASELINE mocks, no fault, no resilience ---
Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-r0.yaml") "baseline-r0cfg" "hotel-mock"
Save-K8sSnapshot "01-baseline-k8s.txt"
Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "01-baseline-ready")
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "01-baseline-flujo")
Invoke-HttpGet "$BaseUrl/chaos/hotel-latency" (Join-Path $Evidence "01-baseline-chaos-state")
Invoke-K6Round "baseline"
Capture-Logs "01-baseline-logs.txt"

# --- Chaos Toolkit equivalent (multi-pod safe: arm/hold/disarm on all replicas) ---
Write-Host "=== Chaos Toolkit declarative steps (multi-pod) ==="
$toolkitLog = Join-Path $Evidence "02-chaos-toolkit-runner.txt"
@(
  "experiment: hotel-latency (aws multi-pod)",
  "latencyMs=$LatencyMs ttlMs=$TtlMs",
  "note: fault state is in-memory per pod; NodePort alone is insufficient with 2 replicas"
) | Out-File $toolkitLog -Encoding utf8
Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "02-toolkit-ready")
Set-Chaos "on" "toolkit"
"hold_seconds=5" | Out-File $toolkitLog -Append -Encoding utf8
Start-Sleep -Seconds 5
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "02-toolkit-flujo-under-fault")
Set-Chaos "off" "toolkit"
Invoke-HttpGet "$BaseUrl/chaos/hotel-latency" (Join-Path $Evidence "02-toolkit-chaos-after")
"rollback_ok" | Out-File $toolkitLog -Append -Encoding utf8
# Also keep portable Node runner evidence (best-effort; may see pod-affinity races on NodePort)
$env:SPORTS_BASE_URL = $BaseUrl
$env:CHAOS_FAULT_TOKEN = $ChaosToken
$env:CHAOS_HOTEL_LATENCY_MS = "$LatencyMs"
$env:CHAOS_HOTEL_LATENCY_TTL_MS = "$TtlMs"
$env:CHAOS_HOLD_SECONDS = "2"
try {
  Set-Chaos "on" "toolkit-node"
  node (Join-Path $Root "scripts\chaos\run_hotel_latency_experiment.mjs") 2>&1 |
    Out-File (Join-Path $Evidence "02-chaos-toolkit-node-runner.txt") -Encoding utf8
} catch {
  $_ | Out-File (Join-Path $Evidence "02-chaos-toolkit-node-runner.txt") -Append -Encoding utf8
} finally {
  Set-Chaos "off" "toolkit-node"
}

# --- R0 ---
Write-Host "=== R0 ==="
Set-Chaos "on" "r0"
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "03-r0-flujo-sample")
Invoke-K6Round "r0"
Capture-Logs "03-r0-logs.txt"
Set-Chaos "off" "r0"
Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "03-r0-after-ready")

# --- R1 ---
Write-Host "=== R1 ==="
Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-r1.yaml") "r1" "hotel-mock"
Save-K8sSnapshot "04-r1-k8s.txt"
Set-Chaos "on" "r1"
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "04-r1-flujo-sample")
Invoke-K6Round "r1"
Capture-Logs "04-r1-logs.txt"
Set-Chaos "off" "r1"

# --- RESTORE multicloud ---
Write-Host "=== Restore multicloud real ==="
Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.yaml") "multicloud-real" "149.130.165.30"
Save-K8sSnapshot "05-after-restore-k8s.txt"
Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "05-after-ready")
Invoke-HttpGet "$BaseUrl/chaos/hotel-latency" (Join-Path $Evidence "05-after-chaos")
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "05-after-flujo-multicloud")
Capture-Logs "05-after-logs.txt"

function Read-Summary([string]$Round) {
  $p = Join-Path $Evidence "k6-$Round-summary.json"
  if (-not (Test-Path $p)) { return $null }
  return Get-Content $p -Raw | ConvertFrom-Json
}

$b = Read-Summary "baseline"
$r0 = Read-Summary "r0"
$r1 = Read-Summary "r1"

function PctDelta($a, $bVal) {
  if ($null -eq $a -or $null -eq $bVal -or [double]$a -eq 0) { return $null }
  return [math]::Round((([double]$bVal - [double]$a) / [double]$a) * 100, 2)
}

$comparison = [ordered]@{
  environment = "aws-k3s"
  runId = $RunId
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  hypothesis = "Con timeout+CB+fallback ante latencia Hotel (misma carga e intensidad), la disponibilidad (full+partial) permanece >=90%, el p95 de respuestas disponibles baja >=30% vs R0, y se reporta aparte fullSuccess vs partial (parcial != exito completo)."
  thresholdsAPriori = @{
    minR1AvailabilityRate = 0.9
    maxR1P95SuccessRatioVsR0 = 0.7
    partialIsNotFullSuccess = $true
  }
  fault = @{
    target = "hotel-mock (lab)"
    latencyMs = $LatencyMs
    ttlMs = $TtlMs
    notOciNotGcp = $true
  }
  baseline = $b
  r0 = $r0
  r1 = $r1
}

if ($b -and $r0 -and $r1) {
  $r0p95 = $r0.metrics.http_req_duration_p95
  $r1p95 = $r1.metrics.http_req_duration_p95
  $availOk = [double]$r1.classification.availabilityRate -ge 0.9
  $p95Improved = ($null -ne $r0p95 -and $null -ne $r1p95 -and [double]$r1p95 -le ([double]$r0p95 * 0.7))
  $serviceLevel = if ([double]$r1.classification.fullSuccessRate -ge 0.9) { "full" }
    elseif ([double]$r1.classification.partialRate -ge 0.9) { "partial" }
    else { "mixed" }
  $conclusion = if ($availOk -and $p95Improved) {
    "Hipotesis SOSTENIDA a nivel disponibilidad: R1 availability>=90% y p95<=70% de R0. Nivel=$serviceLevel. Parcial != full."
  } elseif ($availOk) {
    "Hipotesis PARCIAL: disponibilidad R1 OK pero p95 no mejoro >=30% vs R0. Nivel=$serviceLevel."
  } else {
    "Hipotesis NO sostenida con la evidencia AWS actual."
  }
  $comparison.comparison = [ordered]@{
    p95DeltaPct = PctDelta $r0p95 $r1p95
    availabilityDeltaPp = [math]::Round(([double]$r1.classification.availabilityRate - [double]$r0.classification.availabilityRate) * 100, 2)
    fullSuccessDeltaPp = [math]::Round(([double]$r1.classification.fullSuccessRate - [double]$r0.classification.fullSuccessRate) * 100, 2)
    partialRateR1 = $r1.classification.partialRate
    fullSuccessRateR1 = $r1.classification.fullSuccessRate
    serviceLevelR1 = $serviceLevel
    p95ImprovedAtLeast30Pct = $p95Improved
    availabilityOk = $availOk
    conclusion = $conclusion
  }
}

$reportPath = Join-Path $Evidence "comparison.json"
($comparison | ConvertTo-Json -Depth 10) | Out-File $reportPath -Encoding utf8
Copy-Item $reportPath (Join-Path $Root "chaos\results\aws-rounds-latest.json") -Force
Write-Host "DONE. Report: $reportPath"
if ($comparison.comparison) { Write-Host $comparison.comparison.conclusion }
