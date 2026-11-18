# Preflight de herramientas para el laboratorio AWS (solo lectura).
$ErrorActionPreference = "Continue"
Write-Host "=== Preflight AWS tools ==="

function Show-Cmd($Name) {
  $c = Get-Command $Name -ErrorAction SilentlyContinue
  if ($c) {
    Write-Host "OK  $Name -> $($c.Source)"
    return $true
  }
  Write-Host "MISSING $Name"
  return $false
}

$portableAws = Join-Path $PSScriptRoot "..\.tools\aws-cli\Amazon\AWSCLIV2\aws.exe"
$awsCmd = $null
if (Get-Command "aws" -ErrorAction SilentlyContinue) {
  $awsCmd = "aws"
  Write-Host "OK  aws (PATH)"
} elseif (Test-Path $portableAws) {
  $awsCmd = (Resolve-Path $portableAws).Path
  Write-Host "OK  aws (portable) -> $awsCmd"
} else {
  Write-Host "MISSING aws (instalar MSI o expandir ZIP en infra/aws/.tools)"
}
$okAws = $null -ne $awsCmd
$okTf = Show-Cmd "terraform"
$okKubectl = Show-Cmd "kubectl"
Show-Cmd "ssh" | Out-Null
Show-Cmd "curl" | Out-Null
Show-Cmd "docker" | Out-Null
Show-Cmd "k6" | Out-Null

if ($okAws) {
  Write-Host "`n--- aws sts get-caller-identity (no secrets) ---"
  & $awsCmd sts get-caller-identity --output json 2>&1 | ForEach-Object {
    if ($_ -match 'Secret|AccessKey|SessionToken') { return }
    $_
  }
  Write-Host "`n--- aws configure list (masked) ---"
  & $awsCmd configure list 2>&1
  Write-Host "`n--- region ---"
  $region = $env:AWS_REGION
  if (-not $region) { $region = $env:AWS_DEFAULT_REGION }
  if (-not $region) {
    try { $region = (& $awsCmd configure get region 2>$null) } catch { $region = "" }
  }
  if (-not $region) { $region = "(no configurada; Terraform default us-east-2)" }
  Write-Host "region=$region"

  Write-Host "`n--- EC2 instancias etiquetadas sports (readonly) ---"
  & $awsCmd ec2 describe-instances `
    --filters "Name=tag:Project,Values=sports-tournaments-api" "Name=instance-state-name,Values=pending,running,stopping,stopped" `
    --query "Reservations[].Instances[].{Id:InstanceId,Type:InstanceType,State:State.Name,Name:Tags[?Key=='Name']|[0].Value}" `
    --output table 2>&1
}

if ($okTf) {
  Write-Host "`n--- terraform version ---"
  terraform version
}

if ($okKubectl) {
  Write-Host "`n--- kubectl version (client) ---"
  kubectl version --client --output=yaml 2>&1 | Select-Object -First 20
}

Write-Host "`n=== Fin preflight ==="
if (-not ($okAws -and $okTf)) {
  Write-Host "BLOQUEO: faltan aws y/o terraform para plan/apply."
  exit 2
}
exit 0
