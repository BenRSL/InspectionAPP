import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { supabaseServer } from '@/lib/supabase-server';
import { buildIcsEvent } from '@/lib/ics';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Same sandbox situation as every other email route until rslqld.org is
// domain-verified in Resend — see app/api/reports/[inspectionId]/email/route.ts.
const TEST_MODE = true;
const TEST_RECIPIENT = 'benrsl@outlook.com';
const FROM_ADDRESS = 'RSLQLD Inspection App <onboarding@resend.dev>';

export async function POST(request: NextRequest) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const body = await request.json();
  const { siteId, inspectionType, scheduledDate, assignedTo, notes, sendInvite } = body as {
    siteId: string;
    inspectionType: 'monthly' | 'sohc';
    scheduledDate: string;
    assignedTo: string | null;
    notes: string | null;
    sendInvite: boolean;
  };

  if (!siteId || !inspectionType || !scheduledDate) {
    return NextResponse.json({ error: 'Missing site, inspection type, or date.' }, { status: 400 });
  }

  // The insert itself runs under the calling user's own session, so the
  // existing "Admin write" RLS policy on scheduled_inspections is the real
  // gate here — this route can't be used to bypass it.
  const { data: row, error: insertErr } = await supabase
    .from('scheduled_inspections')
    .insert({
      site_id: siteId,
      inspection_type: inspectionType,
      scheduled_date: scheduledDate,
      assigned_to: assignedTo || null,
      notes: notes || null,
      created_by: user.id,
    })
    .select('id')
    .single();

  if (insertErr || !row) {
    return NextResponse.json({ error: insertErr?.message ?? 'Could not save.' }, { status: 500 });
  }

  if (!sendInvite) {
    return NextResponse.json({ success: true, id: row.id, invited: false });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({
      success: true,
      id: row.id,
      invited: false,
      inviteError: 'RESEND_API_KEY is not set — schedule saved, but no invite was sent.',
    });
  }

  const [{ data: site }, { data: assignee }] = await Promise.all([
    supabase.from('sites').select('name').eq('id', siteId).maybeSingle(),
    assignedTo ? supabase.from('users').select('email').eq('id', assignedTo).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const siteName = site?.name ?? 'Site';
  const label = inspectionType === 'monthly' ? 'Monthly Inspect' : 'State of Health Checklist';
  const ics = buildIcsEvent({
    uid: row.id,
    title: `${siteName} — ${label}`,
    description: notes || undefined,
    date: scheduledDate,
    organizerEmail: 'assets@rslqld.org',
    attendeeEmail: assignee?.email ?? undefined,
  });

  const realRecipients = [assignee?.email].filter((e): e is string => !!e);
  const recipients = TEST_MODE ? [TEST_RECIPIENT] : realRecipients;

  if (recipients.length === 0) {
    return NextResponse.json({ success: true, id: row.id, invited: false, inviteError: 'No assignee email to send to.' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error: sendErr } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `${siteName} — ${label} scheduled for ${scheduledDate}`,
    html: `
      <p>You've been scheduled for a <strong>${label}</strong> at <strong>${siteName}</strong> on <strong>${scheduledDate}</strong>.</p>
      ${notes ? `<p>Notes: ${notes}</p>` : ''}
      <p>A calendar invite is attached.</p>
      ${
        TEST_MODE
          ? `<p style="color:#C01820;font-size:12px;">Testing mode: this would normally go to ${
              realRecipients.join(', ') || 'the assigned inspector'
            } once rslqld.org is domain-verified in Resend.</p>`
          : ''
      }
    `,
    attachments: [
      {
        filename: 'inspection.ics',
        content: Buffer.from(ics, 'utf-8'),
        contentType: 'text/calendar',
      },
    ],
  });

  if (sendErr) {
    return NextResponse.json({ success: true, id: row.id, invited: false, inviteError: sendErr.message });
  }

  return NextResponse.json({ success: true, id: row.id, invited: true, sentTo: recipients });
}
