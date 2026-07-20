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
  categories,
  inspectorId,
  canClearInspections,
}: {
  siteDbId: string;
  categories: HealthCategory[];
  inspectorId: string;
  canClearInspections: boolean;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id ?? '');

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

  const allItems = categories.flatMap((c) => c.items);
  const totalItems = allItems.length;
  // An item counts as "assessed" once both condition and life expectancy are set —
  // both columns are NOT NULL on health_inspection_items, so a row can't be saved
  // (and therefore can't count as done) until both are chosen.
  const assessedItems = Object.values(itemState).filter(
    (it) => it.condition !== null && it.lifeExpectancy !== null
  ).length;
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
  // decrement the SOHC onboarding counter the first time this happens. No
  // progress-bar / Next-category-nav / View Summary UI yet — that's phase 2. ----
  useEffect(() => {
    if (pct !== 100 || loading || completionHandled.current || !inspectionIdRef.current) return;
    completionHandled.current = true;

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
        categories.forEach((c) => c.items.forEach((it) => (init[it.id] = emptyItemState())));
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

  const activeCategory = categories.find((c) => c.id === activeCategoryId);

  function categoryAssessedCount(category: HealthCategory): { done: number; total: number } {
    const items = category.items.map((it) => itemState[it.id]);
    const done = items.filter((it) => it?.condition !== null && it?.lifeExpectancy !== null).length;
    return { done, total: category.items.length };
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center text-rsl-navy/50 text-sm">Loading…</div>;
  }

  if (loadError) {
    return <div className="max-w-3xl mx-auto px-6 py-16 text-center text-rsl-red text-sm">{loadError}</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-6">
      {/* Header row: overall progress + save status */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-rsl-blue">
            {assessedItems} of {totalItems} assessed
          </span>
          {inspectionStatus === 'completed' && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-pass bg-pass/10 rounded-full px-2 py-0.5">
              Completed
            </span>
          )}
        </div>
        <SaveIndicator status={saveStatus} />
      </div>

      {canClearInspections && (
        <div className="mb-4">
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
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
        {categories.map((c) => {
          const { done, total } = categoryAssessedCount(c);
          return (
            <button
              key={c.id}
              onClick={() => setActiveCategoryId(c.id)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                activeCategoryId === c.id
                  ? 'border-rsl-blue bg-rsl-blue text-white'
                  : done === total && total > 0
                  ? 'border-pass/40 text-pass bg-pass/5'
                  : 'border-rsl-navy/15 text-rsl-navy/60'
              }`}
            >
              {c.name}
              <span className={`ml-1.5 ${activeCategoryId === c.id ? 'text-white/60' : 'opacity-60'}`}>
                {done}/{total}
              </span>
            </button>
          );
        })}
      </div>

      {/* Active category items */}
      {activeCategory && (
        <div className="mt-5 space-y-3">
          <h2 className="font-display font-bold text-rsl-navy">{activeCategory.name}</h2>
          {activeCategory.items.map((item) => (
            <HealthItemCard
              key={item.id}
              itemName={item.name}
              state={itemState[item.id]}
              onChange={(patch) => setItem(item.id, patch)}
              onUploadPhoto={(file) => uploadPhoto(item.id, file)}
              onRemovePhoto={(path) => removePhoto(item.id, path)}
              resolvePhotoUrl={resolvePhotoUrl}
              photoBusy={photoUploadState[item.id]?.busy ?? false}
              photoError={photoUploadState[item.id]?.error ?? null}
            />
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

function HealthItemCard({
  itemName,
  state,
  onChange,
  onUploadPhoto,
  onRemovePhoto,
  resolvePhotoUrl,
  photoBusy,
  photoError,
}: {
  itemName: string;
  state: ItemState;
  onChange: (patch: Partial<ItemState>) => void;
  onUploadPhoto: (file: File) => void;
  onRemovePhoto: (path: string) => void;
  resolvePhotoUrl: (path: string) => string;
  photoBusy: boolean;
  photoError: string | null;
}) {
  const selectId = useId();
  // Photo upload only appears once condition is Fair or worse — matches the
  // report spec's "only attach photos where Fair or worse" rule.
  const showPhoto = state.condition !== null && state.condition !== 'good';

  return (
    <div className="rounded-xl border border-rsl-navy/10 p-4 space-y-3">
      <p className="font-semibold text-sm text-rsl-navy">{itemName}</p>

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
