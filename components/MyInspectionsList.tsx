'use client';

import { useState } from 'react';
import type { ScheduledStatus } from '@/lib/inspection-schedule';

type Row = {
  id: string;
  siteName: string;
  inspectionType: 'monthly' | 'sohc';
  scheduledDate: string;
  notes: string | null;
  status: ScheduledStatus;
};

const STATUS_STYLE: Record<ScheduledStatus, string> = {
  pending: 'bg-rsl-gold/10 text-rsl-gold',
  accepted: 'bg-green-600/10 text-green-700',
  declined: 'bg-rsl-red/10 text-rsl-red',
};

export default function MyInspectionsList({ initialRows }: { initialRows: Row[] }) {
  const [rows, setRows] = useState(initialRows);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function respond(id: string, response: 'accepted' | 'declined') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/schedule/${id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status: response } : r)));
      }
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="max-w-5xl mx-auto px-6 sm:px-10 pt-8">
      <h2 className="font-display font-bold text-lg text-rsl-navy mb-1">My upcoming inspections</h2>
      <div className="flex flex-col gap-2 mt-3">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex items-center justify-between border border-rsl-navy/10 rounded-xl px-4 py-3 gap-3"
          >
            <div className="min-w-0">
              <p className="text-sm font-semibold text-rsl-navy">
                {row.siteName} — {row.inspectionType === 'monthly' ? 'Monthly Inspect' : 'SOHC'}
              </p>
              {row.notes && <p className="text-xs text-rsl-navy/50 mt-0.5">{row.notes}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm text-rsl-navy/70 font-medium">{row.scheduledDate}</span>
              {row.status === 'pending' ? (
                <>
                  <button
                    onClick={() => respond(row.id, 'accepted')}
                    disabled={busyId === row.id}
                    className="text-xs font-semibold text-white bg-rsl-blue rounded-full px-3 py-1.5 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => respond(row.id, 'declined')}
                    disabled={busyId === row.id}
                    className="text-xs font-semibold text-rsl-red border border-rsl-red/30 rounded-full px-3 py-1.5 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </>
              ) : (
                <span className={`text-xs font-semibold rounded-full px-3 py-1 ${STATUS_STYLE[row.status]}`}>
                  {row.status === 'accepted' ? 'Accepted' : 'Declined'}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
