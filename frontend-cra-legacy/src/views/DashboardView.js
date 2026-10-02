import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  Search,
  PlusCircle,
  FileCode,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { normStatus, isFinished } from '../utils/scan.js';
import { relativeTime } from '../utils/time.js';

export default function DashboardView() {
  const navigate = useNavigate();

  const [scans, setScans] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [scansRes, projectsRes] = await Promise.all([
        api.get('/scans/'),
        api.get('/projects/'),
      ]);
      setScans(Array.isArray(scansRes.data) ? scansRes.data : []);
      setProjects(Array.isArray(projectsRes.data) ? projectsRes.data : []);
    } catch (err) {
      setError(err.response?.data?.detail || err.message || 'Unable to load scans.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  // ScanOut rows carry project_id only, so the display name has to be joined
  // from the projects list. Missing project -> fallback, never a invented name.
  const projectNameFor = useCallback(
    (scan) => {
      const project = projects.find((p) => String(p.id) === String(scan.project_id));
      return project?.name || `Project #${scan.project_id}`;
    },
    [projects],
  );

  const showToast = useCallback((message) => {
    setToast(message);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToast(null), 5000);
  }, []);

  const handleDeleteScan = useCallback(
    async (scan) => {
      const name = projectNameFor(scan);
      const ok = window.confirm(
        `Delete project "${name}"?\n\nIts scan records will remain in the history under a generated project name.`,
      );
      if (!ok) return;

      try {
        await api.delete(`/projects/${scan.project_id}`);
        showToast(`Project "${name}" deleted. Scan records were kept in the history.`);
        loadDashboard();
      } catch (err) {
        // Non-fatal: surface the backend's own message rather than hiding the row.
        const detail =
          err.response?.data?.detail ||
          err.response?.data?.message ||
          err.message ||
          'Delete failed.';
        showToast(`Could not delete "${name}": ${detail}`);
      }
    },
    [projectNameFor, loadDashboard, showToast],
  );

  // Computed metrics. Only finished scans have a score worth averaging.
  const finishedScans = scans.filter(isFinished);
  const scoredScans = finishedScans.filter((s) => typeof s.score === 'number');
  const avgScore = scoredScans.length
    ? Math.round(scoredScans.reduce((acc, s) => acc + s.score, 0) / scoredScans.length)
    : null;

  const totalCritical = scans.reduce((acc, s) => acc + (s.critical_count || 0), 0);
  const totalHigh = scans.reduce((acc, s) => acc + (s.high_count || 0), 0);
  const cleanScans = scoredScans.filter((s) => s.score === 100).length;

  const filteredScans = scans.filter((scan) => {
    const name = projectNameFor(scan).toLowerCase();
    const matchesSearch =
      name.includes(searchTerm.toLowerCase()) || String(scan.id).includes(searchTerm.trim());

    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'complete' ? isFinished(scan) : !isFinished(scan));

    let matchesSeverity = true;
    if (severityFilter === 'critical') matchesSeverity = (scan.critical_count || 0) > 0;
    if (severityFilter === 'clean') matchesSeverity = isFinished(scan) && scan.score === 100;

    return matchesSearch && matchesStatus && matchesSeverity;
  });

  const getScoreColor = (score) => {
    if (typeof score !== 'number') return 'text-slate-400 border-slate-700 bg-slate-800/50';
    if (score >= 90) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (score >= 70) return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
    if (score >= 50) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  };

  const getGrade = (score) => {
    if (typeof score !== 'number') return '-';
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-400" />
          <span className="text-sm font-medium">Loading scan records...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-10 w-10 text-amber-400" />
          <h3 className="text-base font-semibold text-slate-200">Could not load the dashboard</h3>
          <p className="text-sm text-slate-500">{error}</p>
          <button
            onClick={loadDashboard}
            className="mt-2 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-teal-400 hover:scale-[1.02] active:scale-[0.98]"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Top Banner / Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-6 sm:p-8">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 h-64 w-64 rounded-full bg-emerald-500/5 blur-3xl" />
        <div className="absolute left-1/3 top-1/2 -mt-16 h-32 w-48 rounded-full bg-blue-500/5 blur-3xl" />

        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              SVS Pipeline Engine Ready
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Code Security & Vulnerability Operations
            </h1>
            <p className="text-sm sm:text-base text-slate-400 leading-relaxed">
              Multi-scanner static analysis orchestrating Semgrep SAST, Gitleaks secret detection, and dependency CVE composition audits in isolated Docker runtimes.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              id="dashboard-new-scan-btn"
              onClick={() => navigate('/scan/new')}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-5 py-2.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-teal-400 hover:scale-[1.02] active:scale-[0.98]"
            >
              <PlusCircle className="h-4 w-4" />
              Launch Security Scan
            </button>
          </div>
        </div>

        {/* High-Level Posture Metrics */}
        <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4 lg:gap-6 border-t border-slate-800/80 pt-6">
          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
            <span className="text-xs font-medium text-slate-400">Mean Posture Score</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-3xl font-bold ${getScoreColor(avgScore).split(' ')[0]}`}>
                {avgScore === null ? 'N/A' : avgScore}
              </span>
              <span className="text-xs text-slate-500 font-mono">/ 100</span>
              <span className="ml-auto rounded-md px-2 py-0.5 text-xs font-bold bg-slate-800 text-slate-200">
                Grade {getGrade(avgScore)}
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-rose-950/40 bg-rose-950/10 p-4">
            <span className="text-xs font-medium text-rose-300/80">Critical Vulnerabilities</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-rose-400">{totalCritical}</span>
              <span className="text-xs text-rose-500/70 font-mono">risk weight 10</span>
            </div>
          </div>

          <div className="rounded-xl border border-amber-950/40 bg-amber-950/10 p-4">
            <span className="text-xs font-medium text-amber-300/80">High Severity Findings</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-amber-400">{totalHigh}</span>
              <span className="text-xs text-amber-500/70 font-mono">risk weight 7</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
            <span className="text-xs font-medium text-slate-400">Scanned Projects</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{projects.length}</span>
              <span className="text-xs text-emerald-400 font-medium">({cleanScans} passing 100%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id="search-scans-input"
            type="text"
            placeholder="Search scans by project name or scan id..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-slate-800 bg-slate-900/90 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 transition-colors focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
            <button
              onClick={() => setStatusFilter('all')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                statusFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Status
            </button>
            <button
              onClick={() => setStatusFilter('complete')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                statusFilter === 'complete' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Complete
            </button>
            <button
              onClick={() => setStatusFilter('scanning')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                statusFilter === 'scanning' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Scanning
            </button>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
            <button
              onClick={() => setSeverityFilter('all')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                severityFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Severities
            </button>
            <button
              onClick={() => setSeverityFilter('critical')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                severityFilter === 'critical' ? 'bg-rose-500/20 text-rose-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Critical
            </button>
            <button
              onClick={() => setSeverityFilter('clean')}
              className={`rounded-md px-3 py-1 font-medium transition ${
                severityFilter === 'clean' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Clean (100)
            </button>
          </div>
        </div>
      </div>

      {/* Scans Listing Table / Cards */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-sm">
        <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
              Scan Records ({filteredScans.length})
            </h2>
            <span className="text-xs text-slate-500">
              Score = 100 / (1 + risk/25) - weights Crit 10 / High 7 / Med 4 / Low 1
            </span>
          </div>
        </div>

        {filteredScans.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-slate-600 mb-3" />
            <h3 className="text-base font-semibold text-slate-300">
              {scans.length === 0 ? 'No scans yet' : 'No scan records match your criteria'}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {scans.length === 0
                ? 'Launch your first security scan to see results here.'
                : 'Try clearing filters or launch a new security scan.'}
            </p>
            <button
              onClick={() => navigate('/scan/new')}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
              New Scan
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredScans.map((scan) => {
              const status = normStatus(scan);
              const totalFindings =
                (scan.critical_count || 0) +
                (scan.high_count || 0) +
                (scan.medium_count || 0) +
                (scan.low_count || 0);
              const failed = status === 'FAILED';
              // PENDING/RUNNING rows arrive with the column default score=100, so
              // only a finished scan has a number worth showing.
              const displayScore = isFinished(scan) ? scan.score : undefined;

              return (
                <div
                  key={scan.id}
                  id={`scan-row-${scan.id}`}
                  className="group flex flex-col gap-4 p-5 transition-colors hover:bg-slate-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* Left: Project & Ingestion Info */}
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 group-hover:border-slate-700">
                      <FileCode className="h-5 w-5 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => navigate(`/scan/${scan.id}`)}
                          className="text-base font-bold text-white hover:text-emerald-400 transition-colors truncate text-left"
                        >
                          {projectNameFor(scan)}
                        </button>
                        <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-mono text-slate-400 border border-slate-800">
                          {scan.id}
                        </span>
                        {!isFinished(scan) && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 px-2 py-0.5 text-[11px] font-mono text-blue-400 border border-blue-500/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-400 animate-pulse" />
                            {status}
                          </span>
                        )}
                        {failed && (
                          <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-[11px] font-mono text-rose-400 border border-rose-500/20">
                            FAILED
                          </span>
                        )}
                      </div>
                      {failed && scan.error_detail ? (
                        <p className="mt-1 text-xs text-rose-400/90 truncate max-w-md font-mono">
                          {scan.error_detail}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400 truncate max-w-md font-mono">
                          {totalFindings} {totalFindings === 1 ? 'finding' : 'findings'} across this scan
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {relativeTime(scan.created_at)}
                        </span>
                        {typeof scan.duration_seconds === 'number' && (
                          <span>• {scan.duration_seconds}s runtime</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Severity Breakdown Pills */}
                  <div className="flex flex-wrap items-center gap-2 sm:justify-center">
                    {scan.critical_count > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 border border-rose-500/30 px-2 py-1 text-xs font-bold text-rose-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-ping" />
                        {scan.critical_count} Critical
                      </span>
                    ) : (
                      <span className="rounded-md bg-slate-900/60 border border-slate-800 px-2 py-1 text-xs text-slate-500">
                        0 Crit
                      </span>
                    )}

                    {scan.high_count > 0 && (
                      <span className="rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-xs font-semibold text-amber-400">
                        {scan.high_count} High
                      </span>
                    )}

                    {scan.medium_count > 0 && (
                      <span className="rounded-md bg-blue-500/15 border border-blue-500/30 px-2 py-1 text-xs font-medium text-blue-400">
                        {scan.medium_count} Med
                      </span>
                    )}

                    {scan.low_count > 0 && (
                      <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400">
                        {scan.low_count} Low
                      </span>
                    )}

                    {totalFindings === 0 && isFinished(scan) && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Zero Vulnerabilities
                      </span>
                    )}
                  </div>

                  {/* Right: Score Gauge & Action */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-slate-800/80 pt-3 sm:border-0 sm:pt-0">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border font-bold ${getScoreColor(displayScore)}`}>
                        <span className="text-base leading-none">
                          {typeof displayScore === 'number' ? displayScore : 'N/A'}
                        </span>
                        <span className="text-[10px] uppercase font-mono opacity-80">Score</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeleteScan(scan)}
                        title="Delete project and scan history"
                        className="inline-flex items-center justify-center rounded-xl border border-slate-800 bg-slate-900 px-2.5 py-2 text-slate-400 transition-all hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        id={`btn-view-report-${scan.id}`}
                        onClick={() => navigate(`/scan/${scan.id}`)}
                        className="inline-flex items-center gap-2 rounded-xl bg-slate-800/90 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-emerald-500 hover:text-slate-950 transition-all"
                      >
                        Report View
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Non-fatal toast for delete outcomes */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-slate-200 shadow-xl shadow-black/40">
          {toast}
        </div>
      )}
    </div>
  );
}
