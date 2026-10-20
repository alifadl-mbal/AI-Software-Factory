<#
.SYNOPSIS
    Registers the daily MBAL BI snapshot email as a Windows Task Scheduler job, or runs it once.

.DESCRIPTION
    Register (the default): creates or updates a scheduled task that runs this script with -Run every
    day at -At, Asia/Dubai time (07:30 by default). The time is converted to the server's local time
    zone when the task is registered. Needs an elevated PowerShell. -WhatIf shows what would be
    registered without changing anything.

    Run (-Run): POSTs to the snapshot endpoint with "Authorization: Bearer <CRON_SECRET>". The token is
    read when the task runs, from -SecretFile if given, else from the CRON_SECRET environment
    variable (set it machine-wide, the same value the app uses). It is never put on the task's command
    line, where anyone who can list tasks could read it. Exits 1 if the endpoint doesn't answer 200,
    so Task Scheduler shows the run as failed.

    Unregister (-Unregister): removes the task.

.EXAMPLE
    .\deploy\snapshot-task.ps1 -WhatIf
    Shows the task that would be registered: daily at 07:30 Asia/Dubai, POST to http://localhost:3000.

.EXAMPLE
    .\deploy\snapshot-task.ps1 -Url https://bi.mbal.local/api/cron/snapshot -At 07:00

.EXAMPLE
    .\deploy\snapshot-task.ps1 -Run
    Sends today's snapshot now (CRON_SECRET must be set in this shell).
#>
[CmdletBinding(SupportsShouldProcess = $true, DefaultParameterSetName = "Register")]
param(
    # The snapshot endpoint.
    [string] $Url = "http://localhost:3000/api/cron/snapshot",

    # Daily send time, HH:mm in Asia/Dubai.
    [Parameter(ParameterSetName = "Register")]
    [ValidatePattern("^([01][0-9]|2[0-3]):[0-5][0-9]$")]
    [string] $At = "07:30",

    [Parameter(ParameterSetName = "Register")]
    [Parameter(ParameterSetName = "Unregister")]
    [string] $TaskName = "MBAL BI daily snapshot",

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

$DubaiTimeZoneId = "Arabian Standard Time" # Windows' id for Asia/Dubai (UTC+4, no daylight saving)

function Send-Snapshot {
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
        Write-Output "Snapshot sent: HTTP $($response.StatusCode) $($response.Content)"
    } catch {
        # The message carries the status and the endpoint's JSON, never the token.
        $status = if ($_.Exception.Response) { [int] $_.Exception.Response.StatusCode } else { "no response" }
        Write-Error "Snapshot failed ($status): $($_.Exception.Message)"
        exit 1
    }
}

function Get-LocalTriggerTime([string] $dubaiTime) {
    $dubai = [TimeZoneInfo]::FindSystemTimeZoneById($DubaiTimeZoneId)
    $today = [TimeZoneInfo]::ConvertTime([DateTime]::UtcNow, $dubai).Date
    $atDubai = [DateTime]::SpecifyKind($today.Add([TimeSpan]::Parse($dubaiTime)), [DateTimeKind]::Unspecified)
    return [TimeZoneInfo]::ConvertTime($atDubai, $dubai, [TimeZoneInfo]::Local)
}

switch ($PSCmdlet.ParameterSetName) {
    "Run" {
        Send-Snapshot
    }
    "Unregister" {
        if ($PSCmdlet.ShouldProcess($TaskName, "Unregister scheduled task")) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Output "Removed '$TaskName'."
        }
    }
    "Register" {
        $local = Get-LocalTriggerTime $At
        $arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Run -Url `"$Url`""
        if ($SecretFile) { $arguments += " -SecretFile `"$SecretFile`"" }
        $description = "Daily MBAL BI snapshot email at $At Asia/Dubai: POST $Url with the CRON_SECRET bearer token."
        $summary = "daily at $At Asia/Dubai ($($local.ToString('HH:mm')) $([TimeZoneInfo]::Local.Id)) as $UserId, running: powershell.exe $arguments"

        if ([TimeZoneInfo]::Local.SupportsDaylightSavingTime) {
            Write-Warning ("This server's time zone has daylight saving time, so the send time will move by an hour " +
                "when the clocks change. Set the server to Asia/Dubai, or re-run this script after a change.")
        }
        if ($PSCmdlet.ShouldProcess($TaskName, "Register scheduled task $summary")) {
            $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
            $trigger = New-ScheduledTaskTrigger -Daily -At $local
            $principal = New-ScheduledTaskPrincipal -UserId $UserId -LogonType ServiceAccount
            $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 15) `
                -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 10)
            Register-ScheduledTask -TaskName $TaskName -Description $description -Action $action -Trigger $trigger `
                -Principal $principal -Settings $settings -Force | Out-Null
            Write-Output "Registered '$TaskName': $summary"
        }
    }
}
