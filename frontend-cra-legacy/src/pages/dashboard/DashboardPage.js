import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import apiClient from '../../services/api';
import Sidebar from '../../components/Sidebar';
import { relativeTime } from '../../utils/time';
import { normStatus, isFinished } from '../../utils/scan';
import { Plus, Shield, Zap, Globe, Upload, AlertTriangle, FileText, TrendingUp, Calendar, Bug, CheckCircle, Rocket } from 'lucide-react';

const scoreTone = (score) => {
  if (score === null || score === undefined) return 'text-slate-500';
  if (score >= 80) return 'text-severity-low';
  if (score >= 50) return 'text-severity-medium';
  return 'text-severity-critical';
};

const DashboardPage = () => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [scans, setScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [demoBusy, setDemoBusy] = useState(false);

  // Clones the public Juice-Shop repo, so there is something real to look at on
  // a fresh database. Takes a few seconds; the scan page polls until it finishes.
  const handleRunDemo = async () => {
    setDemoBusy(true);
    try {
      const res = await apiClient.post('/scans/demo');
      navigate(`/scan/${res.data.scan_id}`);
    } catch (err) {
      setDemoBusy(false);
      console.error('Demo scan failed to start');
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const [projRes, scanRes] = await Promise.all([
          apiClient.get('/projects/'),
          apiClient.get('/scans/'),
        ]);
        setProjects(projRes.data);
        setScans(scanRes.data);
      } catch (err) {
        console.error('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const finished = scans.filter(isFinished);
  const scored = finished.filter((s) => s.score !== null && s.score !== undefined);
  const avgScore = scored.length
    ? Math.round(scored.reduce((sum, s) => sum + s.score, 0) / scored.length)
    : null;

  // Scans come back newest first, so the first match for a project is its latest.
  const latestFor = (projectId) => scans.find((s) => s.project_id === projectId);

  // The tiles describe the current posture of each project, not lifetime totals:
  // summing every scan would still count a finding from a run the operator
  // already fixed and rescanned away. Only each project's latest finished run counts.
  const latestFinished = projects
    .map((p) => latestFor(p.id))
    .filter((s) => s && isFinished(s));

  const openCritical = latestFinished.reduce((sum, s) => sum + (s.critical_count || 0), 0);
  const totalFindings = latestFinished.reduce(
    (sum, s) => sum + (s.critical_count || 0) + (s.high_count || 0) + (s.medium_count || 0) + (s.low_count || 0),
    0
  );

  const now = new Date();
  const scansThisMonth = scans.filter((s) => {
    const d = new Date(s.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;

  // "Clean" is the latest finished scan scoring in the Secure band. A project
  // with no finished scan yet is neither clean nor dirty, so it is excluded.
  const cleanProjects = latestFinished.filter((s) => s.score !== null && s.score >= 80).length;

  const stats = [
    { label: 'Open critical', value: openCritical, icon: AlertTriangle, tone: openCritical > 0 ? 'text-severity-critical' : 'text-severity-low' },
    { label: 'Open findings', value: totalFindings, icon: Bug, tone: 'text-slate-200' },
    { label: 'Scans this month', value: scansThisMonth, icon: Calendar, tone: 'text-slate-200' },
    { label: 'Projects clean', value: `${cleanProjects}/${projects.length}`, icon: CheckCircle, tone: cleanProjects === projects.length && projects.length > 0 ? 'text-severity-low' : 'text-slate-200' },
  ];

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-200 flex font-sans">
      <Sidebar active="dashboard" />

      <main className="flex-1 p-10 relative min-w-0">
        <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>

        {/* Header */}
        <header className="flex justify-between items-end mb-10 relative z-10 flex-wrap gap-6">
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight mb-2">Your scans</h1>
            <p className="text-slate-500 font-medium">
              {loading ? 'Loading…' : `${projects.length} project${projects.length === 1 ? '' : 's'} - ${scans.length} scan${scans.length === 1 ? '' : 's'} run`}
            </p>
          </div>

          <div className="flex items-center gap-6 flex-wrap">
            <button
              onClick={handleRunDemo}
              disabled={demoBusy}
              className="flex items-center gap-2 bg-slate-900/60 hover:bg-slate-800 text-brand-accent border border-brand-accent/30 px-5 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 disabled:opacity-50"
            >
              <Rocket size={16} />
              {demoBusy ? 'Queuing…' : 'Run demo scan'}
            </button>

            <div className="flex items-center gap-6 bg-slate-900/40 backdrop-blur-md px-8 py-5 rounded-3xl border border-slate-800 ring-1 ring-white/5">
              <TrendingUp className="text-brand-accent w-6 h-6" />
              <div>
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] mb-1">Avg. security score</p>
                <p className={`text-4xl font-black leading-none ${scoreTone(avgScore)}`}>
                  {avgScore === null ? '—' : avgScore}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Stat tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10 relative z-10">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div
              key={label}
              className="bg-slate-900/40 backdrop-blur-md p-6 rounded-3xl border border-slate-800 ring-1 ring-white/5 flex items-center gap-5"
            >
              <div className="p-3 bg-slate-950 rounded-2xl text-brand-accent border border-slate-800">
                <Icon size={22} />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.15em] truncate">{label}</p>
                <p className={`text-3xl font-black ${tone}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Project cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10">
          {projects.map((project) => {
            const latest = latestFor(project.id);
            const hasGit = project.repo_url && project.repo_url.trim() !== '';
            return (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                className="bg-slate-900/40 backdrop-blur-md p-6 rounded-3xl border border-slate-800 hover:border-brand-accent/50 transition-all group ring-1 ring-white/5"
              >
                <div className="flex justify-between items-start mb-6">
                  <div className="p-3 bg-slate-950 rounded-2xl text-brand-accent border border-slate-800 group-hover:border-brand-accent/50 group-hover:shadow-[0_0_15px_rgba(99,102,241,0.2)] transition-all">
                    <Shield size={24} />
                  </div>
                  {latest && (
                    <div className="text-right">
                      <p className={`text-2xl font-black leading-none ${scoreTone(latest.score)}`}>
                        {latest.score === null || latest.score === undefined ? '—' : latest.score}
                      </p>
                      <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mt-1">score</p>
                    </div>
                  )}
                </div>

                <h3 className="text-xl font-bold text-white mb-2 group-hover:text-brand-accent transition-colors break-words">
                  {project.name}
                </h3>

                <div className="flex items-center gap-2 mb-6 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-950 border border-slate-800 px-2.5 py-1 rounded-md">
                    {hasGit ? <Globe size={12} /> : <Upload size={12} />}
                    {hasGit ? 'Git URL' : 'Zip upload'}
                  </span>
                  {latest && (
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-md border ${
                      normStatus(latest) === 'COMPLETED'
                        ? 'text-severity-low border-severity-low/20 bg-severity-low/10'
                        : normStatus(latest) === 'FAILED'
                          ? 'text-severity-critical border-severity-critical/20 bg-severity-critical/10'
                          : 'text-severity-medium border-severity-medium/20 bg-severity-medium/10'
                    }`}>
                      {normStatus(latest) || 'PENDING'}
                    </span>
                  )}
                </div>

                {hasGit && (
                  <div className="flex items-center gap-2 text-xs text-slate-500 truncate">
                    <Globe size={14} className="shrink-0" />
                    <span className="truncate">{project.repo_url}</span>
                  </div>
                )}

                <div className="flex items-center justify-between mt-6 pt-6 border-t border-slate-800/50">
                  <span className="text-xs text-slate-600 font-medium">
                    {latest ? `Last scan ${relativeTime(latest.created_at)}` : 'No scans yet'}
                  </span>
                  <span className="text-xs text-brand-accent font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">
                    Open
                  </span>
                </div>
              </Link>
            );
          })}

          {/* New scan card */}
          <Link
            to="/scan/new"
            className="border-2 border-dashed border-slate-800 hover:border-brand-accent/50 rounded-3xl p-6 flex flex-col items-center justify-center text-center transition-all group bg-slate-900/20 min-h-[260px]"
          >
            <div className="p-4 bg-slate-900 rounded-2xl text-slate-600 group-hover:text-brand-accent group-hover:border-brand-accent/50 border border-slate-800 transition-all mb-4">
              <Plus size={28} />
            </div>
            <p className="text-lg font-bold text-white mb-1">New scan</p>
            <p className="text-sm text-slate-600 font-medium">Upload a zip or point at a repository</p>
          </Link>

          {projects.length === 0 && !loading && (
            <div className="col-span-full py-32 text-center border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/20">
              <div className="inline-flex p-4 bg-slate-900 rounded-full mb-4 text-slate-700">
                <Zap size={32} />
              </div>
              <p className="text-slate-500 font-medium mb-4">No projects yet. Start a scan to create one.</p>
              <Link
                to="/scan/new"
                className="inline-flex items-center gap-2 bg-brand-accent hover:bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-brand-accent/20"
              >
                <Zap size={18} />
                Start a scan
              </Link>
            </div>
          )}
        </div>

        {/* Recent scans */}
        {scans.length > 0 && (
          <div className="mt-12 relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <FileText className="text-brand-accent w-5 h-5" />
              <h2 className="text-xl font-black text-white tracking-tight">Recent scans</h2>
            </div>
            <div className="space-y-3">
              {scans.slice(0, 5).map((scan) => {
                const project = projects.find((p) => p.id === scan.project_id);
                return (
                  <Link
                    key={scan.id}
                    to={`/scan/${scan.id}`}
                    className="flex items-center justify-between p-4 bg-slate-900/40 backdrop-blur-md hover:bg-slate-900/70 border border-slate-800 hover:border-brand-accent/50 rounded-2xl transition-all group"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`p-2.5 rounded-xl border shrink-0 ${
                        normStatus(scan) === 'COMPLETED'
                          ? 'bg-severity-low/10 text-severity-low border-severity-low/20'
                          : normStatus(scan) === 'FAILED'
                            ? 'bg-severity-critical/10 text-severity-critical border-severity-critical/20'
                            : 'bg-severity-medium/10 text-severity-medium border-severity-medium/20'
                      }`}>
                        {normStatus(scan) === 'COMPLETED' ? <Shield size={18} /> : normStatus(scan) === 'FAILED' ? <AlertTriangle size={18} /> : <Zap size={18} />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-white group-hover:text-brand-accent transition-colors truncate">
                          {project ? project.name : 'Unknown project'} - scan #{scan.id}
                        </p>
                        <p className="text-xs text-slate-600 font-medium">{relativeTime(scan.created_at)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 shrink-0">
                      {scan.critical_count > 0 && (
                        <span className="text-xs font-bold text-severity-critical">{scan.critical_count} critical</span>
                      )}
                      <span className={`text-2xl font-black ${scoreTone(scan.score)}`}>
                        {scan.score === null || scan.score === undefined ? '—' : scan.score}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default DashboardPage;
