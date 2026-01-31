param(
  [ValidateSet('Debug','Release')]
  [string]$Configuration = 'Debug',

  [ValidateSet('x86_64-pc-windows-msvc','aarch64-pc-windows-msvc')]
  [string]$Target = 'x86_64-pc-windows-msvc'
)

$ErrorActionPreference = 'Stop'

function Get-CargoPath {
  $cmd = Get-Command cargo -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }

  $fallback = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
  if (Test-Path $fallback) { return $fallback }

  throw "cargo not found. Install Rust via rustup and ensure cargo is on PATH."
}

function Get-VSInstallPath {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
  if (!(Test-Path $vswhere)) { return $null }
  $p = & $vswhere -latest -products * -property installationPath
  if ($LASTEXITCODE -ne 0) { return $null }
  if (!$p) { return $null }
  return $p.Trim()
}

function Try-SetupMsvcEnv([string]$TargetTriple) {
  $arch = if ($TargetTriple -like 'aarch64-*') { 'arm64' } else { 'x64' }

  $vs = Get-VSInstallPath
  if (!$vs) {
    Write-Host "VS not found via vswhere; continuing without MSVC env." -ForegroundColor Yellow
    return
  }

  $msvcRoot = Join-Path $vs 'VC\Tools\MSVC'
  if (!(Test-Path $msvcRoot)) {
    Write-Host "MSVC tools not found under $msvcRoot; continuing without MSVC env." -ForegroundColor Yellow
    return
  }

  $toolset = Get-ChildItem $msvcRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
  if (!$toolset) {
    Write-Host "No MSVC toolset versions found under $msvcRoot; continuing without MSVC env." -ForegroundColor Yellow
    return
  }

  $msvcBin = Join-Path $toolset.FullName ("bin\\HostX64\\$arch")
  $msvcLib = Join-Path $toolset.FullName ("lib\\onecore\\$arch")

  $sdkLibRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Lib'
  $sdkVer = $null
  if (Test-Path $sdkLibRoot) {
    $sdkVer = Get-ChildItem $sdkLibRoot -Directory | Sort-Object Name -Descending | Select-Object -First 1
  }

  if (!(Test-Path $msvcBin) -or !(Test-Path $msvcLib) -or !$sdkVer) {
    Write-Host "MSVC/SDK env incomplete; continuing without MSVC env." -ForegroundColor Yellow
    return
  }

  $ucrtLib = Join-Path $sdkVer.FullName ("ucrt\\$arch")
  $umLib = Join-Path $sdkVer.FullName ("um\\$arch")

  if (!(Test-Path $ucrtLib) -or !(Test-Path $umLib)) {
    Write-Host "Windows SDK libs not found for $arch; continuing without MSVC env." -ForegroundColor Yellow
    return
  }

  # Ensure rustc finds the correct link.exe (avoid Git's /usr/bin/link.exe) and the CRT/SDK libs.
  $env:Path = "$msvcBin;" + $env:Path
  $env:LIB = "$msvcLib;$ucrtLib;$umLib;" + $env:LIB
}

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$CrateDir = Join-Path $RepoRoot 'crates\emwaver-buffer-windows-ffi'
$OutDir = Join-Path $RepoRoot 'windows\EMWaver\Native'

if (!(Test-Path $CrateDir)) {
  throw "Missing crate dir: $CrateDir"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$cargo = Get-CargoPath
Try-SetupMsvcEnv $Target

# If rustup was installed but PATH wasn't refreshed, still ensure cargo can be found by child processes.
$cargoDir = Split-Path -Parent $cargo
if ($cargoDir -and (Test-Path $cargoDir)) {
  $env:Path = "$cargoDir;" + $env:Path
}

Push-Location $CrateDir
try {
  if ($Configuration -eq 'Release') {
    & $cargo build --release --target $Target
    $ProfileDir = 'release'
  } else {
    & $cargo build --target $Target
    $ProfileDir = 'debug'
  }

  $DllPath = Join-Path $CrateDir "target\$Target\$ProfileDir\emwaver_buffer_windows.dll"
  if (!(Test-Path $DllPath)) {
    throw "Expected DLL not found: $DllPath"
  }

  Copy-Item -Force $DllPath (Join-Path $OutDir 'emwaver_buffer_windows.dll')
  Write-Host "Wrote: $(Join-Path $OutDir 'emwaver_buffer_windows.dll')"
}
finally {
  Pop-Location
}
