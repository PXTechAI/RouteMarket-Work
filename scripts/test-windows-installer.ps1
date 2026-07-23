param(
  [Parameter(Mandatory = $true)]
  [string]$CurrentInstaller,

  [string]$PreviousInstaller,

  [Parameter(Mandatory = $true)]
  [switch]$ConfirmDisposableVm
)

$ErrorActionPreference = "Stop"

if (-not $ConfirmDisposableVm) {
  throw "This regression test may install and uninstall RouteMarket Work. Run it only in a disposable VM with -ConfirmDisposableVm."
}

function Resolve-RequiredFile([string]$Path, [string]$Label) {
  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction Stop
  if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
    throw "$Label is not a file: $resolved"
  }
  return $resolved.Path
}

function Assert-Signed([string]$Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne "Valid") {
    throw "Installer signature is not valid: $Path ($($signature.Status))"
  }
}

function Install-RouteMarket([string]$Installer, [string]$InstallDirectory) {
  $process = Start-Process `
    -FilePath $Installer `
    -ArgumentList @("/S", "/D=$InstallDirectory") `
    -Wait `
    -PassThru `
    -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "Installer failed with exit code $($process.ExitCode): $Installer"
  }
}

$current = Resolve-RequiredFile $CurrentInstaller "Current installer"
$previous = if ($PreviousInstaller) {
  Resolve-RequiredFile $PreviousInstaller "Previous installer"
} else {
  $null
}

Assert-Signed $current
if ($previous) {
  Assert-Signed $previous
}

$testRoot = Join-Path $env:TEMP "routemarket-installer-regression"
$installDirectory = Join-Path $testRoot "application"
$projectDirectory = Join-Path $testRoot "external-project"
$projectProbe = Join-Path $projectDirectory "must-survive-uninstall.txt"
$dataDirectory = Join-Path $env:APPDATA "RouteMarket Work\worker"
$dataProbe = Join-Path $dataDirectory "must-survive-upgrade-and-uninstall.txt"

New-Item -ItemType Directory -Path $projectDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
Set-Content -LiteralPath $projectProbe -Value "external project data" -Encoding UTF8
Set-Content -LiteralPath $dataProbe -Value "local migration probe" -Encoding UTF8

if ($previous) {
  Install-RouteMarket $previous $installDirectory
}
Install-RouteMarket $current $installDirectory

$application = Join-Path $installDirectory "RouteMarket Work.exe"
if (-not (Test-Path -LiteralPath $application -PathType Leaf)) {
  throw "Installed application is missing: $application"
}
if (-not (Test-Path -LiteralPath $dataProbe -PathType Leaf)) {
  throw "Local data did not survive the coverage upgrade."
}

$uninstaller = Join-Path $installDirectory "Uninstall RouteMarket Work.exe"
if (-not (Test-Path -LiteralPath $uninstaller -PathType Leaf)) {
  throw "Uninstaller is missing: $uninstaller"
}
$uninstall = Start-Process `
  -FilePath $uninstaller `
  -ArgumentList @("/S") `
  -Wait `
  -PassThru `
  -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) {
  throw "Uninstaller failed with exit code $($uninstall.ExitCode)."
}

if (-not (Test-Path -LiteralPath $projectProbe -PathType Leaf)) {
  throw "Uninstall removed an external project file."
}
if (-not (Test-Path -LiteralPath $dataProbe -PathType Leaf)) {
  throw "Uninstall removed RouteMarket Work local data."
}

Write-Output (@{
  ok = $true
  currentInstaller = $current
  previousInstaller = $previous
  externalProjectPreserved = $true
  localDataPreserved = $true
} | ConvertTo-Json -Compress)
