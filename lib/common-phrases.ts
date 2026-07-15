// Common comment phrases shown as tap-to-fill chips on Fail comments, and used to
// filter down to matches as the inspector types (predictive text). Edit these lists
// freely — they're plain strings, no code changes needed elsewhere.
//
// Kept separate per category since a cleaning issue and a maintenance issue call for
// different language, and mixing them into one list would make both less useful.

export const CLEANING_PHRASES: string[] = [
  'Rubbish not cleared',
  'Carpet stained',
  'Dust on surfaces',
  'Windows dirty',
  'Cobwebs present',
  'Floor needs mopping',
  'Bin overflowing',
  'Marks on walls',
  'Kitchen bench not wiped down',
  'Toilet not cleaned',
];

export const MAINTENANCE_PHRASES: string[] = [
  'Cracked paint',
  'Patch paint required',
  'Light fitting faulty',
  'Leaking tap',
  'Door seal worn',
  'Carpet damaged',
  'Ceiling tile stained',
  'Power point not working',
  'Door handle loose',
  'Air conditioning not working',
];
