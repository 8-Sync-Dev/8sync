<#
.SYNOPSIS
  8sync standalone installer for Windows (PowerShell).

.DESCRIPTION
  Downloads the prebuilt `8sync.exe` binary from GitHub Releases — no git clone,
  no Rust toolchain, no cargo build. Ideal for a fresh machine or quick upgrade.

  One-liner:
    irm https://get.8syncdev.com/install.ps1 | iex

  After the binary lands, the installer runs `8sync setup --no-profile`: the AI
  harness (gh, omp, forge + zsh, configs, skills, `harness global`).

  Upgrade:   re-run the same command (atomically replaces the old binary).
  Uninstall: download the script and run:  .\install.ps1 -Uninstall

.PARAMETER Uninstall
  Remove the installed 8sync.exe and exit.

.NOTES
  Environment:
    SUSYNC_VERSION   release tag to install (default: latest, e.g. v0.12.1)
    SUSYNC_BIN_DIR   install location (default: %LOCALAPPDATA%\Programs\8sync)
    SUSYNC_NO_SETUP  set to 1 to install the binary only (skip `8sync setup`)
#>
param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$Repo = '8-Sync-Dev/8sync'
$BinDir = if ($env:SUSYNC_BIN_DIR) { $env:SUSYNC_BIN_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs\8sync' }
$BinName = '8sync.exe'
$BinPath = Join-Path $BinDir $BinName

# --- helpers ---------------------------------------------------------------

# Pull the Location header off a response object (or an exception's .Response),
# coping with the different shapes across Windows PowerShell 5.1 and PS 7+.
function Get-HeaderLocation($obj) {
    if ($null -eq $obj) { return $null }
    try {
        $h = $obj.Headers
        if ($h) {
            # Typed property (HttpResponseHeaders / WebHeaderCollection).
            try { if ($h.Location) { return $h.Location.ToString() } } catch {}
            # Dictionary-style indexer (BasicHtmlWebResponseObject).
            try {
                $v = $h['Location']
                if ($v) { return ($v | Select-Object -First 1).ToString() }
            } catch {}
        }
    } catch {}
    return $null
}

# Resolve the latest release tag.
#
# Prefer the releases/latest *web* redirect over the GitHub API: the
# unauthenticated API is rate-limited to 60 req/hour per IP (403 once
# exhausted, routine on shared CI runners and office NAT). The redirect
# (github.com/<repo>/releases/latest -> .../releases/tag/vX.Y.Z) is not.
# HttpWebRequest with AllowAutoRedirect off returns the 302 itself on both
# Windows PowerShell 5.1 and PS 7; `Invoke-WebRequest -MaximumRedirection 0`
# throws on 5.1 without the response, which silently left only the API path.
function Get-LatestVersion {
    $latestUrl = "https://github.com/$Repo/releases/latest"
    $loc = $null
    try {
        $req = [System.Net.HttpWebRequest]::Create($latestUrl)
        $req.AllowAutoRedirect = $false
        $req.Method = 'HEAD'
        $req.UserAgent = '8sync-installer'
        $resp = $req.GetResponse()
        $loc = $resp.Headers['Location']
        $resp.Close()
    } catch {
        $loc = Get-HeaderLocation $_.Exception.InnerException.Response
    }
    if ($loc -and $loc -match '/releases/tag/([^/?#]+)') {
        return $matches[1].Trim()
    }
    # Fallback: GitHub API (needs a User-Agent or it 403s).
    try {
        $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
        $tag = (Invoke-RestMethod -Uri $apiUrl -UseBasicParsing -Headers @{ 'User-Agent' = '8sync-installer' }).tag_name
        if ($tag) { return $tag }
    } catch {}
    return $null
}

# Detect the machine architecture and map it onto the release asset labels
# (.github/workflows/release.yml names assets 8sync-<tag>-<os>-<arch>[.exe]).
#
# PROCESSOR_ARCHITEW6432 is set only inside a 32-bit process on a 64-bit OS,
# where PROCESSOR_ARCHITECTURE describes the *process* ('x86') rather than the
# machine -- precisely the case that would otherwise mis-target an ARM64 box.
function Get-TargetArch {
    $raw = $env:PROCESSOR_ARCHITEW6432
    if (-not $raw) { $raw = $env:PROCESSOR_ARCHITECTURE }
    if (-not $raw) {
        try { $raw = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch {}
    }
    if (-not $raw) { return 'unknown' }
    switch -Regex ($raw) {
        '^(AMD64|x64)$' { return 'x86_64' }
        '^ARM64$'       { return 'aarch64' }
        default         { return "$raw".ToLowerInvariant() }
    }
}

# Does this release actually publish the asset? A definite 404 means "no build
# for this target". Anything else (proxy, offline, HEAD refused) is
# inconclusive and must not block -- the download reports the real error then.
function Test-AssetExists($uri) {
    try {
        Invoke-WebRequest -Uri $uri -Method Head -UseBasicParsing -ErrorAction Stop | Out-Null
        return $true
    } catch {
        $code = $null
        try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        if ($code -eq 404) { return $false }
        return $true
    }
}

# Best-effort SHA-256 from the release API's per-asset `digest` ("sha256:<hex>").
# The unauthenticated API is rate-limited to 60 req/hour, so a miss is expected
# and must never fail the install; a *mismatch* is fatal.
function Get-PublishedSha256($assetName) {
    try {
        $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/tags/$version" `
            -UseBasicParsing -Headers @{ 'User-Agent' = '8sync-installer' } -ErrorAction Stop
        $a = $rel.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
        if ($a -and $a.digest -match '^sha256:([0-9a-fA-F]{64})$') { return $matches[1] }
    } catch {}
    return $null
}

# --- uninstall -------------------------------------------------------------

if ($Uninstall) {
    if (Test-Path -LiteralPath $BinPath) {
        Remove-Item -LiteralPath $BinPath -Force
        Write-Host "8sync uninstalled (removed $BinPath)."
    } else {
        Write-Host "8sync not found at $BinPath; nothing to uninstall."
    }
    return
}

# --- resolve version -------------------------------------------------------

# Ensure TLS 1.2 on older Windows PowerShell (5.1 defaults can be too weak).
try {
    [Net.ServicePointManager]::SecurityProtocol = `
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {}

$version = $env:SUSYNC_VERSION
if (-not $version) {
    $version = Get-LatestVersion
}
if (-not $version) {
    throw "8sync: could not resolve latest version; set `$env:SUSYNC_VERSION (e.g. `$env:SUSYNC_VERSION='v0.12.1')."
}
# Release tags are vX.Y.Z; accept a bare X.Y.Z in SUSYNC_VERSION too.
if ($version -notlike 'v*') { $version = "v$version" }

# --- download + install ----------------------------------------------------

$arch = Get-TargetArch
$target = "windows-$arch"
$asset = "8sync-$version-$target.exe"
$url = "https://github.com/$Repo/releases/download/$version/$asset"

# An ARM64 machine must not silently receive the x64 build. If this release
# publishes no asset for the detected target, name the missing target instead
# of installing the wrong binary.
if (-not (Test-AssetExists $url)) {
    throw "8sync: no prebuilt binary for $target in release $version (missing asset: $asset).`nBuild from source instead: https://github.com/$Repo (cargo build --release)."
}

Write-Host "Installing 8sync $version ($target)..."

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

# The temp file is a *sibling* of the destination, not %TEMP%: a move across
# volumes is a copy rather than a rename, which would make a half-written
# binary observable at $BinPath. Mirrors download_and_replace() in
# crates/cli/src/verbs/selfup.rs.
# The leading dot matches selfup.rs's naming, but it makes the file "hidden"
# to the PowerShell provider on Unix-hosted pwsh, so every probe of $tmp needs
# -Force. (On Windows a leading dot sets no hidden attribute; -Force is a
# harmless no-op there.)
$tmp = Join-Path $BinDir (".8sync.new." + $PID)
try {
    Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
} catch {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    throw "8sync: download failed: $url`n$($_.Exception.Message)"
}
if (-not (Test-Path -LiteralPath $tmp) -or (Get-Item -LiteralPath $tmp -Force).Length -eq 0) {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
    throw "8sync: downloaded an empty file from $url"
}

# .NET, not Get-FileHash: Windows PowerShell started from pwsh 7 inherits a
# PSModulePath that loads pwsh's Microsoft.PowerShell.Utility, which hides
# Get-FileHash — and the checksum then silently never ran.
$wantHash = Get-PublishedSha256 $asset
if ($wantHash) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $stream = [System.IO.File]::OpenRead($tmp)
    try { $gotHash = -join ($sha.ComputeHash($stream) | ForEach-Object { $_.ToString('X2') }) }
    finally { $stream.Dispose(); $sha.Dispose() }
    if ($gotHash -ne $wantHash) {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
        throw "8sync: checksum mismatch for $asset - refusing to install.`n  expected sha256:$($wantHash.ToLowerInvariant())`n  actual   sha256:$($gotHash.ToLowerInvariant())"
    }
    Write-Host "  checksum: ok (sha256:$($wantHash.ToLowerInvariant()))"
} else {
    Write-Host "  checksum: skipped (no sha256 digest available for $asset)"
}

# Windows cannot overwrite a running .exe (an open `8sync . <session>` holds it),
# but CAN rename it aside: move the live binary to .8sync.old.<pid>, drop the new
# one in, restore on failure. Mirrors selfup.rs, which also sweeps the leftovers.
Get-ChildItem -LiteralPath $BinDir -Filter '.8sync.old.*' -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue
$old = $null
if (Test-Path -LiteralPath $BinPath) {
    $old = Join-Path $BinDir (".8sync.old." + $PID)
    Move-Item -LiteralPath $BinPath -Destination $old -Force
}
try {
    Move-Item -LiteralPath $tmp -Destination $BinPath -Force
} catch {
    if ($old) { Move-Item -LiteralPath $old -Destination $BinPath -Force -ErrorAction SilentlyContinue }
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    throw "8sync: could not install $BinPath`n$($_.Exception.Message)"
}
if ($old) { Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue }

Write-Host "Installed -> $BinPath"
try { & $BinPath --version } catch {}

# --- PATH ------------------------------------------------------------------

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$segments = @()
if ($userPath) { $segments = $userPath -split ';' | Where-Object { $_ -ne '' } }
$already = $segments | Where-Object { $_.TrimEnd('\') -ieq $BinDir.TrimEnd('\') }
if (-not $already) {
    $newPath = if ($userPath) { "$userPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    # Reflect it in the current session too.
    $env:Path = "$env:Path;$BinDir"
    Write-Host ""
    Write-Host "$BinDir added to your user PATH."
    Write-Host "Restart your shell (or open a new terminal) for the change to take effect."
}

# --- harness setup -----------------------------------------------------------

Write-Host ""
if ($env:SUSYNC_NO_SETUP -eq '1') {
    Write-Host "SUSYNC_NO_SETUP=1 - skipped setup. Run it any time: 8sync setup --no-profile"
} else {
    Write-Host "Running 8sync setup --no-profile (AI harness: omp, forge, skills, MCP)..."
    # Native-command failures must not abort the installer under 'Stop'; setup
    # reports its own per-step summary.
    $ErrorActionPreference = 'Continue'
    & $BinPath setup --no-profile
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Setup finished - the summary above lists any step to retry."
    } else {
        Write-Warning "8sync setup exited with code $LASTEXITCODE - re-run: 8sync setup --no-profile"
    }
    # Installers run by setup (omp, forge) extend the user PATH; pick
    # those up so this window can use them immediately.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine')
}

# --- next steps ------------------------------------------------------------

Write-Host ""
Write-Host "Next steps:"
Write-Host "  8sync doctor             # verify"
Write-Host "  cd <project>; 8sync .    # omp session   |   8sync forge <name>   # Forge zsh session"
Write-Host "  8sync up                 # upgrade later (8sync also notifies when a release is out)"
