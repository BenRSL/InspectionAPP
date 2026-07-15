import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer';
import { supabaseServer } from './supabase-server';

// ============================================================
// Data fetching
// ============================================================

export type ReportItem = {
  id: string;
  name: string;
  category: 'cleaning' | 'maintenance';
  result: 'pass' | 'fail' | null;
  comment: string | null;
  photoUrls: string[]; // storage paths in the inspection-photos bucket
};

export type ReportArea = {
  id: string;
  name: string;
  items: ReportItem[];
};

export type ReportFloor = {
  name: string;
  areas: ReportArea[];
};

export type ReportData = {
  siteName: string;
  inspectorEmail: string | null;
  periodMonth: string;
  status: string;
  completedAt: string | null;
  floors: ReportFloor[];
};

export async function buildReportData(inspectionId: string): Promise<ReportData | null> {
  const supabase = supabaseServer();

  const { data: inspection, error: inspErr } = await supabase
    .from('inspections')
    .select('id, site_id, inspector_id, period_month, status, completed_at')
    .eq('id', inspectionId)
    .single();

  if (inspErr || !inspection) return null;

  const [siteRes, inspectorRes, areasRes, savedItemsRes] = await Promise.all([
    supabase.from('sites').select('name').eq('id', inspection.site_id).single(),
    inspection.inspector_id
      ? supabase.from('users').select('email').eq('id', inspection.inspector_id).maybeSingle()
      : Promise.resolve({ data: null as { email: string } | null }),
    supabase
      .from('floor_areas')
      .select('id, floor_name, area_name, sort_order')
      .eq('site_id', inspection.site_id)
      .order('sort_order'),
    supabase
      .from('inspection_items')
      .select('checklist_item_id, result, comment, photo_urls')
      .eq('inspection_id', inspectionId),
  ]);

  const areas = areasRes.data ?? [];
  const areaIds = areas.map((a) => a.id);

  const { data: checklistItems } = await supabase
    .from('checklist_items')
    .select('id, area_id, item_name, category')
    .in('area_id', areaIds.length > 0 ? areaIds : ['00000000-0000-0000-0000-000000000000']);

  const savedByChecklistId = new Map((savedItemsRes.data ?? []).map((it) => [it.checklist_item_id, it]));

  const floorMap = new Map<string, ReportFloor>();
  for (const area of areas) {
    if (!floorMap.has(area.floor_name)) {
      floorMap.set(area.floor_name, { name: area.floor_name, areas: [] });
    }
    const areaItems: ReportItem[] = (checklistItems ?? [])
      .filter((ci) => ci.area_id === area.id)
      .map((ci) => {
        const saved = savedByChecklistId.get(ci.id);
        return {
          id: ci.id,
          name: ci.item_name,
          category: ci.category as 'cleaning' | 'maintenance',
          result: (saved?.result as 'pass' | 'fail' | undefined) ?? null,
          comment: saved?.comment ?? null,
          photoUrls: saved?.photo_urls ?? [],
        };
      });
    floorMap.get(area.floor_name)!.areas.push({ id: area.id, name: area.area_name, items: areaItems });
  }

  return {
    siteName: siteRes.data?.name ?? 'Unknown site',
    inspectorEmail: inspectorRes.data?.email ?? null,
    periodMonth: inspection.period_month,
    status: inspection.status,
    completedAt: inspection.completed_at,
    floors: Array.from(floorMap.values()),
  };
}

// ============================================================
// PDF document
// ============================================================

