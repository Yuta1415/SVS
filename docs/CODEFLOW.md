# SVS Code Flow Diagrams

These diagrams describe the current local-native workflow. Docker Compose,
Celery, Redis, and container-isolation diagrams from the previous deployment
have been removed; see the repository history for that architecture.

## System Architecture Overview

```mermaid
graph TB
    subgraph Frontend ["Frontend (React/Vite/TypeScript)"]
        FE[Browser UI]
    end

    subgraph Backend ["Backend Services"]
        API[FastAPI Server<br/>:8000]
        WORKER[Local Thread Pool]
        DB[(SQLite svs.db)]
    end

    subgraph Scanners ["Local Scanner Tools"]
        SEMGREP[Semgrep SAST]
        GITLEAKS[Gitleaks Secrets]
        DEPENDENCY[Dependency Audit]
        IAC[Checkov IAC]
    end

    subgraph Storage ["Storage"]
        UPLOADS[Temporary Upload Directory]
    end

    FE --> API
    WORKER --> DB
    API --> DB
    API --> WORKER
    WORKER --> UPLOADS
    WORKER --> SEMGREP
    WORKER --> GITLEAKS
    WORKER --> DEPENDENCY
    WORKER --> IAC
```

---

## End-to-End Scan Flow

```mermaid
sequenceDiagram
    participant User
    participant FE as Frontend
    participant API as FastAPI
    participant Worker as Local thread pool
    participant DB as SQLite
    participant Scanner

    User->>FE: Select Project / Upload ZIP
    FE->>API: POST /scans/git or /scans/upload
    API->>DB: Create Scan Record (status=PENDING)
    API->>Worker: Submit background task
    API-->>FE: Return scan_id

    Worker->>DB: Update Scan (status=RUNNING)
    Worker->>DB: Get Project Path
    
    Note over Worker: Run local scanner commands
    Worker->>Scanner: Run Semgrep SAST
    Scanner-->>Worker: Return findings
    Worker->>DB: Save findings
    Note over Scanner,DB: Non-fatal Semgrep warnings are saved with the scan; blocking errors fail the scanner

    Worker->>Scanner: Run Gitleaks
    Scanner-->>Worker: Return findings
    Worker->>DB: Save findings

    Worker->>Scanner: Run Dependency Audit
    Scanner-->>Worker: Return findings
    Worker->>DB: Save findings

    Note over Worker: Deduplicate & Score
    Worker->>DB: Calculate Score
    Worker->>DB: Update Scan (status=COMPLETED)

    Note over User: Polling from Frontend
    User->>FE: Poll GET /scans/{id}
    FE->>API: Request scan status
    API->>DB: Get scan data
    API-->>FE: Return status + findings
    FE-->>User: Display Report

```

---

## Scanner Pipeline Flow

```mermaid
flowchart LR
    subgraph "Scanner Pipeline"
        START((Start Scan))
        DEDUP[Deduplicate Findings]
        SCORE[Calculate Score]
        END((Complete))
    end

    subgraph "Individual Scanners"
        SEMGREP[Semgrep SAST<br/>Injection/XSS/Crypto]
        GITLEAKS[Gitleaks<br/>Secrets/API Keys]
        DEPENDENCY[Dependency Audit<br/>pip-audit/npm audit]
        IAC[Checkov<br/>IAC Policies]
    end

    START --> SEMGREP
    START --> GITLEAKS
    START --> DEPENDENCY
    START --> IAC
    
    SEMGREP --> DEDUP
    GITLEAKS --> DEDUP
    DEPENDENCY --> DEDUP
    IAC --> DEDUP
    
    DEDUP --> SCORE
    SCORE --> END
```

---

## Database Schema Flow

```mermaid
erDiagram
    USERS ||--o{ PROJECTS : creates
    USERS ||--o{ SCANS : triggers
    PROJECTS ||--o{ SCANS : contains
    SCANS ||--o{ FINDINGS : contains

    USERS {
        int id PK
        varchar email
        datetime created_at
    }

    PROJECTS {
        int id PK
        varchar name
        varchar repo_url
        int owner_id FK
    }

    SCANS {
        int id PK
        int project_id FK
        varchar status
        datetime created_at
        float score
        int critical_count
        int high_count
        int medium_count
        int low_count
    }

    FINDINGS {
        int id PK
        int scan_id FK
        varchar severity
        varchar vulnerability_type
        varchar file_path
        int line_number
        varchar triage_status
        varchar cwe
    }
```

