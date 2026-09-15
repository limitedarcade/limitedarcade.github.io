@echo off
setlocal EnableExtensions
title Fighter pipeline
cd /d "%~dp0"

echo.
echo   Fighter pipeline
echo   http://127.0.0.1:5179/
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not on PATH.
  echo Install it from https://nodejs.org then double-click this file again.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo quickstart.bat must sit next to package.json
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo First run: installing packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
  echo.
)

curl.exe -fsS --max-time 1 http://127.0.0.1:5179/ >nul 2>&1
if not errorlevel 1 (
  echo Already running. Opening the browser.
  start "" "http://127.0.0.1:5179/"
  exit /b 0
)

echo Opening the browser in a moment. Leave this window open.
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5179/"

call npm start
set ERR=%ERRORLEVEL%
echo.
if not "%ERR%"=="0" (
  echo Server stopped with an error.
  echo If port 5179 is already in use, close the other fighter-tool window.
  pause
)
exit /b %ERR%
