@echo off
title Anvio Talk - Local Server
cd /d "%~dp0"

echo ============================================
echo   ANVIO TALK - Local Server
echo ============================================
echo.

REM Node.js check
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found!
    echo Please install Node.js from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

REM First time: install dependencies
if not exist "node_modules" (
    echo [SETUP] First run: installing dependencies, please wait 2-3 minutes...
    echo.
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Check your internet connection.
        pause
        exit /b 1
    )
    echo.
)

echo [OK] Starting server on http://localhost:3000
echo.

REM Service account (Firestore admin data): agar service-account.json project folder me hai
REM to server use automatically utha lega (Admin Panel ke liye zaroori).
if exist "service-account.json" (
    echo [OK] service-account.json mila — full Firestore access on.
    set FIREBASE_SERVICE_ACCOUNT_JSON=service-account.json
) else (
    echo [WARN] service-account.json nahi mila — Admin Panel ka data load nahi hoga.
    echo        (Setup: ADMIN PANEL SETUP.txt dekho — 2 minute ka kaam hai.)
)
echo.
echo Browser will open automatically in 4 seconds...
echo (Server window ko minimize kar sakte ho, band mat karna)
echo.

REM Open browser after 4s (server takes a moment to start)
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000"

REM Run the server (Ctrl+C ya window band karne se app band)
call npm run dev

echo.
echo [INFO] Server stopped. App band ho gayi.
pause
