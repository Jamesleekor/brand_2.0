@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
echo =============================================
echo B.R.A.N.D RAID Pattern Generator Import Fix
echo =============================================
if not exist "package.json" (
  echo [ERROR] Extract both files into the project root next to package.json.
  pause
  exit /b 2
)
where powershell >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Windows PowerShell is required.
  pause
  exit /b 2
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0FIX_RAID_PATTERN_IMPORT.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Fix failed, check the details above.
  pause
  exit /b 1
)
echo.
echo [SUCCESS] You can now run: npm run build
echo.
pause
