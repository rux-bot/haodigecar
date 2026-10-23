@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-service.ps1" -Action Stop
if errorlevel 1 (
  pause
  exit /b 1
)
exit /b 0
