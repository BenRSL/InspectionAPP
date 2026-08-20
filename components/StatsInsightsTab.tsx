'use client';

import InsightsTab from '@/components/InsightsTab';

// Previously a menu of three (Monthly Inspect / Asset Lifecycle /
// Import-Export) — the latter two moved to their own consolidated tab
// (AssetCostsLifecycleTab, alongside Asset Costs) since they're financial/
// asset-condition tools, not monthly-inspection stats, and having them
// three clicks deep here rather than living with Asset Costs made no
// sense. This now just renders Monthly Inspect Insights directly — a
// single-option pill toggle would have been pointless clutter.
export default function StatsInsightsTab() {
  return <InsightsTab />;
}
