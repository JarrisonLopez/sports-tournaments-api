<#
.SYNOPSIS
  Verifica conectividad TCP/TLS hacia el Collector OCI (sin credenciales inventadas).
#>
param(
  [string]$SshHost = "ec2-user@3.21.120.51",
  [string]$PemPath = "$env:USERPROFILE\.ssh\sports-chaos-k3s.pem",
  [string]$CollectorIp = "157.137.233.183",
  [int]$CollectorPort = 31443,
  [string]$EvidenceDir = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$remoteScript = Join-Path $PSScriptRoot "remote-verify-oci-collector.sh"
if (-not (Test-Path -LiteralPath $remoteScript)) {
  throw "Falta $remoteScript"
}

$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=20", "-i", $PemPath, $SshHost)
scp @("-o", "StrictHostKeyChecking=no", "-i", $PemPath, $remoteScript, "${SshHost}:/tmp/remote-verify-oci-collector.sh")
$out = & ssh @sshArgs "COLLECTOR_IP='$CollectorIp' COLLECTOR_PORT='$CollectorPort' bash /tmp/remote-verify-oci-collector.sh"
$out

if ($EvidenceDir) {
  New-Item -ItemType Directory -Force -Path $EvidenceDir | Out-Null
  $out | Out-File (Join-Path $EvidenceDir "01-collector-connectivity.txt") -Encoding utf8
}
