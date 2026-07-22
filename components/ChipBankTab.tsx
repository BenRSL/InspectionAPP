'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { type Phrase, type ZoneTypeAssignment, buildZoneTypeIndex } from '@/lib/common-phrases';

// comment_phrases.category isn't part of the shared Phrase type (Stage 1's
// Inspector.tsx already splits cleaning/maintenance apart before it ever
// builds a Phrase[]), but this screen needs it to group the bank for
// scannability, so it's queried and typed locally instead.
type BankPhrase = Phrase & { category: 'cleaning' | 'maintenance' };

// The Chip Bank screen (Bible Section 8.2) — decides WHERE each comment
// phrase shows up as a quick-pick chip, by explicit drag-assignment onto a
// "zone type" bucket (e.g. "Toilets", "Roof & External Envelope") rather
// than the old keyword-substring guess. It does NOT manage what the ~50
// phrases themselves say — that stays in the existing pencil-icon editor
// inside Inspector.tsx, per Bible Section 8.2's explicit "unchanged" note.
//
// A "zone type" isn't its own database entity — it's just the text of an
// area name (Stage 1) or category name (SOHC). The bucket list below is
// built from whatever distinct names currently exist in floor_areas +
// health_categories across all 9 sites, plus any bucket that already has an
// assignment (even if its matching area/category was since renamed or
// deleted — the assignment is left visible so nothing silently vanishes).
export default function ChipBankTab() {
  const supabase = useMemo(() => supabaseBrowser(), []);

  const [phrases, setPhrases] = useState<BankPhrase[]>([]);
  const [assignments, setAssignments] = useState<ZoneTypeAssignment[]>([]);
  const [structureZoneTypes, setStructureZoneTypes] = useState<string[]>([]);
  const [customZoneTypes, setCustomZoneTypes] = useState<string[]>([]);
  const [newZoneTypeName, setNewZoneTypeName] = useState('');
  const [bucketSearch, setBucketSearch] = useState('');

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [draggingPhraseId, setDraggingPhraseId] = useState<string | null>(null);
  const [hoveredZoneType, setHoveredZoneType] = useState<string | null>(null);
  const bucketRefs = useRef<Record<string, HTMLDivElement | null>>({});

  async function loadAll() {
    setLoading(true);
    setLoadError(null);

    const [phrasesRes, assignmentsRes, areasRes, categoriesRes] = await Promise.all([
      supabase.from('comment_phrases').select('id, category, text, keywords').order('text'),
      supabase.from('comment_phrase_zone_types').select('id, phrase_id, zone_type_name'),
      supabase.from('floor_areas').select('area_name'),
      supabase.from('health_categories').select('category_name'),
    ]);

    const firstError = phrasesRes.error || assignmentsRes.error || areasRes.error || categoriesRes.error;
    if (firstError) {
      setLoadError(firstError.message);
      setLoading(false);
      return;
    }

    setPhrases(phrasesRes.data ?? []);
    setAssignments(assignmentsRes.data ?? []);

    // Dedupe case-insensitively across both sources, keep first-seen casing.
    const seen = new Map<string, string>();
    for (const row of areasRes.data ?? []) {
      const key = row.area_name.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, row.area_name.trim());
    }
    for (const row of categoriesRes.data ?? []) {
      const key = row.category_name.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, row.category_name.trim());
    }
    setStructureZoneTypes(Array.from(seen.values()).sort((a, b) => a.localeCompare(b)));

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const zoneTypeIndex = useMemo(() => buildZoneTypeIndex(assignments), [assignments]);

  // Any zone-type name that has at least one assignment but isn't in the
  // current structure list (renamed/deleted area or category) — still shown
  // so an admin notices and can clean it up, rather than it disappearing.
  const orphanedZoneTypes = useMemo(() => {
    const structureKeys = new Set(structureZoneTypes.map((n) => n.toLowerCase()));
    const seen = new Map<string, string>();
    for (const a of assignments) {
      const key = a.zone_type_name.trim().toLowerCase();
      if (!structureKeys.has(key) && !seen.has(key)) seen.set(key, a.zone_type_name.trim());
    }
    return Array.from(seen.values());
  }, [assignments, structureZoneTypes]);

  const allZoneTypes = useMemo(() => {
    const combined = [...structureZoneTypes, ...customZoneTypes, ...orphanedZoneTypes];
    const seen = new Map<string, string>();
    for (const name of combined) {
      const key = name.trim().toLowerCase();
      if (!seen.has(key)) seen.set(key, name.trim());
    }
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [structureZoneTypes, customZoneTypes, orphanedZoneTypes]);

  const visibleZoneTypes = bucketSearch.trim()
    ? allZoneTypes.filter((z) => z.toLowerCase().includes(bucketSearch.trim().toLowerCase()))
    : allZoneTypes;

  function assignedPhrasesFor(zoneType: string): Phrase[] {
    const ids = zoneTypeIndex.get(zoneType.trim().toLowerCase());
    if (!ids) return [];
    return phrases.filter((p) => ids.has(p.id));
  }

  async function assignPhrase(phraseId: string, zoneType: string) {
    const already = zoneTypeIndex.get(zoneType.trim().toLowerCase())?.has(phraseId);
    if (already) return;

    // Optimistic — the drag interaction feels wrong if the chip doesn't
    // snap into the bucket immediately.
    const optimisticRow: ZoneTypeAssignment = { id: `pending-${phraseId}-${zoneType}`, phrase_id: phraseId, zone_type_name: zoneType };
    setAssignments((prev) => [...prev, optimisticRow]);

    const { data, error } = await supabase
      .from('comment_phrase_zone_types')
      .insert({ phrase_id: phraseId, zone_type_name: zoneType })
      .select('id, phrase_id, zone_type_name')
      .single();

    if (error || !data) {
      setAssignments((prev) => prev.filter((a) => a.id !== optimisticRow.id));
      setActionError(`Couldn't assign that chip: ${error?.message ?? 'unknown error'}`);
      return;
    }

    setAssignments((prev) => prev.map((a) => (a.id === optimisticRow.id ? data : a)));
  }

  async function unassign(assignment: ZoneTypeAssignment) {
    setAssignments((prev) => prev.filter((a) => a.id !== assignment.id));
    const { error } = await supabase.from('comment_phrase_zone_types').delete().eq('id', assignment.id);
    if (error) {
      setActionError(`Couldn't remove that assignment: ${error.message}`);
      setAssignments((prev) => [...prev, assignment]);
    }
  }

  function addCustomZoneType() {
    const trimmed = newZoneTypeName.trim();
    if (!trimmed) return;
    if (!allZoneTypes.some((z) => z.toLowerCase() === trimmed.toLowerCase())) {
      setCustomZoneTypes((prev) => [...prev, trimmed]);
    }
    setNewZoneTypeName('');
  }

  function startDrag(phraseId: string) {
    setDraggingPhraseId(phraseId);
  }

  useEffect(() => {
    if (!draggingPhraseId) return;

    function onPointerMove(e: PointerEvent) {
      let found: string | null = null;
      for (const [zoneType, el] of Object.entries(bucketRefs.current)) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          found = zoneType;
          break;
        }
      }
      setHoveredZoneType(found);
    }

    function onPointerUp() {
      if (draggingPhraseId && hoveredZoneType) {
        assignPhrase(draggingPhraseId, hoveredZoneType);
      }
      setDraggingPhraseId(null);
      setHoveredZoneType(null);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingPhraseId, hoveredZoneType]);

  if (loading) return <p className="text-sm text-rsl-navy/50">Loading chip bank…</p>;
  if (loadError) {
    return <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red">Couldn't load: {loadError}</div>;
  }

  const cleaningPhrases = phrases.filter((p) => p.category === 'cleaning');
  const maintenancePhrases = phrases.filter((p) => p.category === 'maintenance');

  return (
    <div className="space-y-4">
      <p className="text-sm text-rsl-navy/60">
        Drag a chip from the bank onto a zone type to make it show up there during inspections — on both
        Monthly Inspect and SOHC, at every site. To add, rename, or delete a phrase's text, use the pencil
        icon next to the chips inside an inspection instead; this screen only decides where each one appears.
      </p>

      {actionError && (
        <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red flex items-start justify-between gap-3">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-rsl-red/60 shrink-0">
            ✕
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ---- Chip bank ---- */}
        <div>
          <h3 className="font-display font-bold text-rsl-navy text-sm mb-2">Chip Bank</h3>
          <div className="border border-rsl-navy/10 rounded-2xl p-4 max-h-[32rem] overflow-y-auto space-y-4">
            <PhraseBucketGroup label="Cleaning" phrases={cleaningPhrases} onStartDrag={startDrag} draggingPhraseId={draggingPhraseId} />
            <PhraseBucketGroup
              label="Maintenance"
              phrases={maintenancePhrases}
              onStartDrag={startDrag}
              draggingPhraseId={draggingPhraseId}
            />
            {phrases.length === 0 && (
              <p className="text-xs text-rsl-navy/40">
                No phrases yet — add some from the pencil icon next to any comment field during an inspection.
              </p>
            )}
          </div>
        </div>

        {/* ---- Zone-type buckets ---- */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-display font-bold text-rsl-navy text-sm">Zone Types</h3>
          </div>
          <input
            value={bucketSearch}
            onChange={(e) => setBucketSearch(e.target.value)}
            placeholder="Search zone types…"
            className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 mb-2"
          />
          <div className="flex gap-2 mb-3">
            <input
              value={newZoneTypeName}
              onChange={(e) => setNewZoneTypeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCustomZoneType();
              }}
              placeholder="Add a zone type not listed below…"
              className="flex-1 text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
            />
            <button
              onClick={addCustomZoneType}
              disabled={!newZoneTypeName.trim()}
              className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 disabled:opacity-40"
            >
              Add
            </button>
          </div>

          <div className="max-h-[28rem] overflow-y-auto space-y-2 pr-1">
            {visibleZoneTypes.map((zoneType) => {
              const assigned = assignedPhrasesFor(zoneType);
              const isHovered = hoveredZoneType === zoneType;
              const isOrphaned = orphanedZoneTypes.includes(zoneType);
              return (
                <div
                  key={zoneType}
                  ref={(el) => {
                    bucketRefs.current[zoneType] = el;
                  }}
                  className={`rounded-xl border p-3 transition-colors ${
                    isHovered ? 'border-rsl-blue bg-rsl-blue/5' : 'border-rsl-navy/10'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-semibold text-rsl-navy">{zoneType}</span>
                    {isOrphaned && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-rsl-gold bg-rsl-gold/10 rounded-full px-2 py-0.5">
                        No matching area/category
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 min-h-[1.75rem]">
                    {assigned.length === 0 && (
                      <span className="text-xs text-rsl-navy/30">Drop a chip here…</span>
                    )}
                    {assigned.map((phrase) => {
                      const assignment = assignments.find(
                        (a) =>
                          a.phrase_id === phrase.id && a.zone_type_name.toLowerCase() === zoneType.toLowerCase()
                      );
                      return (
                        <span
                          key={phrase.id}
                          className="text-[11px] bg-rsl-navy/5 rounded-full pl-2.5 pr-1 py-1 flex items-center gap-1"
                        >
                          {phrase.text}
                          <button
                            onClick={() => assignment && unassign(assignment)}
                            className="text-rsl-navy/30 hover:text-rsl-red px-1"
                            aria-label={`Remove "${phrase.text}" from ${zoneType}`}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visibleZoneTypes.length === 0 && (
              <p className="text-xs text-rsl-navy/40">No zone types match that search.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PhraseBucketGroup({
  label,
  phrases,
  onStartDrag,
  draggingPhraseId,
}: {
  label: string;
  phrases: Phrase[];
  onStartDrag: (phraseId: string) => void;
  draggingPhraseId: string | null;
}) {
  if (phrases.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-rsl-navy/40 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {phrases.map((phrase) => (
          <button
            key={phrase.id}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              onStartDrag(phrase.id);
            }}
            style={{ touchAction: 'none' }}
            className={`text-[11px] rounded-full px-2.5 py-1 cursor-grab active:cursor-grabbing transition-colors ${
              draggingPhraseId === phrase.id
                ? 'bg-rsl-navy text-white opacity-70'
                : 'text-rsl-navy/60 bg-rsl-navy/5 hover:bg-rsl-navy/10'
            }`}
          >
            {phrase.text}
          </button>
        ))}
      </div>
    </div>
  );
}
