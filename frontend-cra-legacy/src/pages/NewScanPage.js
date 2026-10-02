import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import apiClient from '../services/api';
import Sidebar from '../components/Sidebar';
import { Upload, Globe, Zap, FileArchive, AlertCircle } from 'lucide-react';

// Both scan endpoints need a project. When one was not picked up front we
// derive its name from the source: the repo's last path segment, or the archive
// name. Re-scanning the same source reuses the project it created last time
// rather than spawning a duplicate per scan.
const nameFromRepo = (url) => {
  try {
    const path = new URL(url).pathname.replace(/\.git$/, '').replace(/\/+$/, '');
    return path.split('/').pop() || 'imported-project';
  } catch {
    return 'imported-project';
  }
};

const NewScanPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const presetProjectId = searchParams.get('project');

  const [tab, setTab] = useState('zip');
  const [projects, setProjects] = useState([]);
  const [file, setFile] = useState(null);
  const [repoUrl, setRepoUrl] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiClient.get('/projects/').then((res) => setProjects(res.data)).catch(() => {});
  }, []);

  const presetProject = projects.find((p) => String(p.id) === String(presetProjectId));

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const dropped = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!dropped) return;
    if (!dropped.name.endsWith('.zip')) {
      setError('Code archives only. Please upload a .zip file.');
      return;
    }
    setFile(dropped);
    setError('');
  };

  // The repo_url is recorded on first creation so the dashboard can tell a
  // git-scanned project from an uploaded one; an existing project is left alone.
  const resolveProjectId = async (name, sourceUrl) => {
    const existing = projects.find((p) => p.name === name);
    if (existing) return existing.id;

    const res = await apiClient.post('/projects/', { name, repo_url: sourceUrl });
    return res.data.id;
  };

  const startScan = async (e) => {
    e.preventDefault();
    // The file input is visually hidden inside the drop zone, so the browser's
    // required-attribute validation is not a reliable gate here.
    if (tab === 'zip' && !file) {
      setError('Choose a .zip archive to scan.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      let projectId;
      let sourceUrl = '';
      if (presetProjectId) {
        projectId = presetProjectId;
      } else if (tab === 'zip') {
        projectId = await resolveProjectId(file.name.replace(/\.zip$/i, ''), '');
      } else {
        sourceUrl = repoUrl;
        projectId = await resolveProjectId(nameFromRepo(repoUrl), sourceUrl);
      }

      const formData = new FormData();
      formData.append('project_id', projectId);
      if (tab === 'zip') {
        formData.append('file', file);
      } else {
        formData.append('repo_url', repoUrl);
      }

      const endpoint = tab === 'zip' ? '/scans/upload' : '/scans/git';
      const res = await apiClient.post(endpoint, formData);
      navigate(`/scan/${res.data.scan_id}`);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start the scan. Check the input and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] text-slate-200 flex font-sans">
      <Sidebar active="new-scan" />

      <main className="flex-1 p-10 relative min-w-0">
        <div className="absolute top-0 right-0 w-[50%] h-[50%] bg-indigo-600/5 rounded-full blur-[120px] pointer-events-none"></div>

        <div className="max-w-3xl relative z-10">
          <Link to="/dashboard" className="inline-flex items-center gap-2 text-xs text-slate-500 hover:text-brand-accent font-bold uppercase tracking-widest mb-6 transition-colors">
            <span>&larr;</span> Back to dashboard
          </Link>

          <h1 className="text-4xl font-black text-white tracking-tight mb-3">Start a new scan</h1>
          <p className="text-slate-500 font-medium mb-2">
            Upload a project archive or point at a public repository URL.
          </p>
          {presetProject && (
            <p className="text-sm text-brand-accent font-bold mb-2">
              Scanning into project: {presetProject.name}
            </p>
          )}
          <p className="text-xs text-slate-600 font-medium mb-10">Code archives only</p>

          {/* Tabs */}
          <div className="flex gap-2 mb-8 bg-slate-900/40 p-2 rounded-2xl border border-slate-800 w-fit">
            <button
              type="button"
              onClick={() => { setTab('zip'); setError(''); }}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                tab === 'zip'
                  ? 'bg-brand-accent text-white shadow-lg shadow-brand-accent/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Upload size={16} />
              Upload zip
              <span className={`text-[10px] font-bold uppercase tracking-widest ${tab === 'zip' ? 'text-indigo-200' : 'text-slate-600'}`}>
                Max 50 MB
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setTab('git'); setError(''); }}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all ${
                tab === 'git'
                  ? 'bg-brand-accent text-white shadow-lg shadow-brand-accent/20'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Globe size={16} />
              Repository URL
            </button>
          </div>

          <form onSubmit={startScan}>
            {tab === 'zip' ? (
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed p-16 rounded-3xl text-center cursor-pointer relative group bg-slate-950/50 transition-colors ${
                  dragActive ? 'border-brand-accent bg-brand-accent/5' : 'border-slate-800 hover:border-brand-accent'
                }`}
              >
                <input
                  type="file"
                  accept=".zip"
                  onChange={(e) => { setFile(e.target.files[0]); setError(''); }}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  required
                />
                {file ? (
                  <>
                    <FileArchive className="mx-auto text-brand-accent mb-4" size={48} />
                    <p className="text-lg font-bold text-white">{file.name}</p>
                    <p className="text-xs text-slate-500 mt-2 font-medium">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB - ready to scan
                    </p>
                  </>
                ) : (
                  <>
                    <Upload className="mx-auto text-slate-700 group-hover:text-brand-accent transition-colors mb-4" size={48} />
                    <p className="text-slate-300 font-bold">Drag and drop your project .zip or click to browse</p>
                    <p className="text-xs text-slate-600 mt-2 uppercase tracking-widest font-medium">Max 50 MB</p>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Repository URL</label>
                <div className="relative">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={18} />
                  <input
                    type="url"
                    value={repoUrl}
                    onChange={(e) => { setRepoUrl(e.target.value); setError(''); }}
                    className="w-full pl-12 pr-4 py-4 rounded-2xl bg-slate-950 border border-slate-800 text-white focus:ring-2 focus:ring-brand-accent/50 focus:border-brand-accent outline-none transition-all placeholder:text-slate-700"
                    placeholder="https://github.com/org/repo"
                    required
                  />
                </div>
                <p className="text-xs text-slate-600 font-medium ml-1">
                  The repository is cloned with its full history, then scanned locally.
                </p>
              </div>
            )}

            {error && (
              <div className="mt-6 flex items-start gap-3 text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 font-medium">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-8 w-full flex items-center justify-center gap-3 py-4 bg-brand-accent hover:bg-indigo-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-brand-accent/20 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
            >
              <Zap size={20} />
              {busy ? 'Queuing scan…' : 'Start scan'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default NewScanPage;
