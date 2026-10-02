import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  AlertTriangle,
  Clock,
  FileCode,
  Download,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Loader2,
} from 'lucide-react';
import api from '../services/api.js';
import { normStatus, isFinished } from '../utils/scan.js';
import { relativeTime } from '../utils/time.js';

// The tool values the backend actually derives from vulnerability_type; see
// backend/app/api/scans.py tool_for(). Matched case-insensitively so a casing
// change on either side does not silently empty the filter.
const TOOL_FILTERS = ['Semgrep', 'Gitleaks', 'SCA Audit'];

const getScoreColor = (score) => {
  if (score >= 90) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
  if (score >= 70) return 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10';
  if (score >= 50) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
  return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
};

const getGrade = (score) => {
  if (score >= 90) return { grade: 'A', label: 'Hardened Posture' };
  if (score >= 80) return { grade: 'B', label: 'Satisfactory' };
  if (score >= 70) return { grade: 'C', label: 'Needs Remediation' };
  if (score >= 60) return { grade: 'D', label: 'Elevated Risk' };
  return { grade: 'F', label: 'Critical Exposure' };
};

const sevKey = (severity) => String(severity || '').toLowerCase();

const SEV_ICON_CLASS = {
  critical: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
  high: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  low: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
  info: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
};

const SEV_BADGE_CLASS = {
  critical: 'bg-rose-500/20 text-rose-300',
  high: 'bg-amber-500/20 text-amber-300',
  medium: 'bg-blue-500/20 text-blue-300',
  low: 'bg-slate-700/40 text-slate-300',
  info: 'bg-slate-700/40 text-slate-300',
};

const sevIconClass = (severity) =>
  SEV_ICON_CLASS[sevKey(severity)] || SEV_ICON_CLASS.info;

const sevBadgeClass = (severity) =>
  SEV_BADGE_CLASS[sevKey(severity)] || SEV_BADGE_CLASS.info;

