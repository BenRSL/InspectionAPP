'use client';

import { useState } from 'react';
import InsightsTab from '@/components/InsightsTab';
import AssetLifecycleTab from '@/components/AssetLifecycleTab';

// Bible Section 8.5 — expands the old single Insights tab into a menu.
// Monthly Inspect Insights (InsightsTab) is completely unchanged; Asset
// Lifecycle is new. A third area, Import/Export tools, isn't built yet —
// deliberately deferred until the Excel cost-import work (Bible 8.4 Stages
// 3–4) is closer, per Ben's direction to leave cost data out for now.
export default function StatsInsightsTab() {
  const [view, setView] = useState<'monthly' | 'lifecycle'>('monthly');

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
      </div>

      {view === 'monthly' && <InsightsTab />}
      {view === 'lifecycle' && <AssetLifecycleTab />}
    </div>
  );
}
