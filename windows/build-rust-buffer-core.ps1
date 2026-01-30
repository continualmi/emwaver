param(
  [ValidateSet('Debug','Release')]
  [string]$Configuration = 'Debug',

  [ValidateSet('x86_64-pc-windows-msvc','aarch64-pc-windows-msvc')]
  [string]$Target = 'x86_64-pc-windows-msvc'
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path "$PSScriptRoot\..").Path
$CrateDir = Join-Path $RepoRoot 'crates\emwaver-buffer-windows-ffi'
$OutDir = Join-Path $RepoRoot 'windows\EMWaver\Native'

if (!(Test-Path $CrateDir)) {
  throw "Missing crate dir: $CrateDir"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Push-Location $CrateDir
try {
  if ($Configuration -eq 'Release') {
    cargo build --release --target $Target
    $ProfileDir = 'release'
  } else {
    cargo build --target $Target
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
