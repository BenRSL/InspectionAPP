'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

// Manual entry screen for replacement_cost + cost_confidence on health_items
// (Bible Section 8.4, Stage 2) — deliberately built before the Excel
// import/match flow (Stages 3–4) so the feature is usable immediately,
// without needing the template/upload tooling at all.

type CostConfidence = 'estimated' | 'quoted';

interface SiteRow {
  id: string;
  name: string;
}
interface CategoryRow {
  id: string;
  site_id: string;
  category_name: string;
  sort_order: number;
}
interface ItemRow {
  id: string;
  category_id: string;
  item_name: string;
  sort_order: number;
  replacement_cost: number | null;
  cost_confidence: CostConfidence | null;
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export default function AssetCostsTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState<string>('');
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);

  const [loadingSites, setLoadingSites] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');

  const costTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from('sites').select('id, name').order('name');
      if (error) {
        setLoadError(error.message);
      } else {
        setSites(data ?? []);
      }
      setLoadingSites(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setCategories([]);
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingItems(true);
      setLoadError(null);

      const { data: categoryRows, error: categoryErr } = await supabase
        .from('health_categories')
        .select('id, site_id, category_name, sort_order')
        .eq('site_id', selectedSiteId)
        .eq('is_active', true)
        .order('sort_order');

      if (categoryErr) {
        if (!cancelled) setLoadError(categoryErr.message);
        setLoadingItems(false);
        return;
      }

      const categoryIds = (categoryRows ?? []).map((c) => c.id);
      const { data: itemRows, error: itemErr } = await supabase
        .from('health_items')
        .select('id, category_id, item_name, sort_order, replacement_cost, cost_confidence')
        .in('category_id', categoryIds.length > 0 ? categoryIds : ['00000000-0000-0000-0000-000000000000'])
        .eq('is_active', true)
        .order('sort_order');

      if (!cancelled) {
        if (itemErr) {
          setLoadError(itemErr.message);
        } else {
          setCategories(categoryRows ?? []);
          setItems(itemRows ?? []);
        }
        setLoadingItems(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSiteId]);

  async function saveItem(itemId: string, patch: Partial<Pick<ItemRow, 'replacement_cost' | 'cost_confidence'>>) {
    setSaveStatus('saving');
    const { error } = await supabase.from('health_items').update(patch).eq('id', itemId);
    setSaveStatus(error ? 'error' : 'saved');
  }

  function updateCost(itemId: string, rawValue: string) {
    const value = rawValue.trim() === '' ? null : Number(rawValue);
    if (value !== null && Number.isNaN(value)) return;

    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, replacement_cost: value } : it)));

    clearTimeout(costTimers.current[itemId]);
    costTimers.current[itemId] = setTimeout(() => {
      saveItem(itemId, { replacement_cost: value });
    }, 600);
  }

  function updateConfidence(itemId: string, value: CostConfidence | '') {
    const nextValue = value === '' ? null : value;
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, cost_confidence: nextValue } : it)));
    saveItem(itemId, { cost_confidence: nextValue });
  }

  const totalEntered = items.reduce((sum, it) => sum + (it.replacement_cost ?? 0), 0);
  const itemsWithCost = items.filter((it) => it.replacement_cost !== null).length;

  if (loadingSites) return <p className="text-sm text-rsl-navy/50">Loading…</p>;
  if (loadError) {
    return (
      <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red">
        Couldn't load: {loadError}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-rsl-navy/60">
        Enter an estimated or quoted replacement cost for any SOHC asset. This is optional and independent of
        the inspection checklist — inspectors never see or edit these figures. Costs feed the upcoming
        Asset Lifecycle $-at-risk view once enough are filled in.
      </p>

      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={selectedSiteId}
          onChange={(e) => setSelectedSiteId(e.target.value)}
          className="text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 text-rsl-navy"
        >
          <option value="">Select a site…</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedSiteId && !loadingItems && (
          <span className="text-xs text-rsl-navy/50">
            {itemsWithCost} of {items.length} assets costed · $
            {totalEntered.toLocaleString('en-AU', { maximumFractionDigits: 0 })} entered so far
          </span>
        )}
        <SaveIndicator status={saveStatus} />
      </div>

      {!selectedSiteId && <p className="text-sm text-rsl-navy/40">Pick a site to view and edit its assets.</p>}

      {selectedSiteId && loadingItems && <p className="text-sm text-rsl-navy/50">Loading assets…</p>}

      {selectedSiteId && !loadingItems && (
        <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
              <tr>
                <th className="font-semibold px-4 py-2.5">Category</th>
                <th className="font-semibold px-4 py-2.5">Item</th>
                <th className="font-semibold px-4 py-2.5 w-40">Replacement cost</th>
                <th className="font-semibold px-4 py-2.5 w-36">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const categoryItems = items.filter((it) => it.category_id === category.id);
                return categoryItems.map((item, index) => (
                  <tr key={item.id} className="border-t border-rsl-navy/5">
                    <td className="px-4 py-2 text-rsl-navy/70 whitespace-nowrap">
                      {index === 0 ? category.category_name : ''}
                    </td>
                    <td className="px-4 py-2 text-rsl-navy">{item.item_name}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <span className="text-rsl-navy/40">$</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.replacement_cost ?? ''}
                          onChange={(e) => updateCost(item.id, e.target.value)}
                          placeholder="—"
                          className="w-24 text-sm rounded-lg border border-rsl-navy/15 px-2 py-1.5 text-rsl-navy"
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={item.cost_confidence ?? ''}
                        onChange={(e) => updateConfidence(item.id, e.target.value as CostConfidence | '')}
                        className="text-sm rounded-lg border border-rsl-navy/15 px-2 py-1.5 text-rsl-navy"
                      >
                        <option value="">—</option>
                        <option value="estimated">Estimated</option>
                        <option value="quoted">Quoted</option>
                      </select>
                    </td>
                  </tr>
                ));
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-rsl-navy/40 text-sm">
                    No SOHC assets found for this site.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === 'idle') return null;
  const label =
    status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved ✓' : 'Save failed — check connection';
  const color =
    status === 'saving' ? 'text-rsl-navy/40' : status === 'saved' ? 'text-pass' : 'text-rsl-red';
  return <span className={`text-xs font-semibold ${color}`}>{label}</span>;
}
