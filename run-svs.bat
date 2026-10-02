@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   SVS - Security Vulnerability Scanner - one-command launch
echo ============================================================
echo.

REM Docker Desktop is not always running when the laptop boots. Without this
REM check the build fails with a confusing "daemon not running" npipe error.
docker info >nul 2>&1
if errorlevel 1 (
    echo [start] Docker daemon is not up. Starting Docker Desktop...
    start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    set tries=0
    :wait_docker
    docker info >nul 2>&1
    if not errorlevel 1 goto docker_up
    set /a tries+=1
    if !tries! geq 90 (
        echo [error] Docker Desktop did not come up in ~90s. Start it manually and re-run this file.
        pause
        exit /b 1
    )
    timeout /t 1 >nul
    goto wait_docker
)
:docker_up
echo [ok] Docker daemon is up.
echo.

REM Code is baked into the images, not bind-mounted, so any edit - backend or
REM frontend - only takes effect after a rebuild. Building every launch costs
REM seconds when nothing changed (layer cache) and is what keeps the running
REM system honest.
echo [build] Building backend, worker and frontend images...
docker compose build backend worker frontend
if errorlevel 1 (
    echo [error] Image build failed. See the output above.
    pause
    exit /b 1
)
echo.

echo [up] Starting the stack...
docker compose up -d
if errorlevel 1 (
    echo [error] Stack startup failed. See the output above.
    pause
    exit /b 1
)
echo.

REM The backend takes a moment to accept connections: it runs the schema
REM migration on boot. Wait for the health probe before opening the browser.
echo [wait] Probing the API health endpoint...
set tries=0
:wait_health
curl --silent --fail --max-time 3 http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 goto health_ok
set /a tries+=1
if !tries! geq 60 goto health_timeout
timeout /t 2 >nul
goto wait_health

:health_timeout
echo [warn] The API did not answer /health in time. The frontend may still be reachable.
goto open_browser

:health_ok
echo [ok] API is healthy.
echo.

:open_browser
echo ============================================================
echo   SVS is running.
echo.
echo   Web UI ......... http://127.0.0.1:3000
echo   API ............ http://127.0.0.1:8000
echo   Swagger docs ... http://127.0.0.1:8000/docs
echo.
echo   NOTE: use 127.0.0.1, not "localhost". A VS Code PHP server
echo   already owns [::1]:3000, so "localhost:3000" shows that mock
echo   app instead of SVS.
echo ============================================================
echo.

REM Same reason as the note above: 127.0.0.1 is the only spelling that
REM reliably reaches the Docker-published port.
start http://127.0.0.1:3000

echo.
echo To stop:  docker compose down
echo To see logs: docker compose logs -f backend worker
echo.
endlocal
