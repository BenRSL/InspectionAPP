-- ============================================================
-- RSLQLD Inspection App — Base Schema (Stage 1 + Stage 2)
-- Drafted from Project Bible v1.8, Section 4, since no base
-- schema file could be located.
--
-- READ BEFORE RUNNING:
-- Every line tagged -- ASSUMPTION: fills a gap the Bible didn't
-- specify (mostly `sites`, `users`, `inspections` columns, and
-- RLS/permissions — Section 5 says "unchanged from v1.7," which
-- wasn't available to draft from). Review those before treating
-- this as final. Everything else follows the Bible's Section 4
-- table descriptions directly.
--
-- Run BEFORE strathpine_seed.sql and link_stage1_stage2_assets.sql
-- (link_stage1_stage2_assets.sql's `alter table ... add column if
-- not exists stage1_area_id` becomes a no-op here since it's
-- already declared below — safe to run either way).
-- ============================================================

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- ---------- ENUM TYPES ----------

create type user_role as enum ('inspector', 'admin', 'god_mode'); -- Section 5, 2 admin levels + inspector
create type checklist_category as enum ('cleaning', 'maintenance');
create type pass_fail as enum ('pass', 'fail');
create type site_status as enum ('onboarding', 'active'); -- Section 4 / Section 11
create type inspection_status as enum ('in_progress', 'completed');
create type health_condition as enum ('good', 'fair', 'poor', 'critical'); -- Section 6, Decision #2
create type life_expectancy_band as enum ('0_2', '3_5', '6_10', '10_plus'); -- Section 6, Decision #3
create type health_inspection_status as enum ('in_progress', 'completed');

-- ---------- CORE ----------

-- ASSUMPTION: minimal columns; Bible doesn't list a full `sites` definition.
create table sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  status site_status not null default 'onboarding',
  onboarding_step int not null default 1, -- 1-5, Section 11's 5-step flow
  sohc_onboarding_inspections_remaining int not null default 3, -- Section 5, reverts to admin-only edit rights at 0
  created_at timestamptz not null default now()
);

-- ASSUMPTION: `id` mirrors Supabase auth.users.id (standard pattern), not a separate identity.
create table users (
  id uuid primary key, -- = auth.users.id
  email text not null unique,
  role user_role not null default 'inspector',
  created_at timestamptz not null default now()
);

-- ASSUMPTION: many-to-many, since nothing in the Bible says inspectors are limited to one site.
create table user_site_access (
  user_id uuid not null references users(id) on delete cascade,
  site_id uuid not null references sites(id) on delete cascade,
  primary key (user_id, site_id)
);

-- ---------- STAGE 1: MONTHLY INSPECT ----------

create table floor_areas (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  floor_name text not null,
  area_name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references floor_areas(id) on delete cascade,
  item_name text not null,
  category checklist_category not null,
  consecutive_fail_count int not null default 0, -- Section 8, maintained by trigger below
  created_at timestamptz not null default now(),
  unique (area_id, item_name, category)
);

-- ASSUMPTION: one Monthly Inspect per site per calendar month (period_month = 1st of month).
create table inspections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  inspector_id uuid not null references users(id),
  period_month date not null,
  status inspection_status not null default 'in_progress',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (site_id, period_month)
);

create table inspection_items (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references inspections(id) on delete cascade,
  checklist_item_id uuid not null references checklist_items(id),
  result pass_fail not null,
  comment text,
  created_at timestamptz not null default now(),
  unique (inspection_id, checklist_item_id)
);

create table zone_photos (
  id uuid primary key default gen_random_uuid(),
  inspection_item_id uuid not null references inspection_items(id) on delete cascade,
  storage_path text not null, -- Supabase Storage object path
  uploaded_at timestamptz not null default now()
);

-- ASSUMPTION: predictive text keyed on item_name+category (not per-row), so a phrase
-- like "patch paint required" can surface as a suggestion anywhere a similarly named
-- item fails, not just the exact row it was first typed on.
create table predictive_text (
  id uuid primary key default gen_random_uuid(),
  item_name text not null,
  category checklist_category not null,
  phrase text not null,
  use_count int not null default 1,
  last_used_at timestamptz not null default now(),
  unique (item_name, category, phrase)
);

create table report_log (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid references inspections(id),
  health_inspection_id uuid, -- FK added after health_inspections exists, below
  sent_to text[] not null,
  pdf_storage_path text,
  sent_at timestamptz not null default now(),
  check (inspection_id is not null or health_inspection_id is not null)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references users(id),
  action text not null,
  target_type text not null,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------- STAGE 2: STATE OF HEALTH CHECKLIST (SOHC) ----------

create table health_categories (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id) on delete cascade,
  category_name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0
);

create table health_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references health_categories(id) on delete cascade,
  item_name text not null,
  is_active boolean not null default true,
  sort_order int not null default 0,
  stage1_area_id uuid references floor_areas(id) -- shared-asset link, Section 4
);

create table health_inspections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references sites(id),
  inspector_id uuid not null references users(id),
  year int not null,
  status health_inspection_status not null default 'in_progress',
  completed_at timestamptz,
  unique (site_id, year) -- annual cadence, Section 4
);

create table health_inspection_items (
  id uuid primary key default gen_random_uuid(),
  health_inspection_id uuid not null references health_inspections(id) on delete cascade,
  health_item_id uuid not null references health_items(id),
  condition health_condition not null,
  life_expectancy life_expectancy_band not null,
  comment text,
  photo_urls text[], -- required only when condition is fair/poor/critical — enforced in app (Section 6, Decision #5)
  requires_attention boolean generated always as (condition in ('poor', 'critical')) stored,
  unique (health_inspection_id, health_item_id)
);

alter table report_log
  add constraint report_log_health_inspection_fk
  foreign key (health_inspection_id) references health_inspections(id);

-- ---------- TRIGGER: recurring fail logic (Section 8) ----------
-- "Recurring" = same checklist_item failed this month + prior 2 months, same site.
-- A Pass anywhere in that window resets the streak to 0.

create or replace function update_consecutive_fail_count()
returns trigger as $$
declare
  v_site_id uuid;
  v_this_month date;
  v_streak int := 0;
begin
  select site_id, period_month into v_site_id, v_this_month
  from inspections where id = new.inspection_id;

  if new.result = 'pass' then
    v_streak := 0;
  else
    with recent as (
      select ii.result
      from inspection_items ii
      join inspections i on i.id = ii.inspection_id
      where ii.checklist_item_id = new.checklist_item_id
        and i.site_id = v_site_id
        and i.period_month <= v_this_month
      order by i.period_month desc
      limit 3
    )
    select count(*) into v_streak from recent where result = 'fail';
  end if;

  update checklist_items set consecutive_fail_count = v_streak where id = new.checklist_item_id;
  return new;
end;
$$ language plpgsql;

create trigger trg_update_consecutive_fail_count
after insert on inspection_items
for each row execute function update_consecutive_fail_count();

-- ---------- VIEW: portfolio asset lifecycle flags (Section 4) ----------
-- Latest completed SOHC per site, filtered to Poor/Critical condition
-- or 0-2yr life expectancy, sorted by urgency. Feeds both Analytics
-- and the God Mode dashboard per the Bible.

create view v_asset_lifecycle_flags as
with latest_per_site as (
  select site_id, max(year) as latest_year
  from health_inspections
  where status = 'completed'
  group by site_id
)
select
  hi.site_id,
  s.name as site_name,
  hc.category_name,
  hitm.item_name,
  hii.condition,
  hii.life_expectancy,
  hii.comment
from health_inspection_items hii
join health_items hitm on hitm.id = hii.health_item_id
join health_categories hc on hc.id = hitm.category_id
join health_inspections hi on hi.id = hii.health_inspection_id
join latest_per_site lps on lps.site_id = hi.site_id and lps.latest_year = hi.year
join sites s on s.id = hi.site_id
where hii.condition in ('poor', 'critical') or hii.life_expectancy = '0_2'
order by
  case hii.condition when 'critical' then 0 when 'poor' then 1 else 2 end,
  case hii.life_expectancy when '0_2' then 0 when '3_5' then 1 when '6_10' then 2 else 3 end;

-- ---------- ROW LEVEL SECURITY ----------
-- ASSUMPTION / INCOMPLETE: Section 5 says permissions are "unchanged from v1.7,"
-- but v1.7 wasn't available to draft from. RLS is enabled with a conservative
-- read-only-for-authenticated default below. Write policies (who can edit
-- zones/items/inspections at each of the 3 role levels) are deliberately left
-- out — needs the real v1.7 permission matrix rather than a guess, since this
-- is exactly the kind of thing that's easy to get wrong silently.

alter table sites enable row level security;
alter table floor_areas enable row level security;
alter table checklist_items enable row level security;
alter table health_categories enable row level security;
alter table health_items enable row level security;

create policy "Authenticated read" on sites for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on floor_areas for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on checklist_items for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on health_categories for select using (auth.role() = 'authenticated');
create policy "Authenticated read" on health_items for select using (auth.role() = 'authenticated');

-- TODO before go-live: write policies for inspections/inspection_items/health_inspections/
-- health_inspection_items (who can insert/update, scoped to their assigned sites), and
-- admin/god_mode-only write policies on sites/floor_areas/checklist_items/health_categories/
-- health_items per Section 5's 2-tier admin model.
