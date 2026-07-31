import { NextRequest, NextResponse } from 'next/server';
import { fetchTutorialSteps, renderTutorialPdf, type TutorialRole } from '@/lib/tutorial';

export const runtime = 'nodejs';
export const maxDuration = 30;

const VALID_ROLES: TutorialRole[] = ['inspector', 'admin', 'god_mode'];

export async function GET(request: NextRequest, { params }: { params: { role: string } }) {
  if (!VALID_ROLES.includes(params.role as TutorialRole)) {
    return NextResponse.json({ error: 'Unknown role.' }, { status: 400 });
  }
  const role = params.role as TutorialRole;

  const steps = await fetchTutorialSteps(role);
  const pdfBuffer = await renderTutorialPdf(role, steps);

  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="rslqld-${role}-guide.pdf"`,
    },
  });
}