function ScanReportView() {
  const { scanId } = useParams();
  const navigate = useNavigate();

  const [scan, setScan] = useState(null);
  const [project, setProject] = useState(null);
  const [findings, setFindings] = useState([]);
  const [polling, setPolling] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [severityFilter, setSeverityFilter] = useState('all');
  const [scannerFilter, setScannerFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFindingId, setExpandedFindingId] = useState(null);

  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let projectFetched = false;
    let timer;

    const poll = async () => {
      if (cancelled) return;
      try {
        const res = await api.get(`/scans/${scanId}`);
        if (cancelled) return;
        setScan(res.data);

        // A ScanOut row carries project_id only, so the name has to be joined
        // separately. Fetched on first sight rather than after the scan settles
        // so a long-running scan still shows which project it belongs to.
        if (res.data.project_id && !projectFetched) {
          projectFetched = true;
          api.get(`/projects/${res.data.project_id}`)
            .then((r) => { if (!cancelled) setProject(r.data); })
            .catch(() => {});
        }

        if (isFinished(res.data)) {
          setPolling(false);
          try {
            const f = await api.get(`/scans/${scanId}/findings`);
            if (!cancelled) setFindings(f.data);
          } catch {
            if (!cancelled) setFindings([]);
          }
        } else {
          timer = setTimeout(poll, 3000);
        }
      } catch (err) {
        if (cancelled) return;
        setPolling(false);
        setLoadError(
          err.response?.data?.detail ||
            'Failed to load this scan. It may not exist.'
        );
      }
    };

    timer = setTimeout(poll, 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scanId]);

  const handleExportPDF = async () => {
    setExportError('');
    setExporting(true);
    try {
      const response = await api.get(`/scans/${scanId}/export`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `scan_report_${scanId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(
        err.response?.data?.detail || 'Failed to download the PDF report.'
      );
    } finally {
      setExporting(false);
    }
  };

  if (polling) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 pb-16 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-emerald-400" />
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white">
            Scan #{scanId} in progress
          </h1>
          <p className="mt-1 font-mono text-xs uppercase tracking-wider text-slate-400">
            {scan ? normStatus(scan) : 'starting'}
          </p>
        </div>
        <p className="text-xs text-slate-500">
          This report refreshes every few seconds until the scan finishes.
        </p>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 pb-16 text-center">
        <AlertTriangle className="h-10 w-10 text-amber-400" />
        <h1 className="text-2xl font-extrabold tracking-tight text-white">
          Scan not found
        </h1>
        <p className="text-xs text-slate-400">
          {loadError || 'This scan does not exist or could not be loaded.'}
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
        >
          &larr; Back to All Scans
        </button>
      </div>
    );
  }

  const status = normStatus(scan);
  const hasScore = scan.score !== null && scan.score !== undefined;
  const gradeInfo = getGrade(hasScore ? scan.score : 0);
  const counts = {
    critical: scan.critical || 0,
    high: scan.high || 0,
    medium: scan.medium || 0,
    low: scan.low || 0,
  };
  const projectName = project ? project.name : `Project #${scan.project_id}`;
  const failed = status === 'FAILED';

  const filteredFindings = findings.filter((f) => {
    const matchesSeverity =
      severityFilter === 'all' || sevKey(f.severity) === severityFilter;
    const matchesScanner =
      scannerFilter === 'all' ||
      String(f.tool || '').toLowerCase() === scannerFilter.toLowerCase();
    const term = searchTerm.toLowerCase();
    const matchesSearch =
      String(f.title || '').toLowerCase().includes(term) ||
      String(f.description || '').toLowerCase().includes(term) ||
      String(f.file || '').toLowerCase().includes(term);
    return matchesSeverity && matchesScanner && matchesSearch;
  });

  return (
    <div className="space-y-8 pb-16">
      {/* Navigation Breadcrumb & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/dashboard')}
            className="rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
          >
            &larr; Back to All Scans
          </button>
          <span className="text-slate-600">/</span>
          <span className="font-mono text-xs text-slate-400">{scan.id}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-export-pdf"
            onClick={handleExportPDF}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {exporting ? 'Generating PDF…' : 'Export PDF Report'}
          </button>
        </div>
      </div>

      {exportError && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-4 text-sm font-medium text-rose-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="break-words text-xs">{exportError}</span>
        </div>
      )}

      {/* Hero Overview Card with Score Gauge */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-6 shadow-xl sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Left Metadata */}
          <div className="max-w-2xl space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <span
                className={`rounded-lg border px-2.5 py-1 font-mono text-xs ${
                  failed
                    ? 'border-rose-500/20 bg-rose-500/10 text-rose-400'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                }`}
              >
                Scan Status: {status || 'UNKNOWN'}
              </span>
              {project && project.repo_url && (
                <span className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-1 font-mono text-xs text-indigo-300">
                  Git Repository
                </span>
              )}
            </div>

            <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              {projectName}
            </h1>

            {project && project.repo_url && (
              <p className="break-all font-mono text-xs text-slate-400">
                Target: {project.repo_url}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-4 pt-1 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Scanned on {new Date(scan.created_at).toLocaleString()} ({relativeTime(scan.created_at)})
              </span>
              {scan.duration !== null && scan.duration !== undefined && (
                <span>• Duration: {scan.duration}s</span>
              )}
            </div>
          </div>

          {/* Right: Score Gauge Card */}
          <div className="flex flex-col items-center gap-6 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-6 sm:flex-row">
            <div className="flex flex-col items-center justify-center">
              <div
                className={`flex h-24 w-24 flex-col items-center justify-center rounded-2xl border-2 shadow-xl ${getScoreColor(
                  hasScore ? scan.score : 0
                )}`}
              >
                <span className="text-3xl font-extrabold leading-none tracking-tight">
                  {hasScore ? scan.score : '—'}
                </span>
                <span className="mt-1 text-[11px] font-mono uppercase tracking-wider opacity-80">
                  / 100
                </span>
              </div>
            </div>

            <div className="space-y-1.5 text-center sm:text-left">
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <span className="text-lg font-bold text-white">
                  Grade {hasScore ? gradeInfo.grade : '—'}
                </span>
                <span className="text-xs text-slate-400">
                  • {hasScore ? gradeInfo.label : 'Scan incomplete'}
                </span>
              </div>
              <p className="max-w-xs text-xs leading-relaxed text-slate-400">
                Score decays with total risk rather than being subtracted from 100:
                <br />
                <span className="font-mono text-[11px] text-slate-500">
                  100 / (1 + risk/25) • weights Crit 10 / High 7 / Med 4 / Low 1
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Severity Metrics Bar */}
        <div className="mt-8 grid grid-cols-2 gap-3 border-t border-slate-800/80 pt-6 sm:grid-cols-4">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5">
            <span className="text-xs font-semibold text-rose-300">Critical</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-rose-400">
                {counts.critical}
              </span>
              <span className="font-mono text-[11px] text-rose-400/70">weight 10</span>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
            <span className="text-xs font-semibold text-amber-300">High</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-amber-400">
                {counts.high}
              </span>
              <span className="font-mono text-[11px] text-amber-400/70">weight 7</span>
            </div>
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5">
            <span className="text-xs font-semibold text-blue-300">Medium</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-blue-400">
                {counts.medium}
              </span>
              <span className="font-mono text-[11px] text-blue-400/70">weight 4</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3.5">
            <span className="text-xs font-semibold text-slate-300">Low</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-300">
                {counts.low}
              </span>
              <span className="font-mono text-[11px] text-slate-500">weight 1</span>
            </div>
          </div>
        </div>
      </div>

      {failed && (
        <div className="flex items-start gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
          <div>
            <p className="mb-1 text-xs font-black uppercase tracking-widest text-rose-400">
              Scan failed
            </p>
            <p className="break-words font-mono text-xs text-rose-300/90">
              {scan.error_detail || 'One or more scanners did not finish.'}
            </p>
            <p className="mt-2 text-[11px] text-slate-500">
              The report above covers a partial run. Re-run the scan for a complete set of findings.
            </p>
          </div>
        </div>
      )}

      {!failed && (
        <>
          {/* Filter and Finding Search Bar */}
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative max-w-md flex-1">
                <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search findings by title, description, or file path..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full rounded-xl border border-slate-800 bg-slate-900 py-2 pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {/* Severity Filter */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
                  <button
                    onClick={() => setSeverityFilter('all')}
                    className={`rounded-md px-2.5 py-1 ${
                      severityFilter === 'all'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    All ({findings.length})
                  </button>
                  <button
                    onClick={() => setSeverityFilter('critical')}
                    className={`rounded-md px-2.5 py-1 ${
                      severityFilter === 'critical'
                        ? 'bg-rose-500/20 font-bold text-rose-300'
                        : 'text-slate-400'
                    }`}
                  >
                    Crit ({counts.critical})
                  </button>
                  <button
                    onClick={() => setSeverityFilter('high')}
                    className={`rounded-md px-2.5 py-1 ${
                      severityFilter === 'high'
                        ? 'bg-amber-500/20 font-bold text-amber-300'
                        : 'text-slate-400'
                    }`}
                  >
                    High ({counts.high})
                  </button>
                  <button
                    onClick={() => setSeverityFilter('medium')}
                    className={`rounded-md px-2.5 py-1 ${
                      severityFilter === 'medium'
                        ? 'bg-blue-500/20 font-bold text-blue-300'
                        : 'text-slate-400'
                    }`}
                  >
                    Med ({counts.medium})
                  </button>
                </div>

                {/* Scanner Filter */}
                <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
                  <button
                    onClick={() => setScannerFilter('all')}
                    className={`rounded-md px-2.5 py-1 ${
                      scannerFilter === 'all'
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400'
                    }`}
                  >
                    All Tools
                  </button>
                  {TOOL_FILTERS.map((tool) => (
                    <button
                      key={tool}
                      onClick={() => setScannerFilter(tool)}
                      className={`rounded-md px-2.5 py-1 ${
                        scannerFilter.toLowerCase() === tool.toLowerCase()
                          ? 'bg-emerald-500/20 font-medium text-emerald-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {tool === 'SCA Audit' ? 'SCA' : tool}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Findings List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Detected Vulnerabilities &amp; Remediations ({filteredFindings.length})
              </h2>
              <span className="text-xs text-slate-500">
                Click a finding card for the description and remediation guidance
              </span>
            </div>

            {findings.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
                <ShieldCheck className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  No vulnerabilities detected
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  This scan completed cleanly and reported no findings.
                </p>
              </div>
            ) : filteredFindings.length === 0 ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
                <ShieldCheck className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
                <h3 className="text-base font-bold text-white">
                  No vulnerabilities found in this view
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  Every finding was filtered out. Widen the severity, tool, or search filters above.
                </p>
              </div>
            ) : (
              filteredFindings.map((finding) => {
                const isExpanded = expandedFindingId === finding.id;

                return (
                  <div
                    key={finding.id}
                    id={`finding-${finding.id}`}
                    className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-md transition-all"
                  >
                    {/* Finding Header Clickable */}
                    <div
                      onClick={() =>
                        setExpandedFindingId(isExpanded ? null : finding.id)
                      }
                      className="flex cursor-pointer flex-col justify-between gap-4 bg-slate-900/50 p-5 transition-colors hover:bg-slate-900/80 sm:flex-row sm:items-center"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${sevIconClass(
                            finding.severity
                          )}`}
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </div>

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-white">
                              {finding.title}
                            </span>
                            <span
                              className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${sevBadgeClass(
                                finding.severity
                              )}`}
                            >
                              {finding.severity}
                            </span>
                            <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-slate-400">
                              {finding.tool}
                            </span>
                          </div>

                          <div className="mt-1 flex items-center gap-2 font-mono text-xs text-slate-400">
                            <FileCode className="h-3.5 w-3.5 text-slate-500" />
                            <span className="break-all text-slate-300">
                              {finding.file}
                            </span>
                            {finding.line !== null &&
                              finding.line !== undefined &&
                              finding.line > 0 && (
                                <span className="font-bold text-emerald-400">
                                  :line {finding.line}
                                </span>
                              )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-slate-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-slate-400" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Card Details */}
                    {isExpanded && (
                      <div className="space-y-6 border-t border-slate-800/80 bg-slate-950 p-5 sm:p-6">
                        {/* Vulnerability Description */}
                        <div className="space-y-1.5">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                            Vulnerability Summary &amp; Impact
                          </h4>
                          <p className="text-xs leading-relaxed text-slate-200 sm:text-sm">
                            {finding.description || 'No description provided by the scanner.'}
                          </p>
                        </div>

                        {/* Remediation Panel */}
                        <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-5">
                          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
                            <Sparkles className="h-3.5 w-3.5" />
                            Recommended Remediation
                          </h4>

                          <p className="text-xs leading-relaxed text-slate-300">
                            {finding.remediation ||
                              'No remediation guidance recorded.'}
                          </p>

                          <div className="flex items-center justify-end border-t border-emerald-500/10 pt-3">
                            <span className="font-mono text-[11px] text-slate-500">
                              ID: {finding.id}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default ScanReportView;
