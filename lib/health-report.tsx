import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer';
import { supabaseServer } from './supabase-server';
import type { HealthCondition, LifeExpectancyBand } from './health';
import { computeRequiresAttention, LIFE_EXPECTANCY_OPTIONS } from './health';

// ============================================================
// Data fetching — same shape and query pattern as lib/report.tsx's
// buildReportData, adapted for health_categories/health_items.
// ============================================================

export type HealthReportItem = {
  id: string;
  name: string;
  condition: HealthCondition | null;
  lifeExpectancy: LifeExpectancyBand | null;
  comment: string | null;
  photoUrls: string[]; // storage paths in the shared inspection-photos bucket, health/ prefix
};

export type HealthReportCategory = {
  id: string;
  name: string;
  items: HealthReportItem[];
};

export type HealthReportData = {
  siteName: string;
  inspectorEmail: string | null;
  year: number;
  status: string;
  completedAt: string | null;
  categories: HealthReportCategory[];
};

export async function buildHealthReportData(healthInspectionId: string): Promise<HealthReportData | null> {
  const supabase = supabaseServer();

  const { data: inspection, error: inspErr } = await supabase
    .from('health_inspections')
    .select('id, site_id, inspector_id, year, status, completed_at')
    .eq('id', healthInspectionId)
    .single();

  if (inspErr || !inspection) return null;

  const [siteRes, inspectorRes, categoriesRes, savedItemsRes] = await Promise.all([
    supabase.from('sites').select('name').eq('id', inspection.site_id).single(),
    inspection.inspector_id
      ? supabase.from('users').select('email').eq('id', inspection.inspector_id).maybeSingle()
      : Promise.resolve({ data: null as { email: string } | null }),
    supabase
      .from('health_categories')
      .select('id, category_name, sort_order')
      .eq('site_id', inspection.site_id)
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('health_inspection_items')
      .select('health_item_id, condition, life_expectancy, comment, photo_urls')
      .eq('health_inspection_id', healthInspectionId),
  ]);

  const categoryRows = categoriesRes.data ?? [];
  const categoryIds = categoryRows.map((c) => c.id);

  const { data: itemRows } = await supabase
    .from('health_items')
    .select('id, category_id, item_name, sort_order')
    .in('category_id', categoryIds.length > 0 ? categoryIds : ['00000000-0000-0000-0000-000000000000'])
    .eq('is_active', true)
    .order('sort_order');

  const savedByItemId = new Map((savedItemsRes.data ?? []).map((it) => [it.health_item_id, it]));

  const categories: HealthReportCategory[] = categoryRows.map((c) => ({
    id: c.id,
    name: c.category_name,
    items: (itemRows ?? [])
      .filter((it) => it.category_id === c.id)
      .map((it) => {
        const saved = savedByItemId.get(it.id);
        return {
          id: it.id,
          name: it.item_name,
          condition: (saved?.condition as HealthCondition | undefined) ?? null,
          lifeExpectancy: (saved?.life_expectancy as LifeExpectancyBand | undefined) ?? null,
          comment: saved?.comment ?? null,
          photoUrls: saved?.photo_urls ?? [],
        };
      }),
  }));

  return {
    siteName: siteRes.data?.name ?? 'Unknown site',
    inspectorEmail: inspectorRes.data?.email ?? null,
    year: inspection.year,
    status: inspection.status,
    completedAt: inspection.completed_at,
    categories,
  };
}

// ============================================================
// PDF document — same StyleSheet/Document/Page structure as
// lib/report.tsx's ReportDocument, gold accent instead of pass-green
// to read as "Annual" at a glance next to Stage 1's Monthly reports.
// ============================================================

const COLORS = {
  navy: '#1A1A2E',
  red: '#C01820',
  gold: '#E8A020',
  orange: '#E8720A',
  blue: '#1A3A6B',
  pass: '#2F8F4E',
};

const lifeExpectancyLabel = (band: LifeExpectancyBand | null): string =>
  LIFE_EXPECTANCY_OPTIONS.find((o) => o.value === band)?.label ?? 'Not assessed';

const conditionLabel = (condition: HealthCondition | null): string =>
  condition ? condition.charAt(0).toUpperCase() + condition.slice(1) : 'Not assessed';

