import { NextRequest, NextResponse } from 'next/server';
import { buildHealthReportData, renderHealthReportPdf } from '@/lib/health-report';

export const runtime = 'nodejs';
export const maxDuration = 30; // same Hobby-plan headroom as Stage 1's pdf route

export async function GET(request: NextRequest, { params }: { params: { inspectionId: string } }) {
  const data = await buildHealthReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'SOHC inspection not found' }, { status: 404 });
  }

  const pdfBuffer = await renderHealthReportPdf(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-sohc-report-${data.year}.pdf`;

  // Same Uint8Array wrapping as Stage 1's route — NextResponse's body type
  // doesn't accept a Node Buffer directly under strict TS.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}
