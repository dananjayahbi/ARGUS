#Requires -Version 7.0
<#
.SYNOPSIS
  Stop local ARGUS services started by start-local.ps1.
#>
param([string]$LogDir = (Join-Path $env:TEMP "argus-local"))

$ErrorActionPreference = "SilentlyContinue"
foreach ($name in @("cdn","web")) {
  $pidFile = Join-Path $LogDir "$name.pid"
  if (Test-Path $pidFile) {
    $pidValue = Get-Content $pidFile
    try { Stop-Process -Id $pidValue -Force; Write-Host "Stopped $name PID $pidValue" }
    catch { Write-Host "$name PID $pidValue was not running, skipped." -ForegroundColor DarkGray }
  } else {
    Write-Host "No PID file for $name ($pidFile). Nothing to stop." -ForegroundColor DarkGray
  }
}
