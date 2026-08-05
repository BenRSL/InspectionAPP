import type { SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// Bible Section 8.4, Stage 4 — parses an edited cost template back, matches
// each row to a health_items row by the "Item ID (do not edit)" column
// (see lib/cost-template.ts / lib/xlsx-report.ts for the export side that
// promises this exact contract), validates it, and applies everything
// that's valid in a single batched write — reporting per-row errors for
// anything that isn't, rather than blocking the whole file (Ben's call).

export type CostImportRowResult = {
  itemId: string;
  itemName: string | null;
  oldCost: number | null;
  newCost: number | null;
  oldConfidence: string | null;
  newConfidence: string | null;
  status: 'applied' | 'error';
  errorMessage?: string;
};

export type CostImportSummary = {
  rowsTotal: number;
  rowsApplied: number;
  rowsErrored: number;
  details: CostImportRowResult[];
};

const VALID_CONFIDENCE = new Set(['estimated', 'quoted']);

export async function processCostImport(
  supabase: SupabaseClient,
  siteId: string,
  fileBuffer: ArrayBuffer
): Promise<CostImportSummary> {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileBuffer, { type: 'array' });
  } catch {
    throw new Error('Could not read that file — is it a valid .xlsx export from the cost template?');
  }

  const sheet = workbook.Sheets['Costs'];
  if (!sheet) {
    throw new Error('No "Costs" sheet found in that file — re-download the template if unsure.');
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  const dataRows = rows.slice(1); // row 0 is the header

  // Active categories for this site, used to confirm every Item ID in the
  // file genuinely belongs to the site the upload was submitted against —
  // catches someone uploading last quarter's template, or another site's
  // file, against the wrong site.
  const { data: categoryRows, error: catErr } = await supabase
    .from('health_categories')
    .select('id')
    .eq('site_id', siteId)
    .eq('is_active', true);
  if (catErr) throw new Error(`Couldn't load site structure: ${catErr.message}`);

  const categoryIds = (categoryRows ?? []).map((c) => c.id as string);

  const { data: itemRows, error: itemErr } = await supabase
    .from('health_items')
    .select('id, item_name, replacement_cost, cost_confidence')
    .in('category_id', categoryIds.length > 0 ? categoryIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('is_active', true);
  if (itemErr) throw new Error(`Couldn't load site assets: ${itemErr.message}`);

  type ExistingItem = { id: string; item_name: string; replacement_cost: number | null; cost_confidence: string | null };
  const itemMap = new Map<string, ExistingItem>((itemRows ?? []).map((it) => [it.id as string, it as ExistingItem]));

  const details: CostImportRowResult[] = [];
  const toApply: { id: string; replacement_cost: number | null; cost_confidence: string | null }[] = [];

  dataRows.forEach((row, idx) => {
    const rowNum = idx + 2; // +1 for 0-index, +1 for the header row — matches the row number the user sees in Excel
    const itemIdRaw = row[0];
    const itemNameCol = typeof row[2] === 'string' ? row[2] : null;
    const rawCost = row[3];
    const rawConfidence = row[4];

    if (typeof itemIdRaw !== 'string' || !itemIdRaw.trim()) {
      return; // blank trailing row — Excel adds these sometimes, not worth flagging as an error
    }
    const itemId = itemIdRaw.trim();
    const existing = itemMap.get(itemId);

    if (!existing) {
      details.push({
        itemId,
        itemName: itemNameCol,
        oldCost: null,
        newCost: null,
        oldConfidence: null,
        newConfidence: null,
        status: 'error',
        errorMessage: `Row ${rowNum}: Item ID not found for this site — the file may be for a different site, or this asset may have been deleted or renamed since the template was downloaded.`,
      });
      return;
    }

    const label = existing.item_name;

    // Replacement Cost — blank clears it, otherwise must be a non-negative number.
    let newCost: number | null = null;
    const costStr = String(rawCost ?? '').trim();
    if (costStr !== '') {
      const parsed = Number(costStr);
      if (Number.isNaN(parsed)) {
        details.push({
          itemId,
          itemName: label,
          oldCost: existing.replacement_cost,
          newCost: null,
          oldConfidence: existing.cost_confidence,
          newConfidence: null,
          status: 'error',
          errorMessage: `Row ${rowNum} (${label}): Replacement Cost "${costStr}" is not a number.`,
        });
        return;
      }
      if (parsed < 0) {
        details.push({
          itemId,
          itemName: label,
          oldCost: existing.replacement_cost,
          newCost: null,
          oldConfidence: existing.cost_confidence,
          newConfidence: null,
          status: 'error',
          errorMessage: `Row ${rowNum} (${label}): Replacement Cost cannot be negative.`,
        });
        return;
      }
      newCost = parsed;
    }

    // Cost Confidence — blank clears it, otherwise must be exactly "estimated" or "quoted".
    let newConfidence: string | null = null;
    const confStr = String(rawConfidence ?? '').trim().toLowerCase();
    if (confStr !== '') {
      if (!VALID_CONFIDENCE.has(confStr)) {
        details.push({
          itemId,
          itemName: label,
          oldCost: existing.replacement_cost,
          newCost: null,
          oldConfidence: existing.cost_confidence,
          newConfidence: null,
          status: 'error',
          errorMessage: `Row ${rowNum} (${label}): Cost Confidence "${String(rawConfidence)}" must be exactly "estimated" or "quoted" (or left blank).`,
        });
        return;
      }
      newConfidence = confStr;
    }

    toApply.push({ id: itemId, replacement_cost: newCost, cost_confidence: newConfidence });
    details.push({
      itemId,
      itemName: label,
      oldCost: existing.replacement_cost,
      newCost,
      oldConfidence: existing.cost_confidence,
      newConfidence,
      status: 'applied',
    });
  });

  // Single batched upsert on the primary key — one round trip regardless of
  // row count, well inside the ~340-row portfolio ceiling and the 30s
  // function timeout. Note this is one atomic statement: if it's rejected
  // wholesale (e.g. an RLS denial because the signed-in user isn't
  // admin/god_mode), every row that was about to be applied is reclassified
  // as an error below rather than silently reporting a false success.
  if (toApply.length > 0) {
    const { error: upsertErr } = await supabase.from('health_items').upsert(toApply);
    if (upsertErr) {
      for (const d of details) {
        if (d.status === 'applied') {
          d.status = 'error';
          d.errorMessage = `Not saved: ${upsertErr.message}`;
        }
      }
    }
  }

  const rowsApplied = details.filter((d) => d.status === 'applied').length;
  const rowsErrored = details.filter((d) => d.status === 'error').length;

  return {
    rowsTotal: rowsApplied + rowsErrored,
    rowsApplied,
    rowsErrored,
    details,
  };
}
