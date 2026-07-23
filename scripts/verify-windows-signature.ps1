param(
  [Parameter(Mandatory = $true)]
  [string]$ArtifactDirectory,

  [ValidateSet("x64", "arm64")]
  [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"
$desktopPackagePath = Join-Path $PSScriptRoot "..\apps\desktop\package.json"
$desktopPackage = Get-Content -LiteralPath $desktopPackagePath -Raw | ConvertFrom-Json
$artifactName = "RouteMarket Work-Setup-$($desktopPackage.version)-$Arch.exe"
$artifactPath = Join-Path (Resolve-Path -LiteralPath $ArtifactDirectory) $artifactName

if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
  throw "Windows installer is missing: $artifactPath"
}

$signature = Get-AuthenticodeSignature -LiteralPath $artifactPath
if ($signature.Status -ne "Valid" -or -not $signature.SignerCertificate) {
  throw "Windows installer signature is not valid: $artifactPath ($($signature.Status))"
}

Write-Output (@{
  ok = $true
  artifactPath = $artifactPath
  subject = $signature.SignerCertificate.Subject
  thumbprint = $signature.SignerCertificate.Thumbprint
} | ConvertTo-Json -Compress)
