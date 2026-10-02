# SVS - Security Vulnerability Scanner

SVS ingests a Git repository or a `.zip` archive, runs four deterministic
scanner engines against it, and reports a security posture score with
per-finding remediation guidance.

There is no AI in the pipeline and no authentication. SVS is a single-user
service that runs on your own laptop: every request resolves to one local
operator row, and every finding comes from a tool whose output you could
reproduce by hand. Scanned code never leaves the host.

---

## Table of contents

- [How the system is formulated](#how-the-system-is-formulated)
- [The technology stack](#the-technology-stack)
- [Architecture at a glance](#architecture-at-a-glance)
- [What actually scans the code](#what-actually-scans-the-code)
- [The scan pipeline, step by step](#the-scan-pipeline-step-by-step)
- [Normalization](#normalization)
- [Deduplication](#deduplication)
- [Scoring](#scoring)
- [Reporting and export](#reporting-and-export)
- [Data model](#data-model)
- [HTTP API](#http-api)
- [Frontend](#frontend)
- [Security posture: what is deliberate and what is not](#security-posture-what-is-deliberate-and-what-is-not)
- [Getting started](#getting-started)
- [Testing and self-checks](#testing-and-self-checks)
- [Operational notes and gotchas](#operational-notes-and-gotchas)
- [Project structure](#project-structure)
- [Repository artifacts outside the app](#repository-artifacts-outside-the-app)

---

## How the system is formulated

SVS was built to a short set of constraints, and most of the code's unusual
choices follow directly from them.

**Deterministic over magical.** Every finding comes from a named open-source
tool running in a pinned container. No model decides what counts as a
vulnerability, so a scan of the same code is the same scan. The score is
arithmetic on the finding set, not an opinion.

**The untrusted input is the scanned code.** A scanner executes inside a repo
an attacker could have authored, so every engine runs as a throwaway sibling
container with a memory cap, a timeout, and the scan directory as its only
view of the filesystem. Network is disabled by default and enabled only for
the two engines that genuinely need it.

**Async by necessity.** Scans run for minutes. The HTTP request that triggers
one returns immediately; a Celery worker owns the pipeline and the frontend
polls until it finishes.

**Single-user, localhost.** Authentication was removed rather than half-built.
The `users` table survives only because `projects.owner_id` has a non-nullable
foreign key to it, and one `local` operator row is created on first request.
This is a deliberate scope decision, not an oversight, and it is what makes
the Docker-socket mount acceptable.

**Honest about exposures.** The trade-offs are documented rather than hidden:
the Docker socket is mounted into the backend and worker, PostgreSQL is
published on 5432, and there is no auth. Each is defensible for a laptop tool
and a liability the moment SVS is exposed publicly.

**Boring code that someone can decode at 3am.** The codebase deliberately
avoids abstractions it does not need: one scanner base class, one normalizer,
one scoring service, no plugin registry. Several files carry `ponytail:`
comments marking deliberate simplifications and naming their ceiling and
upgrade path.

## The technology stack

Everything SVS uses, with the versions actually pinned in the repo.

### Application runtime

| Layer | Technology | Version | Role |
| --- | --- | --- | --- |
| API | FastAPI | 0.115.0 | REST API, Pydantic request/response models |
| ASGI server | uvicorn | 0.30.6 | Serves the API on `:8000` |
| ORM | SQLAlchemy | 2.0.32 | Models, sessions, schema creation |
| DB driver | psycopg2-binary | 2.9.9 | PostgreSQL wire protocol |
| Validation | pydantic / pydantic-settings | 2.7.4 / 2.3.4 | Schemas and typed config from `.env` |
| Multipart | python-multipart | 0.0.9 | `.zip` upload parsing |
| Git | GitPython | 3.1.43 | Present in requirements; ingestion uses a `git clone` subprocess with an explicit timeout instead |
| Docker client | docker (docker-py) | 7.1.0 | Launches and waits on scanner containers |
| Task queue | Celery | 5.4.0 | The scan pipeline worker |
| Broker/result backend | redis (py) | 5.0.3 | Talks to Redis broker and result store |
| PDF | xhtml2pdf | 0.2.16 | HTML-to-PDF report generation |
| Test runner | pytest | 8.3.3 | Scoring unit tests and the pipeline integration test |

### Infrastructure

| Component | Image / tool | Version |
| --- | --- | --- |
| Database | `postgres` | `15-alpine` |
| Message broker | `redis` | `7-alpine` |
| Backend base image | `python` | `3.11-slim` |
| Worker base image | `python` | `3.11-slim` (same image as the backend) |
| Frontend build | `node` | `20-alpine` |
| Frontend serve | `nginx` | `stable-alpine` |

### Frontend

| Technology | Version | Role |
| --- | --- | --- |
| React | 19.0.1 | UI |
| React DOM | 19.0.1 | DOM rendering |
| Vite | 8.3.0 | Build and dev server |
| `@vitejs/plugin-react` | 6.1.1 | React fast-refresh for Vite |
| Tailwind CSS | 4.3.3 | Styling (via `@tailwindcss/vite` 4.3.3) |
| lucide-react | 0.546.0 | Icon set |
| TypeScript | 7.0.2 | Type checking (`npm run lint` is `tsc --noEmit`) |
| autoprefixer / esbuild | 10.4.21 / 0.28.0 | Build tooling |

### CI/CD

GitHub Actions (`.github/workflows/ci-cd.yml`) with four jobs:

1. **lint** - matrix over `python` and `javascript`. Python runs
   `ruff check backend/ --select E9,F63,F7,F82 --exclude backend/tests/fixtures`;
   JavaScript runs `npm run lint` in `frontend/`.
2. **test** - `pytest tests/` on Python 3.11 against PostgreSQL 15 and Redis
   service containers.
3. **build** - on push to `main`, builds and pushes the backend image to
   `ghcr.io/${{ github.repository }}/backend` tagged `latest` and the commit SHA.
4. **deploy** - fires a Railway deploy webhook.

## Architecture at a glance

```mermaid
graph TB
    FE[Browser UI<br/>React/Vite/TS :3000] --> API[FastAPI :8000]
    API --> DB[(PostgreSQL :5432)]
    API --> REDIS[(Redis :6379)]
    API -->|enqueue task| REDIS
    WORKER[Celery Worker] --> REDIS
    WORKER --> DB
    WORKER -->|docker socket| SCANNERS
    subgraph SCANNERS [Throwaway scanner containers]
        S[Semgrep SAST]
        G[Gitleaks Secrets]
        D[pip-audit / npm audit]
        I[Checkov IaC]
    end
    SCANNERS -->|bind-mount read-only| UPLOADS[/tmp/svs_uploads/scan_N]
    WORKER --> UPLOADS
```

Five compose services: `db`, `redis`, `backend`, `worker`, `frontend`. The
backend and the worker are built from the same image - the worker just runs a
different command (`celery -A app.core.celery_app worker --loglevel=info`).

## What actually scans the code

Four engines, each a disposable container launched through the Docker socket.
Every image is pinned by digest, so a tampered or rewritten upstream image
cannot change results between two scans of the same code with nothing in this
repo changing.

| Engine | Finds | Image (digest-pinned) | Network | Memory | Timeout |
| --- | --- | --- | --- | --- | --- |
| Semgrep | SAST patterns: injection, XSS, bad crypto, deserialization | `semgrep/semgrep:1.177.0` | enabled (fetches the ruleset from semgrep.dev) | 512MB, 0.5 CPU | 1800s |
| Gitleaks | Hardcoded secrets and API keys | `zricethezav/gitleaks:v8.9.0` | disabled, fully offline | 256MB | 1800s |
| pip-audit / npm audit | Known-CVE dependencies | `python:3.11-slim` / `node:18.20-alpine` | enabled (fetches the advisory DB) | 512MB | 1800s |
| Checkov | Infrastructure-as-code misconfigurations (Terraform, CloudFormation, Dockerfile) | `bridgecrew/checkov:3.2.431` | disabled | 512MB | 1800s |

Two engines are conditional and skip themselves rather than run a container
that can only find nothing:

- **Dependency scanning** runs the Python branch if the project has a
  `requirements.txt` and the JavaScript branch if it has a `package.json`.
  Neither file means no container.
- **Checkov** walks the tree for `.tf`, `.tf.json`, `.cf.json`,
  `.template.json` or any `Dockerfile*`, skipping `.git`. A pure-Python repo
  pays nothing.

Each container bind-mounts its scan directory, `/tmp/svs_uploads/scan_N`, as
`/src`. Semgrep and pip-audit mount it read-only; Gitleaks and npm audit need
write access (Gitleaks writes its report into the mount, npm audit may
generate a missing lockfile). Both writes are safe because the directory is
deleted when the scan finishes.

## The scan pipeline, step by step

1. **Ingest.** `POST /scans/git`, `POST /scans/upload`, or `POST /scans/demo`.
   A `Scan` row is created with `status = PENDING`.
   - Git: the URL is validated for SSRF (scheme allow-list, hostname resolved
     and every resolved address checked against private/loopback/link-local/
     multicast/reserved ranges, unresolvable names rejected), then
     `git clone --depth=1` runs as a subprocess with a 300s timeout.
   - Zip: the upload is capped at 50MB compressed, and the archive is screened
     for zip bombs *before* extraction - 500MB total uncompressed, or a
     compression ratio above 100:1, is rejected. A `BadZipFile` deletes the
     scan row and returns 400.
   - The target lands at `/tmp/svs_uploads/scan_<id>`.

2. **Dispatch.** `run_security_scan.delay(scan_id, project_id)` enqueues a
   Celery task. The HTTP request returns `scan_id` immediately.

3. **Run.** The worker picks the task up off Redis, sets `status = RUNNING`
   with `start_time`, and runs the four scanners **in sequence**. Each scanner
   persists its own findings and commits as it goes, so a scanner that dies
   still leaves the findings the ones before it produced.

4. **Fail loudly, do not fail silently.** A scanner that breaks raises
   `ScannerError`, which carries the tool name so the failure says *which*
   scanner broke. The pipeline records it and continues with the rest, then
   marks the scan `FAILED` with `error_detail` naming every failed tool.
   Reporting `COMPLETED` with a clean score would hide a broken pipeline as a
   clean repository.

5. **Deduplicate** the combined finding set (below).

6. **Score** the survivors (below), writing the score and the per-severity
   counts onto the scan row.

7. **Finish.** `status` becomes `COMPLETED` (or `FAILED`), `end_time` and
   `duration_seconds` are set. The task deletes the scan directory in a
   `finally` block and closes the session. On an unexpected exception the task
   retries up to 3 times with a 60s countdown.

## Normalization

Every tool speaks a different vocabulary, so all five outputs pass through one
`FindingNormalizer` choke point. Scoring, the API and the PDF all see one
vocabulary afterwards.

| Tool | Native severity | SVS severity |
| --- | --- | --- |
| Semgrep | `ERROR` / `WARNING` / `INFO` | `HIGH` / `MEDIUM` / `INFO` |
| Gitleaks | (none) | always `CRITICAL` |
| pip-audit | (none) | always `HIGH` |
| npm audit | `critical`/`high`/`moderate`/`low`/`info` | same names, `moderate` → `MEDIUM` |
| Checkov | `CRITICAL`/`HIGH`/`MEDIUM`/`LOW` | passed through |

Anything unrecognised falls back to `MEDIUM`, never to zero. This is load
bearing: an unknown severity that scored zero would silently lower a repo's
risk, and npm's `moderate` used to do exactly that before the map existed.

**Remediation guidance is keyed by weakness class**, not by tool. A table of
CWE entries (`normalizer.py`) supplies fix text because most tools ship none:
Semgrep gives a rule name and a message but no fix, and pip-audit only echoes
the advisory description. A class the table does not cover falls through to a
link to its Mitre definition rather than a dead end.

**Secret material never reaches the database.** Gitleaks hands back the matched
secret in `Secret`/`Match`; the normalizer keeps only the rule id. A
self-check asserts the raw value cannot appear anywhere in the finding record,
so a future "add the value for context" change fails the check instead of
storing live credentials.

## Deduplication

Two scanners can flag the same weakness at the same spot - a secret both
Semgrep's hardcoded-credential rule and Gitleaks report. Without collapsing
it, that secret is scored twice and listed twice.

The key is `(file_path, line_number, cwe or vulnerability_type)`: the weakness
class is what makes the match cross-tool, because every scanner uses its own
type label. The highest severity survives; a tie keeps the lowest id so the
survivor does not depend on dict iteration order. The survivor's description
is annotated with the other rule names that flagged the spot, so collapsing
never hides that a second tool saw it too.

Two cases are deliberately excluded:

- **Findings with no line number** are package-level dependency advisories,
  where an identical key means two different vulnerable packages, not one
  finding reported twice.
- **Checkov findings** carry a check id (`CKV_AWS_18`) as their type and no
  CWE. Two policies on one resource are distinct weaknesses and both survive.

## Scoring

```
score = 100 / (1 + risk / 25)
```

`risk` is the weighted sum of findings: **Critical 10, High 7, Medium 4,
Low 1, Info 0**. A clean repo scores 100.

The formula is hyperbolic on purpose. A flat `100 - penalty` saturates at 0,
so a repository with 40 medium findings scored identically to one with 80, and
both to Juice-Shop's 314 risk points - the score stopped ranking anything. The
hyperbolic discount keeps 100 for a clean repo, never reaches 0, and stays
discriminative at every scale: 1 critical → 71, 3 → 45, Juice-Shop's 314 → 7.

Worked example: 1 critical (10) + 1 high (7) + 1 medium (4) + 1 low (1) = 22
risk, `100 / (1 + 22/25)` = **53**.

Unknown severities score as MEDIUM (weight 4) rather than silently zeroing
out. Severity comparison is case-insensitive.

## Reporting and export

Two formats, for two audiences:

- **PDF** (`GET /scans/{scan_id}/export`) - built from an HTML template by
  xhtml2pdf. It carries the score, the severity distribution, and one block
  per finding with its remediation text and triage state. The scoring formula
  and weights are printed on the report so the number can be reproduced
  instead of trusted. Severity colours the left border of each block.
- **SARIF 2.1.0** (`GET /scans/{scan_id}/export/sarif`) - for CI and IDE
  import. `ruleId` prefers the stable CWE class and falls back to the
  tool-specific type. SVS severities collapse into SARIF's closed level
  vocabulary: critical and high → `error`, medium → `warning`, low → `note`,
  info → `none`, so a critical is never silently downgraded in a CI gate.
  Rules are enumerated from what this scan actually found rather than the full
  CWE catalogue, keeping the payload proportional to the report.

## Data model

Four tables, PostgreSQL, created on startup. `Base.metadata.create_all()`
makes the initial tables, then two idempotent
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements apply the schema
changes made since the first release (`triage_status`, `cwe`). Both are
no-ops on an already-migrated database.

```
users  1 - N  projects  1 - N  scans  1 - N  findings
```

- **users** - `id`, `username` (unique), `email` (unique), `hashed_password`,
  `created_at`. Auth is gone; exactly one row (`local`, `local@svs.local`) is
  created on first request and every request resolves to it.
- **projects** - `id`, `name`, `repo_url`, `owner_id` → users, `created_at`.
- **scans** - `id`, `project_id` → projects, `status`
  (`PENDING` / `RUNNING` / `COMPLETED` / `FAILED`), `created_at`,
  `start_time`, `end_time`, `duration_seconds`, `score` (default 100),
  `critical_count` / `high_count` / `medium_count` / `low_count`, and
  `error_detail` (populated when a scanner failed, so a FAILED scan can say
  which tool broke).
- **findings** - `id`, `scan_id` → scans, `vulnerability_type`, `severity`,
  `file_path`, `line_number` (nullable; dependency findings carry 0),
  `description`, `remediation`, `cwe`, `triage_status` (default `open`),
  `created_at`.

Counts are denormalized onto the scan row so the dashboard can aggregate
across every scan in one request instead of one findings call per scan.

The API derives the source tool from `vulnerability_type` rather than storing
a column (`tool_for()` in `scans.py`): `Secret-Leak` → Gitleaks,
`Dependency-Vulnerability` → SCA Audit, anything starting `CKV` → Checkov,
everything else → Semgrep. This needs no migration but is only correct while
the scanners keep those exact type values.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Root banner |
| `GET` | `/health` | Health probe (`{ "status": "healthy" }`) |
| `GET` | `/projects/` | List all projects |
| `POST` | `/projects/` | Create a project (JSON `name`, `repo_url`) |
| `GET` | `/projects/{id}` | One project |
| `DELETE` | `/projects/{id}` | Delete a project and its scans and findings |
| `GET` | `/scans/` | All scans, newest first, with severity counts |
| `GET` | `/scans/project/{project_id}` | Scans for one project |
| `POST` | `/scans/git` | Clone and scan (form: `project_id`, `repo_url`) |
| `POST` | `/scans/upload` | Upload and scan a `.zip` (form: `project_id`, `file`) |
| `POST` | `/scans/demo` | Clone and scan `juice-shop/juice-shop` |
| `GET` | `/scans/{id}` | Scan status, score, counts, duration, `error_detail` |
| `DELETE` | `/scans/{id}` | Delete a scan and its findings |
| `GET` | `/scans/{id}/findings` | Findings with tool, CWE, remediation, triage |
| `PATCH` | `/scans/{id}/findings/{finding_id}` | Set triage (JSON body: `triage`) |
| `GET` | `/scans/{id}/export` | PDF report |
| `GET` | `/scans/{id}/export/sarif` | SARIF 2.1.0 report |

Triage accepts exactly `open`, `resolved`, `false_positive`, `accepted`;
anything else is a 400 rather than silently persisting an unfilterable value.
It is persisted server-side, so a reload keeps the decision - it used to be
client-only, which made the buttons vanish on refresh and worse than absent.

Swagger/OpenAPI docs are at `http://127.0.0.1:8000/docs`.

## Frontend

React 19 + Vite + TypeScript + Tailwind, served by nginx in production.
State lives in `App.tsx`; five views switch on a tab, not a router, so
`App.tsx` holds them all and nginx's SPA fallback is a safety net.

| View | What it does |
| --- | --- |
| `DashboardView` | Every scan with score, severity counts, status; delete, refresh, open report |
| `IngestScanView` | Create a project, paste a Git URL, upload a `.zip`, or run the demo scan |
| `ScanReportView` | Findings table with severity and tool filters, triage buttons, PDF/SARIF export |
| `KnowledgeBaseView` | 8 static write-ups (6 SAST, 1 secrets, 1 dependencies) covering SQLi, hardcoded secrets, insecure deserialization, XSS, weak crypto, vulnerable dependencies, command injection and SSRF, each with vulnerable and secure code examples |
| `ArchitectureDocsView` | Static architecture and API documentation across 14 categories, from setup and persistence through scoring, the worker queue and production readiness |

The service layer is two files: `api.ts` (a `fetch` wrapper with typed
responses, error extraction from FastAPI's `{"detail": ...}`) and `adapter.ts`
(maps API shapes to UI types). The adapter is where the vocabulary differences
get absorbed: API `PENDING`/`RUNNING` both collapse to UI `scanning`,
`SCA Audit` → `dependency-audit`, and the scan's source type is inferred from
the project's `repo_url` because the scan row carries no source field.

The dashboard polls `GET /scans/` every **2500ms** while any scan is in
flight and stops once none are. Findings are fetched on demand when a report
opens, not up front, so the dashboard does not pay one findings call per scan.
Triage updates optimistically and roll back with the reason if the server
refuses.

The API origin is `VITE_API_URL`, baked into the JS bundle at build time
(Vite only exposes `VITE_`-prefixed vars, so CRA's `REACT_APP_` prefix does
nothing here). It defaults to `http://localhost:8000`.

`frontend-cra-legacy/` is the superseded Create React App build, kept for
reference and not part of the compose stack.

## Security posture: what is deliberate and what is not

Deliberate, and defensible for a localhost tool:

- **No authentication.** Single-user instance; one `local` operator row.
- **Docker socket mounted** into backend and worker. This is how the scanner
  containers are launched. It is full host access, and the whole system is
  only as trustworthy as the code it scans.
- **PostgreSQL published on 5432.**
- **Scanners networked selectively.** Network is disabled by default and
  enabled only for Semgrep (ruleset) and the dependency auditors (advisory
  DB). Gitleaks and Checkov run fully offline.
- **Ephemeral scan directories**, deleted in a `finally` when the task ends.

Implemented and active:

- SSRF protection on clone URLs (scheme allow-list, DNS resolution, private
  range rejection).
- Zip-bomb screening before extraction (50MB compressed, 500MB uncompressed,
  100:1 ratio).
- Scanner sandboxing: memory caps, 30-minute timeouts, read-only mounts where
  the tool allows, exit-code handling so a tool that exits 1 *because it found
  something* is not mistaken for a crash.
- Secret material is kept out of the database and the gitleaks report file is
  deleted once read.
- `npm install` runs with `--ignore-scripts`, so a scanner never executes the
  target repo's install or postinstall hooks.

Present in the code but **not currently wired up**:

- **Rate limiting.** `check_rate_limit()` exists in
  `core/rate_limit.py` (5 scans/hour per user, backed by Redis), but no
  endpoint imports or calls it. Do not assume a scan will be refused for
  exceeding the limit.

## Getting started

### Requirements

- Docker Desktop, running.

### The one command

Double-click **`run-svs.bat`**, or from the project root:

```bat
run-svs.bat
```

It starts Docker Desktop if it is not already running, rebuilds the
`backend`, `worker` and `frontend` images, brings the stack up, waits for the
API health check, then opens the browser. The code is baked into the images
rather than bind-mounted, so this rebuild is how your edits take effect.

The scanner images are pulled on the first scan, so the first scan is slower
than later ones.

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
3. Scans run in the Celery worker. The dashboard polls every 2.5s until
   `status` is `complete` or `failed`.
4. In the report view, triage findings (open / resolved / false positive /
   accepted) and export a PDF or SARIF report.

### Useful commands

```bash
docker compose logs -f worker          # scan pipeline output
docker compose logs -f backend         # API output
docker compose ps                      # which containers are up
docker compose exec db psql -U svs_user -d svs_database
docker compose down                    # stop everything (data persists)
docker compose down -v                 # stop and delete the database volume
```

### Local development

`docker-compose.override.yml` bind-mounts `backend/` and `frontend/` for hot
reload. The frontend served on port 3000 is the production build; to develop
with hot reload instead, stop the compose frontend first to avoid a port
conflict, then:

```bash
cd frontend
npm install
npm run dev
```

The API client talks to the API at `VITE_API_URL`, defaulting to
`http://localhost:8000`.

## Testing and self-checks

### Test suite

```bash
docker compose exec backend python -m pytest tests/ -v
```

- `tests/test_scoring.py` - SQLite-in-memory unit tests for the formula:
  clean repo is 100, INFO findings cannot move the score, the mixed
  1/1/1/1 case is exactly 53, ten criticals is 20, 40 mediums rank strictly
  above 80, unknown severities score as MEDIUM, and scoring is monotonic
  across severity classes.
- `tests/test_pipeline.py` - the full containerized pipeline against
  `tests/fixtures/vulnerable_project`; needs the worker images present.

`tests/fixtures/vulnerable_project` is a deliberate three-finding target:
a format-string SQL injection (`CWE-89`), a hardcoded password, and a
hardcoded AWS key (`AKIAIOSFODNN7EXAMPLE`, `CWE-798`).

### In-tree self-checks

Each engine module has a `__main__` self-check runnable without a database or
Docker, asserting the behaviour that would otherwise silently degrade a scan:

```bash
python -m app.engine.scoring      # formula: clean=100, discriminative, ordered
python -m app.engine.scanner      # cross-tool dedup rules
python -m app.engine.normalizer   # severity maps, secret masking, CWE guidance
python -m app.engine.iac_scanner  # IaC file detection and checkov paths
python -m app.engine.ingestion    # zip-bomb rejection
```

## Operational notes and gotchas

- **`localhost` vs `127.0.0.1`.** Use `127.0.0.1`. A VS Code PHP server owns
  `[::1]:3000`; `localhost:3000` opens that mock app instead of SVS. CORS
  allows both spellings, because the browser on either must be accepted.
- **Scanner timeouts are 30 minutes**, raised from 15 after slow repos timed
  out. Raise `DEFAULT_TIMEOUT` in `base_scanner.py` if a very large repo still
  fails. The git clone has a separate 300s timeout.
- **Exit 126 from Gitleaks** was a permission error from calling the binary
  directly; scanners invoke through `sh -c` so the shell resolves the binary.
  Checkov is the exception: its image's entrypoint already runs `checkov`, so
  it takes an argv list and wrapping it in `sh -c` made it fail with
  "unrecognized arguments: sh".
- **Exit code 1 means findings, not failure.** Gitleaks, npm audit and Checkov
  all exit 1 when they find something; those codes are in
  `accept_exit_codes` or the cleanest repo would scan as `FAILED`.
- **A scanner that exits non-zero with no stdout is treated as an error**,
  with the last 500 bytes of stderr attached. Empty stdout with an accepted
  exit code is fine - Gitleaks and npm audit legitimately print nothing on
  clean code.
- **The Gitleaks report is written into the scan directory**, not stdout, and
  is deleted once read because it carries the matched secrets in cleartext.
- **Deleting a scan or project** clears findings first because the foreign
  keys have no `ON DELETE CASCADE`; without this both endpoints used to 500.
- **The worker and the scanners must agree on the real path**
  `/tmp/svs_uploads`, which is why it is a host bind rather than a named
  volume.
- **The branch field does nothing** in the UI; ingestion always clones the
  default branch at depth 1.
- **`.tar.gz` is accepted by the client but rejected by the API**, which
  takes `.zip` only.

## Project structure

```text
SVS/
├── backend/                # Python FastAPI backend + Celery worker (one image)
│   ├── app/
│   │   ├── api/            # routers: scans.py, projects.py, deps.py
│   │   ├── core/           # config.py, celery_app.py, rate_limit.py
│   │   ├── engine/         # the scanning system
│   │   │   ├── base_scanner.py    # container runner, timeout, exit-code handling
│   │   │   ├── semgrep_scanner.py # SAST
│   │   │   ├── gitleaks_scanner.py# secrets
│   │   │   ├── dependency_scanner.py  # pip-audit / npm audit
│   │   │   ├── iac_scanner.py     # Checkov
│   │   │   ├── ingestion.py       # git clone / zip extraction / SSRF / zip bombs
│   │   │   ├── normalizer.py      # one vocabulary + CWE remediation table
│   │   │   ├── scanner.py         # orchestrator + cross-tool deduplication
│   │   │   ├── scoring.py         # the hyperbolic score
│   │   │   ├── reporting.py       # PDF
│   │   │   └── tasks.py           # the Celery task
│   │   ├── models/         # SQLAlchemy: user, project, scan, finding
│   │   ├── schemas/        # Pydantic request/response models
│   │   ├── database.py     # engine + session factory
│   │   └── main.py         # app, CORS, idempotent schema migration
│   └── tests/              # scoring unit tests + pipeline integration test
├── frontend/               # Vite + React 19 + TypeScript + Tailwind
│   └── src/
│       ├── components/     # dashboard, ingest, report, knowledge base, docs
│       ├── data/           # static knowledge base + architecture docs
│       ├── services/       # api.ts (fetch) + adapter.ts (mapping)
│       └── types.ts
├── frontend-cra-legacy/    # the superseded Create React App build, reference only
├── docs/CODEFLOW.md        # mermaid diagrams of every flow
├── docker-compose.yml      # db, redis, backend, worker, frontend
├── docker-compose.override.yml  # dev bind-mounts
├── run-svs.bat             # the one-command launcher
├── start.bat / stop-svs.bat / rebuild.bat / health-check.bat
└── .github/workflows/ci-cd.yml
```

## Repository artifacts outside the app

Not part of the running system, and worth knowing about:

- `docs/CODEFLOW.md` - mermaid diagrams for architecture, scan flow, pipeline,
  schema, API, frontend, Celery, scoring, security and compose. Note these
  partly predate the current code: they show a 15-minute timeout and describe
  the pipeline as three scanners.
- `docs/SVS-System-Documentation.html` and `.pdf` - the long-form system
  documentation the app was specified against.
- `GAP-ANALYSIS.md` - a verification checklist against that documentation,
  dated 2026-09-27. Also partly stale: it lists Semgrep and Gitleaks as
  unpinned, and both now are.
- `DEV-QUICKREF.md`, `TIMEOUT-FIXES.md`, `EXIT-126-FIX.md` - operational
  notes and postmortems for the timeout and exit-126 fixes.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` - spec and plan for
  an unrelated project (a frozen-foods e-commerce site). Leftover workspace
  artifacts, not SVS's own design history.
- `db_dummy_backup_20260921.sql` - a database dump.
- `syft_out.json` / `syft_err.txt` - a Syft SBOM scan of a Python project
  (its `requirements.txt` reports `flask 0.12.1`), not of SVS itself.
