import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  fetchLastCompleted,
  fetchScheduled,
  projectNextDue,
  isDueSoon,
  isOverdue,
  toLocalDateString,
  type InspectionType,
} from '@/lib/inspection-schedule';
 
export const runtime = 'nodejs';
export const maxDuration = 30;
 
// Same sandbox situation as every other email route until rslqld.org is
// domain-verified in Resend — see app/api/reports/[inspectionId]/email/route.ts.
const TEST_MODE = true;
const TEST_RECIPIENT = 'benrsl@outlook.com';
const FROM_ADDRESS = 'RSLQLD Inspection App <onboarding@resend.dev>';
 
export async function GET(request: NextRequest) {
  // Vercel signs its own cron invocations with this header automatically —
  // this rejects anyone else who finds the URL and calls it directly.
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
 
  const supabase = supabaseAdmin();
 
  const { data: sites, error: sitesErr } = await supabase.from('sites').select('id, name').order('name');
  if (sitesErr || !sites) {
    return NextResponse.json({ error: sitesErr?.message ?? 'Could not load sites.' }, { status: 500 });
  }
 
  const siteIds = sites.map((s) => s.id);
  const [lastCompleted, scheduled] = await Promise.all([
    fetchLastCompleted(supabase, siteIds),
    fetchScheduled(supabase, siteIds),
  ]);
 
  // A site+type with a real, current booking isn't a false alarm waiting to
  // happen — it's already handled. Index the earliest pending/accepted
  // booking still today-or-later per site+type so the loop below can
  // annotate instead of blindly flagging every projected due date. A
  // declined booking doesn't count — nobody's actually covering it — and a
  // booking dated in the past that was never completed is left to still
  // alarm normally, since that's a real miss, not noise.
  const today = toLocalDateString(new Date());
  const upcomingBySiteType = new Map<string, string>(); // `${siteId}|${type}` -> scheduled_date
  for (const row of scheduled) {
    if (row.status === 'declined') continue;
    if (row.scheduled_date < today) continue;
    const key = `${row.site_id}|${row.inspection_type}`;
    const existing = upcomingBySiteType.get(key);
    if (!existing || row.scheduled_date < existing) {
      upcomingBySiteType.set(key, row.scheduled_date);
    }
  }
 
  const types: InspectionType[] = ['monthly', 'sohc'];
  const dueSoon: {
    siteName: string;
    type: InspectionType;
    projected: string;
    overdue: boolean;
    alreadyScheduledFor: string | null;
  }[] = [];
 
  for (const site of sites) {
    for (const type of types) {
      const last = lastCompleted.find((l) => l.siteId === site.id && l.inspectionType === type);
      const projected = projectNextDue(last?.completedAt ?? null, type);
      if (isDueSoon(projected)) {
        dueSoon.push({
          siteName: site.name,
          type,
          projected: projected!,
          overdue: isOverdue(projected),
          alreadyScheduledFor: upcomingBySiteType.get(`${site.id}|${type}`) ?? null,
        });
      }
    }
  }
 
  if (dueSoon.length === 0) {
    return NextResponse.json({ success: true, sent: false, reason: 'Nothing due soon.' });
  }
 
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ success: true, sent: false, reason: 'RESEND_API_KEY not set.' });
  }
 
  // Genuinely unhandled items lead the email and drive the subject count;
  // already-booked ones are still shown (useful context, not hidden) but
  // sorted to the bottom and worded as informational rather than a prompt
  // to act.
  const actionable = dueSoon.filter((d) => !d.alreadyScheduledFor);
  const alreadyHandled = dueSoon.filter((d) => d.alreadyScheduledFor);
 
  const rows = [...actionable, ...alreadyHandled]
    .sort((a, b) => {
      if (!!a.alreadyScheduledFor !== !!b.alreadyScheduledFor) {
        return a.alreadyScheduledFor ? 1 : -1;
      }
      return a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1;
    })
    .map((d) => {
      const label = d.type === 'monthly' ? 'Monthly Inspect' : 'SOHC';
      if (d.alreadyScheduledFor) {
        return `<li><strong>${d.siteName}</strong> — ${label} — already booked for ${d.alreadyScheduledFor}</li>`;
      }
      const status = d.overdue ? `overdue since ${d.projected}` : `due around ${d.projected}`;
      return `<li><strong>${d.siteName}</strong> — ${label} — ${status}</li>`;
    })
    .join('');
 
  const realRecipients = ['assets@rslqld.org'];
  const recipients = TEST_MODE ? [TEST_RECIPIENT] : realRecipients;
 
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendErr } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject:
      actionable.length > 0
        ? `Inspection reminder — ${actionable.length} site${actionable.length === 1 ? '' : 's'} need${actionable.length === 1 ? 's' : ''} booking`
        : `Inspection reminder — ${alreadyHandled.length} site${alreadyHandled.length === 1 ? '' : 's'} approaching due date (all already booked)`,
    html: `
      <p>The following are approaching or past their projected inspection date. This is informational only — no action is enforced. Sites already booked on the Calendar are shown for visibility but don't need action.</p>
      <ul>${rows}</ul>
      ${
        TEST_MODE
          ? `<p style="color:#C01820;font-size:12px;">Testing mode: this would normally go to ${realRecipients.join(', ')} once rslqld.org is domain-verified in Resend.</p>`
          : ''
      }
    `,
  });
 
  if (sendErr) {
    return NextResponse.json({ error: sendErr.message }, { status: 502 });
  }
 
  return NextResponse.json({
    success: true,
    sent: true,
    count: dueSoon.length,
    actionable: actionable.length,
    alreadyScheduled: alreadyHandled.length,
    sentTo: recipients,
  });
}
 
