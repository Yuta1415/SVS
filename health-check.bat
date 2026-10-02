@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo   SVS - System Health Check
echo ============================================================
echo.

echo [check] Docker daemon...
docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker daemon is not running.
    exit /b 1
)
echo [OK] Docker daemon is running.

echo.
echo [check] Container status...
docker compose ps
if errorlevel 1 (
    echo [ERROR] Could not get container status.
    exit /b 1
)

echo.
echo [check] API health...
curl --silent --max-time 5 http://127.0.0.1:8000/health
if errorlevel 1 (
    echo [WARN] API health check failed.
    goto end
)

echo.
echo [check] Frontend...
curl --silent --max-time 5 http://127.0.0.1:3000
if errorlevel 1 (
    echo [WARN] Frontend check failed.
    goto end
)

echo.
echo ============================================================
echo   All systems healthy!
echo ============================================================

:end
endlocal
