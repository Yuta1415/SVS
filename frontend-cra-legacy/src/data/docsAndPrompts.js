// Static educational content for the Architecture docs view. The endpoint list
// and pipeline diagram below mirror the deployed backend exactly; the reference
// design's fictional /api/v1 routes were replaced with the real contract.

export const BACKEND_ARCHITECTURE_DOC = {
  title: 'SVS: Security Vulnerability Scanner — Backend Architecture & API Specifications',
  overview: `SVS (Security Vulnerability Scanner) is an asynchronous vulnerability scanning platform designed to ingest code repositories or archive bundles, execute multi-engine static application security testing (SAST), secrets scanning, and software composition analysis (SCA), and compute an objective security posture score with actionable remediation guidance.`,
  corePrinciples: [
    'Complete Sandboxing: Zero network access and strict CPU/RAM limits for scanner containers.',
    'Asynchronous Job Queue: Celery + Redis ensures HTTP APIs never block during multi-minute scan runs.',
    'Defensive Ingestion: Zip-only uploads and SSRF-hardened Git cloning with ephemeral teardown.',
    'Unified Findings Normalization: Disparate tool outputs (Semgrep, Gitleaks, dependency audit) normalized into a single database schema.',
    'Deterministic Scoring: score = 100 / (1 + risk_points / 25.0), weighted CRITICAL 10, HIGH 7, MEDIUM 4, LOW 1, INFO 0.'
  ],
  mermaidDiagram: `graph TD
    Client[Web UI] -->|POST /scans/upload or /scans/git| Gateway[FastAPI API]
    Gateway -->|Store scan row PENDING| Postgres[(PostgreSQL Database)]
    Gateway -->|Enqueue run_security_scan| Redis[(Redis / Celery Broker)]

    subgraph AsyncWorkerPool [Celery Worker Pool]
        Redis --> Worker[Celery task: run_security_scan]
        Worker -->|Step 1: SAST| Semgrep[Semgrep --network=none]
        Worker -->|Step 2: Secrets| Gitleaks[Gitleaks]
        Worker -->|Step 3: Dependencies| Audit[Dependency Audit]
        Semgrep -->|JSON stdout| Normalizer[scanner_service.run_full_scan]
        Gitleaks -->|JSON stdout| Normalizer
        Audit -->|JSON stdout| Normalizer
        Normalizer -->|Step 4: Score 100 / 1 + risk/25| Postgres
        Normalizer -->|Persist findings & score| Postgres
        Worker -->|Clean temp directory| Cleaner[Ephemeral Cleanup]
    end

    Client -->|GET /scans /scans/:id /findings /export| Gateway
    Gateway -->|Fetch status / findings| Postgres`,
  endpoints: [
    {
      method: 'POST',
      path: '/scans/upload',
      description: 'Upload a code archive (.zip only) for scanning. Any other archive type is rejected with 400.',
      auth: 'None (single-user local deployment)',
      requestBody: 'multipart/form-data with "project_id" and "file" (.zip).',
      responseExample: `{
  "scan_id": 42,
  "status": "PENDING",
  "message": "Scan queued"
}`
    },
    {
      method: 'POST',
      path: '/scans/git',
      description: 'Trigger a scan from a remote Git repository URL.',
      auth: 'None (single-user local deployment)',
      requestBody: `multipart/form-data with "project_id" and "repo_url".

{
  "project_id": 1,
  "repo_url": "https://github.com/org/service"
}`,
      responseExample: `{
  "scan_id": 43,
  "status": "PENDING",
  "message": "Scan queued"
}`
    },
    {
      method: 'POST',
      path: '/scans/demo',
      description: 'Enqueue a scan of the bundled Juice-Shop demo target. No upload required.',
      auth: 'None (single-user local deployment)',
      requestBody: 'No body required.',
      responseExample: `{
  "scan_id": 44,
  "status": "PENDING",
  "message": "Demo scan queued"
}`
    },
    {
      method: 'GET',
      path: '/scans/',
      description: 'List all scans, newest first. Rows carry project_id only, so join against GET /projects/ to render a project name.',
      auth: 'None (single-user local deployment)',
      responseExample: `[
  {
    "id": 42,
    "project_id": 1,
    "status": "COMPLETED",
    "created_at": "2026-09-20T12:00:00",
    "score": 38,
    "critical_count": 1,
    "high_count": 2,
    "medium_count": 3,
    "low_count": 4,
    "duration_seconds": 38,
    "error_detail": null
  }
]`
    },
    {
      method: 'GET',
      path: '/scans/{scan_id}',
      description: 'Poll one scan: status (PENDING, RUNNING, COMPLETED, FAILED), severity counts, and duration. FAILED scans surface error_detail.',
      auth: 'None (single-user local deployment)',
      responseExample: `{
  "id": 42,
  "status": "COMPLETED",
  "score": 71.43,
  "project_id": 1,
  "created_at": "2026-09-20T12:00:00",
  "critical": 1,
  "high": 2,
  "medium": 3,
  "low": 4,
  "duration": 38,
  "error_detail": null
}`
    },
    {
      method: 'GET',
      path: '/scans/{scan_id}/findings',
      description: 'List findings for a scan. Severity is Capitalized; each finding maps to the unified schema columns.',
      auth: 'None (single-user local deployment)',
      responseExample: `[
  {
    "id": 101,
    "severity": "Critical",
    "title": "semgrep.python.lang.security.audit.dangerous-subprocess-use",
    "description": "Detected subprocess call with user-controlled input.",
    "remediation": "Avoid invoking subprocess with a shell; use argument lists and validate input.",
    "file": "app/runner.py",
    "line": 88,
    "tool": "semgrep"
  }
]`
    },
    {
      method: 'GET',
      path: '/scans/{scan_id}/export',
      description: 'Download the scan report as a PDF file. Returns application/pdf; save the response as a blob.',
      auth: 'None (single-user local deployment)',
      requestBody: 'No body required.',
      responseExample: `Binary PDF stream (Content-Type: application/pdf)`
    },
    {
      method: 'GET',
      path: '/projects/',
      description: 'List all projects. Used to resolve the project name shown beside each scan row.',
      auth: 'None (single-user local deployment)',
      responseExample: `[
  {
    "id": 1,
    "name": "service",
    "repo_url": "https://github.com/org/service",
    "owner_id": 1,
    "created_at": "2026-09-19T09:30:00"
  }
]`
    },
    {
      method: 'GET',
      path: '/projects/{id}',
      description: 'Fetch one project by ID.',
      auth: 'None (single-user local deployment)',
      responseExample: `{
  "id": 1,
  "name": "service",
  "repo_url": "https://github.com/org/service",
  "owner_id": 1,
  "created_at": "2026-09-19T09:30:00"
}`
    },
    {
      method: 'POST',
      path: '/projects/',
      description: 'Register a project so scans can be attached to it.',
      auth: 'None (single-user local deployment)',
      requestBody: `{
  "name": "service",
  "repo_url": "https://github.com/org/service"
}`,
      responseExample: `{
  "id": 2,
  "name": "service",
  "repo_url": "https://github.com/org/service",
  "owner_id": 1,
  "created_at": "2026-09-20T12:00:00"
}`
    },
    {
      method: 'GET',
      path: '/health',
      description: 'Readiness check for the API service.',
      auth: 'None (single-user local deployment)',
      requestBody: 'No body required.',
      responseExample: `{
  "status": "ok"
}`
    }
  ]
};

