<#
.SYNOPSIS
  Baseline → R0 → R1 INTERCLOUD: Sports AWS → Hotel OCI real (latencia en cliente saliente).

.DESCRIPTION
  Misma intensidad/perfil/métricas que el experimento con mocks, pero HOTEL_API_URL
  apunta a OCI y CINE_API_URL a GCP. El delay se aplica en Sports antes del fetch;
  no modifica infraestructura de Samuel.

  Baseline: resiliencia ON, sin latencia armada.
  R0: resiliencia OFF + latencia 800 ms.
  R1: resiliencia ON (timeout 400 + CB + fallback) + misma latencia.

  SIN -AuthorizeIntercloud (o AUTHORIZE_INTERCLOUD=1): solo dry-run / preparación.
  CON autorización: ejecuta las rondas y restaura configmap.yaml (try/finally).
#>
param(
  [string]$BaseUrl = "http://3.21.120.51:30080",
  [string]$SshHost = "ec2-user@3.21.120.51",
  [string]$PemPath = "$env:USERPROFILE\.ssh\sports-chaos-k3s.pem",
  [string]$ChaosToken = "chaos-lab-token-minimo-32-chars!!",
  [int]$LatencyMs = 800,
  [int]$TtlMs = 120000,
  [string]$RunId = "",
  [string]$ExpectedHotel = "149.130.165.30",
  [string]$ExpectedCine = "35.239.107.54",
  [switch]$AuthorizeIntercloud
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$authorized = $AuthorizeIntercloud -or ($env:AUTHORIZE_INTERCLOUD -eq "1")
$K6Profile = Join-Path $Root "load\k6\flujo-profile-shared.js"
# k6 wall-clock ≈ 75s; exigir margen de TTL restante antes de arrancar.
$MinTtlRemainingMs = 90000

if (-not $RunId) {
  $suffix = if ($authorized) { "live" } else { "dryrun" }
  $RunId = "aws-intercloud-$suffix-" + (Get-Date -Format "yyyyMMddHHmmss")
}

$Evidence = Join-Path $Root "docs\seguimiento-4\evidence\aws-intercloud\$RunId"
New-Item -ItemType Directory -Force -Path $Evidence | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "load\results") | Out-Null

$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20", "-i", $PemPath, $SshHost)
$helperRemote = "/tmp/aws-lab-helpers.sh"

$thresholdsAPriori = [ordered]@{
  minR1AvailabilityRate = 0.9
  maxR1P95SuccessRatioVsR0 = 0.7
  partialIsNotFullSuccess = $true
  latencyMs = $LatencyMs
  hotelTimeoutMsR1 = 400
  k6Profile = "load/k6/flujo-profile-shared.js (15s@2, 45s@4, 15s@0)"
  baseline = "RESILIENCE_ENABLED=true, fault not armed"
  r0 = "RESILIENCE_ENABLED=false, fault 800ms"
  r1 = "RESILIENCE_ENABLED=true timeout/CB/fallback, fault 800ms"
  hypothesis = "Con timeout+CB+fallback ante latencia Sports→Hotel OCI (misma carga), disponibilidad (full+partial) >=90% y p95 <=70% de R0; parcial != full."
  timeoutNote = "applyHotelLatencyIfActive corre DENTRO de withTimeout: 800ms > 400ms ⇒ R1 aborta durante inyección (antes del fetch)."
}

function Invoke-Remote([string]$RemoteCmd) {
  & ssh @sshArgs $RemoteCmd
  if ($LASTEXITCODE -ne 0) { throw "SSH failed ($LASTEXITCODE): $RemoteCmd" }
}

function Invoke-Helper([string]$HelperArgs) {
  $cmd = "CHAOS_FAULT_TOKEN='$ChaosToken' CHAOS_HOTEL_LATENCY_MS='$LatencyMs' CHAOS_HOTEL_LATENCY_TTL_MS='$TtlMs' sh $helperRemote $HelperArgs"
  Invoke-Remote $cmd
}

