-- Corrects the Wickham site name to the exact official form: 'L14 / 100 Wickham'
-- (previously '100 Wickham (L14)' from the initial 9-site insert)
update public.sites
set name = 'L14 / 100 Wickham'
where slug = 'wickham-l14';

-- verify
select id, name, slug from public.sites where slug = 'wickham-l14';
