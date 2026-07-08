import { createBrowserClient, createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Client-side (components with 'use client')
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Server-side (server components, route handlers, server actions)
export function supabaseServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value, ...options });
          } catch {
            // Called from a Server Component (not a Server Action / Route Handler).
            // Next.js forbids writing cookies here — safe to ignore as long as
            // middleware is also refreshing the session (see middleware.ts).
          }
        },
        remove(name: string, options: CookieOptions) {
          try {
            cookieStore.set({ name, value: '', ...options });
          } catch {
            // Same read-only-context caveat as set() above.
          }
        },
      },
    }
  );
}

export type UserRole = 'god' | 'admin' | 'inspector';

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  assigned_sites: string[];
}
