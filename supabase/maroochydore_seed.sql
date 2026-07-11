-- ============================================================
-- MAROOCHYDORE — FLOOR AREAS + CHECKLIST ITEMS SEED
-- Source: Maroochydore floor plan + zoomed desk-booking crops
-- Single floor. 32 areas, 2 default checklist items each (64 total).
-- Idempotent via WHERE NOT EXISTS guards — safe to re-run.
--
-- Hotdesk/office occupant name tags (Angela Rondo, Sally Rostas,
-- Warren Bernard, Sarah Charlton, Doug Sheridan, Lee Moniz, Sammi
-- Turner, Graham Burke, Holly Hearn, Natalie Millward) ignored per
-- instruction — booking-system assignments, not area names.
-- All desk clusters (LO Desk 1/2, VL Desk 1/2, Multi Desk 1-4,
-- Desk 1-4) consolidated into one "Open Plan Office" area, same
-- approach as the other sites' desk clusters.
-- ============================================================

-- STEP 0 — sanity check: confirm the site row exists before seeding.
select id, name, slug from public.sites where slug = 'maroochydore';

do $$
declare
  v_site_id uuid;
  v_area_id uuid;
  v_area_name text;
  v_sort int := 0;
  v_areas text[] := array[
    'Rehab Gym',
    'Storage Room',
    'El Comms Room',
    'Clinical 1',
    'Clinical 2',
    'Clinical 3',
    'District President Office',
    'District Secretary Office',
    'District Admin Assistant Office',
    'Meeting Room 1',
    'Meeting Room 2',
    'Meeting Room 3',
    'Training Room',
    'Kitchen',
    'Staff Room',
    'Report Room',
    'Reception',
    'Reception 1',
    'OVP Room',
    'Parent Room',
    'Lift',
    'Waiting Area',
    'Accessible Restroom',
    'Male Restroom',
    'Female Restroom',
    'Plant Room',
    'Wellbeing 1',
    'Advocate 1',
    'Advocate 2',
    'Advocate 3',
    'Advocate 4',
    'Open Plan Office'
  ];
begin
  select id into v_site_id from public.sites where slug = 'maroochydore';

  if v_site_id is null then
    raise exception 'No site found with slug = maroochydore. Create the site row first, then re-run.';
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

-- STEP 2 — verify (should show 32 areas / 64 items once run)
select count(*) as areas
  from public.floor_areas fa join public.sites s on s.id = fa.site_id
  where s.slug = 'maroochydore';

select count(*) as items
  from public.checklist_items ci
  join public.floor_areas fa on fa.id = ci.area_id
  join public.sites s on s.id = fa.site_id
  where s.slug = 'maroochydore';
