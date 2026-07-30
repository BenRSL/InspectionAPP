'use client';

import { useState } from 'react';
import InsightsTab from '@/components/InsightsTab';
import AssetLifecycleTab from '@/components/AssetLifecycleTab';
import ImportExportTab from '@/components/ImportExportTab';

// Bible Section 8.5 — expands the old single Insights tab into a menu.
// Monthly Inspect Insights (InsightsTab) is unchanged; Asset Lifecycle and
// Import/Export are new. Import/Export currently ships the cost template
// download (Bible 8.4 Stage 3) only — the upload/match flow (Stage 4) is a
// separate follow-up piece of work. Calendar lives as its own top-level
// admin tab (app/admin/page.tsx), not nested here — it schedules real
// inspections, not just a read-only stat.
export default function StatsInsightsTab() {
  const [view, setView] = useState<'monthly' | 'lifecycle' | 'importExport'>('monthly');

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-rsl-navy/5 rounded-full p-1 w-fit">
        <button
          onClick={() => setView('monthly')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
            view === 'monthly' ? 'bg-rsl-blue text-white' : 'text-rsl-navy/60'
          }`}
        >
          Monthly Inspect
        </button>
        <button
          onClick={() => setView('lifecycle')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
            view === 'lifecycle' ? 'bg-rsl-blue text-white' : 'text-rsl-navy/60'
          }`}
        >
          Asset Lifecycle
        </button>
        <button
          onClick={() => setView('importExport')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
            view === 'importExport' ? 'bg-rsl-blue text-white' : 'text-rsl-navy/60'
          }`}
        >
          Import/Export
        </button>
      </div>

      {view === 'monthly' && <InsightsTab />}
      {view === 'lifecycle' && <AssetLifecycleTab />}
      {view === 'importExport' && <ImportExportTab />}
    </div>
  );
}
