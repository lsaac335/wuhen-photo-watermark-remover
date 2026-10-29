@echo off
chcp 65001 >nul
title 无痕修图 - 本地照片去水印
cd /d "%~dp0"

set "TOOL_NODE=C:\Users\62617\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%TOOL_NODE%" (
  echo 未找到本地运行组件，请在 Codex 中让助手重新配置。
  pause
  exit /b 1
)

start "" /b powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 800; Start-Process 'http://127.0.0.1:5173'"
echo.
echo   无痕修图正在运行：http://127.0.0.1:5173
echo   请保持此窗口打开；关闭窗口即停止工具。
echo.
"%TOOL_NODE%" "local-server.mjs"

if errorlevel 1 (
  echo.
  echo 启动遇到问题，请回到 Codex 寻求帮助。
  pause
)
