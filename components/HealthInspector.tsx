'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { HealthCategory, HealthCondition, LifeExpectancyBand } from '@/lib/health';
import { CONDITION_OPTIONS, LIFE_EXPECTANCY_OPTIONS, computeRequiresAttention } from '@/lib/health';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface ItemState {
  condition: HealthCondition | null;
  lifeExpectancy: LifeExpectancyBand | null;
  comment: string;
  photoUrls: string[]; // storage paths in the shared inspection-photos bucket, max 2
}

function emptyItemState(): ItemState {
  return { condition: null, lifeExpectancy: null, comment: '', photoUrls: [] };
}

// health_inspections.year is a plain integer — one SOHC inspection per site per
// calendar year, same pattern as Stage 1's UNIQUE(site_id, period_month).
function currentYear(): number {
  return new Date().getFullYear();
}

export default function HealthInspector({
  siteDbId,
  siteName,
  categories,
  inspectorId,
  canClearInspections,
  sohcOnboardingRemaining,
}: {
  siteDbId: string;
  siteName: string;
  categories: HealthCategory[];
  inspectorId: string;
  canClearInspections: boolean;
  sohcOnboardingRemaining: number;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id ?? '');
  const [view, setView] = useState<'category' | 'summary'>('category');

  // Local mutable copy of the site's category/item structure — cloned once from
  // the `categories` prop. Renaming, adding, deleting, and reordering categories
  // and items all operate on this state and write through to Supabase, rather
  // than mutating the prop. Direct port of Stage 1's `floors` state pattern.
  const [categoriesState, setCategoriesState] = useState<HealthCategory[]>(() => structuredClone(categories));

  // Categories and item labels are only editable during a site's first 3 SOHC
  // inspections — matches sohc_onboarding_inspections_remaining, which the
  // completion effect below decrements. Once it hits 0, editing locks to Admin-only.
  const canEditStructure = sohcOnboardingRemaining > 0;

  const [structureError, setStructureError] = useState<string | null>(null);
  const [structureBusy, setStructureBusy] = useState(false);

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');

  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingItemName, setEditingItemName] = useState('');
  const [addingItemToCategory, setAddingItemToCategory] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');

  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const dragCategoryId = useRef<string | null>(null);
  const itemCardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [itemState, setItemState] = useState<Record<string, ItemState>>(() => {
    const init: Record<string, ItemState> = {};
    categories.forEach((c) => c.items.forEach((it) => (init[it.id] = emptyItemState())));
    return init;
  });

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [photoUploadState, setPhotoUploadState] = useState<
    Record<string, { busy: boolean; error: string | null }>
  >({});

  const [inspectionStatus, setInspectionStatus] = useState<'in_progress' | 'completed' | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState<'download' | 'email' | null>(null);
  const [reportMessage, setReportMessage] = useState<string | null>(null);

  const inspectionIdRef = useRef<string | null>(null);
  const pendingSaves = useRef(0);
  const completionHandled = useRef(false);
  const commentTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ---- Load real data on mount: find-or-create this year's SOHC inspection,
  // then read any health_inspection_items already saved against it ----
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);

      const year = currentYear();

      const { data: existing, error: findErr } = await supabase
        .from('health_inspections')
        .select('id, status')
        .eq('site_id', siteDbId)
        .eq('year', year)
        .maybeSingle();

      if (findErr) {
        if (!cancelled) setLoadError('Could not load this SOHC inspection. Try refreshing.');
        return;
      }

      let inspectionId = existing?.id ?? null;

      if (!inspectionId) {
        const { data: created, error: createErr } = await supabase
          .from('health_inspections')
          .insert({ site_id: siteDbId, inspector_id: inspectorId, year, status: 'in_progress' })
          .select('id')
          .single();

        if (createErr || !created) {
          if (!cancelled) setLoadError('Could not start this SOHC inspection. Try refreshing.');
          return;
        }
        inspectionId = created.id;
      } else if (existing?.status === 'completed') {
        completionHandled.current = true; // already completed in a prior session — don't re-decrement
        if (!cancelled) setInspectionStatus('completed');
      }

      inspectionIdRef.current = inspectionId;

      const { data: savedItems, error: itemsErr } = await supabase
        .from('health_inspection_items')
        .select('health_item_id, condition, life_expectancy, comment, photo_urls')
        .eq('health_inspection_id', inspectionId);

      if (itemsErr) {
        if (!cancelled) setLoadError('Loaded the inspection, but not your saved answers. Try refreshing.');
        return;
      }

      if (!cancelled && savedItems) {
        setItemState((prev) => {
          const next = { ...prev };
          for (const row of savedItems) {
            if (!next[row.health_item_id]) continue;
            next[row.health_item_id] = {
              condition: row.condition,
              lifeExpectancy: row.life_expectancy,
              comment: row.comment ?? '',
              photoUrls: row.photo_urls ?? [],
            };
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

  const allItems = categoriesState.flatMap((c) => c.items);
  const totalItems = allItems.length;
  // An item counts as "assessed" once both condition and life expectancy are set —
  // both columns are NOT NULL on health_inspection_items, so a row can't be saved
  // (and therefore can't count as done) until both are chosen.
  const assessedItems = allItems.filter((it) => {
    const s = itemState[it.id];
    return s && s.condition !== null && s.lifeExpectancy !== null;
  }).length;
  const pct = totalItems ? Math.round((assessedItems / totalItems) * 100) : 0;

  // ---- Autosave: upsert one health_inspection_items row per item.
  // UNIQUE(health_inspection_id, health_item_id) makes this a safe upsert. ----
  async function saveItem(itemId: string, state: ItemState) {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;
    // condition + life_expectancy are NOT NULL on this table — nothing to save
    // until both are chosen, same as Stage 1 withholding comment saves until
    // a Pass/Fail exists.
    if (state.condition === null || state.lifeExpectancy === null) return;

    pendingSaves.current += 1;
    setSaveStatus('saving');

    const { error } = await supabase.from('health_inspection_items').upsert(
      {
        health_inspection_id: inspectionId,
        health_item_id: itemId,
        condition: state.condition,
        life_expectancy: state.lifeExpectancy,
        comment: state.comment || null,
        photo_urls: state.photoUrls,
        requires_attention: computeRequiresAttention(state.condition, state.lifeExpectancy),
      },
      { onConflict: 'health_inspection_id,health_item_id' }
    );

    pendingSaves.current -= 1;
    if (error) {
      setSaveStatus('error');
    } else if (pendingSaves.current === 0) {
      setSaveStatus('saved');
    }
  }

  function setItem(itemId: string, patch: Partial<ItemState>) {
    setItemState((prev) => {
      const nextState = { ...prev[itemId], ...patch };
      const next = { ...prev, [itemId]: nextState };

      // Condition, life-expectancy, and photo changes save immediately.
      if ('condition' in patch || 'lifeExpectancy' in patch || 'photoUrls' in patch) {
        saveItem(itemId, nextState);
      }

      // Comment edits debounce for 600ms, same as Stage 1.
      if ('comment' in patch) {
        clearTimeout(commentTimers.current[itemId]);
        commentTimers.current[itemId] = setTimeout(() => {
          saveItem(itemId, nextState);
        }, 600);
      }

      return next;
    });
  }

  // ---- Mark the inspection completed once every item's been assessed, and
  // decrement the SOHC onboarding counter the first time this happens. ----
  useEffect(() => {
    if (pct !== 100 || loading || completionHandled.current || !inspectionIdRef.current) return;
    completionHandled.current = true;
    setView('summary');

    (async () => {
      const inspectionId = inspectionIdRef.current!;
      await supabase
        .from('health_inspections')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', inspectionId);

      setInspectionStatus('completed');

      const { data: siteRow } = await supabase
        .from('sites')
        .select('sohc_onboarding_inspections_remaining')
        .eq('id', siteDbId)
        .single();

      if (siteRow && siteRow.sohc_onboarding_inspections_remaining > 0) {
        await supabase
          .from('sites')
          .update({
            sohc_onboarding_inspections_remaining: siteRow.sohc_onboarding_inspections_remaining - 1,
          })
          .eq('id', siteDbId);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pct, loading, supabase, siteDbId]);

  // ---- Photo upload — identical compression/path pattern to Stage 1's Inspector.tsx,
  // just prefixed with health/ in the shared inspection-photos bucket so the two
  // inspection types never collide even though inspection ids are both uuids. ----
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

  async function uploadPhoto(itemId: string, file: File) {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;

    const currentUrls = itemState[itemId]?.photoUrls ?? [];
    if (currentUrls.length >= 2) return;

    setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: true, error: null } }));

    try {
      const blob = await compressImage(file);
      const path = `health/${inspectionId}/${itemId}/${crypto.randomUUID()}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from('inspection-photos')
        .upload(path, blob, { contentType: 'image/jpeg', upsert: false });

      if (uploadErr) throw uploadErr;

      setItem(itemId, { photoUrls: [...currentUrls, path] });
      setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: false, error: null } }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: false, error: message } }));
    }
  }

  async function removePhoto(itemId: string, path: string) {
    const currentUrls = itemState[itemId]?.photoUrls ?? [];
    setItem(itemId, { photoUrls: currentUrls.filter((p) => p !== path) });

    const { error } = await supabase.storage.from('inspection-photos').remove([path]);
    if (error) {
      setPhotoUploadState((prev) => ({ ...prev, [itemId]: { busy: false, error: error.message } }));
    }
  }

  // ---- Lifecycle: Clear & Restart, identical pattern to Stage 1's, scoped to
  // this year's health_inspection_items + their photos only. ----
  async function clearAndRestart() {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;

    if (
      !window.confirm(
        'Clear this SOHC inspection? This deletes every saved answer and photo for this year and resets the item-editing counter back to 3. This cannot be undone.'
      )
    ) {
      return;
    }

    setClearBusy(true);
    setClearError(null);

    try {
      const { data: photoFiles } = await supabase.storage
        .from('inspection-photos')
        .list(`health/${inspectionId}`);
      if (photoFiles && photoFiles.length > 0) {
        const nested = await Promise.all(
          photoFiles.map((f) => supabase.storage.from('inspection-photos').list(`health/${inspectionId}/${f.name}`))
        );
        const paths = nested.flatMap(
          (res, i) => (res.data ?? []).map((file) => `health/${inspectionId}/${photoFiles[i].name}/${file.name}`)
        );
        if (paths.length > 0) await supabase.storage.from('inspection-photos').remove(paths);
      }

      await supabase.from('health_inspection_items').delete().eq('health_inspection_id', inspectionId);
      await supabase
        .from('health_inspections')
        .update({ status: 'in_progress', completed_at: null })
        .eq('id', inspectionId);
      await supabase.from('sites').update({ sohc_onboarding_inspections_remaining: 3 }).eq('id', siteDbId);

      setItemState(() => {
        const init: Record<string, ItemState> = {};
        categoriesState.forEach((c) => c.items.forEach((it) => (init[it.id] = emptyItemState())));
        return init;
      });
      setInspectionStatus('in_progress');
      completionHandled.current = false;
    } catch (err) {
      setClearError(err instanceof Error ? err.message : 'Could not clear this inspection.');
    } finally {
      setClearBusy(false);
    }
  }

  // ---- Report generation — identical popup-blocker-safe pattern to Stage 1's
  // downloadReport/emailReport in Inspector.tsx. window.open() is called
  // synchronously before any await, since browsers only trust it to skip the
  // popup blocker inside the click handler itself. ----
  async function downloadReport() {
    const inspectionId = inspectionIdRef.current;
    if (!inspectionId) return;
    setReportBusy('download');
    setReportMessage(null);

    const newTab = window.open('', '_blank');

    try {
      const res = await fetch(`/api/reports/health/${inspectionId}/pdf`);
      if (!res.ok) throw new Error('Could not generate the report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      if (newTab) {
        newTab.location.href = url;
      } else {
        const a = document.createElement('a');
        a.href = url;
        a.download = `${siteName.replace(/[^a-z0-9]+/gi, '-')}-sohc-report-${currentYear()}.pdf`;
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
      const res = await fetch(`/api/reports/health/${inspectionId}/email`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send the report');
      setReportMessage(`Sent to ${(json.sentTo as string[]).join(', ')}`);
    } catch (err) {
      setReportMessage(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setReportBusy(null);
    }
  }

  // ---- Structure editing: rename/add/delete categories & items, plus
  // pointer-events drag reorder of items within their category. All gated by
  // canEditStructure (locks after the site's first 3 SOHC inspections) — a
  // direct port of Stage 1's rename/add/delete-area pattern, adapted for
  // SOHC's flatter category > item shape (no area-with-two-items nesting).
  // Category-level drag reorder isn't included, same as Stage 1 doesn't let
  // you drag-reorder floors — only the items within them.

  function startEditCategory(category: HealthCategory) {
    if (!canEditStructure) return;
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
  }

  async function saveCategoryName(categoryId: string) {
    const trimmed = editingCategoryName.trim();
    setEditingCategoryId(null);
    if (!trimmed) return;

    setCategoriesState((prev) => prev.map((c) => (c.id === categoryId ? { ...c, name: trimmed } : c)));

    const { error } = await supabase
      .from('health_categories')
      .update({ category_name: trimmed })
      .eq('id', categoryId);
    if (error) setStructureError(`Couldn't rename that category: ${error.message}`);
  }

  async function addCategory() {
    const trimmed = newCategoryName.trim();
    if (!trimmed) return;

    setStructureBusy(true);
    setStructureError(null);

    const { data: categoryRow, error } = await supabase
      .from('health_categories')
      .insert({ site_id: siteDbId, category_name: trimmed, sort_order: 999999 })
      .select('id')
      .single();

    if (error || !categoryRow) {
      setStructureBusy(false);
      setStructureError(`Couldn't add "${trimmed}": ${error?.message ?? 'unknown error'}`);
      return;
    }

    const newCategory: HealthCategory = { id: categoryRow.id, name: trimmed, items: [] };
    const nextCategories = [...categoriesState, newCategory];
    setCategoriesState(nextCategories);
    setActiveCategoryId(newCategory.id);
    setAddingCategory(false);
    setNewCategoryName('');
    await persistCategoryOrder(nextCategories);
    setStructureBusy(false);
  }

  async function deleteCategoryHandler(category: HealthCategory) {
    if (
      !window.confirm(
        `Remove "${category.name}"? This deletes its items and any saved answers for them, across every SOHC inspection at this site. This can't be undone.`
      )
    )
      return;

    setStructureBusy(true);
    setStructureError(null);

    // Explicit cleanup rather than relying on an assumed cascade — deletes any
    // saved answers for this category's items first, then the items, then the
    // category itself.
    const itemIds = category.items.map((it) => it.id);
    if (itemIds.length > 0) {
      await supabase.from('health_inspection_items').delete().in('health_item_id', itemIds);
    }
    const { error } = await supabase.from('health_categories').delete().eq('id', category.id);
    if (error) {
      setStructureBusy(false);
      setStructureError(`Couldn't remove "${category.name}": ${error.message}`);
      return;
    }

    const remaining = categoriesState.filter((c) => c.id !== category.id);
    setCategoriesState(remaining);
    if (activeCategoryId === category.id) {
      setActiveCategoryId(remaining[0]?.id ?? '');
    }
    setItemState((prev) => {
      const next = { ...prev };
      itemIds.forEach((id) => delete next[id]);
      return next;
    });
    setStructureBusy(false);
  }

  function startEditItem(item: { id: string; name: string }) {
    if (!canEditStructure) return;
    setEditingItemId(item.id);
    setEditingItemName(item.name);
  }

  async function saveItemName(itemId: string) {
    const trimmed = editingItemName.trim();
    setEditingItemId(null);
    if (!trimmed) return;

    setCategoriesState((prev) =>
      prev.map((c) => ({
        ...c,
        items: c.items.map((it) => (it.id === itemId ? { ...it, name: trimmed } : it)),
      }))
    );

    const { error } = await supabase.from('health_items').update({ item_name: trimmed }).eq('id', itemId);
    if (error) setStructureError(`Couldn't rename that item: ${error.message}`);
  }

  async function addItemToCategory(categoryId: string) {
    const trimmed = newItemName.trim();
    if (!trimmed) return;
    const category = categoriesState.find((c) => c.id === categoryId);
    if (!category) return;

    setStructureBusy(true);
    setStructureError(null);

    const { data: itemRow, error } = await supabase
      .from('health_items')
      .insert({ category_id: categoryId, item_name: trimmed, sort_order: 999999 })
      .select('id')
      .single();

    if (error || !itemRow) {
      setStructureBusy(false);
      setStructureError(`Couldn't add "${trimmed}": ${error?.message ?? 'unknown error'}`);
      return;
    }

    const newItem = { id: itemRow.id, name: trimmed };
    const nextCategories = categoriesState.map((c) =>
      c.id === categoryId ? { ...c, items: [...c.items, newItem] } : c
    );
    setCategoriesState(nextCategories);
    setItemState((prev) => ({ ...prev, [newItem.id]: emptyItemState() }));
    setAddingItemToCategory(null);
    setNewItemName('');
    await persistItemOrder(nextCategories);
    setStructureBusy(false);
  }

  async function deleteItemHandler(categoryId: string, item: { id: string; name: string }) {
    if (
      !window.confirm(
        `Remove "${item.name}"? This deletes any saved answers for it, across every SOHC inspection at this site. This can't be undone.`
      )
    )
      return;

    setStructureBusy(true);
    setStructureError(null);

    await supabase.from('health_inspection_items').delete().eq('health_item_id', item.id);
    const { error } = await supabase.from('health_items').delete().eq('id', item.id);
    if (error) {
      setStructureBusy(false);
      setStructureError(`Couldn't remove "${item.name}": ${error.message}`);
      return;
    }

    setCategoriesState((prev) =>
      prev.map((c) => (c.id === categoryId ? { ...c, items: c.items.filter((it) => it.id !== item.id) } : c))
    );
    setItemState((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setStructureBusy(false);
  }

  // Renumbers every category across the site sequentially (0, 1, 2, …) —
  // same full-renumber reasoning as Stage 1's persistOrder.
  async function persistCategoryOrder(orderedCategories: HealthCategory[]) {
    setSaveStatus('saving');
    const results = await Promise.all(
      orderedCategories.map((c, index) =>
        supabase.from('health_categories').update({ sort_order: index }).eq('id', c.id)
      )
    );
    setSaveStatus(results.some((r) => r.error) ? 'error' : 'saved');
  }

  // Renumbers every item across the whole site sequentially, mirroring Stage 1's
  // area persistOrder — a full renumber avoids sort_order collisions between
  // categories, not just within the one being reordered.
  async function persistItemOrder(orderedCategories: HealthCategory[]) {
    const orderedIds = orderedCategories.flatMap((c) => c.items.map((it) => it.id));
    setSaveStatus('saving');
    const results = await Promise.all(
      orderedIds.map((id, index) => supabase.from('health_items').update({ sort_order: index }).eq('id', id))
    );
    setSaveStatus(results.some((r) => r.error) ? 'error' : 'saved');
  }

  function startDragItem(categoryId: string, itemId: string) {
    if (!canEditStructure) return;
    dragCategoryId.current = categoryId;
    setDraggingItemId(itemId);
  }

  useEffect(() => {
    if (!draggingItemId || !dragCategoryId.current) return;
    const categoryId = dragCategoryId.current;

    function onPointerMove(e: PointerEvent) {
      setCategoriesState((prev) => {
        const category = prev.find((c) => c.id === categoryId);
        if (!category) return prev;
        const draggedIndex = category.items.findIndex((it) => it.id === draggingItemId);
        if (draggedIndex === -1) return prev;

        let overIndex = category.items.length - 1;
        for (let i = 0; i < category.items.length; i++) {
          const el = itemCardRefs.current[category.items[i].id];
          if (!el) continue;
          const rect = el.getBoundingClientRect();
          const mid = rect.top + rect.height / 2;
          if (e.clientY < mid) {
            overIndex = i;
            break;
          }
        }

        if (overIndex === draggedIndex) return prev;

        const nextItems = [...category.items];
        const [moved] = nextItems.splice(draggedIndex, 1);
        nextItems.splice(overIndex, 0, moved);
        return prev.map((c) => (c.id === categoryId ? { ...c, items: nextItems } : c));
      });
    }

    function onPointerUp() {
      setDraggingItemId(null);
      dragCategoryId.current = null;
      setCategoriesState((current) => {
        persistItemOrder(current);
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
  }, [draggingItemId]);

  const activeCategory = categoriesState.find((c) => c.id === activeCategoryId);

  function categoryAssessedCount(category: HealthCategory): { done: number; total: number } {
    const items = category.items.map((it) => itemState[it.id]);
    const done = items.filter((it) => it?.condition !== null && it?.lifeExpectancy !== null).length;
    return { done, total: category.items.length };
  }

  function categoryPct(categoryId: string): number {
    const category = categoriesState.find((c) => c.id === categoryId);
    if (!category) return 0;
    const { done, total } = categoryAssessedCount(category);
    if (total === 0) return 0;
    return Math.round((done / total) * 100);
  }

  // Mirrors Stage 1's floorStatus — 'needs-attention' surfaces if any assessed
  // item in the category trips computeRequiresAttention (poor/critical condition,
  // or 0-2 years life expectancy), 'done' once every item's assessed and none do.
  function categoryStatus(categoryId: string): 'not-started' | 'needs-attention' | 'done' {
    const category = categoriesState.find((c) => c.id === categoryId);
    if (!category) return 'not-started';
    const items = category.items.map((it) => itemState[it.id]);
    const anyAttention = items.some((it) => it && computeRequiresAttention(it.condition, it.lifeExpectancy));
    const { done, total } = categoryAssessedCount(category);
    if (anyAttention) return 'needs-attention';
    if (total > 0 && done === total) return 'done';
    return 'not-started';
  }

  function isCategoryComplete(categoryId: string): boolean {
    const category = categoriesState.find((c) => c.id === categoryId);
    if (!category) return false;
    const { done, total } = categoryAssessedCount(category);
    return total > 0 && done === total;
  }

  // Next incomplete category after the current one, wrapping around to the
  // start — same pattern as Stage 1's nextIncompleteFloorId.
  function nextIncompleteCategoryId(): string | null {
    const currentIndex = categoriesState.findIndex((c) => c.id === activeCategoryId);
    for (let i = currentIndex + 1; i < categoriesState.length; i++) {
      if (!isCategoryComplete(categoriesState[i].id)) return categoriesState[i].id;
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!isCategoryComplete(categoriesState[i].id)) return categoriesState[i].id;
    }
    return null;
  }

  function goToNextCategory() {
    const nextId = nextIncompleteCategoryId();
    if (!nextId) return;
    setActiveCategoryId(nextId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---- Summary view data — condition breakdown by category, and the flagged
  // (still-editable) item list, same shape as Stage 1's floorStats/failedAreas ----
  const categoryStats = categoriesState.map((c) => {
    let good = 0;
    let fair = 0;
    let poor = 0;
    let critical = 0;
    for (const it of c.items) {
      const condition = itemState[it.id]?.condition;
      if (condition === 'good') good += 1;
      else if (condition === 'fair') fair += 1;
      else if (condition === 'poor') poor += 1;
      else if (condition === 'critical') critical += 1;
    }
    return { category: c, good, fair, poor, critical };
  });

  const totalGood = categoryStats.reduce((sum, s) => sum + s.good, 0);
  const totalFair = categoryStats.reduce((sum, s) => sum + s.fair, 0);
  const totalPoor = categoryStats.reduce((sum, s) => sum + s.poor, 0);
  const totalCritical = categoryStats.reduce((sum, s) => sum + s.critical, 0);

  const flaggedItems = categoriesState.flatMap((c) =>
    c.items
      .filter((it) => {
        const s = itemState[it.id];
        return s && computeRequiresAttention(s.condition, s.lifeExpectancy);
      })
      .map((it) => ({ category: c, item: it }))
  );

  if (loading) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center text-rsl-navy/50 text-sm">Loading…</div>;
  }

  if (loadError) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center text-rsl-red text-sm">{loadError}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      {/* Header row: overall progress + save status */}
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-rsl-blue">
            {assessedItems} of {totalItems} assessed ({pct}%)
          </span>
          {inspectionStatus === 'completed' && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-pass bg-pass/10 rounded-full px-2 py-0.5">
              Completed
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-rsl-navy/5 rounded-full p-1">
            <button
              onClick={() => setView('category')}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                view === 'category' ? 'bg-rsl-blue text-white' : 'text-rsl-navy/60'
              }`}
            >
              Category View
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
          <SaveIndicator status={saveStatus} />
        </div>
      </div>

      <div className="h-1.5 rounded-full bg-rsl-navy/10 overflow-hidden">
        <div className="h-full bg-rsl-blue transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>

      {canClearInspections && (
        <div className="mt-3 mb-4">
          {clearError && <p className="text-xs text-rsl-red mb-1">{clearError}</p>}
          <button
            onClick={clearAndRestart}
            disabled={clearBusy}
            className="text-[11px] font-semibold text-rsl-navy/40 hover:text-rsl-red underline disabled:opacity-50"
          >
            {clearBusy ? 'Clearing…' : 'Clear & Restart (testing only)'}
          </button>
        </div>
      )}

      {/* Category tabs */}
      {view === 'category' && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mt-4">
          {categoriesState.map((c) => {
            const status = categoryStatus(c.id);
            const percent = categoryPct(c.id);
            return (
              <button
                key={c.id}
                onClick={() => setActiveCategoryId(c.id)}
                className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                  activeCategoryId === c.id
                    ? 'border-rsl-blue bg-rsl-blue text-white'
                    : status === 'needs-attention'
                    ? 'border-rsl-red/40 text-rsl-red bg-rsl-red/5'
                    : status === 'done'
                    ? 'border-pass/40 text-pass bg-pass/5'
                    : 'border-rsl-navy/15 text-rsl-navy/60'
                }`}
              >
                {c.name}
                <span className={`ml-1.5 ${activeCategoryId === c.id ? 'text-white/60' : 'opacity-60'}`}>
                  {percent}%
                </span>
              </button>
            );
          })}
        </div>
      )}

      {view === 'category' && canEditStructure && (
        <div className="mt-2">
          {addingCategory ? (
            <div className="flex gap-2">
              <input
                autoFocus
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                className="flex-1 text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
              />
              <button
                onClick={addCategory}
                disabled={structureBusy || !newCategoryName.trim()}
                className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 disabled:opacity-40"
              >
                {structureBusy ? 'Saving…' : 'Add'}
              </button>
              <button
                onClick={() => {
                  setAddingCategory(false);
                  setNewCategoryName('');
                }}
                className="text-sm font-semibold text-rsl-navy/50 px-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddingCategory(true)}
              className="text-sm font-semibold text-rsl-blue hover:underline"
            >
              + Add category
            </button>
          )}
        </div>
      )}

      {structureError && (
        <div className="mt-3 rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red flex items-start justify-between gap-3">
          <span>{structureError}</span>
          <button onClick={() => setStructureError(null)} className="text-rsl-red/60 shrink-0">
            ✕
          </button>
        </div>
      )}

      {/* Active category items */}
      {view === 'category' && activeCategory && (
        <div className="mt-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {editingCategoryId === activeCategory.id ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <input
                    autoFocus
                    value={editingCategoryName}
                    onChange={(e) => setEditingCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveCategoryName(activeCategory.id);
                      if (e.key === 'Escape') setEditingCategoryId(null);
                    }}
                    className="text-sm font-semibold text-rsl-navy rounded-lg border border-rsl-navy/20 px-2 py-1 min-w-0"
                  />
                  <button
                    onClick={() => saveCategoryName(activeCategory.id)}
                    className="text-pass text-xs font-semibold shrink-0"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingCategoryId(null)}
                    className="text-rsl-navy/40 text-xs font-semibold shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <h2 className="font-display font-bold text-rsl-navy truncate">{activeCategory.name}</h2>
              )}
              {canEditStructure && editingCategoryId !== activeCategory.id && (
                <button
                  onClick={() => startEditCategory(activeCategory)}
                  className="shrink-0 text-rsl-navy/30 hover:text-rsl-navy/60 text-xs"
                  aria-label="Rename category"
                >
                  ✎
                </button>
              )}
              {canEditStructure && (
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-rsl-gold bg-rsl-gold/10 rounded-full px-2 py-0.5">
                  Editable · first 3 inspections
                </span>
              )}
            </div>
            {canEditStructure && (
              <button
                onClick={() => deleteCategoryHandler(activeCategory)}
                disabled={structureBusy}
                className="shrink-0 text-rsl-navy/30 hover:text-rsl-red text-xs disabled:opacity-40"
                aria-label="Remove category"
              >
                🗑
              </button>
            )}
          </div>

          {activeCategory.items.map((item) => (
            <div
              key={item.id}
              ref={(el) => {
                itemCardRefs.current[item.id] = el;
              }}
            >
              <HealthItemCard
                itemName={item.name}
                state={itemState[item.id]}
                onChange={(patch) => setItem(item.id, patch)}
                onUploadPhoto={(file) => uploadPhoto(item.id, file)}
                onRemovePhoto={(path) => removePhoto(item.id, path)}
                resolvePhotoUrl={resolvePhotoUrl}
                photoBusy={photoUploadState[item.id]?.busy ?? false}
                photoError={photoUploadState[item.id]?.error ?? null}
                editable={canEditStructure}
                isEditingName={editingItemId === item.id}
                editingName={editingItemName}
                onStartEditName={() => startEditItem(item)}
                onEditNameChange={setEditingItemName}
                onSaveName={() => saveItemName(item.id)}
                onCancelEditName={() => setEditingItemId(null)}
                onDelete={() => deleteItemHandler(activeCategory.id, item)}
                deleteBusy={structureBusy}
                isDragging={draggingItemId === item.id}
                onDragHandlePointerDown={() => startDragItem(activeCategory.id, item.id)}
              />
            </div>
          ))}

          {canEditStructure &&
            (addingItemToCategory === activeCategory.id ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="New item name"
                  className="flex-1 text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
                />
                <button
                  onClick={() => addItemToCategory(activeCategory.id)}
                  disabled={structureBusy || !newItemName.trim()}
                  className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 disabled:opacity-40"
                >
                  {structureBusy ? 'Saving…' : 'Add'}
                </button>
                <button
                  onClick={() => {
                    setAddingItemToCategory(null);
                    setNewItemName('');
                  }}
                  className="text-sm font-semibold text-rsl-navy/50 px-2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setAddingItemToCategory(activeCategory.id)}
                className="text-sm font-semibold text-rsl-blue hover:underline"
              >
                + Add item to this category
              </button>
            ))}

          <NextCategoryPrompt
            nextCategoryName={categoriesState.find((c) => c.id === nextIncompleteCategoryId())?.name ?? null}
            allComplete={pct === 100}
            onNext={goToNextCategory}
          />
        </div>
      )}

      {/* Summary view — shown once every item across every category has been assessed */}
      {view === 'summary' && (
        <div className="mt-5 space-y-5">
          <div className="rounded-2xl border border-pass/30 bg-pass/5 p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-pass mb-1">SOHC Complete</p>
            <p className="text-2xl font-display font-bold text-rsl-navy">
              {totalGood} good · {totalFair} fair · {totalPoor} poor · {totalCritical} critical
            </p>
            <p className="text-xs text-rsl-navy/50 mt-1">
              {totalItems} assets across {categoriesState.length} categor
              {categoriesState.length !== 1 ? 'ies' : 'y'}
            </p>
          </div>

          <div>
            <h3 className="font-display font-bold text-rsl-navy text-sm mb-2">By category</h3>
            <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
                  <tr>
                    <th className="font-semibold px-4 py-2.5">Category</th>
                    <th className="font-semibold px-4 py-2.5 text-right">Good</th>
                    <th className="font-semibold px-4 py-2.5 text-right">Fair</th>
                    <th className="font-semibold px-4 py-2.5 text-right">Poor</th>
                    <th className="font-semibold px-4 py-2.5 text-right">Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryStats.map(({ category, good, fair, poor, critical }) => (
                    <tr key={category.id} className="border-t border-rsl-navy/5">
                      <td className="px-4 py-2.5 text-rsl-navy whitespace-nowrap">{category.name}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-pass">{good || '—'}</td>
                      <td className="px-4 py-2.5 text-right font-semibold" style={{ color: '#E8A020' }}>
                        {fair || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold" style={{ color: '#E8720A' }}>
                        {poor || '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold text-rsl-red">{critical || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {flaggedItems.length > 0 && (
            <div>
              <h3 className="font-display font-bold text-rsl-red text-sm mb-2">
                Flagged — {flaggedItems.length} item{flaggedItems.length !== 1 && 's'} (poor/critical or 0–2yr
                life expectancy)
              </h3>
              <div className="space-y-4">
                {flaggedItems.map(({ category, item }) => (
                  <div key={item.id}>
                    <div className="text-xs uppercase tracking-wide text-rsl-navy/40 font-semibold mb-1.5">
                      {category.name}
                    </div>
                    <HealthItemCard
                      itemName={item.name}
                      state={itemState[item.id]}
                      onChange={(patch) => setItem(item.id, patch)}
                      onUploadPhoto={(file) => uploadPhoto(item.id, file)}
                      onRemovePhoto={(path) => removePhoto(item.id, path)}
                      resolvePhotoUrl={resolvePhotoUrl}
                      photoBusy={photoUploadState[item.id]?.busy ?? false}
                      photoError={photoUploadState[item.id]?.error ?? null}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {flaggedItems.length === 0 && (
            <p className="text-sm text-rsl-navy/50 py-4 text-center">
              No items currently flagged — nothing rated Poor/Critical or 0–2 years remaining life.
            </p>
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
            {reportMessage && <p className="text-xs text-center text-rsl-navy/60">{reportMessage}</p>}
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

// Mirrors Stage 1's NextFloorPrompt, minus the View Summary button — Summary
// is now its own top-level view (see the view switcher above), reached the
// same way Stage 1 reaches it: automatically at first 100%, or manually via
// the header tab once available.
function NextCategoryPrompt({
  nextCategoryName,
  allComplete,
  onNext,
}: {
  nextCategoryName: string | null;
  allComplete: boolean;
  onNext: () => void;
}) {
  if (allComplete) {
    return (
      <div className="rounded-2xl border border-pass/30 bg-pass/5 p-4 text-center">
        <p className="text-sm font-semibold text-pass">
          All categories complete — inspection ready to submit.
        </p>
      </div>
    );
  }

  if (!nextCategoryName) {
    return null; // nothing incomplete elsewhere — stay put and finish this category
  }

  return (
    <button
      onClick={onNext}
      className="w-full text-sm font-semibold text-white bg-rsl-navy rounded-xl py-3.5 hover:bg-rsl-navy/90 transition-colors"
    >
      Next Category: {nextCategoryName} →
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

function HealthItemCard({
  itemName,
  state,
  onChange,
  onUploadPhoto,
  onRemovePhoto,
  resolvePhotoUrl,
  photoBusy,
  photoError,
  editable = false,
  isEditingName = false,
  editingName = '',
  onStartEditName,
  onEditNameChange,
  onSaveName,
  onCancelEditName,
  onDelete,
  deleteBusy = false,
  isDragging = false,
  onDragHandlePointerDown,
}: {
  itemName: string;
  state: ItemState;
  onChange: (patch: Partial<ItemState>) => void;
  onUploadPhoto: (file: File) => void;
  onRemovePhoto: (path: string) => void;
  resolvePhotoUrl: (path: string) => string;
  photoBusy: boolean;
  photoError: string | null;
  editable?: boolean;
  isEditingName?: boolean;
  editingName?: string;
  onStartEditName?: () => void;
  onEditNameChange?: (v: string) => void;
  onSaveName?: () => void;
  onCancelEditName?: () => void;
  onDelete?: () => void;
  deleteBusy?: boolean;
  isDragging?: boolean;
  onDragHandlePointerDown?: () => void;
}) {
  const selectId = useId();
  // Photo upload only appears once condition is Fair or worse — matches the
  // report spec's "only attach photos where Fair or worse" rule.
  const showPhoto = state.condition !== null && state.condition !== 'good';

  return (
    <div
      className={`rounded-xl border p-4 space-y-3 transition-colors ${
        isDragging ? 'opacity-50 ring-2 ring-rsl-navy border-rsl-navy/10' : 'border-rsl-navy/10'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
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
            <p className="font-semibold text-sm text-rsl-navy truncate">{itemName}</p>
          )}

          {editable && !isEditingName && (
            <button
              onClick={onStartEditName}
              className="shrink-0 text-rsl-navy/30 hover:text-rsl-navy/60 text-xs"
              aria-label="Rename item"
            >
              ✎
            </button>
          )}
        </div>

        {editable && onDelete && (
          <button
            onClick={onDelete}
            disabled={deleteBusy}
            className="shrink-0 text-rsl-navy/30 hover:text-rsl-red text-xs disabled:opacity-40"
            aria-label="Remove item"
          >
            🗑
          </button>
        )}
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {CONDITION_OPTIONS.map((opt) => {
          const selected = state.condition === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange({ condition: opt.value })}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                selected ? 'text-white' : 'border-rsl-navy/15 text-rsl-navy/60'
              }`}
              style={
                selected
                  ? {
                      borderColor:
                        opt.value === 'good'
                          ? '#2F8F4E'
                          : opt.value === 'fair'
                          ? '#E8A020'
                          : opt.value === 'poor'
                          ? '#E8720A'
                          : '#C01820',
                      backgroundColor:
                        opt.value === 'good'
                          ? '#2F8F4E'
                          : opt.value === 'fair'
                          ? '#E8A020'
                          : opt.value === 'poor'
                          ? '#E8720A'
                          : '#C01820',
                    }
                  : undefined
              }
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div>
        <label htmlFor={selectId} className="text-xs font-semibold text-rsl-navy/50 block mb-1">
          Remaining life expectancy
        </label>
        <select
          id={selectId}
          value={state.lifeExpectancy ?? ''}
          onChange={(e) => onChange({ lifeExpectancy: (e.target.value || null) as LifeExpectancyBand | null })}
          className="w-full text-sm border border-rsl-navy/15 rounded-lg px-3 py-2 text-rsl-navy"
        >
          <option value="">Select…</option>
          {LIFE_EXPECTANCY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <textarea
        value={state.comment}
        onChange={(e) => onChange({ comment: e.target.value })}
        placeholder="Comment / action required…"
        rows={2}
        className="w-full text-sm border border-rsl-navy/15 rounded-lg px-3 py-2 text-rsl-navy resize-none"
      />

      {showPhoto && (
        <PhotoUploader
          photoUrls={state.photoUrls}
          resolvePhotoUrl={resolvePhotoUrl}
          onUploadPhoto={onUploadPhoto}
          onRemovePhoto={onRemovePhoto}
          busy={photoBusy}
          error={photoError}
        />
      )}
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
          className="w-full block text-center text-xs font-semibold text-rsl-navy/50 border border-dashed border-rsl-navy/20 rounded-lg py-2 hover:border-rsl-blue/40 hover:text-rsl-blue transition-colors cursor-pointer"
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
