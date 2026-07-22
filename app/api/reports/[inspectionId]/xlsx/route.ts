import { NextRequest, NextResponse } from 'next/server';
import { buildReportData } from '@/lib/report';
import { renderStage1ReportXlsx } from '@/lib/xlsx-report';

export const runtime = 'nodejs';
export const maxDuration = 30; // same Hobby-plan headroom as the pdf route

export async function GET(request: NextRequest, { params }: { params: { inspectionId: string } }) {
  const data = await buildReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
  }

  const xlsxBuffer = renderStage1ReportXlsx(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-inspection-report.xlsx`;

  return new NextResponse(new Uint8Array(xlsxBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
