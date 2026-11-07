@echo off
chcp 65001 >nul
title 本地装修设计 Agent
rem 双击本文件即可启动。所有资料与成果都保存在这台电脑上。
cd /d "%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
  echo 没有找到 Node.js。请先安装 Node.js 22 或联系管理员。
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 运行依赖目录不存在，请先在本目录执行 npm install。
  pause
  exit /b 1
)

node scripts\launch-desktop.mjs
if errorlevel 1 (
  echo.
  echo 启动失败，请把上面的错误信息发给管理员。
  pause
)
