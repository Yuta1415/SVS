import { PromptStep } from '../types';

export const BACKEND_ARCHITECTURE_DOC = {
  title: 'SVS: Security Vulnerability Scanner — Backend Architecture & API Specifications',
  overview: `SVS (Security Vulnerability Scanner) is an enterprise-grade asynchronous vulnerability scanning platform designed to ingest code repositories or archive bundles, execute multi-engine static application security testing (SAST), secrets scanning, and software composition analysis (SCA), and compute an objective security posture score with actionable remediation guidance.`,
  corePrinciples: [
    'Least-Egress Sandboxing: every scanner runs in an isolated Docker container capped at 512MB RAM with a 15-minute timeout; Gitleaks runs fully offline, and only Semgrep ruleset and CVE advisory lookups egress.',
    'Asynchronous Job Queue: Celery + Redis ensures HTTP APIs never block during multi-minute scan runs.',
    'Defensive Ingestion: 50MB upload ceiling, zip-only acceptance, and ephemeral per-scan work directories.',
    'Unified Findings Normalization: Disparate tool outputs (Semgrep, Gitleaks, pip-audit) normalized into a single database schema.',
    'Deterministic Scoring: weighted risk points (Critical 10, High 7, Medium 4, Low 1) fed into score = 100 / (1 + risk/25).'
  ],
  mermaidDiagram: `graph TD
    Client[Web UI - Vite React] -->|HTTP POST /scans| Gateway[FastAPI API Gateway]
    Gateway -->|Validate & Enqueue| Ingest[Ingestion Service]
    Gateway -->|Enqueue Job| Redis[(Redis / Celery Broker)]
    Gateway -->|Store Metadata 'pending'| Postgres[(PostgreSQL Database)]

    subgraph Async Worker Pool [Isolated Scan Worker Pool]
        Redis --> Worker[Celery Worker Process]
        Worker -->|Step 1: SAST| Semgrep[Docker: Semgrep, 512m / 15m, egress for ruleset]
        Worker -->|Step 2: Secrets| Gitleaks[Docker: Gitleaks, offline]
        Worker -->|Step 3: Dependencies| Audit[Docker: pip-audit, egress for CVE DB]
    end

    Semgrep -->|JSON stdout| Normalizer[Finding Normalizer & Scoring Engine]
    Gitleaks -->|JSON stdout| Normalizer
    Audit -->|JSON stdout| Normalizer

    Normalizer -->|Persist Findings & Score| Postgres
    Normalizer -->|Clean temp directory| Cleaner[Ephemeral Cleanup Service]

    Client -->|GET /scans/:id| Gateway
    Gateway -->|Fetch status / findings| Postgres`,
  endpoints: [
    {
      method: 'POST',
      path: '/scans/git',
      description: 'Clone a remote Git repository and queue a scan. Returns immediately with a scan ID; the Celery worker runs the three engines asynchronously.',
      auth: 'None (single-user local instance)',
      requestBody: `multipart/form-data
  project_id: 1            (int, required)
  repo_url: "https://github.com/org/service"`,
      responseExample: `{
  "scan_id": 42,
  "status": "pending",
  "message": "Repository cloned. Scan queued in background."
}`
    },
    {
      method: 'POST',
      path: '/scans/upload',
      description: 'Upload a code archive (.zip only, 50MB ceiling) against an existing project and queue a scan.',
      auth: 'None (single-user local instance)',
      requestBody: `multipart/form-data
  project_id: 1            (int, required)
  file: archive.zip         (.zip only)`,
      responseExample: `{
  "scan_id": 43,
  "status": "pending",
  "message": "Code ingested. Scan queued in background."
}`
    },
    {
      method: 'POST',
      path: '/scans/demo',
      description: 'Queue a scan of the intentionally vulnerable Juice-Shop repository. Creates the Demo Project on first call.',
      auth: 'None (single-user local instance)',
      responseExample: `{
  "scan_id": 44,
  "status": "pending",
  "message": "Demo scan queued for Juice-Shop."
}`
    },
    {
      method: 'GET',
      path: '/scans/',
      description: 'List every scan record newest-first, with severity counts and score. Drives the dashboard.',
      auth: 'None (single-user local instance)',
      responseExample: `[
  { "id": 42, "project_id": 1, "status": "complete", "score": 58,
    "critical": 3, "high": 1, "medium": 2, "low": 0 }
]`
    },
    {
      method: 'GET',
      path: '/scans/{scan_id}',
      description: 'Poll one scan: status, score, flat severity counts, runtime, and any error detail.',
      auth: 'None (single-user local instance)',
      responseExample: `{
  "id": 42,
  "status": "complete",
  "score": 58,
  "project_id": 1,
  "critical": 3, "high": 1, "medium": 2, "low": 0,
  "duration": 37,
  "error_detail": null
}`
    },
    {
      method: 'GET',
      path: '/scans/{scan_id}/findings',
      description: 'List the normalized findings for a scan: severity, title, description, remediation, file, line, source tool, and triage state.',
      auth: 'None (single-user local instance)',
      responseExample: `[
  { "id": 101, "severity": "Critical", "title": "Secret-Leak",
    "description": "Hardcoded AWS access key",
    "remediation": "Rotate the key and load it from a secret manager.",
    "file": "config/settings.py", "line": 24, "tool": "Gitleaks",
    "status": "open" }
]`
    },
    {
      method: 'PATCH',
      path: '/scans/{scan_id}/findings/{finding_id}',
      description: 'Persist a triage decision on one finding. Accepted values: open, resolved, false_positive, accepted; anything else returns 400.',
      auth: 'None (single-user local instance)',
      requestBody: `{
  "triage": "resolved"
}`,
      responseExample: `{
  "id": 101,
  "scan_id": 42,
  "status": "resolved"
}`
    },
    {
      method: 'DELETE',
      path: '/scans/{scan_id}',
      description: 'Delete a scan and every finding attached to it. Returns 204 on success.',
      auth: 'None (single-user local instance)',
      responseExample: `204 No Content`
    },
    {
      method: 'GET',
      path: '/scans/{scan_id}/export',
      description: 'Generate and stream a PDF report for the scan: score, severity distribution, and per-finding remediation and triage.',
      auth: 'None (single-user local instance)',
      responseExample: `application/pdf
  (scan_report_42.pdf)`
    },
    {
      method: 'POST',
      path: '/projects/',
      description: 'Register a project so scans can be attached to it. Returns the created project.',
      auth: 'None (single-user local instance)',
      requestBody: `{
  "name": "service-main",
  "repo_url": "https://github.com/org/service"
}`,
      responseExample: `{
  "id": 1,
  "name": "service-main",
  "repo_url": "https://github.com/org/service"
}`
    },
    {
      method: 'GET',
      path: '/projects/',
      description: 'List all projects. The New Scan form reads this to populate its project picker.',
      auth: 'None (single-user local instance)',
      responseExample: `[
  { "id": 1, "name": "service-main", "repo_url": "https://github.com/org/service" }
]`
    },
    {
      method: 'DELETE',
      path: '/projects/{project_id}',
      description: 'Delete a project together with all of its scans and findings. Returns 204 on success.',
      auth: 'None (single-user local instance)',
      responseExample: `204 No Content`
    },
    {
      method: 'GET',
      path: '/health',
      description: 'Liveness probe used by the stack startup check.',
      auth: 'None (single-user local instance)',
      responseExample: `{
  "status": "healthy"
}`
    },
    {
      method: 'GET',
      path: '/docs',
      description: 'Auto-generated OpenAPI / Swagger UI for the full live surface, served by FastAPI.',
      auth: 'None (single-user local instance)',
      responseExample: `text/html
  (interactive Swagger UI)`
    },
    {
      method: 'GET',
      path: '(static) src/data/knowledgeBase.ts',
      description: 'The Knowledge Base tab is a static in-app dataset of vulnerability classes, attack vectors, and secure-code examples. It ships with the frontend and is not served by the API.',
      auth: 'N/A - bundled frontend data',
      responseExample: `[
  { "id": "sqli", "cwe": "CWE-89", "title": "SQL Injection", "secureExample": "..." }
]`
    }
  ]
};

