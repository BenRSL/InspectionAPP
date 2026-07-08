-- ============================================================
-- RSLQLD Inspection App — Stage 1 seed data: Strathpine
-- Single-floor site (Bible Section 3: 1 zone, 13 areas confirmed).
-- Follows the same Cleaning + Maintenance split per area as Anzac House
-- (two checklist_items rows per area, category = 'cleaning' | 'maintenance').
--
-- ASSUMPTION: Strathpine already exists in `sites` (created via the
-- New Site Onboarding workflow, Step 1). This script only populates
-- Steps 2 & 3 of that flow — floors, areas, and checklist items.
-- ============================================================

with target_site as (
  select id from sites where name = 'Strathpine' limit 1
),
areas as (
  insert into floor_areas (site_id, floor_name, area_name, sort_order)
  select target_site.id, 'Ground Floor', a.area_name, a.sort_order
  from target_site, (values
    ('Entrance / Foyer', 1),
    ('Reception', 2),
    ('Open Plan Office', 3),
    ('Meeting Room 1', 4),
    ('Meeting Room 2', 5),
    ('Boardroom', 6),
    ('Kitchen', 7),
    ('Toilets', 8),
    ('Storage Room', 9),
    ('Comms / Server Room', 10),
    ('Carpark', 11),
    ('Fire Stairs / Exits', 12),
    ('External Grounds', 13)
  ) as a(area_name, sort_order)
  returning id, area_name
)
insert into checklist_items (area_id, item_name, category)
select areas.id, areas.area_name, c.category
from areas
cross join (values ('cleaning'), ('maintenance')) as c(category);