const conditionColor = (condition: HealthCondition | null): string => {
  switch (condition) {
    case 'good':
      return COLORS.pass;
    case 'fair':
      return COLORS.gold;
    case 'poor':
      return COLORS.orange;
    case 'critical':
      return COLORS.red;
    default:
      return '#1A1A2E80';
  }
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica', color: COLORS.navy },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: '#1A1A2E99', marginBottom: 16 },
  summaryBox: {
    border: `1pt solid ${COLORS.gold}60`,
    borderRadius: 8,
    padding: 14,
    marginBottom: 18,
    textAlign: 'center',
  },
  summaryLabel: { fontSize: 8, color: COLORS.gold, fontWeight: 700, marginBottom: 3, letterSpacing: 1 },
  summaryCount: { fontSize: 15, fontWeight: 700 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 6, marginBottom: 8 },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#1A1A2E10',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottom: '0.5pt solid #1A1A2E15',
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  cellCategory: { flex: 2, fontSize: 9 },
  cellNum: { flex: 1, textAlign: 'right', fontSize: 9 },
  cellHeader: { fontSize: 8, fontWeight: 700, color: '#1A1A2E99' },
  flaggedItem: { marginBottom: 10, padding: 10, border: `1pt solid ${COLORS.red}30`, borderRadius: 6 },
  flaggedItemTitle: { fontSize: 10, fontWeight: 700, marginBottom: 1 },
  flaggedCategoryLabel: { fontSize: 8, color: '#1A1A2E80', marginBottom: 6 },
  flaggedMeta: { fontSize: 9, fontWeight: 700, marginBottom: 2 },
  flaggedComment: { fontSize: 9, marginTop: 2 },
  photoRow: { flexDirection: 'row', marginTop: 5 },
  photo: { width: 70, height: 70, marginRight: 6, borderRadius: 4 },
  noFlags: { fontSize: 10, color: '#1A1A2E80', textAlign: 'center', marginTop: 8 },
  categoryHeading: { fontSize: 11, fontWeight: 700, marginTop: 14, marginBottom: 6 },
  detailItem: { marginBottom: 6, paddingBottom: 6, borderBottom: '0.5pt solid #1A1A2E10' },
  detailItemName: { fontSize: 9, fontWeight: 700 },
  detailItemMeta: { fontSize: 8, marginTop: 1 },
  detailItemComment: { fontSize: 8, marginTop: 2, color: '#1A1A2E90' },
  footer: {
    position: 'absolute',
    bottom: 18,
    left: 32,
    right: 32,
    fontSize: 8,
    color: '#1A1A2E70',
    textAlign: 'center',
  },
});

type PhotoBuffer = { path: string; data: Buffer; format: 'jpg' };

