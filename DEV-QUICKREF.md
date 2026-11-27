# SVS - Development Quick Reference

The supported local setup is two processes: a FastAPI backend and a Vite frontend.
No Docker, database server, Redis, or Celery is involved.

## Quick Start

| Command | Description |
|---------|-------------|
| `run-svs.bat` | Start the API and frontend, wait for health, open the browser |
| `backend\.venv-cpython\Scripts\python.exe -m uvicorn app.main:app --reload` | Run the API manually from `backend\` |
| `npm run dev` | Run the Vite frontend manually from `frontend\` |
| `health-check.bat` | Query the API health endpoint |

`run-svs.bat` prefers `backend\.venv-cpython`, then `backend\.venv`, then
`python` from `PATH`. It also adds the winget Gitleaks link directory to `PATH`
when Gitleaks is not already visible.

## URLs

| Service | URL |
|---------|-----|
| Frontend UI | http://127.0.0.1:3000 |
| API | http://127.0.0.1:8000 |
| Swagger Docs | http://127.0.0.1:8000/docs |
| API Health | http://127.0.0.1:8000/health |

Use `127.0.0.1` consistently. The frontend picks the API host from the page's
own hostname, so `localhost` and `127.0.0.1` both work without a rebuild.

## Development Tips

### Backend changes

The manual uvicorn command above uses `--reload`. `run-svs.bat` also starts
uvicorn with `--reload`, so edits under `backend\app` restart the API.

### Frontend changes

Vite serves with hot module replacement. Build a production bundle with:

```bash
cd frontend
npm run build
```

If `frontend\dist` exists, the API also serves that build at
http://127.0.0.1:8000/.

### Database

SQLite file: `backend\svs.db`.

Reset it only when you mean to lose all projects, scans, findings, and triage
state:

```bash
del backend\svs.db
```

The schema is created on the next API start.

### Scanner requirements

| Tool | Provided by |
|------|-------------|
| Semgrep | `backend\.venv-cpython` |
| pip-audit | `backend\.venv-cpython` |
| Checkov | `backend\.venv-cpython` |
| Gitleaks | host executable (`winget install Gitleaks.Gitleaks`) |
| npm / node | Node.js install, used by `npm audit` |
| git | Git install, used to clone repositories |

Semgrep and the dependency scanners need network access for rules and advisory
data. Gitleaks runs offline.

## Testing

```bash
cd backend
.venv-cpython\Scripts\python.exe -m pytest tests -v
```

Single module:

```bash
.venv-cpython\Scripts\python.exe -m pytest tests\test_scoring.py -v
```

Frontend type check and build:

```bash
cd frontend
npm run lint
npm run build
```

## Troubleshooting

### API health returns 503

The API cannot read `backend\svs.db`. Check file permissions and whether another
process holds an exclusive lock. A healthy response is `{"status":"healthy"}`.

### Port already in use

```powershell
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

Repeat for port 8000 if the API fails to bind.

### A scan finishes as FAILED

Open the scan's error detail. Each failing scanner is named there:

- `required executable 'gitleaks' was not found on PATH` - install Gitleaks.
- `required executable 'npm' was not found on PATH` - install Node.js.
- Semgrep config or network errors - check internet access to semgrep.dev.
- `pip-audit` network or resolver errors - check PyPI access.

A scan interrupted by restarting the API is marked FAILED on purpose; run it
again.

### Gitleaks installed but not found

Restart the terminal or open a new one. `run-svs.bat` also checks
`%LOCALAPPDATA%\Microsoft\WinGet\Links\gitleaks.exe` directly.
