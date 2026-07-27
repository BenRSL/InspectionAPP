import { supabaseServer } from './supabase-server';

// Bible 8.4, Stage 3 — Excel cost template. Lists every active SOHC asset
// for a site with its current replacement_cost / cost_confidence so Ben
// can bulk-edit costs in Excel rather than one row at a time in Admin >
// Asset Costs. The Item ID column is the match key for Stage 4's
// upload/match flow — deliberately included (and marked "do not edit") so
// that re-import can match rows exactly instead of fuzzy-matching on
// category/item name, which would break silently on any rename.

export type CostTemplateItem = {
  id: string;
  name: string;
  replacementCost: number | null;
  costConfidence: 'estimated' | 'quoted' | null;
};

export type CostTemplateCategory = {
  id: string;
  name: string;
  items: CostTemplateItem[];
};

export type CostTemplateData = {
  siteId: string;
  siteName: string;
  categories: CostTemplateCategory[];
};

export async function buildCostTemplateData(siteId: string): Promise<CostTemplateData | null> {
  const supabase = supabaseServer();

  const { data: site, error: siteErr } = await supabase.from('sites').select('name').eq('id', siteId).single();
  if (siteErr || !site) return null;

  const { data: categoryRows, error: categoryErr } = await supabase
    .from('health_categories')
    .select('id, category_name, sort_order')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .order('sort_order');
  if (categoryErr) return null;

  const categoryIds = (categoryRows ?? []).map((c) => c.id);
  const { data: itemRows, error: itemErr } = await supabase
    .from('health_items')
    .select('id, category_id, item_name, sort_order, replacement_cost, cost_confidence')
    .in('category_id', categoryIds.length > 0 ? categoryIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('is_active', true)
    .order('sort_order');
  if (itemErr) return null;

  const categories: CostTemplateCategory[] = (categoryRows ?? []).map((c) => ({
    id: c.id,
    name: c.category_name,
    items: (itemRows ?? [])
      .filter((it) => it.category_id === c.id)
      .map((it) => ({
        id: it.id,
        name: it.item_name,
        replacementCost: it.replacement_cost,
        costConfidence: it.cost_confidence,
      })),
  }));

  return { siteId, siteName: site.name, categories };
}
