import { NextRequest, NextResponse } from 'next/server';
import { buildReportData, renderReportPdf } from '@/lib/report';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { inspectionId: string } }) {
  const data = await buildReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
  }

  const pdfBuffer = await renderReportPdf(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-inspection-report.pdf`;

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
