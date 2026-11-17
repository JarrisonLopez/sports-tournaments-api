# fmt + init + validate + plan (NUNCA apply). Windows-friendly.
$ErrorActionPreference = "Stop"
$tfDir = Resolve-Path (Join-Path $PSScriptRoot "..\terraform")
Set-Location $tfDir

# Credenciales temporales desde aws login (perfil sports-chaos)
$credScript = Join-Path $PSScriptRoot "with-aws-creds.ps1"
if (Test-Path $credScript) {
  . $credScript -Profile sports-chaos -Region us-east-2
}

$rc = Join-Path $tfDir "terraform.rc.lab"
if (Test-Path $rc) {
  $env:TF_CLI_CONFIG_FILE = $rc
  Write-Host "Using TF_CLI_CONFIG_FILE=$rc"
}

Write-Host "== terraform fmt =="
terraform fmt -recursive

if (-not (Test-Path (Join-Path $tfDir ".terraform"))) {
  Write-Host "== terraform init =="
  terraform init -input=false
} else {
  Write-Host "== terraform init (reconfigure if needed) =="
  terraform init -input=false
}

Write-Host "== terraform validate =="
terraform validate

$planVars = Join-Path $tfDir "terraform.tfvars"
$tmpVars = Join-Path $tfDir "terraform.tfvars.plancheck"
if (-not (Test-Path $planVars)) {
  @"
aws_region         = "us-east-2"
aws_profile        = "sports-chaos"
environment        = "lab"
project_name       = "sports-chaos"
instance_type      = "t3.medium"
ssh_ingress_cidr   = "127.0.0.1/32"
api_ingress_cidr   = "0.0.0.0/0"
key_name           = "sports-chaos-k3s"
create_elastic_ip  = true
"@ | Set-Content -Path $tmpVars -Encoding ascii
  Write-Host "AVISO: sin terraform.tfvars; usando placeholders en $tmpVars"
  $varFile = $tmpVars
} else {
  $varFile = $planVars
}

Write-Host "== terraform plan =="
terraform plan -input=false -var-file="$varFile" -out="tfplan-lab.bin"
Write-Host "terraform-check OK (sin apply)"
