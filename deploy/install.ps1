<#
.SYNOPSIS
  Install MBAL BI as a Windows service on this machine.

.DESCRIPTION
  1. Checks Node.js >= 22 and git.
  2. Checks out the current commit of this repository into <InstallDir>\releases\<commit> and
     runs `npm ci` and `npm run build` there.
  3. Registers a Windows service (WinSW) that starts on boot (delayed) and restarts after a crash,
     serving on -ListenAddress:-Port. Logs go to <InstallDir>\logs.

  Config (Orion, Microsoft sign-in, CRON_SECRET) lives in <InstallDir>\.env.production.local.
  If it does not exist yet, a template is created from .env.example and the script stops so you
  can fill it in. See docs/deployment.md.

  -WhatIf prints every step it would take and changes nothing.

.EXAMPLE
  .\deploy\install.ps1 -WhatIf
.EXAMPLE
  .\deploy\install.ps1 -InstallDir D:\MbalBI -Port 3000
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    # Where releases, logs, the service wrapper and the config live.
    [string] $InstallDir = 'C:\MbalBI',
    # The port the app listens on. The HTTPS reverse proxy forwards to it.
    [ValidateRange(1, 65535)][int] $Port = 3000,
    # 127.0.0.1 keeps the app reachable only through the reverse proxy on this machine (HTTPS).
    [string] $ListenAddress = '127.0.0.1',
    [string] $ServiceName = 'MbalBi',
    # The git checkout to deploy from: by default the one this script is in.
    [string] $SourceDir
)

. (Join-Path $PSScriptRoot 'common.ps1')

# Windows PowerShell 5.1 has no $PSScriptRoot in param defaults.
if (-not $SourceDir) { $SourceDir = Split-Path -Parent $PSScriptRoot }

$layout = Get-Layout $InstallDir $ServiceName

Write-Step 'Checking prerequisites'
Assert-Administrator
$nodeExe = Assert-Node
$git = Get-GitPath
$commit = (& $git -C $SourceDir rev-parse --short=12 HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw "$SourceDir is not a git checkout." }
Write-Note "Source $SourceDir at commit $commit"
if (Get-ServiceOrNull $ServiceName) {
    Stop-Run "Service '$ServiceName' is already installed. Use deploy\update.ps1 to deploy a new version, or deploy\uninstall.ps1 first."
}
$listening = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
    Where-Object { $_.Port -eq $Port }
if ($listening) {
    Stop-Run "Port $Port is already in use. Pick another with -Port."
}
else {
    Write-Note "Port $Port is free"
}

Write-Step "Creating $InstallDir"
foreach ($dir in @($layout.InstallDir, $layout.Releases, $layout.Logs, $layout.ServiceDir)) {
    if (-not (Test-Path $dir)) {
        Invoke-Change -Description "Create directory $dir" -Action { New-Item -ItemType Directory -Path $dir | Out-Null }
    }
}

Write-Step 'Checking the config file'
if (-not (Test-Path $layout.EnvFile)) {
    $template = Join-Path $SourceDir '.env.example'
    Invoke-Change -Description "Create $($layout.EnvFile) from .env.example, readable by Administrators and SYSTEM only" -Action {
        Copy-Item $template $layout.EnvFile
        # Secrets inside: no inherited access, only admins and the service (LocalSystem).
        Invoke-Native icacls.exe @($layout.EnvFile, '/inheritance:r', '/grant:r', '*S-1-5-32-544:F', '/grant:r', '*S-1-5-18:R')
    }
    if (-not $WhatIfPreference) {
        Write-Warning "Fill in $($layout.EnvFile) (see docs/deployment.md), then run install.ps1 again."
        exit 2
    }
    Write-Note 'The real run stops here until the config is filled in.'
}
else {
    $settings = Get-Content $layout.EnvFile | Where-Object { $_ -match '^\s*[A-Z_]+\s*=\s*\S' } | ForEach-Object { ($_ -split '=', 2)[0].Trim() }
    $missing = @('MBAL_DATA_SOURCE', 'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_DSN', 'AUTH_SECRET', 'AUTH_URL',
        'AUTH_MICROSOFT_ENTRA_ID_ID', 'AUTH_MICROSOFT_ENTRA_ID_SECRET', 'AUTH_MICROSOFT_ENTRA_ID_TENANT_ID') |
        Where-Object { $settings -notcontains $_ }
    if ($missing) {
        Write-Warning "Not set in $($layout.EnvFile): $($missing -join ', '). Without sign-in, live Orion data is not served."
    }
    else {
        Write-Note "$($layout.EnvFile) has every required setting"
    }
}

Write-Step "Building release $commit"
$release = New-Release $layout $SourceDir $commit

Write-Step "Registering the Windows service '$ServiceName' (WinSW $script:WinSwVersion)"
Invoke-Change -Description "Download WinSW $script:WinSwVersion to $($layout.WinSwExe) and verify its SHA-256" -Action {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing $script:WinSwUrl -OutFile $layout.WinSwExe
    $hash = (Get-FileHash $layout.WinSwExe -Algorithm SHA256).Hash
    if ($hash -ne $script:WinSwSha256) {
        Remove-Item $layout.WinSwExe
        throw "WinSW download has SHA-256 $hash, expected $script:WinSwSha256. Not installing."
    }
}

$esc = { param([string] $s) [Security.SecurityElement]::Escape($s) }
$xml = @"
<service>
  <id>$ServiceName</id>
  <name>MBAL BI</name>
  <description>MBAL BI dashboards on Orion (Next.js). Installed by deploy\install.ps1.</description>
  <executable>$(& $esc $nodeExe)</executable>
  <arguments>--env-file="$(& $esc $layout.EnvFile)" node_modules\next\dist\bin\next start -H $ListenAddress -p $Port</arguments>
  <workingdirectory>$(& $esc $release)</workingdirectory>
  <env name="NODE_ENV" value="production" />
  <env name="PORT" value="$Port" />
  <env name="NEXT_TELEMETRY_DISABLED" value="1" />
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <onfailure action="restart" delay="60 sec" />
  <resetfailure>1 hour</resetfailure>
  <stoptimeout>20 sec</stoptimeout>
  <logpath>$(& $esc $layout.Logs)</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>10</keepFiles>
  </log>
</service>
"@
Invoke-Change -Description "Write the service config $($layout.WinSwXml)" -Action {
    [IO.File]::WriteAllText($layout.WinSwXml, $xml)
}
if ($WhatIfPreference) {
    Write-Note 'Service config that would be written:'
    $xml -split "`n" | ForEach-Object { Write-Note "  $_" }
}
Invoke-Change -Description "Install and start the service '$ServiceName'" -Action {
    Invoke-Native $layout.WinSwExe @('install')
    Start-Service -Name $ServiceName
}

Write-Step 'Waiting for the app to answer'
if (-not (Wait-Healthy $Port)) {
    throw "The service started but http://127.0.0.1:$Port/api/health does not answer. See $($layout.Logs)."
}

Write-Step $(if ($WhatIfPreference) { 'Done (dry run: nothing was changed)' } else { 'Done' })
Write-Note "MBAL BI $commit $(if ($WhatIfPreference) { 'would run' } else { 'is running' }) as service '$ServiceName' on ${ListenAddress}:$Port."
Write-Note 'Next: put the HTTPS reverse proxy in front of it (deploy\Caddyfile, docs/deployment.md).'