function Invoke-HttpGet([string]$Url, [string]$OutFile) {
  curl.exe -s -D "$OutFile.headers" -o "$OutFile.body" -w "http_code=%{http_code}`ntime_total=%{time_total}`n" $Url |
    Out-File "$OutFile.meta" -Encoding utf8
  if (Test-Path "$OutFile.body") {
    Get-Content "$OutFile.body" -Raw | Out-File $OutFile -Encoding utf8
  }
}

function Assert-RealProviders([string]$FlujoFile, [string]$Label) {
  $raw = Get-Content $FlujoFile -Raw -ErrorAction SilentlyContinue
  if (-not $raw) { throw "${Label}: empty flujo body" }
  if ($raw -notmatch [regex]::Escape($ExpectedHotel)) {
    throw "${Label}: expected Hotel OCI $ExpectedHotel in response"
  }
  if ($raw -notmatch [regex]::Escape($ExpectedCine)) {
    throw "${Label}: expected Cine GCP $ExpectedCine in response"
  }
  if ($raw -match "hotel-mock|cine-mock") {
    throw "${Label}: mock URLs detected — abort intercloud"
  }
  if ($raw -match '"via"\s*:\s*"fallback"' -and $Label -match "steady|baseline|after-restore") {
    throw "${Label}: unexpected fallback under steady state"
  }
}

function Apply-ConfigMap(
  [string]$LocalYaml,
  [string]$Label,
  [string]$ExpectResilience,
  [string]$ExpectChaos
) {
  Write-Host "=== Apply ConfigMap $Label (res=$ExpectResilience chaos=$ExpectChaos) ==="
  Invoke-Helper "clear-env"
  Get-Content -Raw $LocalYaml | & ssh @sshArgs "sudo kubectl apply -f -"
  if ($LASTEXITCODE -ne 0) { throw "kubectl apply failed for $Label" }
  Invoke-Helper "rollout"
  Invoke-Helper "wait-ready"
  $verify = & ssh @sshArgs "CHAOS_FAULT_TOKEN='$ChaosToken' sh $helperRemote verify-env-intercloud $ExpectedHotel $ExpectedCine $ExpectResilience $ExpectChaos https://otel-lab.local:31443"
  $verify | Tee-Object -FilePath (Join-Path $Evidence "verify-$Label.txt")
  if ($LASTEXITCODE -ne 0) { throw "verify-env-intercloud failed for $Label" }
}

