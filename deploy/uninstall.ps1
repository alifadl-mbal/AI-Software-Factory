<#
.SYNOPSIS
  Remove the MBAL BI Windows service.

.DESCRIPTION
  Stops and unregisters the service. By default every file stays where it is. With
  -RemoveReleases the built releases and the service wrapper are deleted too. The config
  (.env.production.local) and the logs are never deleted: remove them by hand if you mean to.

  -WhatIf prints every step it would take and changes nothing.

.EXAMPLE
  .\deploy\uninstall.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string] $InstallDir = 'C:\MbalBI',
    [string] $ServiceName = 'MbalBi',
    [string] $SourceDir,
    [switch] $RemoveReleases
)

. (Join-Path $PSScriptRoot 'common.ps1')

# Windows PowerShell 5.1 has no $PSScriptRoot in param defaults.
if (-not $SourceDir) { $SourceDir = Split-Path -Parent $PSScriptRoot }

$layout = Get-Layout $InstallDir $ServiceName

Write-Step 'Checking prerequisites'
Assert-Administrator

$service = Get-ServiceOrNull $ServiceName
if ($service) {
    Write-Step "Removing the service '$ServiceName' ($($service.Status))"
    if ($service.Status -ne 'Stopped') {
        Invoke-Change -Description "Stop the service '$ServiceName'" -Action { Stop-Service -Name $ServiceName }
    }
    Invoke-Change -Description "Unregister the service '$ServiceName'" -Action {
        if (Test-Path $layout.WinSwExe) {
            Invoke-Native $layout.WinSwExe @('uninstall')
        }
        else {
            Invoke-Native sc.exe @('delete', $ServiceName)
        }
    }
}
else {
    Write-Note "Service '$ServiceName' is not installed; nothing to unregister."
}

if ($RemoveReleases) {
    Write-Step "Removing releases and the service wrapper from $InstallDir"
    if (Test-Path $layout.Releases) {
        Get-ChildItem -Directory $layout.Releases | ForEach-Object { Remove-Release $layout $SourceDir $_.FullName }
    }
    if (Test-Path $layout.ServiceDir) {
        Invoke-Change -Description "Delete $($layout.ServiceDir)" -Action { Remove-Item -Recurse -Force $layout.ServiceDir }
    }
}

Write-Step $(if ($WhatIfPreference) { 'Done (dry run: nothing was changed)' } else { 'Done' })
if (Test-Path $layout.EnvFile) { Write-Note "Kept the config: $($layout.EnvFile)" }
if (Test-Path $layout.Logs) { Write-Note "Kept the logs: $($layout.Logs)" }
