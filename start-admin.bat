@echo off
title Anvio Talk - Admin Console Launcher
cd /d "%~dp0"

echo ============================================
echo   ANVIO TALK - ADMIN CONSOLE (Desktop)
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found! Install from: https://nodejs.org
    pause
    exit /b 1
)

REM Step 1: Ensure main app server is running (admin console reads data through it)
echo [1/3] Checking app server (port 3000)...
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if errorlevel 1 (
    echo       Server not running - starting it...
    if exist "service-account.json" (
        start "AnvioTalk Server" /min cmd /c "set FIREBASE_SERVICE_ACCOUNT_JSON=service-account.json&& npm run dev"
    ) else (
        start "AnvioTalk Server" /min cmd /c "npm run dev"
        echo       [WARN] service-account.json nahi mila — ADMIN PANEL SETUP.txt dekho.
    )
    echo       Waiting for server to boot...
    timeout /t 12 /nobreak >nul
) else (
    echo       Server already running.
)

REM Step 2: Verify Electron is installed (already done, but double-check)
echo [2/3] Preparing admin console...
cd admin-desktop
if not exist "node_modules\electron\dist\electron.exe" (
    echo       One-time setup: downloading Electron...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Setup failed. Check internet connection.
        pause
        exit /b 1
    )
)

REM Step 3: Open the admin console window
echo [3/3] Opening Admin Console window...
echo.
echo   ^>^>^> Login: email + password, phir Google Authenticator 6-digit code
echo   ^>^>^> (Pehli baar QR scan karke 2FA setup hoga — one time)
echo.
echo NOTE: Yeh window band karne par admin console bhi band ho jayega.
echo       Server window minimize karke rakh sakte ho.
echo.
call "node_modules\electron\dist\electron.exe" .

echo.
echo [INFO] Admin console closed.
pause
