import { createClient } from '@supabase/supabase-js';

// For trusted, server-only contexts with no logged-in user session — right
// now, just the daily reminder cron job. Uses the service role key, which
// bypasses RLS entirely, so this must NEVER be imported into anything that
// runs in the browser or that acts on an untrusted request.
//
// Requires a new Vercel env var, SUPABASE_SERVICE_ROLE_KEY — copy it from
// Supabase Dashboard → Project Settings → API → service_role key (the
// secret one, not the anon/public key already in use everywhere else).
export function supabaseAdmin() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set in Vercel environment variables.');
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
