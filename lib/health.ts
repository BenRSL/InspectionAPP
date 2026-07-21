// Types for the State of Health Checklist (SOHC / Stage 2).
// Mirrors the shape of lib/sites.ts (Site/Floor/FloorArea/ChecklistItem) but for
// health_categories / health_items, which are per-site tables (not shared config).

export type HealthCondition = 'good' | 'fair' | 'poor' | 'critical';
export type LifeExpectancyBand = '0_2' | '3_5' | '6_10' | '10_plus' | 'na';

export const CONDITION_OPTIONS: { value: HealthCondition; label: string }[] = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'critical', label: 'Critical' },
];

export const LIFE_EXPECTANCY_OPTIONS: { value: LifeExpectancyBand; label: string }[] = [
  { value: '0_2', label: '0–2 years' },
  { value: '3_5', label: '3–5 years' },
  { value: '6_10', label: '6–10 years' },
  { value: '10_plus', label: '10+ years' },
  { value: 'na', label: 'N/A' },
];

export interface HealthItem {
  id: string;
  name: string;
}

export interface HealthCategory {
  id: string;
  name: string;
  items: HealthItem[];
}

// requires_attention mirrors the WHERE clause in v_asset_lifecycle_flags exactly —
// keep these two in sync if that view's logic ever changes. 'na' (added for items
// that don't have a meaningful remaining-life estimate) never matches the '0_2'
// check below, so it can't trigger a false attention-flag — no view change needed.
export function computeRequiresAttention(
  condition: HealthCondition | null,
  lifeExpectancy: LifeExpectancyBand | null
): boolean {
  if (condition === 'poor' || condition === 'critical') return true;
  if (lifeExpectancy === '0_2') return true;
  return false;
}
