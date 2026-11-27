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
scanner running as a local command. No model decides what counts as a
vulnerability. The score is arithmetic on the finding set, not an opinion.

**The scanned source is treated as data.** Scanner commands read source files;
SVS does not run the repository's application or install hooks. JavaScript
lockfile generation uses `--ignore-scripts`. Scanners run on the host, not in
containers, so use this local-only application with repositories you trust.

**Async by necessity.** Scans run for minutes. The HTTP request that triggers
one returns immediately; a bounded local thread pool owns the pipeline and the
frontend polls until it finishes.

**Single-user, localhost.** Authentication was removed rather than half-built.
The `users` table survives only because `projects.owner_id` has a non-nullable
foreign key to it, and one `local` operator row is created on first request.
This is a deliberate scope decision, not an oversight, and it is what makes
the local-only deployment acceptable.

**Honest about exposures.** The trade-offs are documented rather than hidden:
scanner tools run with the backend user's host permissions, SQLite stores data
in a local file, and there is no auth. This is for localhost use only.

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
| ASGI server | uvicorn | 0.35.0 | Serves the API on `:8000` |
| ORM | SQLAlchemy | 2.0.32 | Models, sessions, schema creation |
| Database | SQLite | built in | Local `svs.db` file |
| Validation | pydantic / pydantic-settings | 2.11.7 / 2.10.1 | Schemas and typed config from `.env` |
| Multipart | python-multipart | 0.0.9 | `.zip` upload parsing |
| Git | Git CLI | host executable | Clones repositories with an explicit timeout |
| Background tasks | `ThreadPoolExecutor` | Python standard library | Runs scans without a broker |
| Static analysis | Semgrep | 1.177.0 | SAST |
| Python dependencies | pip-audit | 2.9.0 | Known-CVE dependency audit |
| IaC analysis | Checkov | 3.2.431 | Infrastructure-as-code checks |
| Secret scanning | Gitleaks | host executable | Hardcoded secrets |
| PDF | xhtml2pdf | 0.2.16 | HTML-to-PDF report generation |
| Test runner | pytest | 8.3.3 | Scoring, orchestration, and subprocess tests |

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
2. **test** - `pytest tests/` against isolated SQLite databases.
3. **build** - on push to `main`, builds and pushes the backend image to
   `ghcr.io/${{ github.repository }}/backend` tagged `latest` and the commit SHA.
4. **deploy** - fires a Railway deploy webhook.

## Architecture at a glance

```mermaid
graph TB
    FE[Browser UI<br/>React/Vite/TS :3000] --> API[FastAPI :8000]
    API --> DB[(SQLite svs.db)]
    API -->|submit task| POOL[Local thread pool]
    POOL --> DB
    POOL -->|subprocess| SCANNERS
    subgraph SCANNERS [Local scanner tools]
        S[Semgrep SAST]
        G[Gitleaks Secrets]
        D[pip-audit / npm audit]
        I[Checkov IaC]
    end
    POOL --> UPLOADS["Temporary scan directory"]
```

The API and frontend run locally. SQLite stores application data; no Docker
daemon, Redis service, or Celery worker is required.

## What actually scans the code

Four engines run as local executables. Install the versions below in the
backend environment, and install Gitleaks separately as a host executable.

| Engine | Finds | Executable | Network | Timeout |
| --- | --- | --- | --- | --- |
| Semgrep | SAST patterns: injection, XSS, bad crypto, deserialization | `semgrep` | enabled for ruleset retrieval | 1800s |
| Gitleaks | Hardcoded secrets and API keys | `gitleaks` | offline | 1800s |
| pip-audit / npm audit | Known-CVE dependencies | backend Python / `npm` | enabled for advisory data | 1800s |
| Checkov | Infrastructure-as-code misconfigurations (Terraform, CloudFormation, Dockerfile) | `checkov` | enabled as required by tool configuration | 1800s |

Two engines are conditional and skip themselves rather than run a container
that can only find nothing:

- **Dependency scanning** checks nested `requirements.txt` and `package.json`
  manifests, including when a ZIP has a single top-level project directory.
- **Checkov** walks the tree for `.tf`, `.tf.json`, `.cf.json`,
  `.template.json` or any `Dockerfile*`, skipping `.git`. A pure-Python repo
  pays nothing.

Scan sources are unpacked under the operating system's temporary directory
and removed when the background task finishes. Gitleaks writes a temporary
report there; npm may generate a lockfile with install scripts disabled.

## The scan pipeline, step by step

