-- ============================================================
-- IPSWICH — FLOOR AREAS + CHECKLIST ITEMS SEED
-- Source: Ipswich floor plan + zoomed desk-booking system crops
-- Single floor. 31 areas, 2 default checklist items each (62 total).
-- Idempotent via WHERE NOT EXISTS guards — safe to re-run.
--
-- NOTE: Hotdesk occupant name tags (Catherine Akers, Paul Rogers,
-- Tracy Gordon, Tenille Mantei, Cushla Smith, Rod Nicholls) were
-- ignored per instruction — those are booking-system assignments,
-- not area names. Desk 1–18 consolidated into one "Open Plan Office"
-- area, same approach as the other sites' desk clusters.
--
-- Two labels flagged as uncertain, used my best read — confirm at
-- the walkaround:
--   - "DESO Office" (small acronym tag, top-left cluster)
--   - "Reception (Ops & PP)" (large central room, partial text)
-- ============================================================

-- STEP 0 — sanity check: confirm the site row exists before seeding.
select id, name, slug from public.sites where slug = 'ipswich';

do $$
declare
  v_site_id uuid;
  v_area_id uuid;
  v_area_name text;
  v_sort int := 0;
  v_areas text[] := array[
    'Multi Use 1',
    'Multi Use 2',
    'Clinical 1',
    'Clinical 2',
    'Clinical 3',
    'Clinical 4',
    'DESO Office',
    'District President Office',
    'District Admin Assistant Office',
    'Meeting Room 1',
    'Meeting Room 2',
    'Lift',
    'Open Plan Office',
    'VFWC Manager Office',
    'Quiet Room 1',
    'Quiet Room 2',
    'Reception 1',
    'Reception 2',
    'Reception (Ops & PP)',
    'Female Restroom',
    'Male Restroom',
    'Accessible Restroom',
    'Data Cabinet',
    'Advocacy 1',
    'Advocacy 2',
    'Advocacy 3',
    'Storage Room',
    'Rehab - Gym & EP',
    'OVP Room',
    'Kitchen',
    'Exercise Physiologist Room'
  ];
begin
  select id into v_site_id from public.sites where slug = 'ipswich';

  if v_site_id is null then
    raise exception 'No site found with slug = ipswich. Create the site row first, then re-run.';
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

-- STEP 2 — verify (should show 31 areas / 62 items once run)
select count(*) as areas
  from public.floor_areas fa join public.sites s on s.id = fa.site_id
  where s.slug = 'ipswich';

select count(*) as items
  from public.checklist_items ci
  join public.floor_areas fa on fa.id = ci.area_id
  join public.sites s on s.id = fa.site_id
  where s.slug = 'ipswich';
