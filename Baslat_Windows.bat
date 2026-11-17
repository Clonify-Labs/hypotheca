@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [Hypotheca] Node.js bulunamadi. Lutfen https://nodejs.org adresinden kurun.
  pause
  exit /b 1
)

if not exist ".dev.vars" goto runsetup
if not exist "dist\index.html" goto runsetup
if not exist "mcp-server\dist\index.js" goto runsetup
goto startserver

:runsetup
echo [Hypotheca] Ilk kullanim algilandi, otomatik kurulum calistiriliyor...
node scripts\kurulum.mjs --auto

:startserver
echo.
echo [Hypotheca] Web paneli baslatiliyor -^> http://127.0.0.1:8787
echo (Durdurmak icin bu pencereyi kapatabilir veya Ctrl+C tuslayabilirsiniz.)
call npm run worker:dev
pause
