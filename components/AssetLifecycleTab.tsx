'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { HealthCondition, LifeExpectancyBand } from '@/lib/health';

// Bible Section 8.5 — Asset Lifecycle view. Reads straight from
// v_asset_lifecycle_flags, which already does the hard part: every asset
// currently rated Poor/Critical, or with 0–2 years of life left, joined
// across health_inspection_items -> health_items -> health_categories ->
// health_inspections -> sites, restricted to each site's latest completed
// year. This screen just filters (site, category) and orders by severity.
//
// No dollar figures here on purpose — cost tracking is deferred pending
// either the Excel import work (Bible 8.4 Stages 3–4) or a possible future
// Archibus integration, both out of scope for now. Instead, flagged assets
// get a plain-language budget-forecast reminder.

interface FlagRow {
  site_id: string;
  site_name: string;
  category_name: string;
  item_name: string;
  condition: HealthCondition;
  life_expectancy: LifeExpectancyBand;
  comment: string | null;
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

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);

  const [rows, setRows] = useState<FlagRow[]>([]);
  const [siteFilter, setSiteFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

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

      let query = supabase
        .from('v_asset_lifecycle_flags')
        .select('site_id, site_name, category_name, item_name, condition, life_expectancy, comment');
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
            Every SOHC asset rated Poor/Critical, or with 0–2 years of life left, from each site's latest
            completed inspection — worst first.
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      {rows.length === 0 && (
        <div className="rounded-xl bg-pass/5 border border-pass/20 p-4 text-sm text-rsl-navy/70">
          Nothing flagged right now — no completed SOHC inspection currently has an asset rated Poor/Critical
          or with 0–2 years of remaining life.
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
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-white"
                      style={{ backgroundColor: CONDITION_COLOR[row.condition] }}
                    >
                      {CONDITION_LABEL[row.condition]}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full px-2 py-0.5 text-rsl-navy/60 bg-rsl-navy/5">
                      {LIFE_LABEL[row.life_expectancy]} left
                    </span>
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
    </div>
  );
}
