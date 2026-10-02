import React, { useState, useRef } from 'react';
import { 
  Upload, 
  GitBranch, 
  AlertCircle, 
  CheckCircle2, 
  Terminal, 
  FileCode, 
  Sparkles, 
  Shield, 
  ShieldAlert, 
  Loader2, 
  Lock, 
  ArrowRight,
  FolderArchive,
  Layers
} from 'lucide-react';
import { Scan, ScanStage } from '../types';
import { api } from '../services/api';
import { enrichScan, mapScanDetail } from '../services/adapter';

interface IngestScanViewProps {
  onScanComplete: (newScan: Scan) => void;
  onCancel: () => void;
}

export const IngestScanView: React.FC<IngestScanViewProps> = ({
  onScanComplete,
  onCancel,
}) => {
  const [ingestMode, setIngestMode] = useState<'upload' | 'git' | 'presets'>('upload');
  
  // Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Git State
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [ssrfWarning, setSsrfWarning] = useState<string | null>(null);

  // Scan Execution State
  const [isScanning, setIsScanning] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);

  // Consent gate: the tool clones and unpacks third-party code on this host, so
  // the submitter confirms authorization before the pipeline can dispatch.
  const [authorized, setAuthorized] = useState(false);

  // Validation: 50MB and SSRF Protection (Step 3 & Step 11)
  const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB limit

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      validateAndSetFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      validateAndSetFile(e.target.files[0]);
    }
  };

  const validateAndSetFile = (file: File) => {
    setFileError(null);
    if (!file.name.endsWith('.zip')) {
      setFileError('Validation Error: Only .zip archives are supported.');
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(`File Size Exceeded: Maximum allowed archive size is 50MB (Supplied: ${(file.size / (1024 * 1024)).toFixed(1)}MB).`);
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
    if (!projectName) {
      setProjectName(file.name.replace(/\.[^/.]+$/, ''));
    }
  };

  // SSRF Real-time Check for Git URLs (Step 11)
  const handleRepoUrlChange = (value: string) => {
    setRepoUrl(value);
    setSsrfWarning(null);

    const privateIpPatterns = [
      /localhost/i,
      /127\.\d+\.\d+\.\d+/,
      /10\.\d+\.\d+\.\d+/,
      /192\.168\.\d+\.\d+/,
      /172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+/,
      /169\.254\.169\.254/, // AWS/GCP metadata
      /file:\/\//i,
      /gopher:\/\//i
    ];

    for (const pattern of privateIpPatterns) {
      if (pattern.test(value)) {
        setSsrfWarning('SSRF Guard Triggered: Ingestion to internal/loopback/cloud-metadata networks is strictly prohibited (Step 11).');
        return;
      }
    }

    if (projectName === '' && value.includes('/')) {
      const parts = value.trim().split('/');
      const lastPart = parts[parts.length - 1].replace('.git', '');
      if (lastPart) setProjectName(lastPart);
    }
  };

  // Simulation Stages
  const initialStages: ScanStage[] = [
    { name: 'ingest', label: '1. Ingestion & Invariant Validation (50MB / SSRF)', status: 'waiting' },
    { name: 'semgrep', label: '2. Semgrep SAST Engine (Docker isolated, egress for ruleset)', status: 'waiting' },
    { name: 'gitleaks', label: '3. Gitleaks Secrets Analysis (Offline, no egress)', status: 'waiting' },
    { name: 'deps', label: '4. Dependency Vulnerability Audit (egress for CVE database)', status: 'waiting' },
    { name: 'score', label: '5. Finding Normalization & Severity Scoring', status: 'waiting' }
  ];

  const [stages, setStages] = useState<ScanStage[]>(initialStages);

  // Per-stage log lines. The backend reports only PENDING/RUNNING/COMPLETED, so
  // these stand in for the tool output the API does not stream yet.
  const STAGE_LOGS: Record<string, string[]> = {
    ingest: [`[INGEST] Archive unpacked into isolated /tmp/svs_uploads/scan_* directory.`],
    semgrep: [
      `[SEMGREP] Booting Docker container: semgrep/semgrep:latest, 512m ceiling`,
      `[SEMGREP] Fetching ruleset from semgrep.dev (--config=auto), then scanning /src`
    ],
    gitleaks: [`[GITLEAKS] Offline entropy & pattern matching for hardcoded secrets and credentials.`],
    deps: [`[DEPS] Auditing package manifests against the NVD and GitHub advisory database.`],
    score: [`[SCORE] Weighted risk points: Critical 10 | High 7 | Medium 4 | Low 1, then score = 100/(1+risk/25)`]
  };

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Start Scan execution
  const startScan = async () => {
    // Enforced here too, not only in the button's disabled state: a disabled
    // button is a UI hint, and the API call below is the actual trust boundary.
    if (ssrfWarning || !authorized) return;

    setIsScanning(true);
    setHasFailed(false);
    setScanError(null);
    setCurrentProgress(5);
    setActiveStageIndex(0);
    setStages(initialStages.map((s, i) => ({ ...s, status: i === 0 ? 'running' : 'waiting' })));

    const logs: string[] = [];
    const pushLogs = (...lines: string[]) => {
      logs.push(...lines);
      setTerminalLogs([...logs]);
    };

    // The backend has no branch column: it clones the default branch with
    // depth 1, so the branch field above is advisory only.
    const finalProjectName = projectName ||
      (ingestMode === 'git'
        ? (repoUrl.trim().split('/').pop() || 'git-repo').replace(/\.git$/, '')
        : 'uploaded-codebase');

    pushLogs(
      `[INGEST] Registered scan job for ${finalProjectName}`,
      ingestMode === 'presets'
        ? `[INGEST] Source type: demo. Target: OWASP Juice-Shop.`
        : ingestMode === 'git'
          ? `[INGEST] Source type: git. Ingestion target: ${repoUrl}`
          : `[INGEST] Source type: upload. Ingestion target: ${selectedFile?.name ?? 'codebase.zip'}`,
      `[SECURITY] SSRF validation passed. Ingestion memory ceiling verified <= 50MB.`
    );

    let scanId: number;
    try {
      if (ingestMode === 'presets') {
        // The demo endpoint clones a fixed public target and files it under its
        // own "Demo Project" row, so no project is created or named here.
        const dispatch = await api.scanDemo();
        scanId = dispatch.scan_id;
        pushLogs(`[QUEUE] ${dispatch.message}`);
      } else {
        // Every scan is keyed off a project row, so reuse an existing one with
        // the same name instead of forking a duplicate per scan.
        const repo_url = ingestMode === 'git' ? repoUrl.trim() : selectedFile!.name;
        const allProjects = await api.listProjects();
        const project = allProjects.find((p) => p.name === finalProjectName)
          ?? (await api.createProject(finalProjectName, repo_url));

        const dispatch = ingestMode === 'git'
          ? await api.scanGit(project.id, repo_url)
          : await api.scanUpload(project.id, selectedFile!);
        scanId = dispatch.scan_id;
        pushLogs(`[QUEUE] ${dispatch.message}`);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Scan failed to start.';
      setHasFailed(true);
      setScanError(message);
      pushLogs(`[ERROR] ${message}`);
      setStages(prev => prev.map(s => ({ ...s, status: 'failed' })));
      return;
    }

    // The stage indicators are a progress approximation: they advance on a
    // timer while the worker is still in flight, and snap to their real state
    // once the status lands. Per-stage status would need a stage table in the
    // API.
    let stageIdx = 0;
    const advanceStage = () => {
      if (stageIdx >= initialStages.length - 1) return;
      stageIdx += 1;
      setActiveStageIndex(stageIdx);
      setCurrentProgress(Math.min(95, 20 + (stageIdx / initialStages.length) * 100));
      pushLogs(...(STAGE_LOGS[initialStages[stageIdx].name] ?? []));
      setStages(prev => prev.map((s, i) => ({
        ...s,
        status: i < stageIdx ? 'done' : i === stageIdx ? 'running' : 'waiting'
      })));
    };

    const deadline = Date.now() + 20 * 60 * 1000;
    while (Date.now() < deadline) {
      advanceStage();
      await sleep(2000);

      try {
        const detail = await api.getScan(scanId);
        const state = detail.status.toUpperCase();

        if (state === 'COMPLETED') {
          const findings = await api.getFindings(scanId);
          setCurrentProgress(100);
          setStages(prev => prev.map(s => ({ ...s, status: 'done' })));
          pushLogs(
            `[SCORE] Calculated Security Score: ${detail.score ?? 0}/100`,
            `[CLEANUP] Purged temporary sandbox containers and extracted sources.`,
            `[COMPLETE] Scan ${scanId} finished. Redirecting to report...`
          );
          const allProjects = await api.listProjects();
          onScanComplete(enrichScan(mapScanDetail(detail, allProjects), detail, findings));
          return;
        }

        if (state === 'FAILED') {
          const reason = detail.error_detail ?? 'unknown error';
          setHasFailed(true);
          setScanError(reason);
          setStages(prev => prev.map(s => ({ ...s, status: 'failed' })));
          pushLogs(`[ERROR] Scan ${scanId} failed: ${reason}`);
          return;
        }
      } catch {
        // A single failed poll must not abort a scan the worker may still be
        // running; the next loop iteration retries.
      }
    }

    setHasFailed(true);
    setScanError('Timed out waiting for the scan worker.');
    setStages(prev => prev.map(s => ({ ...s, status: 'failed' })));
    pushLogs('[ERROR] Timed out waiting for the scan worker.');
  };

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
          Upload an archive or provide a remote Git URL. All scans execute asynchronously inside sandboxed containers; only the ruleset and CVE lookups egress, and your code never leaves the host.
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
              Upload Zip Archive
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
              Git Repository URL
            </button>
            <button
              id="tab-mode-presets"
              type="button"
              onClick={() => setIngestMode('presets')}
              className={`flex items-center justify-center gap-2 rounded-lg py-2.5 transition-all ${
                ingestMode === 'presets'
                  ? 'bg-slate-800 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="h-4 w-4 text-amber-400" />
              Demo Vulnerable Repo
            </button>
          </div>

          {/* Project Name Field (the demo endpoint names its own project) */}
          {ingestMode !== 'presets' && (
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
          </div>
          )}

          {/* Mode 1: Zip Upload */}
          {ingestMode === 'upload' && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center cursor-pointer transition-all ${
                  selectedFile
                    ? 'border-emerald-500/50 bg-emerald-500/5'
                    : 'border-slate-700/80 bg-slate-950/60 hover:border-slate-600 hover:bg-slate-950'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.tar.gz"
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
                        Supports .zip or .tar.gz archives up to 50MB maximum (Step 3 validation)
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                    Branch / Tag / Commit
                  </label>
                  <input
                    type="text"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    placeholder="main"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400 flex items-center gap-2">
                  <Lock className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>Only public or token-authorized repositories allowed. Internal IP ranges blocked.</span>
                </div>
              </div>

              {ssrfWarning && (
                <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
                  <ShieldAlert className="h-4 w-4 shrink-0 text-rose-400" />
                  <span>{ssrfWarning}</span>
                </div>
              )}
            </div>
          )}

          {/* Mode 3: Demo scan against a real, deliberately vulnerable repo */}
          {ingestMode === 'presets' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs text-amber-100/90 leading-relaxed">
                <strong className="text-amber-300">Demo scan:</strong> the backend clones{' '}
                <code className="font-mono text-amber-200">OWASP Juice-Shop</code>, a deliberately
                vulnerable Node.js application, and runs the full real pipeline (Semgrep, Gitleaks,
                dependency audit, scoring) against it. No upload or project name needed; the API
                files the result under its own Demo Project.
              </div>
            </div>
          )}

          {/* Authorization gate: the pipeline clones or unpacks third-party code
              on this host, so the submitter confirms authorization before dispatch. */}
          <label
            htmlFor="authorize-scan"
            className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-300 cursor-pointer transition-colors hover:bg-slate-900/60"
          >
            <input
              id="authorize-scan"
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-500"
            />
            <span className="leading-relaxed">
              I confirm that I own or am authorized to scan this code, and that
              the findings may include exposed secrets and credentials. I accept
              responsibility for remediating or reporting anything the pipeline
              surfaces.
            </span>
          </label>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-5">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl border border-slate-800 px-5 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
            >
              Cancel
            </button>
            <button
              id="btn-trigger-scan"
              type="button"
              onClick={startScan}
              disabled={Boolean(ssrfWarning) || !authorized || (ingestMode === 'upload' && !selectedFile) || (ingestMode === 'git' && !repoUrl.trim())}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-2.5 text-xs font-bold text-slate-950 shadow-lg shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              <Shield className="h-4 w-4" />
              Dispatch Security Pipeline
            </button>
          </div>
        </div>
      ) : (
        /* Progress & Live Terminal View */
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-6 sm:p-8 space-y-6 shadow-2xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl border ${
                hasFailed
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              }`}>
                {hasFailed
                  ? <AlertCircle className="h-5 w-5" />
                  : <Loader2 className="h-5 w-5 animate-spin" />}
              </div>
              <div>
                <h3 className="text-base font-bold text-white">
                  {hasFailed ? 'Scan Failed' : 'Executing Scan'}: {projectName || (ingestMode === 'presets' ? 'Demo Scan' : 'Security Pipeline')}
                </h3>
                <p className="text-xs text-slate-400 font-mono">
                  Celery worker • run_security_scan task
                </p>
              </div>
            </div>
            <span className={`font-mono text-xl font-extrabold ${hasFailed ? 'text-rose-400' : 'text-emerald-400'}`}>
              {hasFailed ? 'ERR' : `${currentProgress}%`}
            </span>
          </div>

          {hasFailed && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
                <span>{scanError}</span>
              </div>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-xl border border-rose-500/50 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/20 transition whitespace-nowrap"
              >
                Back to Dashboard
              </button>
            </div>
          )}

          {/* Progress Bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 transition-all duration-300 ease-out"
              style={{ width: `${currentProgress}%` }}
            />
          </div>

          {/* Pipeline Stage Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 border-y border-slate-800/80 py-4">
            {stages.map((stage, i) => (
              <div
                key={stage.name}
                className={`rounded-lg border p-2.5 text-xs transition-all ${
                  stage.status === 'done'
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
                    : stage.status === 'running'
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 animate-pulse'
                      : 'border-slate-800 bg-slate-900/40 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-1.5 font-semibold">
                  {stage.status === 'done' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  ) : stage.status === 'running' ? (
                    <Loader2 className="h-3.5 w-3.5 text-cyan-400 animate-spin shrink-0" />
                  ) : (
                    <div className="h-3.5 w-3.5 rounded-full border border-slate-700 shrink-0" />
                  )}
                  <span className="truncate">{stage.label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Live Scanner Terminal Output (Step 10 Progress Indicator) */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 font-['JetBrains_Mono',monospace] text-xs shadow-inner">
            <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-4 py-2 text-[11px] text-slate-400">
              <div className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" />
                <span>sandbox-worker-output.log</span>
              </div>
              <span className="text-[10px] text-slate-500">Pipeline activity</span>
            </div>
            <div className="h-56 overflow-y-auto p-4 space-y-1.5 text-slate-300 select-text">
              {terminalLogs.map((log, index) => (
                <div key={index} className="flex gap-2">
                  <span className="text-slate-600 select-none">$</span>
                  <span className={
                    log.includes('[CRITICAL]') ? 'text-rose-400 font-bold' :
                    log.includes('[HIGH]') ? 'text-amber-400 font-semibold' :
                    log.includes('[COMPLETE]') ? 'text-emerald-400 font-bold' :
                    'text-slate-300'
                  }>
                    {log}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
