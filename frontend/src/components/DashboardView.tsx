import React, { useState } from 'react';
import {
  ShieldCheck,
  ShieldAlert,
  Clock,
  Search,
  PlusCircle,
  FileCode,
  GitBranch,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  SlidersHorizontal,
  Flame,
  TrendingUp
} from 'lucide-react';
import { Scan } from '../types';

// A 0-100 sparkline rather than a per-series min/max: an auto-ranging chart
// would make a 96-to-98 wobble look as steep as a 40-to-90 collapse.
function Sparkline({ points, width = 120, height = 36, className = '' }: { points: number[]; width?: number; height?: number; className?: string }) {
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const y = (score: number) => height - (score / 100) * height;
  const coords = points.map((score, i) => `${(i * stepX).toFixed(1)},${y(score).toFixed(1)}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className={className}>
      <polyline
        points={coords}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((score, i) => (
        <circle key={i} cx={i * stepX} cy={y(score)} r={2} fill="currentColor" />
      ))}
    </svg>
  );
}

interface DashboardViewProps {
  scans: Scan[];
  onSelectScan: (scanId: string) => void;
  onNewScan: () => void;
  onDeleteScan: (scanId: string) => void;
  onRefresh: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  scans,
  onSelectScan,
  onNewScan,
  onDeleteScan,
  onRefresh,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');

  // Computed metrics
  const totalScans = scans.length;
  const completedScans = scans.filter(s => s.status === 'complete');
  const avgScore = completedScans.length 
    ? Math.round(completedScans.reduce((acc, s) => acc + s.score, 0) / completedScans.length) 
    : 100;
  
  const totalCritical = completedScans.reduce((acc, s) => acc + s.counts.critical, 0);
  const totalHigh = completedScans.reduce((acc, s) => acc + s.counts.high, 0);
  const totalMedium = completedScans.reduce((acc, s) => acc + s.counts.medium, 0);
  const cleanScans = completedScans.filter(s => s.score === 100).length;

  // Trend tracking. Only completed scans have a real score: an in-flight one
  // carries the column default of 100, which would draw a misleading flat line.
  // Grouped per project so a repo's history is not averaged in with the uploads.
  const trends = scans
    .filter(s => s.status === 'complete')
    .reduce<Record<string, Scan[]>>((byProject, scan) => {
      (byProject[scan.projectId] ||= []).push(scan);
      return byProject;
    }, {});

  const trendProjects = Object.keys(trends)
    .filter(projectId => trends[projectId].length > 1)
    .sort((a, b) => trends[b].length - trends[a].length)
    .map(projectId => ({
      projectId,
      projectName: trends[projectId][0].projectName,
      points: trends[projectId]
        .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
        .map(s => ({ scanId: s.id, startedAt: s.startedAt, score: s.score })),
    }));

  const filteredScans = scans.filter(scan => {
    const matchesSearch = scan.projectName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      scan.sourceName.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || scan.status === statusFilter;
    
    let matchesSeverity = true;
    if (severityFilter === 'critical') matchesSeverity = scan.counts.critical > 0;
    if (severityFilter === 'high') matchesSeverity = scan.counts.high > 0;
    if (severityFilter === 'clean') matchesSeverity = scan.score === 100;

    return matchesSearch && matchesStatus && matchesSeverity;
  });

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10';
    if (score >= 70) return 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10';
    if (score >= 50) return 'text-amber-400 border-amber-500/30 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/30 bg-rose-500/10';
  };

  const getGrade = (score: number) => {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  };

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
              onClick={onRefresh}
              title="Reload scans from the API"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/80 px-3.5 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:bg-slate-800 hover:scale-[1.02] active:scale-[0.98]"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
            <button
              id="dashboard-new-scan-btn"
              onClick={onNewScan}
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
                {avgScore}
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
              <span className="text-xs text-rose-500/70 font-mono">10 risk each</span>
            </div>
          </div>

          <div className="rounded-xl border border-amber-950/40 bg-amber-950/10 p-4">
            <span className="text-xs font-medium text-amber-300/80">High Severity Findings</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-amber-400">{totalHigh}</span>
              <span className="text-xs text-amber-500/70 font-mono">7 risk each</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-800/80 bg-slate-900/40 p-4">
            <span className="text-xs font-medium text-slate-400">Scanned Projects</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-bold text-white">{totalScans}</span>
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
            placeholder="Search scans by repository, archive or project name..."
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
              Score = 100 / (1 + risk/25) &middot; risk: Crit 10 | High 7 | Med 4 | Low 1
            </span>
          </div>
        </div>

        {filteredScans.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldAlert className="mx-auto h-12 w-12 text-slate-600 mb-3" />
            <h3 className="text-base font-semibold text-slate-300">No scan records match your criteria</h3>
            <p className="mt-1 text-sm text-slate-500">Try clearing filters or launch a new security scan.</p>
            <button
              onClick={onNewScan}
              className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
            >
              <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
              New Scan
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/80">
            {filteredScans.map((scan) => {
              const formattedDate = new Date(scan.startedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              });

              return (
                <div
                  key={scan.id}
                  id={`scan-row-${scan.id}`}
                  className="group flex flex-col gap-4 p-5 transition-colors hover:bg-slate-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  {/* Left: Project & Ingestion Info */}
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-300 group-hover:border-slate-700">
                      {scan.sourceType === 'git_repo' ? (
                        <GitBranch className="h-5 w-5 text-indigo-400" />
                      ) : (
                        <FileCode className="h-5 w-5 text-cyan-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => onSelectScan(scan.id)}
                          className="text-base font-bold text-white hover:text-emerald-400 transition-colors truncate text-left"
                        >
                          {scan.projectName}
                        </button>
                        <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-mono text-slate-400 border border-slate-800">
                          {scan.id}
                        </span>
                        {scan.branch && (
                          <span className="rounded-md bg-indigo-500/10 px-2 py-0.5 text-[11px] font-mono text-indigo-400 border border-indigo-500/20">
                            {scan.branch}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400 truncate max-w-md font-mono">
                        {scan.sourceName}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {formattedDate}
                        </span>
                        {scan.durationSeconds && (
                          <span>• {scan.durationSeconds}s runtime</span>
                        )}
                        {scan.commitHash && (
                          <span className="font-mono text-slate-400">commit: {scan.commitHash}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Severity Breakdown Pills */}
                  <div className="flex flex-wrap items-center gap-2 sm:justify-center">
                    {scan.counts.critical > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 border border-rose-500/30 px-2 py-1 text-xs font-bold text-rose-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-ping" />
                        {scan.counts.critical} Critical
                      </span>
                    ) : (
                      <span className="rounded-md bg-slate-900/60 border border-slate-800 px-2 py-1 text-xs text-slate-500">
                        0 Crit
                      </span>
                    )}

                    {scan.counts.high > 0 && (
                      <span className="rounded-md bg-amber-500/15 border border-amber-500/30 px-2 py-1 text-xs font-semibold text-amber-400">
                        {scan.counts.high} High
                      </span>
                    )}

                    {scan.counts.medium > 0 && (
                      <span className="rounded-md bg-blue-500/15 border border-blue-500/30 px-2 py-1 text-xs font-medium text-blue-400">
                        {scan.counts.medium} Med
                      </span>
                    )}

                    {scan.counts.low > 0 && (
                      <span className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-400">
                        {scan.counts.low} Low
                      </span>
                    )}

                    {scan.counts.total === 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-xs font-semibold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Zero Vulnerabilities
                      </span>
                    )}
                  </div>

                  {/* Right: Score Gauge & Action */}
                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t border-slate-800/80 pt-3 sm:border-0 sm:pt-0">
                    <div className="flex items-center gap-2">
                      <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border font-bold ${getScoreColor(scan.score)}`}>
                        <span className="text-base leading-none">{scan.score}</span>
                        <span className="text-[10px] uppercase font-mono opacity-80">Score</span>
                      </div>
                    </div>

                    <button
                      id={`btn-view-report-${scan.id}`}
                      onClick={() => onSelectScan(scan.id)}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-800/90 px-4 py-2 text-xs font-semibold text-slate-100 hover:bg-emerald-500 hover:text-slate-950 transition-all"
                    >
                      Report View
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Posture Trend Over Time */}
      {trendProjects.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-sm">
          <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
                Posture Trend by Project
              </h2>
              <span className="text-xs text-slate-500">
                Score across completed scans, oldest to newest
              </span>
            </div>
          </div>

          <div className="divide-y divide-slate-800/80">
            {trendProjects.map(({ projectId, projectName, points }) => {
              const scores = points.map(p => p.score);
              const latest = points[points.length - 1];
              const delta = scores[scores.length - 1] - scores[0];

              return (
                <div
                  key={projectId}
                  className="flex flex-col gap-4 p-5 transition-colors hover:bg-slate-900/40 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <button
                      onClick={() => onSelectScan(latest.scanId)}
                      className="text-sm font-bold text-white hover:text-emerald-400 transition-colors truncate text-left"
                    >
                      {projectName}
                    </button>
                    <p className="mt-1 text-xs text-slate-500">
                      {points.length} completed scans &middot; since{' '}
                      {new Date(points[0].startedAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </p>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-xl border font-bold ${getScoreColor(latest.score)}`}>
                      <span className="text-base leading-none">{latest.score}</span>
                      <span className="text-[10px] uppercase font-mono opacity-80">Latest</span>
                    </div>
                    <Sparkline points={scores} className="text-emerald-400" />
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-rose-400' : 'text-slate-400'}`}>
                      <TrendingUp className="h-3.5 w-3.5" />
                      {delta > 0 ? '+' : ''}{delta} pts
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
