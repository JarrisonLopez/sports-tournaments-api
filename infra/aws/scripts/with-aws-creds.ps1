# Exporta credenciales temporales del perfil (aws login) al entorno para Terraform.
# No imprime secretos. Uso:
#   . .\infra\aws\scripts\with-aws-creds.ps1
#   terraform plan ...
param(
  [string]$Profile = "sports-chaos",
  [string]$Region = "us-east-2"
)

$ErrorActionPreference = "Stop"
$aws = if (Get-Command aws -ErrorAction SilentlyContinue) { "aws" } else {
  (Resolve-Path (Join-Path $PSScriptRoot "..\.tools\aws-cli\Amazon\AWSCLIV2\aws.exe")).Path
}

$json = & $aws configure export-credentials --profile $Profile --format process | Out-String
$creds = $json | ConvertFrom-Json
if (-not $creds.AccessKeyId -or -not $creds.SecretAccessKey) {
  throw "No se pudieron exportar credenciales del perfil $Profile. Ejecuta: aws login --profile $Profile"
}

$env:AWS_ACCESS_KEY_ID = $creds.AccessKeyId
$env:AWS_SECRET_ACCESS_KEY = $creds.SecretAccessKey
if ($creds.SessionToken) { $env:AWS_SESSION_TOKEN = $creds.SessionToken }
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region
# Evitar que el provider intente refrescar el perfil login de forma incompatible
Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
Remove-Item Env:AWS_DEFAULT_PROFILE -ErrorAction SilentlyContinue

Write-Host "Credenciales temporales cargadas para Terraform (perfil origen=$Profile, region=$Region)."
if ($creds.Expiration) { Write-Host "Expiration: $($creds.Expiration)" }
