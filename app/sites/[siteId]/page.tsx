import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import Inspector from '@/components/Inspector';
import type { Site, Floor } from '@/lib/sites';

export const dynamic = 'force-dynamic';

export default async function SiteInspectionPage({ params }: { params: { siteId: string } }) {
  const supabase = supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound(); // middleware.ts already guards this route; belt-and-braces only

  // params.siteId is the slug (e.g. 'anzac-house'), matching the site switcher links
  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name, slug, monthly_onboarding_inspections_remaining')
    .eq('slug', params.siteId)
    .single();

  if (!siteRow) notFound();

  const { data: areaRows } = await supabase
    .from('floor_areas')
    .select('id, floor_name, area_name, sort_order')
    .eq('site_id', siteRow.id)
    .order('sort_order');

  const areaIds = (areaRows ?? []).map((a) => a.id);

  const { data: itemRows } = areaIds.length
    ? await supabase
        .from('checklist_items')
        .select('id, area_id, item_name, category')
        .in('area_id', areaIds)
    : { data: [] as { id: string; area_id: string; item_name: string; category: string }[] };

  // Group flat rows into the Floor[] -> FloorArea[] -> ChecklistItem[] shape Inspector expects
  const floorMap = new Map<string, Floor>();
  for (const a of areaRows ?? []) {
    if (!floorMap.has(a.floor_name)) {
      floorMap.set(a.floor_name, { id: a.floor_name, name: a.floor_name, areas: [] });
    }
    floorMap.get(a.floor_name)!.areas.push({
      id: a.id,
      name: a.area_name,
      items: (itemRows ?? [])
        .filter((it) => it.area_id === a.id)
        .map((it) => ({
          id: it.id,
          name: it.item_name,
          category: it.category as 'cleaning' | 'maintenance',
        })),
    });
  }

  const site: Site = {
    id: siteRow.slug,
    name: siteRow.name,
    displayLabel: siteRow.name,
    floors: Array.from(floorMap.values()),
  };

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
        <Inspector
          site={site}
          siteDbId={siteRow.id}
          inspectorId={user.id}
          monthlyOnboardingRemaining={siteRow.monthly_onboarding_inspections_remaining}
        />
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
