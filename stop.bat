@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if (-not $p) { Write-Host '[i] Server is not running.'; exit 0 }; $proc = Get-Process -Id $p.OwningProcess -ErrorAction SilentlyContinue; if ($proc -and $proc.ProcessName -eq 'node') { Stop-Process -Id $p.OwningProcess -Force; Start-Sleep -Milliseconds 400; Write-Host ('[OK] Stopped. PID ' + $p.OwningProcess) } else { Write-Host '[!] Port 3000 is held by another process - skipped.'; exit 1 }"

if errorlevel 1 (
  echo [!] Could not stop the server.
  pause
  exit /b 1
)

echo Server stopped.
pause
