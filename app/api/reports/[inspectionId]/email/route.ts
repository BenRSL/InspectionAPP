import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { buildReportData, renderReportPdf } from '@/lib/report';

export const runtime = 'nodejs';
export const maxDuration = 30;

// TESTING PHASE — sending only to the tester account while rslqld.org isn't yet
// domain-verified in Resend. Resend's sandbox sender (onboarding@resend.dev) can
// only send to the exact email address the Resend account itself was signed up
// with — not arbitrary recipients — so this MUST match that signup email exactly.
//
// TODO once rslqld.org is domain-verified in Resend:
//   1. Set TEST_MODE to false below.
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

  const data = await buildReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
  }

  const pdfBuffer = await renderReportPdf(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-inspection-report.pdf`;

  const realRecipients = [data.inspectorEmail, 'assets@rslqld.org'].filter(
    (email): email is string => !!email
  );
  const recipients = TEST_MODE ? [TEST_RECIPIENT] : realRecipients;

  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: sendResult, error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `${data.siteName} — Monthly Inspection Report`,
    html: `
      <p>Attached is the monthly inspection report for <strong>${data.siteName}</strong>.</p>
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
