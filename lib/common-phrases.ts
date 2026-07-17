// Comment phrases used to live here as static lists. They now live in the
// `comment_phrases` Supabase table instead, so they can be added/edited/deleted
// from inside the app (the pencil icon next to the chips in Inspector.tsx) without
// a code change or deploy. This file just keeps the shared type.
 
export type Phrase = {
  id: string;
  text: string;
  keywords: string[] | null;
};
 
// Soft cap per category — shown as a gentle nudge once you hit it while adding a
// new phrase, not enforced as a hard block. Purely a "keep it scannable on a phone
// screen" guideline; change freely.
export const MAX_PHRASES_PER_CATEGORY = 15;
 
 
 
