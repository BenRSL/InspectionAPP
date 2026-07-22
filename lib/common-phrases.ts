// Comment phrases used to live here as static lists. They now live in the
// `comment_phrases` Supabase table instead, so they can be added/edited/deleted
// from inside the app (the pencil icon next to the chips) without a code
// change or deploy. This file just keeps the shared types + matching logic.

export type Phrase = {
  id: string;
  text: string;
  keywords: string[] | null; // vestigial — kept on the row but no longer read for matching, see below
};

// A row in comment_phrase_zone_types — one explicit "this phrase belongs on
// this zone type" assignment, curated via the admin Chip Bank screen rather
// than inferred from keyword substrings. "Zone type" means the exact area
// name (Stage 1, e.g. "Toilets") or category name (SOHC, e.g. "Roof &
// External Envelope") — assigning a phrase once makes it show up everywhere
// that name is used, across every site.
export type ZoneTypeAssignment = {
  id: string;
  phrase_id: string;
  zone_type_name: string;
};

// Soft cap per category — shown as a gentle nudge once you hit it while adding a
// new phrase, not enforced as a hard block. Purely a "keep it scannable on a phone
// screen" guideline; change freely.
export const MAX_PHRASES_PER_CATEGORY = 15;

// Builds zone_type_name (lowercased) -> Set<phrase id> for fast relevance
// lookups. Case-insensitive so "Toilets" and "toilets" are treated as the
// same bucket even if capitalization drifts between an area name and a
// hand-typed bucket name.
export function buildZoneTypeIndex(assignments: ZoneTypeAssignment[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  for (const a of assignments) {
    const key = a.zone_type_name.trim().toLowerCase();
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(a.phrase_id);
  }
  return index;
}

// A phrase is relevant to a zone once it's been explicitly assigned (via the
// admin Chip Bank drag-assign screen) to that zone's exact name — the
// curated replacement for the old keyword-substring matching that caused
// irrelevant chips to show up on real zones. A phrase with no assignments
// anywhere simply isn't offered as a quick-pick chip for that zone; it's
// still reachable via the "Search other phrases…" box.
export function isPhraseRelevant(
  phraseId: string,
  zoneTypeName: string,
  zoneTypeIndex: Map<string, Set<string>>
): boolean {
  return zoneTypeIndex.get(zoneTypeName.trim().toLowerCase())?.has(phraseId) ?? false;
}