---

## API Endpoints Flow

```mermaid
flowchart TD
    subgraph "Project Endpoints"
        P1[GET /projects]
        P2[POST /projects]
    end

    subgraph "Scan Endpoints"
        S1[GET /scans]
        S2[GET /scans/{id}]
        S3[POST /scans/git]
        S4[POST /scans/upload]
        S5[POST /scans/demo]
    end

    subgraph "Finding Endpoints"
        F1[GET /scans/{id}/findings]
        F2[PATCH /scans/{id}/findings/{finding_id}]
    end

    subgraph "Export Endpoints"
        E1[GET /scans/{id}/export]
        E2[GET /scans/{id}/export/sarif]
    end

    P1 --> P2
    S1 --> S2
    S3 --> S4
    S5 --> S2
    F1 --> F2
    E1 --> E2
```

---

## Frontend Component Flow

```mermaid
flowchart TD
    subgraph "React Components"
        DASH[DashboardView]
        INGEST[IngestScanView]
        REPORT[ScanReportView]
        KB[KnowledgeBaseView]
        ARCH[ArchitectureDocsView]
    end

    subgraph "Data Flow"
        API[api.ts]
        ADAPTER[adapter.ts]
        TYPES[types.ts]
    end

    DASH --> API
    INGEST --> API
    REPORT --> API
    
    API --> TYPES
    TYPES --> ADAPTER
    ADAPTER --> DASH
    ADAPTER --> REPORT
```

---

## Local Background Task Flow

```mermaid
sequenceDiagram
    participant API
    participant Worker
    participant Database

    API->>Database: Create Scan (PENDING)
    API->>Worker: run_security_scan(scan_id, project_id)
    API-->>Client: Return scan_id

    Worker->>Database: Update Scan (RUNNING)
    
    Worker->>Scanner: Execute scan pipeline
    Worker->>Database: Save findings
    Worker->>Database: Calculate score
    Worker->>Database: Update Scan (COMPLETED)
```

---

## Score Calculation Flow

```mermaid
flowchart TD
    START((Start))
    FETCH[Get all findings for scan]
    CALC[Calculate risk points]
    FORMULA[Apply hyperbolic formula]
    SAVE[Save score to database]
    END((Done))

    START --> FETCH
    FETCH --> CALC
    CALC --> FORMULA
    
    subgraph Formula ["score = 100 / (1 + risk / 25)"]
        risk[weighted sum: CRITICAL=10, HIGH=7, MEDIUM=4, LOW=1]
    end
    
    FORMULA --> SAVE
    SAVE --> END
```

---

## Security Flow

```mermaid
flowchart TD
    subgraph "Input Validation"
        URL[Validate Git URL]
        ZIP[Validate ZIP size & structure]
        SSRF[Check for internal IPs]
        ZIPBOMB[Check compression ratio]
    end

    subgraph "Local Scan Execution"
        TOOLS[Run scanner subprocesses]
        TIMEOUT[Enforce 30-minute timeout]
        ACCESS[Host permissions apply]
    end

    subgraph "Output Safety"
        DEDUP[Deduplicate findings]
        SANITIZE[Sanitize report data]
        LIMIT[Rate limit API]
    end

    URL --> SSRF
    ZIP --> ZIPBOMB
    SSRF --> TOOLS
    ZIPBOMB --> TOOLS
    TOOLS --> TIMEOUT
    TIMEOUT --> ACCESS
    ACCESS --> DEDUP
    DEDUP --> SANITIZE
    SANITIZE --> LIMIT
```

---

## Local Development

`run-svs.bat` launches the FastAPI API and Vite frontend. The API dispatches
scans to an in-process thread pool and stores records in SQLite; no Docker
daemon, Redis, or Celery process is used.
