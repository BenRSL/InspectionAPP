import * as XLSX from 'xlsx';
import type { ReportData } from './report';
import type { HealthReportData } from './health-report';
import { LIFE_EXPECTANCY_OPTIONS, computeRequiresAttention } from './health';

// Same column widths reused across every sheet in both workbooks — keeps
// Comment columns readable without the rest of the table going wide too.
const STAGE1_COL_WIDTHS = [{ wch: 14 }, { wch: 20 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 45 }];
const HEALTH_COL_WIDTHS = [{ wch: 24 }, { wch: 24 }, { wch: 12 }, { wch: 16 }, { wch: 45 }, { wch: 10 }];

function monthLabel(periodMonth: string): string {
  // period_month is stored as a plain date (e.g. '2026-07-01') — display as
  // "July 2026" rather than the raw ISO string.
  const d = new Date(`${periodMonth}T00:00:00`);
  return Number.isNaN(d.getTime()) ? periodMonth : d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

const lifeExpectancyLabel = (band: HealthReportData['categories'][number]['items'][number]['lifeExpectancy']) =>
  LIFE_EXPECTANCY_OPTIONS.find((o) => o.value === band)?.label ?? 'Not assessed';

// ============================================================
// Stage 1 — Monthly Inspect
// ============================================================

export function renderStage1ReportXlsx(data: ReportData): Buffer {
  const flatRows = data.floors.flatMap((f) =>
    f.areas.flatMap((a) =>
      a.items.map((it) => [
        f.name,
        a.name,
        it.name,
        it.category === 'cleaning' ? 'Cleaning' : 'Maintenance',
        it.result === 'pass' ? 'Pass' : it.result === 'fail' ? 'Fail' : 'Not assessed',
        it.comment ?? '',
      ])
    )
  );

  const infoRows = [
    ['Site', data.siteName],
    ['Reporting month', monthLabel(data.periodMonth)],
    ['Inspector', data.inspectorEmail ?? '—'],
    ['Status', data.status],
    [],
  ];
  const headerRow = ['Floor', 'Area', 'Item', 'Category', 'Result', 'Comment'];

  const wb = XLSX.utils.book_new();

  const allSheet = XLSX.utils.aoa_to_sheet([...infoRows, headerRow, ...flatRows]);
  allSheet['!cols'] = STAGE1_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, allSheet, 'All Items');

  const failedRows = flatRows.filter((r) => r[4] === 'Fail');
  const failedSheet = XLSX.utils.aoa_to_sheet([...infoRows, headerRow, ...failedRows]);
  failedSheet['!cols'] = STAGE1_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, failedSheet, 'Failed Items');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// ============================================================
// SOHC — State of Health Checklist
// ============================================================

export function renderHealthReportXlsx(data: HealthReportData): Buffer {
  const flatRows = data.categories.flatMap((c) =>
    c.items.map((it) => [
      c.name,
      it.name,
      it.condition ? it.condition.charAt(0).toUpperCase() + it.condition.slice(1) : 'Not assessed',
      lifeExpectancyLabel(it.lifeExpectancy),
      it.comment ?? '',
      computeRequiresAttention(it.condition, it.lifeExpectancy) ? 'Yes' : '',
    ])
  );

  const infoRows = [
    ['Site', data.siteName],
    ['Year', data.year],
    ['Inspector', data.inspectorEmail ?? '—'],
    ['Status', data.status],
    [],
  ];
  const headerRow = ['Category', 'Item', 'Condition', 'Life expectancy', 'Comment', 'Flagged'];

  const wb = XLSX.utils.book_new();

  const allSheet = XLSX.utils.aoa_to_sheet([...infoRows, headerRow, ...flatRows]);
  allSheet['!cols'] = HEALTH_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, allSheet, 'All Items');

  const flaggedRows = flatRows.filter((r) => r[5] === 'Yes');
  const flaggedSheet = XLSX.utils.aoa_to_sheet([...infoRows, headerRow, ...flaggedRows]);
  flaggedSheet['!cols'] = HEALTH_COL_WIDTHS;
  XLSX.utils.book_append_sheet(wb, flaggedSheet, 'Flagged Items');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
