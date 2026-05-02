param(
    [string]$GatewayPort = "3921",
    [string]$ScriptName = "blink.emw",
    [switch]$SkipBuild,
    [switch]$Ci
)

$ErrorActionPreference = "Stop"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)]
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath failed with exit code $LASTEXITCODE"
    }
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$WindowsDir = Join-Path $RepoRoot "windows"
$Solution = Join-Path $WindowsDir "EMWaver.sln"
$TestsProject = Join-Path $WindowsDir "EMWaver.Tests\EMWaver.Tests.csproj"

Write-Host "== EMWaver rebirth Windows validation =="
Write-Host "repo: $RepoRoot"
Write-Host "solution: $Solution"
Write-Host ""

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw "dotnet was not found. Install the .NET SDK required by windows/EMWaver/EMWaver.csproj."
}

Invoke-Checked dotnet @("--info")

if (-not $SkipBuild) {
    Write-Host ""
    Write-Host "== Restore Windows app =="
    Invoke-Checked dotnet @("restore", $Solution)

    Write-Host ""
    Write-Host "== Build Windows app =="
    Invoke-Checked dotnet @("build", $Solution, "-c", "Debug", "-p:Platform=x64", "--no-restore")
}

Write-Host ""
Write-Host "== Windows simulator tests =="
Invoke-Checked dotnet @("test", $TestsProject, "-c", "Debug", "-p:Platform=x64", "--no-build", "--logger", "console;verbosity=normal")

if ($Ci) {
    Write-Host ""
    Write-Host "== Hosted CI scope =="
    Write-Host "Windows restore/build and simulator tests completed. Hosted GitHub runners do not validate attached EMWaver USB/MIDI hardware or interactive local gateway control."
    return
}

Write-Host ""
Write-Host "== Local gateway app-role validation =="
Write-Host "1. Start the EMWaver Windows app from Visual Studio or the Debug build output."
Write-Host "2. In a separate shell from repo root, start the gateway:"
Write-Host "   emwaver gateway --port $GatewayPort"
Write-Host "3. Confirm the Windows app connects to ws://127.0.0.1:$GatewayPort/v1/ws as role=app."
Write-Host "4. Open http://127.0.0.1:$GatewayPort and run $ScriptName."
Write-Host "5. Confirm the gateway receives hello.ack, device.status, script.started, and ui.snapshot."

Write-Host ""
Write-Host "== Hardware validation =="
Write-Host "1. Connect a supported EMWaver board over USB."
Write-Host "2. Confirm the Windows app Device page shows the board without requiring account sign-in."
Write-Host "3. Run $ScriptName from the gateway and verify the board performs the expected hardware action."
Write-Host "4. Record the result in TESTS_REBIRTH.md under Platform Device Access."

Write-Host ""
Write-Host "Windows validation runbook complete. Manual app/gateway/hardware checks remain user-observed."
