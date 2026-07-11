'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

type Category = 'cleaning' | 'maintenance';

interface SiteRow {
  id: string;
  name: string;
  slug: string;
}
interface AreaRow {
  id: string;
  site_id: string;
  area_name: string;
}
interface ItemRow {
  id: string;
  area_id: string;
  category: Category;
  consecutive_fail_count: number;
  item_name: string;
}
interface InspectionRow {
  id: string;
  site_id: string;
  period_month: string;
  status: string;
}
interface ResultRow {
  checklist_item_id: string;
  inspection_id: string;
  result: 'pass' | 'fail';
  created_at: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function InsightsTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState(false);
  const [siteFilter, setSiteFilter] = useState<string>('all');

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [areas, setAreas] = useState<AreaRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [inspections, setInspections] = useState<InspectionRow[]>([]);
  const [results, setResults] = useState<ResultRow[]>([]);

  // ---- Load real data, scoped by role: god_mode sees every site, admin sees
  // only sites in their user_site_access rows ----
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

      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      const role = profile?.role ?? 'inspector';

      let allowedSiteIds: string[] | null = null; // null = no restriction (god_mode)
      if (role === 'admin') {
        const { data: access } = await supabase.from('user_site_access').select('site_id').eq('user_id', user.id);
        allowedSiteIds = (access ?? []).map((a) => a.site_id);
      } else if (role !== 'god_mode') {
        allowedSiteIds = []; // inspectors don't get an Insights view
      }

      if (allowedSiteIds !== null && allowedSiteIds.length === 0) {
        if (!cancelled) {
          setNoAccess(true);
          setLoading(false);
        }
        return;
      }

      let siteQuery = supabase.from('sites').select('id, name, slug').order('name');
      if (allowedSiteIds !== null) siteQuery = siteQuery.in('id', allowedSiteIds);

      const { data: siteRows, error: siteErr } = await siteQuery;
      if (siteErr || !siteRows) {
        if (!cancelled) {
          setError('Could not load sites.');
          setLoading(false);
        }
        return;
      }

      const siteIds = siteRows.map((s) => s.id);

      const { data: areaRows } = siteIds.length
        ? await supabase.from('floor_areas').select('id, site_id, area_name').in('site_id', siteIds)
        : { data: [] as AreaRow[] };

      const areaIds = (areaRows ?? []).map((a) => a.id);

      const { data: itemRows } = areaIds.length
        ? await supabase
            .from('checklist_items')
            .select('id, area_id, category, consecutive_fail_count, item_name')
            .in('area_id', areaIds)
        : { data: [] as ItemRow[] };

      const { data: inspectionRows } = siteIds.length
        ? await supabase.from('inspections').select('id, site_id, period_month, status').in('site_id', siteIds)
        : { data: [] as InspectionRow[] };

      const inspectionIds = (inspectionRows ?? []).map((i) => i.id);

      const { data: resultRows } = inspectionIds.length
        ? await supabase
            .from('inspection_items')
            .select('checklist_item_id, inspection_id, result, created_at')
            .in('inspection_id', inspectionIds)
        : { data: [] as ResultRow[] };

