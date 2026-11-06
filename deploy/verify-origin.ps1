# ARGUS origin and cache verification (local development host)

param(
  [int]$Port = 8080,
  [string]$CdnUrl = "",
  [string]$AppUrl = ""
)

$ErrorActionPreference = "Stop"

Write-Host "1. Listening sockets for port $Port"
$listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $listeners) {
  Write-Host "   No listener on port $Port. Start the CDN first." -ForegroundColor Yellow
  exit 1
}
$listeners | Select-Object LocalAddress, LocalPort, OwningProcess | Format-Table

$nonLoopback = $listeners | Where-Object { $_.LocalAddress -notin @("127.0.0.1", "::1") }
if ($nonLoopback) {
  Write-Host "   FAIL: origin is bound to a non-loopback address." -ForegroundColor Red
  exit 1
}
Write-Host "   PASS: origin is loopback-only." -ForegroundColor Green

Write-Host "2. Probe the host LAN address from outside the loopback interface"
$lanIp = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
  Select-Object -First 1).IPAddress

if ($lanIp) {
  $probe = Test-NetConnection -ComputerName $lanIp -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
  if ($probe) {
    Write-Host "   FAIL: ${lanIp}:$Port accepted a connection." -ForegroundColor Red
    exit 1
  }
  Write-Host "   PASS: ${lanIp}:$Port refused the connection." -ForegroundColor Green
} else {
  Write-Host "   SKIP: no LAN IPv4 address found." -ForegroundColor Yellow
}

if ($CdnUrl) {
  Write-Host "3. CDN asset cache headers ($CdnUrl)"
  $asset = Invoke-WebRequest -Uri "$($CdnUrl.TrimEnd('/'))/healthz" -UseBasicParsing
  Write-Host "   healthz status: $($asset.StatusCode)"

  Write-Host "   Upload endpoint cache header:"
  try {
    $upload = Invoke-WebRequest -Uri "$($CdnUrl.TrimEnd('/'))/api/upload" -Method Options `
      -Headers @{
        "Origin" = "chrome-extension://argus"
        "Access-Control-Request-Method" = "POST"
      } -UseBasicParsing
    Write-Host "   OPTIONS status: $($upload.StatusCode)"
  } catch {
    Write-Host "   (expected auth-protected endpoint) $($_.Exception.Message)"
  }
}

if ($AppUrl) {
  Write-Host "4. App HTTPS check ($AppUrl)"
  $app = Invoke-WebRequest -Uri "$($AppUrl.TrimEnd('/'))/login" -UseBasicParsing
  Write-Host "   login status: $($app.StatusCode)"
}

Write-Host "Done. See deploy/README.md for the public probe and cache-rule checklist."
