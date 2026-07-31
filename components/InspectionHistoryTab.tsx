'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { parseLocalDate } from '@/lib/inspection-schedule';

// Bible Section 8.6 — Inspection History + Delete (God Mode).
// There was previously no browsable list of past inspections anywhere in
// the app for either type — Clear & Restart only resets the *current*
// period in place. This tab adds that browsing view, plus a delete action
// scoped to god_mode that permanently removes an inspection: its saved
// answers, its uploaded photos, and the inspection row itself.
//
// Delete mirrors the existing Clear & Restart logic in Inspector.tsx /
// HealthInspector.tsx (same storage bucket, same nested photo-path
// pattern) rather than only relying on the inspection_items /
// health_inspection_items ON DELETE CASCADE — explicit deletes first,
// same as Clear & Restart already does, so behaviour stays consistent
// even if the cascade assumption is ever wrong.
//
// Per Ben's decision: any status (draft / in_progress / complete) can be
// deleted, and the confirmation is a plain window.confirm() naming the
// site and period — matching Clear & Restart's style, not a type-to-confirm.

type InspectionType = 'monthly' | 'sohc';
type Status = 'draft' | 'in_progress' | 'complete' | string;

interface SiteRow {
  id: string;
  name: string;
}

interface UserRow {
  id: string;
  email: string;
}

interface MonthlyInspectionRow {
  id: string;
  site_id: string;
  inspector_id: string;
  period_month: string; // date, e.g. '2026-07-01' — represents July 2026
  status: Status;
  completed_at: string | null;
  created_at: string;
}

interface HealthInspectionRow {
  id: string;
  site_id: string;
  inspector_id: string;
  year: number;
  status: Status;
  completed_at: string | null;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function InspectionHistoryTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [role, setRole] = useState<string | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const [type, setType] = useState<InspectionType>('monthly');
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');

  const [monthlyRows, setMonthlyRows] = useState<MonthlyInspectionRow[]>([]);
  const [healthRows, setHealthRows] = useState<HealthInspectionRow[]>([]);
  const [inspectors, setInspectors] = useState<Record<string, string>>({});

