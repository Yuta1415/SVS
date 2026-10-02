import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../services/api';
import Sidebar from '../../components/Sidebar';
import { relativeTime } from '../../utils/time';
import { normStatus, isFinished } from '../../utils/scan';
import {
  Shield, AlertTriangle, CheckCircle, ArrowLeft, Download,
  ChevronDown, ChevronUp, Zap, Bug, GitBranch, ScanSearch,
} from 'lucide-react';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low', 'Info'];

const SEV_STYLE = {
  Critical: 'text-severity-critical border-severity-critical/20 bg-severity-critical/10',
  High: 'text-severity-high border-severity-high/20 bg-severity-high/10',
  Medium: 'text-severity-medium border-severity-medium/20 bg-severity-medium/10',
  Low: 'text-severity-low border-severity-low/20 bg-severity-low/10',
  Info: 'text-slate-400 border-slate-400/20 bg-slate-400/10',
};

// The pipeline runs in this order; see backend/app/engine/tasks.py. Per-tool
// progress is not reported by the API, so the in-progress view shows the real
// order and the scan's real status rather than inventing a per-step state.
const PIPELINE = [
  { label: 'Ingest source', icon: GitBranch },
  { label: 'Semgrep static analysis', icon: ScanSearch },
  { label: 'Gitleaks secrets scan', icon: Bug },
  { label: 'Dependency audit (pip-audit / npm audit)', icon: Bug },
  { label: 'Scoring & report generation', icon: Zap },
];

const getRiskSummary = (score) => {
  if (score === null || score === undefined) return "This scan did not complete, so no security posture could be calculated. Re-run the scan for a full assessment.";
  if (score > 80) return "Strong security posture with minimal exposure to known risks.";
  if (score > 50) return "Moderate risk. Priority should go to the high-severity findings below.";
  return "Critical vulnerabilities detected. Immediate remediation is required to prevent potential exploitation.";
};

const RISK_BADGE = (score) =>
  score === null || score === undefined
    ? { label: 'Scan incomplete', cls: 'text-slate-400 border-slate-400/20 bg-slate-400/10' }
    : score > 80
      ? { label: 'Secure', cls: 'text-severity-low border-severity-low/20 bg-severity-low/10' }
      : score > 50
        ? { label: 'Moderate risk', cls: 'text-severity-medium border-severity-medium/20 bg-severity-medium/10' }
        : { label: 'Critical', cls: 'text-severity-critical border-severity-critical/20 bg-severity-critical/10' };

