import { NextRequest, NextResponse } from 'next/server';
import { buildCostTemplateData } from '@/lib/cost-template';
import { renderCostTemplateXlsx } from '@/lib/xlsx-report';
 
export const runtime = 'nodejs';
export const maxDuration = 30;
 
export async function GET(request: NextRequest, { params }: { params: { siteId: string } }) {
  const data = await buildCostTemplateData(params.siteId);
  if (!data) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
 
  const xlsxBuffer = renderCostTemplateXlsx(data);
  const filename = `${data.siteName.replace(/[^a-z0-9]+/gi, '-')}-cost-template.xlsx`;
 
  return new NextResponse(new Uint8Array(xlsxBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
 
