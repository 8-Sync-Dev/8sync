<#
.SYNOPSIS
    Set up Claude Code settings from JSON via `8sync harness claude-code`.
.DESCRIPTION
    Mirrors scripts/setup-claude-key.sh: passes the JSON (or a file path to it)
    straight to `8sync harness claude-code`. That command enforces the base-URL
    allowlist and the Console-key rule, and merges settings without wiping the kit.
    This script writes nothing itself and sets no environment variables.
.EXAMPLE
    .\scripts\setup-claude-key.ps1 '{"env":{"ANTHROPIC_BASE_URL":"https://api.anthropic.com","ANTHROPIC_API_KEY":"<console-api-key>"}}'
#>
# Plain (non-advanced) script so `$input` holds the whole pipeline,
# e.g. `Get-Content settings.json | .\scripts\setup-claude-key.ps1`.
param(
    [Parameter(Position=0)]
    [string]$ConfigJson
)

$ErrorActionPreference = "Stop"

if (-not $ConfigJson -and $input) {
    $ConfigJson = ($input | Out-String)
}

if (-not $ConfigJson) {
    Write-Host "Please paste your Claude Code settings JSON (end with Enter):" -ForegroundColor Cyan
    $ConfigJson = Read-Host
}

if ($ConfigJson -and (Test-Path -LiteralPath $ConfigJson -PathType Leaf -ErrorAction SilentlyContinue)) {
    $ConfigJson = Get-Content -Raw -Path $ConfigJson
}

if (-not (Get-Command 8sync -ErrorAction SilentlyContinue)) {
    Write-Error "8sync not found in PATH. Install it first, then re-run."
    exit 1
}

# JSON on stdin: PS 5.1 mangles embedded quotes in native-exe arguments,
# and stdin keeps the token out of the process list.
$ConfigJson | & 8sync harness claude-code
exit $LASTEXITCODE
