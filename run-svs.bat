@echo off
setlocal
cd /d "%~dp0"

echo.
echo ============================================================
echo   SVS - Security Vulnerability Scanner - local launch
echo ============================================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo [error] Node.js and npm are required for the frontend.
    pause
    exit /b 1
)

rem Gitleaks is installed by winget into a links directory that may not be on
rem this shell's PATH yet. Add it explicitly when it is not found.
where gitleaks >nul 2>&1
if errorlevel 1 if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\gitleaks.exe" set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"

set "PYTHON=python"
if exist "%~dp0backend\.venv-cpython\Scripts\python.exe" set "PYTHON=%~dp0backend\.venv-cpython\Scripts\python.exe"
if exist "%~dp0backend\.venv\Scripts\python.exe" if not exist "%~dp0backend\.venv-cpython\Scripts\python.exe" set "PYTHON=%~dp0backend\.venv\Scripts\python.exe"
if exist "%~dp0backend\.venv-cpython\Scripts" set "PATH=%~dp0backend\.venv-cpython\Scripts;%PATH%"
if exist "%~dp0backend\.venv\Scripts" if not exist "%~dp0backend\.venv-cpython\Scripts" set "PATH=%~dp0backend\.venv\Scripts;%PATH%"

"%PYTHON%" -c "import fastapi, pydantic_core" >nul 2>&1
if errorlevel 1 (
    echo [error] The backend Python environment is incomplete or incompatible.
    echo Create backend\.venv-cpython with standard Windows CPython 3.11, 3.12, or 3.13,
    echo then run: backend\.venv-cpython\Scripts\python.exe -m pip install -r backend\requirements.txt
    pause
    exit /b 1
)

echo [start] Launching the local API and frontend...
start "SVS API" /D "%~dp0backend" "%PYTHON%" -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
start "SVS Frontend" /D "%~dp0frontend" cmd /k npm run dev -- --host 127.0.0.1

set "TRIES=0"
:wait_health
curl --silent --fail --max-time 3 http://127.0.0.1:8000/health >nul 2>&1
if not errorlevel 1 goto health_ok
set /a TRIES+=1
if %TRIES% geq 30 goto health_timeout
timeout /t 2 >nul
goto wait_health

:health_timeout
echo [error] The API did not become healthy. Check the SVS API window.
pause
exit /b 1

:health_ok
echo [ok] API is healthy.
echo.
echo   Web UI ......... http://127.0.0.1:3000
echo   API ............ http://127.0.0.1:8000
echo   Swagger docs ... http://127.0.0.1:8000/docs
echo.
start http://127.0.0.1:3000
echo Close the SVS API and SVS Frontend windows to stop the system.
echo.
endlocal
