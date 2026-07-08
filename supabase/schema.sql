-- ============================================================
-- RSLQLD INSPECTION APP — SUPABASE SCHEMA
-- Phase 1 — Project Bible v1.6, Section 4
-- Run this in Supabase SQL Editor (project: rslqld-inspection, region: Sydney)
-- ============================================================

-- Extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- USERS (extends Supabase Auth)
-- ============================================================
create type user_role as enum ('god', 'admin', 'inspector');

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role user_role not null default 'inspector',
  assigned_sites text[] default '{}',       -- array of site ids, empty = all (god mode)
  invited_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- SITES
-- ============================================================
create table public.sites (
  id text primary key,                       -- e.g. 'anzac-house'
  name text not null,
  display_label text not null,
  address text,
  site_type text,                            -- e.g. 'office', 'clinical', 'mixed'
  floors_json jsonb not null default '[]',   -- ordered floor/zone list
  access_notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- FLOOR AREAS (rooms/zones within a site's floors)
-- ============================================================
create table public.floor_areas (
  id uuid primary key default uuid_generate_v4(),
  site_id text not null references public.sites(id) on delete cascade,
  floor_name text not null,                  -- e.g. 'GF – Ground Floor'
  area_name text not null,                   -- e.g. 'Reception'
  confirmed boolean not null default false,
  confirm_count int not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- CHECKLIST ITEMS (per area)
-- ============================================================
create type item_category as enum ('cleaning', 'maintenance');

create table public.checklist_items (
  id uuid primary key default uuid_generate_v4(),
  area_id uuid not null references public.floor_areas(id) on delete cascade,
  item_name text not null,
  category item_category not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INSPECTIONS (one per site per month, guideline only — not enforced)
-- ============================================================
create type inspection_status as enum ('draft', 'in_progress', 'complete');

create table public.inspections (
  id uuid primary key default uuid_generate_v4(),
  site_id text not null references public.sites(id) on delete cascade,
  inspector_id uuid not null references public.users(id),
  month int not null,
  year int not null,
  status inspection_status not null default 'draft',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INSPECTION ITEMS (one row per checklist item per inspection)
-- ============================================================
create table public.inspection_items (
  id uuid primary key default uuid_generate_v4(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  checklist_item_id uuid not null references public.checklist_items(id),
  cleaning_pass boolean,                     -- null = not yet assessed
  maintenance_pass boolean,
  c_comment text,
  m_comment text,
  c_photo_urls text[] default '{}',          -- max 2 enforced client-side
  m_photo_urls text[] default '{}',
  area_complete boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- PREDICTIVE TEXT (two-tier: site-specific + global)
-- ============================================================
create table public.predictive_text (
  id uuid primary key default uuid_generate_v4(),
  checklist_item_id uuid references public.checklist_items(id) on delete cascade,
  category item_category not null,
  suggestion_text text not null,
  use_count int not null default 0,
  consecutive_count int not null default 0,  -- triggers RIA prompt at 3
  last_used_date timestamptz,
  site_id text references public.sites(id), -- null = global/portfolio-wide
  created_at timestamptz not null default now()
);

-- ============================================================
-- REPORT LOG (audit trail — PDF generated on demand, not stored)
-- ============================================================
create table public.report_log (
  id uuid primary key default uuid_generate_v4(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  generated_at timestamptz not null default now(),
  email_sent_to text[] not null,
  pdf_url text                               -- optional, only if downloaded copy retained
);

-- ============================================================
-- ZONE PHOTOS (optional reference photos per area, not tied to a fail)
-- ============================================================
create table public.zone_photos (
  id uuid primary key default uuid_generate_v4(),
  inspection_id uuid not null references public.inspections(id) on delete cascade,
  area_id uuid not null references public.floor_areas(id),
  photo_url text[] default '{}',             -- max 2 enforced client-side
  caption text,
  floor text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.users enable row level security;
alter table public.sites enable row level security;
alter table public.floor_areas enable row level security;
alter table public.checklist_items enable row level security;
alter table public.inspections enable row level security;
alter table public.inspection_items enable row level security;
alter table public.predictive_text enable row level security;
alter table public.report_log enable row level security;
alter table public.zone_photos enable row level security;

-- Helper: is the current user god mode?
create or replace function public.is_god() returns boolean as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'god'
  );
$$ language sql security definer;

-- Helper: does the current user have access to a given site?
create or replace function public.has_site_access(check_site_id text) returns boolean as $$
  select public.is_god() or exists (
    select 1 from public.users
    where id = auth.uid()
    and (assigned_sites = '{}' or check_site_id = any(assigned_sites))
  );
$$ language sql security definer;

-- USERS: everyone can read their own row; god mode reads/writes all
create policy "users read own" on public.users for select using (auth.uid() = id or public.is_god());
create policy "users god manage" on public.users for all using (public.is_god());

-- SITES: readable by anyone assigned; only god mode can write
create policy "sites read assigned" on public.sites for select using (public.has_site_access(id));
create policy "sites god write" on public.sites for insert with check (public.is_god());
create policy "sites god update" on public.sites for update using (public.is_god());
create policy "sites god delete" on public.sites for delete using (public.is_god());

-- FLOOR AREAS / CHECKLIST ITEMS: read if site access; write if god or admin-on-assigned-site
create policy "floor_areas read" on public.floor_areas for select using (public.has_site_access(site_id));
create policy "floor_areas write" on public.floor_areas for all using (public.has_site_access(site_id) and exists (
  select 1 from public.users where id = auth.uid() and role in ('god','admin')
));

create policy "checklist_items read" on public.checklist_items for select using (
  exists (select 1 from public.floor_areas fa where fa.id = area_id and public.has_site_access(fa.site_id))
);
create policy "checklist_items write" on public.checklist_items for all using (
  exists (
    select 1 from public.floor_areas fa
    join public.users u on u.id = auth.uid()
    where fa.id = area_id and public.has_site_access(fa.site_id) and u.role in ('god','admin')
  )
);

-- INSPECTIONS / INSPECTION ITEMS: inspectors see their own + assigned site scope
create policy "inspections access" on public.inspections for all using (public.has_site_access(site_id));

create policy "inspection_items access" on public.inspection_items for all using (
  exists (select 1 from public.inspections i where i.id = inspection_id and public.has_site_access(i.site_id))
);

-- PREDICTIVE TEXT: read/write within site access (global rows readable by all)
create policy "predictive_text read" on public.predictive_text for select using (
  site_id is null or public.has_site_access(site_id)
);
create policy "predictive_text write" on public.predictive_text for all using (
  site_id is null or public.has_site_access(site_id)
);

-- REPORT LOG / ZONE PHOTOS: scoped via inspection's site
create policy "report_log access" on public.report_log for all using (
  exists (select 1 from public.inspections i where i.id = inspection_id and public.has_site_access(i.site_id))
);
create policy "zone_photos access" on public.zone_photos for all using (
  exists (select 1 from public.inspections i where i.id = inspection_id and public.has_site_access(i.site_id))
);

-- ============================================================
-- SEED: Anzac House (pilot site) — from Bible Section 3
-- ============================================================
insert into public.sites (id, name, display_label, address, site_type, sort_order, floors_json) values
('anzac-house', 'Anzac House', 'Anzac House', null, 'office', 1,
'[
  {"floor_name":"B2 – Basement Level 2","areas":["Carpark Driveway","Carpark Bays","Cleaners Store"]},
  {"floor_name":"B1 – Basement Level 1","areas":["Carpark"]},
  {"floor_name":"GF – Ground Floor","areas":["Entrance/Foyer","Reception","Lift","Offices (General)","Meeting Rooms","Toilets","Kitchen","Plant Room"]},
  {"floor_name":"L1 – Level 1","areas":["Open Plan Office","Meeting Rooms","Quiet Rooms","Phone Booths","Toilets","Kitchen"]},
  {"floor_name":"L2 – Level 2","areas":["Offices","Meeting Rooms","HR Office","Locker Room","Toilets","Kitchen"]},
  {"floor_name":"L3 – Level 3","areas":["Executive Offices","Boardrooms","Collaboration Areas","Booths","Toilets"]},
  {"floor_name":"Common Areas","areas":["Lift","Fire Stairs"]},
  {"floor_name":"Roof","areas":["Roof Membrane","Plant Equipment"]},
  {"floor_name":"External / Gardens","areas":["Gardens","Paths/Access"]}
]'::jsonb
);

-- Remaining 8 sites (skeleton rows — zones/areas TBC per Bible Section 3, populate via Admin portal)
insert into public.sites (id, name, display_label, sort_order, site_type, floors_json) values
('wickham-l14', '100 Wickham St', '(L14) 100 Wickham', 2, 'office', '[]'),
('stafford', 'Stafford', 'Stafford', 3, 'office', '[]'),
('strathpine', 'Strathpine', 'Strathpine', 4, 'office', '[]'),
('bundall-1', 'Bundall Suite 1', 'Bundall (Suite 1)', 5, 'office', '[]'),
('bundall-2', 'Bundall Suite 2', 'Bundall (Suite 2)', 6, 'office', '[]'),
('maroochydore', 'Maroochydore', 'Maroochydore', 7, 'mixed', '[]'),
('ipswich', 'Ipswich', 'Ipswich', 8, 'clinical', '[]'),
('toowoomba', 'Toowoomba', 'Toowoomba', 9, 'office', '[]');

-- Seed god mode + admin users (created after first Supabase Auth sign-up — update UUIDs then)
-- insert into public.users (id, email, role, assigned_sites) values
-- ('<uuid-from-auth>', 'ben.carey@rslqld.org', 'god', '{}'),
-- ('<uuid-from-auth>', 'assets@rslqld.org', 'admin', '{}'),
-- ('<uuid-from-auth>', 'matt.sparnon@rslqld.org', 'admin', '{}');
