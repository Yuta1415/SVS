@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================================
echo   SVS - Quick stop and cleanup
echo ============================================================

echo [down] Stopping all containers...
docker compose down

echo [cleanup] Removing unused volumes and images...
docker volume prune -f
docker image prune -f

echo.
echo [done] Cleanup complete.
echo To restart: run-svs.bat

endlocal
