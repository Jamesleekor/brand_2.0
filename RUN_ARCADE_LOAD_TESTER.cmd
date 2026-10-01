@echo off
setlocal EnableExtensions
chcp 65001 >nul
set "ROOT=C:\brand_2.0\brand_2.0"

echo ============================================================
echo  B.R.A.N.D 2.0 Arcade Verification Load Tester (1 teacher + 24 students)
echo ============================================================
echo.
if not exist "%ROOT%\package.json" goto ROOT_NOT_FOUND
cd /d "%ROOT%"
if not exist "node_modules\@supabase\supabase-js" goto NODE_MODULES_MISSING
if not exist "tools\arcade-load-tester\run.mjs" goto TESTER_MISSING
if not exist "tools\auction-load-tester\AUCTION_LOAD_TEST_ACCOUNTS.json" goto ACCOUNTS_MISSING

node "tools\arcade-load-tester\run.mjs"
set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" echo [EXIT CODE] %ERR%
pause
exit /b %ERR%

:ROOT_NOT_FOUND
echo [ERROR] Project root not found: %ROOT%
pause
exit /b 1
:NODE_MODULES_MISSING
echo [ERROR] node_modules is missing. Run "npm install" in %ROOT% first.
pause
exit /b 1
:TESTER_MISSING
echo [ERROR] tools\arcade-load-tester\run.mjs is missing. Run START_HERE.cmd from the patch folder.
pause
exit /b 1
:ACCOUNTS_MISSING
echo [ERROR] Test accounts file is missing. Apply the auction load tester patch first.
pause
exit /b 1
