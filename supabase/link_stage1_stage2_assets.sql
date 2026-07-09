-- ============================================================
-- RSLQLD Inspection App — Link Stage 1 & Stage 2 for shared physical assets
-- Adds a nullable reference from health_items to floor_areas, so an asset
-- like "Lift" or "Roof membrane" can show its monthly Pass/Fail history
-- (Stage 1) alongside its annual condition/life-expectancy rating (Stage 2)
-- in one place — without inspectors double-entering the same asset twice.
--
-- Most SOHC items (Structure, Electrical switchboards, WHS items, etc.)
-- have no Stage 1 equivalent and stay unlinked (null) — this is only for
-- items that exist as a physical area in BOTH templates.
-- ============================================================

alter table health_items add column if not exists stage1_area_id uuid references floor_areas(id);

-- ------------------------------------------------------------
-- Link Anzac House's shared assets. Matches by site + area_name.
-- NOTE: Anzac House's Stage 1 checklist has "Lift" listed twice
-- (GF and Common Areas) — linking to the Common Areas one here as the
-- building-wide mechanical asset. Flag if GF should be the canonical one
-- instead, or if they should in fact be treated as two separate lifts.
-- ------------------------------------------------------------
with target_site as (
  select id from sites where name = 'Anzac House' limit 1
),
links as (
  select 'Lifts & Vertical Transport' as category_name, 'Lift condition' as item_name,
         'Common Areas' as floor_name, 'Lift' as area_name
  union all
  select 'Roof & External Envelope', 'Roof membrane', 'Roof', 'Roof Membrane'
  union all
  select 'Mechanical (HVAC)', 'Plant room equipment condition', 'Roof', 'Plant Equipment'
)
update health_items hi
set stage1_area_id = fa.id
from links l
join health_categories hc on hc.category_name = l.category_name
join floor_areas fa on fa.floor_name = l.floor_name and fa.area_name = l.area_name
cross join target_site
where hi.category_id = hc.id
  and hi.item_name = l.item_name
  and hc.site_id = target_site.id
  and fa.site_id = target_site.id;
