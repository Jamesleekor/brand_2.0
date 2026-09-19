@echo off
setlocal EnableExtensions
set "ROOT=C:\brand_2.0\brand_2.0"

echo ============================================================
echo  B.R.A.N.D Raid V1.5 - 8/12/24 Player Load Tester
echo ============================================================
echo.

if not exist "%ROOT%\package.json" goto ROOT_NOT_FOUND
cd /d "%ROOT%"
if errorlevel 1 goto ROOT_NOT_FOUND
if not exist "node_modules\@supabase\supabase-js" goto NODE_MODULES_MISSING
if not exist "tools\raid-load-tester\run.mjs" goto TESTER_MISSING

node "tools\raid-load-tester\run.mjs"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" echo [EXIT CODE] %ERR%
pause
exit /b %ERR%

:ROOT_NOT_FOUND
echo [ERROR] Project root not found:
echo         %ROOT%
pause
exit /b 1

:NODE_MODULES_MISSING
echo [ERROR] node_modules or @supabase/supabase-js is missing.
echo Run npm install in the project root first.
pause
exit /b 1

:TESTER_MISSING
echo [ERROR] Load Tester file is missing.
echo Re-run START_HERE.cmd from the extracted patch folder.
pause
exit /b 1
