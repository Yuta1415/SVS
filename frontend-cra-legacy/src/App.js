import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import DashboardView from './views/DashboardView';
import SubmitScanView from './views/SubmitScanView';
import ScanReportView from './views/ScanReportView';
import KnowledgeBaseView from './views/KnowledgeBaseView';
import ArchitectureDocsView from './views/ArchitectureDocsView';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      <Navbar />

      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardView />} />
          <Route path="/scan/new" element={<SubmitScanView />} />
          <Route path="/scan/:scanId" element={<ScanReportView />} />
          <Route path="/knowledge-base" element={<KnowledgeBaseView />} />
          <Route path="/architecture" element={<ArchitectureDocsView />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/90 py-6 text-center text-xs text-slate-500">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-400">SVS</span>
            <span>• Security Vulnerability Scanner Platform</span>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-500 font-mono">
            <span>Semgrep Core SAST</span>
            <span>Gitleaks Secrets</span>
            <span>Dependency CVE Audit</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
