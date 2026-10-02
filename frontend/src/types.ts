export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type ScannerType = 'semgrep' | 'gitleaks' | 'dependency-audit' | 'checkov';
export type ScanStatus = 'pending' | 'scanning' | 'complete' | 'failed';
export type FindingStatus = 'open' | 'resolved' | 'false_positive' | 'accepted';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'security_engineer' | 'developer';
  avatar?: string;
  scansRemaining: number;
}

export interface Project {
  id: string;
  name: string;
  repoUrl?: string;
  defaultBranch: string;
  lastScannedAt: string;
  lastScore: number;
  openFindingsCount: number;
}

export interface Finding {
  id: string;
  scanId: string;
  scanner: ScannerType;
  type: string;
  severity: Severity;
  cwe?: string;
  cve?: string;
  filePath: string;
  lineNumber: number;
  columnNumber?: number;
  snippet: string;
  description: string;
  remediation: string;
  secureCodeExample: string;
  status: FindingStatus;
  detectedAt: string;
}

export interface ScanStage {
  name: string;
  label: string;
  status: 'waiting' | 'running' | 'done' | 'failed';
  details?: string;
  durationMs?: number;
}

export interface Scan {
  id: string;
  projectId: string;
  projectName: string;
  sourceType: 'zip_upload' | 'git_repo';
  sourceName: string;
  status: ScanStatus;
  startedAt: string;
  completedAt?: string;
  durationSeconds?: number;
  score: number;
  counts: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    total: number;
  };
  stages?: ScanStage[];
  logs?: string[];
  findings?: Finding[];
  commitHash?: string;
  branch?: string;
}

export interface KnowledgeBaseItem {
  id: string;
  type: string;
  title: string;
  cwe: string;
  category: 'SAST' | 'Secrets' | 'Dependencies';
  defaultSeverity: Severity;
  summary: string;
  whyItMatters: string;
  vulnerableExample: string;
  secureExample: string;
  remediationSteps: string[];
}

export interface PromptStep {
  step: number;
  title: string;
  category: string;
  prompt: string;
  description: string;
  keyDeliverables: string[];
}
