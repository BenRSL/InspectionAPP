'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { Site, ItemCategory } from '@/lib/sites';

type PassState = boolean | null; // null = not yet assessed
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ItemState {
  cleaningPass: PassState;
  maintenancePass: PassState;
  cComment: string;
  mComment: string;
}

interface AreaState {
  items: Record<string, ItemState>; // keyed by checklist item id
}

function emptyItemState(): ItemState {
  return { cleaningPass: null, maintenancePass: null, cComment: '', mComment: '' };
}

// First day of the current month, e.g. '2026-07-01' — matches inspections.period_month (date)
function currentPeriodMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function Inspector({
  site,
  siteDbId,
  inspectorId,
  monthlyOnboardingRemaining,
}: {
  site: Site;
  siteDbId: string;
  inspectorId: string;
  monthlyOnboardingRemaining: number;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [activeFloorId, setActiveFloorId] = useState(site.floors[0]?.id ?? '');
  const [view, setView] = useState<'floor' | 'attention'>('floor');
  const [areaState, setAreaState] = useState<Record<string, AreaState>>(() => {
    const init: Record<string, AreaState> = {};
    site.floors.forEach((f) =>
      f.areas.forEach((a) => {
        const items: Record<string, ItemState> = {};
        a.items.forEach((it) => (items[it.id] = emptyItemState()));
        init[a.id] = { items };
      })
    );
    return init;
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const inspectionIdRef = useRef<string | null>(null);
  const pendingSaves = useRef(0);
  const completionHandled = useRef(false);
  const commentTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ---- Load real data on mount: find-or-create this month's inspection, then
  // read any inspection_items already saved against it ----
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      const periodMonth = currentPeriodMonth();

      const { data: existing, error: findErr } = await supabase
        .from('inspections')
        .select('id, status')
        .eq('site_id', siteDbId)
        .eq('period_month', periodMonth)
        .maybeSingle();

      if (findErr) {
        if (!cancelled) setLoadError('Could not load this inspection. Try refreshing.');
        return;
      }

      let inspectionId = existing?.id ?? null;

      if (!inspectionId) {
        const { data: created, error: createErr } = await supabase
          .from('inspections')
          .insert({ site_id: siteDbId, inspector_id: inspectorId, period_month: periodMonth })
          .select('id')
          .single();

        if (createErr || !created) {
          if (!cancelled) setLoadError('Could not start this inspection. Try refreshing.');
          return;
        }
        inspectionId = created.id;
      } else if (existing?.status === 'complete') {
        completionHandled.current = true; // already completed in a prior session — don't re-decrement
      }

      inspectionIdRef.current = inspectionId;

      const { data: savedItems, error: itemsErr } = await supabase
        .from('inspection_items')
        .select('checklist_item_id, result, comment')
        .eq('inspection_id', inspectionId);

      if (itemsErr) {
        if (!cancelled) setLoadError('Loaded the inspection, but not your saved answers. Try refreshing.');
        return;
      }

      if (!cancelled && savedItems) {
        setAreaState((prev) => {
          const next = structuredClone(prev);
          for (const row of savedItems) {
            for (const area of site.floors.flatMap((f) => f.areas)) {
              const item = area.items.find((it) => it.id === row.checklist_item_id);
              if (!item) continue;
              const state = next[area.id].items[item.id];
              if (item.category === 'cleaning') {
                state.cleaningPass = row.result === 'pass';
                state.cComment = row.comment ?? '';
              } else {
                state.maintenancePass = row.result === 'pass';
                state.mComment = row.comment ?? '';
              }
            }
          }
          return next;
        });
      }

      if (!cancelled) setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteDbId]);

  const totalItems = site.floors.flatMap((f) => f.areas).flatMap((a) => a.items).length;
  const completedItems = Object.values(areaState)
    .flatMap((a) => Object.values(a.items))
    .filter((it) => it.cleaningPass !== null || it.maintenancePass !== null).length;
  const pct = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;

  // ---- Autosave: upsert one inspection_items row per checklist item.
  // Unique(inspection_id, checklist_item_id) makes this a safe upsert — no duplicate-row risk. ----
  async function saveResult(itemId: string, result: 'pass' | 'fail', comment: string) {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;

    pendingSaves.current += 1;
    setSaveStatus('saving');

    const { error } = await supabase.from('inspection_items').upsert(
      {
        inspection_id: inspectionId,
        checklist_item_id: itemId,
        result,
        comment: comment || null,
      },
      { onConflict: 'inspection_id,checklist_item_id' }
    );

    pendingSaves.current -= 1;
    if (error) {
      setSaveStatus('error');
    } else if (pendingSaves.current === 0) {
      setSaveStatus('saved');
    }
  }

  function setItem(areaId: string, itemId: string, category: ItemCategory, patch: Partial<ItemState>) {
    setAreaState((prev) => ({
      ...prev,
      [areaId]: {
        items: { ...prev[areaId].items, [itemId]: { ...prev[areaId].items[itemId], ...patch } },
      },
    }));

    const passKey = category === 'cleaning' ? 'cleaningPass' : 'maintenancePass';
    const commentKey = category === 'cleaning' ? 'cComment' : 'mComment';

    // Pass/Fail taps save immediately
    if (passKey in patch) {
      const passValue = patch[passKey as keyof ItemState] as PassState;
      if (passValue !== null) {
        const comment = (patch[commentKey as keyof ItemState] as string) ?? areaState[areaId].items[itemId][commentKey];
        saveResult(itemId, passValue ? 'pass' : 'fail', comment);
      }
      return;
    }

    // Comment edits debounce for 600ms, and only save if a result already exists
    if (commentKey in patch) {
      const currentPass = areaState[areaId].items[itemId][passKey];
      if (currentPass === null) return; // nothing to attach the comment to yet
      clearTimeout(commentTimers.current[itemId]);
      commentTimers.current[itemId] = setTimeout(() => {
        const newComment = patch[commentKey as keyof ItemState] as string;
        saveResult(itemId, currentPass ? 'pass' : 'fail', newComment);
      }, 600);
    }
  }

  // ---- Mark the inspection complete once every item's been assessed, and
  // decrement the Monthly Inspect onboarding counter the first time this happens ----
  useEffect(() => {
    if (pct !== 100 || loading || completionHandled.current || !inspectionIdRef.current) return;
    completionHandled.current = true;

    (async () => {
      const inspectionId = inspectionIdRef.current!;
      await supabase
        .from('inspections')
        .update({ status: 'complete', completed_at: new Date().toISOString() })
        .eq('id', inspectionId);

      if (monthlyOnboardingRemaining > 0) {
        await supabase
          .from('sites')
          .update({ monthly_onboarding_inspections_remaining: monthlyOnboardingRemaining - 1 })
          .eq('id', siteDbId);
      }
    })();
  }, [pct, loading, supabase, siteDbId, monthlyOnboardingRemaining]);

  function floorStatus(floorId: string): 'not-started' | 'has-fails' | 'done' {
    const floor = site.floors.find((f) => f.id === floorId);
    if (!floor) return 'not-started';
    const items = floor.areas.flatMap((a) => a.items.map((it) => areaState[a.id]?.items[it.id]));
    const anyFail = items.some((it) => it?.cleaningPass === false || it?.maintenancePass === false);
    const anyAssessed = items.some((it) => it?.cleaningPass !== null || it?.maintenancePass !== null);
    const allAssessed = items.every((it) => it?.cleaningPass !== null && it?.maintenancePass !== null);
    if (anyFail) return 'has-fails';
    if (allAssessed && anyAssessed) return 'done';
    return 'not-started';
  }

  const activeFloor = site.floors.find((f) => f.id === activeFloorId);

  const failedAreas = site.floors
    .flatMap((f) => f.areas.map((a) => ({ floor: f, area: a })))
    .filter(({ area }) =>
      area.items.some(
        (it) =>
          areaState[area.id]?.items[it.id]?.cleaningPass === false ||
          areaState[area.id]?.items[it.id]?.maintenancePass === false
      )
    );

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center text-sm text-rsl-navy/50">
        Loading inspection…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-center">
        <p className="text-sm text-rsl-red font-semibold">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
      {/* Progress tracker */}
      <div className="sticky top-0 bg-white/95 backdrop-blur z-10 pt-4 pb-3 border-b border-rsl-navy/10">
        <div className="flex items-center justify-between text-sm mb-2 gap-2">
          <span className="font-semibold text-rsl-navy">
            {completedItems} / {totalItems} items complete ({pct}%)
          </span>
          <div className="flex gap-1 bg-rsl-navy/5 rounded-full p-1">
            <button
              onClick={() => setView('floor')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                view === 'floor' ? 'bg-rsl-navy text-white' : 'text-rsl-navy/60'
              }`}
            >
              Floor View
            </button>
            <button
              onClick={() => setView('attention')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                view === 'attention' ? 'bg-rsl-red text-white' : 'text-rsl-navy/60'
              }`}
            >
              Needs Attention {failedAreas.length > 0 && `(${failedAreas.length})`}
            </button>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-rsl-navy/10 overflow-hidden">
          <div className="h-full bg-rsl-red transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        {view === 'floor' && (
          <div className="flex gap-1.5 overflow-x-auto mt-3 pb-1 -mx-1 px-1">
            {site.floors.map((f) => {
              const status = floorStatus(f.id);
              return (
                <button
                  key={f.id}
                  onClick={() => setActiveFloorId(f.id)}
                  className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                    activeFloorId === f.id
                      ? 'border-rsl-navy bg-rsl-navy text-white'
                      : status === 'has-fails'
                      ? 'border-rsl-red/40 text-rsl-red bg-rsl-red/5'
                      : status === 'done'
                      ? 'border-pass/40 text-pass bg-pass/5'
                      : 'border-rsl-navy/15 text-rsl-navy/60'
                  }`}
                >
                  {f.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floor view */}
      {view === 'floor' && activeFloor && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-rsl-navy">{activeFloor.name}</h2>
            <SaveIndicator status={saveStatus} />
          </div>
          {activeFloor.areas.map((a) => (
            <AreaCard
              key={a.id}
              areaName={a.name}
              items={a.items}
              state={areaState[a.id]}
              onSetItem={(itemId, category, patch) => setItem(a.id, itemId, category, patch)}
            />
          ))}
        </div>
      )}

      {/* Needs attention view */}
      {view === 'attention' && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-rsl-red">
              Needs Attention — {failedAreas.length} area{failedAreas.length !== 1 && 's'}
            </h2>
            <SaveIndicator status={saveStatus} />
          </div>
          {failedAreas.length === 0 && (
            <p className="text-sm text-rsl-navy/50 py-8 text-center">No fails logged yet.</p>
          )}
          {failedAreas.map(({ floor, area: a }) => (
            <div key={a.id}>
              <div className="text-xs uppercase tracking-wide text-rsl-navy/40 font-semibold mb-1.5">
                {floor.name}
              </div>
              <AreaCard
                areaName={a.name}
                items={a.items}
                state={areaState[a.id]}
                onSetItem={(itemId, category, patch) => setItem(a.id, itemId, category, patch)}
              />
            </div>
          ))}
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
  return <span className={`text-xs font-semibold shrink-0 ${color}`}>{label}</span>;
}

function AreaCard({
  areaName,
  items,
  state,
  onSetItem,
}: {
  areaName: string;
  items: { id: string; name: string; category: ItemCategory }[];
  state: AreaState;
  onSetItem: (itemId: string, category: ItemCategory, patch: Partial<ItemState>) => void;
}) {
  const cleaningItem = items.find((i) => i.category === 'cleaning');
  const maintenanceItem = items.find((i) => i.category === 'maintenance');

  // Completion is now derived from real saved data rather than a separate manual
  // toggle — a manual "mark complete" flag isn't part of the schema, and a toggle
  // that resets on reload would be misleading now that answers actually persist.
  const allAssessed = items.every((it) => {
    const s = state.items[it.id];
    return it.category === 'cleaning' ? s.cleaningPass !== null : s.maintenancePass !== null;
  });

  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        allAssessed ? 'border-pass/40 bg-pass/[0.04]' : 'border-rsl-navy/10'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-rsl-navy">{areaName}</h3>
        {allAssessed && (
          <span className="text-xs font-semibold px-3 py-1 rounded-full bg-pass text-white">
            Area Complete ✓
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cleaningItem && (
          <PassFailPanel
            label="Cleaning"
            item={state.items[cleaningItem.id]}
            onChange={(patch) => onSetItem(cleaningItem.id, 'cleaning', patch)}
            commentKey="cComment"
            passKey="cleaningPass"
          />
        )}
        {maintenanceItem && (
          <PassFailPanel
            label="Maintenance"
            item={state.items[maintenanceItem.id]}
            onChange={(patch) => onSetItem(maintenanceItem.id, 'maintenance', patch)}
            commentKey="mComment"
            passKey="maintenancePass"
          />
        )}
      </div>
    </div>
  );
}

function PassFailPanel({
  label,
  item,
  onChange,
  commentKey,
  passKey,
}: {
  label: string;
  item: ItemState;
  onChange: (patch: Partial<ItemState>) => void;
  commentKey: 'cComment' | 'mComment';
  passKey: 'cleaningPass' | 'maintenancePass';
}) {
  const isFail = item[passKey] === false;

  return (
    <div className="rounded-xl bg-rsl-navy/[0.03] p-3">
      <div className="text-xs font-semibold text-rsl-navy/50 mb-2">{label}</div>
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => onChange({ [passKey]: true } as Partial<ItemState>)}
          className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors ${
            item[passKey] === true ? 'bg-pass text-white' : 'bg-white text-rsl-navy/40 border border-rsl-navy/10'
          }`}
        >
          Pass
        </button>
        <button
          onClick={() => onChange({ [passKey]: false } as Partial<ItemState>)}
          className={`flex-1 text-sm font-semibold py-2 rounded-lg transition-colors ${
            isFail ? 'bg-rsl-red text-white' : 'bg-white text-rsl-navy/40 border border-rsl-navy/10'
          }`}
        >
          Fail
        </button>
      </div>

      {isFail && (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Comment (e.g. patch paint required)"
            value={item[commentKey]}
            onChange={(e) => onChange({ [commentKey]: e.target.value } as Partial<ItemState>)}
            className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 focus:border-rsl-red outline-none"
          />
          <button className="w-full text-xs font-semibold text-rsl-navy/50 border border-dashed border-rsl-navy/20 rounded-lg py-2 hover:border-rsl-red/40 hover:text-rsl-red transition-colors">
            + Add photo (up to 2)
          </button>
        </div>
      )}
    </div>
  );
}
