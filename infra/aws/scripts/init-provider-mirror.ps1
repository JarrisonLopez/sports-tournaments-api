# Descarga el provider hashicorp/aws por IPv4 (evita fallos IPv6 del registry).
$ErrorActionPreference = "Stop"
$ver = if ($env:AWS_PROVIDER_VERSION) { $env:AWS_PROVIDER_VERSION } else { "5.100.0" }
$tfDir = Resolve-Path (Join-Path $PSScriptRoot "..\terraform")
$mirror = Join-Path $tfDir ".provider-mirror\registry.terraform.io\hashicorp\aws\$ver\windows_amd64"
New-Item -ItemType Directory -Force -Path $mirror | Out-Null
$zip = Join-Path $env:TEMP "terraform-provider-aws_$ver.zip"
Write-Host "Downloading hashicorp/aws $ver (IPv4)..."
curl.exe -4 -L --retry 3 --connect-timeout 30 -o $zip `
  "https://releases.hashicorp.com/terraform-provider-aws/$ver/terraform-provider-aws_${ver}_windows_amd64.zip"
Expand-Archive -Path $zip -DestinationPath $mirror -Force

$mirrorPosix = ($tfDir.Path -replace '\\', '/')
$rc = @"
provider_installation {
  filesystem_mirror {
    path    = "$mirrorPosix/.provider-mirror"
    include = ["registry.terraform.io/hashicorp/aws"]
  }
  direct {
    exclude = ["registry.terraform.io/hashicorp/aws"]
  }
}
"@
$rcPath = Join-Path $tfDir "terraform.rc.lab"
Set-Content -Path $rcPath -Value $rc -Encoding ascii
Write-Host "Wrote $rcPath"
Write-Host "Usar: `$env:TF_CLI_CONFIG_FILE = '$rcPath'; terraform init"
