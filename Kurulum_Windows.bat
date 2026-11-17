@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Hypotheca] Node.js bulunamadi.
  echo Lutfen https://nodejs.org adresinden LTS surumunu kurup tekrar deneyin.
  echo.
  pause
  exit /b 1
)

node scripts\kurulum.mjs
echo.
pause
