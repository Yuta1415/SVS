import React, { useState } from 'react';
import { 
  ShieldAlert, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  FileCode, 
  GitBranch, 
  Download, 
  Share2, 
  Search, 
  Copy, 
  Check, 
  ChevronDown, 
  ChevronUp, 
  Tag, 
  ExternalLink,
  Layers,
  Filter,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { Finding, FindingStatus, Scan, Severity } from '../types';
import { api } from '../services/api';

interface ScanReportViewProps {
  scan: Scan;
  onBackToDashboard: () => void;
  onUpdateFindingStatus: (findingId: string, status: FindingStatus) => void;
}

export const ScanReportView: React.FC<ScanReportViewProps> = ({
  scan,
  onBackToDashboard,
  onUpdateFindingStatus,
}) => {
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [scannerFilter, setScannerFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(
    scan.findings && scan.findings.length > 0 ? scan.findings[0].id : null
  );
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);

  const findings = scan.findings || [];

  const filteredFindings = findings.filter(f => {
    const matchesSeverity = severityFilter === 'all' || f.severity === severityFilter;
    const matchesScanner = scannerFilter === 'all' || f.scanner === scannerFilter;
    const matchesStatus = statusFilter === 'all' || f.status === statusFilter;
    const matchesSearch = 
      f.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      f.filePath.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (f.cwe && f.cwe.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (f.cve && f.cve.toLowerCase().includes(searchTerm.toLowerCase()));

    return matchesSeverity && matchesScanner && matchesStatus && matchesSearch;
  });

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (score >= 70) return 'text-cyan-400 border-cyan-500/40 bg-cyan-500/10';
    if (score >= 50) return 'text-amber-400 border-amber-500/40 bg-amber-500/10';
    return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
  };

  const getGrade = (score: number) => {
    if (score >= 90) return { grade: 'A', label: 'Hardened Posture' };
    if (score >= 80) return { grade: 'B', label: 'Satisfactory' };
    if (score >= 70) return { grade: 'C', label: 'Needs Remediation' };
    if (score >= 60) return { grade: 'D', label: 'Elevated Risk' };
    return { grade: 'F', label: 'Critical Exposure' };
  };

  const handleCopyCode = (id: string, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSnippetId(id);
    setTimeout(() => setCopiedSnippetId(null), 2000);
  };

  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(scan, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `SVS-Report-${scan.projectName}-${scan.id}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const gradeInfo = getGrade(scan.score);

  return (
    <div className="space-y-8 pb-16">
      {/* Navigation Breadcrumb & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToDashboard}
            className="rounded-xl border border-slate-800 bg-slate-900/80 px-3.5 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-800 transition"
          >
            ← Back to All Scans
          </button>
          <span className="text-slate-600">/</span>
          <span className="text-xs font-mono text-slate-400">{scan.id}</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="btn-export-json"
            onClick={handleExportJSON}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export JSON Report
          </button>
          <a
            id="btn-export-pdf"
            href={api.exportUrl(Number(scan.id))}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition"
          >
            <Download className="h-3.5 w-3.5" />
            Server PDF Report
          </a>
          <a
            id="btn-export-sarif"
            href={api.sarifUrl(Number(scan.id))}
            download
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition"
          >
            <Download className="h-3.5 w-3.5" />
            Export SARIF
          </a>
        </div>
      </div>

      {/* Hero Overview Card with Score Gauge (Step 6) */}
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 via-slate-950 to-slate-950 p-6 sm:p-8 shadow-xl">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          {/* Left Metadata */}
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-mono text-slate-300 border border-slate-700">
                {scan.sourceType === 'git_repo' ? 'Git Repository' : 'Zip Archive'}
              </span>
              <span className={`rounded-lg px-2.5 py-1 text-xs font-mono border ${
                scan.status === 'failed'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : scan.status === 'scanning'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
              }`}>
                Scan Status: {scan.status}
              </span>
              {scan.branch && (
                <span className="rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs font-mono text-indigo-300 border border-indigo-500/20">
                  Branch: {scan.branch}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {scan.projectName}
            </h1>

            <p className="text-xs text-slate-400 font-mono break-all">
              Target: {scan.sourceName}
            </p>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-1">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />
                Scanned on {new Date(scan.startedAt).toLocaleString()}
              </span>
              {scan.durationSeconds && (
                <span>• Duration: {scan.durationSeconds}s</span>
              )}
              {scan.commitHash && (
                <span>• Commit Hash: <code className="text-slate-400">{scan.commitHash}</code></span>
              )}
            </div>
          </div>

          {/* Right: Score Gauge Card (Step 6 Algorithm) */}
          <div className="flex flex-col sm:flex-row items-center gap-6 rounded-2xl border border-slate-800/80 bg-slate-900/50 p-6">
            <div className="flex flex-col items-center justify-center">
              <div className={`flex h-24 w-24 flex-col items-center justify-center rounded-2xl border-2 ${getScoreColor(scan.score)} shadow-xl`}>
                <span className="text-3xl font-extrabold tracking-tight leading-none">{scan.score}</span>
                <span className="text-[11px] font-mono uppercase tracking-wider opacity-80 mt-1">/ 100</span>
              </div>
            </div>

            <div className="space-y-1.5 text-center sm:text-left">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <span className="text-lg font-bold text-white">Grade {gradeInfo.grade}</span>
                <span className="text-xs text-slate-400">• {gradeInfo.label}</span>
              </div>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                Hyperbolic discount of weighted risk:
                <br />
                <span className="font-mono text-[11px] text-slate-500">
                  score = 100 / (1 + risk/25)
                </span>
                <br />
                <span className="font-mono text-[11px] text-slate-500">
                  risk weights: Crit 10 | High 7 | Med 4 | Low 1
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Severity Metrics Bar */}
        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-slate-800/80 pt-6">
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3.5">
            <span className="text-xs font-semibold text-rose-300">Critical</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-rose-400">{scan.counts.critical}</span>
              <span className="text-[11px] text-rose-400/70 font-mono">10 risk ea</span>
            </div>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3.5">
            <span className="text-xs font-semibold text-amber-300">High</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-amber-400">{scan.counts.high}</span>
              <span className="text-[11px] text-amber-400/70 font-mono">7 risk ea</span>
            </div>
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3.5">
            <span className="text-xs font-semibold text-blue-300">Medium</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-blue-400">{scan.counts.medium}</span>
              <span className="text-[11px] text-blue-400/70 font-mono">4 risk ea</span>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3.5">
            <span className="text-xs font-semibold text-slate-300">Low</span>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="text-2xl font-bold text-slate-300">{scan.counts.low}</span>
              <span className="text-[11px] text-slate-500 font-mono">1 risk ea</span>
            </div>
          </div>
        </div>
      </div>

      {/* Filter and Finding Search Bar */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search findings by title, file path, or tool..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {/* Severity Filter */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
              <button
                onClick={() => setSeverityFilter('all')}
                className={`rounded-md px-2.5 py-1 ${severityFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
              >
                All ({findings.length})
              </button>
              <button
                onClick={() => setSeverityFilter('critical')}
                className={`rounded-md px-2.5 py-1 ${severityFilter === 'critical' ? 'bg-rose-500/20 text-rose-300 font-bold' : 'text-slate-400'}`}
              >
                Crit ({scan.counts.critical})
              </button>
              <button
                onClick={() => setSeverityFilter('high')}
                className={`rounded-md px-2.5 py-1 ${severityFilter === 'high' ? 'bg-amber-500/20 text-amber-300 font-bold' : 'text-slate-400'}`}
              >
                High ({scan.counts.high})
              </button>
              <button
                onClick={() => setSeverityFilter('medium')}
                className={`rounded-md px-2.5 py-1 ${severityFilter === 'medium' ? 'bg-blue-500/20 text-blue-300 font-bold' : 'text-slate-400'}`}
              >
                Med ({scan.counts.medium})
              </button>
            </div>

            {/* Scanner Filter */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
              <button
                onClick={() => setScannerFilter('all')}
                className={`rounded-md px-2.5 py-1 ${scannerFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
              >
                All Tools
              </button>
              <button
                onClick={() => setScannerFilter('semgrep')}
                className={`rounded-md px-2.5 py-1 ${scannerFilter === 'semgrep' ? 'bg-cyan-500/20 text-cyan-300 font-medium' : 'text-slate-400'}`}
              >
                Semgrep
              </button>
              <button
                onClick={() => setScannerFilter('gitleaks')}
                className={`rounded-md px-2.5 py-1 ${scannerFilter === 'gitleaks' ? 'bg-purple-500/20 text-purple-300 font-medium' : 'text-slate-400'}`}
              >
                Gitleaks
              </button>
              <button
                onClick={() => setScannerFilter('checkov')}
                className={`rounded-md px-2.5 py-1 ${scannerFilter === 'checkov' ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'text-slate-400'}`}
              >
                IaC
              </button>
              <button
                onClick={() => setScannerFilter('dependency-audit')}
                className={`rounded-md px-2.5 py-1 ${scannerFilter === 'dependency-audit' ? 'bg-amber-500/20 text-amber-300 font-medium' : 'text-slate-400'}`}
              >
                SCA
              </button>
            </div>

            {/* Triage Filter */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
              <button
                onClick={() => setStatusFilter('all')}
                className={`rounded-md px-2.5 py-1 ${statusFilter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
              >
                Any State
              </button>
              <button
                onClick={() => setStatusFilter('open')}
                className={`rounded-md px-2.5 py-1 ${statusFilter === 'open' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'}`}
              >
                Open
              </button>
              <button
                onClick={() => setStatusFilter('resolved')}
                className={`rounded-md px-2.5 py-1 ${statusFilter === 'resolved' ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'text-slate-400'}`}
              >
                Resolved
              </button>
              <button
                onClick={() => setStatusFilter('false_positive')}
                className={`rounded-md px-2.5 py-1 ${statusFilter === 'false_positive' ? 'bg-slate-700 text-slate-300 font-medium' : 'text-slate-400'}`}
              >
                False Positive
              </button>
              <button
                onClick={() => setStatusFilter('accepted')}
                className={`rounded-md px-2.5 py-1 ${statusFilter === 'accepted' ? 'bg-amber-500/20 text-amber-300 font-medium' : 'text-slate-400'}`}
              >
                Accepted
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Findings List (Step 10: report view with explanation & fix suggestion) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Detected Vulnerabilities & Remediations ({filteredFindings.length})
          </h2>
          <span className="text-xs text-slate-500">
            Click finding card to inspect code snippet and remediation diff
          </span>
        </div>

        {filteredFindings.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
            <ShieldCheck className="mx-auto h-12 w-12 text-emerald-400 mb-3" />
            <h3 className="text-base font-bold text-white">No vulnerabilities found in this view</h3>
            <p className="mt-1 text-xs text-slate-400">
              Either all findings were filtered out or this codebase has achieved a clean bill of health!
            </p>
          </div>
        ) : (
          filteredFindings.map((finding) => {
            const isExpanded = expandedFindingId === finding.id;

            return (
              <div
                key={finding.id}
                id={`finding-${finding.id}`}
                className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 transition-all shadow-md"
              >
                {/* Finding Header Clickable */}
                <div
                  onClick={() => setExpandedFindingId(isExpanded ? null : finding.id)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 cursor-pointer bg-slate-900/50 hover:bg-slate-900/80 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                      finding.severity === 'critical' ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' :
                      finding.severity === 'high' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
                      'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    }`}>
                      <AlertTriangle className="h-4 w-4" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-white">
                          {finding.type}
                        </span>
                        <span className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                          finding.severity === 'critical' ? 'bg-rose-500/20 text-rose-300' :
                          finding.severity === 'high' ? 'bg-amber-500/20 text-amber-300' :
                          'bg-blue-500/20 text-blue-300'
                        }`}>
                          {finding.severity}
                        </span>
                        {finding.cwe && (
                          <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[11px] font-mono text-cyan-300 border border-slate-700">
                            {finding.cwe}
                          </span>
                        )}
                        {finding.cve && (
                          <span className="rounded-md bg-rose-500/10 px-2 py-0.5 text-[11px] font-mono text-rose-400 border border-rose-500/30">
                            {finding.cve}
                          </span>
                        )}
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 text-[10px] uppercase font-mono text-slate-400">
                          {finding.scanner}
                        </span>
                      </div>

                      <div className="mt-1 flex items-center gap-2 text-xs font-mono text-slate-400">
                        <FileCode className="h-3.5 w-3.5 text-slate-500" />
                        <span className="text-slate-300">{finding.filePath}</span>
                        <span className="text-emerald-400 font-bold">:line {finding.lineNumber}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${
                      finding.status === 'resolved'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : finding.status === 'false_positive'
                          ? 'border-slate-700 bg-slate-800 text-slate-400'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                    }`}>
                      {finding.status.replace('_', ' ')}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </div>

                {/* Expanded Card Details */}
                {isExpanded && (
                  <div className="border-t border-slate-800/80 p-5 sm:p-6 space-y-6 bg-slate-950">
                    {/* Vulnerability Description */}
                    <div className="space-y-1.5">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Vulnerability Summary & Impact
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                        {finding.description}
                      </p>
                    </div>

                    {/* Code Snippet Box (Vulnerable Line Highlighted) */}
                    {finding.snippet ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                          <FileCode className="h-3.5 w-3.5" />
                          Identified Flaw Location ({finding.filePath}:{finding.lineNumber})
                        </h4>
                        <button
                          onClick={() => handleCopyCode(finding.id, finding.snippet)}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                        >
                          {copiedSnippetId === finding.id ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                          {copiedSnippetId === finding.id ? 'Copied' : 'Copy'}
                        </button>
                      </div>

                      <div className="rounded-xl border border-rose-500/30 bg-slate-950 p-4 font-['JetBrains_Mono',monospace] text-xs text-rose-200 overflow-x-auto shadow-inner">
                        <pre className="whitespace-pre">{finding.snippet}</pre>
                      </div>
                    </div>
                    ) : (
                      <p className="text-xs text-slate-500">
                        Location: {finding.filePath}:{finding.lineNumber}. The scanned source tree is
                        deleted when the worker finishes, so the offending line is not retained.
                      </p>
                    )}

                    {/* Remediation & Secure Code Example (from Knowledge Base Step 9) */}
                    <div className="space-y-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 sm:p-5">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5" />
                          Recommended Secure Implementation
                        </h4>
                        {finding.secureCodeExample && (
                        <button
                          onClick={() => handleCopyCode(`sec-${finding.id}`, finding.secureCodeExample)}
                          className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold"
                        >
                          {copiedSnippetId === `sec-${finding.id}` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          Copy Fix
                        </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">
                        {finding.remediation}
                      </p>

                      {finding.secureCodeExample && (
                      <div className="mt-3 rounded-lg border border-emerald-500/20 bg-slate-950 p-3.5 font-['JetBrains_Mono',monospace] text-xs text-emerald-300 overflow-x-auto">
                        <pre className="whitespace-pre">{finding.secureCodeExample}</pre>
                      </div>
                      )}
                    </div>

                    {/* Triage Status Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 pt-4">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>Triage Action:</span>
                        <button
                          id={`triage-resolve-${finding.id}`}
                          onClick={() => onUpdateFindingStatus(finding.id, 'resolved')}
                          className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                            finding.status === 'resolved'
                              ? 'bg-emerald-500 text-slate-950 shadow-sm'
                              : 'border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800'
                          }`}
                        >
                          Mark Resolved
                        </button>
                        <button
                          onClick={() => onUpdateFindingStatus(finding.id, 'false_positive')}
                          className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                            finding.status === 'false_positive'
                              ? 'bg-slate-700 text-white'
                              : 'border border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          False Positive
                        </button>
                        <button
                          onClick={() => onUpdateFindingStatus(finding.id, 'accepted')}
                          className={`rounded-lg px-3 py-1.5 font-semibold transition ${
                            finding.status === 'accepted'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'border border-slate-700 bg-slate-900 text-slate-400 hover:bg-slate-800'
                          }`}
                        >
                          Accept Risk
                        </button>
                      </div>

                      <span className="text-[11px] font-mono text-slate-500">
                        ID: {finding.id}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
