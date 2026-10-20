<#
.SYNOPSIS
  Deploy the latest main to the MBAL BI service, or roll back to the previous release.

.DESCRIPTION
  1. `git pull --ff-only origin main` in the source checkout.
  2. Builds the new commit in its own folder, <InstallDir>\releases\<commit> (`npm ci`,
     `npm run build`). The running service is not touched: if the build fails, the previous
     build keeps running and the script stops with an error.
  3. Stops the service, points it at the new release and starts it again (a few seconds of
     downtime), then waits for /api/health. If the new release does not come up, it switches
     back to the previous one automatically.
  4. Keeps the newest -Keep releases and removes older ones.

  -Rollback skips 1-2 and switches back to the release before the current one.
  -WhatIf prints every step it would take and changes nothing.

.EXAMPLE
  .\deploy\update.ps1 -WhatIf
.EXAMPLE
  .\deploy\update.ps1 -Rollback
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $InstallDir = 'C:\MbalBI',
    [string] $ServiceName = 'MbalBi',
    [string] $SourceDir,
    [string] $Branch = 'main',
    # Switch back to the previous release instead of deploying.
    [switch] $Rollback,
    # Rebuild and redeploy even if the service already runs this commit.
    [switch] $Force,
    [ValidateRange(2, 20)][int] $Keep = 3
)

. (Join-Path $PSScriptRoot 'common.ps1')

# Windows PowerShell 5.1 has no $PSScriptRoot in param defaults.
if (-not $SourceDir) { $SourceDir = Split-Path -Parent $PSScriptRoot }

$layout = Get-Layout $InstallDir $ServiceName

function Switch-Release([string] $Target, [int] $Port) {
    Invoke-Change -Description "Stop the service '$ServiceName'" -Action { Stop-Service -Name $ServiceName }
    Set-CurrentRelease $layout $Target
    Invoke-Change -Description "Start the service '$ServiceName'" -Action { Start-Service -Name $ServiceName }
    return (Wait-Healthy $Port)
}

<# Releases on disk, newest first. #>
function Get-Releases {
    if (-not (Test-Path $layout.Releases)) { return @() }
    return @(Get-ChildItem -Directory $layout.Releases | Sort-Object CreationTime -Descending)
}

Write-Step 'Checking prerequisites'
Assert-Administrator
[void](Assert-Node)
$git = Get-GitPath
$service = Get-ServiceOrNull $ServiceName
if (-not $service) {
    Stop-Run "Service '$ServiceName' is not installed. Run deploy\install.ps1 first."
}
$port = Get-ServicePort $layout
if (-not $port) { $port = 3000 }
$current = Get-CurrentRelease $layout
if ($service) {
    Write-Note "Service '$ServiceName' ($($service.Status)) runs $current on port $port"
}

if ($Rollback) {
    $previous = Get-Releases | Where-Object { $_.FullName -ne $current } | Select-Object -First 1
    if (-not $previous) {
        Stop-Run "There is no other release in $($layout.Releases) to roll back to."
        $previous = [pscustomobject]@{ Name = '<previous release>'; FullName = (Join-Path $layout.Releases '<previous release>') }
    }
    Write-Step "Rolling back to $($previous.Name)"
    if (-not (Switch-Release $previous.FullName $port)) {
        throw "Release $($previous.Name) does not answer either. See $($layout.Logs)."
    }
    Write-Step "Done: $(if ($WhatIfPreference) { 'would run' } else { 'running' }) $($previous.Name)"
    exit 0
}

Write-Step "Pulling $Branch in $SourceDir"
$dirty = & $git -C $SourceDir status --porcelain --untracked-files=no
if ($dirty) { Stop-Run "$SourceDir has local changes; commit or discard them first:`n$dirty" }
Invoke-Change -Description "git pull --ff-only origin $Branch in $SourceDir" -Action {
    Invoke-Native $git @('-C', $SourceDir, 'checkout', $Branch)
    Invoke-Native $git @('-C', $SourceDir, 'pull', '--ff-only', 'origin', $Branch)
}
$commit = (& $git -C $SourceDir rev-parse --short=12 HEAD).Trim()
Write-Note "Commit to deploy: $commit$(if ($WhatIfPreference) { ' (before the pull)' })"

$target = Join-Path $layout.Releases $commit
if ($target -eq $current -and -not $Force) {
    Write-Step "Already running $commit; nothing to do (use -Force to rebuild it)."
    exit 0
}
if ($target -eq $current) {
    throw "-Force on the running release would rebuild it in place. Roll back first, or wait for a new commit."
}

Write-Step "Building release $commit (the service keeps running the current build meanwhile)"
try {
    $release = New-Release $layout $SourceDir $commit
}
catch {
    Write-Warning "Build failed: $($_.Exception.Message)"
    Write-Warning "Nothing changed: the service still runs $current."
    exit 1
}

Write-Step "Switching the service to $commit"
if (-not (Switch-Release $release $port)) {
    Write-Warning "$commit did not come up; switching back to $current."
    if (-not (Switch-Release $current $port)) {
        throw "The previous release $current does not answer either. See $($layout.Logs)."
    }
    throw "Deploy of $commit failed and was rolled back. See $($layout.Logs)."
}

Write-Step "Keeping the newest $Keep releases"
Get-Releases | Select-Object -Skip $Keep | Where-Object { $_.FullName -ne $release -and $_.FullName -ne $current } |
    ForEach-Object { Remove-Release $layout $SourceDir $_.FullName }

Write-Step "Done: $(if ($WhatIfPreference) { 'would run' } else { 'running' }) $commit"
