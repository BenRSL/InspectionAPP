-- ============================================================
-- 100 WICKHAM ST (L14) — FLOOR AREAS + CHECKLIST ITEMS SEED
-- Source: Wickham L14 floor plan
-- Single floor (Level 14). 13 areas, 2 default checklist items
-- each (26 total).
-- Idempotent via WHERE NOT EXISTS guards — safe to re-run.
--
-- Desk 1–59 consolidated into one "Open Plan Office" area (Desk 60
-- pulled out — confirmed as a private office, not open-plan desk).
-- "Reception" + "Reception 1" + "Reception 2" confirmed as one
-- open reception bay, not 3 separate rooms. Only one Interview
-- Room visible on this plan.
-- ============================================================

-- STEP 0 — sanity check: confirm the site row exists before seeding.
select id, name, slug from public.sites where slug = 'wickham-l14';

do $$
declare
  v_site_id uuid;
  v_area_id uuid;
  v_area_name text;
  v_sort int := 0;
  v_areas text[] := array[
    'Open Plan Office',
    'Head of Mates4mates & Wellbeing',
    'Kitchen',
    'Female Restroom',
    'Male Restroom',
    'Accessible Restroom',
    'Meeting Room 1',
    'Meeting Room 2',
    'Printer Room',
    'Boardroom',
    'Reception',
    'Interview Room 1',
    'Lift Lobby'
  ];
begin
  select id into v_site_id from public.sites where slug = 'wickham-l14';

  if v_site_id is null then
    raise exception 'No site found with slug = wickham-l14. Create the site row first, then re-run.';
  end if;

  foreach v_area_name in array v_areas loop
    v_sort := v_sort + 1;

    select id into v_area_id
      from public.floor_areas
      where site_id = v_site_id and area_name = v_area_name;

    if v_area_id is null then
      insert into public.floor_areas (site_id, floor_name, area_name, sort_order)
      values (v_site_id, 'Level 14', v_area_name, v_sort)
      returning id into v_area_id;
    end if;

    if not exists (
      select 1 from public.checklist_items
      where area_id = v_area_id and category = 'cleaning'::checklist_category
    ) then
      insert into public.checklist_items (area_id, item_name, category)
      values (v_area_id, 'General condition', 'cleaning'::checklist_category);
    end if;

    if not exists (
      select 1 from public.checklist_items
      where area_id = v_area_id and category = 'maintenance'::checklist_category
    ) then
      insert into public.checklist_items (area_id, item_name, category)
      values (v_area_id, 'General condition', 'maintenance'::checklist_category);
    end if;
  end loop;
end $$;

-- STEP 2 — verify (should show 13 areas / 26 items once run)
select count(*) as areas
  from public.floor_areas fa join public.sites s on s.id = fa.site_id
  where s.slug = 'wickham-l14';

select count(*) as items
  from public.checklist_items ci
  join public.floor_areas fa on fa.id = ci.area_id
  join public.sites s on s.id = fa.site_id
  where s.slug = 'wickham-l14';
