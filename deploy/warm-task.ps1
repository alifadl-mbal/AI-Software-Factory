<#
.SYNOPSIS
    Registers the MBAL BI cache warm-up as a Windows Task Scheduler job (every 10 minutes), or runs it once.

.DESCRIPTION
    Register (the default): creates or updates a scheduled task that runs this script with -Run every
    -EveryMinutes minutes (10 by default), starting now and repeating indefinitely. Each run re-reads
    the default view of every dashboard into the app's cache, so pages open without waiting for Orion.
    Keep the interval under the cache's 15-minute TTL. Needs an elevated PowerShell. -WhatIf shows what
    would be registered without changing anything.

    Run (-Run): POSTs to the warm-up endpoint with "Authorization: Bearer <CRON_SECRET>" and prints each
    section's time. The token is read when the task runs, from -SecretFile if given, else from the
    CRON_SECRET environment variable (set it machine-wide, the same value the app uses). It is never put
    on the task's command line, where anyone who can list tasks could read it. Exits 1 if the endpoint
    doesn't answer 200 (502 means a section failed: the output names it), so Task Scheduler shows the
    run as failed.

    Unregister (-Unregister): removes the task.

.EXAMPLE
    .\deploy\warm-task.ps1 -WhatIf
    Shows the task that would be registered: every 10 minutes, POST to http://localhost:3000.

.EXAMPLE
    .\deploy\warm-task.ps1 -Url http://127.0.0.1:3000/api/cron/warm -EveryMinutes 5

.EXAMPLE
    .\deploy\warm-task.ps1 -Run
    Warms the cache now and prints the section times (CRON_SECRET must be set in this shell).
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = "Register")]
param(
    # The warm-up endpoint.
    [string] $Url = "http://localhost:3000/api/cron/warm",

    # Minutes between runs; under the 15-minute cache TTL so results never go stale.
    [Parameter(ParameterSetName = "Register")]
    [ValidateRange(1, 14)]
    [int] $EveryMinutes = 10,

    [Parameter(ParameterSetName = "Register")]
    [Parameter(ParameterSetName = "Unregister")]
    [string] $TaskName = "MBAL BI cache warm-up",

    # The account the task runs as. It only needs to reach the app over HTTP and read the token.
    [Parameter(ParameterSetName = "Register")]
    [string] $UserId = "NT AUTHORITY\NETWORK SERVICE",

    # A file holding only the token, readable by the task's account. Defaults to $env:CRON_SECRET.
    [Parameter(ParameterSetName = "Register")]
    [Parameter(ParameterSetName = "Run")]
    [string] $SecretFile,

    [Parameter(ParameterSetName = "Run", Mandatory = $true)]
    [switch] $Run,

    [Parameter(ParameterSetName = "Unregister", Mandatory = $true)]
    [switch] $Unregister
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Warm {
    if ($SecretFile) {
        $secret = (Get-Content -LiteralPath $SecretFile -Raw).Trim()
    } else {
        $secret = $env:CRON_SECRET
    }
    if (-not $secret) {
        Write-Error "No token: set CRON_SECRET (machine-wide) or pass -SecretFile."
        exit 1
    }
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Post -UseBasicParsing -TimeoutSec 300 `
            -Headers @{ Authorization = "Bearer $secret" }
        $result = $response.Content | ConvertFrom-Json
        Write-Output "Cache warmed: HTTP $($response.StatusCode), $($result.sections.Count) sections in $($result.ms) ms"
        $result.sections | ForEach-Object { Write-Output ("  {0,6} ms  {1}  {2}" -f $_.ms, $_.page, $_.section) }
    } catch {
        # The message carries the status and the endpoint's JSON (failed sections), never the token.
        $status = if ($_.Exception.Response) { [int] $_.Exception.Response.StatusCode } else { "no response" }
        Write-Error "Warm-up failed ($status): $($_.Exception.Message) $($_.ErrorDetails.Message)"
        exit 1
    }
}

switch ($PSCmdlet.ParameterSetName) {
    "Run" {
        Invoke-Warm
    }
    "Unregister" {
        if ($PSCmdlet.ShouldProcess($TaskName, "Unregister scheduled task")) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Output "Removed '$TaskName'."
        }
    }
    "Register" {
        $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Run -Url `"$Url`""
        if ($SecretFile) { $arguments += " -SecretFile `"$SecretFile`"" }
        $description = "MBAL BI cache warm-up every $EveryMinutes minutes: POST $Url with the CRON_SECRET bearer token."
        $summary = "every $EveryMinutes minutes from now as $UserId, running: powershell.exe $arguments"

        if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled task $summary")) {
            $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
            # No -RepetitionDuration: repeats indefinitely.
            $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
                -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
            $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType ServiceAccount
            # A run never overlaps the next one; a slow Orion just skips a beat.
            $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
                -ExecutionTimeLimit (New-TimeSpan -Minutes 9)
            Register-ScheduledTask -TaskName $TaskName -Description $description -Action $action -Trigger $trigger `
                -Principal $principal -Settings $settings -Force | Out-Null
            Write-Output "Registered '$TaskName': $summary"
        }
    }
}
