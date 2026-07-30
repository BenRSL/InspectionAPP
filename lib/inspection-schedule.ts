import type { SupabaseClient } from '@supabase/supabase-js';

export type InspectionType = 'monthly' | 'sohc';

// Target cadence per inspection type, used only to compute a projected
// "next due" date and a "due soon" reminder window — never enforced, never
// shown as a failure. Monthly Inspect realistically happens more like
// every 3-6 months in practice; SOHC is explicitly annual. Both use the
// same 14-day "due soon" lead time.
const TARGET_INTERVAL_DAYS: Record<InspectionType, number> = {
  monthly: 90,
  sohc: 365,
};
export const DUE_SOON_LEAD_DAYS = 14;

export type LastCompleted = {
  siteId: string;
  inspectionType: InspectionType;
  completedAt: string | null; // ISO date, or null if never completed
};

export type ScheduledRow = {
  id: string;
  site_id: string;
  inspection_type: InspectionType;
  scheduled_date: string;
  assigned_to: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export async function fetchLastCompleted(
  supabase: SupabaseClient,
  siteIds: string[]
): Promise<LastCompleted[]> {
  const results: LastCompleted[] = [];

  const [monthlyRes, sohcRes] = await Promise.all([
    supabase
      .from('inspections')
      .select('site_id, completed_at')
      .in('site_id', siteIds)
      .eq('status', 'complete')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }),
    supabase
      .from('health_inspections')
      .select('site_id, completed_at')
      .in('site_id', siteIds)
      .eq('status', 'complete')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false }),
  ]);

  const seenMonthly = new Set<string>();
  for (const row of monthlyRes.data ?? []) {
    if (seenMonthly.has(row.site_id)) continue;
    seenMonthly.add(row.site_id);
    results.push({ siteId: row.site_id, inspectionType: 'monthly', completedAt: row.completed_at });
  }

  const seenSohc = new Set<string>();
  for (const row of sohcRes.data ?? []) {
    if (seenSohc.has(row.site_id)) continue;
    seenSohc.add(row.site_id);
    results.push({ siteId: row.site_id, inspectionType: 'sohc', completedAt: row.completed_at });
  }

  return results;
}

export async function fetchScheduled(
  supabase: SupabaseClient,
  siteIds: string[]
): Promise<ScheduledRow[]> {
  const { data } = await supabase
    .from('scheduled_inspections')
    .select('id, site_id, inspection_type, scheduled_date, assigned_to, notes, created_by, created_at')
    .in('site_id', siteIds)
    .order('scheduled_date', { ascending: true });
  return data ?? [];
}

// Projected next-due date from a last-completed date, or null if the site
// has never had a completed inspection of that type (nothing to project from).
export function projectNextDue(completedAt: string | null, type: InspectionType): string | null {
  if (!completedAt) return null;
  const d = new Date(completedAt);
  d.setDate(d.getDate() + TARGET_INTERVAL_DAYS[type]);
  return d.toISOString().slice(0, 10);
}

export function isDueSoon(projectedDate: string | null): boolean {
  if (!projectedDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(projectedDate);
  const daysUntil = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntil <= DUE_SOON_LEAD_DAYS;
}

export function isOverdue(projectedDate: string | null): boolean {
  if (!projectedDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(projectedDate) < today;
}
