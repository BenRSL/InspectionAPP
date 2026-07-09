import { createBrowserClient } from '@supabase/ssr';

// Client-side only (components with 'use client'). No next/headers import here —
// keep this file free of server-only code so it's always safe to bundle for the browser.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
