'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

// Bible 8.5 (third Stats & Insights area) / 8.4 Stage 3 — these are the
// same feature. Ships the Excel cost template download first: every
// active SOHC asset for a site, with its current replacement_cost /
// cost_confidence, so Ben can bulk-edit in Excel instead of one row at a
// time in Admin > Asset Costs.
//
// Stage 4 (upload the edited file back, match rows to health_items by the
// Item ID column, and write the updates) is deliberately NOT built here —
// it needs real validation (bad confidence values, negative costs, rows
// matched to another site's items, deleted/renamed items) and is scoped
// as its own follow-up piece of work rather than bolted on to keep this
// change small and reviewable.

interface SiteRow {
  id: string;
  name: string;
}

export default function ImportExportTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [loadingSites, setLoadingSites] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

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

  if (loadingSites) return <p className="text-sm text-rsl-navy/50">Loading…</p>;
  if (loadError) {
    return (
      <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red">
        Couldn't load: {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-rsl-navy/10 p-5 space-y-3">
        <h3 className="text-sm font-bold text-rsl-navy">Download cost template</h3>
        <p className="text-sm text-rsl-navy/60">
          Exports every active SOHC asset for a site into a spreadsheet — including current replacement costs
          already entered in Admin &gt; Asset Costs — so you can bulk-edit in Excel instead of one row at a time.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={selectedSiteId}
            onChange={(e) => setSelectedSiteId(e.target.value)}
            className="text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 text-rsl-navy"
          >
            <option value="">Select a site…</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          <button
            onClick={downloadTemplate}
            disabled={!selectedSiteId || downloading}
            className="text-sm font-semibold bg-rsl-navy text-white rounded-lg px-4 py-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {downloading ? 'Generating…' : 'Download Excel Template'}
          </button>
        </div>

        {downloadError && <p className="text-sm text-rsl-red">{downloadError}</p>}
      </div>

      <div className="rounded-2xl border border-dashed border-rsl-navy/15 p-5 text-sm text-rsl-navy/50">
        <span className="font-semibold text-rsl-navy/70">Upload edited template — coming soon.</span> Re-uploading
        an edited template to bulk-update costs is the next piece of this feature. For now, edit costs individually
        in Admin &gt; Asset Costs, or use this download as a reference while entering them there.
      </div>
    </div>
  );
}