1. **Ingest.** `POST /scans/git`, `POST /scans/upload`, or `POST /scans/demo`.
   A `Scan` row is created with `status = PENDING`.
   - Git: the URL is validated for SSRF (scheme allow-list, hostname resolved
     and every resolved address checked against private/loopback/link-local/
     multicast/reserved ranges, unresolvable names rejected), then
     `git clone --depth=1` runs as a subprocess with a 300s timeout. An
     optional branch or tag is passed to Git; blank uses the repository default.
   - Zip: the upload is capped at 50MB compressed, and the archive is screened
     for zip bombs *before* extraction - 500MB total uncompressed, or a
     compression ratio above 100:1, is rejected. Invalid or rejected archives
     delete their pending scan row and temporary directory before returning.
     The upload is read only up to the configured cap plus one byte.
   - The target lands at `/tmp/svs_uploads/scan_<id>`.

2. **Dispatch.** `run_security_scan(scan_id, project_id)` submits work to the
   local thread pool. The HTTP request returns `scan_id` immediately.

3. **Run.** The background worker sets `status = RUNNING` with `start_time`,
   then runs the four scanners **in sequence**. Each scanner
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
   records the failure before cleanup.

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

Four tables, SQLite, created on startup. `Base.metadata.create_all()` makes
the initial tables, then schema inspection adds any missing `triage_status`
and `cwe` columns. The migration works with SQLite, which does not support
`ADD COLUMN IF NOT EXISTS`.

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
| `GET` | `/health` | Health probe; checks the database and returns 503 if it cannot read it |
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
reference only.

## Security posture: what is deliberate and what is not

Deliberate, and defensible for a localhost tool:

- **No authentication.** Single-user instance; one `local` operator row.
- **Host-executed scanners.** Tools run as the backend user's account and
  receive access to the local source directory. Do not expose the API or use
  it to process untrusted repositories on a shared host.
- **SQLite storage.** The database is a local file in the backend working
  directory.
- **Scanner network access.** Semgrep and dependency auditors need network for
  rules/advisory data; local scanner execution does not provide container
  network isolation.
- **Ephemeral scan directories**, deleted in a `finally` when the task ends.

Implemented and active:

- SSRF protection on clone URLs (scheme allow-list, DNS resolution, private
  range rejection).
- Zip-bomb screening before extraction (50MB compressed, 500MB uncompressed,
  100:1 ratio).
- Scanner subprocesses have 30-minute timeouts and tool-specific exit-code
  handling so a tool that exits 1 *because it found something* is not mistaken
  for a crash.
- Secret material is kept out of the database and the gitleaks report file is
  deleted once read.
- `npm install` runs with `--ignore-scripts`, so a scanner never executes the
  target repo's install or postinstall hooks.

Present in the code but **not currently wired up**:

- **Rate limiting.** `check_rate_limit()` exists in
  `core/rate_limit.py` (5 scans/hour, backed by Redis), but no
  endpoint imports or calls it. Do not assume a scan will be refused for
  exceeding the limit.

## Screenshots

> Add screenshots to `docs/screenshots/` and update the paths below.

| Dashboard | Scan Report |
|-----------|-------------|
| ![Dashboard](docs/screenshots/dashboard.png) | ![Scan Report](docs/screenshots/scan-report.png) |

## Getting started

### Requirements

- Standard Windows CPython 3.11, 3.12, or 3.13 (not an MSYS/MINGW Python build)
- Node.js and npm
- Git (for Git URL ingestion)
- Gitleaks installed and available on `PATH`
- Internet access for Semgrep rules and dependency advisory data

### Install and start

Install the backend scanner packages and frontend dependencies once:

```bat
cd backend
py -3.12 -m venv .venv-cpython
.venv-cpython\Scripts\activate
python -m pip install -r requirements.txt
cd ..\frontend
npm install
```

Then double-click **`run-svs.bat`** from the project root. It starts the API
and frontend locally, waits for the API health check, then opens the browser.
The launcher prefers `backend\.venv-cpython`, then `backend\.venv`; otherwise
it uses `python` from `PATH`. Use standard Windows CPython to create the venv,
not an MSYS/MINGW interpreter, because the pinned `pydantic-core` dependency
requires a compatible CPython wheel.

Gitleaks is a separate executable and must be installed on `PATH`:
`winget install Gitleaks.Gitleaks`. `run-svs.bat` also checks the winget links
directory, so a shell that has not picked up the new `PATH` yet still finds it.
The API stores its SQLite database as `backend\svs.db` when launched by the
batch file.

### URLs

Use `127.0.0.1`, not `localhost`, if another local server owns the localhost
binding.

| URL | What it is |
| --- | --- |
| http://127.0.0.1:3000 | React frontend (Vite) |
| http://127.0.0.1:8000 | FastAPI API |
| http://127.0.0.1:8000/docs | Swagger / OpenAPI docs |
| http://127.0.0.1:8000/health | Health check |

