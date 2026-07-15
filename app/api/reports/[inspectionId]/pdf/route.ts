import { NextRequest, NextResponse } from 'next/server';
import { buildReportData, renderReportPdf } from '@/lib/report';
 
export const runtime = 'nodejs';
export const maxDuration = 30; // generous headroom over Hobby's 10s default — cold starts loading @react-pdf/renderer plus fetching photos can be slow on a cold function
 
export async function GET(request: NextRequest, { params }: { params: { inspectionId: string } }) {
  const data = await buildReportData(params.inspectionId);
  if (!data) {
    return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
  }
 
  const pdfBuffer = await renderReportPdf(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-inspection-report.pdf`;
 
  // NextResponse's body type doesn't accept a Node Buffer directly under strict
  // TS — wrapping it as a Uint8Array (which Buffer already structurally is)
  // satisfies the type without changing the actual bytes sent.
  return new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      // inline (not attachment) so it opens in a new tab with the browser's native
      // PDF viewer — which has print/save controls built in — rather than silently
      // forcing a download
      'Content-Disposition': `inline; filename="${filename}"`,
    },
  });
}
 
