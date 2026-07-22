'use client';

import { useState } from 'react';
import { type Phrase, MAX_PHRASES_PER_CATEGORY, isPhraseRelevant } from '@/lib/common-phrases';

// Shared between Stage 1 (Inspector.tsx, scoped to an area name) and SOHC
// (HealthInspector.tsx, scoped to a category name) — "zoneTypeName" is
// whichever of those applies. Relevance is decided entirely by explicit
// admin curation (comment_phrase_zone_types, via the Chip Bank screen),
// not by substring-matching keywords against the zone's name.
export default function PhraseChips({
  phrases,
  zoneTypeName,
  zoneTypeIndex,
  value,
  onSelect,
  onAddPhrase,
  onRenamePhrase,
  onDeletePhrase,
}: {
  phrases: Phrase[];
  zoneTypeName: string;
  zoneTypeIndex: Map<string, Set<string>>;
  value: string;
  onSelect: (nextValue: string) => void;
  onAddPhrase?: (text: string) => void;
  onRenamePhrase?: (id: string, text: string) => void;
  onDeletePhrase?: (id: string) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [newPhraseText, setNewPhraseText] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // Always shown in full, scoped to this zone — NOT filtered down by what's
  // already typed. Filtering by the comment text was the original bug: selecting
  // one chip made the comment itself the filter query, which wiped out every
  // other chip.
  const relevant = phrases.filter((p) => isPhraseRelevant(p.id, zoneTypeName, zoneTypeIndex));

  // A chip is "selected" if its exact text is already one of the comma-separated
  // segments in the comment, so multiple chips can be built up together and each
  // stays tappable to remove just that one.
  const segments = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  function toggle(phrase: Phrase) {
    const already = segments.includes(phrase.text);
    const nextSegments = already ? segments.filter((s) => s !== phrase.text) : [...segments, phrase.text];
    onSelect(nextSegments.join(', '));
  }

  // Separate search over the FULL phrase list (not just this zone's relevant set),
  // for anomalies the zone-scoping doesn't cover — deliberately kept out of the
  // comment box itself so typing here can never wipe out the persistent chips.
  const searchMatches = searchQuery.trim()
    ? phrases.filter(
        (p) =>
          p.text.toLowerCase().includes(searchQuery.trim().toLowerCase()) &&
          !relevant.some((r) => r.id === p.id)
      )
    : [];

  function submitNewPhrase() {
    const trimmed = newPhraseText.trim();
    if (!trimmed || !onAddPhrase) return;
    onAddPhrase(trimmed);
    setNewPhraseText('');
  }

  function submitRename(id: string) {
    const trimmed = renameText.trim();
    if (!trimmed || !onRenamePhrase) return;
    onRenamePhrase(id, trimmed);
    setRenamingId(null);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5 items-center">
        {relevant.map((phrase) => {
          const selected = segments.includes(phrase.text);

          if (editMode && renamingId === phrase.id) {
            return (
              <span key={phrase.id} className="flex items-center gap-1">
                <input
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename(phrase.id);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="text-[11px] rounded-full border border-rsl-navy/20 px-2 py-1 w-28"
                />
                <button type="button" onClick={() => submitRename(phrase.id)} className="text-pass text-xs">
                  ✓
                </button>
              </span>
            );
          }

          if (editMode) {
            return (
              <span
                key={phrase.id}
                className="text-[11px] bg-rsl-navy/5 rounded-full pl-2.5 pr-1 py-1 flex items-center gap-1"
              >
                <button
                  type="button"
                  onClick={() => {
                    setRenamingId(phrase.id);
                    setRenameText(phrase.text);
                  }}
                  className="text-rsl-navy/70"
                >
                  {phrase.text}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        `Remove "${phrase.text}" from this list everywhere it appears — not just this zone? This can't be undone.`
                      )
                    ) {
                      onDeletePhrase?.(phrase.id);
                    }
                  }}
                  className="text-rsl-navy/30 hover:text-rsl-red px-1"
                  aria-label={`Delete "${phrase.text}"`}
                >
                  ✕
                </button>
              </span>
            );
          }

          return (
            <button
              key={phrase.id}
              type="button"
              onClick={() => toggle(phrase)}
              className={`text-[11px] rounded-full px-2.5 py-1 transition-colors ${
                selected ? 'bg-rsl-navy text-white' : 'text-rsl-navy/60 bg-rsl-navy/5 hover:bg-rsl-navy/10'
              }`}
            >
              {selected ? '✓ ' : ''}
              {phrase.text}
            </button>
          );
        })}

        {(onAddPhrase || onRenamePhrase || onDeletePhrase) && (
          <button
            type="button"
            onClick={() => {
              setEditMode((v) => !v);
              setRenamingId(null);
            }}
            className="text-rsl-navy/30 hover:text-rsl-navy/60 text-[11px] px-1"
            aria-label="Edit phrase chips"
          >
            {editMode ? 'Done' : '✎'}
          </button>
        )}
      </div>

      {editMode && onAddPhrase && (
        <div className="flex gap-1.5 items-center">
          <input
            value={newPhraseText}
            onChange={(e) => setNewPhraseText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitNewPhrase();
            }}
            placeholder="Add a phrase…"
            className="text-[11px] rounded-full border border-rsl-navy/20 px-2.5 py-1 flex-1 min-w-0"
          />
          <button
            type="button"
            onClick={submitNewPhrase}
            className="text-[11px] font-semibold text-white bg-rsl-navy rounded-full px-3 py-1 shrink-0"
          >
            Add
          </button>
        </div>
      )}
      {editMode && phrases.length >= MAX_PHRASES_PER_CATEGORY && (
        <p className="text-[10px] text-rsl-gold">
          {phrases.length} phrases in this list — consider removing one you don't need to keep it scannable.
        </p>
      )}

      {!editMode && (onAddPhrase || onRenamePhrase || onDeletePhrase) && (
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search other phrases…"
          className="text-[11px] text-rsl-navy/50 rounded-full border border-rsl-navy/10 px-2.5 py-1 w-full sm:w-52"
        />
      )}
      {searchMatches.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {searchMatches.map((phrase) => (
            <button
              key={phrase.id}
              type="button"
              onClick={() => toggle(phrase)}
              className="text-[11px] text-rsl-blue bg-rsl-blue/5 hover:bg-rsl-blue/10 rounded-full px-2.5 py-1"
            >
              {phrase.text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
