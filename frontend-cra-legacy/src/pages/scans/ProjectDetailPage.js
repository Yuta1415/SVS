import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient from '../../services/api';
import Sidebar from '../../components/Sidebar';
import { relativeTime } from '../../utils/time';
import { normStatus } from '../../utils/scan';
import { Shield, History, Upload, GitBranch, ArrowLeft, Lock, Globe, Zap, Activity, AlertTriangle } from 'lucide-react';

const ProjectDetailPage = () => {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [scans, setScans] = useState([]);

  useEffect(() => {
    const fetchProjectData = async () => {
      try {
        const res = await apiClient.get(`/projects/${id}`);
        setProject(res.data);
        const scanRes = await apiClient.get(`/scans/project/${id}`);
        setScans(scanRes.data);
      } catch (err) {
        console.error('Error fetching project data');
      }
    };
    fetchProjectData();
  }, [id]);

  if (!project) return <div className="min-h-screen bg-[#0b0f1a] text-white flex items-center justify-center">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-200 flex font-sans">
      <Sidebar active="dashboard" />

      <main className="flex-1 p-10 relative min-w-0">
        <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="flex items-center gap-4 mb-10 relative z-10">
          <Link to="/dashboard" className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-slate-400 hover:text-white hover:border-brand-accent/50 transition-all">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-4xl font-black text-white tracking-tight">{project.name}</h1>
            <p className="text-slate-500 font-medium text-sm uppercase tracking-widest">Project Asset Details</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 relative z-10">
          <div className="lg:col-span-1 space-y-8">
            {/* Scan Trigger Card */}
            <div className="bg-slate-900/40 backdrop-blur-md p-8 rounded-3xl border border-slate-800 ring-1 ring-white/5">
              <div className="flex items-center gap-3 mb-6">
                <Zap className="text-brand-accent w-5 h-5" />
                <h2 className="text-lg font-bold text-white">Initialize Scan</h2>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <Link
                  to={`/scan/new?project=${id}`}
                  className="flex items-center gap-4 p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-2xl transition-all group hover:border-brand-accent/50"
                >
                  <div className="p-2 bg-brand-accent/10 text-brand-accent rounded-lg group-hover:scale-110 transition-transform">
                    <Upload size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-white">Upload Archive</p>
                    <p className="text-xs text-slate-500">Import .zip source code</p>
                  </div>
                </Link>
                <Link
                  to={`/scan/new?project=${id}`}
                  className="flex items-center gap-4 p-4 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-2xl transition-all group hover:border-brand-accent/50"
                >
                  <div className="p-2 bg-brand-accent/10 text-brand-accent rounded-lg group-hover:scale-110 transition-transform">
                    <GitBranch size={20} />
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-bold text-white">Remote Clone</p>
                    <p className="text-xs text-slate-500">Clone from Git repository</p>
                  </div>
                </Link>
              </div>
            </div>

            {/* Project Info Card */}
            <div className="bg-slate-900/40 backdrop-blur-md p-8 rounded-3xl border border-slate-800 ring-1 ring-white/5">
              <div className="flex items-center gap-3 mb-6">
                <Lock className="text-brand-accent w-5 h-5" />
                <h3 className="text-lg font-bold text-white">Security Context</h3>
              </div>
              <div className="space-y-4">
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <span className="block text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Source URL</span>
                  <div className="flex items-center gap-2 text-sm text-slate-300 truncate">
                    <Globe size={14} className="text-slate-600" />
                    {project.repo_url || 'Local Only'}
                  </div>
                </div>
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800">
                  <span className="block text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Asset Identifier</span>
                  <div className="text-sm font-mono text-slate-300">#{project.id}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-slate-900/40 backdrop-blur-md p-8 rounded-3xl border border-slate-800 ring-1 ring-white/5 min-h-[500px]">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Activity className="text-brand-accent w-6 h-6" />
                  <h2 className="text-2xl font-black text-white tracking-tight">Scan History</h2>
                </div>
                <div className="text-xs font-bold text-slate-600 uppercase tracking-widest">
                  {scans.length} Recorded Sessions
                </div>
              </div>
              <div className="space-y-4">
                {scans.length === 0 ? (
                  <div className="text-center py-32 bg-slate-950/50 rounded-3xl border border-dashed border-slate-800">
                    <div className="p-4 bg-slate-900 rounded-full inline-block mb-4 text-slate-700">
                      <History size={32} />
                    </div>
                    <p className="text-slate-500 font-medium">No scan history detected for this asset.</p>
                    <p className="text-xs text-slate-600 mt-2">Initialize a scan to generate security reports.</p>
                  </div>
                ) : (
                  scans.map((scan) => (
                    <Link
                      key={scan.id}
                      to={`/scan/${scan.id}`}
                      className="flex items-center justify-between p-5 bg-slate-950 hover:bg-slate-800 border border-slate-800 rounded-2xl transition-all group hover:border-brand-accent/50 ring-1 ring-white/5"
                    >
                      <div className="flex items-center gap-5">
                        <div className={`p-3 rounded-xl border ${normStatus(scan) === 'COMPLETED' ? 'bg-severity-low/10 text-severity-low border-severity-low/20' : normStatus(scan) === 'FAILED' ? 'bg-severity-critical/10 text-severity-critical border-severity-critical/20' : 'bg-severity-medium/10 text-severity-medium border-severity-medium/20'}`}>
                          {normStatus(scan) === 'COMPLETED' ? <Shield size={20} /> : normStatus(scan) === 'FAILED' ? <AlertTriangle size={20} /> : <Zap size={20} />}
                        </div>
                        <div>
                          <p className="font-bold text-white group-hover:text-brand-accent transition-colors">Session #{scan.id}</p>
                          <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                            <span className="uppercase tracking-widest">{normStatus(scan) || 'PENDING'}</span>
                            <span>•</span>
                            <span>Score: <span className="text-slate-300 font-bold">{scan.score ?? 'Calculating...'}</span></span>
                            {scan.created_at && (
                              <>
                                <span>•</span>
                                <span>{relativeTime(scan.created_at)}</span>
                              </>
                            )}
                          </div>
                          {scan.error_detail && (
                            <p className="text-[10px] text-red-400/80 mt-1 font-mono truncate max-w-md">
                              {scan.error_detail}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-brand-accent font-bold uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all translate-x-[-10px] group-hover:translate-x-0">
                        Analyze Report
                        <ArrowLeft size={16} className="rotate-180" />
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};

export default ProjectDetailPage;