      if (!cancelled) {
        setSites(siteRows ?? []);
        setAreas(areaRows ?? []);
        setItems(itemRows ?? []);
        setInspections(inspectionRows ?? []);
        setResults(resultRows ?? []);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const inspectionById = useMemo(() => new Map(inspections.map((i) => [i.id, i])), [inspections]);
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'Unknown site';

  const filteredResults = useMemo(() => {
    if (siteFilter === 'all') return results;
    return results.filter((r) => inspectionById.get(r.inspection_id)?.site_id === siteFilter);
  }, [results, siteFilter, inspectionById]);

  // 1. Fail rate over time — grouped by period_month, split Cleaning vs Maintenance
  const failRateOverTime = useMemo(() => {
    const buckets = new Map<
      string,
      { month: string; cleaningFail: number; cleaningTotal: number; maintFail: number; maintTotal: number }
    >();
    for (const r of filteredResults) {
      const insp = inspectionById.get(r.inspection_id);
      const item = itemById.get(r.checklist_item_id);
      if (!insp || !item) continue;
      const month = insp.period_month.slice(0, 7);
      if (!buckets.has(month)) {
        buckets.set(month, { month, cleaningFail: 0, cleaningTotal: 0, maintFail: 0, maintTotal: 0 });
      }
      const b = buckets.get(month)!;
      if (item.category === 'cleaning') {
        b.cleaningTotal += 1;
        if (r.result === 'fail') b.cleaningFail += 1;
      } else {
        b.maintTotal += 1;
        if (r.result === 'fail') b.maintFail += 1;
      }
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((b) => ({
        month: b.month,
        'Cleaning fail %': b.cleaningTotal ? Math.round((b.cleaningFail / b.cleaningTotal) * 100) : 0,
        'Maintenance fail %': b.maintTotal ? Math.round((b.maintFail / b.maintTotal) * 100) : 0,
      }));
  }, [filteredResults, inspectionById, itemById]);

  // 2. Site comparison — this month vs last month fail rate, worst first
  const siteComparison = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

    const perSite = new Map<string, { thisFail: number; thisTotal: number; lastFail: number; lastTotal: number }>();
    for (const s of sites) perSite.set(s.id, { thisFail: 0, thisTotal: 0, lastFail: 0, lastTotal: 0 });

    for (const r of results) {
      const insp = inspectionById.get(r.inspection_id);
      if (!insp) continue;
      const month = insp.period_month.slice(0, 7);
      const bucket = perSite.get(insp.site_id);
      if (!bucket) continue;
      if (month === thisMonth) {
        bucket.thisTotal += 1;
        if (r.result === 'fail') bucket.thisFail += 1;
      } else if (month === lastMonth) {
        bucket.lastTotal += 1;
        if (r.result === 'fail') bucket.lastFail += 1;
      }
    }

    return sites
      .map((s) => {
        const b = perSite.get(s.id)!;
        const thisRate = b.thisTotal ? Math.round((b.thisFail / b.thisTotal) * 100) : null;
        const lastRate = b.lastTotal ? Math.round((b.lastFail / b.lastTotal) * 100) : null;
        return { site: s.name, thisRate, lastRate };
      })
      .sort((a, b) => (b.thisRate ?? -1) - (a.thisRate ?? -1));
  }, [results, sites, inspectionById]);

  // 3. Recurring issues — items currently on a 2+ fail streak
  const recurringIssues = useMemo(() => {
    return items
      .filter((it) => it.consecutive_fail_count >= 2)
      .map((it) => {
        const area = areaById.get(it.area_id);
        return {
          site: area ? siteName(area.site_id) : 'Unknown site',
          area: area?.area_name ?? 'Unknown area',
          item: it.item_name,
          category: it.category,
          streak: it.consecutive_fail_count,
        };
      })
      .sort((a, b) => b.streak - a.streak);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, areaById, sites]);

  // 4. Seasonal pattern — fail rate by calendar month, years folded together
  const seasonal = useMemo(() => {
    const buckets = new Map<number, { fail: number; total: number }>();
    for (const r of filteredResults) {
      const insp = inspectionById.get(r.inspection_id);
      if (!insp) continue;
      const monthIdx = parseInt(insp.period_month.slice(5, 7), 10) - 1;
      if (!buckets.has(monthIdx)) buckets.set(monthIdx, { fail: 0, total: 0 });
      const b = buckets.get(monthIdx)!;
      b.total += 1;
      if (r.result === 'fail') b.fail += 1;
    }
    return MONTH_NAMES.map((name, idx) => {
      const b = buckets.get(idx);
      return { month: name, 'Fail %': b && b.total ? Math.round((b.fail / b.total) * 100) : 0 };
    });
  }, [filteredResults, inspectionById]);

  const hasAnyData = results.length > 0;

