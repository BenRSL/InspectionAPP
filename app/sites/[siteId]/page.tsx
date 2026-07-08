import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSite } from '@/lib/sites';
import Inspector from '@/components/Inspector';

export default function SiteInspectionPage({ params }: { params: { siteId: string } }) {
  const site = getSite(params.siteId);
  if (!site) notFound();

  const hasData = site.floors.length > 0;

  return (
    <main className="flex-1 bg-white">
      <header className="bg-rsl-navy text-white px-6 py-5 sm:px-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <Link href="/" className="text-xs text-white/60 hover:text-white">
              ← All sites
            </Link>
            <h1 className="font-display font-bold text-xl mt-0.5">{site.displayLabel}</h1>
          </div>
          <Link
            href={`/sites/${site.id}/health`}
            className="text-xs font-semibold text-rsl-gold border border-rsl-gold/40 rounded-full px-3 py-1.5"
          >
            State of Health
          </Link>
        </div>
      </header>

      {hasData ? (
        <Inspector site={site} />
      ) : (
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="text-rsl-navy/60 text-sm">
            Floor and area data for {site.displayLabel} hasn't been entered yet.
            Add it via the Admin portal's site onboarding workflow.
          </p>
          <Link
            href="/admin"
            className="inline-block mt-4 text-sm font-semibold text-white bg-rsl-red rounded-lg px-5 py-2.5"
          >
            Go to Admin
          </Link>
        </div>
      )}
    </main>
  );
}
