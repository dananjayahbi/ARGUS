#Requires -Version 7.0
<#
.SYNOPSIS
  Start ARGUS locally: Python CDN (18130) + Next.js web (13130).

.DESCRIPTION
  Local convention: uncommon high ports so common dev ports don't collide.
  - CDN: http://127.0.0.1:18130  (apps/cdn/.env PORT)
  - Web: http://localhost:13130  (Next.js -p flag)

  Logs + PID files live in:
    $env:TEMP\argus-local\   (or -LogDir)

.PARAMETER Prod
  Use `next start` (needs a prior `npm run build`). Default is `next dev`.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\local\start-local.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\local\start-local.ps1 -Prod
#>
[CmdletBinding()]
param(
  [int]$WebPort = 13130,
  [int]$CdnPort = 18130,
  [switch]$Prod,
  [string]$LogDir = (Join-Path $env:TEMP "argus-local")
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..") | Select-Object -ExpandProperty Path
$cdnDir = Join-Path $repo "apps\cdn"
$webDir = Join-Path $repo "apps\web"

if (-not (Test-Path "$cdnDir\.env")) { throw "Missing apps\cdn\.env. Copy apps\cdn\.env.example to .env and fill it in." }
if (-not (Test-Path "$webDir\.env.local")) { throw "Missing apps\web\.env.local. Copy apps\web\.env.example to .env.local and fill it in." }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$python = "$cdnDir\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { throw "CDN venv not found. Run: cd apps\cdn; python -m venv .venv; .\.venv\Scripts\python -m pip install -e `".[dev]`"" }

Write-Host "== ARGUS local start ==" -ForegroundColor Cyan
Write-Host "  CDN : http://127.0.0.1:$CdnPort   (python -m argus_cdn)"
Write-Host "  Web : http://localhost:$WebPort   ($(if ($Prod) {'next start'} else {'next dev'}))"
Write-Host "  Logs: $LogDir"
Write-Host ""

$cdn = Start-Process -FilePath $python -ArgumentList "-m","argus_cdn" -WorkingDirectory $cdnDir -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "$LogDir\cdn.out.log" -RedirectStandardError "$LogDir\cdn.err.log"
$cdn.Id | Set-Content "$LogDir\cdn.pid" -NoNewline
Write-Host "  CDN PID $($cdn.Id)"

if ($Prod) {
  if (-not (Test-Path "$webDir\.next\BUILD_ID")) { throw "Production build missing. Run: cd apps\web; npm run build" }
  $nextArgs = @("node_modules/next/dist/bin/next","start","-H","127.0.0.1","-p",$WebPort)
} else {
  $nextArgs = @("node_modules/next/dist/bin/next","dev","-H","127.0.0.1","-p",$WebPort)
}

$web = Start-Process -FilePath "node" -ArgumentList $nextArgs -WorkingDirectory $webDir -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "$LogDir\web.out.log" -RedirectStandardError "$LogDir\web.err.log"
$web.Id | Set-Content "$LogDir\web.pid" -NoNewline
Write-Host "  Web PID $($web.Id)"

Write-Host ""
Write-Host "Waiting ~6 seconds, then running health checks..." -ForegroundColor DarkGray
Start-Sleep -Seconds 6
& (Join-Path $PSScriptRoot "check-local.ps1") -WebPort $WebPort -CdnPort $CdnPort -LogDir $LogDir
