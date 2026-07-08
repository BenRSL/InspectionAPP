/**
 * RSLQLD Inspection App — Stage 2: SOHC Report Spec
 * Extends lib/report.ts. Reuses the existing jsPDF setup, branded header/
 * footer, and Resend email delivery — this is a second `buildPdf` variant,
 * not a new report engine (per Bible Section 11.4: "Reuse, don't rebuild").
 *
 * PAGE STRUCTURE (mirrors Stage 1's 4-page pattern, adapted for graded data):
 *
 * PAGE 1 — Cover
 *   - Site name, year, inspector, navy/gold "Annual" branding (vs Stage 1's
 *     red/navy Monthly theme)
 *
 * PAGE 2 — Condition Summary
 *   - Count of items by rating: Good / Fair / Poor / Critical
 *   - "Needs Attention" list: every Poor/Critical item, one line each
 *   - Year-over-year trend arrows (↑ improved / ↓ worsened / → unchanged)
 *     next to any item that also has a prior-year SOHC record
 *   - NEW: Linked-asset 12-month history callout — for any health_item
 *     with a non-null stage1_area_id, pull the last 12 months of Stage 1
 *     inspection_items for that floor_area and summarise:
 *       e.g. "Lift — 3 fails in last 12 months (cleaning: 1, maintenance: 2)
 *             · Currently rated Fair · 3–5 years remaining life"
 *
 * PAGE 3 — Capital Forecast (NEW)
 *   - Auto-filtered list: any item rated Poor/Critical, OR in the 0–2 year
 *     life-expectancy band, regardless of rating
 *   - Grouped by life-expectancy band, so the assets team can read this as
 *     a rough forward budget plan rather than a flat list
 *
 * PAGE 4 — Category-by-category detail
 *   - Same 10 categories as the Admin portal, each item with rating,
 *     life-expectancy band, comment, photos (per decision #5: only
 *     attached where rating is Fair or worse)
 *
 * PAGE 5 — Sign-off
 *   - Inspector name, signature, date (same as Stage 1)
 *
 * ---------------------------------------------------------------
 * Pseudocode — actual implementation depends on lib/report.ts's existing
 * jsPDF helper functions (addHeader, addFooter, etc.), which weren't
 * available in this session. This should be dropped in alongside the
 * existing buildPdf(inspection) function once that file is available.
 * ---------------------------------------------------------------
 */

async function buildHealthPdf(healthInspectionId: string) {
  const inspection = await getHealthInspection(healthInspectionId);
  const items = await getHealthInspectionItems(healthInspectionId); // joined with health_items + health_categories
  const priorYear = await getHealthInspection(inspection.site_id, inspection.year - 1);

  const doc = new jsPDF();

  addCoverPage(doc, {
    site: inspection.site_name,
    year: inspection.year,
    inspector: inspection.inspector_name,
    theme: 'annual', // navy/gold, vs Stage 1's 'monthly' red/navy
  });

  addConditionSummaryPage(doc, {
    counts: countByRating(items), // Good/Fair/Poor/Critical tallies
    needsAttention: items.filter(i => i.requires_attention),
    trends: items.map(i => ({
      item: i.item_name,
      current: i.condition,
      prior: priorYear ? findMatchingItem(priorYear, i)?.condition : null,
      direction: getTrendDirection(i.condition, priorYear),
    })),
    linkedAssetHistory: await Promise.all(
      items
        .filter(i => i.stage1_area_id)
        .map(async (i) => ({
          item: i.item_name,
          stage1Summary: await getLast12MonthsSummary(i.stage1_area_id),
          // e.g. { failCount: 3, cleaningFails: 1, maintenanceFails: 2 }
          condition: i.condition,
          lifeExpectancy: i.life_expectancy,
        }))
    ),
  });

  addCapitalForecastPage(doc, {
    items: items.filter(i =>
      i.requires_attention || i.life_expectancy === '0_2'
    ),
    groupBy: 'life_expectancy',
  });

  addCategoryDetailPages(doc, {
    categories: groupByCategory(items), // same 10-category order as Admin portal
  });

  addSignOffPage(doc, inspection);

  return doc;
}
