// Central site config. Long-term this data lives in Supabase (sites, floor_areas,
// checklist_items tables — see supabase/schema.sql). This file provides typed
// fallbacks + the shape the UI expects, and seeds local/offline state.

export type ItemCategory = 'cleaning' | 'maintenance';

export interface ChecklistItem {
  id: string;
  name: string;
  category: ItemCategory;
}

export interface FloorArea {
  id: string;
  name: string;
  items: ChecklistItem[];
}

export interface Floor {
  id: string;
  name: string;
  areas: FloorArea[];
}

export interface Site {
  id: string;
  name: string;
  displayLabel: string;
  floors: Floor[];
}

// Every area gets the same two default checks (Cleaning + Maintenance) unless
// overridden — matches the "tick-and-flick" format from the sample checklist.
// Admins can add/edit/delete specific items per area via the Admin portal.
function defaultItems(areaId: string): ChecklistItem[] {
  return [
    { id: `${areaId}-clean`, name: 'General condition', category: 'cleaning' },
    { id: `${areaId}-maint`, name: 'General condition', category: 'maintenance' },
  ];
}

function area(id: string, name: string): FloorArea {
  return { id, name, items: defaultItems(id) };
}

// ANZAC HOUSE — pilot site, from BUILDING_INSPECTION_CHECKLIST.docx
export const anzacHouse: Site = {
  id: 'anzac-house',
  name: 'Anzac House',
  displayLabel: 'Anzac House',
  floors: [
    {
      id: 'b2', name: 'B2 – Basement Level 2',
      areas: [area('b2-driveway', 'Carpark Driveway'), area('b2-bays', 'Carpark Bays'), area('b2-store', 'Cleaners Store')],
    },
    {
      id: 'b1', name: 'B1 – Basement Level 1',
      areas: [area('b1-carpark', 'Carpark')],
    },
    {
      id: 'gf', name: 'GF – Ground Floor',
      areas: [
        area('gf-foyer', 'Entrance / Foyer'), area('gf-reception', 'Reception'), area('gf-lift', 'Lift'),
        area('gf-offices', 'Offices (General)'), area('gf-meeting', 'Meeting Rooms'), area('gf-toilets', 'Toilets'),
        area('gf-kitchen', 'Kitchen'), area('gf-plant', 'Plant Room'),
      ],
    },
    {
      id: 'l1', name: 'L1 – Level 1',
      areas: [
        area('l1-open', 'Open Plan Office'), area('l1-meeting', 'Meeting Rooms'), area('l1-quiet', 'Quiet Rooms'),
        area('l1-phone', 'Phone Booths'), area('l1-toilets', 'Toilets'), area('l1-kitchen', 'Kitchen'),
      ],
    },
    {
      id: 'l2', name: 'L2 – Level 2',
      areas: [
        area('l2-offices', 'Offices'), area('l2-meeting', 'Meeting Rooms'), area('l2-hr', 'HR Office'),
        area('l2-locker', 'Locker Room'), area('l2-toilets', 'Toilets'), area('l2-kitchen', 'Kitchen'),
      ],
    },
    {
      id: 'l3', name: 'L3 – Level 3',
      areas: [
        area('l3-exec', 'Executive Offices'), area('l3-board', 'Boardrooms'), area('l3-collab', 'Collaboration Areas'),
        area('l3-booths', 'Booths'), area('l3-toilets', 'Toilets'),
      ],
    },
    {
      id: 'common', name: 'Common Areas',
      areas: [area('common-lift', 'Lift'), area('common-stairs', 'Fire Stairs')],
    },
    {
      id: 'roof', name: 'Roof',
      areas: [area('roof-membrane', 'Roof Membrane'), area('roof-plant', 'Plant Equipment')],
    },
    {
      id: 'external', name: 'External / Gardens',
      areas: [area('ext-gardens', 'Gardens'), area('ext-paths', 'Paths / Access')],
    },
  ],
};

// Remaining 8 sites — zone/area counts confirmed in Bible v1.6 Section 3.
// Full floor/area data to be entered via Admin portal onboarding workflow (Section 6.9)
// or migrated from the HTML mockups already built (Phase 6). Placeholder shells below
// so the site switcher is complete even before that data entry happens.
//
// NOTE: ids below must match the `slug` column in Supabase's sites table, since
// app/sites/[siteId]/page.tsx looks sites up by slug. bundall-suite-1/2 corrected
// here (this session) to match — they were previously bundall-1/bundall-2, which
// didn't match the Supabase slugs and would have 404'd.
export const siteShells: Omit<Site, 'floors'>[] = [
  { id: 'wickham-l14', name: '100 Wickham St', displayLabel: '(L14) 100 Wickham' },
  { id: 'stafford', name: 'Stafford', displayLabel: 'Stafford' },
  { id: 'strathpine', name: 'Strathpine', displayLabel: 'Strathpine' },
  { id: 'bundall-suite-1', name: 'Bundall Suite 1', displayLabel: 'Bundall (Suite 1)' },
  { id: 'bundall-suite-2', name: 'Bundall Suite 2', displayLabel: 'Bundall (Suite 2)' },
  { id: 'maroochydore', name: 'Maroochydore', displayLabel: 'Maroochydore' },
  { id: 'ipswich', name: 'Ipswich', displayLabel: 'Ipswich' },
  { id: 'toowoomba', name: 'Toowoomba', displayLabel: 'Toowoomba' },
];

export const allSites: Site[] = [
  anzacHouse,
  ...siteShells.map((s) => ({ ...s, floors: [] as Floor[] })),
];

export function getSite(id: string): Site | undefined {
  return allSites.find((s) => s.id === id);
}
