'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { HealthCondition, LifeExpectancyBand } from '@/lib/health';

// Bible Section 8.5 — Asset Lifecycle view. Reads straight from
// v_asset_lifecycle_flags, which already does the hard part: every asset
// currently rated Poor/Critical, or with 0–2 years of life left, joined
// across health_inspection_items -> health_items -> health_categories ->
// health_inspections -> sites, restricted to each site's latest completed
// year. This screen just filters (site, category) and orders by severity.
//
// Cost figures (replacement_cost, cost_confidence) now flow through from
// the view too, entered separately in Admin > Asset Costs. Estimated and
// Quoted totals are kept visually separate rather than blended into one
// number — a budget figure built from a mix of guesses and real quotes,
// summed as if equally reliable, is misleading for actual planning.

interface FlagRow {
  site_id: string;
  site_name: string;
  category_name: string;
  item_name: string;
  condition: HealthCondition;
  life_expectancy: LifeExpectancyBand;
  comment: string | null;
  replacement_cost: number | null;
  cost_confidence: 'estimated' | 'quoted' | null;
}

const CONDITION_LABEL: Record<HealthCondition, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  critical: 'Critical',
};

const CONDITION_COLOR: Record<HealthCondition, string> = {
  good: '#2F8F4E',
  fair: '#E8A020',
  poor: '#E8720A',
  critical: '#C01820',
};

const LIFE_LABEL: Record<LifeExpectancyBand, string> = {
  '0_2': '0–2 years',
  '3_5': '3–5 years',
  '6_10': '6–10 years',
  '10_plus': '10+ years',
  na: 'N/A',
};

interface ForecastRow {
  site_id: string;
  site_name: string;
  category_name: string;
  item_name: string;
  condition: HealthCondition;
  life_expectancy: LifeExpectancyBand;
  replacement_cost: number | null;
  cost_confidence: 'estimated' | 'quoted' | null;
}

// Life expectancy is captured as a band (0-2 / 3-5 / 6-10 / 10+ years),
// not an exact year, so a forecast can only bucket at that same
// resolution — it can't promise a specific financial year. These periods
// are the honest translation of what the SOHC data actually supports.
// N/A (life_expectancy = 'na') is excluded entirely — it means the item
// isn't a depreciating physical asset (e.g. a compliance checklist entry),
// so it has no meaningful "replacement" timeframe to forecast.
const FORECAST_PERIODS: { key: 'near' | 'medium' | 'long' | 'beyond'; label: string; band: LifeExpectancyBand }[] = [
  { key: 'near', label: 'This FY / next FY (0–2 yrs)', band: '0_2' },
  { key: 'medium', label: 'Medium-term (3–5 yrs)', band: '3_5' },
  { key: 'long', label: 'Long-term (6–10 yrs)', band: '6_10' },
  { key: 'beyond', label: 'Beyond 10 yrs', band: '10_plus' },
];

// Higher score = more urgent. Combines condition and remaining life so an
// asset that's still in fair condition but expected to fail within 2 years
// still surfaces near the top, not just the ones already Poor/Critical.
function severityScore(row: FlagRow): number {
  const conditionScore = { critical: 3, poor: 2, fair: 1, good: 0 }[row.condition];
  const lifeScore = row.life_expectancy === '0_2' ? 2 : 0;
  return conditionScore + lifeScore;
}

