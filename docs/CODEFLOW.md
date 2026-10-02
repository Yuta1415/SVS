# SVS Code Flow Diagrams

## System Architecture Overview

```mermaid
graph TB
    subgraph Frontend ["Frontend (React/Vite/TypeScript)"]
        FE[Browser UI]
    end

    subgraph Backend ["Backend Services"]
        API[FastAPI Server<br/>:8000]
        WORKER[Celery Worker]
        REDIS[Redis<br/>:6379]
        DB[(PostgreSQL<br/>:5432)]
    end

    subgraph Scanners ["Scanner Containers"]
        SEMGREP[Semgrep SAST]
        GITLEAKS[Gitleaks Secrets]
        DEPENDENCY[Dependency Audit]
        IAC[Checkov IAC]
    end

    subgraph Storage ["Storage"]
        UPLOADS[Upload Directory<br/>/tmp/svs_uploads]
        DOCKER[Docker Socket]
    end

    FE --> API
    API --> REDIS
    WORKER --> REDIS
    WORKER --> DB
    API --> DB
    WORKER --> DOCKER
    WORKER --> UPLOADS
```

---

## End-to-End Scan Flow

```mermaid
sequenceDiagram
    participant User
    participant FE as Frontend
    participant API as FastAPI
    participant Redis
    participant Worker
    participant DB as PostgreSQL
    participant Scanner

    User->>FE: Select Project / Upload ZIP
    FE->>API: POST /scans/git or /scans/upload
    API->>DB: Create Scan Record (status=PENDING)
    API->>Redis: Enqueue Celery Task
    API-->>FE: Return scan_id

    Note over Worker: Worker picks up task from Redis

    Worker->>DB: Update Scan (status=RUNNING)
    Worker->>DB: Get Project Path
    
    Note over Worker: Run Scanners in Docker Containers
    Worker->>Scanner: Run Semgrep SAST
    Scanner-->>Worker: Return findings
    Worker->>DB: Save findings

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

## Celery Task Flow

```mermaid
sequenceDiagram
    participant API
    participant Redis
    participant Worker
    participant Database

    API->>Database: Create Scan (PENDING)
    API->>Redis: task.run_security_scan(scan_id, project_id)
    API-->>Client: Return scan_id

    Note over Worker: Worker monitors Redis queue
    
    Worker->>Redis: Get next task
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

    subgraph "Container Isolation"
        DOCKER[Run scanners in Docker]
        NETWORK[Isolate network]
        VOLUME[Mount only scan dir]
    end

    subgraph "Output Safety"
        DEDUP[Deduplicate findings]
        SANITIZE[Sanitize report data]
        LIMIT[Rate limit API]
    end

    URL --> SSRF
    ZIP --> ZIPBOMB
    SSRF --> DOCKER
    ZIPBOMB --> DOCKER
    DOCKER --> NETWORK
    NETWORK --> VOLUME
    VOLUME --> DEDUP
    DEDUP --> SANITIZE
    SANITIZE --> LIMIT
```

---

## Docker Compose Flow

```mermaid
graph TB
    subgraph "Container Dependencies"
        DB[(PostgreSQL)]
        REDIS[(Redis)]
        BACKEND[FastAPI]
        WORKER[Celery Worker]
        FRONTEND[nginx + React]
    end

    FRONTEND --> BACKEND
    BACKEND --> DB
    BACKEND --> REDIS
    WORKER --> DB
    WORKER --> REDIS
    WORKER --> DOCKER
    
    subgraph "Host Integration"
        DOCKER[Docker Socket]
        UPLOADS[/tmp/svs_uploads]
    end

    DOCKER --> BACKEND
    DOCKER --> WORKER
    UPLOADS --> BACKEND
    UPLOADS --> WORKER
```
