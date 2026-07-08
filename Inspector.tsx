'use client';

import { useMemo, useState } from 'react';
import type { Site, ItemCategory } from '@/lib/sites';

type PassState = boolean | null; // null = not yet assessed

interface ItemState {
  cleaningPass: PassState;
  maintenancePass: PassState;
  cComment: string;
  mComment: string;
}

interface AreaState {
  complete: boolean;
  items: Record<string, ItemState>; // keyed by checklist item id
}

function emptyItemState(): ItemState {
  return { cleaningPass: null, maintenancePass: null, cComment: '', mComment: '' };
}

export default function Inspector({ site }: { site: Site }) {
  const allAreaIds = useMemo(
    () => site.floors.flatMap((f) => f.areas.map((a) => a.id)),
    [site]
  );

  const [activeFloorId, setActiveFloorId] = useState(site.floors[0]?.id ?? '');
  const [view, setView] = useState<'floor' | 'attention'>('floor');
  const [areaState, setAreaState] = useState<Record<string, AreaState>>(() => {
    const init: Record<string, AreaState> = {};
    site.floors.forEach((f) =>
      f.areas.forEach((a) => {
        const items: Record<string, ItemState> = {};
        a.items.forEach((it) => (items[it.id] = emptyItemState()));
        init[a.id] = { complete: false, items };
      })
    );
    return init;
  });

  const totalItems = site.floors.flatMap((f) => f.areas).flatMap((a) => a.items).length;
  const completedItems = Object.values(areaState)
    .flatMap((a) => Object.values(a.items))
    .filter((it) => it.cleaningPass !== null || it.maintenancePass !== null).length;
  const pct = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;

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

  function setItem(areaId: string, itemId: string, patch: Partial<ItemState>) {
    setAreaState((prev) => ({
      ...prev,
      [areaId]: {
        ...prev[areaId],
        items: { ...prev[areaId].items, [itemId]: { ...prev[areaId].items[itemId], ...patch } },
      },
    }));
  }

  function toggleAreaComplete(areaId: string) {
    setAreaState((prev) => ({
      ...prev,
      [areaId]: { ...prev[areaId], complete: !prev[areaId].complete },
    }));
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

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
      {/* Progress tracker */}
      <div className="sticky top-0 bg-white/95 backdrop-blur z-10 pt-4 pb-3 border-b border-rsl-navy/10">
        <div className="flex items-center justify-between text-sm mb-2">
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
          <div
            className="h-full bg-rsl-red transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
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
                  {f.id.toUpperCase()}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Floor view */}
      {view === 'floor' && activeFloor && (
        <div className="mt-5 space-y-4">
          <h2 className="font-display font-bold text-rsl-navy">{activeFloor.name}</h2>
          {activeFloor.areas.map((a) => (
            <AreaCard
              key={a.id}
              areaName={a.name}
              items={a.items}
              state={areaState[a.id]}
              onSetItem={(itemId, patch) => setItem(a.id, itemId, patch)}
              onToggleComplete={() => toggleAreaComplete(a.id)}
            />
          ))}
        </div>
      )}

      {/* Needs attention view */}
      {view === 'attention' && (
        <div className="mt-5 space-y-4">
          <h2 className="font-display font-bold text-rsl-red">
            Needs Attention — {failedAreas.length} area{failedAreas.length !== 1 && 's'}
          </h2>
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
                onSetItem={(itemId, patch) => setItem(a.id, itemId, patch)}
                onToggleComplete={() => toggleAreaComplete(a.id)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AreaCard({
  areaName,
  items,
  state,
  onSetItem,
  onToggleComplete,
}: {
  areaName: string;
  items: { id: string; name: string; category: ItemCategory }[];
  state: AreaState;
  onSetItem: (itemId: string, patch: Partial<ItemState>) => void;
  onToggleComplete: () => void;
}) {
  const cleaningItem = items.find((i) => i.category === 'cleaning');
  const maintenanceItem = items.find((i) => i.category === 'maintenance');

  return (
    <div
      className={`rounded-2xl border p-4 transition-colors ${
        state.complete ? 'border-pass/40 bg-pass/[0.04]' : 'border-rsl-navy/10'
      }`}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-rsl-navy">{areaName}</h3>
        <button
          onClick={onToggleComplete}
          className={`text-xs font-semibold px-3 py-1 rounded-full transition-colors ${
            state.complete ? 'bg-pass text-white' : 'bg-rsl-navy/5 text-rsl-navy/50'
          }`}
        >
          {state.complete ? 'Area Complete ✓' : 'Mark Area Complete'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cleaningItem && (
          <PassFailPanel
            label="Cleaning"
            item={state.items[cleaningItem.id]}
            onChange={(patch) => onSetItem(cleaningItem.id, patch)}
            commentKey="cComment"
            passKey="cleaningPass"
          />
        )}
        {maintenanceItem && (
          <PassFailPanel
            label="Maintenance"
            item={state.items[maintenanceItem.id]}
            onChange={(patch) => onSetItem(maintenanceItem.id, patch)}
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
