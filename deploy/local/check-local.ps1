#Requires -Version 7.0
<#
.SYNOPSIS
  Health-check local ARGUS services on the high ports.
#>
param(
  [int]$WebPort = 13130,
  [int]$CdnPort = 18130,
  [string]$LogDir = (Join-Path $env:TEMP "argus-local")
)

function Test-Url([string]$Url) {
  for ($i = 1; $i -le 20; $i++) {
    try {
      $r = Invoke-RestMethod -Uri $Url -TimeoutSec 5 -ErrorAction Stop
      return $r
    } catch {
      if ($i -eq 20) { throw }
      Start-Sleep -Seconds 1
    }
  }
}

Write-Host "== ARGUS local health check ==" -ForegroundColor Cyan
Write-Host "  Web http://localhost:$WebPort/api/healthz"
try {
  $web = Test-Url "http://127.0.0.1:$WebPort/api/healthz"
  Write-Host "  Web: OK  $($web | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
  Write-Host "  Web: FAIL - is it still booting? Check $LogDir\web.out.log and $LogDir\web.err.log" -ForegroundColor Red
}
Write-Host "  CDN http://127.0.0.1:$CdnPort/healthz"
try {
  $cdn = Test-Url "http://127.0.0.1:$CdnPort/healthz"
  Write-Host "  CDN: OK  $($cdn | ConvertTo-Json -Compress)" -ForegroundColor Green
} catch {
  Write-Host "  CDN: FAIL - Check $LogDir\cdn.out.log and $LogDir\cdn.err.log" -ForegroundColor Red
}
Write-Host ""
Write-Host "Dashboard : http://localhost:$WebPort/login"
Write-Host "Upload CDN: http://127.0.0.1:$CdnPort/api/upload  (POST, X-CDN-Auth-Token)"
