import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  ShieldAlert,
  Terminal,
  BookOpen,
  Code2,
  PlusCircle,
  LayoutDashboard,
} from 'lucide-react';

const TABS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/dashboard' },
  { key: 'new-scan', label: 'New Scan', icon: PlusCircle, to: '/scan/new' },
  { key: 'report', label: 'Scan Report', icon: Terminal, to: null, accent: 'cyan' },
  { key: 'kb', label: 'Knowledge Base', icon: BookOpen, to: '/knowledge-base', accent: 'amber' },
  { key: 'architecture', label: 'Backend Architecture & Prompts', icon: Code2, to: '/architecture', accent: 'indigo' },
];

export const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (tab) => {
    if (tab.key === 'report') return location.pathname.startsWith('/scan/');
    if (tab.key === 'new-scan') return location.pathname === '/scan/new';
    if (tab.key === 'dashboard') return location.pathname === '/dashboard' || location.pathname === '/';
    return location.pathname === tab.to;
  };

  const tabClass = (tab) => {
    const active = isActive(tab);
    if (tab.key === 'new-scan') {
      return active
        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60';
    }
    if (tab.key === 'architecture') {
      return active
        ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold'
        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60';
    }
    return active
      ? 'bg-slate-800 text-white shadow-inner font-semibold'
      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60';
  };

  const mobileTabClass = (tab) => {
    const active = isActive(tab);
    if (tab.key === 'new-scan') return active ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'text-slate-400';
    if (tab.key === 'architecture') return active ? 'bg-indigo-500/20 text-indigo-300 font-medium' : 'text-slate-400';
    return active ? 'bg-slate-800 text-white font-medium' : 'text-slate-400';
  };

  const go = (tab) => {
    if (tab.key === 'report') return;
    navigate(tab.to);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <button
          id="nav-brand-btn"
          onClick={() => navigate('/dashboard')}
          className="group flex items-center gap-2.5 text-left transition-opacity hover:opacity-90"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 via-cyan-500/20 to-blue-500/20 border border-emerald-500/30 text-emerald-400 shadow-sm shadow-emerald-500/10">
            <ShieldAlert className="h-5 w-5 text-emerald-400 transition-transform group-hover:scale-105" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold tracking-tight text-white text-base">SVS</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                v2.4
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-medium">Security Vulnerability Scanner</p>
          </div>
        </button>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
          {TABS.filter((t) => t.key !== 'report' || isActive(t)).map((tab) => {
            const Icon = tab.icon;
            const accent =
              tab.key === 'new-scan' ? 'text-emerald-400'
                : tab.key === 'report' ? 'text-cyan-400'
                  : tab.key === 'kb' ? 'text-amber-400'
                    : tab.key === 'architecture' ? 'text-indigo-400' : '';
            return (
              <button
                key={tab.key}
                id={`nav-tab-${tab.key}`}
                onClick={() => go(tab)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all ${tabClass(tab)}`}
              >
                <Icon className={`h-4 w-4 ${accent}`} />
                {tab.key === 'report' ? 'Scan Report' : tab.label}
              </button>
            );
          })}
        </nav>

        {/* Right Actions: engine health pill */}
        <div className="flex items-center gap-3">
          <a
            href={`${process.env.REACT_APP_API_URL || 'http://localhost:8000'}/health`}
            target="_blank"
            rel="noreferrer"
            className="hidden sm:flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1 text-xs border border-slate-800 text-slate-300 hover:border-slate-700"
            title="Backend health check"
          >
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-emerald-400 font-medium">API</span>
            <span className="text-slate-400">live</span>
          </a>
        </div>
      </div>

      {/* Mobile Tab Bar */}
      <div className="flex md:hidden border-t border-slate-800/80 bg-slate-950 px-2 py-1.5 overflow-x-auto gap-1 text-xs">
        {TABS.filter((t) => t.key !== 'report' || isActive(t)).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => go(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap ${mobileTabClass(tab)}`}
            >
              <Icon className="h-3.5 w-3.5" /> {tab.key === 'report' ? 'Report' : tab.key === 'kb' ? 'Knowledge Base' : tab.key === 'architecture' ? 'Docs & Prompts' : tab.label}
            </button>
          );
        })}
      </div>
    </header>
  );
};