export const STEP_BY_STEP_PROMPTS: PromptStep[] = [
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
    keyDeliverables: ['POST /scans/upload endpoint', 'POST /scans/git endpoint', '50MB size guard & zip extraction to sandbox', 'Creation of pending scan record in database'],
    prompt: `Build an API endpoint that accepts a zip file upload or a Git repository URL, validates file type and size (reject anything over [50MB] and non-code archives), extracts it to a temporary isolated directory, and creates a new 'scan' record in the database with status 'pending'. Do not execute any of the uploaded code at this stage - just store and register it.`
  },
  {
    step: 4,
    title: 'Semgrep Integration (Core Scanner)',
    category: 'SAST Engine',
    description: 'Integrate Semgrep static analysis inside a restricted Docker container with a 512MB memory ceiling, a 15-minute timeout, and network egress limited to fetching the ruleset.',
    keyDeliverables: ['Dockerized Semgrep execution (512m / 15m, ruleset egress only)', 'JSON output parsing', 'Unified finding normalization', 'Scan completion / failure state updates'],
    prompt: `Integrate Semgrep as the core static analysis engine. Write a scanner module that: 1) runs Semgrep against the extracted project directory inside a Docker container with no network access and CPU/memory limits, 2) captures the JSON output, 3) parses it into our internal 'finding' format (type, severity, file, line, description), 4) saves each finding to the database linked to the scan ID, 5) updates the scan status to 'complete' or 'failed'.`
  },
  {
    step: 5,
    title: 'Additional Scanners (Secrets & Dependencies)',
    category: 'Multi-Engine Pipeline',
    description: 'Add Gitleaks for leaked credential detection and npm audit / pip-audit for software composition analysis (SCA).',
    keyDeliverables: ['Gitleaks secrets scanner integration', 'npm audit / pip-audit dependency scanner', 'Sequential execution pipeline', 'Normalized schema output merging'],
    prompt: `Add two more scanners to the pipeline and normalize their output into the same internal finding format as Semgrep: 1) a secrets scanner using Gitleaks to detect hardcoded API keys/passwords, 2) a dependency vulnerability scanner using [npm audit for JS / pip-audit for Python] to flag known-CVE dependencies. Run all scanners in sequence for a given scan and merge their findings.`
  },
  {
    step: 6,
    title: 'Severity Scoring Algorithm',
    category: 'Scoring Engine',
    description: 'Implement the security posture score as a hyperbolic discount on weighted risk points, so a clean repo is 100 and badly compromised repos stay ranked instead of clamping together at zero.',
    keyDeliverables: ['Weighted risk points: Critical = 10, High = 7, Medium = 4, Low = 1, Info = 0', 'score = 100 / (1 + risk/25) - never clamps, stays discriminative at scale', 'Severity counts breakdown', 'Score persistence on scan record'],
    prompt: `Add a scoring module that takes all findings for a scan and calculates an overall security score. Use this weighting: Critical = 10 points, High = 7, Medium = 4, Low = 1, subtracted from a baseline of 100 (floor at 0). Store the computed score on the scan record. Also add a breakdown count of findings by severity.`
  },
  {
    step: 7,
    title: 'Job Queue for Async Scanning',
    category: 'Worker Queue',
    description: 'Offload long-running security scans to asynchronous worker processes using BullMQ + Redis or Celery.',
    keyDeliverables: ['Redis message queue setup', 'Worker job processor executing Steps 4-6', 'Immediate response with scanId, status pending', 'GET /scans/:id polling endpoint'],
    prompt: `Scans should not block the API. Add a job queue using [BullMQ + Redis / Celery + Redis] so that when a scan is submitted, the API immediately returns a scan ID with status 'pending', and the actual scanning (Steps 4-6) runs asynchronously in a worker process. Add an endpoint to poll scan status by ID.`
  },
  {
    step: 8,
    title: 'Authentication & Tenant Isolation',
    category: 'Security & Auth',
    description: 'NOT DEPLOYED in this instance: SVS runs as a single-user local service on the operator laptop, so authentication was removed by request and every request resolves to one deterministic local user. The prompt below remains the recipe for adding it back before any public exposure.',
    keyDeliverables: ['Not in the running build (local-only by design)', 'get_local_user resolves one deterministic operator row', 'Add JWT + hashing back here before exposing the port publicly'],
    prompt: `Add user authentication using JWT. Include signup, login, and a protected middleware that requires a valid token for all scan-related endpoints. Each scan and project should be linked to the user who created it, and users should only be able to view their own scans.`
  },
  {
    step: 9,
    title: 'Reporting API & Knowledge Base',
    category: 'Reporting & Remediation',
    description: 'Deliver rich scan reports enriched with defensive knowledge base articles, attack vectors, and secure code diffs.',
    keyDeliverables: ['GET /scans/:id/findings (normalized findings + remediation)', 'GET /scans/:id/export (streamed PDF report)', 'Static security knowledge base (SQLi, XSS, Secrets, Deserialization, Weak Crypto, Deps)', 'Remediation code examples for developers'],
    prompt: `Build an endpoint that returns a full scan report: all findings grouped by severity, the overall score, and for each finding type include a short explanation of why it matters and a secure code example. Store this explanatory content in a static knowledge base file/table keyed by vulnerability type, covering at minimum: SQL injection, XSS, hardcoded secrets, insecure deserialization, weak cryptography, and vulnerable dependencies.`
  },
  {
    step: 10,
    title: 'Frontend Dashboard',
    category: 'User Experience',
    description: 'Build the full responsive React interface: drag-and-drop ingestion with live pipeline activity, scan history list, and a single-scan findings report with triage controls.',
    keyDeliverables: ['No login surface: a local-instance pill instead', 'Upload page (drag-and-drop zip or repo URL) with progress stepper', 'Dashboard listing past scans with score gauge & date', 'Report view with findings, remediation, triage & PDF export'],
    prompt: `Build a React frontend with: 1) a login/signup page, 2) an upload page (drag-and-drop zip or paste a repo URL) with a progress indicator while the scan runs, 3) a dashboard listing past scans with their score and date, 4) a report view for a single scan showing findings grouped by severity, with file/line info and the explanation/fix suggestion from the knowledge base for each finding.`
  },
  {
    step: 11,
    title: 'Rate Limiting & Input Hardening',
    category: 'Security Hardening',
    description: 'Protect scan endpoints against abuse and attacks: rate limits (max 5/hr), SSRF checks on Git URLs, and automated container cleanup.',
    keyDeliverables: ['Rate limiter: 5 scans/hr per user', 'SSRF validator blocking RFC1918 & 169.254.169.254 metadata', 'Auto-cleanup cron for extracted files and temporary containers'],
    prompt: `Add rate limiting to the scan submission endpoint to prevent abuse (max [5] scans per user per hour). Add SSRF protection to the repo-URL ingestion path so it cannot be used to fetch internal/private network addresses. Add a cleanup job that deletes extracted project files and temporary containers after a scan completes or fails.`
  },
  {
    step: 12,
    title: 'Automated Test Suites',
    category: 'Quality Assurance',
    description: 'Write unit tests for the finding normalizer and scoring engine, plus integration tests against deliberately vulnerable test fixtures.',
    keyDeliverables: ['Unit tests for score = 100 / (1 + risk/25) with the real weights', 'Unit tests for Semgrep/Gitleaks JSON parser', 'Integration test suite using vulnerable test-fixtures folder'],
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
    keyDeliverables: ['Multi-stage Dockerfiles (API, Worker, Frontend)', 'docker-compose.prod.yml without hardcoded secrets', 'GET /healthz readiness and liveness checks'],
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
