/**
 * RSLQLD Inspection App — New Site Onboarding Workflow
 * Bible Roadmap Phase 13. Triggered by God Mode's "Add Site" action
 * (Part 3, Step 2 of the Tutorial Guide) — this is what actually happens
 * after a site name is entered, instead of dropping into an empty shell.
 *
 * Goal: a God Mode user with zero dev involvement should be able to take
 * a brand-new property from "just a name" to "ready for its first
 * Monthly Inspection" in one guided flow, reusing Anzac House's pattern
 * as the reference model (9 zones, 31 areas, Cleaning + Maintenance split).
 */

// ============================================================
// STEP 1 — Site basics
// ============================================================
// Fields: site name, display label (for the site switcher), address,
// site type (office / clinical+residential like Ipswich / single-floor
// like 100 Wickham, etc — site_type drives which starter template
// Step 2 offers).
// Writes: one row to `sites`, status = 'onboarding' (not yet visible
// in the live site switcher until onboarding completes — avoids an
// Inspector selecting a half-configured site).

// ============================================================
// STEP 2 — Floors & zones
// ============================================================
// God Mode enters floor/zone names (e.g. "B2", "GF", "L1"..."Roof").
// Offer a "copy structure from an existing site" shortcut — since new
// sites are often similar to an existing one (e.g. new office building
// probably resembles Anzac House's GF/L1/L2/L3 pattern more than
// Ipswich's clinical layout).
// Writes: rows to `floor_areas` (floor_name only at this point,
// area_name filled in next step).

// ============================================================
// STEP 3 — Areas per floor (Monthly checklist)
// ============================================================
// For each floor from Step 2, add areas (e.g. "Open Plan Office",
// "Toilets", "Kitchen"). Same "copy from existing site" shortcut,
// scoped per floor type this time (a "GF" floor can copy Anzac House's
// GF areas as a starting draft).
// Writes: completes `floor_areas` rows (area_name), then auto-generates
// matching `checklist_items` rows (Cleaning + Maintenance per area) —
// this is the expensive manual step Anzac House took a full session to
// do; the copy-shortcut is what makes the other 8 sites fast.

// ============================================================
// STEP 4 — Assign people
// ============================================================
// Pick or invite the Admin who'll manage this site day-to-day, and any
// Inspectors who'll be doing the walkthroughs. Reuses the existing
// Users tab invite flow rather than a new mechanism.
// Writes: `users.assigned_sites[]` updated for selected accounts.

// ============================================================
// STEP 5 — Review & activate
// ============================================================
// Summary screen: X floors, Y areas, Z checklist items, assigned
// Admin + N Inspectors. One button: Activate Site.
// On activate: `sites.status` flips from 'onboarding' to 'active' —
// this is the moment it appears in the live site switcher and becomes
// selectable for a real Monthly Inspection.
//
// Note: SOHC categories/items are deliberately NOT part of this flow —
// they're seeded separately (per-site, same 10-category framework as
// Anzac House) since SOHC is annual and lower-urgency than getting a
// site ready for its first Monthly Inspection. A site can go live for
// Monthly Inspect before its SOHC template exists.

// ============================================================
// UI pattern: stepper, not a single long form
// ============================================================
// 5 numbered steps across the top, back/next navigation, partial
// progress saved at every step (God Mode can close and resume later —
// an `onboarding_step` int column on `sites` tracks where they left off).
