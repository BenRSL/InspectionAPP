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
export const MAX_PHRASES_PER_CATEGORY = 30;
 
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
 
// Strips a trailing numeric or parenthetical suffix so numbered room-family
// instances fall back to a shared base name, e.g. "Office 3" -> "office",
// "Meeting Room 2" -> "meeting room", "Office 4 (Entry)" -> "office". Lets an
// admin assign chips once to the base name ("Office") and have it apply to
// every numbered instance (Office 1, Office 2, ...) without a separate
// Chip Bank assignment per instance. Order matters: a trailing parenthetical
// is stripped first so "Office 2 (North)" reduces to "Office 2" before the
// trailing number is stripped too, landing on the same base as "Office 3".
export function normalizeZoneTypeName(name: string): string {
  return name
    .trim()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s*\d+\s*$/, '')
    .trim()
    .toLowerCase();
}
 
// A phrase is relevant to a zone once it's been explicitly assigned (via the
// admin Chip Bank drag-assign screen) to that zone's exact name — the
// curated replacement for the old keyword-substring matching that caused
// irrelevant chips to show up on real zones. A phrase with no assignments
// anywhere simply isn't offered as a quick-pick chip for that zone; it's
// still reachable via the "Search other phrases…" box.
//
// Checks the exact zone name first (so a specific numbered instance can still
// be assigned its own phrases directly if ever needed), then falls back to the
// normalized base name (see normalizeZoneTypeName) so "Office 3" picks up
// whatever was assigned to "Office" without every instance needing its own
// assignment.
export function isPhraseRelevant(
  phraseId: string,
  zoneTypeName: string,
  zoneTypeIndex: Map<string, Set<string>>
): boolean {
  const exactKey = zoneTypeName.trim().toLowerCase();
  if (zoneTypeIndex.get(exactKey)?.has(phraseId)) return true;
 
  const baseKey = normalizeZoneTypeName(zoneTypeName);
  if (baseKey !== exactKey && zoneTypeIndex.get(baseKey)?.has(phraseId)) return true;
 
  return false;
}
 
 
