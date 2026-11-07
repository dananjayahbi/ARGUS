@echo off
setlocal
set "ROOT=%~dp0"

echo Starting ARGUS CDN and web server in two CMD windows...
echo.

start "ARGUS CDN (18130)" /D "%ROOT%apps\cdn" cmd /k ".venv\Scripts\python.exe -m argus_cdn"
start "ARGUS Web (13130)" /D "%ROOT%apps\web" cmd /k "npm run dev -- -p 13130"

echo CDN window:  http://127.0.0.1:18130
echo Web window:  http://localhost:13130
echo.
echo Close each CMD window to stop that service.
endlocal
