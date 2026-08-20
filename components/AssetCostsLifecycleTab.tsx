'use client';

import { useState } from 'react';
import AssetCostsTab from '@/components/AssetCostsTab';
import AssetLifecycleTab from '@/components/AssetLifecycleTab';
import ImportExportTab from '@/components/ImportExportTab';

// Consolidates the three financial/asset-condition screens that were
// previously split across two unrelated top-level admin tabs — Asset
// Costs on its own, Asset Lifecycle and Import/Export nested three clicks
// away inside Stats & Insights. No data or URL contract changes: this
// still renders under the same 'costs' tab id in app/admin/page.tsx, so
// the existing "Edit cost →" deep link from Asset Lifecycle
// (/admin?tab=costs&siteId=...&itemName=...) keeps working exactly as
// before, just landing on this wrapper instead of AssetCostsTab directly.
export default function AssetCostsLifecycleTab({
  initialSiteId,
  highlightItemName,
  initialView = 'costs',
}: {
  initialSiteId?: string;
  highlightItemName?: string;
  initialView?: 'costs' | 'lifecycle' | 'importExport';
} = {}) {
  const [view, setView] = useState<'costs' | 'lifecycle' | 'importExport'>(initialView);

  return (
    <div className="space-y-5">
      <div className="flex gap-1 bg-rsl-navy/5 rounded-full p-1 w-fit">
        <button
          onClick={() => setView('costs')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
            view === 'costs' ? 'bg-rsl-blue text-white' : 'text-rsl-navy/60'
          }`}
        >
          Asset Costs
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

      {view === 'costs' && <AssetCostsTab initialSiteId={initialSiteId} highlightItemName={highlightItemName} />}
      {view === 'lifecycle' && <AssetLifecycleTab />}
      {view === 'importExport' && <ImportExportTab />}
    </div>
  );
}
