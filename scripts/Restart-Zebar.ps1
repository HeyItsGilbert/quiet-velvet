#Requires -Version 7
<#
.SYNOPSIS
    Cleanly stop Zebar and its WebView2 children, then optionally restart.

.DESCRIPTION
    Plain `Stop-Process zebar` orphans the msedgewebview2.exe children that
    Zebar's WebView spawns. Those orphans keep TCP connections to Zebar's
    asset server (127.0.0.1:6124) in CLOSE_WAIT, eventually wedging the
    listener and making the bar render blank on the next launch.

    This helper kills zebar, sweeps any msedgewebview2.exe whose
    --user-data-dir points into a Zebar cache, waits for the listener to
    release, then (by default) launches `zebar startup` again.

.PARAMETER NoStart
    Stop only — don't relaunch.

.PARAMETER WaitSeconds
    How long to wait for port 6124 to clear (default 10).

.EXAMPLE
    .\scripts\Restart-Zebar.ps1
    Stop, sweep, restart.

.EXAMPLE
    .\scripts\Restart-Zebar.ps1 -NoStart
    Just clean up.
#>
[CmdletBinding()]
param(
    [switch]$NoStart,
    [int]$WaitSeconds = 10
)

$ErrorActionPreference = 'Stop'
$ZebarExe = 'C:\Program Files\glzr.io\Zebar\zebar.exe'
$AssetPort = 6124

function Stop-ZebarTree {
    $zebar = Get-Process -Name zebar -ErrorAction SilentlyContinue
    if ($zebar) {
        Write-Host "Stopping zebar (PID $($zebar.Id -join ', '))..."
        $zebar | Stop-Process -Force
    } else {
        Write-Host "No zebar process running."
    }

    $orphans = Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" |
        Where-Object { $_.CommandLine -match 'user-data-dir="?[^"]*\\(zebar|com\.glzr\.zebar)\\' }

    if ($orphans) {
        Write-Host "Sweeping $($orphans.Count) Zebar WebView2 orphan(s)..."
        $orphans | ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host "No Zebar WebView2 orphans."
    }
}

function Wait-ForPortFree {
    param([int]$Port, [int]$TimeoutSeconds)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $busy) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

Stop-ZebarTree

if ($NoStart) { return }

Write-Host "Waiting up to $WaitSeconds`s for port $AssetPort to release..."
if (Wait-ForPortFree -Port $AssetPort -TimeoutSeconds $WaitSeconds) {
    Write-Host "Port $AssetPort is free."
} else {
    Write-Warning @"
Port $AssetPort still held by a stale TCP entry. The bar will render blank on
restart. Reboot is the reliable fix. Stale entries:
"@
    Get-NetTCPConnection -LocalPort $AssetPort -ErrorAction SilentlyContinue |
        Select-Object LocalAddress, LocalPort, State, OwningProcess |
        Format-Table -AutoSize | Out-String | Write-Host
    Write-Host "Skipping restart. Re-run after a reboot."
    return
}

Write-Host "Launching zebar startup..."
Start-Process $ZebarExe -ArgumentList 'startup'
Start-Sleep -Seconds 2
$new = Get-Process -Name zebar -ErrorAction SilentlyContinue
if ($new) {
    Write-Host "Zebar started (PID $($new.Id))."
} else {
    Write-Warning "Zebar did not appear to start."
}
