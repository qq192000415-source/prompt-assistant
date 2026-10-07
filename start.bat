@echo off
setlocal

cd /d "%~dp0"

echo.
echo Starting Prompt Library...
echo Project: %cd%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

for /f "delims=" %%S in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri 'http://127.0.0.1:5174/' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { '' }"') do set RUNNING_STATUS=%%S

if "%RUNNING_STATUS%"=="200" (
  echo App is already running.
  echo Opening http://127.0.0.1:5174/
  start "" "http://127.0.0.1:5174/"
  exit /b 0
)

start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5174/'"

echo Opening http://127.0.0.1:5174/
echo Press Ctrl+C in this window to stop the server.
echo.

call npm.cmd run dev -- --port 5174 --strictPort --host 127.0.0.1

pause
