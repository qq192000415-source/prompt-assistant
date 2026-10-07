@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

set "APP_URL=http://127.0.0.1:5174/"
set "VITE_LOG=%cd%\vite-desktop-test.log"
set "VITE_ERR=%cd%\vite-desktop-test.err.log"

echo.
echo Starting Prompt Assistant desktop test...
echo Project: %cd%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js first.
  pause
  exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm.cmd was not found. Please reinstall Node.js with npm.
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

set "RUNNING_STATUS="
for /f "delims=" %%S in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { '' }"') do set "RUNNING_STATUS=%%S"

if not "%RUNNING_STATUS%"=="200" (
  echo Starting Vite on %APP_URL% ...
  start "Prompt Assistant Vite" /min cmd /c "cd /d ""%cd%"" && npm.cmd run dev -- --port 5174 --strictPort --host 127.0.0.1 > ""%VITE_LOG%"" 2> ""%VITE_ERR%"""

  echo Waiting for Vite...
  for /l %%I in (1,1,30) do (
    set "RUNNING_STATUS="
    for /f "delims=" %%S in ('powershell -NoProfile -Command "try { (Invoke-WebRequest -Uri '%APP_URL%' -UseBasicParsing -TimeoutSec 2).StatusCode } catch { '' }"') do set "RUNNING_STATUS=%%S"
    if "!RUNNING_STATUS!"=="200" goto vite_ready
    timeout /t 1 /nobreak >nul
  )

  echo Vite failed to start. Check:
  echo %VITE_LOG%
  echo %VITE_ERR%
  pause
  exit /b 1
)

:vite_ready
echo Vite is ready: %APP_URL%
echo Opening Electron desktop test window...
echo.

set "VITE_DEV_SERVER_URL=http://127.0.0.1:5174"
call npx.cmd electron .

echo.
echo Desktop test window closed.
pause
