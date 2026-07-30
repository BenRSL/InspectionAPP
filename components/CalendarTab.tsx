'use client';

import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import {
  fetchLastCompleted,
  fetchScheduled,
  projectNextDue,
  isDueSoon,
  type InspectionType,
  type LastCompleted,
  type ScheduledRow,
} from '@/lib/inspection-schedule';

type Site = { id: string; name: string };
type UserOption = { id: string; email: string };

type DayEvent = {
  type: InspectionType;
  status: 'done' | 'scheduled' | 'dueSoon' | 'projected';
  siteName: string;
  scheduledRow?: ScheduledRow;
};

const STATUS_COLOR: Record<DayEvent['status'], string> = {
  done: '#639922',
  scheduled: '#378ADD',
  dueSoon: '#EF9F27',
  projected: '#B4B2A9',
};

const STATUS_LABEL: Record<DayEvent['status'], string> = {
  done: 'Completed',
  scheduled: 'Scheduled',
  dueSoon: 'Due soon',
  projected: 'Projected',
};

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function CalendarTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [sites, setSites] = useState<Site[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<string[]>([]);
  const [monthCursor, setMonthCursor] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });
  const [lastCompleted, setLastCompleted] = useState<LastCompleted[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledRow[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [canSchedule, setCanSchedule] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const [formSiteId, setFormSiteId] = useState('');
  const [formType, setFormType] = useState<InspectionType>('monthly');
  const [formAssignedTo, setFormAssignedTo] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formSendInvite, setFormSendInvite] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
        setCanSchedule(profile?.role === 'admin' || profile?.role === 'god_mode');
      }

      const { data: siteRows } = await supabase.from('sites').select('id, name').order('name');
      setSites(siteRows ?? []);
      if (siteRows && siteRows.length > 0) setSelectedSiteIds([siteRows[0].id]);

      const { data: userRows } = await supabase.from('users').select('id, email').order('email');
      setUsers(userRows ?? []);

      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedSiteIds.length === 0) {
      setLastCompleted([]);
      setScheduled([]);
      return;
    }
    (async () => {
      const [lc, sc] = await Promise.all([
        fetchLastCompleted(supabase, selectedSiteIds),
        fetchScheduled(supabase, selectedSiteIds),
      ]);
      setLastCompleted(lc);
      setScheduled(sc);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteIds]);

  function toggleSite(id: string) {
    setSelectedSiteIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? 'Site';

  // Build a map of date -> events, for the sites currently toggled on.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, DayEvent[]>();
    const push = (key: string, ev: DayEvent) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    };

    for (const siteId of selectedSiteIds) {
      const types: InspectionType[] = ['monthly', 'sohc'];
      for (const type of types) {
        const last = lastCompleted.find((l) => l.siteId === siteId && l.inspectionType === type);
        if (last?.completedAt) {
          push(last.completedAt.slice(0, 10), { type, status: 'done', siteName: siteName(siteId) });
        }
        const projected = projectNextDue(last?.completedAt ?? null, type);
        if (projected) {
          push(projected, {
            type,
            status: isDueSoon(projected) ? 'dueSoon' : 'projected',
            siteName: siteName(siteId),
          });
        }
      }
    }
    for (const row of scheduled) {
      if (!selectedSiteIds.includes(row.site_id)) continue;
      push(row.scheduled_date, {
        type: row.inspection_type,
        status: 'scheduled',
        siteName: siteName(row.site_id),
        scheduledRow: row,
      });
    }
    return map;
  }, [selectedSiteIds, lastCompleted, scheduled, sites]);

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = monthCursor.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  async function submitSchedule() {
    if (!formSiteId || !selectedDay) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          siteId: formSiteId,
          inspectionType: formType,
          scheduledDate: selectedDay,
          assignedTo: formAssignedTo || null,
          notes: formNotes || null,
          sendInvite: formSendInvite,
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        setFormError(result.error ?? 'Could not save.');
        setSaving(false);
        return;
      }
      const [lc, sc] = await Promise.all([
        fetchLastCompleted(supabase, selectedSiteIds),
        fetchScheduled(supabase, selectedSiteIds),
      ]);
      setLastCompleted(lc);
      setScheduled(sc);
      setFormNotes('');
      setFormAssignedTo('');
      setSaving(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save.');
      setSaving(false);
    }
  }

  async function removeScheduled(id: string) {
    if (!window.confirm('Remove this scheduled inspection?')) return;
    await supabase.from('scheduled_inspections').delete().eq('id', id);
    const [lc, sc] = await Promise.all([
      fetchLastCompleted(supabase, selectedSiteIds),
      fetchScheduled(supabase, selectedSiteIds),
    ]);
    setLastCompleted(lc);
    setScheduled(sc);
  }

  if (loading) return <p className="text-sm text-rsl-navy/50">Loading calendar…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {sites.map((s) => (
          <button
            key={s.id}
            onClick={() => toggleSite(s.id)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
              selectedSiteIds.includes(s.id)
                ? 'bg-rsl-blue text-white border-rsl-blue'
                : 'border-rsl-navy/20 text-rsl-navy/60'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setMonthCursor(new Date(year, month - 1, 1))}
            className="text-sm text-rsl-navy/60 px-2"
          >
            ‹
          </button>
          <p className="text-sm font-semibold text-rsl-navy">{monthLabel}</p>
          <button
            onClick={() => setMonthCursor(new Date(year, month + 1, 1))}
            className="text-sm text-rsl-navy/60 px-2"
          >
            ›
          </button>
        </div>
        <div className="flex gap-3 text-xs text-rsl-navy/60">
          {(['done', 'scheduled', 'dueSoon', 'projected'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-full"
                style={{ background: STATUS_COLOR[s] }}
              />
              {STATUS_LABEL[s]}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-xs text-rsl-navy/40 text-center">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
          const dateKey = toDateKey(new Date(year, month, day));
          const dayEvents = eventsByDay.get(dateKey) ?? [];
          const isSelected = selectedDay === dateKey;
          return (
            <button
              key={day}
              onClick={() => setSelectedDay(dateKey)}
              className={`relative aspect-square border rounded-lg text-xs text-rsl-navy/70 flex items-start justify-start p-1 ${
                isSelected ? 'border-rsl-blue' : 'border-rsl-navy/10'
              }`}
            >
              {day}
              {dayEvents.length > 0 && (
                <span className="absolute bottom-1 right-1 flex gap-0.5">
                  {dayEvents.slice(0, 3).map((ev, i) => (
                    <span
                      key={i}
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ background: STATUS_COLOR[ev.status] }}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="bg-rsl-navy/5 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-rsl-navy">{selectedDay}</p>

          {(eventsByDay.get(selectedDay) ?? []).length === 0 ? (
            <p className="text-xs text-rsl-navy/50">Nothing on this day for the selected sites.</p>
          ) : (
            <ul className="space-y-1">
              {(eventsByDay.get(selectedDay) ?? []).map((ev, i) => (
                <li key={i} className="text-xs text-rsl-navy/70 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: STATUS_COLOR[ev.status] }}
                    />
                    {ev.siteName} — {ev.type === 'monthly' ? 'Monthly Inspect' : 'SOHC'} —{' '}
                    {STATUS_LABEL[ev.status]}
                  </span>
                  {ev.scheduledRow && canSchedule && (
                    <button
                      onClick={() => removeScheduled(ev.scheduledRow!.id)}
                      className="text-rsl-red font-semibold"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canSchedule && (
            <div className="border-t border-rsl-navy/10 pt-3 space-y-2">
              <p className="text-xs font-semibold text-rsl-navy/60">Schedule an inspection for this day</p>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={formSiteId}
                  onChange={(e) => setFormSiteId(e.target.value)}
                  className="text-xs border border-rsl-navy/20 rounded-lg px-2 py-1.5"
                >
                  <option value="">Select site…</option>
                  {selectedSiteIds.map((id) => (
                    <option key={id} value={id}>
                      {siteName(id)}
                    </option>
                  ))}
                </select>
                <select
                  value={formType}
                  onChange={(e) => setFormType(e.target.value as InspectionType)}
                  className="text-xs border border-rsl-navy/20 rounded-lg px-2 py-1.5"
                >
                  <option value="monthly">Monthly Inspect</option>
                  <option value="sohc">SOHC</option>
                </select>
                <select
                  value={formAssignedTo}
                  onChange={(e) => setFormAssignedTo(e.target.value)}
                  className="text-xs border border-rsl-navy/20 rounded-lg px-2 py-1.5 col-span-2"
                >
                  <option value="">Assign to…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Notes (optional)"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  className="text-xs border border-rsl-navy/20 rounded-lg px-2 py-1.5 col-span-2"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-rsl-navy/60">
                <input
                  type="checkbox"
                  checked={formSendInvite}
                  onChange={(e) => setFormSendInvite(e.target.checked)}
                />
                Email a calendar invite to the assigned inspector
              </label>
              {formError && <p className="text-xs text-rsl-red">{formError}</p>}
              <button
                onClick={submitSchedule}
                disabled={saving || !formSiteId}
                className="text-xs font-semibold bg-rsl-blue text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Schedule'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