function Set-Chaos([string]$Action, [string]$Round) {
  if ($Action -eq "on") {
    $armedAt = (Get-Date).ToUniversalTime().ToString("o")
    Invoke-Remote "CHAOS_FAULT_TOKEN='$ChaosToken' CHAOS_HOTEL_LATENCY_MS='$LatencyMs' CHAOS_HOTEL_LATENCY_TTL_MS='$TtlMs' sh $helperRemote arm" |
      Tee-Object -FilePath (Join-Path $Evidence "chaos-arm-$Round.txt")
    $armTxt = Get-Content (Join-Path $Evidence "chaos-arm-$Round.txt") -Raw
    if ($armTxt -notmatch "armed_pods=2") {
      throw "Abort: expected armed_pods=2 for $Round"
    }
    $statePath = Join-Path $Evidence "chaos-state-$Round-start.json"
    curl.exe -s "$BaseUrl/chaos/hotel-latency" -o $statePath
    $state = Get-Content $statePath -Raw | ConvertFrom-Json
    if (-not $state.enabled) { throw "Chaos not enabled after arm ($Round)" }
    if ($null -ne $state.PSObject.Properties["targetsRealHotel"]) {
      if (-not $state.targetsRealHotel) {
        throw "Abort: fault target is not real Hotel OCI (targetsRealHotel=false)"
      }
      if (($state.targetBaseUrl -as [string]) -notmatch [regex]::Escape($ExpectedHotel)) {
        throw "Abort: targetBaseUrl=$($state.targetBaseUrl) != OCI $ExpectedHotel"
      }
    } else {
      throw "Abort: image missing targetsRealHotel (redeploy required)"
    }
    if ($null -eq $state.expiresAt) { throw "Abort: expiresAt missing after arm" }
    $remaining = [int64]$state.expiresAt - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($remaining -lt $MinTtlRemainingMs) {
      throw "Abort: TTL remaining ${remaining}ms < ${MinTtlRemainingMs}ms needed for k6"
    }
    @"
round=$Round
armedAtUtc=$armedAt
latencyMs=$LatencyMs
ttlMs=$TtlMs
expiresAt=$($state.expiresAt)
remainingMsBeforeK6=$remaining
targetBaseUrl=$($state.targetBaseUrl)
targetsRealHotel=$($state.targetsRealHotel)
"@ | Out-File (Join-Path $Evidence "chaos-coverage-$Round.txt") -Encoding utf8
  } else {
    $disarmedAt = (Get-Date).ToUniversalTime().ToString("o")
    Invoke-Remote "CHAOS_FAULT_TOKEN='$ChaosToken' sh $helperRemote disarm" |
      Tee-Object -FilePath (Join-Path $Evidence "chaos-disarm-$Round.txt")
    $statePath = Join-Path $Evidence "chaos-state-$Round-end.json"
    curl.exe -s "$BaseUrl/chaos/hotel-latency" -o $statePath
    "disarmedAtUtc=$disarmedAt" | Out-File (Join-Path $Evidence "chaos-disarm-meta-$Round.txt") -Encoding utf8
  }
}

function Invoke-K6Round([string]$Round) {
  Write-Host "=== k6 $Round (intercloud / flujo-profile-shared) ==="
  if (-not (Test-Path $K6Profile)) { throw "Missing k6 profile: $K6Profile" }
  $env:BASE_URL = $BaseUrl
  $env:TORNEO_ID = "1"
  $env:HABITACION_ID = "1"
  $env:PELICULA_ID = "1"
  $env:RUN_ID = $RunId
  $env:ROUND = $Round
  & k6 run $K6Profile 2>&1 |
    Tee-Object -FilePath (Join-Path $Evidence "k6-$Round-stdout.txt")
  $summarySrc = Join-Path $Root "load\results\$Round-$RunId.json"
  if (Test-Path $summarySrc) {
    Copy-Item $summarySrc (Join-Path $Evidence "k6-$Round-summary.json") -Force
  }
}

function Capture-Logs([string]$Name) {
  & ssh @sshArgs "sh $helperRemote logs" | Out-File (Join-Path $Evidence $Name) -Encoding utf8
}

function Save-K8sSnapshot([string]$Name) {
  & ssh @sshArgs "sh $helperRemote snapshot" | Out-File (Join-Path $Evidence $Name) -Encoding utf8
}

function Restore-StableMulticloud([string]$Reason) {
  Write-Host "=== RESTORE stable multicloud ($Reason) ==="
  try {
    Invoke-Remote "CHAOS_FAULT_TOKEN='$ChaosToken' sh $helperRemote disarm" |
      Tee-Object -FilePath (Join-Path $Evidence "chaos-disarm-restore.txt")
  } catch {
    Write-Warning "disarm during restore failed: $_"
  }
  Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.yaml") "multicloud-real" "true" "false"
  Save-K8sSnapshot "05-after-restore-k8s.txt"
  Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "05-after-ready")
  Invoke-HttpGet "$BaseUrl/chaos/hotel-latency" (Join-Path $Evidence "05-after-chaos")
  Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "05-after-flujo")
  Assert-RealProviders (Join-Path $Evidence "05-after-flujo") "after-restore"
  Capture-Logs "05-after-logs.txt"
  "restoredAtUtc=$((Get-Date).ToUniversalTime().ToString('o'))`nreason=$Reason" |
    Out-File (Join-Path $Evidence "05-restore-meta.txt") -Encoding utf8
}

