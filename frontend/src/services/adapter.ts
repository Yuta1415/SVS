import { Finding, FindingStatus, Scan, ScanStatus, ScannerType, Severity } from '../types';
import { FindingRow, ProjectRow, ScanDetail, ScanRow } from './api';

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

// The API reports PENDING/RUNNING/COMPLETED/FAILED in uppercase; the UI's own
// vocabulary is lowercase and collapses both in-flight states into "scanning".
export function mapStatus(raw: string): ScanStatus {
  const value = raw.toUpperCase();
  if (value === 'COMPLETED') return 'complete';
  if (value === 'FAILED') return 'failed';
  return 'scanning';
}

export function mapSeverity(raw: string): Severity {
  const value = raw.toLowerCase();
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : 'low';
}

// The findings endpoint reports "Semgrep" / "Gitleaks" / "SCA Audit" / "Checkov";
// the UI's filter pills use the hyphenated scanner ids.
function mapScanner(tool: string): ScannerType {
  const value = tool.toLowerCase();
  if (value === 'gitleaks') return 'gitleaks';
  if (value === 'sca audit') return 'dependency-audit';
  // Checkov findings key on the check id, so without this branch every IaC
  // misconfiguration files itself under Semgrep in the report view.
  if (value === 'checkov') return 'checkov';
  return 'semgrep';
}

// A scan row carries no source-type field. The project's repo_url is the only
// signal left: a real URL means it was cloned, a bare filename means an upload.
const GIT_URL = /^(?:https?:|git@|ssh:\/\/)|\.git$/i;

function projectName(projects: ProjectRow[], projectId: number): ProjectRow | undefined {
  return projects.find((p) => p.id === projectId);
}

function baseScan(
  id: number,
  projectId: number,
  status: string,
  createdAt: string | null,
  score: number | null,
  projects: ProjectRow[],
): Scan {
  const project = projectName(projects, projectId);
  return {
    id: String(id),
    projectId: String(projectId),
    projectName: project?.name ?? `Project ${projectId}`,
    sourceType: project && GIT_URL.test(project.repo_url) ? 'git_repo' : 'zip_upload',
    sourceName: project?.repo_url ?? project?.name ?? '',
    status: mapStatus(status),
    startedAt: createdAt ?? new Date().toISOString(),
    score: score ?? 0,
    counts: { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  };
}

function withCounts(scan: Scan, critical: number, high: number, medium: number, low: number): Scan {
  return {
    ...scan,
    counts: { critical, high, medium, low, total: critical + high + medium + low },
  };
}

export function mapScanRow(row: ScanRow, projects: ProjectRow[]): Scan {
  return withCounts(
    baseScan(row.id, row.project_id, row.status, row.created_at, row.score, projects),
    row.critical_count,
    row.high_count,
    row.medium_count,
    row.low_count,
  );
}

export function mapScanDetail(detail: ScanDetail, projects: ProjectRow[]): Scan {
  return withCounts(
    baseScan(detail.id, detail.project_id, detail.status, detail.created_at, detail.score, projects),
    detail.critical,
    detail.high,
    detail.medium,
    detail.low,
  );
}

export function enrichScan(scan: Scan, detail: ScanDetail, findings: FindingRow[]): Scan {
  return {
    ...mapScanDetail(detail, []),
    ...scan,
    // The detail endpoint is the only one that reports how long the scan took.
    durationSeconds: detail.duration ?? undefined,
    findings: findings.map((f) => mapFinding(f, scan.id, scan.startedAt)),
  };
}

const FINDING_STATUSES: FindingStatus[] = ['open', 'resolved', 'false_positive', 'accepted'];

// The API persists triage server-side, but an unknown or missing value must not
// reach the UI as-is: the filter pills only know the four states above.
function mapFindingStatus(raw: string | undefined | null): FindingStatus {
  const value = (raw ?? '').toLowerCase();
  return FINDING_STATUSES.includes(value as FindingStatus) ? (value as FindingStatus) : 'open';
}

export function mapFinding(row: FindingRow, scanId: string, detectedAt: string): Finding {
  return {
    id: String(row.id),
    scanId,
    scanner: mapScanner(row.tool),
    type: row.title,
    severity: mapSeverity(row.severity),
    cwe: row.cwe ?? undefined,
    filePath: row.file ?? '',
    lineNumber: row.line ?? 0,
    description: row.description ?? '',
    remediation: row.remediation ?? '',
    status: mapFindingStatus(row.status),
    detectedAt,
    // The API has no snippet or secure-example columns, and the scanned source
    // tree is deleted when the worker finishes, so there is nothing to show
    // here. The report view skips these panels when they are empty.
    snippet: '',
    secureCodeExample: '',
  };
}
