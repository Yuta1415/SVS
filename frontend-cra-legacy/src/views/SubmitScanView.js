import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  GitBranch,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Sparkles,
  Shield,
  ShieldAlert,
  Loader2,
  Lock,
  FolderArchive,
  Layers,
  ArrowLeft,
} from 'lucide-react';
import api from '../services/api.js';
import { normStatus, isFinished } from '../utils/scan.js';

const POLL_INTERVAL_MS = 3000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB client cap

// The real pipeline order. The API reports only the scan's overall status, so
// the cursor below is a coarse mapping of that status, not per-tool telemetry.
const STAGES = [
  { name: 'ingest', label: '1. Ingestion & Invariant Validation (50MB / SSRF)' },
  { name: 'semgrep', label: '2. Semgrep SAST Engine (Docker Isolated, network=none)' },
  { name: 'gitleaks', label: '3. Gitleaks Secrets Analysis (Keys & Passwords)' },
  { name: 'deps', label: '4. Dependency Vulnerability Audit (npm/pip CVEs)' },
  { name: 'score', label: '5. Finding Normalization & Severity Scoring' },
];

// Real backend scoring, kept in the UI so the legend is never mistaken for
// linear subtraction: score = 100 / (1 + risk_points / 25), weights 10/7/4/1/0.
const SCORING_FORMULA =
  'Score = 100 / (1 + risk/25) - weights Crit 10 / High 7 / Med 4 / Low 1';

// SSRF guard (Step 11): refuse to point ingestion at loopback, private ranges,
// the cloud metadata endpoint, or non-http schemes.
const PRIVATE_IP_PATTERNS = [
  /localhost/i,
  /127\.\d+\.\d+\.\d+/,
  /10\.\d+\.\d+\.\d+/,
  /192\.168\.\d+\.\d+/,
  /172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/,
  /169\.254\.169\.254/, // AWS/GCP metadata
  /file:\/\//i,
  /gopher:\/\//i,
];

const nameFromRepo = (url) => {
  try {
    const path = new URL(url).pathname.replace(/\.git$/, '').replace(/\/+$/, '');
    return path.split('/').filter(Boolean).pop() || 'imported-project';
  } catch {
    return '';
  }
};

const stamp = () => new Date().toLocaleTimeString();

const stageStates = (status) => {
  const s = normStatus({ status });
  if (s === 'COMPLETED') return STAGES.map(() => 'done');
  if (s === 'FAILED') return ['done', 'failed', 'waiting', 'waiting', 'waiting'];
  if (s === 'RUNNING') return ['done', 'running', 'waiting', 'waiting', 'waiting'];
  return ['running', 'waiting', 'waiting', 'waiting', 'waiting'];
};

const progressFor = (status) => {
  const s = normStatus({ status });
  if (s === 'COMPLETED' || s === 'FAILED') return 100;
  if (s === 'RUNNING') return 60;
  return 12;
};

