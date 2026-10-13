@echo off
setlocal
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "."
) else (
  call npm.cmd run desktop
)
