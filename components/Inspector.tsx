'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { Site, Floor, FloorArea, ItemCategory } from '@/lib/sites';
import { CLEANING_PHRASES, MAINTENANCE_PHRASES } from '@/lib/common-phrases';

type PassState = boolean | null; // null = not yet assessed
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ItemState {
  cleaningPass: PassState;
  maintenancePass: PassState;
  cComment: string;
  mComment: string;
  photoUrls: string[]; // storage paths in the inspection-photos bucket, max 2
}

interface AreaState {
  items: Record<string, ItemState>; // keyed by checklist item id
}

function emptyItemState(): ItemState {
  return { cleaningPass: null, maintenancePass: null, cComment: '', mComment: '', photoUrls: [] };
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
  canClearInspections,
}: {
  site: Site;
  siteDbId: string;
  inspectorId: string;
  monthlyOnboardingRemaining: number;
  canClearInspections: boolean;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [activeFloorId, setActiveFloorId] = useState(site.floors[0]?.id ?? '');
  const [view, setView] = useState<'floor' | 'attention' | 'summary'>('floor');

  // Local mutable copy of the site's floor/area structure — cloned once from the
  // `site` prop. Renaming, adding, deleting, and reordering areas all operate on
  // this state and write through to Supabase, rather than mutating the prop.
  const [floors, setFloors] = useState<Floor[]>(() => structuredClone(site.floors));

  // Zones and item labels are only editable during a site's first 3 monthly
  // inspections — matches monthly_onboarding_inspections_remaining, which the
  // completion effect below decrements. Once it hits 0, editing locks to Admin-only.
  const canEditStructure = monthlyOnboardingRemaining > 0;

  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);

  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editingAreaName, setEditingAreaName] = useState('');

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState('');

  const [addingAreaToFloor, setAddingAreaToFloor] = useState<string | null>(null);
  const [newAreaName, setNewAreaName] = useState('');

  const [draggingAreaId, setDraggingAreaId] = useState<string | null>(null);
  const dragFloorId = useRef<string | null>(null);
  const areaCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [photoUploadState, setPhotoUploadState] = useState<
    Record<string, { busy: boolean; error: string | null }>
  >({});

  const [reportBusy, setReportBusy] = useState<'download' | 'email' | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const [inspectionStatus, setInspectionStatus] = useState<'in_progress' | 'complete' | null>(null);
  const [inspectionCompletedAt, setInspectionCompletedAt] = useState<string | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

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
        .select('id, status, completed_at')
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
        if (!cancelled) {
          setInspectionStatus('complete');
          setInspectionCompletedAt(existing.completed_at);
        }
      }

      inspectionIdRef.current = inspectionId;

      const { data: savedItems, error: itemsErr } = await supabase
        .from('inspection_items')
        .select('checklist_item_id, result, comment, photo_urls')
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
              state.photoUrls = row.photo_urls ?? [];
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

  const totalItems = floors.flatMap((f) => f.areas).flatMap((a) => a.items).length;
  const completedItems = Object.values(areaState)
    .flatMap((a) => Object.values(a.items))
    .filter((it) => it.cleaningPass !== null || it.maintenancePass !== null).length;
  const pct = totalItems ? Math.round((completedItems / totalItems) * 100) : 0;

  // ---- Autosave: upsert one inspection_items row per checklist item.
  // Unique(inspection_id, checklist_item_id) makes this a safe upsert — no duplicate-row risk. ----
  async function saveResult(itemId: string, result: 'pass' | 'fail', comment: string, photoUrls?: string[]) {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;

    pendingSaves.current += 1;
    setSaveStatus('saving');

    const payload: Record<string, unknown> = {
      inspection_id: inspectionId,
      checklist_item_id: itemId,
      result,
      comment: comment || null,
    };
    if (photoUrls !== undefined) payload.photo_urls = photoUrls;

    const { error } = await supabase
      .from('inspection_items')
      .upsert(payload, { onConflict: 'inspection_id,checklist_item_id' });

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
        const photoUrls = (patch.photoUrls as string[] | undefined) ?? areaState[areaId].items[itemId].photoUrls;
        saveResult(itemId, passValue ? 'pass' : 'fail', comment, photoUrls);
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
        saveResult(itemId, currentPass ? 'pass' : 'fail', newComment, areaState[areaId].items[itemId].photoUrls);
      }, 600);
    }

    // Photo changes save immediately, same as Pass/Fail — but only if a result already exists
    if ('photoUrls' in patch) {
      const currentPass = areaState[areaId].items[itemId][passKey];
      if (currentPass === null) return;
      const comment = areaState[areaId].items[itemId][commentKey];
      const photoUrls = patch.photoUrls as string[];
      saveResult(itemId, currentPass ? 'pass' : 'fail', comment, photoUrls);
    }
  }

  // ---- Mark the inspection complete once every item's been assessed, and
  // decrement the Monthly Inspect onboarding counter the first time this happens ----
  useEffect(() => {
    if (pct !== 100 || loading || completionHandled.current || !inspectionIdRef.current) return;
    completionHandled.current = true;
    setView('summary');

    (async () => {
      const inspectionId = inspectionIdRef.current!;
      const completedAt = new Date().toISOString();
      await supabase
        .from('inspections')
        .update({ status: 'complete', completed_at: completedAt })
        .eq('id', inspectionId);

      setInspectionStatus('complete');
      setInspectionCompletedAt(completedAt);

      if (monthlyOnboardingRemaining > 0) {
        await supabase
          .from('sites')
          .update({ monthly_onboarding_inspections_remaining: monthlyOnboardingRemaining - 1 })
          .eq('id', siteDbId);
      }
    })();
  }, [pct, loading, supabase, siteDbId, monthlyOnboardingRemaining]);

  function floorStatus(floorId: string): 'not-started' | 'has-fails' | 'done' {
    const floor = floors.find((f) => f.id === floorId);
    if (!floor) return 'not-started';
    const items = floor.areas.flatMap((a) => a.items.map((it) => areaState[a.id]?.items[it.id]));
    const anyFail = items.some((it) => it?.cleaningPass === false || it?.maintenancePass === false);
    const anyAssessed = items.some((it) => it?.cleaningPass !== null || it?.maintenancePass !== null);
    const allAssessed = items.every((it) => it?.cleaningPass !== null && it?.maintenancePass !== null);
    if (anyFail) return 'has-fails';
    if (allAssessed && anyAssessed) return 'done';
    return 'not-started';
  }

  // Completion is tracked separately from floorStatus's color-coding — a floor with
  // fails can still be "complete" (every item assessed one way or the other), and
  // that's what Next Floor navigation and the per-floor % badge care about.
  function isFloorComplete(floorId: string): boolean {
    const floor = floors.find((f) => f.id === floorId);
    if (!floor) return false;
    const items = floor.areas.flatMap((a) => a.items.map((it) => areaState[a.id]?.items[it.id]));
    if (items.length === 0) return false;
    return items.every((it) => it?.cleaningPass !== null && it?.maintenancePass !== null);
  }

  function floorPct(floorId: string): number {
    const floor = floors.find((f) => f.id === floorId);
    if (!floor) return 0;
    const items = floor.areas.flatMap((a) => a.items.map((it) => areaState[a.id]?.items[it.id]));
    if (items.length === 0) return 0;
    const done = items.filter((it) => it?.cleaningPass !== null && it?.maintenancePass !== null).length;
    return Math.round((done / items.length) * 100);
  }

  // Next incomplete floor after the current one, wrapping around to the start —
  // skips floors that are already fully assessed so the inspector always lands
  // somewhere there's still work to do.
  function nextIncompleteFloorId(): string | null {
    const currentIndex = floors.findIndex((f) => f.id === activeFloorId);
    for (let i = currentIndex + 1; i < floors.length; i++) {
      if (!isFloorComplete(floors[i].id)) return floors[i].id;
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!isFloorComplete(floors[i].id)) return floors[i].id;
    }
    return null;
  }

  function goToNextFloor() {
    const nextId = nextIncompleteFloorId();
    if (!nextId) return;
    setActiveFloorId(nextId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- Structure editing: rename/add/delete areas, rename items, drag reorder.
  // All gated by canEditStructure (locks after the site's first 3 inspections). ----

  function startEditArea(area: FloorArea) {
    if (!canEditStructure) return;
    setEditingAreaId(area.id);
    setEditingAreaName(area.name);
  }

  async function saveAreaName(floorId: string, areaId: string) {
    const trimmed = editingAreaName.trim();
    setEditingAreaId(null);
    if (!trimmed) return;

    setFloors((prev) =>
      prev.map((f) =>
        f.id === floorId
          ? { ...f, areas: f.areas.map((a) => (a.id === areaId ? { ...a, name: trimmed } : a)) }
          : f
      )
    );

    const { error } = await supabase.from('floor_areas').update({ area_name: trimmed }).eq('id', areaId);
    if (error) setStructureError(`Couldn't rename that zone: ${error.message}`);
  }

  function startEditItem(item: { id: string; name: string }) {
    if (!canEditStructure) return;
    setEditingItemId(item.id);
    setEditingItemName(item.name);
  }

  async function saveItemName(areaId: string, itemId: string) {
    const trimmed = editingItemName.trim();
    setEditingItemId(null);
    if (!trimmed) return;

    setFloors((prev) =>
      prev.map((f) => ({
        ...f,
        areas: f.areas.map((a) =>
          a.id === areaId
            ? { ...a, items: a.items.map((it) => (it.id === itemId ? { ...it, name: trimmed } : it)) }
            : a
        ),
      }))
    );

    const { error } = await supabase.from('checklist_items').update({ item_name: trimmed }).eq('id', itemId);
    if (error) setStructureError(`Couldn't rename that item: ${error.message}`);
  }

  async function addAreaToFloor(floorId: string) {
    const trimmed = newAreaName.trim();
    if (!trimmed) return;
    const floor = floors.find((f) => f.id === floorId);
    if (!floor) return;

    setStructureBusy(true);
    setStructureError(null);

    // Insert the area first so we get a real id back from Supabase.
    const { data: areaRow, error: areaErr } = await supabase
      .from('floor_areas')
      .insert({
        site_id: siteDbId,
        floor_name: floor.name,
        area_name: trimmed,
        sort_order: 999999, // temporary — persistOrder() below renumbers everything sequentially
      })
      .select('id')
      .single();

    if (areaErr || !areaRow) {
      setStructureBusy(false);
      setStructureError(`Couldn't add "${trimmed}": ${areaErr?.message ?? 'unknown error'}`);
      return;
    }

    // Match the standard two-item shape (Cleaning + Maintenance) every other area has.
    const { data: itemRows, error: itemErr } = await supabase
      .from('checklist_items')
      .insert([
        { area_id: areaRow.id, item_name: 'General condition', category: 'cleaning' },
        { area_id: areaRow.id, item_name: 'General condition', category: 'maintenance' },
      ])
      .select('id, item_name, category');

    if (itemErr || !itemRows) {
      setStructureBusy(false);
      setStructureError(`Zone added, but couldn't set up its checklist items: ${itemErr?.message}`);
      return;
    }

    const newArea: FloorArea = {
      id: areaRow.id,
      name: trimmed,
      items: itemRows.map((it) => ({
        id: it.id,
        name: it.item_name,
        category: it.category as ItemCategory,
      })),
    };

    setFloors((prev) =>
      prev.map((f) => (f.id === floorId ? { ...f, areas: [...f.areas, newArea] } : f))
    );
    setAreaState((prev) => {
      const items: Record<string, ItemState> = {};
      newArea.items.forEach((it) => (items[it.id] = emptyItemState()));
      return { ...prev, [newArea.id]: { items } };
    });

    setAddingAreaToFloor(null);
    setNewAreaName('');
    await persistOrder([...floors.filter((f) => f.id !== floorId), { ...floor, areas: [...floor.areas, newArea] }]);
    setStructureBusy(false);
  }

  async function deleteAreaHandler(floorId: string, area: FloorArea) {
    if (
      !window.confirm(
        `Remove "${area.name}"? This deletes its checklist items and any saved answers for this inspection. This can't be undone.`
      )
    )
      return;

    setStructureBusy(true);
    setStructureError(null);

    const { error } = await supabase.from('floor_areas').delete().eq('id', area.id);
    if (error) {
      setStructureBusy(false);
      setStructureError(`Couldn't remove "${area.name}": ${error.message}`);
      return;
    }

    setFloors((prev) =>
      prev.map((f) => (f.id === floorId ? { ...f, areas: f.areas.filter((a) => a.id !== area.id) } : f))
    );
    setStructureBusy(false);
  }

  // Renumbers every area across the whole site sequentially (0, 1, 2, …) in the
  // order the given floors/areas structure implies, and writes it to Supabase.
  // Using a full renumber — rather than gap-based insertion — avoids any risk of
  // a new or reordered area's sort_order value colliding with a neighbouring
  // floor's, which would scramble floor grouping on the site detail page.
  async function persistOrder(orderedFloors: Floor[]) {
    const orderedIds = orderedFloors.flatMap((f) => f.areas.map((a) => a.id));
    setSaveStatus('saving');
    const results = await Promise.all(
      orderedIds.map((id, index) => supabase.from('floor_areas').update({ sort_order: index }).eq('id', id))
    );
    setSaveStatus(results.some((r) => r.error) ? 'error' : 'saved');
  }

  function startDragArea(floorId: string, areaId: string) {
    if (!canEditStructure) return;
    dragFloorId.current = floorId;
    setDraggingAreaId(areaId);
  }

  useEffect(() => {
    if (!draggingAreaId || !dragFloorId.current) return;
    const floorId = dragFloorId.current;

    function onPointerMove(e: PointerEvent) {
      setFloors((prev) => {
        const floor = prev.find((f) => f.id === floorId);
        if (!floor) return prev;
        const draggedIndex = floor.areas.findIndex((a) => a.id === draggingAreaId);
        if (draggedIndex === -1) return prev;

        let overIndex = floor.areas.length - 1;
        for (let i = 0; i < floor.areas.length; i++) {
          const el = areaCardRefs.current[floor.areas[i].id];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          if (e.clientY < mid) {
            overIndex = i;
            break;
          }
        }

        if (overIndex === draggedIndex) return prev;

        const nextAreas = [...floor.areas];
        const [moved] = nextAreas.splice(draggedIndex, 1);
        nextAreas.splice(overIndex, 0, moved);
        return prev.map((f) => (f.id === floorId ? { ...f, areas: nextAreas } : f));
      });
    }

    function onPointerUp() {
      setDraggingAreaId(null);
      dragFloorId.current = null;
      setFloors((current) => {
        persistOrder(current);
        return current;
      });
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingAreaId]);

  // ---- Photo upload: resize/compress client-side before uploading, since field
  // photos from phones are often 3-10MB and site wifi can be patchy ----
  function compressImage(file: File, maxDim = 1600, quality = 0.8): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        URL.revokeObjectURL(objectUrl);
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', quality);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not read that image'));
      };
      img.src = objectUrl;
    });
  }

  function resolvePhotoUrl(path: string): string {
    return supabase.storage.from('inspection-photos').getPublicUrl(path).data.publicUrl;
  }

  function findAreaForItem(itemId: string): FloorArea | undefined {
    return floors.flatMap((f) => f.areas).find((a) => a.items.some((it) => it.id === itemId));
  }

  async function uploadPhoto(itemId: string, category: ItemCategory, file: File) {
    const inspectionId = inspectionIdRef.current;
    const area = findAreaForItem(itemId);
    if (!inspectionId || !area) return;

    const currentUrls = areaState[area.id]?.items[itemId]?.photoUrls ?? [];
    if (currentUrls.length >= 2) return;

    setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: true, error: null } }));

    try {
      const blob = await compressImage(file);
      const path = `${inspectionId}/${itemId}/${crypto.randomUUID()}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from('inspection-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

      if (uploadErr) throw uploadErr;

      const nextUrls = [...currentUrls, path];
      setItem(area.id, itemId, category, { photoUrls: nextUrls });
      setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: false, error: null } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: false, error: message } }));
    }
  }

  async function removePhoto(itemId: string, category: ItemCategory, path: string) {
    const area = findAreaForItem(itemId);
    if (!area) return;

    const currentUrls = areaState[area.id]?.items[itemId]?.photoUrls ?? [];
    const nextUrls = currentUrls.filter((p) => p !== path);
    setItem(area.id, itemId, category, { photoUrls: nextUrls });

    const { error } = await supabase.storage.from('inspection-photos').remove([path]);
    if (error) {
      setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: false, error: error.message } }));
    }
  }

  async function downloadReport() {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;
    setReportBusy('download');
    setReportMessage(null);

    // Open the tab synchronously, before any await — browsers only trust
    // window.open() to skip the popup blocker when it's called directly inside
    // the click handler. Doing this after an awaited fetch gets silently blocked
    // with no error, which is exactly what looked like "nothing happened."
    const newTab = window.open('', '_blank');

    try {
      const res = await fetch(`/api/reports/${inspectionId}/pdf`);
      if (!res.ok) throw new Error('Could not generate the report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (newTab) {
        newTab.location.href = url;
      } else {
        // Even the empty tab got blocked — fall back to forcing a direct download.
        const a = document.createElement('a');
        a.href = url;
        a.download = `${site.name.replace(/[^a-z0-9]+/gi, '-')}-inspection-report.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      newTab?.close();
      setReportMessage(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setReportBusy(null);
    }
  }

  async function emailReport() {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;
    setReportBusy('email');
    setReportMessage(null);
    try {
      const res = await fetch(`/api/reports/${inspectionId}/email`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send the report');
      setReportMessage(`Sent to ${(json.sentTo as string[]).join(', ')}`);
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setReportBusy(null);
    }
  }

  // Wipes this month's inspection back to a blank slate: deletes saved answers and
  // uploaded photos, resets the inspection to in_progress, and resets the site's
  // onboarding counter to 3. That last part is deliberate — this is a "pretend this
  // never happened" reset for testing/training, not something a real completed
  // inspection should ever go through, so it shouldn't count against the site's
  // real first-3-inspections editing window.
  async function clearInspection() {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;
    if (
      !window.confirm(
        'Clear this inspection? This deletes every saved answer and photo for this month and resets the zone/item editing counter back to 3. This cannot be undone.'
      )
    )
      return;

    setClearBusy(true);
    setClearError(null);

    try {
      const { data: photoFiles } = await supabase.storage.from('inspection-photos').list(inspectionId);
      if (photoFiles && photoFiles.length > 0) {
        // Photos are nested one folder deeper, per checklist item id.
        const nested = await Promise.all(
          photoFiles.map((f) => supabase.storage.from('inspection-photos').list(`${inspectionId}/${f.name}`))
        );
        const paths = nested.flatMap((res, i) =>
          (res.data ?? []).map((file) => `${inspectionId}/${photoFiles[i].name}/${file.name}`)
        );
        if (paths.length > 0) {
          await supabase.storage.from('inspection-photos').remove(paths);
        }
      }

      const { error: deleteErr } = await supabase
        .from('inspection_items')
        .delete()
        .eq('inspection_id', inspectionId);
      if (deleteErr) throw deleteErr;

      const { error: updateErr } = await supabase
        .from('inspections')
        .update({ status: 'in_progress', completed_at: null })
        .eq('id', inspectionId);
      if (updateErr) throw updateErr;

      const { error: siteErr } = await supabase
        .from('sites')
        .update({ monthly_onboarding_inspections_remaining: 3 })
        .eq('id', siteDbId);
      if (siteErr) throw siteErr;

      // Reset all local state back to a fresh blank inspection.
      setAreaState(() => {
        const initial: Record<string, AreaState> = {};
        for (const area of site.floors.flatMap((f) => f.areas)) {
          const items: Record<string, ItemState> = {};
          area.items.forEach((it) => (items[it.id] = emptyItemState()));
          initial[area.id] = { items };
        }
        return initial;
      });
      completionHandled.current = false;
      setInspectionStatus('in_progress');
      setInspectionCompletedAt(null);
      setView('floor');
    } catch (err) {
      setClearError(err instanceof Error ? err.message : 'Could not clear this inspection');
    } finally {
      setClearBusy(false);
    }
  }

  const activeFloor = floors.find((f) => f.id === activeFloorId);

  const failedAreas = floors
    .flatMap((f) => f.areas.map((a) => ({ floor: f, area: a })))
    .filter(({ area }) =>
      area.items.some(
        (it) =>
          areaState[area.id]?.items[it.id]?.cleaningPass === false ||
          areaState[area.id]?.items[it.id]?.maintenancePass === false
      )
    );

  // Per-floor pass/fail tallies for the Summary screen
  const floorStats = floors.map((f) => {
    const items = f.areas.flatMap((a) => a.items.map((it) => ({ areaId: a.id, itemId: it.id })));
    let pass = 0;
    let fail = 0;
    for (const { areaId, itemId } of items) {
      const s = areaState[areaId]?.items[itemId];
      if (s?.cleaningPass === true || s?.maintenancePass === true) pass += 1;
      if (s?.cleaningPass === false || s?.maintenancePass === false) fail += 1;
    }
    return { floor: f, total: items.length, pass, fail };
  });

  const totalPass = floorStats.reduce((sum, s) => sum + s.pass, 0);
  const totalFail = floorStats.reduce((sum, s) => sum + s.fail, 0);

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
      {inspectionStatus === 'complete' && (
        <div className="mt-4 rounded-xl border border-pass/30 bg-pass/5 p-3.5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-pass">
              Completed {inspectionCompletedAt ? new Date(inspectionCompletedAt).toLocaleDateString('en-AU') : ''}
            </p>
            <p className="text-xs text-rsl-navy/50">You can still review or edit answers below.</p>
          </div>
          {canClearInspections && (
            <button
              onClick={clearInspection}
              disabled={clearBusy}
              className="text-xs font-semibold text-rsl-red border border-rsl-red/30 rounded-lg px-3 py-2 disabled:opacity-40 shrink-0"
            >
              {clearBusy ? 'Clearing…' : 'Clear & Restart (testing only)'}
            </button>
          )}
        </div>
      )}
      {clearError && (
        <div className="mt-3 rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red">
          {clearError}
        </div>
      )}

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
            {pct === 100 && (
              <button
                onClick={() => setView('summary')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                  view === 'summary' ? 'bg-pass text-white' : 'text-rsl-navy/60'
                }`}
              >
                Summary
              </button>
            )}
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-rsl-navy/10 overflow-hidden">
          <div className="h-full bg-rsl-red transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>

        {view === 'floor' && (
          <div className="flex gap-1.5 overflow-x-auto mt-3 pb-1 -mx-1 px-1">
            {floors.map((f) => {
              const status = floorStatus(f.id);
              const floorPercent = floorPct(f.id);
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
                  <span
                    className={`ml-1.5 ${activeFloorId === f.id ? 'text-white/60' : 'opacity-60'}`}
                  >
                    {floorPercent}%
                  </span>
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
            <div className="flex items-center gap-2">
              <h2 className="font-display font-bold text-rsl-navy">{activeFloor.name}</h2>
              {canEditStructure && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-rsl-gold bg-rsl-gold/10 rounded-full px-2 py-0.5">
                  Editable · first 3 inspections
                </span>
              )}
            </div>
            <SaveIndicator status={saveStatus} />
          </div>

          {structureError && (
            <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red flex items-start justify-between gap-3">
              <span>{structureError}</span>
              <button onClick={() => setStructureError(null)} className="text-rsl-red/60 shrink-0">
                ✕
              </button>
            </div>
          )}

          {activeFloor.areas.map((a) => (
            <div
              key={a.id}
              ref={(el) => {
                areaCardRefs.current[a.id] = el;
              }}
            >
              <AreaCard
                areaId={a.id}
                areaName={a.name}
                items={a.items}
                state={areaState[a.id]}
                onSetItem={(itemId, category, patch) => setItem(a.id, itemId, category, patch)}
                editable={canEditStructure}
                isEditingName={editingAreaId === a.id}
                editingName={editingAreaName}
                onStartEditName={() => startEditArea(a)}
                onEditNameChange={setEditingAreaName}
                onSaveName={() => saveAreaName(activeFloor.id, a.id)}
                onCancelEditName={() => setEditingAreaId(null)}
                onDelete={() => deleteAreaHandler(activeFloor.id, a)}
                editingItemId={editingItemId}
                editingItemName={editingItemName}
                onStartEditItem={startEditItem}
                onEditItemNameChange={setEditingItemName}
                onSaveItemName={(itemId) => saveItemName(a.id, itemId)}
                onCancelEditItem={() => setEditingItemId(null)}
                isDragging={draggingAreaId === a.id}
                onDragHandlePointerDown={() => startDragArea(activeFloor.id, a.id)}
                busy={structureBusy}
                onUploadPhoto={uploadPhoto}
                onRemovePhoto={removePhoto}
                resolvePhotoUrl={resolvePhotoUrl}
                photoUploadState={photoUploadState}
              />
            </div>
          ))}

          {canEditStructure &&
            (addingAreaToFloor === activeFloor.id ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newAreaName}
                  onChange={(e) => setNewAreaName(e.target.value)}
                  placeholder="New zone name"
                  className="flex-1 text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
                />
                <button
                  onClick={() => addAreaToFloor(activeFloor.id)}
                  disabled={structureBusy || !newAreaName.trim()}
                  className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 disabled:opacity-40"
                >
                  {structureBusy ? 'Saving…' : 'Add'}
                </button>
                <button
                  onClick={() => {
                    setAddingAreaToFloor(null);
                    setNewAreaName('');
                  }}
                  className="text-sm font-semibold text-rsl-navy/50 px-2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingAreaToFloor(activeFloor.id)}
                className="text-sm font-semibold text-rsl-blue hover:underline"
              >
                + Add zone to this floor
              </button>
            ))}

          <NextFloorPrompt
            nextFloorName={floors.find((f) => f.id === nextIncompleteFloorId())?.name ?? null}
            allComplete={pct === 100}
            onNext={goToNextFloor}
            onViewSummary={() => setView('summary')}
          />
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
                onUploadPhoto={uploadPhoto}
                onRemovePhoto={removePhoto}
                resolvePhotoUrl={resolvePhotoUrl}
                photoUploadState={photoUploadState}
              />
            </div>
          ))}
        </div>
      )}

      {/* Summary view — shown once every item across every floor has been assessed */}
      {view === 'summary' && (
        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border border-pass/30 bg-pass/5 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-pass mb-1">
              Inspection Complete
            </p>
            <p className="text-2xl font-display font-bold text-rsl-navy">
              {totalPass} passed · {totalFail} failed
            </p>
            <p className="text-xs text-rsl-navy/50 mt-1">
              {totalItems} items across {floors.length} floor{floors.length !== 1 && 's'}
            </p>
          </div>

          <div>
            <h3 className="font-display font-bold text-rsl-navy text-sm mb-2">By floor</h3>
            <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
                  <tr>
                    <th className="font-semibold px-4 py-2.5">Floor</th>
                    <th className="font-semibold px-4 py-2.5 text-right">Pass</th>
                    <th className="font-semibold px-4 py-2.5 text-right">Fail</th>
                  </tr>
                </thead>
                <tbody>
                  {floorStats.map(({ floor, pass, fail }) => (
                    <tr key={floor.id} className="border-t border-rsl-navy/5">
                      <td className="px-4 py-2.5 text-rsl-navy">{floor.name}</td>
                      <td className="px-4 py-2.5 text-right text-pass font-semibold">{pass}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-rsl-red">
                        {fail || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {failedAreas.length > 0 && (
            <div>
              <h3 className="font-display font-bold text-rsl-red text-sm mb-2">
                Fail details — {failedAreas.length} area{failedAreas.length !== 1 && 's'}
              </h3>
              <div className="space-y-4">
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
                      onUploadPhoto={uploadPhoto}
                      onRemovePhoto={removePhoto}
                      resolvePhotoUrl={resolvePhotoUrl}
                      photoUploadState={photoUploadState}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2 space-y-2">
            <div className="flex gap-2">
              <button
                onClick={downloadReport}
                disabled={reportBusy !== null}
                className="flex-1 text-sm font-semibold text-rsl-navy border border-rsl-navy/20 rounded-xl py-3 disabled:opacity-40"
              >
                {reportBusy === 'download' ? 'Generating…' : 'View / Print PDF'}
              </button>
              <button
                onClick={emailReport}
                disabled={reportBusy !== null}
                className="flex-1 text-sm font-semibold text-white bg-rsl-navy rounded-xl py-3 disabled:opacity-40"
              >
                {reportBusy === 'email' ? 'Sending…' : 'Email Report'}
              </button>
            </div>
            {reportMessage && (
              <p className="text-xs text-center text-rsl-navy/60">{reportMessage}</p>
            )}
            <p className="text-[11px] text-rsl-navy/40 text-center">
              Email currently goes to the test account only, while rslqld.org is pending domain
              verification.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function NextFloorPrompt({
  nextFloorName,
  allComplete,
  onNext,
  onViewSummary,
}: {
  nextFloorName: string | null;
  allComplete: boolean;
  onNext: () => void;
  onViewSummary: () => void;
}) {
  if (allComplete) {
    return (
      <div className="rounded-2xl border border-pass/30 bg-pass/5 p-4 text-center space-y-2">
        <p className="text-sm font-semibold text-pass">
          All floors complete — inspection ready to submit.
        </p>
        <button
          onClick={onViewSummary}
          className="text-sm font-semibold text-white bg-pass rounded-lg px-4 py-2"
        >
          View Summary
        </button>
      </div>
    );
  }

  if (!nextFloorName) {
    return null; // nothing incomplete elsewhere — stay put and finish this floor
  }

  return (
    <button
      onClick={onNext}
      className="w-full text-sm font-semibold text-white bg-rsl-navy rounded-xl py-3.5 hover:bg-rsl-navy/90 transition-colors"
    >
      Next Floor: {nextFloorName} →
    </button>
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
  areaId,
  areaName,
  items,
  state,
  onSetItem,
  editable = false,
  isEditingName = false,
  editingName = '',
  onStartEditName,
  onEditNameChange,
  onSaveName,
  onCancelEditName,
  onDelete,
  editingItemId = null,
  editingItemName = '',
  onStartEditItem,
  onEditItemNameChange,
  onSaveItemName,
  onCancelEditItem,
  isDragging = false,
  onDragHandlePointerDown,
  busy = false,
  onUploadPhoto,
  onRemovePhoto,
  resolvePhotoUrl,
  photoUploadState = {},
}: {
  areaId?: string;
  areaName: string;
  items: { id: string; name: string; category: ItemCategory }[];
  state: AreaState;
  onSetItem: (itemId: string, category: ItemCategory, patch: Partial<ItemState>) => void;
  editable?: boolean;
  isEditingName?: boolean;
  editingName?: string;
  onStartEditName?: () => void;
  onEditNameChange?: (v: string) => void;
  onSaveName?: () => void;
  onCancelEditName?: () => void;
  onDelete?: () => void;
  editingItemId?: string | null;
  editingItemName?: string;
  onStartEditItem?: (item: { id: string; name: string }) => void;
  onEditItemNameChange?: (v: string) => void;
  onSaveItemName?: (itemId: string) => void;
  onCancelEditItem?: () => void;
  isDragging?: boolean;
  onDragHandlePointerDown?: () => void;
  busy?: boolean;
  onUploadPhoto?: (itemId: string, category: ItemCategory, file: File) => void;
  onRemovePhoto?: (itemId: string, category: ItemCategory, path: string) => void;
  resolvePhotoUrl?: (path: string) => string;
  photoUploadState?: Record<string, { busy: boolean; error: string | null }>;
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
        isDragging ? 'opacity-50 ring-2 ring-rsl-navy' : ''
      } ${allAssessed ? 'border-pass/40 bg-pass/[0.04]' : 'border-rsl-navy/10'}`}
    >
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {editable && onDragHandlePointerDown && (
            <button
              onPointerDown={(e) => {
                e.preventDefault();
                onDragHandlePointerDown();
              }}
              style={{ touchAction: 'none' }}
              className="shrink-0 text-rsl-navy/30 hover:text-rsl-navy/60 cursor-grab active:cursor-grabbing px-1"
              aria-label="Drag to reorder"
            >
              ⠿
            </button>
          )}

          {isEditingName ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <input
                autoFocus
                value={editingName}
                onChange={(e) => onEditNameChange?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onSaveName?.();
                  if (e.key === 'Escape') onCancelEditName?.();
                }}
                className="text-sm font-semibold text-rsl-navy rounded-lg border border-rsl-navy/20 px-2 py-1 min-w-0"
              />
              <button onClick={onSaveName} className="text-pass text-xs font-semibold shrink-0">
                Save
              </button>
              <button onClick={onCancelEditName} className="text-rsl-navy/40 text-xs font-semibold shrink-0">
                Cancel
              </button>
            </div>
          ) : (
            <h3 className="font-semibold text-rsl-navy truncate">{areaName}</h3>
          )}

          {editable && !isEditingName && (
            <button
              onClick={onStartEditName}
              className="shrink-0 text-rsl-navy/30 hover:text-rsl-navy/60 text-xs"
              aria-label="Rename zone"
            >
              ✎
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {allAssessed && (
            <span className="text-xs font-semibold px-3 py-1 rounded-full bg-pass text-white">
              Area Complete ✓
            </span>
          )}
          {editable && onDelete && (
            <button
              onClick={onDelete}
              disabled={busy}
              className="text-rsl-navy/30 hover:text-rsl-red text-xs disabled:opacity-40"
              aria-label="Remove zone"
            >
              🗑
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {cleaningItem && (
          <PassFailPanel
            label="Cleaning"
            itemName={cleaningItem.name}
            item={state.items[cleaningItem.id]}
            onChange={(patch) => onSetItem(cleaningItem.id, 'cleaning', patch)}
            commentKey="cComment"
            passKey="cleaningPass"
            editable={editable}
            isEditingName={editingItemId === cleaningItem.id}
            editingName={editingItemName}
            onStartEditName={() => onStartEditItem?.(cleaningItem)}
            onEditNameChange={onEditItemNameChange}
            onSaveName={() => onSaveItemName?.(cleaningItem.id)}
            onCancelEditName={onCancelEditItem}
            onUploadPhoto={onUploadPhoto ? (file) => onUploadPhoto(cleaningItem.id, 'cleaning', file) : undefined}
            onRemovePhoto={
              onRemovePhoto ? (path) => onRemovePhoto(cleaningItem.id, 'cleaning', path) : undefined
            }
            resolvePhotoUrl={resolvePhotoUrl}
            photoBusy={photoUploadState[cleaningItem.id]?.busy ?? false}
            photoError={photoUploadState[cleaningItem.id]?.error ?? null}
          />
        )}
        {maintenanceItem && (
          <PassFailPanel
            label="Maintenance"
            itemName={maintenanceItem.name}
            item={state.items[maintenanceItem.id]}
            onChange={(patch) => onSetItem(maintenanceItem.id, 'maintenance', patch)}
            commentKey="mComment"
            passKey="maintenancePass"
            editable={editable}
            isEditingName={editingItemId === maintenanceItem.id}
            editingName={editingItemName}
            onStartEditName={() => onStartEditItem?.(maintenanceItem)}
            onEditNameChange={onEditItemNameChange}
            onSaveName={() => onSaveItemName?.(maintenanceItem.id)}
            onCancelEditName={onCancelEditItem}
            onUploadPhoto={
              onUploadPhoto ? (file) => onUploadPhoto(maintenanceItem.id, 'maintenance', file) : undefined
            }
            onRemovePhoto={
              onRemovePhoto ? (path) => onRemovePhoto(maintenanceItem.id, 'maintenance', path) : undefined
            }
            resolvePhotoUrl={resolvePhotoUrl}
            photoBusy={photoUploadState[maintenanceItem.id]?.busy ?? false}
            photoError={photoUploadState[maintenanceItem.id]?.error ?? null}
          />
        )}
      </div>
    </div>
  );
}

function PassFailPanel({
  label,
  itemName,
  item,
  onChange,
  commentKey,
  passKey,
  editable = false,
  isEditingName = false,
  editingName = '',
  onStartEditName,
  onEditNameChange,
  onSaveName,
  onCancelEditName,
  onUploadPhoto,
  onRemovePhoto,
  resolvePhotoUrl,
  photoBusy = false,
  photoError = null,
}: {
  label: string;
  itemName?: string;
  item: ItemState;
  onChange: (patch: Partial<ItemState>) => void;
  commentKey: 'cComment' | 'mComment';
  passKey: 'cleaningPass' | 'maintenancePass';
  editable?: boolean;
  isEditingName?: boolean;
  editingName?: string;
  onStartEditName?: () => void;
  onEditNameChange?: (v: string) => void;
  onSaveName?: () => void;
  onCancelEditName?: () => void;
  onUploadPhoto?: (file: File) => void;
  onRemovePhoto?: (path: string) => void;
  resolvePhotoUrl?: (path: string) => string;
  photoBusy?: boolean;
  photoError?: string | null;
}) {
  const isFail = item[passKey] === false;

  return (
    <div className="rounded-xl bg-rsl-navy/[0.03] p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {isEditingName ? (
          <>
            <input
              autoFocus
              value={editingName}
              onChange={(e) => onEditNameChange?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveName?.();
                if (e.key === 'Escape') onCancelEditName?.();
              }}
              className="text-xs font-semibold rounded-lg border border-rsl-navy/20 px-1.5 py-0.5 min-w-0"
            />
            <button onClick={onSaveName} className="text-pass text-xs font-semibold">
              ✓
            </button>
            <button onClick={onCancelEditName} className="text-rsl-navy/40 text-xs font-semibold">
              ✕
            </button>
          </>
        ) : (
          <>
            <span className="text-xs font-semibold text-rsl-navy/50">
              {label}
              {itemName ? ` · ${itemName}` : ''}
            </span>
            {editable && (
              <button
                onClick={onStartEditName}
                className="text-rsl-navy/30 hover:text-rsl-navy/60 text-[10px]"
                aria-label={`Rename ${label} item`}
              >
                ✎
              </button>
            )}
          </>
        )}
      </div>
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
          <PhraseChips
            category={passKey === 'cleaningPass' ? 'cleaning' : 'maintenance'}
            value={item[commentKey]}
            onSelect={(phrase) => onChange({ [commentKey]: phrase } as Partial<ItemState>)}
          />
          <PhotoUploader
            photoUrls={item.photoUrls}
            resolvePhotoUrl={resolvePhotoUrl}
            onUploadPhoto={onUploadPhoto}
            onRemovePhoto={onRemovePhoto}
            busy={photoBusy}
            error={photoError}
          />
        </div>
      )}
    </div>
  );
}