export default function SubmitScanView() {
  const navigate = useNavigate();

  const [ingestMode, setIngestMode] = useState('upload');

  // Upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [projectName, setProjectName] = useState('');
  const fileInputRef = useRef(null);

  // Git state
  const [repoUrl, setRepoUrl] = useState('');
  const [ssrfWarning, setSsrfWarning] = useState(null);

  // Scan execution state
  const [isScanning, setIsScanning] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [scanId, setScanId] = useState(null);
  const [scan, setScan] = useState(null);
  const [terminalLogs, setTerminalLogs] = useState([]);

  const timeoutRef = useRef(null);
  const cancelledRef = useRef(false);
  const terminalRef = useRef(null);
  const scanRef = useRef(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [terminalLogs]);

  // Stamped once, at the moment the event happened, so a re-render never
  // rewrites history in the terminal.
  const appendLogs = (lines) => {
    setTerminalLogs((prev) => [...prev, ...lines.map((text) => ({ t: stamp(), text }))]);
  };

  const validateAndSetFile = (file) => {
    setFileError(null);
    if (!file) return;
    // The backend accepts .zip only; anything else is a 400.
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setFileError('Validation Error: Only .zip archives are supported.');
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(
        `File Size Exceeded: Maximum allowed archive size is 50MB (Supplied: ${(file.size / (1024 * 1024)).toFixed(1)}MB).`
      );
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    if (!projectName) setProjectName(file.name.replace(/\.[^/.]+$/, ''));
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  // SSRF real-time check for Git URLs (Step 11)
  const handleRepoUrlChange = (value) => {
    setRepoUrl(value);
    setSsrfWarning(null);

    for (const pattern of PRIVATE_IP_PATTERNS) {
      if (pattern.test(value)) {
        setSsrfWarning(
          'SSRF Guard Triggered: Ingestion to internal/loopback/cloud-metadata networks is strictly prohibited (Step 11).'
        );
        return;
      }
    }

    if (!projectName && value.includes('/')) {
      const derived = nameFromRepo(value);
      if (derived) setProjectName(derived);
    }
  };

  // Both scan endpoints need a project. Reuse an existing project when the
  // derived name matches, otherwise create one and record the source URL.
  const resolveProjectId = async (name, sourceUrl) => {
    const res = await api.get('/projects/');
    const existing = (res.data || []).find((p) => p.name === name);
    if (existing) return existing.id;

    const created = await api.post('/projects/', { name, repo_url: sourceUrl });
    return created.data.id;
  };

  const stopPolling = () => {
    cancelledRef.current = true;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const cancelScan = () => {
    // There is no backend cancel endpoint: this only stops the client poll and
    // returns to the dashboard. The scan keeps running server-side.
    stopPolling();
    navigate('/dashboard');
  };

  const pollScan = (id) => {
    if (cancelledRef.current) return;

    api
      .get(`/scans/${id}`)
      .then((res) => {
        if (cancelledRef.current) return;
        const current = res.data;
        const previous = scanRef.current;
        scanRef.current = current;
        setScan(current);

        const status = normStatus(current);
        if (!previous || normStatus(previous) !== status) {
          appendLogs([`[POLL] GET /scans/${id} -> status ${status || 'unknown'}`]);
        }

        if (isFinished(current)) {
          if (status === 'COMPLETED') {
            appendLogs([
              `[SCORE] ${SCORING_FORMULA}`,
              `[SCORE] Calculated Security Score: ${current.score ?? 'n/a'}/100`,
              `[COMPLETE] Scan ${id} finished. Redirecting to report...`,
            ]);
            timeoutRef.current = setTimeout(() => {
              if (!cancelledRef.current) navigate(`/scan/${id}`);
            }, 700);
          } else {
            appendLogs([
              `[ERROR] Scan ${id} FAILED.`,
              ...(current.error_detail ? [`[ERROR] Detail: ${current.error_detail}`] : []),
            ]);
          }
          return;
        }

        timeoutRef.current = setTimeout(() => pollScan(id), POLL_INTERVAL_MS);
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        appendLogs([
          `[POLL] GET /scans/${id} failed: ${err.response?.status || err.code || err.message}`,
        ]);
        timeoutRef.current = setTimeout(() => pollScan(id), POLL_INTERVAL_MS);
      });
  };

  const startScan = async () => {
    setSubmitError(null);

    if (ssrfWarning) return;

    if (ingestMode === 'upload' && !selectedFile) {
      // The input is visually hidden, so browser required-validation cannot be
      // relied on; surface the missing file explicitly.
      setFileError('No archive selected. Choose a .zip file up to 50MB to continue.');
      return;
    }

    if (ingestMode === 'git' && !repoUrl.trim()) {
      setSubmitError('A Git clone URL is required to ingest a repository.');
      return;
    }

    setIsScanning(true);
    cancelledRef.current = false;
    scanRef.current = null;
    setScan(null);
    setTerminalLogs([]);

    const logs = [];
    let id = null;

    try {
      if (ingestMode === 'demo') {
        logs.push(`[INGEST] POST /scans/demo -> requesting Juice-Shop demo scan`);
        appendLogs(logs);
        const res = await api.post('/scans/demo');
        id = res.data.scan_id;
        logs.length = 0;
        appendLogs([
          `[INGEST] POST /scans/demo -> 200 {scan_id: ${id}, status: ${res.data.status || 'unknown'}}`,
          `[INGEST] Registered demo scan #${id}`,
        ]);
      } else {
        let name;
        let sourceUrl = '';
        if (ingestMode === 'upload') {
          name = (projectName || selectedFile.name).trim();
          logs.push(`[INGEST] Resolving project "${name}" (derived from archive filename)`);
        } else {
          name = (projectName || nameFromRepo(repoUrl) || 'imported-project').trim();
          sourceUrl = repoUrl.trim();
          logs.push(`[INGEST] Resolving project "${name}" (derived from repository URL)`);
        }
        appendLogs(logs);

        const projectId = await resolveProjectId(name, sourceUrl);
        appendLogs([`[INGEST] Project resolved: id ${projectId}`]);

        const formData = new FormData();
        formData.append('project_id', projectId);
        let endpoint;
        if (ingestMode === 'upload') {
          endpoint = '/scans/upload';
          formData.append('file', selectedFile);
          appendLogs([
            `[INGEST] Archive ${selectedFile.name} (${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB) accepted`,
            `[SECURITY] SSRF validation passed. Ingestion size ceiling verified <= 50MB.`,
            `[INGEST] POST /scans/upload (multipart: project_id, file)`,
          ]);
        } else {
          endpoint = '/scans/git';
          formData.append('repo_url', sourceUrl);
          appendLogs([
            `[SECURITY] SSRF validation passed. Internal IP ranges rejected.`,
            `[INGEST] POST /scans/git (multipart: project_id, repo_url)`,
          ]);
        }

        const res = await api.post(endpoint, formData);
        id = res.data.scan_id;
        appendLogs([
          `[INGEST] POST ${endpoint} -> 200 {scan_id: ${id}, status: ${res.data.status || 'unknown'}}`,
          `[INGEST] Registered scan #${id} for project "${name}"`,
        ]);
      }

      setScanId(id);
      pollScan(id);
    } catch (err) {
      const detail =
        err.response?.data?.detail ||
        err.response?.data?.message ||
        `${err.response?.status || ''} ${err.message}`.trim();
      appendLogs([`[ERROR] Submission rejected: ${detail}`]);
      setSubmitError(detail || 'Failed to start the scan. Check the input and try again.');
      setIsScanning(false);
    }
  };

  const status = scan ? normStatus(scan) : 'PENDING';
  const failed = status === 'FAILED' && isFinished(scan);

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400 mb-3">
          <Layers className="h-3.5 w-3.5" />
          Ingestion & Pipeline Dispatcher
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          Submit Codebase for Security Analysis
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          Upload an archive or provide a remote Git URL. All scans execute asynchronously inside sandboxed containers with no network egress.
        </p>
      </div>

      {!isScanning ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8 space-y-6 shadow-xl">
          {/* Ingestion Mode Toggle Tabs */}
          <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1.5 text-xs font-semibold">
            <button
              id="tab-mode-upload"
              type="button"
              onClick={() => setIngestMode('upload')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition-all ${
                ingestMode === 'upload'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderArchive className="h-4 w-4 text-cyan-400" />
              Upload Archive
            </button>
            <button
              id="tab-mode-git"
              type="button"
              onClick={() => setIngestMode('git')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition-all ${
                ingestMode === 'git'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <GitBranch className="h-4 w-4 text-indigo-400" />
              Git Repository
            </button>
            <button
              id="tab-mode-demo"
              type="button"
              onClick={() => setIngestMode('demo')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition-all ${
                ingestMode === 'demo'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              Demo Target
            </button>
          </div>

          {/* Project Name Field (upload / git only; the demo endpoint takes no project) */}
          {ingestMode !== 'demo' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Project Identifier
              </label>
              <input
                id="input-project-name"
                type="text"
                placeholder="e.g. billing-microservice-prod"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <p className="text-[11px] text-slate-500">
                Matched against existing projects by name; a new project is created when nothing matches.
              </p>
            </div>
          )}

          {/* Mode 1: Zip Upload */}
          {ingestMode === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className={`group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center cursor-pointer transition-all ${
                  selectedFile
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-slate-700/80 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-950'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip"
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 border border-slate-800 text-slate-400 group-hover:scale-105 group-hover:text-emerald-400 transition-all">
                  <Upload className="h-6 w-6" />
                </div>

                <div className="mt-4 space-y-1">
                  {selectedFile ? (
                    <div className="flex flex-col items-center">
                      <span className="text-sm font-bold text-emerald-400 flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        {selectedFile.name}
                      </span>
                      <span className="text-xs text-slate-400 font-mono mt-1">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready for ingestion
                      </span>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-200">
                        Drop your code archive here, or <span className="text-emerald-400 underline">browse files</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        Supports .zip archives up to 50MB maximum (Step 3 validation)
                      </p>
                    </>
                  )}
                </div>
              </div>

              {fileError && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{fileError}</span>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Git Repository URL with SSRF Guard */}
          {ingestMode === 'git' && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Git Clone URL (HTTPS)
                  </label>
                  <span className="text-[11px] text-emerald-400/90 font-mono">
                    SSRF Protection Enabled (Step 11)
                  </span>
                </div>
                <div className="relative">
                  <GitBranch className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    id="input-git-url"
                    type="url"
                    placeholder="https://github.com/organization/microservice-repo"
                    value={repoUrl}
                    onChange={(e) => handleRepoUrlChange(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 pl-10 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400 flex items-center gap-2">
                <Lock className="h-4 w-4 text-emerald-400 shrink-0" />
                <span>Only public or token-authorized repositories allowed. Internal IP ranges blocked.</span>
              </div>

              {ssrfWarning && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{ssrfWarning}</span>
                </div>
              )}
            </div>
          )}

          {/* Mode 3: Demo Target */}
          {ingestMode === 'demo' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-6 sm:p-8 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">OWASP Juice-Shop Demo Target</h4>
                    <p className="text-[11px] text-slate-500 font-mono">POST /scans/demo</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Runs the full pipeline against a deliberately vulnerable demo application so the
                  report, severity normalization, and scoring can be reviewed end to end without
                  uploading code or exposing a repository. The target is provided by the backend;
                  no archive or project is required.
                </p>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Scoring is not linear subtraction. {SCORING_FORMULA}.
                </p>
              </div>
            </div>
          )}

          {submitError && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-5">
            <button
              type="button"
              onClick={() => navigate('/dashboard')}
              className="rounded-xl border border-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              id="btn-trigger-scan"
              type="button"
              onClick={startScan}
              disabled={Boolean(ssrfWarning) || (ingestMode === 'upload' && !selectedFile)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Shield className="h-4 w-4" />
              {ingestMode === 'demo' ? 'Run Demo Scan' : 'Dispatch Security Pipeline'}
            </button>
          </div>
        </div>
      ) : (
        /* Progress & Live Terminal View */
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                {failed ? (
                  <ShieldAlert className="h-5 w-5" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin" />
                )}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  Executing Scan: {projectName || `Scan #${scanId || ''}`}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Scan #{scanId || 'pending'} • status {status || 'PENDING'}
                </p>
              </div>
            </div>
            <span className="font-mono text-xl font-extrabold text-emerald-400">
              {progressFor(status)}%
            </span>
          </div>

          {/* Progress Bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-300 ease-out"
              style={{ width: `${progressFor(status)}%` }}
            />
          </div>

          {/* Pipeline Stage Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 border-y border-slate-800/80 py-4">
            {STAGES.map((stage, i) => {
              const state = stageStates(status)[i];
              return (
                <div
                  key={stage.name}
                  className={`rounded-lg border p-2.5 text-xs transition-all ${
                    state === 'done'
                      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                      : state === 'running'
                        ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 animate-pulse'
                        : state === 'failed'
                          ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
                          : 'border-slate-800 bg-slate-900/40 text-slate-500'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    {state === 'done' ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    ) : state === 'running' ? (
                      <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin shrink-0" />
                    ) : state === 'failed' ? (
                      <AlertCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                    ) : (
                      <div className="h-3.5 w-3.5 rounded-full border border-slate-700 shrink-0" />
                    )}
                    <span className="truncate">{stage.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Live Scanner Terminal Output (Step 10 Progress Indicator) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 font-['JetBrains_Mono',monospace] text-xs shadow-inner">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2 text-[11px] text-slate-400">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                <span>scan-{scanId || 'pending'}.log</span>
              </div>
              <span className="text-[10px] text-slate-500">Live API events</span>
            </div>
            <div className="border-b border-slate-800 bg-amber-500/[0.07] px-4 py-2 text-[11px] text-amber-300/90 leading-relaxed">
              Per-tool progress is not reported by the API; the stage list shows the real pipeline
              order and the scan's live status.
            </div>
            <div
              ref={terminalRef}
              className="h-56 overflow-y-auto p-4 space-y-1.5 text-slate-300 select-text"
            >
              {terminalLogs.map((log, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-slate-600 select-none">[{log.t}]</span>
                  <span
                    className={
                      log.text.includes('[CRITICAL]')
                        ? 'text-rose-400 font-bold'
                        : log.text.includes('[HIGH]')
                          ? 'text-amber-400 font-semibold'
                          : log.text.includes('[ERROR]')
                            ? 'text-rose-400 font-semibold'
                            : log.text.includes('[COMPLETE]')
                              ? 'text-emerald-400 font-bold'
                              : 'text-slate-300'
                    }
                  >
                    {log.text}
                  </span>
                </div>
              ))}
              {failed && scan && scan.error_detail && (
                <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-rose-300">Scan failed</p>
                      <p className="text-xs leading-relaxed break-words">{scan.error_detail}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/dashboard')}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    Back to Dashboard
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-5">
            <button
              type="button"
              onClick={cancelScan}
              className="rounded-xl border border-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            {failed && (
              <button
                type="button"
                onClick={() => navigate(`/scan/${scanId}`)}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 transition"
              >
                <Terminal className="h-4 w-4" />
                View Partial Report
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