  if (loading) {
    return <p className="text-sm text-rsl-navy/50 py-12 text-center">Loading insights…</p>;
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
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display font-bold text-rsl-navy">Monthly Inspect Insights</h2>
          <p className="text-sm text-rsl-navy/50">Fail-rate trends, site comparison, and recurring issues.</p>
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
      </div>

      {!hasAnyData && (
        <div className="rounded-xl bg-rsl-gold/10 border border-rsl-gold/30 p-4 text-sm text-rsl-navy/70">
          No inspection data yet — these charts will populate as Monthly Inspects are completed.
        </div>
      )}

      {/* 1. Fail rate over time */}
      <div>
        <h3 className="font-semibold text-rsl-navy mb-1">Fail Rate Over Time</h3>
        <p className="text-xs text-rsl-navy/40 mb-3">Percentage of items marked Fail, by month.</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={failRateOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A2E" strokeOpacity={0.08} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="Cleaning fail %" stroke="#C01820" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="Maintenance fail %" stroke="#1A3A6B" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 2. Site comparison */}
      <div>
        <h3 className="font-semibold text-rsl-navy mb-1">Site Comparison</h3>
        <p className="text-xs text-rsl-navy/40 mb-3">This month's fail rate vs last month, worst first.</p>
        <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
              <tr>
                <th className="font-semibold px-4 py-3">Site</th>
                <th className="font-semibold px-4 py-3">This month</th>
                <th className="font-semibold px-4 py-3">Last month</th>
                <th className="font-semibold px-4 py-3">Trend</th>
              </tr>
            </thead>
            <tbody>
              {siteComparison.map((row) => {
                const trend = row.thisRate !== null && row.lastRate !== null ? row.thisRate - row.lastRate : null;
                return (
                  <tr key={row.site} className="border-t border-rsl-navy/5">
                    <td className="px-4 py-3 font-medium text-rsl-navy">{row.site}</td>
                    <td className="px-4 py-3 text-rsl-navy/70">{row.thisRate !== null ? `${row.thisRate}%` : '—'}</td>
                    <td className="px-4 py-3 text-rsl-navy/70">{row.lastRate !== null ? `${row.lastRate}%` : '—'}</td>
                    <td className="px-4 py-3">
                      {trend === null ? (
                        <span className="text-rsl-navy/30">—</span>
                      ) : trend > 0 ? (
                        <span className="text-rsl-red font-semibold">▲ {trend}%</span>
                      ) : trend < 0 ? (
                        <span className="text-pass font-semibold">▼ {Math.abs(trend)}%</span>
                      ) : (
                        <span className="text-rsl-navy/40">— 0%</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 3. Recurring issues */}
      <div>
        <h3 className="font-semibold text-rsl-navy mb-1">Recurring Issues</h3>
        <p className="text-xs text-rsl-navy/40 mb-3">Items that have failed 2 or more inspections in a row.</p>
        {recurringIssues.length === 0 ? (
          <p className="text-sm text-rsl-navy/40 py-6 text-center border border-dashed border-rsl-navy/15 rounded-xl">
            No recurring issues right now.
          </p>
        ) : (
          <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
                <tr>
                  <th className="font-semibold px-4 py-3">Site</th>
                  <th className="font-semibold px-4 py-3">Area</th>
                  <th className="font-semibold px-4 py-3">Item</th>
                  <th className="font-semibold px-4 py-3">Category</th>
                  <th className="font-semibold px-4 py-3 text-right">Consecutive fails</th>
                </tr>
              </thead>
              <tbody>
                {recurringIssues.map((row, i) => (
                  <tr key={i} className="border-t border-rsl-navy/5">
                    <td className="px-4 py-3 text-rsl-navy/70">{row.site}</td>
                    <td className="px-4 py-3 text-rsl-navy/70">{row.area}</td>
                    <td className="px-4 py-3 font-medium text-rsl-navy">{row.item}</td>
                    <td className="px-4 py-3 text-rsl-navy/60 capitalize">{row.category}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-rsl-red/10 text-rsl-red">
                        {row.streak}×
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Seasonal pattern */}
      <div>
        <h3 className="font-semibold text-rsl-navy mb-1">Seasonal Pattern</h3>
        <p className="text-xs text-rsl-navy/40 mb-3">
          Fail rate by calendar month, combined across all years of data on file. With only a short history so
          far, expect this to look sparse until multiple years of Monthly Inspects accumulate.
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={seasonal}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1A1A2E" strokeOpacity={0.08} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="Fail %" stroke="#E8A020" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
