import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { buildHealthReportData, renderHealthReportPdf } from '@/lib/health-report';

export const runtime = 'nodejs';
export const maxDuration = 30;

// TESTING PHASE — same sandbox constraint as Stage 1's email route. Resend's
// sandbox sender (onboarding@resend.dev) can only send to the exact email
// address the Resend account itself was signed up with.
//
// TODO once rslqld.org is domain-verified in Resend:
//   1. Set TEST_MODE to false below (keep in sync with the Stage 1 route).
//   2. Change FROM_ADDRESS to something on the verified domain, e.g.
//      'RSLQLD Inspection App <reports@rslqld.org>'.
const TEST_MODE = true;
const TEST_RECIPIENT = 'benrsl@outlook.com'; // must exactly match the Resend account's signup email
const FROM_ADDRESS = 'RSLQLD Inspection App <onboarding@resend.dev>';

export async function POST(request: NextRequest, { params }: { params: { inspectionId: string } }) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY is not set in Vercel environment variables.' },
      { status: 500 }
    );
  }

  const data = await buildHealthReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'SOHC inspection not found' }, { status: 404 });
  }

  const pdfBuffer = await renderHealthReportPdf(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-sohc-report-${data.year}.pdf`;

  const realRecipients = [data.inspectorEmail, 'assets@rslqld.org'].filter(
    (email): email is string => !!email
  );
  const recipients = TEST_MODE ? [TEST_RECIPIENT] : realRecipients;

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: sendResult, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `${data.siteName} — SOHC ${data.year} Report`,
    html: `
      <p>Attached is the ${data.year} State of Health Checklist report for <strong>${data.siteName}</strong>.</p>
      ${
        TEST_MODE
          ? `<p style="color:#C01820;font-size:12px;">Testing mode: this would normally also go to ${
              realRecipients.join(', ') || 'the inspector + assets@rslqld.org'
            } once rslqld.org is domain-verified in Resend.</p>`
          : ''
      }
    `,
    attachments: [
      {
        filename,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ success: true, id: sendResult?.id, sentTo: recipients });
}
