import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const supabase = supabaseServer();

  const { data: sites } = await supabase
    .from('sites')
    .select('id, name, slug')
    .order('name');

  return (
    <main className="flex-1 bg-white">
      <header className="bg-rsl-navy text-white px-6 py-8 sm:px-10">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            {/* Logo placeholder — replace with RSLQLD PNG/SVG (Bible Open Item #3) */}
            <div className="text-xs uppercase tracking-[0.2em] text-rsl-gold font-semibold mb-1">
              RSL Queensland
            </div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl">
              Inspection App
            </h1>
          </div>
          <Link
            href="/admin"
            className="text-sm text-white/70 hover:text-white border border-white/20 rounded-full px-4 py-2 transition-colors"
          >
            Admin
          </Link>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-6 sm:px-10 py-10">
        <h2 className="font-display font-bold text-lg text-rsl-navy mb-1">Select a site</h2>
        <p className="text-sm text-rsl-navy/60 mb-6">
          Choose a property to start a monthly inspection or open its State of Health checklist.
        </p>

        {sites && sites.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sites.map((site) => (
              <div
                key={site.id}
                className="group border border-rsl-navy/10 rounded-2xl p-5 hover:border-rsl-red/40 hover:shadow-sm transition-all"
              >
                <div className="font-display font-bold text-rsl-navy mb-3">{site.name}</div>
                <div className="flex flex-col gap-2">
                  <Link
                    href={`/sites/${site.slug}`}
                    className="text-sm font-semibold text-white bg-rsl-red rounded-lg px-4 py-2.5 text-center hover:bg-rsl-red/90 transition-colors"
                  >
                    Monthly Inspect
                  </Link>
                  <Link
                    href={`/sites/${site.slug}/health`}
                    className="text-sm font-medium text-rsl-blue border border-rsl-blue/30 rounded-lg px-4 py-2 text-center hover:bg-rsl-blue/5 transition-colors"
                  >
                    State of Health
                    <span className="ml-1.5 text-[10px] uppercase tracking-wide text-rsl-gold font-bold">
                      Annual
                    </span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-rsl-navy/60">
            No sites found. Add a site via the Admin portal.
          </p>
        )}
      </section>
    </main>
  );
}
