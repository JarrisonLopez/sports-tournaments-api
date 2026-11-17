# Ejecuta k6 real Baseline/R0/R1 contra lab/flujo-lab-server.mjs
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')

$BaseUrl = "http://127.0.0.1:8080"
$Token = "chaos-lab-token-minimo-32-chars!!"
$RunId = "k6-" + (Get-Date -Format "yyyyMMddHHmmss")
New-Item -ItemType Directory -Force -Path (Join-Path $Root "load\results") | Out-Null

function Set-Resilience([bool]$Enabled) {
  $body = @{ enabled = $Enabled; hotelTimeoutMs = 400 } | ConvertTo-Json
  Invoke-RestMethod -Method Post -Uri "$BaseUrl/lab/resilience" -Headers @{ "x-chaos-token" = $Token } -ContentType "application/json" -Body $body | Out-Null
}

function Set-Fault([bool]$On) {
  if ($On) {
    $body = @{ token = $Token; latencyMs = 800; ttlMs = 90000 } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "$BaseUrl/chaos/hotel-latency" -ContentType "application/json" -Body $body | Out-Null
  } else {
    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/chaos/hotel-latency" -Headers @{ "x-chaos-token" = $Token } | Out-Null
  }
}

function Invoke-K6Round([string]$Round) {
  $env:BASE_URL = $BaseUrl
  $env:ROUND = $Round
  $env:RUN_ID = $RunId
  $env:TORNEO_ID = "1"
  $env:HABITACION_ID = "1"
  $env:PELICULA_ID = "1"
  $out = Join-Path $Root "load\results\k6-$Round-summary.json"
  Write-Host "=== k6 $Round ==="
  & k6 run (Join-Path $Root "load\k6\flujo-profile.js") --summary-export $out
  Write-Host "summary -> $out exit=$LASTEXITCODE"
}

# Steady
Set-Fault $false
Set-Resilience $false
Invoke-K6Round "baseline"

# R0: mismo fallo, sin resiliencia
Set-Resilience $false
Set-Fault $true
Invoke-K6Round "r0"
Set-Fault $false

# R1: mismo fallo, con resiliencia
Set-Resilience $true
Set-Fault $true
Invoke-K6Round "r1"
Set-Fault $false
Set-Resilience $false

Write-Host "DONE runId=$RunId"
