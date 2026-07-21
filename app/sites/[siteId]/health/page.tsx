import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase-server';
import HealthInspector from '@/components/HealthInspector';
import type { HealthCategory } from '@/lib/health';

export const dynamic = 'force-dynamic';

export default async function SiteHealthPage({ params }: { params: { siteId: string } }) {
  const supabase = supabaseServer();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound(); // middleware.ts already guards this route; belt-and-braces only

  const { data: userRow } = await supabase.from('users').select('role').eq('id', user.id).maybeSingle();
  const canClearInspections = userRow?.role === 'god_mode' || userRow?.role === 'admin';

  // params.siteId is the slug (e.g. 'anzac-house'), matching the site switcher links
  const { data: siteRow } = await supabase
    .from('sites')
    .select('id, name, slug')
    .eq('slug', params.siteId)
    .single();

  if (!siteRow) notFound();

  const { data: categoryRows } = await supabase
    .from('health_categories')
    .select('id, category_name, sort_order')
    .eq('site_id', siteRow.id)
    .eq('is_active', true)
    .order('sort_order');

  const categoryIds = (categoryRows ?? []).map((c) => c.id);

  const { data: itemRows } = categoryIds.length
    ? await supabase
        .from('health_items')
        .select('id, category_id, item_name, sort_order')
        .in('category_id', categoryIds)
        .eq('is_active', true)
        .order('sort_order')
    : { data: [] as { id: string; category_id: string; item_name: string; sort_order: number }[] };

  const categories: HealthCategory[] = (categoryRows ?? []).map((c) => ({
    id: c.id,
    name: c.category_name,
    items: (itemRows ?? [])
      .filter((it) => it.category_id === c.id)
      .map((it) => ({ id: it.id, name: it.item_name })),
  }));

  const hasData = categories.length > 0;

  return (
    <main className="flex-1 bg-white">
      <header className="bg-rsl-blue text-white px-6 py-5 sm:px-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <Link href={`/sites/${params.siteId}`} className="text-xs text-white/60 hover:text-white">
              ← {siteRow.name}
            </Link>
            <h1 className="font-display font-bold text-xl mt-0.5">State of Health Checklist</h1>
          </div>
        </div>
      </header>

      {hasData ? (
        <HealthInspector
          siteDbId={siteRow.id}
          siteName={siteRow.name}
          categories={categories}
          inspectorId={user.id}
          canClearInspections={canClearInspections}
        />
      ) : (
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <p className="text-rsl-navy/60 text-sm">
            SOHC category and item data for {siteRow.name} hasn&apos;t been set up yet.
          </p>
        </div>
      )}
    </main>
  );
}
