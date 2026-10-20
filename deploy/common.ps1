# Shared helpers for install.ps1, update.ps1 and uninstall.ps1. Dot-sourced, not run directly.
#
# Every change goes through Invoke-Change, which honours -WhatIf: with -WhatIf it only prints
# "What if: ..." and changes nothing. Read-only checks (Node version, git status, service state)
# always run, so -WhatIf also tells you whether the real run would succeed.
#
# Windows PowerShell 5.1 compatible. Keep this file ASCII: 5.1 reads BOM-less files as ANSI.

Set-StrictMode -Version 3.0
$ErrorActionPreference = 'Stop'

# WinSW: the Windows service wrapper (https://github.com/winsw/winsw, MIT). Pinned and verified.
$script:WinSwVersion = 'v2.12.0'
$script:WinSwUrl = "https://github.com/winsw/winsw/releases/download/$script:WinSwVersion/WinSW-x64.exe"
$script:WinSwSha256 = '05B82D46AD331CC16BDC00DE5C6332C1EF818DF8CEEFCD49C726553209B3A0DA'
$script:MinNodeMajor = 22

function Write-Step([string] $Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Note([string] $Message) {
    Write-Host "    $Message"
}

<#
  Run $Action unless -WhatIf is on. $Description says what would happen, in plain words.
#>
function Invoke-Change {
    [CmdletBinding(SupportsShouldProcess = $true)]
    param(
        [Parameter(Mandatory = $true)][string] $Description,
        [Parameter(Mandatory = $true)][scriptblock] $Action
    )
    if ($PSCmdlet.ShouldProcess($Description, 'Run')) {
        & $Action
    }
}

<# Run a native command and fail on a non-zero exit code. #>
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string] $FilePath,
        [string[]] $Arguments = @(),
        [string] $WorkingDirectory = (Get-Location).Path
    )
    Push-Location $WorkingDirectory
    try {
        # To the console, not the pipeline: functions here return values.
        & $FilePath @Arguments | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "'$FilePath $($Arguments -join ' ')' failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

function Test-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return (New-Object Security.Principal.WindowsPrincipal $identity).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

<#
  A problem that stops the real run. Under -WhatIf it is only a warning, so a dry run on a
  machine where nothing is installed yet still shows every later step.
#>
function Stop-Run([string] $Message) {
    if ($WhatIfPreference) {
        Write-Warning "$Message (the real run would stop here; -WhatIf carries on to show the rest)"
        return
    }
    throw $Message
}

<# Installing or changing a service needs an elevated prompt; -WhatIf does not. #>
function Assert-Administrator {
    if (Test-Administrator) { return }
    if ($WhatIfPreference) {
        Write-Warning 'Not running as Administrator. Fine for -WhatIf; the real run needs an elevated PowerShell.'
        return
    }
    throw 'Run this from an elevated PowerShell (Run as Administrator).'
}

<# Node >= 22 on PATH. Returns the full path to node.exe. #>
function Assert-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        throw "Node.js is not installed (or not on PATH). Install Node $script:MinNodeMajor LTS or newer from https://nodejs.org."
    }
    $version = (& $node.Source --version).Trim()
    $major = [int]($version.TrimStart('v').Split('.')[0])
    if ($major -lt $script:MinNodeMajor) {
        throw "Node $version is too old: MBAL BI needs Node $script:MinNodeMajor or newer."
    }
    Write-Note "Node $version at $($node.Source)"
    return $node.Source
}

function Get-NpmPath {
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npm) { throw 'npm is not on PATH (it ships with Node.js).' }
    return $npm.Source
}

function Get-GitPath {
    $git = Get-Command git -ErrorAction SilentlyContinue
    if (-not $git) { throw 'git is not installed (or not on PATH). Install Git for Windows.' }
    return $git.Source
}

<# The paths everything else uses, all under -InstallDir. #>
function Get-Layout([string] $InstallDir, [string] $ServiceName) {
    return [pscustomobject]@{
        InstallDir = $InstallDir
        Releases   = Join-Path $InstallDir 'releases'
        Logs       = Join-Path $InstallDir 'logs'
        ServiceDir = Join-Path $InstallDir 'service'
        WinSwExe   = Join-Path (Join-Path $InstallDir 'service') "$ServiceName.exe"
        WinSwXml   = Join-Path (Join-Path $InstallDir 'service') "$ServiceName.xml"
        EnvFile    = Join-Path $InstallDir '.env.production.local'
    }
}