### Run your first scan

1. Open the app. There is no login; the dashboard loads immediately.
2. Press **Launch Security Scan**, then use the **Demo** target, which clones
   `juice-shop/juice-shop` and scans it, or create a project and paste a
   public Git repository URL / upload a `.zip`.
3. Scans run in a local background thread. The dashboard polls every 2.5s until
   `status` is `complete` or `failed`.
4. In the report view, triage findings (open / resolved / false positive /
   accepted) and export a PDF or SARIF report.

### Local development

```bash
cd frontend
npm run dev
```

In a separate terminal, run `python -m uvicorn app.main:app --reload` from
`backend\` with its virtual environment activated. The API client talks to
`VITE_API_URL`, defaulting to `http://localhost:8000`.

## Testing and self-checks

### Test suite

```bash
cd backend
python -m pytest tests/ -v
```

- `tests/test_scoring.py` - SQLite-in-memory unit tests for the formula:
  clean repo is 100, INFO findings cannot move the score, the mixed
  1/1/1/1 case is exactly 53, ten criticals is 20, 40 mediums rank strictly
  above 80, unknown severities score as MEDIUM, and scoring is monotonic
  across severity classes.
- `tests/test_pipeline.py` - pipeline orchestration using scanner stubs.
- `tests/test_scanner_commands.py` - subprocess error handling and nested
  manifest discovery.

`tests/fixtures/vulnerable_project` is a deliberate three-finding target:
a format-string SQL injection (`CWE-89`), a hardcoded password, and a
hardcoded AWS key (`AKIAIOSFODNN7EXAMPLE`, `CWE-798`).

### In-tree self-checks

Several engine modules have a `__main__` self-check runnable without a
database or scanner installation, asserting behavior that would otherwise
silently degrade a scan:

```bash
python -m app.engine.scoring      # formula: clean=100, discriminative, ordered
python -m app.engine.scanner      # cross-tool dedup rules
python -m app.engine.normalizer   # severity maps, secret masking, CWE guidance
python -m app.engine.iac_scanner  # IaC file detection and Checkov paths
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
- **Exit code 1 means findings, not failure.** Gitleaks, pip-audit, npm audit
  and Checkov all exit 1 when they find something; those codes are in
  `accept_exit_codes` or the cleanest repo would scan as `FAILED`.
- **A restart fails interrupted scans.** The queue is an in-process thread
  pool, so scans left `PENDING`/`RUNNING` by a previous process are marked
  `FAILED` on startup with an explicit reason instead of polling forever.
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
- **ZIP uploads only.** The UI and API both accept `.zip` archives; tarballs
  are not supported.
- **Branch and tag selection applies only to Git scans.** Leave it blank to
  clone the remote default branch. Commit hashes are not accepted by this
  field.

## Project structure

```text
SVS/
├── backend/                # Python FastAPI backend + local scan worker
│   ├── app/
│   │   ├── api/            # routers: scans.py, projects.py, deps.py
│   │   ├── core/           # config.py, celery_app.py, rate_limit.py
│   │   ├── engine/         # the scanning system
│   │   │   ├── base_scanner.py    # local command runner, timeout, exit-code handling
│   │   │   ├── semgrep_scanner.py # SAST
│   │   │   ├── gitleaks_scanner.py# secrets
│   │   │   ├── dependency_scanner.py  # pip-audit / npm audit
│   │   │   ├── iac_scanner.py     # Checkov
│   │   │   ├── ingestion.py       # git clone / zip extraction / SSRF / zip bombs
│   │   │   ├── normalizer.py      # one vocabulary + CWE remediation table
│   │   │   ├── scanner.py         # orchestrator + cross-tool deduplication
│   │   │   ├── scoring.py         # the hyperbolic score
│   │   │   ├── reporting.py       # PDF
│   │   │   └── tasks.py           # local background task
│   │   ├── models/         # SQLAlchemy: user, project, scan, finding
│   │   ├── schemas/        # Pydantic request/response models
│   │   ├── database.py     # SQLite engine + session factory
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
├── run-svs.bat             # the one-command launcher
├── start.bat / stop-svs.bat / rebuild.bat / health-check.bat  # legacy Docker scripts
└── .github/workflows/ci-cd.yml
```

## Repository artifacts outside the app

Not part of the running system, and worth knowing about:

- `docs/CODEFLOW.md` - current local architecture and scan-flow diagrams.
- `docs/SVS-System-Documentation.html` and `.pdf` - the long-form system
  documentation from the previous Docker/Celery deployment.
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
