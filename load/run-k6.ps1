param(
  [ValidateSet("baseline", "r0", "r1")]
  [string]$Round = "baseline",
  [string]$BaseUrl = "http://127.0.0.1:8080",
  [string]$RunId = "",
  [int]$TorneoId = 1,
  [int]$HabitacionId = 1,
  [int]$PeliculaId = 1
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
New-Item -ItemType Directory -Force -Path (Join-Path $Root "load\results") | Out-Null

if (-not $RunId) {
  $RunId = "local-" + (Get-Date -Format "yyyyMMddHHmmss")
}

$env:BASE_URL = $BaseUrl
$env:ROUND = $Round
$env:RUN_ID = $RunId
$env:TORNEO_ID = "$TorneoId"
$env:HABITACION_ID = "$HabitacionId"
$env:PELICULA_ID = "$PeliculaId"

$script = Join-Path $Root "load\k6\flujo-profile.js"

if (Get-Command k6 -ErrorAction SilentlyContinue) {
  k6 run $script
  exit $LASTEXITCODE
}

Write-Host "k6 no está en PATH; intentando Docker..."
docker run --rm `
  -e "BASE_URL=$BaseUrl" `
  -e "ROUND=$Round" `
  -e "RUN_ID=$RunId" `
  -e "TORNEO_ID=$TorneoId" `
  -e "HABITACION_ID=$HabitacionId" `
  -e "PELICULA_ID=$PeliculaId" `
  -v "${Root}/load:/scripts" `
  grafana/k6:0.54.0 run /scripts/k6/flujo-profile.js
exit $LASTEXITCODE
