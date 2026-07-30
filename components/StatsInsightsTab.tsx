'use client';

import { useState } from 'react';
import InsightsTab from '@/components/InsightsTab';
import AssetLifecycleTab from '@/components/AssetLifecycleTab';
import ImportExportTab from '@/components/ImportExportTab';
import CalendarTab from '@/components/CalendarTab';

// Bible Section 8.5 — expands the old single Insights tab into a menu.
// Monthly Inspect Insights (InsightsTab) is unchanged; Asset Lifecycle and
// Import/Export are new. Import/Export currently ships the cost template
// download (Bible 8.4 Stage 3) only — the upload/match flow (Stage 4) is a
// separate follow-up piece of work. Calendar is the newest addition — past
// completions, projected due dates, and admin/god_mode scheduling.
export default function StatsInsightsTab() {
  const [view, setView] = useState<'monthly' | 'lifecycle' | 'importExport' | 'calendar'>('monthly');

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
        <button
          onClick={() => setView('calendar')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
            view === 'calendar' ? 'bg-rsl-blue text-white' : 'text-rsl-navy/60'
          }`}
        >
          Calendar
        </button>
      </div>

      {view === 'monthly' && <InsightsTab />}
      {view === 'lifecycle' && <AssetLifecycleTab />}
      {view === 'importExport' && <ImportExportTab />}
      {view === 'calendar' && <CalendarTab />}
    </div>
  );
}