export const STEP_BY_STEP_PROMPTS = [
  {
    step: 1,
    title: 'Project Scaffolding',
    category: 'Architecture & Setup',
    description: 'Establish the core project skeleton separating routes, scanner engine, database models, and React UI with docker-compose for PostgreSQL.',
    keyDeliverables: ['FastAPI or Express backend structure', 'React + Tailwind frontend template', 'docker-compose.yml with Postgres & Redis', 'Directory layout & README'],
    prompt: `Set up a new project called SVS (Security Vulnerability Scanner). Use [Node.js Express with TypeScript / Python FastAPI] for the backend and [React with Tailwind CSS] for the frontend. Create a clean folder structure separating: api routes, scanner engine, database models, and frontend components. Include a docker-compose.yml for local development with a Postgres database and Redis instance. Add a README explaining the folder structure.`
  },
  {
    step: 2,
    title: 'Database Schema',
    category: 'Persistence & Models',
    description: 'Design and implement the relational schema covering users, projects, scans, and unified security findings with database migrations.',
    keyDeliverables: ['Users table (auth & role)', 'Projects table', 'Scans table (status, timestamps, duration, score)', 'Findings table (severity, file, line, remediation)'],
    prompt: `Design and implement the database schema for SVS using [PostgreSQL + Prisma / SQLAlchemy]. I need these tables: users, projects (a submitted codebase), scans (one scan run - status, timestamps, duration, score), and findings (individual vulnerabilities - type, severity, file path, line number, description, remediation text, linked to a scan). Generate the models/schema and a migration.`
  },
  {
    step: 3,
    title: 'Upload & Ingestion API',
    category: 'Ingestion & Validation',
    description: 'Build safe ingestion accepting zip archives or Git repository URLs with file type and size restrictions (50MB ceiling).',
    keyDeliverables: ['POST /scans/upload endpoint', 'POST /scans/git endpoint', 'Size guard & zip extraction to sandbox', 'Creation of pending scan record in database'],
    prompt: `Build an API endpoint that accepts a zip file upload or a Git repository URL, validates file type and size (reject anything over [50MB] and non-code archives), extracts it to a temporary isolated directory, and creates a new 'scan' record in the database with status 'pending'. Do not execute any of the uploaded code at this stage - just store and register it.`
  },
  {
    step: 4,
    title: 'Semgrep Integration (Core Scanner)',
    category: 'SAST Engine',
    description: 'Integrate Semgrep static analysis inside a restricted Docker container with zero network access and strict resource boundaries.',
    keyDeliverables: ['Dockerized Semgrep execution (--network=none)', 'JSON output parsing', 'Unified finding normalization', 'Scan completion / failure state updates'],
    prompt: `Integrate Semgrep as the core static analysis engine. Write a scanner module that: 1) runs Semgrep against the extracted project directory inside a Docker container with no network access and CPU/memory limits, 2) captures the JSON output, 3) parses it into our internal 'finding' format (type, severity, file, line, description), 4) saves each finding to the database linked to the scan ID, 5) updates the scan status to 'complete' or 'failed'.`
  },
  {
    step: 5,
    title: 'Additional Scanners (Secrets & Dependencies)',
    category: 'Multi-Engine Pipeline',
    description: 'Add Gitleaks for leaked credential detection and npm audit / pip-audit for software composition analysis (SCA).',
    keyDeliverables: ['Gitleaks secrets scanner integration', 'Dependency audit scanner', 'Sequential execution pipeline', 'Normalized schema output merging'],
    prompt: `Add two more scanners to the pipeline and normalize their output into the same internal finding format as Semgrep: 1) a secrets scanner using Gitleaks to detect hardcoded API keys/passwords, 2) a dependency vulnerability scanner using [npm audit for JS / pip-audit for Python] to flag known-CVE dependencies. Run all scanners in sequence for a given scan and merge their findings.`
  },
  {
    step: 6,
    title: 'Severity Scoring Algorithm',
    category: 'Scoring Engine',
    description: 'Implement the mathematical security posture score: a harmonic decay from 100 as weighted risk points accumulate.',
    keyDeliverables: ['Weighted risk points: Critical = 10, High = 7, Medium = 4, Low = 1, Info = 0', 'score = 100 / (1 + risk_points / 25.0)', 'Severity counts breakdown', 'Score persistence on scan record'],
    prompt: `Add a scoring module that takes all findings for a scan and calculates an overall security score. Use this weighting: Critical = 10 points, High = 7, Medium = 4, Low = 1, Info = 0, summed into risk_points, then score = 100 / (1 + risk_points / 25.0). Store the computed score on the scan record. Also add a breakdown count of findings by severity.`
  },
  {
    step: 7,
    title: 'Job Queue for Async Scanning',
    category: 'Worker Queue',
    description: 'Offload long-running security scans to asynchronous Celery worker processes backed by Redis.',
    keyDeliverables: ['Redis message queue setup', 'Celery task run_security_scan executing Steps 4-6', 'Immediate response with scan_id and PENDING status', 'GET /scans/{scan_id} polling endpoint'],
    prompt: `Scans should not block the API. Add a job queue using [BullMQ + Redis / Celery + Redis] so that when a scan is submitted, the API immediately returns a scan ID with status 'pending', and the actual scanning (Steps 4-6) runs asynchronously in a worker process. Add an endpoint to poll scan status by ID.`
  },
  {
    step: 8,
    title: 'Authentication & Tenant Isolation',
    category: 'Security & Auth',
    description: 'Implement JWT user authentication with signup, login, password hashing, and project authorization middleware.',
    keyDeliverables: ['JWT sign/verify middleware', 'Argon2 / bcrypt password hashing', 'User tenancy isolation on scans and projects', 'Protected route guards'],
    prompt: `Add user authentication using JWT. Include signup, login, and a protected middleware that requires a valid token for all scan-related endpoints. Each scan and project should be linked to the user who created it, and users should only be able to view their own scans.`
  },
  {
    step: 9,
    title: 'Reporting API & Remediation Guidance',
    category: 'Reporting & Remediation',
    description: 'Deliver scan reports with per-finding remediation text and a PDF export of the full report.',
    keyDeliverables: ['GET /scans/{scan_id}/findings endpoint', 'GET /scans/{scan_id}/export PDF download', 'Per-finding remediation guidance for developers'],
    prompt: `Build endpoints that return the full scan report: all findings with severity, title, description, file, line, tool, and remediation text, plus a PDF export of the report. Remediation guidance should be specific enough for a developer to act on without consulting external docs.`
  },
  {
    step: 10,
    title: 'Frontend Dashboard',
    category: 'User Experience',
    description: 'Build the full responsive React interface: drag-and-drop ingestion with live scan progress, scan history list, and single-scan findings report.',
    keyDeliverables: ['Upload page (drag-and-drop zip or repo URL) with progress polling', 'Dashboard listing past scans with score gauge & date', 'Report view with findings grouped by severity & remediation text', 'Architecture docs and build-along prompt walkthrough'],
    prompt: `Build a React frontend with: 1) an upload page (drag-and-drop zip or paste a repo URL) with a progress indicator while the scan runs, 2) a dashboard listing past scans with their score and date, 3) a report view for a single scan showing findings grouped by severity, with file/line info and the remediation suggestion for each finding.`
  },
  {
    step: 11,
    title: 'Rate Limiting & Input Hardening',
    category: 'Security Hardening',
    description: 'Protect scan endpoints against abuse and attacks: rate limits, SSRF checks on Git URLs, and automated container cleanup.',
    keyDeliverables: ['Rate limiter on scan submission', 'SSRF validator blocking RFC1918 & 169.254.169.254 metadata', 'Auto-cleanup cron for extracted files and temporary containers'],
    prompt: `Add rate limiting to the scan submission endpoint to prevent abuse (max [5] scans per user per hour). Add SSRF protection to the repo-URL ingestion path so it cannot be used to fetch internal/private network addresses. Add a cleanup job that deletes extracted project files and temporary containers after a scan completes or fails.`
  },
  {
    step: 12,
    title: 'Automated Test Suites',
    category: 'Quality Assurance',
    description: 'Write unit tests for the finding normalizer and scoring engine, plus integration tests against deliberately vulnerable test fixtures.',
    keyDeliverables: ['Unit tests for score = 100 / (1 + risk_points / 25.0)', 'Unit tests for Semgrep/Gitleaks JSON parser', 'Integration test suite using vulnerable test-fixtures folder'],
    prompt: `Write unit tests for the finding normalizer and scoring module. Write an integration test that runs the full scan pipeline against a small deliberately-vulnerable sample project (include one in a test-fixtures folder) and asserts that known vulnerability types are detected.`
  },
  {
    step: 13,
    title: 'CI/CD Pipeline',
    category: 'DevOps & Automation',
    description: 'Establish GitHub Actions workflow to run linting, test suites, Docker image builds, and automated deployments.',
    keyDeliverables: ['.github/workflows/ci.yml configuration', 'Linter & unit test execution', 'Multi-stage Docker build caching', 'Deployment triggers to Render/Railway/Cloud Run'],
    prompt: `Add a GitHub Actions workflow that runs the test suite on every push, builds the Docker images, and (on the main branch) deploys to [your hosting target, e.g. Railway/Render]. Include a job that lints the code.`
  },
  {
    step: 14,
    title: 'Production Deployment & Health Checks',
    category: 'Production Readiness',
    description: 'Create production-ready Dockerfiles for the API, worker, and frontend, with secure environment variables and health check endpoints.',
    keyDeliverables: ['Multi-stage Dockerfiles (API, Worker, Frontend)', 'docker-compose.prod.yml without hardcoded secrets', 'GET /health readiness and liveness checks'],
    prompt: `Prepare SVS for deployment: production-ready Dockerfiles for the API, worker, and frontend, environment variable configuration for secrets (no hardcoded credentials), and a docker-compose.prod.yml or deployment config for [Railway / Render / AWS]. Include a health-check endpoint.`
  },
  {
    step: 15,
    title: 'Documentation & OpenAPI Specs',
    category: 'Documentation',
    description: 'Generate comprehensive documentation: system README, Mermaid architecture diagram, development setup guide, and Swagger/OpenAPI docs.',
    keyDeliverables: ['README.md with setup & commands', 'Mermaid architecture diagram', 'Swagger UI / OpenAPI 3.0 specification', 'Development troubleshooting guide'],
    prompt: `Generate a full README covering: what SVS does, architecture diagram (describe it in Mermaid syntax), setup instructions for local development, how to run tests, how to deploy, and API documentation using OpenAPI/Swagger for all endpoints.`
  }
];
