'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

// Bible 8.5 (third Stats & Insights area) / 8.4 Stage 3+4 — these are the
// same feature. Stage 3 (below) exports every active SOHC asset for a site
// into a spreadsheet so costs can be bulk-edited in Excel. Stage 4 (this
// session) uploads the edited file back, matches rows to health_items by
// the "Item ID (do not edit)" column, validates them, and applies whatever
// is valid — reporting per-row errors for anything that isn't, rather than
// blocking the whole file. Every upload attempt is logged to
// cost_import_log regardless of outcome (Ben's call — no undo yet, so a
// visible history matters).

interface SiteRow {
  id: string;
  name: string;
}

interface CostImportRowResult {
  itemId: string;
  itemName: string | null;
  oldCost: number | null;
  newCost: number | null;
  oldConfidence: string | null;
  newConfidence: string | null;
  status: 'applied' | 'error';
  errorMessage?: string;
}

interface CostImportSummary {
  rowsTotal: number;
  rowsApplied: number;
  rowsErrored: number;
  details: CostImportRowResult[];
}

interface ImportLogRow {
  id: string;
  uploaded_by_email: string | null;
  filename: string;
  uploaded_at: string;
  rows_total: number;
  rows_applied: number;
  rows_errored: number;
}

export default function ImportExportTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<CostImportSummary | null>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ImportLogRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('sites').select('id, name').order('name');
      if (error) {
        setLoadError(error.message);
      } else {
        setSites(data ?? []);
      }
      setLoadingSites(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching sites invalidates any result/history from the previous site.
  useEffect(() => {
    setImportResult(null);
    setUploadError(null);
    setHistory([]);
    setHistoryOpen(false);
  }, [selectedSiteId]);

  async function downloadTemplate() {
    if (!selectedSiteId) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const res = await fetch(`/api/reports/health/cost-template/${selectedSiteId}`);
      if (!res.ok) throw new Error('Could not generate the template');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const siteName = sites.find((s) => s.id === selectedSiteId)?.name ?? 'site';
      const a = document.createElement('a');
      a.href = url;
      a.download = `${siteName.replace(/[^a-z0-9]+/gi, '-')}-cost-template.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selectedSiteId) return;
    setUploading(true);
    setUploadError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('siteId', selectedSiteId);
      formData.append('file', file);

      const res = await fetch('/api/health/cost-import', { method: 'POST', body: formData });
      const body = await res.json();

      if (!res.ok) {
        throw new Error(body?.error ?? 'Import failed');
      }

      setImportResult(body as CostImportSummary);
      if (historyOpen) loadHistory();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function loadHistory() {
    if (!selectedSiteId) return;
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('cost_import_log')
      .select('id, uploaded_by_email, filename, uploaded_at, rows_total, rows_applied, rows_errored')
      .eq('site_id', selectedSiteId)
      .order('uploaded_at', { ascending: false })
      .limit(20);
    if (!error) setHistory(data ?? []);
    setHistoryLoading(false);
  }

  function toggleHistory() {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next && history.length === 0) loadHistory();
  }

  if (loadingSites) return <p className="text-sm text-rsl-navy/50">Loading…</p>;
  if (loadError) {
    return (
      <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red">
        Couldn't load: {loadError}
      </div>
    );
  }

  const selectedSiteName = sites.find((s) => s.id === selectedSiteId)?.name ?? '';
  const errorRows = importResult?.details.filter((d) => d.status === 'error') ?? [];
  const appliedRows = importResult?.details.filter((d) => d.status === 'applied') ?? [];

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rsl-navy/10 p-5 space-y-3">
        <h3 className="text-sm font-bold text-rsl-navy">Site</h3>
        <select
          value={selectedSiteId}
          onChange={(e) => setSelectedSiteId(e.target.value)}
          className="text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 text-rsl-navy w-full sm:w-auto"
        >
          <option value="">Select a site…</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div className="rounded-2xl border border-rsl-navy/10 p-5 space-y-3">
        <h3 className="text-sm font-bold text-rsl-navy">Download cost template</h3>
        <p className="text-sm text-rsl-navy/60">
          Exports every active SOHC asset for this site into a spreadsheet — including current replacement costs
          already entered in Admin &gt; Asset Costs — so you can bulk-edit in Excel instead of one row at a time.
        </p>

        <button
          onClick={downloadTemplate}
          disabled={!selectedSiteId || downloading}
          className="text-sm font-semibold bg-rsl-navy text-white rounded-lg px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {downloading ? 'Generating…' : 'Download Excel Template'}
        </button>

        {downloadError && <p className="text-sm text-rsl-red">{downloadError}</p>}
      </div>

      <div className="rounded-2xl border border-rsl-navy/10 p-5 space-y-3">
        <h3 className="text-sm font-bold text-rsl-navy">Upload edited template</h3>
        <p className="text-sm text-rsl-navy/60">
          Re-uploads a filled-in template and matches each row back to its asset by the hidden Item ID column.
          Valid rows are applied immediately; any problem rows are reported below without blocking the rest of
          the file. Only edit the Replacement Cost and Cost Confidence columns — don't add, delete, or reorder
          rows.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={!selectedSiteId || uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadFile(file);
            }}
            className="text-sm text-rsl-navy/70 disabled:opacity-40"
          />
          {uploading && <span className="text-sm text-rsl-navy/50">Uploading and validating…</span>}
        </div>

        {!selectedSiteId && <p className="text-xs text-rsl-navy/40">Select a site above first.</p>}
        {uploadError && (
          <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red">
            {uploadError}
          </div>
        )}

        {importResult && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <span className="text-sm font-semibold text-pass bg-pass/10 rounded-full px-3 py-1">
                {importResult.rowsApplied} applied
              </span>
              {importResult.rowsErrored > 0 && (
                <span className="text-sm font-semibold text-rsl-red bg-rsl-red/10 rounded-full px-3 py-1">
                  {importResult.rowsErrored} error{importResult.rowsErrored !== 1 && 's'}
                </span>
              )}
            </div>

            {errorRows.length > 0 && (
              <div className="rounded-xl border border-rsl-red/20 bg-rsl-red/5 p-3 space-y-1.5 max-h-64 overflow-y-auto">
                {errorRows.map((r, i) => (
                  <p key={`${r.itemId}-${i}`} className="text-xs text-rsl-red">
                    {r.errorMessage}
                  </p>
                ))}
              </div>
            )}

            {appliedRows.length > 0 && (
              <details className="text-xs text-rsl-navy/60">
                <summary className="cursor-pointer font-semibold text-rsl-navy/70">
                  View {appliedRows.length} applied change{appliedRows.length !== 1 && 's'}
                </summary>
                <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
                  {appliedRows.map((r, i) => (
                    <p key={`${r.itemId}-${i}`}>
                      {r.itemName}: ${r.oldCost ?? '—'} → ${r.newCost ?? '—'}
                      {r.oldConfidence !== r.newConfidence && (
                        <> · {r.oldConfidence ?? 'none'} → {r.newConfidence ?? 'none'}</>
                      )}
                    </p>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-rsl-navy/10 p-5 space-y-3">
        <button
          onClick={toggleHistory}
          disabled={!selectedSiteId}
          className="text-sm font-semibold text-rsl-navy disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {historyOpen ? '▾' : '▸'} Import history{selectedSiteName && ` — ${selectedSiteName}`}
        </button>

        {historyOpen && (
          <div className="space-y-2">
            {historyLoading && <p className="text-sm text-rsl-navy/50">Loading…</p>}
            {!historyLoading && history.length === 0 && (
              <p className="text-sm text-rsl-navy/40">No imports logged for this site yet.</p>
            )}
            {history.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 text-xs text-rsl-navy/60 border-b border-rsl-navy/5 pb-2">
                <span className="font-semibold text-rsl-navy">{h.filename}</span>
                <span>{new Date(h.uploaded_at).toLocaleString()}</span>
                <span>{h.uploaded_by_email ?? 'unknown user'}</span>
                <span className="text-pass">{h.rows_applied} applied</span>
                {h.rows_errored > 0 && <span className="text-rsl-red">{h.rows_errored} errors</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
