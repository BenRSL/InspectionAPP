# RSLQLD Inspection App

Phase 1 (Supabase schema) + Phase 2 (Next.js scaffold) + Phase 3 pilot (Anzac House inspector UI, wired to local state — Supabase writes to be connected next).

## Setup (when accounts are ready)
1. `npm install`
2. Create Supabase project (region: Sydney) and run `supabase/schema.sql` in the SQL editor
3. Copy `.env.local.example` to `.env.local` and fill in Supabase keys
4. `npm run dev`
5. Deploy: connect repo to Vercel

## What's built
- Full Anzac House floor/area structure (`lib/sites.ts`)
- Site switcher landing page
- Inspector component: floor tabs, Pass/Fail per Cleaning + Maintenance, comments on fail, Needs Attention view, progress tracker, Mark Area Complete
- Supabase schema with RLS for all 9 tables from the Bible's data model

## Not yet wired
- Supabase reads/writes (Inspector currently uses local React state only)
- Photo upload (button is a stub)
- RIA assistant, Admin portal, report generation/email, offline sync
- Remaining 8 sites' floor/area data (shells exist, need populating)
