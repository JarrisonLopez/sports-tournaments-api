param(
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [string]$RunId = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
New-Item -ItemType Directory -Force -Path (Join-Path $Root "load\results") | Out-Null

if (-not $RunId) {
  $RunId = "k6-" + (Get-Date -Format "yyyyMMddHHmmss")
}

$k6 = Get-Command k6 -ErrorAction SilentlyContinue
if (-not $k6) {
  throw "k6 no está instalado o no está en PATH"
}

$env:BASE_URL = $BaseUrl
$env:TORNEO_ID = "1"
$env:HABITACION_ID = "1"
$env:PELICULA_ID = "1"
$env:RUN_ID = $RunId

foreach ($round in @("baseline", "r0", "r1")) {
  Write-Host "=== k6 round $round ==="
  $env:ROUND = $round

  if ($round -eq "r0" -or $round -eq "r1") {
    $body = @{
      token = $env:CHAOS_FAULT_TOKEN
      latencyMs = 800
      ttlMs = 180000
    } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/chaos/hotel-latency" -ContentType "application/json" -Body $body | Out-Null
  }

  if ($round -eq "r1") {
    # La resiliencia se controla por env del lab server; documentar que debe iniciarse con RESILIENCE_ENABLED=true en R1.
  }

  & k6 run (Join-Path $Root "load\k6\flujo-profile.js")
  if ($LASTEXITCODE -ne 0) {
    Write-Warning "k6 $round exit=$LASTEXITCODE (umbrales pueden fallar bajo caos; se conservan resultados)"
  }

  if ($round -eq "r0" -or $round -eq "r1") {
    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/chaos/hotel-latency" -Headers @{ "x-chaos-token" = $env:CHAOS_FAULT_TOKEN } | Out-Null
  }
}

Write-Host "k6 rounds done runId=$RunId"
