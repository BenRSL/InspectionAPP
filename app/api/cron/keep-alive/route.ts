import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
 
export const runtime = 'nodejs';
export const maxDuration = 30;
 
// Supabase's free tier pauses a project after 7 days with zero API
// requests, and can eventually delete a project that stays paused for an
// extended stretch. This route does nothing except make one trivial,
// cheap read once a day, purely to keep the "last activity" clock reset
// while the team is on the free tier — remove this route once/if the
// project moves to a plan without the inactivity pause (Pro removes it
// entirely), since it becomes dead weight at that point.
export async function GET(request: NextRequest) {
  // Same Vercel-signed cron auth as the other cron routes — rejects
  // anyone who finds this URL and calls it directly.
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
 
  const supabase = supabaseAdmin();
 
  // Cheapest possible real query — a single row, no writes, no data
  // touched that matters. The point is only that Supabase sees an API
  // request land today, not what the request actually returns.
  const { error } = await supabase.from('sites').select('id').limit(1);
 
  if (error) {
    // Still return 200 — a failed keep-alive shouldn't itself alert anyone
    // at 3am, but the error is worth logging in Vercel's function logs in
    // case it points at something else being wrong (e.g. RLS/service-role
    // misconfiguration), not just treated as routine.
    console.error('Keep-alive query failed:', error.message);
    return NextResponse.json({ ok: false, error: error.message });
  }
 
  return NextResponse.json({ ok: true, pingedAt: new Date().toISOString() });
}
 
