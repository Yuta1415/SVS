import React, { useState } from 'react';
import { 
  Code2, 
  Terminal, 
  Database, 
  Layers, 
  Copy, 
  Check, 
  ExternalLink, 
  ShieldCheck, 
  Server, 
  Cpu, 
  Workflow, 
  Sparkles,
  BookOpen,
  Download
} from 'lucide-react';
import { BACKEND_ARCHITECTURE_DOC, STEP_BY_STEP_PROMPTS } from '../data/docsAndPrompts';

export const ArchitectureDocsView: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'architecture' | 'api' | 'db' | 'prompts'>('architecture');
  const [copiedPromptStep, setCopiedPromptStep] = useState<number | null>(null);
  const [copiedCurlId, setCopiedCurlId] = useState<string | null>(null);

  const handleCopyPrompt = (stepNumber: number, promptText: string) => {
    navigator.clipboard.writeText(promptText);
    setCopiedPromptStep(stepNumber);
    setTimeout(() => setCopiedPromptStep(null), 2000);
  };

  const handleCopyCurl = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCurlId(id);
    setTimeout(() => setCopiedCurlId(null), 2000);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-semibold text-indigo-400 mb-3">
            <Layers className="h-3.5 w-3.5" />
            Technical Specifications & Prompts Playbook
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Backend Architecture, API Reference & Prompts
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Complete blueprint for SVS: containerized worker pipelines, database schema, OpenAPI routes, and the 15-step prompt series for AI coding tools.
          </p>
        </div>

        <a
          id="docs-download-project-zip-btn"
          href="/svs-security-scanner-project.zip"
          download="svs-security-scanner-project.zip"
          className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2.5 text-xs font-bold text-indigo-300 shadow-sm transition-all hover:bg-indigo-500 hover:text-white shrink-0"
        >
          <Download className="h-4 w-4" />
          Download Full Project ZIP
        </a>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 pb-3 text-xs font-semibold">
        <button
          onClick={() => setActiveSubTab('architecture')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 transition-all ${
            activeSubTab === 'architecture'
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Server className="h-4 w-4" />
          System Architecture
        </button>

        <button
          onClick={() => setActiveSubTab('prompts')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 transition-all ${
            activeSubTab === 'prompts'
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sparkles className="h-4 w-4 text-amber-300" />
          15-Step AI Implementation Prompts
        </button>

        <button
          onClick={() => setActiveSubTab('api')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 transition-all ${
            activeSubTab === 'api'
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="h-4 w-4" />
          REST API Endpoints
        </button>

        <button
          onClick={() => setActiveSubTab('db')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 transition-all ${
            activeSubTab === 'db'
              ? 'bg-indigo-500 text-white shadow-md'
              : 'bg-slate-900/60 text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="h-4 w-4" />
          Database Schema (ERD)
        </button>
      </div>

      {/* Sub-Tab 1: System Architecture */}
      {activeSubTab === 'architecture' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:p-8 space-y-6">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Workflow className="h-5 w-5 text-indigo-400" />
              High-Level Execution Pipeline Architecture
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {BACKEND_ARCHITECTURE_DOC.overview}
            </p>

            {/* Architecture Principles Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {BACKEND_ARCHITECTURE_DOC.corePrinciples.map((principle, idx) => {
                const [title, desc] = principle.split(': ');
                return (
                  <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-1.5">
                    <span className="text-xs font-bold text-indigo-300">{title}</span>
                    <p className="text-xs text-slate-400 leading-relaxed">{desc}</p>
                  </div>
                );
              })}
            </div>

            {/* Visual Architecture Diagram Box */}
            <div className="space-y-3 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Containerized Pipeline Topology (Mermaid Diagram)
                </span>
                <span className="text-[11px] font-mono text-emerald-400">Docker Isolated Workers</span>
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950 p-6 font-['JetBrains_Mono',monospace] text-xs text-indigo-300 overflow-x-auto shadow-inner">
                <pre className="whitespace-pre leading-relaxed">{BACKEND_ARCHITECTURE_DOC.mermaidDiagram}</pre>
              </div>
            </div>

            {/* Sandbox Isolation Guarantees */}
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Security Boundaries for User Code Ingestion
              </h3>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Least-Egress Containers:</strong> Every scanner runs in its own container with a 512MB memory cap and a 15-minute timeout. Gitleaks runs with no network at all; Semgrep and the CVE audit egress only to fetch their ruleset and advisory databases, never to exfiltrate scanned code.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>SSRF Hardening:</strong> All incoming repository URLs are resolved and validated against loopback (127.0.0.1), private RFC1918 ranges, and cloud instance metadata (169.254.169.254).</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold">•</span>
                  <span><strong>Storage Ceiling & Ephemeral Cleanup:</strong> Strict 50MB archive cap with automated directory wiping immediately upon scan completion or failure.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 2: 15-Step AI Prompts Playbook */}
      {activeSubTab === 'prompts' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
            <span className="font-bold">Prompting Pro-Tip (from SVS Specification):</span> Use these prompts in order, one at a time, in an AI coding tool (Claude Code, Cursor, AI Studio). Each step builds on the last. Review and test the output before moving to the next prompt — don't chain them all at once!
          </div>

          <div className="space-y-4">
            {STEP_BY_STEP_PROMPTS.map((step) => {
              const isCopied = copiedPromptStep === step.step;

              return (
                <div
                  key={step.step}
                  id={`prompt-step-${step.step}`}
                  className="rounded-2xl border border-slate-800 bg-slate-950 p-5 sm:p-6 space-y-4 transition-all hover:border-slate-700"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/20 text-indigo-400 font-bold text-sm border border-indigo-500/30">
                        {step.step}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-white">{step.title}</h3>
                        <span className="text-xs font-mono text-slate-400">{step.category}</span>
                      </div>
                    </div>

                    <button
                      id={`copy-prompt-btn-${step.step}`}
                      onClick={() => handleCopyPrompt(step.step, step.prompt)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-500/15 border border-indigo-500/30 px-3.5 py-1.5 text-xs font-bold text-indigo-300 hover:bg-indigo-500 hover:text-white transition"
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                      {isCopied ? 'Copied Prompt!' : 'Copy Prompt'}
                    </button>
                  </div>

                  <p className="text-xs text-slate-300 leading-relaxed">
                    {step.description}
                  </p>

                  {/* Prompt Box */}
                  <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-['JetBrains_Mono',monospace] text-xs text-slate-200 leading-relaxed shadow-inner">
                    <pre className="whitespace-pre-wrap">{step.prompt}</pre>
                  </div>

                  {/* Key Deliverables */}
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-[11px]">
                    <span className="text-slate-500 font-medium">Deliverables:</span>
                    {step.keyDeliverables.map((del, i) => (
                      <span key={i} className="rounded-md bg-slate-900 border border-slate-800 px-2 py-0.5 text-slate-400 font-mono">
                        {del}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sub-Tab 3: REST API Endpoints */}
      {activeSubTab === 'api' && (
        <div className="space-y-6">
          <div className="space-y-4">
            {BACKEND_ARCHITECTURE_DOC.endpoints.map((ep, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-5 sm:p-6 space-y-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-bold font-mono ${
                      ep.method === 'POST' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
                      ep.method === 'GET' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' :
                      'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                    }`}>
                      {ep.method}
                    </span>
                    <span className="font-mono text-sm font-bold text-white">{ep.path}</span>
                  </div>
                  <span className="rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-mono text-slate-400 border border-slate-800">
                    Auth: {ep.auth}
                  </span>
                </div>

                <p className="text-xs text-slate-300">
                  {ep.description}
                </p>

                {ep.requestBody && (
                  <div className="space-y-1">
                    <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Request Payload
                    </span>
                    <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-slate-300 overflow-x-auto">
                      <pre className="whitespace-pre">{ep.requestBody}</pre>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                    Response Example (200 OK)
                  </span>
                  <div className="rounded-lg border border-slate-800 bg-slate-900 p-3 font-mono text-xs text-emerald-300 overflow-x-auto">
                    <pre className="whitespace-pre">{ep.responseExample}</pre>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tab 4: Database ERD Schema */}
      {activeSubTab === 'db' && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 sm:p-8 space-y-6">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Database className="h-5 w-5 text-indigo-400" />
                PostgreSQL Relational Schema Design (Step 2)
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Implemented using Prisma ORM or SQLAlchemy with cascading deletes and index optimizations on scan status and foreign keys.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Users Table */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-mono text-sm font-bold text-white">users</span>
                  <span className="text-xs text-slate-500">Authentication & Tenant</span>
                </div>
                <div className="font-mono text-xs space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-indigo-400">id</span><span>UUID PRIMARY KEY</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">email</span><span>VARCHAR(255) UNIQUE</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">password_hash</span><span>VARCHAR(255)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">role</span><span>VARCHAR(50) DEFAULT 'dev'</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">created_at</span><span>TIMESTAMPTZ DEFAULT NOW()</span></div>
                </div>
              </div>

              {/* Projects Table */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-mono text-sm font-bold text-white">projects</span>
                  <span className="text-xs text-slate-500">Target Codebase</span>
                </div>
                <div className="font-mono text-xs space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-indigo-400">id</span><span>UUID PRIMARY KEY</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">user_id</span><span>UUID REFERENCES users(id)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">name</span><span>VARCHAR(255)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">repo_url</span><span>VARCHAR(512) NULL</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">created_at</span><span>TIMESTAMPTZ DEFAULT NOW()</span></div>
                </div>
              </div>

              {/* Scans Table */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-mono text-sm font-bold text-white">scans</span>
                  <span className="text-xs text-slate-500">Scan Runs & Score</span>
                </div>
                <div className="font-mono text-xs space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-indigo-400">id</span><span>UUID PRIMARY KEY</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">project_id</span><span>UUID REFERENCES projects(id)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">status</span><span>VARCHAR(50) (pending|scanning|complete)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">score</span><span>INT DEFAULT 100</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">duration_sec</span><span>INT</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">counts</span><span>JSONB (crit, high, med, low)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">started_at</span><span>TIMESTAMPTZ</span></div>
                </div>
              </div>

              {/* Findings Table */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-mono text-sm font-bold text-white">findings</span>
                  <span className="text-xs text-slate-500">Vulnerabilities & Fixes</span>
                </div>
                <div className="font-mono text-xs space-y-1.5 text-slate-300">
                  <div className="flex justify-between"><span className="text-indigo-400">id</span><span>UUID PRIMARY KEY</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">scan_id</span><span>UUID REFERENCES scans(id)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">scanner</span><span>VARCHAR(50) (semgrep|gitleaks|audit)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">severity</span><span>VARCHAR(20) (critical|high|med|low)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">file_path</span><span>VARCHAR(512)</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">line_number</span><span>INT</span></div>
                  <div className="flex justify-between"><span className="text-indigo-400">remediation</span><span>TEXT</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