  const [loadingRows, setLoadingRows] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Who's logged in? Delete is god_mode-only; everyone else can still
  // browse the history read-only.
  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setRoleLoading(false);
        return;
      }
      const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
      setRole(profile?.role ?? 'inspector');
      setRoleLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('sites').select('id, name').order('name');
      if (error) {
        setLoadError(error.message);
      } else {
        setSites(data ?? []);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setMonthlyRows([]);
      setHealthRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingRows(true);
      setLoadError(null);
      setDeleteError(null);

      if (type === 'monthly') {
        const { data, error } = await supabase
          .from('inspections')
          .select('id, site_id, inspector_id, period_month, status, completed_at, created_at')
          .eq('site_id', selectedSiteId)
          .order('period_month', { ascending: false });

        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          setLoadingRows(false);
          return;
        }
        setMonthlyRows(data ?? []);
        await loadInspectorNames((data ?? []).map((r) => r.inspector_id));
      } else {
        const { data, error } = await supabase
          .from('health_inspections')
          .select('id, site_id, inspector_id, year, status, completed_at')
          .eq('site_id', selectedSiteId)
          .order('year', { ascending: false });

        if (cancelled) return;
        if (error) {
          setLoadError(error.message);
          setLoadingRows(false);
          return;
        }
        setHealthRows(data ?? []);
        await loadInspectorNames((data ?? []).map((r) => r.inspector_id));
      }

      if (!cancelled) setLoadingRows(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId, type]);

  async function loadInspectorNames(ids: string[]) {
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    const missing = uniqueIds.filter((id) => !inspectors[id]);
    if (missing.length === 0) return;

    const { data } = await supabase.from('users').select('id, email').in('id', missing);
    if (!data) return;
    setInspectors((prev) => {
      const next = { ...prev };
      (data as UserRow[]).forEach((u) => {
        next[u.id] = u.email;
      });
      return next;
    });
  }

  function periodLabel(row: MonthlyInspectionRow | HealthInspectionRow): string {
    if ('period_month' in row) {
      const d = parseLocalDate(row.period_month);
      return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    }
    return `${row.year} (annual)`;
  }

  async function deleteInspection(row: MonthlyInspectionRow | HealthInspectionRow) {
    const siteName = sites.find((s) => s.id === selectedSiteId)?.name ?? 'this site';
    const label = periodLabel(row);

    if (
      !window.confirm(
        `Permanently delete the ${type === 'monthly' ? 'Monthly Inspect' : 'SOHC'} inspection for ${siteName} — ${label}? ` +
          `This deletes every saved answer and photo for this period. This cannot be undone.`
      )
    ) {
      return;
    }

    setDeletingId(row.id);
    setDeleteError(null);

    try {
      const photoPrefix = type === 'monthly' ? row.id : `health/${row.id}`;

      const { data: photoFolders } = await supabase.storage.from('inspection-photos').list(photoPrefix);
      if (photoFolders && photoFolders.length > 0) {
        const nested = await Promise.all(
          photoFolders.map((f) => supabase.storage.from('inspection-photos').list(`${photoPrefix}/${f.name}`))
        );
        const paths = nested.flatMap((res, i) =>
          (res.data ?? []).map((file) => `${photoPrefix}/${photoFolders[i].name}/${file.name}`)
        );
        if (paths.length > 0) {
          const { error: removeErr } = await supabase.storage.from('inspection-photos').remove(paths);
          if (removeErr) throw removeErr;
        }
      }

      if (type === 'monthly') {
        const { error: itemsErr } = await supabase.from('inspection_items').delete().eq('inspection_id', row.id);
        if (itemsErr) throw itemsErr;
        const { error: parentErr } = await supabase.from('inspections').delete().eq('id', row.id);
        if (parentErr) throw parentErr;
        setMonthlyRows((prev) => prev.filter((r) => r.id !== row.id));
      } else {
        const { error: itemsErr } = await supabase
          .from('health_inspection_items')
          .delete()
          .eq('health_inspection_id', row.id);
        if (itemsErr) throw itemsErr;
        const { error: parentErr } = await supabase.from('health_inspections').delete().eq('id', row.id);
        if (parentErr) throw parentErr;
        setHealthRows((prev) => prev.filter((r) => r.id !== row.id));
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  }

  const rows = type === 'monthly' ? monthlyRows : healthRows;
  const canDelete = role === 'god_mode';

  return (
    <div className="space-y-4">
      <p className="text-sm text-rsl-navy/60">
        Browse past inspections for either type. Deleting is permanent — it removes the inspection, every saved
        answer, and every uploaded photo for that period.
        {!roleLoading && !canDelete && (
          <span className="text-rsl-navy/40"> Delete is restricted to God Mode accounts.</span>
        )}
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-rsl-navy/15 overflow-hidden">
          {(
            [
              ['monthly', 'Monthly Inspect'],
              ['sohc', 'SOHC'],
            ] as [InspectionType, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setType(id)}
              className={`text-sm font-semibold px-3 py-2 transition-colors ${
                type === id ? 'bg-rsl-navy text-white' : 'bg-white text-rsl-navy/60 hover:text-rsl-navy'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

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
      </div>

      {loadError && (
        <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red">
          Couldn't load: {loadError}
        </div>
      )}
      {deleteError && (
        <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red">
          Delete failed: {deleteError}
        </div>
      )}

      {!selectedSiteId && <p className="text-sm text-rsl-navy/40">Pick a site to view its inspection history.</p>}

      {selectedSiteId && loadingRows && <p className="text-sm text-rsl-navy/50">Loading…</p>}

      {selectedSiteId && !loadingRows && (
        <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
              <tr>
                <th className="font-semibold px-4 py-2.5">Period</th>
                <th className="font-semibold px-4 py-2.5">Status</th>
                <th className="font-semibold px-4 py-2.5">Inspector</th>
                <th className="font-semibold px-4 py-2.5">Completed</th>
                <th className="font-semibold px-4 py-2.5 w-24">Delete</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-rsl-navy/5">
                  <td className="px-4 py-2 text-rsl-navy whitespace-nowrap">{periodLabel(row)}</td>
                  <td className="px-4 py-2">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-2 text-rsl-navy/70">{inspectors[row.inspector_id] ?? '—'}</td>
                  <td className="px-4 py-2 text-rsl-navy/70 whitespace-nowrap">
                    {row.completed_at ? new Date(row.completed_at).toLocaleDateString('en-AU') : '—'}
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => deleteInspection(row)}
                      disabled={!canDelete || deletingId === row.id}
                      title={canDelete ? undefined : 'God Mode only'}
                      className="text-xs font-semibold text-rsl-red border border-rsl-red/30 rounded-lg px-2.5 py-1.5 hover:bg-rsl-red/5 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      {deletingId === row.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-rsl-navy/40 text-sm">
                    No {type === 'monthly' ? 'Monthly Inspect' : 'SOHC'} inspections found for this site.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const styles: Record<string, string> = {
    draft: 'bg-rsl-navy/5 text-rsl-navy/50 border-rsl-navy/15',
    in_progress: 'bg-rsl-gold/10 text-rsl-gold border-rsl-gold/30',
    complete: 'bg-pass/10 text-pass border-pass/30',
  };
  const label: Record<string, string> = {
    draft: 'Draft',
    in_progress: 'In progress',
    complete: 'Complete',
  };
  const style = styles[status] ?? 'bg-rsl-navy/5 text-rsl-navy/50 border-rsl-navy/15';
  return (
    <span className={`text-xs font-semibold border rounded-full px-2.5 py-1 ${style}`}>
      {label[status] ?? status}
    </span>
  );
}
