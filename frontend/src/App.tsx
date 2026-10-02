import React, { useCallback, useEffect, useState } from 'react';
import { Navbar } from './components/Navbar';
import { DashboardView } from './components/DashboardView';
import { IngestScanView } from './components/IngestScanView';
import { ScanReportView } from './components/ScanReportView';
import { KnowledgeBaseView } from './components/KnowledgeBaseView';
import { ArchitectureDocsView } from './components/ArchitectureDocsView';
import { api, ProjectRow } from './services/api';
import { enrichScan, mapScanRow } from './services/adapter';
import { FindingStatus, Scan } from './types';

const POLL_INTERVAL_MS = 2500;

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'new-scan' | 'report' | 'kb' | 'architecture'>('dashboard');
  const [scans, setScans] = useState<Scan[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeScanId, setActiveScanId] = useState<string>('');

  const activeScan = scans.find(s => s.id === activeScanId) || scans[0];

  const loadScans = useCallback(async () => {
    const [scanRows, projectRows] = await Promise.all([api.listScans(), api.listProjects()]);
    setProjects(projectRows);
    setScans(scanRows.map((row) => mapScanRow(row, projectRows)));
    setLoadError(null);
  }, []);

  useEffect(() => {
    loadScans().catch((e) => setLoadError(e.message ?? 'Failed to reach the SVS API.'))
      .finally(() => setLoading(false));
  }, [loadScans]);

  // A queued scan is worked by Celery out-of-band, so the dashboard has to keep
  // asking until the row reports a terminal status.
  const inFlight = scans.some((s) => s.status === 'scanning');
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => { loadScans().catch(() => {}); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [inFlight, loadScans]);

  const handleSelectScan = (scanId: string) => {
    setActiveScanId(scanId);
    setActiveTab('report');

    // Findings are only fetched on demand: loading every scan's findings up
    // front would cost one call per scan on a dashboard that only needs counts.
    const scan = scans.find((s) => s.id === scanId);
    if (!scan || scan.findings) return;

    Promise.all([api.getScan(Number(scanId)), api.getFindings(Number(scanId))])
      .then(([detail, findings]) => {
        setScans((prev) => prev.map((s) => (s.id === scanId ? enrichScan(s, detail, findings) : s)));
      })
      .catch((e) => setLoadError(e.message ?? 'Failed to load scan findings.'));
  };

  const handleScanComplete = (newScan: Scan) => {
    setScans(prev => [newScan, ...prev]);
    setActiveScanId(newScan.id);
    setActiveTab('report');
  };

  const handleDeleteScan = async (scanId: string) => {
    // The scan row and its findings go together; the endpoint deletes both.
    await api.deleteScan(Number(scanId));
    setScans(prev => prev.filter(s => s.id !== scanId));
    if (activeScanId === scanId) {
      const remaining = scans.filter(s => s.id !== scanId);
      setActiveScanId(remaining.length > 0 ? remaining[0].id : '');
    }
  };

  const handleUpdateFindingStatus = async (findingId: string, newStatus: FindingStatus) => {
    const scanId = activeScanId;
    const scan = scans.find((s) => s.id === scanId);
    const finding = scan?.findings?.find((f) => f.id === findingId);
    if (!scan || !finding) return;

    // Optimistic update so the pill flips immediately; the server is the
    // source of truth and a failure rolls the pill back with the reason.
    const apply = (status: FindingStatus) => setScans((prev) => prev.map((s) => {
      if (s.id !== scanId) return s;
      return {
        ...s,
        findings: (s.findings || []).map((f) => (f.id === findingId ? { ...f, status } : f)),
      };
    }));

    apply(newStatus);
    try {
      await api.setTriage(Number(scanId), Number(findingId), newStatus);
    } catch (e) {
      apply(finding.status);
      setLoadError(e instanceof Error ? e.message : 'Failed to save triage decision.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Top Sticky Navigation */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        hasActiveReport={Boolean(activeScan)}
      />

      {/* Main View Area */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8">
        {loadError && (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200">
            SVS API error: {loadError}
          </div>
        )}
        {loading ? (
          <p className="text-slate-400">Loading scans...</p>
        ) : activeTab === 'dashboard' && (
          <DashboardView
            scans={scans}
            onSelectScan={handleSelectScan}
            onNewScan={() => setActiveTab('new-scan')}
            onDeleteScan={handleDeleteScan}
            onRefresh={() => { loadScans().catch(() => {}); }}
          />
        )}

        {activeTab === 'new-scan' && (
          <IngestScanView
            onScanComplete={handleScanComplete}
            onCancel={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'report' && activeScan && (
          <ScanReportView
            scan={activeScan}
            onBackToDashboard={() => setActiveTab('dashboard')}
            onUpdateFindingStatus={handleUpdateFindingStatus}
          />
        )}

        {activeTab === 'kb' && (
          <KnowledgeBaseView />
        )}

        {activeTab === 'architecture' && (
          <ArchitectureDocsView />
        )}
      </main>

      {/* Footer */}
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
