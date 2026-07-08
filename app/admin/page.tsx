'use client';

import Link from 'next/link';
import { useState } from 'react';
import { allSites, anzacHouse } from '@/lib/sites';

type Tab = 'sites' | 'areas' | 'users' | 'tutorial';

// Mock — replace with Supabase query against `users` table once connected
const mockUsers = [
  { email: 'ben.carey@rslqld.org', role: 'god', sites: 'All sites' },
  { email: 'assets@rslqld.org', role: 'admin', sites: 'All sites' },
  { email: 'matt.sparnon@rslqld.org', role: 'admin', sites: 'All sites' },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('sites');
  const [expandedSite, setExpandedSite] = useState<string | null>('anzac-house');

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
          {([
            ['sites', 'Sites'],
            ['areas', 'Areas & Checklist Items'],
            ['users', 'Users'],
            ['tutorial', 'Tutorial'],
          ] as [Tab, string][]).map(([id, label]) => (
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
          {tab === 'sites' && <SitesTab />}
          {tab === 'areas' && (
            <AreasTab expandedSite={expandedSite} setExpandedSite={setExpandedSite} />
          )}
          {tab === 'users' && <UsersTab />}
          {tab === 'tutorial' && <TutorialTab />}
        </div>
      </div>
    </main>
  );
}

function SitesTab() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display font-bold text-rsl-navy">Sites</h2>
          <p className="text-sm text-rsl-navy/50">
            Only God Mode can add, rename, or remove sites.
          </p>
        </div>
        <button className="text-sm font-semibold text-white bg-rsl-red rounded-lg px-4 py-2.5 whitespace-nowrap">
          + Add site
        </button>
      </div>

      <div className="border border-rsl-navy/10 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-rsl-navy/5 text-rsl-navy/50 text-left">
            <tr>
              <th className="font-semibold px-4 py-3">Location</th>
              <th className="font-semibold px-4 py-3">Site name</th>
              <th className="font-semibold px-4 py-3">Zones / Areas</th>
              <th className="font-semibold px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {allSites.map((site) => (
              <tr key={site.id} className="border-t border-rsl-navy/5">
                <td className="px-4 py-3 text-rsl-navy/60">{site.displayLabel}</td>
                <td className="px-4 py-3 font-medium text-rsl-navy">{site.name}</td>
                <td className="px-4 py-3 text-rsl-navy/60">
                  {site.floors.length > 0 ? (
                    `${site.floors.length} floors, ${site.floors.flatMap((f) => f.areas).length} areas`
                  ) : (
                    <span className="text-rsl-gold font-medium">Needs setup</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button className="text-rsl-blue font-semibold hover:underline">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-rsl-navy/40 mt-3">
        Sites marked "Needs setup" can be populated using the New Site Onboarding workflow
        (5-step guided setup) — no developer required.
      </p>
    </div>
  );
}

function AreasTab({
  expandedSite,
  setExpandedSite,
}: {
  expandedSite: string | null;
  setExpandedSite: (id: string | null) => void;
}) {
  return (
    <div>
      <h2 className="font-display font-bold text-rsl-navy mb-1">Areas & Checklist Items</h2>
      <p className="text-sm text-rsl-navy/50 mb-4">
        Admins can add, edit, or delete floor areas and checklist items for their assigned sites.
      </p>

      <div className="space-y-2">
        {allSites.map((site) => {
          const isOpen = expandedSite === site.id;
          return (
            <div key={site.id} className="border border-rsl-navy/10 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedSite(isOpen ? null : site.id)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-rsl-navy/[0.02]"
              >
                <span className="font-semibold text-rsl-navy text-sm">{site.displayLabel}</span>
                <span className="text-rsl-navy/40 text-xs">
                  {site.floors.length > 0 ? `${site.floors.flatMap((f) => f.areas).length} areas` : 'Not set up'}
                  <span className="ml-2">{isOpen ? '▲' : '▼'}</span>
                </span>
              </button>

              {isOpen && (
                <div className="px-4 pb-4 border-t border-rsl-navy/5">
                  {site.floors.length === 0 ? (
                    <p className="text-sm text-rsl-navy/40 py-4">
                      No floors added yet.{' '}
                      <button className="text-rsl-red font-semibold hover:underline">
                        Start onboarding
                      </button>
                    </p>
                  ) : (
                    <div className="space-y-3 pt-3">
                      {site.floors.map((floor) => (
                        <div key={floor.id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-semibold uppercase tracking-wide text-rsl-navy/40">
                              {floor.name}
                            </span>
                            <button className="text-xs text-rsl-blue font-semibold hover:underline">
                              + Add area
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {floor.areas.map((area) => (
                              <span
                                key={area.id}
                                className="text-xs bg-rsl-navy/5 text-rsl-navy/70 rounded-full px-3 py-1 flex items-center gap-1.5"
                              >
                                {area.name}
                                <button className="text-rsl-navy/30 hover:text-rsl-red">✕</button>
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
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

function UsersTab() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-display font-bold text-rsl-navy">Users</h2>
          <p className="text-sm text-rsl-navy/50">
            God Mode manages all users. Admins can invite inspectors and reset their own team's passwords.
          </p>
        </div>
        <button className="text-sm font-semibold text-white bg-rsl-red rounded-lg px-4 py-2.5 whitespace-nowrap">
          + Invite user
        </button>
      </div>

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
            {mockUsers.map((u) => (
              <tr key={u.email} className="border-t border-rsl-navy/5">
                <td className="px-4 py-3 font-medium text-rsl-navy">{u.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      u.role === 'god' ? 'bg-rsl-gold/20 text-rsl-gold' : 'bg-rsl-blue/10 text-rsl-blue'
                    }`}
                  >
                    {u.role === 'god' ? 'God Mode' : 'Admin'}
                  </span>
                </td>
                <td className="px-4 py-3 text-rsl-navy/60">{u.sites}</td>
                <td className="px-4 py-3 text-right space-x-3">
                  <button className="text-rsl-blue font-semibold hover:underline">Reset password</button>
                  <button className="text-rsl-red font-semibold hover:underline">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 rounded-xl bg-rsl-navy/[0.03] p-4 text-xs text-rsl-navy/50">
        <strong className="text-rsl-navy/70">Permission reminder:</strong> God Mode can add/remove sites,
        manage all users, and view the full audit log. Admins can edit checklist items on their assigned
        sites and invite inspectors only. Inspectors can complete and submit inspections but can't edit
        site structure.
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
