# Crea un EC2 key pair en us-east-2. La clave privada NO va a Git.
# Uso:
#   $env:AWS_PROFILE = "sports-chaos"
#   $env:AWS_REGION = "us-east-2"
#   .\infra\aws\scripts\create-keypair.ps1
# Opcional: -KeyName sports-chaos-k3s -OutDir $env:USERPROFILE\.ssh
param(
  [string]$KeyName = "sports-chaos-k3s",
  [string]$OutDir = (Join-Path $env:USERPROFILE ".ssh"),
  [string]$Region = "us-east-2",
  [string]$Profile = "sports-chaos"
)

$ErrorActionPreference = "Stop"
$env:AWS_PROFILE = $Profile
$env:AWS_REGION = $Region
$env:AWS_DEFAULT_REGION = $Region

$aws = if (Get-Command aws -ErrorAction SilentlyContinue) { "aws" } else {
  (Resolve-Path (Join-Path $PSScriptRoot "..\.tools\aws-cli\Amazon\AWSCLIV2\aws.exe")).Path
}

$ErrorActionPreference = "Continue"
$existingJson = & $aws ec2 describe-key-pairs --key-names $KeyName --output json 2>$null
if ($LASTEXITCODE -eq 0 -and $existingJson) {
  Write-Host "Key pair '$KeyName' ya existe en $Region. No se regenera (AWS no reexpone el .pem)."
  Write-Host "Si perdiste el .pem, elimina el key pair en consola y vuelve a ejecutar este script."
  exit 0
}
$ErrorActionPreference = "Stop"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$pemPath = Join-Path $OutDir "$KeyName.pem"
if (Test-Path $pemPath) {
  throw "Ya existe $pemPath — muévelo o bórralo antes de crear un key pair nuevo con el mismo nombre de archivo."
}

Write-Host "Creando key pair $KeyName en $Region..."
$json = & $aws ec2 create-key-pair --key-name $KeyName --key-type rsa --key-format pem --output json
$material = ($json | ConvertFrom-Json).KeyMaterial
if (-not $material) { throw "create-key-pair no devolvió KeyMaterial" }

# Guardar solo fuera del repo; ACL restrictivo en Windows
Set-Content -Path $pemPath -Value $material -Encoding ascii -NoNewline
icacls $pemPath /inheritance:r | Out-Null
icacls $pemPath /grant:r "$($env:USERNAME):(R)" | Out-Null

Write-Host "OK key pair AWS: $KeyName"
Write-Host "PEM privado: $pemPath"
Write-Host "Añade a terraform.tfvars: key_name = `"$KeyName`""
Write-Host "Nunca commits del .pem ni del KeyMaterial."
