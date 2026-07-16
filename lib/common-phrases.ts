// Common comment phrases shown as tap-to-fill chips on Fail comments, and used to
// filter down to matches as the inspector types (predictive text). Edit the `text`
// freely, or add/remove `keywords` to change which zones a phrase shows up for —
// no code changes needed elsewhere.
//
// A phrase with no `keywords` is treated as universal and shows up for every zone.
// A phrase WITH keywords only shows up (in the default, untyped view) for zones
// whose name contains one of those keywords — e.g. "Leaking tap" only appears for
// zones with "toilet", "bathroom", or "kitchen" in the name, not a carpark.
// Typing still searches the full list regardless of keywords, so nothing is ever
// truly hidden — just deprioritised until you start typing.

export type Phrase = { text: string; keywords?: string[] };

export const CLEANING_PHRASES: Phrase[] = [
  { text: 'Rubbish not cleared' },
  { text: 'Dust on surfaces' },
  { text: 'Windows dirty' },
  { text: 'Cobwebs present' },
  { text: 'Bin overflowing' },
  { text: 'Marks on walls' },
  { text: 'Carpet stained', keywords: ['office', 'reception', 'meeting', 'board', 'level', 'l1', 'l2', 'l3'] },
  { text: 'Toilet not cleaned', keywords: ['toilet', 'bathroom', 'restroom'] },
  { text: 'Kitchen bench not wiped down', keywords: ['kitchen'] },
  {
    text: 'Floor needs mopping',
    keywords: ['carpark', 'lobby', 'foyer', 'entrance', 'kitchen', 'toilet', 'basement', 'b1', 'b2'],
  },
];

export const MAINTENANCE_PHRASES: Phrase[] = [
  { text: 'Cracked paint' },
  { text: 'Patch paint required' },
  { text: 'Light fitting faulty' },
  { text: 'Ceiling tile stained' },
  { text: 'Power point not working' },
  { text: 'Air conditioning not working' },
  { text: 'Leaking tap', keywords: ['toilet', 'bathroom', 'kitchen', 'restroom'] },
  { text: 'Door seal worn', keywords: ['lift', 'door', 'entrance', 'fire stairs'] },
  { text: 'Door handle loose', keywords: ['door', 'entrance', 'office', 'meeting', 'board'] },
  { text: 'Carpet damaged', keywords: ['office', 'reception', 'meeting', 'board', 'level', 'l1', 'l2', 'l3'] },
  { text: 'Roof membrane damaged', keywords: ['roof', 'plant'] },
  { text: 'Garden overgrown', keywords: ['garden', 'external', 'path'] },
  { text: 'Path cracked', keywords: ['path', 'external', 'access'] },
  { text: 'Carpark surface damaged', keywords: ['carpark', 'driveway', 'bay'] },
];

