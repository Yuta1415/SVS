import React from 'react';
import {
  ShieldAlert,
  Terminal,
  BookOpen,
  Code2,
  PlusCircle,
  LayoutDashboard,
} from 'lucide-react';

interface NavbarProps {
  activeTab: 'dashboard' | 'new-scan' | 'report' | 'kb' | 'architecture';
  setActiveTab: (tab: 'dashboard' | 'new-scan' | 'report' | 'kb' | 'architecture') => void;
  hasActiveReport: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  hasActiveReport,
}) => {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <button
            id="nav-brand-btn"
            onClick={() => setActiveTab('dashboard')}
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
        </div>

        {/* Navigation Tabs */}
        <nav className="hidden md:flex items-center gap-1 text-sm font-medium">
          <button
            id="nav-tab-dashboard"
            onClick={() => setActiveTab('dashboard')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'dashboard'
                ? 'bg-slate-800 text-white shadow-inner font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </button>

          <button
            id="nav-tab-new-scan"
            onClick={() => setActiveTab('new-scan')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'new-scan'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <PlusCircle className="h-4 w-4 text-emerald-400" />
            New Scan
          </button>

          {hasActiveReport && (
            <button
              id="nav-tab-report"
              onClick={() => setActiveTab('report')}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all ${
                activeTab === 'report'
                  ? 'bg-slate-800 text-white shadow-inner font-semibold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Terminal className="h-4 w-4 text-cyan-400" />
              Scan Report
            </button>
          )}

          <button
            id="nav-tab-kb"
            onClick={() => setActiveTab('kb')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'kb'
                ? 'bg-slate-800 text-white shadow-inner font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <BookOpen className="h-4 w-4 text-amber-400" />
            Knowledge Base
          </button>

          <button
            id="nav-tab-architecture"
            onClick={() => setActiveTab('architecture')}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 transition-all ${
              activeTab === 'architecture'
                ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-semibold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Code2 className="h-4 w-4 text-indigo-400" />
            Backend Architecture &amp; Prompts
          </button>
        </nav>

        {/* Right Actions: local instance pill. No auth surface by design. */}
        <div className="flex items-center gap-3">
          <div
            title="Local instance: no sign-in, no shared state"
            className="hidden sm:flex items-center gap-1.5 rounded-full bg-slate-900/90 px-3 py-1 text-xs border border-slate-800 text-slate-300"
          >
            <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-emerald-400 font-medium">local</span>
          </div>
        </div>
      </div>

      {/* Mobile Tab Bar */}
      <div className="flex md:hidden border-t border-slate-800/80 bg-slate-950 px-2 py-1.5 overflow-x-auto gap-1 text-xs">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap ${
            activeTab === 'dashboard' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
          }`}
        >
          <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
        </button>
        <button
          onClick={() => setActiveTab('new-scan')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap ${
            activeTab === 'new-scan' ? 'bg-emerald-500/20 text-emerald-300 font-medium' : 'text-slate-400'
          }`}
        >
          <PlusCircle className="h-3.5 w-3.5 text-emerald-400" /> New Scan
        </button>
        {hasActiveReport && (
          <button
            onClick={() => setActiveTab('report')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap ${
              activeTab === 'report' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
            }`}
          >
            <Terminal className="h-3.5 w-3.5 text-cyan-400" /> Report
          </button>
        )}
        <button
          onClick={() => setActiveTab('kb')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap ${
            activeTab === 'kb' ? 'bg-slate-800 text-white font-medium' : 'text-slate-400'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5 text-amber-400" /> Knowledge Base
        </button>
        <button
          onClick={() => setActiveTab('architecture')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md whitespace-nowrap ${
            activeTab === 'architecture' ? 'bg-indigo-500/20 text-indigo-300 font-medium' : 'text-slate-400'
          }`}
        >
          <Code2 className="h-3.5 w-3.5 text-indigo-400" /> Docs &amp; Prompts
        </button>
      </div>
    </header>
  );
};