export default function AssetLifecycleTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [siteFilter, setSiteFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [viewMode, setViewMode] = useState<'flagged' | 'forecast'>('flagged');
  const [forecastRows, setForecastRows] = useState<ForecastRow[]>([]);
  const [forecastLoading, setForecastLoading] = useState(false);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [forecastLoaded, setForecastLoaded] = useState(false);
  // Stashed from the initial role-scoping lookup so the forecast query
  // (loaded lazily, only when the toggle is switched) doesn't need to
  // redo the auth/role lookup from scratch.
  const [allowedSiteIds, setAllowedSiteIds] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setNoAccess(false);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (!cancelled) {
          setError('Not signed in.');
          setLoading(false);
        }
        return;
      }

      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
      const role = profile?.role ?? 'inspector';

      // Same role-scoping as Monthly Inspect Insights — god_mode sees every
      // site, admin sees only sites in their user_site_access rows,
      // inspectors don't get an Insights view at all.
      let allowedSiteIds: string[] | null = null;
      if (role === 'admin') {
        const { data: access } = await supabase.from('user_site_access').select('site_id').eq('user_id', user.id);
        allowedSiteIds = (access ?? []).map((a) => a.site_id);
      } else if (role !== 'god_mode') {
        allowedSiteIds = [];
      }

      if (allowedSiteIds !== null && allowedSiteIds.length === 0) {
        if (!cancelled) {
          setNoAccess(true);
          setLoading(false);
        }
        return;
      }

      if (!cancelled) setAllowedSiteIds(allowedSiteIds);

      let query = supabase
        .from('v_asset_lifecycle_flags')
        .select(
          'site_id, site_name, category_name, item_name, condition, life_expectancy, comment, replacement_cost, cost_confidence'
        );
      if (allowedSiteIds !== null) query = query.in('site_id', allowedSiteIds);

      const { data, error: queryError } = await query;

      if (!cancelled) {
        if (queryError) {
          setError(`Could not load the Asset Lifecycle view: ${queryError.message}`);
        } else {
          setRows(data ?? []);
        }
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewMode !== 'forecast' || forecastLoaded || allowedSiteIds === undefined) return;
    let cancelled = false;

    async function loadForecast() {
      setForecastLoading(true);
      setForecastError(null);

      let query = supabase
        .from('v_asset_lifecycle_all')
        .select('site_id, site_name, category_name, item_name, condition, life_expectancy, replacement_cost, cost_confidence');
      if (allowedSiteIds !== null) query = query.in('site_id', allowedSiteIds as string[]);

      const { data, error: queryError } = await query;

      if (!cancelled) {
        if (queryError) {
          setForecastError(`Could not load the forecast view: ${queryError.message}`);
        } else {
          setForecastRows((data as ForecastRow[]) ?? []);
          setForecastLoaded(true);
        }
        setForecastLoading(false);
      }
    }

    loadForecast();
    return () => {
      cancelled = true;
    };
  }, [viewMode, forecastLoaded, allowedSiteIds, supabase]);

  const sites = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.site_id, r.site_name);
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const categories = useMemo(() => {
    return Array.from(new Set(rows.map((r) => r.category_name))).sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows
      .filter((r) => siteFilter === 'all' || r.site_id === siteFilter)
      .filter((r) => categoryFilter === 'all' || r.category_name === categoryFilter)
      .sort((a, b) => severityScore(b) - severityScore(a));
  }, [rows, siteFilter, categoryFilter]);

  // Quoted and Estimated kept as separate totals rather than one blended
  // number — see the file-header note on why. costedCount / rows.length
  // makes the coverage gap visible too, since a total built from a
  // minority of costed assets could otherwise look more complete than it
  // is.
  const costSummary = useMemo(() => {
    let quotedTotal = 0;
    let estimatedTotal = 0;
    let costedCount = 0;
    for (const r of filteredRows) {
      if (r.replacement_cost == null) continue;
      costedCount += 1;
      if (r.cost_confidence === 'quoted') quotedTotal += r.replacement_cost;
      else estimatedTotal += r.replacement_cost;
    }
    return { quotedTotal, estimatedTotal, costedCount };
  }, [filteredRows]);

  // Buckets every non-N/A asset (regardless of current condition — see the
  // v_asset_lifecycle_all note above) into its forecast period, keeping
  // Quoted and Estimated separate within each bucket for the same reason
  // as the flagged-view summary. Uses the same site filter as the flagged
  // view so switching between the two tabs stays consistent, but not the
  // category filter, since a forecast is naturally a portfolio/site-wide
  // figure rather than a single-category one.
  const forecastSiteScoped = useMemo(
    () => forecastRows.filter((r) => siteFilter === 'all' || r.site_id === siteFilter),
    [forecastRows, siteFilter]
  );

  const forecastBuckets = useMemo(() => {
    return FORECAST_PERIODS.map((period) => {
      const inBand = forecastSiteScoped.filter((r) => r.life_expectancy === period.band);
      let quotedTotal = 0;
      let estimatedTotal = 0;
      let costedCount = 0;
      for (const r of inBand) {
        if (r.replacement_cost == null) continue;
        costedCount += 1;
        if (r.cost_confidence === 'quoted') quotedTotal += r.replacement_cost;
        else estimatedTotal += r.replacement_cost;
      }
      return { ...period, assetCount: inBand.length, costedCount, quotedTotal, estimatedTotal };
    });
  }, [forecastSiteScoped]);

  const forecastNext5 = useMemo(() => {
    const relevant = forecastBuckets.filter((b) => b.key === 'near' || b.key === 'medium');
    return {
      quotedTotal: relevant.reduce((s, b) => s + b.quotedTotal, 0),
      estimatedTotal: relevant.reduce((s, b) => s + b.estimatedTotal, 0),
    };
  }, [forecastBuckets]);

  const forecastNext10 = useMemo(() => {
    const relevant = forecastBuckets.filter((b) => b.key !== 'beyond');
    return {
      quotedTotal: relevant.reduce((s, b) => s + b.quotedTotal, 0),
      estimatedTotal: relevant.reduce((s, b) => s + b.estimatedTotal, 0),
    };
  }, [forecastBuckets]);

  if (loading) {
    return <p className="text-sm text-rsl-navy/50 py-12 text-center">Loading asset lifecycle data…</p>;
  }
  if (error) {
    return <p className="text-sm text-rsl-red font-semibold py-12 text-center">{error}</p>;
  }
  if (noAccess) {
    return (
      <p className="text-sm text-rsl-navy/50 py-12 text-center">
        No sites are assigned to your account yet. Contact God Mode to get site access.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display font-bold text-rsl-navy">Asset Lifecycle</h2>
          <p className="text-sm text-rsl-navy/50">
            {viewMode === 'flagged'
              ? "Every SOHC asset rated Poor/Critical, or with 0–2 years of life left, from each site's latest completed inspection — worst first, with replacement cost where it's been entered."
              : "Every costed SOHC asset from each site's latest completed inspection, bucketed by remaining life — regardless of current condition."}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex rounded-lg border border-rsl-navy/15 overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setViewMode('flagged')}
              className={`px-3 py-2 ${viewMode === 'flagged' ? 'bg-rsl-navy text-white' : 'text-rsl-navy/60'}`}
            >
              Flagged assets
            </button>
            <button
              onClick={() => setViewMode('forecast')}
              className={`px-3 py-2 ${viewMode === 'forecast' ? 'bg-rsl-navy text-white' : 'text-rsl-navy/60'}`}
            >
              Budget forecast
            </button>
          </div>
          <select
            value={siteFilter}
            onChange={(e) => setSiteFilter(e.target.value)}
            className="text-sm border border-rsl-navy/15 rounded-lg px-3 py-2"
          >
            <option value="all">All sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {viewMode === 'flagged' && (
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="text-sm border border-rsl-navy/15 rounded-lg px-3 py-2"
            >
              <option value="all">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {viewMode === 'flagged' && (
        <>
      {rows.length === 0 && (
        <div className="rounded-xl bg-pass/5 border border-pass/20 p-4 text-sm text-rsl-navy/70">
          Nothing flagged right now — no completed SOHC inspection currently has an asset rated Poor/Critical
          or with 0–2 years of remaining life.
        </div>
      )}

      {filteredRows.length > 0 && (
        <div className="rounded-xl bg-rsl-navy/5 border border-rsl-navy/10 p-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span className="text-rsl-navy/60">
            <span className="font-semibold text-rsl-navy">{costSummary.costedCount}</span> of{' '}
            {filteredRows.length} flagged assets have a cost entered
          </span>
          {costSummary.quotedTotal > 0 && (
            <span className="text-rsl-navy/60">
              Quoted:{' '}
              <span className="font-semibold text-rsl-navy">
                ${costSummary.quotedTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
          {costSummary.estimatedTotal > 0 && (
            <span className="text-rsl-navy/60">
              Estimated:{' '}
              <span className="font-semibold text-rsl-navy">
                ${costSummary.estimatedTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
          {costSummary.costedCount < filteredRows.length && (
            <span className="text-rsl-navy/40">
              ({filteredRows.length - costSummary.costedCount} not yet costed — figures above understate the
              real total)
            </span>
          )}
        </div>
      )}

      {rows.length > 0 && filteredRows.length === 0 && (
        <p className="text-sm text-rsl-navy/40 py-6 text-center">No flagged assets match that filter.</p>
      )}

      {filteredRows.length > 0 && (
        <div className="space-y-3">
          {filteredRows.map((row, index) => {
            const nearingEndOfLife = row.life_expectancy === '0_2';
            const conditionAttention = row.condition === 'poor' || row.condition === 'critical';
            return (
              <div key={`${row.site_id}-${row.category_name}-${row.item_name}-${index}`} className="rounded-xl border border-rsl-navy/10 p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold text-sm text-rsl-navy">{row.item_name}</p>
                    <p className="text-xs text-rsl-navy/50">
                      {row.site_name} · {row.category_name}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap justify-end items-start">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-white"
                      style={{ backgroundColor: CONDITION_COLOR[row.condition] }}
                    >
                      {CONDITION_LABEL[row.condition]}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-rsl-navy/60 bg-rsl-navy/5">
                      {LIFE_LABEL[row.life_expectancy]} left
                    </span>
                    {row.replacement_cost != null ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-rsl-navy/70 bg-rsl-navy/5 border border-rsl-navy/10">
                        ${row.replacement_cost.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                        {row.cost_confidence ? ` · ${row.cost_confidence}` : ''}
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-rsl-navy/30 bg-rsl-navy/5">
                        No cost entered
                      </span>
                    )}
                    <button
                      onClick={() =>
                        router.push(
                          `/admin?tab=costs&siteId=${row.site_id}&itemName=${encodeURIComponent(row.item_name)}`
                        )
                      }
                      className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-rsl-blue border border-rsl-blue/30 hover:bg-rsl-blue/5"
                    >
                      Edit cost →
                    </button>
                  </div>
                </div>

                {row.comment && <p className="text-sm text-rsl-navy/70 mt-2">{row.comment}</p>}

                {(nearingEndOfLife || conditionAttention) && (
                  <div className="mt-3 flex flex-col gap-1.5">
                    {nearingEndOfLife && (
                      <p className="text-xs font-semibold text-rsl-gold bg-rsl-gold/10 rounded-lg px-2.5 py-1.5">
                        Budget forecast — replacement likely needed within the next 2 years.
                      </p>
                    )}
                    {conditionAttention && (
                      <p className="text-xs font-semibold text-rsl-red bg-rsl-red/5 rounded-lg px-2.5 py-1.5">
                        Condition attention required at next inspection.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {viewMode === 'forecast' && (
        <div className="space-y-4">
          {forecastLoading && (
            <p className="text-sm text-rsl-navy/50 py-12 text-center">Loading forecast data…</p>
          )}

          {forecastError && (
            <p className="text-sm text-rsl-red font-semibold py-6 text-center">{forecastError}</p>
          )}

          {!forecastLoading && !forecastError && forecastLoaded && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ForecastRollupCard label="Next 5 years" totals={forecastNext5} />
                <ForecastRollupCard label="Next 10 years" totals={forecastNext10} />
              </div>

              <div className="space-y-3">
                {forecastBuckets.map((bucket) => (
                  <div key={bucket.key} className="rounded-xl border border-rsl-navy/10 p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <p className="font-semibold text-sm text-rsl-navy">{bucket.label}</p>
                      <p className="text-xs text-rsl-navy/40">
                        {bucket.costedCount} of {bucket.assetCount} assets costed
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm">
                      {bucket.quotedTotal > 0 && (
                        <span className="text-rsl-navy/60">
                          Quoted:{' '}
                          <span className="font-semibold text-rsl-navy">
                            ${bucket.quotedTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                          </span>
                        </span>
                      )}
                      {bucket.estimatedTotal > 0 && (
                        <span className="text-rsl-navy/60">
                          Estimated:{' '}
                          <span className="font-semibold text-rsl-navy">
                            ${bucket.estimatedTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
                          </span>
                        </span>
                      )}
                      {bucket.quotedTotal === 0 && bucket.estimatedTotal === 0 && (
                        <span className="text-rsl-navy/30">No costed assets in this period yet.</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-rsl-navy/40">
                Life expectancy is captured in bands, not exact years, so these periods are the finest
                resolution the SOHC data supports — not a specific financial year.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ForecastRollupCard({
  label,
  totals,
}: {
  label: string;
  totals: { quotedTotal: number; estimatedTotal: number };
}) {
  const hasAny = totals.quotedTotal > 0 || totals.estimatedTotal > 0;
  return (
    <div className="rounded-xl bg-rsl-navy/5 border border-rsl-navy/10 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-rsl-navy/50">{label}</p>
      {!hasAny && <p className="text-sm text-rsl-navy/30 mt-1">No costed assets in this range yet.</p>}
      {hasAny && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
          {totals.quotedTotal > 0 && (
            <span className="text-sm text-rsl-navy/60">
              Quoted:{' '}
              <span className="font-semibold text-rsl-navy text-base">
                ${totals.quotedTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
          {totals.estimatedTotal > 0 && (
            <span className="text-sm text-rsl-navy/60">
              Estimated:{' '}
              <span className="font-semibold text-rsl-navy text-base">
                ${totals.estimatedTotal.toLocaleString('en-AU', { maximumFractionDigits: 0 })}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
