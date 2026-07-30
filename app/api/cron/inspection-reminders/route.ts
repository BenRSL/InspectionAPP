import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { fetchLastCompleted, projectNextDue, isDueSoon, isOverdue, type InspectionType } from '@/lib/inspection-schedule';

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
  const lastCompleted = await fetchLastCompleted(supabase, siteIds);

  const types: InspectionType[] = ['monthly', 'sohc'];
  const dueSoon: { siteName: string; type: InspectionType; projected: string; overdue: boolean }[] = [];

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

  const rows = dueSoon
    .sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue ? -1 : 1))
    .map((d) => {
      const label = d.type === 'monthly' ? 'Monthly Inspect' : 'SOHC';
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
    subject: `Inspection reminder — ${dueSoon.length} site${dueSoon.length === 1 ? '' : 's'} approaching due date`,
    html: `
      <p>The following are approaching or past their projected inspection date. This is informational only — no action is enforced.</p>
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

  return NextResponse.json({ success: true, sent: true, count: dueSoon.length, sentTo: recipients });
}
