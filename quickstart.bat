@echo off
setlocal EnableExtensions
title Battle for Independence

set "GAME_ROOT=%~dp0web"
set "GAME_PORT=43871"
set "LOCAL_URL=http://127.0.0.1:%GAME_PORT%/"
set "LAN_IP="

for /f "usebackq delims=" %%I in (`powershell.exe -NoProfile -Command "$socket = [System.Net.Sockets.UdpClient]::new(); try { $socket.Connect('8.8.8.8', 65530); $socket.Client.LocalEndPoint.Address.IPAddressToString } finally { $socket.Dispose() }"`) do set "LAN_IP=%%I"

if defined LAN_IP (
  set "GAME_URL=http://%LAN_IP%:%GAME_PORT%/"
) else (
  set "GAME_URL=%LOCAL_URL%"
)

cd /d "%GAME_ROOT%"
if errorlevel 1 (
  echo Could not open the game's web folder:
  echo %GAME_ROOT%
  pause
  exit /b 1
)

echo.
echo   BATTLE FOR INDEPENDENCE
echo   This computer: %LOCAL_URL%
if defined LAN_IP echo   Local network: %GAME_URL%
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed or is not available on PATH.
  echo Install Node.js, then double-click this file again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo npm is not installed or is not available on PATH.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo The game package.json is missing from:
  echo %GAME_ROOT%
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First launch: installing game packages...
  call npm install
  if errorlevel 1 (
    echo.
    echo Package installation failed.
    pause
    exit /b 1
  )
  echo.
)

echo Checking dedicated game port %GAME_PORT%...
set "PORT_BUSY="
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%GAME_PORT% .*LISTENING"') do (
  echo Stopping stale process %%P on port %GAME_PORT%...
  taskkill /PID %%P /F >nul 2>&1
  if errorlevel 1 set "PORT_BUSY=1"
)

timeout /t 1 /nobreak >nul
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%GAME_PORT% .*LISTENING"') do set "PORT_BUSY=1"

if defined PORT_BUSY (
  echo.
  echo Port %GAME_PORT% could not be cleared.
  echo Close the program using it or run this launcher as Administrator.
  pause
  exit /b 1
)

echo Opening the game. Leave this window open while playing.
start "" cmd /c "timeout /t 2 /nobreak >nul & start %GAME_URL%"

call npx vite game --host 0.0.0.0 --port %GAME_PORT% --strictPort
set "GAME_EXIT=%ERRORLEVEL%"

echo.
if not "%GAME_EXIT%"=="0" (
  echo The game server stopped with an error.
  pause
)
exit /b %GAME_EXIT%
