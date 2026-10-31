@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [x] Node.js not found in PATH.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo [x] dist\index.html missing. Run: npm run build
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
if errorlevel 1 (
  echo [!] Port 3000 is already in use - the server may already be running.
  echo     Use stop.bat first if you want to restart it.
  pause
  exit /b 1
)

if not exist "logs" mkdir "logs"

start "BLADE STORM SERVER" /min cmd /c "node server\index.js --prod >> logs\server.log 2>&1"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; for($i=0;$i -lt 20;$i++){ try { $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 'http://127.0.0.1:3000/api/status'; if($r.StatusCode -eq 200){$ok=$true;break} } catch {}; Start-Sleep -Milliseconds 500 }; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 (
  echo [x] Start failed. Check logs\server.log
  pause
  exit /b 1
)

echo [OK] Production server started.
echo      Local : http://127.0.0.1:3000
echo      Public: http://116.148.126.91:3000
echo      Log   : logs\server.log
echo.
echo      A minimized console window "BLADE STORM SERVER" holds the process.
echo      Closing that window also stops the server.
pause