const ScanDetailPage = () => {
  const { id } = useParams();
  const [scan, setScan] = useState(null);
  const [project, setProject] = useState(null);
  const [findings, setFindings] = useState([]);
  const [polling, setPolling] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [error, setError] = useState('');

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await apiClient.get(`/scans/${id}`);
        setScan(res.data);

        if (isFinished(res.data)) {
          setPolling(false);
          // The project name is only needed for the report header, so it is
          // fetched once the scan has settled rather than on every poll.
          if (res.data.project_id) {
            apiClient.get(`/projects/${res.data.project_id}`)
              .then((r) => setProject(r.data))
              .catch(() => {});
          }
          try {
            const f = await apiClient.get(`/scans/${id}/findings`);
            setFindings(f.data);
          } catch {
            setFindings([]);
          }
        } else {
          setTimeout(poll, 3000);
        }
      } catch (err) {
        console.error('Polling error:', err);
        setPolling(false);
      }
    };
    poll();
  }, [id]);

  const handleDownloadPDF = async () => {
    setError('');
    try {
      const response = await apiClient.get(`/scans/${id}/export`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `scan_report_${id}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to download PDF report.');
    }
  };

  // In-progress view
  if (polling) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] text-slate-200 flex font-sans">
        <Sidebar active="report" />
        <main className="flex-1 p-10 relative min-w-0">
          <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>
          <div className="max-w-2xl relative z-10">
            <div className="flex items-center gap-4 mb-12">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 border-4 border-slate-800 rounded-full"></div>
                <div className="absolute inset-0 border-4 border-brand-accent rounded-full border-t-transparent animate-spin shadow-[0_0_15px_rgba(99,102,241,0.5)]"></div>
              </div>
              <div>
                <h1 className="text-3xl font-black text-white tracking-tight">Scan #{id} in progress</h1>
                <p className="text-sm text-slate-500 font-medium uppercase tracking-widest">
                  {scan ? (normStatus(scan) || 'starting') : 'starting'}
                </p>
              </div>
            </div>
            <div className="space-y-3">
              {PIPELINE.map(({ label, icon: Icon }, i) => (
                <div
                  key={label}
                  className="flex items-center justify-between p-5 bg-slate-900/40 backdrop-blur-md border border-slate-800 rounded-2xl"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-slate-950 rounded-xl text-slate-500 border border-slate-800">
                      <Icon size={18} />
                    </div>
                    <span className="text-sm font-bold text-slate-300">{label}</span>
                  </div>
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                    queued
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-600 mt-8 font-medium">
              The pipeline runs in the order shown. This page refreshes every few seconds.
            </p>
          </div>
        </main>
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="min-h-screen bg-[#0b0f1a] text-slate-400 flex flex-col items-center justify-center gap-4">
        <p className="font-bold text-lg">Scan not found</p>
        <Link to="/dashboard" className="text-brand-accent font-bold hover:text-white transition-colors">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const badge = RISK_BADGE(scan.score);
  const counts = {
    Critical: scan.critical,
    High: scan.high,
    Medium: scan.medium,
    Low: scan.low,
  };
  const totalFindings = Object.values(counts).reduce((a, b) => a + (b || 0), 0);

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-200 flex font-sans">
      <Sidebar active="report" />

      <main className="flex-1 p-10 relative min-w-0">
        <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="relative z-10">
          {/* Header */}
          <Link to="/dashboard" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-brand-accent font-bold uppercase tracking-widest mb-6 transition-colors">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>
          <div className="flex justify-between items-start mb-12 flex-wrap gap-6">
            <div>
              <h1 className="text-4xl font-black text-white tracking-tight mb-2">Scan report</h1>
              <p className="text-slate-500 font-medium max-w-xl">
                Findings grouped by severity, with remediation guidance for each.
              </p>
            </div>
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 bg-brand-accent hover:bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-brand-accent/20 active:scale-95"
            >
              <Download size={18} />
              Export PDF
            </button>
          </div>

          {error && (
            <div className="flex items-start gap-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 font-medium mb-8">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {normStatus(scan) === 'FAILED' && (
            <div className="flex items-start gap-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 font-medium mb-8">
              <AlertTriangle size={18} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-black uppercase tracking-widest text-xs mb-1">Scan failed</p>
                <p className="font-mono text-xs break-words text-red-300/90">{scan.error_detail || 'One or more scanners did not finish.'}</p>
                <p className="text-[11px] text-slate-500 mt-2">
                  The score below covers a partial scan. Re-run to get a complete report.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-12">
            {/* Score */}
            <div className="bg-slate-900/40 backdrop-blur-md p-8 rounded-3xl border border-slate-800 ring-1 ring-white/5 flex flex-col items-center justify-center text-center">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-6">Security score</h3>
              <div className="flex items-start gap-2">
                <span className={`text-7xl font-black leading-none ${badge.label === 'Critical' ? 'text-severity-critical' : badge.label === 'Secure' ? 'text-severity-low' : badge.label === 'Moderate risk' ? 'text-severity-medium' : 'text-slate-400'}`}>
                  {scan.score === null || scan.score === undefined ? '—' : scan.score}
                </span>
                {scan.score !== null && scan.score !== undefined && (
                  <span className="text-2xl font-bold text-slate-600 mt-2">/ 100</span>
                )}
              </div>
              <p className={`mt-6 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border ${badge.cls}`}>
                {badge.label}
              </p>
            </div>

            {/* Summary + meta */}
            <div className="lg:col-span-2 bg-slate-900/40 backdrop-blur-md p-8 rounded-3xl border border-slate-800 ring-1 ring-white/5 flex flex-col justify-center">
              <div className="flex items-center gap-3 mb-4 flex-wrap">
                {project && (
                  <Link
                    to={`/project/${project.id}`}
                    className="text-lg font-bold text-white hover:text-brand-accent transition-colors"
                  >
                    {project.name}
                  </Link>
                )}
                <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                  scan #{scan.id}
                </span>
              </div>
              <p className="text-sm text-slate-400 font-medium mb-6 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-slate-500">
                  <Shield size={13} /> Semgrep + Gitleaks + SCA audit
                </span>
                <span className="text-slate-700">-</span>
                <span>scanned {relativeTime(scan.created_at)}</span>
                {scan.duration != null && (
                  <>
                    <span className="text-slate-700">-</span>
                    <span>{Math.round(scan.duration)}s</span>
                  </>
                )}
              </p>
              <p className="text-lg font-medium text-slate-200 leading-relaxed mb-6">
                {getRiskSummary(scan.score)}
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {SEVERITIES.filter((s) => s !== 'Info').map((sev) => (
                  <div
                    key={sev}
                    className={`p-4 rounded-2xl border text-center ${SEV_STYLE[sev]}`}
                  >
                    <p className="text-2xl font-black leading-none">{counts[sev] || 0}</p>
                    <p className="text-[10px] font-black uppercase tracking-widest mt-1.5">{sev}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Findings grouped by severity */}
          <div className="space-y-10">
            {totalFindings === 0 ? (
              <div className="text-center py-32 border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20">
                <CheckCircle size={48} className="mx-auto mb-4 text-severity-low/30" />
                <p className="font-bold text-lg text-white">No vulnerabilities detected</p>
                <p className="text-sm text-slate-600 mt-2">The codebase meets the required security baseline.</p>
              </div>
            ) : (
              SEVERITIES.map((sev) => {
                const group = findings.filter((f) => f.severity === sev);
                if (group.length === 0) return null;
                return (
                  <section key={sev}>
                    <div className="flex items-center gap-3 mb-5">
                      <span className={`inline-flex items-center gap-2 text-sm font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border ${SEV_STYLE[sev]}`}>
                        {sev}
                      </span>
                      <span className="text-sm font-bold text-slate-600">{group.length} finding{group.length === 1 ? '' : 's'}</span>
                      <div className="flex-1 h-px bg-slate-800"></div>
                    </div>
                    <div className="space-y-4">
                      {group.map((finding) => {
                        const isOpen = !!expanded[finding.id];
                        return (
                          <div
                            key={finding.id}
                            className="bg-slate-900/40 backdrop-blur-md rounded-3xl border border-slate-800 ring-1 ring-white/5 overflow-hidden"
                          >
                            <button
                              onClick={() => setExpanded((prev) => ({ ...prev, [finding.id]: !prev[finding.id] }))}
                              className="w-full flex items-start justify-between gap-4 p-6 text-left hover:bg-slate-900/70 transition-colors"
                            >
                              <div className="min-w-0">
                                <h3 className="text-lg font-bold text-white mb-2 break-words">{finding.title}</h3>
                                <div className="flex items-center gap-3 flex-wrap text-xs text-slate-500 font-medium">
                                  <span className="font-mono text-slate-400 bg-slate-950 px-2 py-1 rounded border border-slate-800">
                                    {finding.file}
                                  </span>
                                  {finding.line != null && finding.line > 0 && (
                                    <span>line {finding.line}</span>
                                  )}
                                  <span className="text-slate-600">-</span>
                                  <span>detected by {finding.tool}</span>
                                </div>
                              </div>
                              <span className="text-slate-600 shrink-0 mt-1">
                                {isOpen ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                              </span>
                            </button>
                            {isOpen && (
                              <div className="px-6 pb-6 -mt-2">
                                <p className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] mb-2">Description</p>
                                <p className="text-sm text-slate-400 leading-relaxed">
                                  {finding.description || 'No description provided by the scanner.'}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default ScanDetailPage;
