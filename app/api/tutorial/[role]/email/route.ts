import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { fetchTutorialSteps, renderTutorialPdf, type TutorialRole } from '@/lib/tutorial';

export const runtime = 'nodejs';
export const maxDuration = 30;

// Same sandbox situation as every other email route until rslqld.org is
// domain-verified in Resend — see app/api/reports/[inspectionId]/email/route.ts.
const TEST_MODE = true;
const TEST_RECIPIENT = 'benrsl@outlook.com';
const FROM_ADDRESS = 'RSLQLD Inspection App <onboarding@resend.dev>';

const VALID_ROLES: TutorialRole[] = ['inspector', 'admin', 'god_mode'];
const ROLE_LABEL: Record<TutorialRole, string> = { inspector: 'Inspector', admin: 'Admin', god_mode: 'God Mode' };

export async function POST(request: NextRequest, { params }: { params: { role: string } }) {
  if (!VALID_ROLES.includes(params.role as TutorialRole)) {
    return NextResponse.json({ error: 'Unknown role.' }, { status: 400 });
  }
  const role = params.role as TutorialRole;

  const { recipientEmail } = (await request.json()) as { recipientEmail: string };
  if (!recipientEmail) {
    return NextResponse.json({ error: 'Missing recipient email.' }, { status: 400 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY is not set.' }, { status: 500 });
  }

  const steps = await fetchTutorialSteps(role);
  const pdfBuffer = await renderTutorialPdf(role, steps);
  const recipients = TEST_MODE ? [TEST_RECIPIENT] : [recipientEmail];

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: recipients,
    subject: `RSLQLD Inspection App — ${ROLE_LABEL[role]} Guide`,
    html: `
      <p>Attached is the ${ROLE_LABEL[role]} guide for the RSLQLD Inspection App.</p>
      ${
        TEST_MODE
          ? `<p style="color:#C01820;font-size:12px;">Testing mode: this would normally go to ${recipientEmail} once rslqld.org is domain-verified in Resend.</p>`
          : ''
      }
    `,
    attachments: [
      {
        filename: `rslqld-${role}-guide.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({ success: true, sentTo: recipients });
}
