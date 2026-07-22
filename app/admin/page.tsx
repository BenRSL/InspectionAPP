'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import InsightsTab from '@/components/InsightsTab';
import ChipBankTab from '@/components/ChipBankTab';

type Tab = 'sites' | 'areas' | 'users' | 'insights' | 'chips' | 'tutorial';

type SiteRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  monthly_onboarding_inspections_remaining: number;
  sohc_onboarding_inspections_remaining: number;
};

type FloorAreaRow = {
  id: string;
  site_id: string;
  floor_name: string;
  area_name: string;
  sort_order: number;
};

type UserRole = 'inspector' | 'admin' | 'god_mode';

type UserRow = {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
};

type AccessRow = { user_id: string; site_id: string };

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function roleLabel(role: UserRole): string {
  if (role === 'god_mode') return 'God Mode';
  if (role === 'admin') return 'Admin';
  return 'Inspector';
}

export default function AdminPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [tab, setTab] = useState<Tab>('sites');

  const [sites, setSites] = useState<SiteRow[]>([]);
  const [areas, setAreas] = useState<FloorAreaRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [access, setAccess] = useState<AccessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedSite, setExpandedSite] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);

    const [sitesRes, areasRes, usersRes, accessRes] = await Promise.all([
      supabase
        .from('sites')
        .select(
          'id, name, slug, status, monthly_onboarding_inspections_remaining, sohc_onboarding_inspections_remaining'
        )
        .order('name'),
      supabase
        .from('floor_areas')
        .select('id, site_id, floor_name, area_name, sort_order')
        .order('sort_order'),
      supabase.from('users').select('id, email, role, created_at').order('email'),
      supabase.from('user_site_access').select('user_id, site_id'),
    ]);

    const firstError =
      sitesRes.error || areasRes.error || usersRes.error || accessRes.error;

    if (firstError) {
      setLoadError(firstError.message);
    } else {
      setSites(sitesRes.data ?? []);
      setAreas(areasRes.data ?? []);
      setUsers(usersRes.data ?? []);
      setAccess(accessRes.data ?? []);
      setExpandedSite((prev) => prev ?? sitesRes.data?.[0]?.id ?? null);
    }

    setLoading(false);
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="flex-1 bg-white">
      <header className="bg-rsl-navy text-white px-6 py-6 sm:px-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <Link href="/" className="text-xs text-white/60 hover:text-white">
              ← Back to app
            </Link>
            <h1 className="font-display font-bold text-xl mt-0.5">Admin Dashboard</h1>
          </div>
          <span className="text-xs font-semibold text-rsl-gold border border-rsl-gold/40 rounded-full px-3 py-1.5">
            God Mode
          </span>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 sm:px-10">
        {/* Tabs */}
        <nav className="flex gap-1 border-b border-rsl-navy/10 mt-6 -mb-px overflow-x-auto">
          {(
            [
              ['sites', 'Sites'],
              ['areas', 'Areas & Checklist Items'],
              ['users', 'Users'],
              ['insights', 'Insights'],
              ['chips', 'Chip Bank'],
              ['tutorial', 'Tutorial'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`shrink-0 text-sm font-semibold px-4 py-3 border-b-2 transition-colors ${
                tab === id
                  ? 'border-rsl-red text-rsl-red'
                  : 'border-transparent text-rsl-navy/50 hover:text-rsl-navy'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="py-8">
          {loading && <p className="text-sm text-rsl-navy/50">Loading admin data…</p>}

          {!loading && loadError && (
            <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-4 text-sm text-rsl-red mb-6">
              Couldn't load admin data: {loadError}
            </div>
          )}

          {!loading && !loadError && (
            <>
              {tab === 'sites' && (
                <SitesTab sites={sites} areas={areas} supabase={supabase} onChanged={loadAll} />
              )}
              {tab === 'areas' && (
                <AreasTab
                  sites={sites}
                  areas={areas}
                  supabase={supabase}
                  onChanged={loadAll}
                  expandedSite={expandedSite}
                  setExpandedSite={setExpandedSite}
                />
              )}
              {tab === 'users' && (
                <UsersTab
                  users={users}
                  access={access}
                  sites={sites}
                  supabase={supabase}
                  onChanged={loadAll}
                />
              )}
              {tab === 'insights' && <InsightsTab />}
              {tab === 'chips' && <ChipBankTab />}
              {tab === 'tutorial' && <TutorialTab />}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

// ============================================================
// SITES TAB
// ============================================================
function SitesTab({
  sites,
  areas,
  supabase,
  onChanged,
}: {
  sites: SiteRow[];
  areas: FloorAreaRow[];
  supabase: ReturnType<typeof supabaseBrowser>;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function countsFor(siteId: string) {
    const filtered = areas.filter((a) => a.site_id === siteId);
    const floors = new Set(filtered.map((a) => a.floor_name));
    return { floors: floors.size, areasCount: filtered.length };
  }

  async function addSite() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from('sites')
      .insert({ name: newName.trim(), slug: (newSlug || slugify(newName)).trim() });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAdding(false);
    setNewName('');
    setNewSlug('');
    setSlugTouched(false);
    await onChanged();
  }

  async function saveEdit(id: string) {
    if (!editName.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase
      .from('sites')
      .update({ name: editName.trim(), slug: editSlug.trim() || null })
      .eq('id', id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setEditingId(null);
    await onChanged();
  }

  async function deleteSite(site: SiteRow) {
    const { floors, areasCount } = countsFor(site.id);
    const warning =
      floors > 0
        ? `${site.name} has ${floors} floor(s) and ${areasCount} area(s). Deleting it may also remove that floor/area data and any inspections tied to it. Continue?`
        : `Delete ${site.name}? This can't be undone.`;
    if (!window.confirm(warning)) return;

    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('sites').delete().eq('id', site.id);
    setBusy(false);
    if (err) {
      setError(
        `Couldn't delete ${site.name}: ${err.message}. It likely still has floor areas, checklist items, or inspections referencing it — remove those first via the Areas tab.`
      );
      return;
    }
    await onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display font-bold text-rsl-navy">Sites</h2>
          <p className="text-sm text-rsl-navy/50">
            Only God Mode can add, rename, or remove sites.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-sm font-semibold text-white bg-rsl-red rounded-lg px-4 py-2.5 whitespace-nowrap"
        >
          {adding ? 'Cancel' : '+ Add site'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red mb-4">
          {error}
        </div>
      )}

      {adding && (
        <div className="border border-rsl-navy/10 rounded-xl p-4 mb-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-rsl-navy/50 block mb-1">Site name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                if (!slugTouched) setNewSlug(slugify(e.target.value));
              }}
              placeholder="e.g. Bundaberg"
              className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 focus:border-rsl-red outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-rsl-navy/50 block mb-1">
              Slug (used in the URL — auto-filled, editable)
            </label>
            <input
              type="text"
              value={newSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setNewSlug(e.target.value);
              }}
              placeholder="e.g. bundaberg"
              className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 focus:border-rsl-red outline-none"
            />
          </div>
          <button
            onClick={addSite}
            disabled={busy || !newName.trim()}
            className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 py-2 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save site'}
          </button>
        </div>
      )}

      <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
            <tr>
              <th className="font-semibold px-4 py-3">Site name</th>
              <th className="font-semibold px-4 py-3">Slug</th>
              <th className="font-semibold px-4 py-3">Zones / Areas</th>
              <th className="font-semibold px-4 py-3">Status</th>
              <th className="font-semibold px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => {
              const { floors, areasCount } = countsFor(site.id);
              const isEditing = editingId === site.id;
              return (
                <tr key={site.id} className="border-t border-rsl-navy/5">
                  {isEditing ? (
                    <>
                      <td className="px-4 py-3">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full text-sm rounded-lg border border-rsl-navy/15 px-2 py-1.5"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          value={editSlug}
                          onChange={(e) => setEditSlug(e.target.value)}
                          className="w-full text-sm rounded-lg border border-rsl-navy/15 px-2 py-1.5"
                        />
                      </td>
                      <td className="px-4 py-3 text-rsl-navy/60">
                        {floors > 0 ? `${floors} floors, ${areasCount} areas` : 'Needs setup'}
                      </td>
                      <td className="px-4 py-3 text-rsl-navy/60">{site.status}</td>
                      <td className="px-4 py-3 text-right space-x-3">
                        <button
                          onClick={() => saveEdit(site.id)}
                          disabled={busy}
                          className="text-pass font-semibold hover:underline disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-rsl-navy/50 font-semibold hover:underline"
                        >
                          Cancel
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-3 font-medium text-rsl-navy">{site.name}</td>
                      <td className="px-4 py-3 text-rsl-navy/60">{site.slug ?? '—'}</td>
                      <td className="px-4 py-3 text-rsl-navy/60">
                        {floors > 0 ? (
                          `${floors} floors, ${areasCount} areas`
                        ) : (
                          <span className="text-rsl-gold font-medium">Needs setup</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-rsl-navy/60">{site.status}</td>
                      <td className="px-4 py-3 text-right space-x-3">
                        <button
                          onClick={() => {
                            setEditingId(site.id);
                            setEditName(site.name);
                            setEditSlug(site.slug ?? '');
                          }}
                          className="text-rsl-blue font-semibold hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteSite(site)}
                          disabled={busy}
                          className="text-rsl-red font-semibold hover:underline disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-rsl-navy/40 mt-3">
        New sites start with no floors or areas — add those from the "Areas & Checklist Items" tab.
      </p>
    </div>
  );
}

// ============================================================
// AREAS TAB
// ============================================================
function AreasTab({
  sites,
  areas,
  supabase,
  onChanged,
  expandedSite,
  setExpandedSite,
}: {
  sites: SiteRow[];
  areas: FloorAreaRow[];
  supabase: ReturnType<typeof supabaseBrowser>;
  onChanged: () => Promise<void>;
  expandedSite: string | null;
  setExpandedSite: (id: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [addAreaFor, setAddAreaFor] = useState<{ siteId: string; floorName: string } | null>(null);
  const [newAreaName, setNewAreaName] = useState('');

  const [addFloorFor, setAddFloorFor] = useState<string | null>(null);
  const [newFloorName, setNewFloorName] = useState('');
  const [newFloorAreaName, setNewFloorAreaName] = useState('');

  function nextSortOrder(siteId: string) {
    const filtered = areas.filter((a) => a.site_id === siteId);
    if (filtered.length === 0) return 0;
    return Math.max(...filtered.map((a) => a.sort_order)) + 1;
  }

  async function addArea(siteId: string, floorName: string) {
    if (!newAreaName.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('floor_areas').insert({
      site_id: siteId,
      floor_name: floorName,
      area_name: newAreaName.trim(),
      sort_order: nextSortOrder(siteId),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAddAreaFor(null);
    setNewAreaName('');
    await onChanged();
  }

  async function addFloor(siteId: string) {
    if (!newFloorName.trim() || !newFloorAreaName.trim()) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('floor_areas').insert({
      site_id: siteId,
      floor_name: newFloorName.trim(),
      area_name: newFloorAreaName.trim(),
      sort_order: nextSortOrder(siteId),
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setAddFloorFor(null);
    setNewFloorName('');
    setNewFloorAreaName('');
    await onChanged();
  }

  async function deleteArea(area: FloorAreaRow) {
    if (!window.confirm(`Remove "${area.area_name}"? This also removes its checklist items and can't be undone.`))
      return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('floor_areas').delete().eq('id', area.id);
    setBusy(false);
    if (err) {
      setError(
        `Couldn't remove "${area.area_name}": ${err.message}. It may have checklist items or saved inspection answers referencing it.`
      );
      return;
    }
    await onChanged();
  }

  return (
    <div>
      <h2 className="font-display font-bold text-rsl-navy mb-1">Areas & Checklist Items</h2>
      <p className="text-sm text-rsl-navy/50 mb-4">
        Admins can add or remove floor areas for their assigned sites.
      </p>

      {error && (
        <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red mb-4">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {sites.map((site) => {
          const isOpen = expandedSite === site.id;
          const siteAreas = areas.filter((a) => a.site_id === site.id);

          const floorMap = new Map<string, FloorAreaRow[]>();
          for (const a of siteAreas) {
            if (!floorMap.has(a.floor_name)) floorMap.set(a.floor_name, []);
            floorMap.get(a.floor_name)!.push(a);
          }

          return (
            <div key={site.id} className="border border-rsl-navy/10 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedSite(isOpen ? null : site.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-rsl-navy/[0.02]"
              >
                <span className="font-semibold text-rsl-navy text-sm">{site.name}</span>
                <span className="text-rsl-navy/40 text-xs">
                  {siteAreas.length > 0 ? `${siteAreas.length} areas` : 'Not set up'}
                  <span className="ml-2">{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-rsl-navy/5">
                  {floorMap.size === 0 ? (
                    <div className="py-4">
                      <p className="text-sm text-rsl-navy/40 mb-3">No floors added yet.</p>
                      {addFloorFor === site.id ? (
                        <div className="space-y-2 max-w-sm">
                          <input
                            value={newFloorName}
                            onChange={(e) => setNewFloorName(e.target.value)}
                            placeholder="Floor name, e.g. GF – Ground Floor"
                            className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
                          />
                          <input
                            value={newFloorAreaName}
                            onChange={(e) => setNewFloorAreaName(e.target.value)}
                            placeholder="First area, e.g. Reception"
                            className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={() => addFloor(site.id)}
                              disabled={busy}
                              className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 py-2 disabled:opacity-40"
                            >
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setAddFloorFor(null)}
                              className="text-sm font-semibold text-rsl-navy/50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddFloorFor(site.id)}
                          className="text-rsl-red font-semibold hover:underline text-sm"
                        >
                          + Add first floor
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 pt-3">
                      {Array.from(floorMap.entries()).map(([floorName, floorAreas]) => (
                        <div key={floorName}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wide text-rsl-navy/40">
                              {floorName}
                            </span>
                            <button
                              onClick={() => setAddAreaFor({ siteId: site.id, floorName })}
                              className="text-xs text-rsl-blue font-semibold hover:underline"
                            >
                              + Add area
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {floorAreas.map((area) => (
                              <span
                                key={area.id}
                                className="text-xs bg-rsl-navy/5 text-rsl-navy/70 rounded-full px-3 py-1 flex items-center gap-1.5"
                              >
                                {area.area_name}
                                <button
                                  onClick={() => deleteArea(area)}
                                  disabled={busy}
                                  className="text-rsl-navy/30 hover:text-rsl-red disabled:opacity-40"
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                          {addAreaFor?.siteId === site.id && addAreaFor.floorName === floorName && (
                            <div className="flex gap-2 mt-2">
                              <input
                                value={newAreaName}
                                onChange={(e) => setNewAreaName(e.target.value)}
                                placeholder="Area name"
                                className="text-sm rounded-lg border border-rsl-navy/15 px-3 py-1.5 flex-1"
                              />
                              <button
                                onClick={() => addArea(site.id, floorName)}
                                disabled={busy}
                                className="text-xs font-semibold text-white bg-rsl-navy rounded-lg px-3 disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setAddAreaFor(null)}
                                className="text-xs font-semibold text-rsl-navy/50"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      ))}

                      {addFloorFor === site.id ? (
                        <div className="space-y-2 max-w-sm pt-2 border-t border-rsl-navy/5">
                          <input
                            value={newFloorName}
                            onChange={(e) => setNewFloorName(e.target.value)}
                            placeholder="New floor name"
                            className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
                          />
                          <input
                            value={newFloorAreaName}
                            onChange={(e) => setNewFloorAreaName(e.target.value)}
                            placeholder="First area on this floor"
                            className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
                          />
                          <div className="flex gap-3">
                            <button
                              onClick={() => addFloor(site.id)}
                              disabled={busy}
                              className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 py-2 disabled:opacity-40"
                            >
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                            <button
                              onClick={() => setAddFloorFor(null)}
                              className="text-sm font-semibold text-rsl-navy/50"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddFloorFor(site.id)}
                          className="text-xs text-rsl-red font-semibold hover:underline"
                        >
                          + Add another floor
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// USERS TAB
// ============================================================
function UsersTab({
  users,
  access,
  sites,
  supabase,
  onChanged,
}: {
  users: UserRow[];
  access: AccessRow[];
  sites: SiteRow[];
  supabase: ReturnType<typeof supabaseBrowser>;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('inspector');
  const [newSiteIds, setNewSiteIds] = useState<string[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<UserRole>('inspector');
  const [editSiteIds, setEditSiteIds] = useState<string[]>([]);

  function sitesFor(userId: string): string {
    const ids = access.filter((a) => a.user_id === userId).map((a) => a.site_id);
    if (ids.length === 0) return 'No sites';
    if (ids.length === sites.length) return 'All sites';
    const names = sites.filter((s) => ids.includes(s.id)).map((s) => s.name);
    return names.join(', ');
  }

  function toggleSite(list: string[], setList: (v: string[]) => void, siteId: string) {
    setList(list.includes(siteId) ? list.filter((id) => id !== siteId) : [...list, siteId]);
  }

  async function addUser() {
    if (!newEmail.trim()) return;
    setBusy(true);
    setError(null);

    const id = crypto.randomUUID();
    const { error: userErr } = await supabase
      .from('users')
      .insert({ id, email: newEmail.trim(), role: newRole });

    if (userErr) {
      setBusy(false);
      setError(
        `Couldn't create ${newEmail}: ${userErr.message}. If this mentions a foreign key to auth.users, this account needs a real Supabase Auth sign-up first.`
      );
      return;
    }

    if (newSiteIds.length > 0) {
      const rows = newSiteIds.map((siteId) => ({ user_id: id, site_id: siteId }));
      const { error: accessErr } = await supabase.from('user_site_access').insert(rows);
      if (accessErr) {
        setBusy(false);
        setError(`User created, but couldn't save site access: ${accessErr.message}`);
        await onChanged();
        return;
      }
    }

    setBusy(false);
    setAdding(false);
    setNewEmail('');
    setNewRole('inspector');
    setNewSiteIds([]);
    await onChanged();
  }

  async function saveEdit(user: UserRow) {
    setBusy(true);
    setError(null);

    const { error: roleErr } = await supabase
      .from('users')
      .update({ role: editRole })
      .eq('id', user.id);

    if (roleErr) {
      setBusy(false);
      setError(`Couldn't update role: ${roleErr.message}`);
      return;
    }

    const { error: delErr } = await supabase.from('user_site_access').delete().eq('user_id', user.id);
    if (delErr) {
      setBusy(false);
      setError(`Couldn't update site access: ${delErr.message}`);
      return;
    }

    if (editSiteIds.length > 0) {
      const rows = editSiteIds.map((siteId) => ({ user_id: user.id, site_id: siteId }));
      const { error: insErr } = await supabase.from('user_site_access').insert(rows);
      if (insErr) {
        setBusy(false);
        setError(`Couldn't update site access: ${insErr.message}`);
        return;
      }
    }

    setBusy(false);
    setEditingId(null);
    await onChanged();
  }

  async function removeUser(user: UserRow) {
    if (!window.confirm(`Remove ${user.email}? This can't be undone.`)) return;
    setBusy(true);
    setError(null);

    await supabase.from('user_site_access').delete().eq('user_id', user.id);
    const { error: err } = await supabase.from('users').delete().eq('id', user.id);

    setBusy(false);
    if (err) {
      setError(`Couldn't remove ${user.email}: ${err.message}`);
      return;
    }
    await onChanged();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display font-bold text-rsl-navy">Users</h2>
          <p className="text-sm text-rsl-navy/50">
            God Mode manages all users, roles, and per-site access.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-sm font-semibold text-white bg-rsl-red rounded-lg px-4 py-2.5 whitespace-nowrap"
        >
          {adding ? 'Cancel' : '+ Add user'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl bg-rsl-red/5 border border-rsl-red/20 p-3 text-sm text-rsl-red mb-4">
          {error}
        </div>
      )}

      {adding && (
        <div className="border border-rsl-navy/10 rounded-xl p-4 mb-4 space-y-3">
          <div>
            <label className="text-xs font-semibold text-rsl-navy/50 block mb-1">Email</label>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@rslqld.org"
              className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2 focus:border-rsl-red outline-none"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-rsl-navy/50 block mb-1">Role</label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="w-full text-sm rounded-lg border border-rsl-navy/15 px-3 py-2"
            >
              <option value="inspector">Inspector</option>
              <option value="admin">Admin</option>
              <option value="god_mode">God Mode</option>
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-rsl-navy/50">Site access</label>
              <button
                onClick={() =>
                  setNewSiteIds(newSiteIds.length === sites.length ? [] : sites.map((s) => s.id))
                }
                className="text-xs text-rsl-blue font-semibold hover:underline"
              >
                {newSiteIds.length === sites.length ? 'Clear all' : 'Select all sites'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {sites.map((s) => (
                <label key={s.id} className="flex items-center gap-1.5 text-xs text-rsl-navy/70">
                  <input
                    type="checkbox"
                    checked={newSiteIds.includes(s.id)}
                    onChange={() => toggleSite(newSiteIds, setNewSiteIds, s.id)}
                  />
                  {s.name}
                </label>
              ))}
            </div>
          </div>
          <p className="text-xs text-rsl-navy/40">
            Creates a placeholder record. The account can't sign in until a matching Supabase Auth
            user exists for this email.
          </p>
          <button
            onClick={addUser}
            disabled={busy || !newEmail.trim()}
            className="text-sm font-semibold text-white bg-rsl-navy rounded-lg px-4 py-2 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save user'}
          </button>
        </div>
      )}

      <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
            <tr>
              <th className="font-semibold px-4 py-3">Email</th>
              <th className="font-semibold px-4 py-3">Role</th>
              <th className="font-semibold px-4 py-3">Site access</th>
              <th className="font-semibold px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isEditing = editingId === u.id;
              return (
                <tr key={u.id} className="border-t border-rsl-navy/5 align-top">
                  <td className="px-4 py-3 font-medium text-rsl-navy">{u.email}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <select
                        value={editRole}
                        onChange={(e) => setEditRole(e.target.value as UserRole)}
                        className="text-xs rounded-lg border border-rsl-navy/15 px-2 py-1"
                      >
                        <option value="inspector">Inspector</option>
                        <option value="admin">Admin</option>
                        <option value="god_mode">God Mode</option>
                      </select>
                    ) : (
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                          u.role === 'god_mode'
                            ? 'bg-rsl-gold/20 text-rsl-gold'
                            : u.role === 'admin'
                            ? 'bg-rsl-blue/10 text-rsl-blue'
                            : 'bg-rsl-navy/5 text-rsl-navy/60'
                        }`}
                      >
                        {roleLabel(u.role)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-rsl-navy/60">
                    {isEditing ? (
                      <div className="grid grid-cols-2 gap-1">
                        {sites.map((s) => (
                          <label key={s.id} className="flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              checked={editSiteIds.includes(s.id)}
                              onChange={() => toggleSite(editSiteIds, setEditSiteIds, s.id)}
                            />
                            {s.name}
                          </label>
                        ))}
                      </div>
                    ) : (
                      sitesFor(u.id)
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => saveEdit(u)}
                          disabled={busy}
                          className="text-pass font-semibold hover:underline disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-rsl-navy/50 font-semibold hover:underline"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(u.id);
                            setEditRole(u.role);
                            setEditSiteIds(access.filter((a) => a.user_id === u.id).map((a) => a.site_id));
                          }}
                          className="text-rsl-blue font-semibold hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeUser(u)}
                          disabled={busy}
                          className="text-rsl-red font-semibold hover:underline disabled:opacity-40"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl bg-rsl-navy/[0.03] p-4 text-xs text-rsl-navy/50">
        <strong className="text-rsl-navy/70">Permission reminder:</strong> God Mode can add/remove
        sites, manage all users, and view the full audit log. Admins can edit checklist items on
        their assigned sites and invite inspectors only. Inspectors can complete and submit
        inspections but can't edit site structure.
      </div>
    </div>
  );
}

function TutorialTab() {
  return (
    <div>
      <h2 className="font-display font-bold text-rsl-navy mb-1">Tutorial System</h2>
      <p className="text-sm text-rsl-navy/50 mb-6">
        Role-aware walkthroughs for Inspector, Admin, and God Mode. Editable here — no code required.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {['Inspector', 'Admin', 'God Mode'].map((role) => (
          <div key={role} className="border border-rsl-navy/10 rounded-xl p-4">
            <div className="font-semibold text-rsl-navy text-sm mb-1">{role} Guide</div>
            <p className="text-xs text-rsl-navy/50 mb-3">Step-by-step walkthrough for this role.</p>
            <div className="flex gap-2">
              <button className="text-xs font-semibold text-rsl-blue hover:underline">Edit</button>
              <button className="text-xs font-semibold text-rsl-blue hover:underline">Download PDF</button>
              <button className="text-xs font-semibold text-rsl-blue hover:underline">Email</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
