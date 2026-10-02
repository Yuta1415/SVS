// Vite only exposes env vars prefixed with VITE_ to the bundle, so the API
// origin has to be spelled VITE_API_URL (CRA's REACT_APP_ prefix does nothing
// here). Defaults to the local compose setup so `docker compose up` works with
// no config, matching how the backend's CORS_ORIGINS is defaulted.
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface ScanRow {
  id: number;
  project_id: number;
  status: string;
  created_at: string | null;
  score: number | null;
  error_detail: string | null;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
}

// GET /scans/{id} answers with flat critical/high/... while GET /scans/ uses
// critical_count/high_count/..., so the two list shapes stay apart.
export interface ScanDetail extends Omit<ScanRow, 'critical_count' | 'high_count' | 'medium_count' | 'low_count'> {
  critical: number;
  high: number;
  medium: number;
  low: number;
  duration: number | null;
}

export interface FindingRow {
  id: number;
  severity: string;
  title: string;
  description: string;
  remediation: string;
  file: string;
  line: number | null;
  tool: string;
  status: string;
  cwe?: string | null;
}

export interface ProjectRow {
  id: number;
  name: string;
  repo_url: string;
  owner_id: number;
}

export interface DispatchResult {
  scan_id: number;
  status: string;
  message: string;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_BASE_URL + path, init);
  if (!res.ok) {
    // FastAPI errors are {"detail": "..."}; anything else falls back to the
    // status text so the caller still gets a usable message.
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.detail) message = body.detail;
    } catch {
      /* non-JSON error body, keep the status text */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function json(body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function form(fields: Record<string, string | Blob>): RequestInit {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  // No Content-Type header: the browser sets the multipart boundary itself.
  return { method: 'POST', body: data };
}

export const api = {
  listScans: () => request<ScanRow[]>('/scans/'),
  getScan: (id: number) => request<ScanDetail>(`/scans/${id}`),
  getFindings: (id: number) => request<FindingRow[]>(`/scans/${id}/findings`),
  listProjects: () => request<ProjectRow[]>('/projects/'),
  createProject: (name: string, repo_url: string) =>
    request<ProjectRow>('/projects/', json({ name, repo_url })),
  scanGit: (project_id: number, repo_url: string) =>
    request<DispatchResult>('/scans/git', form({ project_id: String(project_id), repo_url })),
  scanUpload: (project_id: number, file: File) =>
    request<DispatchResult>('/scans/upload', form({ project_id: String(project_id), file })),
  scanDemo: () => request<DispatchResult>('/scans/demo', { method: 'POST' }),
  deleteScan: (id: number) => request<void>(`/scans/${id}`, { method: 'DELETE' }),
  // Triage is persisted server-side; a reload keeps the decision.
  setTriage: (scanId: number, findingId: number, status: string) =>
    request<{ id: number; scan_id: number; status: string }>(
      `/scans/${scanId}/findings/${findingId}`,
      { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ triage: status }) },
    ),
  // A plain anchor href is enough: the endpoint needs no auth and returns a PDF.
  exportUrl: (id: number) => `${API_BASE_URL}/scans/${id}/export`,
  // SARIF is the machine-readable counterpart to the PDF, for CI and IDE import.
  sarifUrl: (id: number) => `${API_BASE_URL}/scans/${id}/export/sarif`,
};