export function HealthReportDocument({
  data,
  photos,
}: {
  data: HealthReportData;
  photos: Map<string, PhotoBuffer>;
}) {
  const allItems = data.categories.flatMap((c) => c.items);
  const counts = {
    good: allItems.filter((it) => it.condition === 'good').length,
    fair: allItems.filter((it) => it.condition === 'fair').length,
    poor: allItems.filter((it) => it.condition === 'poor').length,
    critical: allItems.filter((it) => it.condition === 'critical').length,
  };

  const categoryStats = data.categories.map((c) => ({
    name: c.name,
    good: c.items.filter((it) => it.condition === 'good').length,
    fair: c.items.filter((it) => it.condition === 'fair').length,
    poor: c.items.filter((it) => it.condition === 'poor').length,
    critical: c.items.filter((it) => it.condition === 'critical').length,
  }));

  const flaggedItems = data.categories.flatMap((c) =>
    c.items
      .filter((it) => computeRequiresAttention(it.condition, it.lifeExpectancy))
      .map((it) => ({ categoryName: c.name, item: it }))
  );

  return (
    <Document>
      {/* Page 1 — condition summary, mirrors Stage 1's single-page pass/fail summary */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.siteName}</Text>
        <Text style={styles.subtitle}>
          State of Health Checklist — {data.year}
          {data.inspectorEmail ? ` · Inspector: ${data.inspectorEmail}` : ''}
        </Text>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>CONDITION SUMMARY</Text>
          <Text style={styles.summaryCount}>
            {counts.good} good · {counts.fair} fair · {counts.poor} poor · {counts.critical} critical
          </Text>
        </View>

        <Text style={styles.sectionTitle}>By Category</Text>
        <View>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.cellCategory, styles.cellHeader]}>Category</Text>
            <Text style={[styles.cellNum, styles.cellHeader]}>Good</Text>
            <Text style={[styles.cellNum, styles.cellHeader]}>Fair</Text>
            <Text style={[styles.cellNum, styles.cellHeader]}>Poor</Text>
            <Text style={[styles.cellNum, styles.cellHeader]}>Critical</Text>
          </View>
          {categoryStats.map((c) => (
            <View key={c.name} style={styles.tableRow}>
              <Text style={styles.cellCategory}>{c.name}</Text>
              <Text style={styles.cellNum}>{c.good || '—'}</Text>
              <Text style={styles.cellNum}>{c.fair || '—'}</Text>
              <Text style={styles.cellNum}>{c.poor || '—'}</Text>
              <Text style={styles.cellNum}>{c.critical || '—'}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>
          Flagged Items{' '}
          {flaggedItems.length > 0 ? `(${flaggedItems.length} item${flaggedItems.length !== 1 ? 's' : ''})` : ''}
        </Text>
        {flaggedItems.length === 0 && (
          <Text style={styles.noFlags}>Nothing rated Poor/Critical or 0–2 years remaining life.</Text>
        )}
        {flaggedItems.map(({ categoryName, item }) => (
          <View key={item.id} style={styles.flaggedItem} wrap={false}>
            <Text style={styles.flaggedItemTitle}>{item.name}</Text>
            <Text style={styles.flaggedCategoryLabel}>{categoryName}</Text>
            <Text style={[styles.flaggedMeta, { color: conditionColor(item.condition) }]}>
              {conditionLabel(item.condition)} · {lifeExpectancyLabel(item.lifeExpectancy)} remaining
            </Text>
            {item.comment && <Text style={styles.flaggedComment}>{item.comment}</Text>}
            {item.photoUrls.length > 0 && (
              <View style={styles.photoRow}>
                {item.photoUrls.map((path) => {
                  const buf = photos.get(path);
                  if (!buf) return null;
                  return <Image key={path} src={{ data: buf.data, format: buf.format }} style={styles.photo} />;
                })}
              </View>
            )}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          Generated by the RSLQLD Inspection App · {new Date().toLocaleString('en-AU')}
        </Text>
      </Page>

      {/* Page 2+ — full category-by-category detail, every item regardless of flag status */}
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.siteName}</Text>
        <Text style={styles.subtitle}>Full Category Detail — {data.year}</Text>

        {data.categories.map((c) => (
          <View key={c.id} wrap={false}>
            <Text style={styles.categoryHeading}>{c.name}</Text>
            {c.items.map((item) => (
              <View key={item.id} style={styles.detailItem}>
                <Text style={styles.detailItemName}>{item.name}</Text>
                <Text style={[styles.detailItemMeta, { color: conditionColor(item.condition) }]}>
                  {conditionLabel(item.condition)} · {lifeExpectancyLabel(item.lifeExpectancy)} remaining
                </Text>
                {item.comment && <Text style={styles.detailItemComment}>{item.comment}</Text>}
              </View>
            ))}
          </View>
        ))}

        <Text style={styles.footer} fixed>
          Generated by the RSLQLD Inspection App · {new Date().toLocaleString('en-AU')}
        </Text>
      </Page>
    </Document>
  );
}

// ============================================================
// Render helper — identical photo-fetch-first pattern to
// lib/report.tsx's renderReportPdf, same reasoning: a broken/slow
// photo fails predictably rather than silently blanking the report.
// ============================================================

export async function renderHealthReportPdf(data: HealthReportData): Promise<Buffer> {
  const supabase = supabaseServer();
  const allPaths = data.categories.flatMap((c) => c.items.flatMap((it) => it.photoUrls));

  const photos = new Map<string, PhotoBuffer>();
  await Promise.all(
    allPaths.map(async (path) => {
      try {
        const { data: publicUrlData } = supabase.storage.from('inspection-photos').getPublicUrl(path);
        const res = await fetch(publicUrlData.publicUrl);
        if (!res.ok) return;
        const arrayBuffer = await res.arrayBuffer();
        photos.set(path, { path, data: Buffer.from(arrayBuffer), format: 'jpg' });
      } catch {
        // Skip this photo — the report still generates, just without that image.
      }
    })
  );

  return renderToBuffer(<HealthReportDocument data={data} photos={photos} />);
}
