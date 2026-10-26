@echo off
setlocal
title DSH Subagent Model Discovery Repair
pwsh.exe -NoProfile -File "%~dp0install-window.ps1" -Receipt "%~dp0..\..\.scratch\subagent-model-discovery-reviewed\receipt.json"
if errorlevel 1 (
  echo Installation window failed. Preserve the backup and check the PowerShell error above.
  pause
)
endlocal
