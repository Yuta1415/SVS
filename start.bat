@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   SVS - Quick Start (dev mode with hot reload)
echo ============================================================
echo.

echo [build] Building images...
docker compose build

if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo [up] Starting services...
docker compose up -d

if errorlevel 1 (
    echo [ERROR] Failed to start containers.
    pause
    exit /b 1
)

echo.
echo [wait] Waiting for API to be ready...
set tries=0
:wait_health
curl --silent --fail --max-time 3 http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 goto health_ok
set /a tries+=1
if !tries! geq 30 (
    echo [WARN] API did not become ready in time. Check logs with: docker compose logs backend
    goto open_browser
)
timeout /t 1 >nul
goto wait_health

:health_ok
echo [OK] API is ready.

:open_browser
echo.
echo ============================================================
echo   SVS is running.
echo.
echo   Web UI ......... http://127.0.0.1:3000
echo   API ............ http://127.0.0.1:8000
echo   Swagger docs ... http://127.0.0.1:8000/docs
echo.
echo   (dev mode: code changes auto-reload, run rebuild.bat to stop)
echo ============================================================
echo.

start http://127.0.0.1:3000

echo To stop: docker compose down
echo To view logs: docker compose logs -f
echo.
endlocal
