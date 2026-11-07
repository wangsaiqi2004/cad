@echo off
setlocal
title Local Interior Design Agent
rem Double-click to launch. All data stays on this machine.
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules" goto nodeps

node "scripts\launch-desktop.mjs"
if errorlevel 1 goto failed
exit /b 0

:nonode
echo [ERROR] Node.js not found in PATH.
echo Please install Node.js 22 or ask your administrator.
pause
exit /b 1

:nodeps
echo [ERROR] app\node_modules is missing.
echo Run: npm install
pause
exit /b 1

:failed
echo.
echo [ERROR] Launch failed. Please send the message above to your administrator.
pause
exit /b 1
