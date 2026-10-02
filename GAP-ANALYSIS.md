# SVS System Gap Analysis
*Based on SVS-System-Documentation.pdf*

---

## ✅ Verifications Complete

### Documentation ✅
| Component | Verified | Notes |
|-----------|----------|-------|
| **API Routes** | ✅ | All documented routes implemented: `/scans/git`, `/scans/upload`, `/scans/demo`, `/scans/`, `/scans/{id}`, `/scans/{id}/findings`, `/scans/{id}/export` |
| **Database Schema** | ✅ | All tables present: `users`, `projects`, `scans`, `findings` |
| **Scoring Formula** | ✅ | `score = 100 / (1 + risk / 25)` with weights: CRITICAL=10, HIGH=7, MEDIUM=4, LOW=1, INFO=0 |
| **Findings Normalization** | ✅ | Severity maps implemented: Semgrep (ERROR→HIGH, WARNING→MEDIUM), npm (moderate→MEDIUM) |
| **Rate Limiting** | ✅ | 5 scans/hour per user via Redis |
| **SSRF Protection** | ✅ | Server-side DNS resolution + client-side validation |
| **Upload Limits** | ✅ | 50MB max, 500MB uncompressed, 100:1 compression ratio check |

### Scanner Pipeline ✅
| Scanner | Image | Pinned |
|---------|-------|--------|
| **Semgrep** | `semgrep/semgrep` | ❌ Unpinned |
| **Gitleaks** | `zricethezav/gitleaks:latest` | ❌ Unpinned |
| **pip-audit** | `python:3.11-slim@sha256:da047cb...` | ✅ SHA256 pinned |
| **npm audit** | `node:18.20-alpine@sha256:8d6421d...` | ✅ SHA256 pinned |
| **Checkov (IaC)** | `bridgecrew/checkov:3.2.431@sha256:6fdac50...` | ✅ SHA256 pinned |

### Container Contract ✅
| Feature | Implementation |
|---------|----------------|
| Detached execution with `container.wait()` | ✅ |
| 15-minute timeout (900s) | ✅ |
| Exit code flexibility `(0, 1)` for tools that exit 1 on findings | ✅ |
| Memory limits (256m-512m) | ✅ |
| Network disabled by default, enabled for Semgrep/SCA | ✅ |
| Cleanup in `finally` blocks | ✅ |

### Frontend ✅
| Component | Status |
|-----------|--------|
| Five views (Dashboard, Ingest, Report, KB, Architecture) | ✅ |
| Service layer (`api.ts`, `adapter.ts`) | ✅ |
| Polling (2.5s while scanning) | ✅ |
| Triage persistence via `PATCH /scans/{id}/findings/{fid}` | ✅ |

---

## ⚠️ Known Limitations (Per Documentation)

| Limitation | Status | Impact |
|------------|--------|--------|
| No per-stage status in API | ✅ Documented | UI shows timed approximation |
| Branch field does nothing | ✅ Documented | Always clones default branch at depth 1 |
| No code snippets/CWE columns | ✅ Documented | Scanned tree deleted after scan |
| No ownership/multi-tenancy | ✅ Documented | Single-user local instance |
| `.tar.gz` UI but only `.zip` API | ✅ Documented | Client accepts both, server rejects `.tar.gz` |
| Docker socket mounted | ✅ Documented | Full host compromise if API exposed |
| No authentication | ✅ Documented | Intentional design decision |

---

## 🔧 Automated Scripts Created

| Script | Purpose |
|--------|---------|
| `run-svs.bat` | One-command production build + start |
| `start.bat` | Dev mode with hot reload |
| `stop-svs.bat` | Stop and cleanup |
| `rebuild.bat` | Rebuild all images |
| `health-check.bat` | Verify all services healthy |

---

## 📦 VS Code Integration

| Feature | File |
|---------|------|
| Workspace settings | `.vscode/settings.json` |
| Extensions list | `.vscode/extensions.json` |
| Task shortcuts | `.vscode/tasks.json` |

---

## 📋 Verification Checklist

### Backend
- [x] `app/main.py` - FastAPI app, CORS, migration
- [x] `app/database.py` - SQLAlchemy engine, SessionLocal
- [x] `app/api/scans.py` - All scan routes
- [x] `app/api/projects.py` - Project CRUD
- [x] `app/engine/ingestion.py` - SSRF validation, git/zip ingestion
- [x] `app/engine/scanner.py` - Pipeline orchestrator
- [x] `app/engine/tasks.py` - Celery task
- [x] `app/engine/scoring.py` - Scoring formula
- [x] `app/engine/normalizer.py` - Severity maps
- [x] `app/engine/semgrep_scanner.py` - SAST scanning
- [x] `app/engine/gitleaks_scanner.py` - Secret detection
- [x] `app/engine/dependency_scanner.py` - SCA scanning
- [x] `app/engine/iac_scanner.py` - Infrastructure as Code scanning
- [x] `app/engine/reporting.py` - PDF generation

### Frontend
- [x] `src/App.tsx` - Application shell, state, polling
- [x] `src/services/api.ts` - Fetch wrapper
- [x] `src/services/adapter.ts` - API→UI mapping
- [x] `src/types.ts` - TypeScript definitions

### Infrastructure
- [x] `docker-compose.yml` - 5 services (db, redis, backend, worker, frontend)
- [x] `.env` - Configuration template
- [x] `run-svs.bat` - One-command launcher

---

## 📌 Notes

1. **Documentation matches implementation** - All major components documented in the PDF are present in the code.

2. **Security posture documented** - The system correctly documents its "honest exposures" (Docker socket, no auth, published PostgreSQL) as intentional trade-offs for single-user deployment.

3. **No AI involvement** - All findings from deterministic tools, scoring is arithmetic. No ML/LLM in pipeline.

4. **Hyperbolic scoring** - Score never reaches 0 (ceiling property), maintains discriminative ranking at all scales.

---

*Generated: 2026-09-27*
