import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { processCostImport } from '@/lib/cost-import';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabase = supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const formData = await request.formData();
  const siteId = formData.get('siteId');
  const file = formData.get('file');

  if (typeof siteId !== 'string' || !siteId) {
    return NextResponse.json({ error: 'Missing siteId' }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();

  let summary;
  try {
    summary = await processCostImport(supabase, siteId, arrayBuffer);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Import failed' }, { status: 400 });
  }

  // Log the attempt regardless of outcome, per Ben's call on Section 8.4's
  // change-log question. Uses the same session client, so this insert is
  // itself subject to cost_import_log's admin/god_mode RLS policy — a
  // non-admin/god_mode user's health_items writes were already rejected
  // and reported as row-level errors above, so a failed log insert here
  // just means no log row for a rejected attempt, which is the correct
  // outcome, not a bug.
  const { error: logErr } = await supabase.from('cost_import_log').insert({
    site_id: siteId,
    uploaded_by: user.id,
    uploaded_by_email: user.email,
    filename: file.name,
    rows_total: summary.rowsTotal,
    rows_applied: summary.rowsApplied,
    rows_errored: summary.rowsErrored,
    details: summary.details,
  });

  return NextResponse.json({ ...summary, logSaved: !logErr });
}
