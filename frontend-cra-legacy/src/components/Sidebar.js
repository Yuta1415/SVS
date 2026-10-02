import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, LayoutDashboard, Zap, FileText } from 'lucide-react';
import apiClient from '../services/api';

// One nav for every page. The "Scan report" item points at the most recent scan,
// which needs a lookup, so it resolves on click instead of shipping a dead link.
const Sidebar = ({ active }) => {
  const navigate = useNavigate();

  const goToLatestReport = async () => {
    try {
      const res = await apiClient.get('/scans/');
      if (res.data.length === 0) {
        navigate('/dashboard');
        return;
      }
      navigate(`/scan/${res.data[0].id}`);
    } catch (err) {
      navigate('/dashboard');
    }
  };

  const items = [
    { key: 'dashboard', label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
    { key: 'new-scan', label: 'New scan', to: '/scan/new', icon: Zap },
  ];

  return (
    <aside className="w-64 shrink-0 bg-[#0f172a] border-r border-slate-800/50 p-6 flex flex-col relative h-screen sticky top-0">
      <div className="absolute top-0 left-0 w-1 h-full bg-brand-accent"></div>

      <div className="mb-12 px-2">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2 bg-brand-accent/10 rounded-lg border border-brand-accent/20">
            <Shield className="text-brand-accent w-6 h-6" />
          </div>
          <span className="text-xl font-black tracking-tighter text-white">SVS</span>
        </div>
        <p className="text-[10px] text-slate-600 font-bold uppercase tracking-[0.2em] ml-1">
          Security Vulnerability Scanner
        </p>
      </div>

      <nav className="flex-1 space-y-2">
        {items.map(({ key, label, to, icon: Icon }) => (
          <Link
            key={key}
            to={to}
            className={`flex items-center gap-3 p-3 rounded-xl font-bold transition-all border ${
              active === key
                ? 'bg-brand-accent/10 text-brand-accent border-brand-accent/20 shadow-[0_0_15px_rgba(99,102,241,0.1)]'
                : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border-transparent'
            }`}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
        <button
          onClick={goToLatestReport}
          className={`w-full flex items-center gap-3 p-3 rounded-xl font-bold transition-all border ${
            active === 'report'
              ? 'bg-brand-accent/10 text-brand-accent border-brand-accent/20'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border-transparent'
          }`}
        >
          <FileText size={20} />
          Scan report
        </button>
      </nav>

      <div className="pt-6 border-t border-slate-800/50">
        <div className="flex items-center gap-3 px-2">
          <div className="w-9 h-9 rounded-full bg-brand-accent/20 border border-brand-accent/30 flex items-center justify-center text-brand-accent font-black text-sm">
            L
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-white truncate">local</p>
            <p className="text-[10px] text-slate-600 font-medium truncate">single-user instance</p>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