Write-Host "RunId=$RunId authorized=$authorized Evidence=$Evidence"

# Upload helpers
scp @("-o", "StrictHostKeyChecking=no", "-i", $PemPath) `
  (Join-Path $Root "scripts\chaos\aws-lab-helpers.sh") `
  "${SshHost}:$helperRemote"
Invoke-Remote "sed -i 's/\r$//' $helperRemote && chmod +x $helperRemote"

# --- Preflight (always) ---
Save-K8sSnapshot "00-before-k8s.txt"
Invoke-HttpGet "$BaseUrl/health/ready" (Join-Path $Evidence "00-before-ready")
Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "00-before-flujo")
Assert-RealProviders (Join-Path $Evidence "00-before-flujo") "steady-before"
Invoke-HttpGet "$BaseUrl/chaos/hotel-latency" (Join-Path $Evidence "00-before-chaos")

$prep = [ordered]@{
  runId = $RunId
  authorized = $authorized
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  injectionPoint = "sports-outbound-hotel-client"
  k6Profile = "load/k6/flujo-profile-shared.js"
  configMaps = @{
    baseline = "k8s/aws/configmap.exp-intercloud-baseline.yaml"
    r0 = "k8s/aws/configmap.exp-intercloud-r0.yaml"
    r1 = "k8s/aws/configmap.exp-intercloud-r1.yaml"
    restore = "k8s/aws/configmap.yaml"
  }
  targets = @{ hotel = "http://$ExpectedHotel"; cine = "http://$ExpectedCine" }
  otel = @{
    endpoint = "https://otel-lab.local:31443"
    certificatePath = "/etc/otel/otel-lab-ca.crt"
    secretsUnchanged = @("sports-otel-secrets", "sports-otel-ca")
  }
  thresholdsAPriori = $thresholdsAPriori
  status = if ($authorized) { "executing" } else { "prepared-pending-samuel-authorization" }
  commandsWhenAuthorized = @(
    ".\scripts\chaos\run_aws_intercloud_rounds.ps1 -AuthorizeIntercloud -BaseUrl `"$BaseUrl`""
    "AUTHORIZE_INTERCLOUD=1; .\scripts\chaos\run_aws_intercloud_rounds.ps1"
  )
  abortConditions = @(
    "health/ready != 200",
    "flujo sin providers OCI/GCP",
    "targetsRealHotel != true al armar",
    "armed_pods != 2",
    "TTL restante < 90s antes de k6",
    "OTEL endpoint vacío o distinto al estable"
  )
  restore = "try/finally → disarm + k8s/aws/configmap.yaml (OTLP + resiliencia + URLs reales)"
}
($prep | ConvertTo-Json -Depth 8) | Out-File (Join-Path $Evidence "00-preparation.json") -Encoding utf8

if (-not $authorized) {
  Write-Host ""
  Write-Host "DRY-RUN completo: experimento INTERCLOUD preparado, SIN inyección contra Hotel OCI."
  Write-Host "Acordar ventana con Samuel y re-ejecutar con -AuthorizeIntercloud."
  Write-Host "Evidencia: $Evidence"
  exit 0
}

# --- LIVE intercloud rounds (restore always) ---
Write-Host "=== AUTHORIZED: running intercloud Baseline/R0/R1 ==="
$liveFailed = $false
$liveError = $null

try {
  Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-intercloud-baseline.yaml") "intercloud-baseline" "true" "true"
  Save-K8sSnapshot "01-baseline-k8s.txt"
  Invoke-HttpGet "$BaseUrl/chaos/hotel-latency" (Join-Path $Evidence "01-baseline-chaos")
  $baselineChaos = Get-Content (Join-Path $Evidence "01-baseline-chaos") -Raw | ConvertFrom-Json
  if ($baselineChaos.enabled) { throw "Baseline abort: latency fault unexpectedly enabled" }
  Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "01-baseline-flujo")
  Assert-RealProviders (Join-Path $Evidence "01-baseline-flujo") "baseline"
  Invoke-K6Round "baseline"
  Capture-Logs "01-baseline-logs.txt"

  # Declarative arm/hold/disarm smoke (multi-pod) — no cuenta como R0
  Set-Chaos "on" "toolkit"
  Start-Sleep -Seconds 3
  Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "02-toolkit-flujo-under-fault")
  Set-Chaos "off" "toolkit"

  Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-intercloud-r0.yaml") "intercloud-r0" "false" "true"
  Set-Chaos "on" "r0"
  Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "03-r0-flujo-sample")
  Invoke-K6Round "r0"
  Capture-Logs "03-r0-logs.txt"
  Set-Chaos "off" "r0"

  Apply-ConfigMap (Join-Path $Root "k8s\aws\configmap.exp-intercloud-r1.yaml") "intercloud-r1" "true" "true"
  Set-Chaos "on" "r1"
  Invoke-HttpGet "$BaseUrl/api/v2/flujo/1/1/1" (Join-Path $Evidence "04-r1-flujo-sample")
  Invoke-K6Round "r1"
  Capture-Logs "04-r1-logs.txt"
  Set-Chaos "off" "r1"
}
catch {
  $liveFailed = $true
  $liveError = $_
  Write-Warning "LIVE intercloud failed: $_"
  $_ | Out-File (Join-Path $Evidence "99-live-error.txt") -Encoding utf8
}
finally {
  try {
    Restore-StableMulticloud $(if ($liveFailed) { "error" } else { "success" })
  }
  catch {
    Write-Warning "CRITICAL: restore failed: $_"
    $_ | Out-File (Join-Path $Evidence "99-restore-error.txt") -Encoding utf8
  }
}

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
  environment = "aws-k3s-intercloud-oci"
  runId = $RunId
  generatedAt = (Get-Date).ToUniversalTime().ToString("o")
  injectionPoint = "sports-outbound-hotel-client"
  k6Profile = "load/k6/flujo-profile-shared.js"
  notMocks = $true
  liveFailed = $liveFailed
  thresholdsAPriori = $thresholdsAPriori
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
    "Hipotesis SOSTENIDA (intercloud). Nivel R1=$serviceLevel. Parcial != full."
  } elseif ($availOk) {
    "Hipotesis PARCIAL: disponibilidad OK; p95 no mejoro >=30%. Nivel=$serviceLevel."
  } else {
    "Hipotesis NO sostenida con evidencia intercloud."
  }
  $comparison.comparison = [ordered]@{
    p95DeltaPct = PctDelta $r0p95 $r1p95
    availabilityDeltaPp = [math]::Round(([double]$r1.classification.availabilityRate - [double]$r0.classification.availabilityRate) * 100, 2)
    fullSuccessDeltaPp = [math]::Round(([double]$r1.classification.fullSuccessRate - [double]$r0.classification.fullSuccessRate) * 100, 2)
    partialRateR1 = $r1.classification.partialRate
    serviceLevelR1 = $serviceLevel
    p95ImprovedAtLeast30Pct = $p95Improved
    availabilityOk = $availOk
    conclusion = $conclusion
  }
}

($comparison | ConvertTo-Json -Depth 10) | Out-File (Join-Path $Evidence "comparison.json") -Encoding utf8
Copy-Item (Join-Path $Evidence "comparison.json") (Join-Path $Root "chaos\results\aws-intercloud-latest.json") -Force

if ($liveFailed) {
  throw "Intercloud live failed after restore attempt: $liveError"
}

Write-Host "DONE intercloud live. $($comparison.comparison.conclusion)"
