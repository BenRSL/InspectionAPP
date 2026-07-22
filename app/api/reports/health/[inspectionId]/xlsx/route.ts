import { NextRequest, NextResponse } from 'next/server';
import { buildHealthReportData } from '@/lib/health-report';
import { renderHealthReportXlsx } from '@/lib/xlsx-report';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(request: NextRequest, { params }: { params: { inspectionId: string } }) {
  const data = await buildHealthReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'SOHC inspection not found' }, { status: 404 });
  }

  const xlsxBuffer = renderHealthReportXlsx(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-sohc-report-${data.year}.xlsx`;

  return new NextResponse(new Uint8Array(xlsxBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
