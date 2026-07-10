-- ============================================================
-- TOOWOOMBA (Ruthven St) — FLOOR AREAS + CHECKLIST ITEMS SEED
-- Source: PlanOfficeLayoutRuthvenSt2021 floor plan
-- Single floor. 27 areas, 2 default checklist items each (54 total).
-- Idempotent via WHERE NOT EXISTS guards — safe to re-run.
-- ============================================================

-- STEP 0 — sanity check: confirm the site row exists before seeding.
-- If this returns 0 rows, create the Toowoomba site row first
-- (with a 'toowoomba' slug) then re-run this script.
select id, name, slug from public.sites where slug = 'toowoomba';

do $$
declare
  v_site_id uuid;
  v_area_id uuid;
  v_area_name text;
  v_sort int := 0;
  v_areas text[] := array[
    'District Presidents Office',
    'Board Room',
    'Lunchroom',
    'Unisex PWD Bathroom',
    'Unisex Accessible Bathroom 1',
    'Unisex Accessible Bathroom 2',
    'Service Room',
    'District ELT Office 1',
    'Entry',
    'Reception',
    'District Secretary Office',
    'District ELT Office 2',
    'District ELT Office 3',
    'Waiting Area',
    'Regional Coordinator Office',
    'Printer Room',
    'Meeting Room 1',
    'Meeting Room 2',
    'Meeting Room 3',
    'Storage Area',
    'Shared Hallway',
    'Meeting Room 4',
    'Hotdesk Area',
    'VSO Office 1',
    'VSO Office 2',
    'VSO Office 3',
    'VSO Office 4'
  ];
begin
  select id into v_site_id from public.sites where slug = 'toowoomba';

  if v_site_id is null then
    raise exception 'No site found with slug = toowoomba. Create the site row first, then re-run.';
  end if;

  foreach v_area_name in array v_areas loop
    v_sort := v_sort + 1;

    select id into v_area_id
      from public.floor_areas
      where site_id = v_site_id and area_name = v_area_name;

    if v_area_id is null then
      insert into public.floor_areas (site_id, floor_name, area_name, sort_order)
      values (v_site_id, 'Ground Floor', v_area_name, v_sort)
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

-- STEP 2 — verify (should show 27 areas / 54 items once run)
select count(*) as areas
  from public.floor_areas fa join public.sites s on s.id = fa.site_id
  where s.slug = 'toowoomba';

select count(*) as items
  from public.checklist_items ci
  join public.floor_areas fa on fa.id = ci.area_id
  join public.sites s on s.id = fa.site_id
  where s.slug = 'toowoomba';
