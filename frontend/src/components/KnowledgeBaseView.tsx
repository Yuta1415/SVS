import React, { useState } from 'react';
import { 
  BookOpen, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Code2, 
  ShieldAlert, 
  Copy, 
  Check, 
  FileText,
  Lock,
  ChevronRight
} from 'lucide-react';
import { KNOWLEDGE_BASE_ITEMS } from '../data/knowledgeBase';
import { KnowledgeBaseItem } from '../types';

export const KnowledgeBaseView: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'SAST' | 'Secrets' | 'Dependencies'>('all');
  const [selectedItem, setSelectedItem] = useState<KnowledgeBaseItem>(KNOWLEDGE_BASE_ITEMS[0]);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  const filteredItems = KNOWLEDGE_BASE_ITEMS.filter(item => {
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    const matchesSearch = 
      item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.cwe.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.summary.toLowerCase().includes(searchTerm.toLowerCase());

    return matchesCategory && matchesSearch;
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  return (
    <div className="space-y-8 pb-16">
      {/* Header */}
      <div>
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-400 mb-3">
          <BookOpen className="h-3.5 w-3.5" />
          SVS Security Knowledge Base (Step 9)
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
          Vulnerability Explanations & Secure Code Standards
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          In-depth architectural explanations of vulnerability classes, exploitation impacts, and battle-tested remediation snippets.
        </p>
      </div>

      {/* Main Grid: Sidebar + Active Item */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left List of Vulnerability Classes */}
        <div className="lg:col-span-4 space-y-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search CWE, title, attack type..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-slate-800 bg-slate-900 pl-10 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-900/60 p-1 text-xs">
            {(['all', 'SAST', 'Secrets', 'Dependencies'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`flex-1 rounded-lg py-1.5 font-semibold capitalize transition ${
                  categoryFilter === cat ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedItem(item)}
                className={`w-full text-left rounded-xl border p-4 transition-all flex items-start justify-between gap-3 ${
                  selectedItem.id === item.id
                    ? 'border-amber-500/50 bg-amber-500/10 shadow-md ring-1 ring-amber-500/50'
                    : 'border-slate-800/80 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70'
                }`}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white truncate">{item.type}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-cyan-300">
                      {item.cwe}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 line-clamp-2">
                    {item.summary}
                  </p>
                </div>
                <ChevronRight className={`h-4 w-4 shrink-0 mt-1 transition-transform ${
                  selectedItem.id === item.id ? 'text-amber-400 translate-x-0.5' : 'text-slate-600'
                }`} />
              </button>
            ))}
          </div>
        </div>

        {/* Right: Detailed Deep Dive View */}
        <div className="lg:col-span-8">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-6 sm:p-8 space-y-6 shadow-xl">
            {/* Header info */}
            <div className="space-y-2 border-b border-slate-800 pb-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-amber-500/20 px-2.5 py-0.5 text-xs font-bold text-amber-300 border border-amber-500/30">
                  {selectedItem.category} Scanner
                </span>
                <span className="rounded-md bg-slate-800 px-2.5 py-0.5 text-xs font-mono text-cyan-300 border border-slate-700">
                  {selectedItem.cwe}
                </span>
                <span className="rounded-md bg-rose-500/20 px-2.5 py-0.5 text-xs font-bold uppercase text-rose-300">
                  Default: {selectedItem.defaultSeverity}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white">
                {selectedItem.title}
              </h2>
            </div>

            {/* Why It Matters */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" />
                Exploitation Impact & Why It Matters
              </h3>
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed bg-rose-950/20 border border-rose-900/40 rounded-xl p-4">
                {selectedItem.whyItMatters}
              </p>
            </div>

            {/* Code Comparison (Vulnerable vs Secure) */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Code2 className="h-4 w-4 text-cyan-400" />
                Code Implementation Comparison
              </h3>

              {/* Vulnerable Snippet */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-rose-400 font-semibold">
                  <span>❌ Insecure Implementation Pattern:</span>
                  <button
                    onClick={() => handleCopy(`vuln-${selectedItem.id}`, selectedItem.vulnerableExample)}
                    className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                  >
                    {copiedCodeId === `vuln-${selectedItem.id}` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    Copy
                  </button>
                </div>
                <div className="rounded-xl border border-rose-500/30 bg-slate-950 p-4 font-['JetBrains_Mono',monospace] text-xs text-rose-300 overflow-x-auto shadow-inner">
                  <pre className="whitespace-pre">{selectedItem.vulnerableExample}</pre>
                </div>
              </div>

              {/* Secure Snippet */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-emerald-400 font-semibold">
                  <span>✅ Hardened & Defensive Solution:</span>
                  <button
                    onClick={() => handleCopy(`sec-${selectedItem.id}`, selectedItem.secureExample)}
                    className="inline-flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 font-semibold"
                  >
                    {copiedCodeId === `sec-${selectedItem.id}` ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                    Copy Fix
                  </button>
                </div>
                <div className="rounded-xl border border-emerald-500/30 bg-slate-950 p-4 font-['JetBrains_Mono',monospace] text-xs text-emerald-300 overflow-x-auto shadow-inner">
                  <pre className="whitespace-pre">{selectedItem.secureExample}</pre>
                </div>
              </div>
            </div>

            {/* Remediation Checklist */}
            <div className="space-y-2 border-t border-slate-800 pt-5">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                Defensive Engineering Checklist
              </h3>
              <ul className="space-y-2">
                {selectedItem.remediationSteps.map((step, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-slate-300">
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400 mt-0.5">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
