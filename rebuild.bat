@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo   SVS - Rebuild and Restart
echo ============================================================
echo.

echo [build] Building all images...
docker compose build

if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo [restart] Restarting containers...
docker compose up -d

echo.
echo [wait] Waiting for API to be ready...
set tries=0
:wait_health
curl --silent --fail --max-time 3 http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 goto health_ok
set /a tries+=1
if !tries! geq 30 (
    echo [WARN] API did not become ready in time. Check logs.
    goto end
)
timeout /t 1 >nul
goto wait_health

:health_ok
echo [OK] API is ready.

:end
echo.
echo To view logs: docker compose logs -f
echo To open browser: start http://127.0.0.1:3000

endlocal
