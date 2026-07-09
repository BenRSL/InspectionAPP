'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (error) {
      setError('Incorrect email or password. Check with your admin if you need access.');
      return;
    }

    const next = searchParams.get('next') || '/';
    router.push(next);
    router.refresh();
  }

  return (
    <main className="flex-1 bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-xs uppercase tracking-[0.2em] text-rsl-gold font-semibold mb-1">
            RSL Queensland
          </div>
          <h1 className="font-display font-extrabold text-2xl text-rsl-navy">
            Inspection App
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-rsl-navy mb-1.5">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2.5 focus:border-rsl-red outline-none"
              placeholder="you@rslqld.org"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-rsl-navy mb-1.5">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2.5 focus:border-rsl-red outline-none"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-rsl-red bg-rsl-red/5 border border-rsl-red/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full text-sm font-semibold text-white bg-rsl-red rounded-lg px-4 py-2.5 hover:bg-rsl-red/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </main>
  );
}