const COLORS = {
  navy: '#1A1A2E',
  red: '#C01820',
  gold: '#E8A020',
  blue: '#1A3A6B',
  pass: '#2F8F4E',
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica', color: COLORS.navy },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 10, color: '#1A1A2E99', marginBottom: 16 },
  summaryBox: {
    border: `1pt solid ${COLORS.pass}60`,
    borderRadius: 8,
    padding: 14,
    marginBottom: 18,
    textAlign: 'center',
  },
  summaryLabel: { fontSize: 8, color: COLORS.pass, fontWeight: 700, marginBottom: 3, letterSpacing: 1 },
  summaryCount: { fontSize: 18, fontWeight: 700 },
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
  cellFloor: { flex: 2, fontSize: 9 },
  cellNum: { flex: 1, textAlign: 'right', fontSize: 9 },
  cellHeader: { fontSize: 8, fontWeight: 700, color: '#1A1A2E99' },
  failArea: { marginBottom: 10, padding: 10, border: `1pt solid ${COLORS.red}30`, borderRadius: 6 },
  failAreaTitle: { fontSize: 10, fontWeight: 700, marginBottom: 1 },
  failFloorLabel: { fontSize: 8, color: '#1A1A2E80', marginBottom: 6 },
  failItem: { marginBottom: 6 },
  failItemLabel: { fontSize: 9, fontWeight: 700, color: COLORS.red },
  failItemComment: { fontSize: 9, marginTop: 2 },
  photoRow: { flexDirection: 'row', marginTop: 5 },
  photo: { width: 70, height: 70, marginRight: 6, borderRadius: 4 },
  noFails: { fontSize: 10, color: '#1A1A2E80', textAlign: 'center', marginTop: 8 },
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

function formatPeriod(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

export function ReportDocument({ data, photos }: { data: ReportData; photos: Map<string, PhotoBuffer> }) {
  const allItems = data.floors.flatMap((f) => f.areas.flatMap((a) => a.items));
  const totalPass = allItems.filter((it) => it.result === 'pass').length;
  const totalFail = allItems.filter((it) => it.result === 'fail').length;

  const floorStats = data.floors.map((f) => {
    const items = f.areas.flatMap((a) => a.items);
    return {
      name: f.name,
      pass: items.filter((it) => it.result === 'pass').length,
      fail: items.filter((it) => it.result === 'fail').length,
    };
  });

  const failedAreas = data.floors.flatMap((f) =>
    f.areas
      .filter((a) => a.items.some((it) => it.result === 'fail'))
      .map((a) => ({ floorName: f.name, area: a }))
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.siteName}</Text>
        <Text style={styles.subtitle}>
          Monthly Inspection — {formatPeriod(data.periodMonth)}
          {data.inspectorEmail ? ` · Inspector: ${data.inspectorEmail}` : ''}
        </Text>

        <View style={styles.summaryBox}>
          <Text style={styles.summaryLabel}>INSPECTION SUMMARY</Text>
          <Text style={styles.summaryCount}>
            {totalPass} passed · {totalFail} failed
          </Text>
        </View>

        <Text style={styles.sectionTitle}>By Floor</Text>
        <View>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.cellFloor, styles.cellHeader]}>Floor</Text>
            <Text style={[styles.cellNum, styles.cellHeader]}>Pass</Text>
            <Text style={[styles.cellNum, styles.cellHeader]}>Fail</Text>
          </View>
          {floorStats.map((f) => (
            <View key={f.name} style={styles.tableRow}>
              <Text style={styles.cellFloor}>{f.name}</Text>
              <Text style={styles.cellNum}>{f.pass}</Text>
              <Text style={styles.cellNum}>{f.fail || '—'}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>
          Fail Details {failedAreas.length > 0 ? `(${failedAreas.length} area${failedAreas.length !== 1 ? 's' : ''})` : ''}
        </Text>
        {failedAreas.length === 0 && <Text style={styles.noFails}>No fails logged for this inspection.</Text>}
        {failedAreas.map(({ floorName, area }) => (
          <View key={area.id} style={styles.failArea} wrap={false}>
            <Text style={styles.failAreaTitle}>{area.name}</Text>
            <Text style={styles.failFloorLabel}>{floorName}</Text>
            {area.items
              .filter((it) => it.result === 'fail')
              .map((it) => (
                <View key={it.id} style={styles.failItem}>
                  <Text style={styles.failItemLabel}>
                    {it.category === 'cleaning' ? 'Cleaning' : 'Maintenance'} · {it.name}
                  </Text>
                  {it.comment && <Text style={styles.failItemComment}>{it.comment}</Text>}
                  {it.photoUrls.length > 0 && (
                    <View style={styles.photoRow}>
                      {it.photoUrls.map((path) => {
                        const buf = photos.get(path);
                        if (!buf) return null;
                        return (
                          <Image
                            key={path}
                            src={{ data: buf.data, format: buf.format }}
                            style={styles.photo}
                          />
                        );
                      })}
                    </View>
                  )}
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
// Render helper — fetches photo bytes itself (rather than letting
// react-pdf fetch remote URLs internally) so a broken/slow photo
// fails predictably and doesn't silently blank the whole report.
// ============================================================

export async function renderReportPdf(data: ReportData): Promise<Buffer> {
  const supabase = supabaseServer();
  const allPaths = data.floors.flatMap((f) => f.areas.flatMap((a) => a.items.flatMap((it) => it.photoUrls)));

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

  return renderToBuffer(<ReportDocument data={data} photos={photos} />);
}