<#
  The release the service runs, from its WinSW config, or $null. The service runs straight from
  releases\<commit> (no junction), so `next start` runs from the very directory it was built in.
#>
function Get-CurrentRelease($Layout) {
    if (-not (Test-Path $Layout.WinSwXml)) { return $null }
    [xml] $xml = Get-Content -Raw $Layout.WinSwXml
    return [string]$xml.service.workingdirectory
}

<# Make the service run $Release from its next start. WinSW reads its config on every start. #>
function Set-CurrentRelease($Layout, [string] $Release) {
    Invoke-Change -Description "Point the service config at $Release" -Action {
        [xml] $xml = Get-Content -Raw $Layout.WinSwXml
        $xml.service.workingdirectory = $Release
        $xml.Save($Layout.WinSwXml)
    }
}

<#
  Check out $Commit of the source repository into releases\<commit> as a detached git worktree,
  then `npm ci` and `npm run build` there. The running service is never touched. Returns the
  release path. On failure the half-built release is removed and the error rethrown.
#>
function New-Release($Layout, [string] $SourceDir, [string] $Commit) {
    $git = Get-GitPath
    $npm = Get-NpmPath
    $release = Join-Path $Layout.Releases $Commit
    if (Test-Path $release) {
        Write-Note "Release $Commit already exists; rebuilding it."
    }
    Invoke-Change -Description "Check out commit $Commit into $release (git worktree)" -Action {
        if (-not (Test-Path $release)) {
            Invoke-Native $git @('-C', $SourceDir, 'worktree', 'add', '--detach', $release, $Commit)
        }
    }
    Invoke-Change -Description "npm ci and npm run build in $release" -Action {
        try {
            $env:NEXT_TELEMETRY_DISABLED = '1'
            Invoke-Native $npm @('ci', '--no-audit', '--no-fund') -WorkingDirectory $release
            Invoke-Native $npm @('run', 'build') -WorkingDirectory $release
        }
        catch {
            Write-Warning "Build of $Commit failed; removing it. Nothing else was changed."
            Remove-Release $Layout $SourceDir $release
            throw
        }
    }
    return $release
}

function Remove-Release($Layout, [string] $SourceDir, [string] $Release) {
    $git = Get-GitPath
    Invoke-Change -Description "Remove release $Release" -Action {
        # Best effort: in Windows PowerShell a native command writing to stderr is an error
        # under ErrorActionPreference=Stop, and git may complain about a half-made worktree.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & $git -C $SourceDir worktree remove --force $Release 2>&1 | Out-Null
            if (Test-Path $Release) { Remove-Item -Recurse -Force $Release }
            & $git -C $SourceDir worktree prune 2>&1 | Out-Null
        }
        finally {
            $ErrorActionPreference = $previous
        }
    }
}

<# Wait until /api/health answers at all (200, or 503 when only Orion is down). #>
function Wait-Healthy([int] $Port, [int] $TimeoutSeconds = 90) {
    if ($WhatIfPreference) {
        Write-Note "Would wait up to $TimeoutSeconds s for http://127.0.0.1:$Port/api/health"
        return $true
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "http://127.0.0.1:$Port/api/health"
            Write-Note "Health: $($response.StatusCode) $($response.Content)"
            return $true
        }
        catch [System.Net.WebException] {
            $status = $_.Exception.Response
            if ($status -and [int]$status.StatusCode -eq 503) {
                Write-Warning 'The app is up, but Orion does not answer (503). Check ORACLE_DSN and the network.'
                return $true
            }
        }
        Start-Sleep -Seconds 3
    }
    return $false
}

function Get-ServiceOrNull([string] $ServiceName) {
    return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

<# The port the installed service listens on, read back from its WinSW config. #>
function Get-ServicePort($Layout) {
    if (-not (Test-Path $Layout.WinSwXml)) { return $null }
    [xml] $xml = Get-Content $Layout.WinSwXml
    $port = $xml.service.env | Where-Object { $_.name -eq 'PORT' } | Select-Object -First 1
    if ($port) { return [int]$port.value }
    return $null
}
