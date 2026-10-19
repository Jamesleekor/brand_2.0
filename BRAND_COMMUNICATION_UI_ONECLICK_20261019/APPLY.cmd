@echo off
setlocal
cd /d "%~dp0"
node "%~dp0apply.cjs" %*
set "PATCH_RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %PATCH_RESULT%
