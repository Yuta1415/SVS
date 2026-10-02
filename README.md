# SVS - Security Vulnerability Scanner

SVS is a security scanning system that ingests a Git repository or a `.zip`
archive, runs three deterministic engines against it, and reports a security
posture score with per-finding remediation.

There is no AI and no authentication. SVS is a single-user service that runs on
your own laptop; every request resolves to one local operator row.

## What actually scans the code

| Engine | Finds | Container |
| --- | --- | --- |
| Semgrep | SAST patterns (injection, XSS, bad crypto, ...) | `semgrep/semgrep`, 512MB / 15min, egress for the ruleset |
| Gitleaks | Hardcoded secrets and API keys | `zricethezav/gitleaks:latest`, fully offline |
| pip-audit / npm audit | Known-CVE dependencies | `python:3.11-slim` / `node:18-alpine`, egress for the advisory DB |

Scanners run as throwaway sibling containers via the Docker socket. Scanned
code never leaves the host; only the Semgrep ruleset and the CVE advisory
database are fetched over the network.

## Scoring

`score = 100 / (1 + risk / 25)`, where risk is the weighted sum of findings:
Critical 10, High 7, Medium 4, Low 1, Info 0. A clean repo is 100. The
hyperbolic discount means the score never clamps to zero, so a repository with
300 findings still ranks below one with 30, which a flat `100 - penalty`
formula could not do.

## Project structure

```text
SVS/
├── backend/                # Python FastAPI backend + Celery worker (one image)
│   ├── app/
│   │   ├── api/            # routers: /scans, /projects
│   │   ├── engine/         # ingestion, scanner adapters, scoring, reporting
│   │   ├── models/         # SQLAlchemy models (project, scan, finding, user)
│   │   ├── core/           # config, celery, rate limiting
│   │   └── main.py         # startup + idempotent schema migration
│   └── tests/              # scoring unit tests + pipeline integration test
├── frontend/               # Vite + React + TypeScript + Tailwind frontend
│   └── src/
│       ├── components/     # views: dashboard, ingest, report, KB, docs
│       ├── data/           # static knowledge base + architecture docs
│       ├── services/       # api.ts (fetch) + adapter.ts (mapping)
│       └── types.ts
├── frontend-cra-legacy/    # the superseded Create React App build, kept for reference
├── docker-compose.yml      # db, redis, backend, worker, frontend
├── run-svs.bat             # the one-command launcher
└── start.bat               # bare `up --build` + open browser
```

## Getting started

### Requirements

- Docker Desktop, running

### The one command

Double-click **`run-svs.bat`**, or from the project root:

```bat
run-svs.bat
```

It starts Docker Desktop if it is not already running, rebuilds the
`backend`, `worker` and `frontend` images (the code is baked into them, not
bind-mounted, so this is how your edits take effect), brings the stack up,
waits for the API health check, then opens the browser.

The first build pulls the scanner images on the first scan, so the first scan
is slower than later ones.

### URLs

Use `127.0.0.1`, not `localhost`. A VS Code PHP server already owns
`[::1]:3000`, so `localhost:3000` opens that mock app instead of SVS.

| URL | What it is |
| --- | --- |
| http://127.0.0.1:3000 | React frontend (nginx) |
| http://127.0.0.1:8000 | FastAPI API |
| http://127.0.0.1:8000/docs | Swagger / OpenAPI docs |
| http://127.0.0.1:8000/health | Health check |

### Run your first scan

1. Open the app. There is no login; the dashboard loads immediately.
2. Press **Launch Security Scan**, then use the **Demo** target, which clones
   `juice-shop/juice-shop` and scans it, or create a project and paste a
   public Git repository URL / upload a `.zip`.
3. Scans run in the Celery worker. The dashboard row and the report view poll
   until `status` is `complete` or `failed`.
4. In the report view, triage findings (open / resolved / false positive /
   accepted) and export a PDF report (`GET /scans/{scan_id}/export`).

### Useful commands

```bash
docker compose logs -f worker          # scan pipeline output
docker compose logs -f backend         # API output
docker compose ps                      # which containers are up
docker compose down                    # stop everything (data persists in volumes)
docker compose down -v                 # stop and delete the database volume
```

### Backend tests

```bash
docker compose exec backend python -m pytest tests/test_scoring.py -q
```

`tests/test_pipeline.py` runs the full containerized pipeline against
`tests/fixtures/vulnerable_project` and needs the worker images present.

### Local frontend development (optional)

The frontend served on port 3000 is the production build. To develop with hot
reload instead, stop the compose frontend first to avoid a port conflict, then:

```bash
cd frontend
npm install
npm run dev
```

This serves on http://127.0.0.1:3000. The API client (`src/services/api.ts`)
talks to the API at the URL in `VITE_API_URL`, defaulting to
`http://localhost:8000`.