function PhraseChips({
  category,
  value,
  onSelect,
}: {
  category: ItemCategory;
  value: string;
  onSelect: (phrase: string) => void;
}) {
  const phrases = category === 'cleaning' ? CLEANING_PHRASES : MAINTENANCE_PHRASES;
  const query = value.trim().toLowerCase();
  // Empty comment: show a starter set. Typing: filter down to matches anywhere in
  // the phrase (not just the start), so "paint" surfaces both "Cracked paint" and
  // "Patch paint required".
  const matches = query ? phrases.filter((p) => p.toLowerCase().includes(query)) : phrases.slice(0, 6);

  if (matches.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {matches.map((phrase) => (
        <button
          key={phrase}
          type="button"
          onClick={() => onSelect(phrase)}
          className="text-[11px] text-rsl-navy/60 bg-rsl-navy/5 hover:bg-rsl-navy/10 rounded-full px-2.5 py-1"
        >
          {phrase}
        </button>
      ))}
    </div>
  );
}

function PhotoUploader({
  photoUrls,
  resolvePhotoUrl,
  onUploadPhoto,
  onRemovePhoto,
  busy,
  error,
}: {
  photoUrls: string[];
  resolvePhotoUrl?: (path: string) => string;
  onUploadPhoto?: (file: File) => void;
  onRemovePhoto?: (path: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const inputId = useId();
  const atLimit = photoUrls.length >= 2;

  return (
    <div className="space-y-1.5">
      {photoUrls.length > 0 && (
        <div className="flex gap-2">
          {photoUrls.map((path) => (
            <div key={path} className="relative w-16 h-16 shrink-0">
              {resolvePhotoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={resolvePhotoUrl(path)}
                  alt="Inspection photo"
                  className="w-16 h-16 object-cover rounded-lg border border-rsl-navy/10"
                />
              )}
              {onRemovePhoto && (
                <button
                  onClick={() => onRemovePhoto(path)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rsl-navy text-white text-xs flex items-center justify-center"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!atLimit && onUploadPhoto && (
        <label
          htmlFor={inputId}
          className="w-full block text-center text-xs font-semibold text-rsl-navy/50 border border-dashed border-rsl-navy/20 rounded-lg py-2 hover:border-rsl-red/40 hover:text-rsl-red transition-colors cursor-pointer"
        >
          {busy ? 'Uploading…' : `+ Add photo (${photoUrls.length}/2)`}
          <input
            id={inputId}
            type="file"
            accept="image/*"
            className="hidden"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUploadPhoto(file);
              e.target.value = '';
            }}
          />
        </label>
      )}

      {error && <p className="text-xs text-rsl-red">{error}</p>}
    </div>
  );
}
