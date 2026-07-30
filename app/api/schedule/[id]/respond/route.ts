import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const supabase = supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const { response } = (await request.json()) as { response: 'accepted' | 'declined' };
  if (response !== 'accepted' && response !== 'declined') {
    return NextResponse.json({ error: 'Invalid response.' }, { status: 400 });
  }

  // Calls a SECURITY DEFINER function that only ever writes the status
  // column on the caller's own assigned row — see the migration for why
  // this isn't a plain .update() against a broad RLS policy.
  const { error } = await supabase.rpc('respond_to_scheduled_inspection', {
    scheduled_id: params.id,
    new_status: response,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
