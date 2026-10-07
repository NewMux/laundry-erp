-- Turn on row level security for every table in "public".
--
-- The app connects as the table owner, which bypasses RLS, so nothing changes
-- for the API (Docker or Vercel). On Supabase, the Data API (PostgREST) exposes
-- the "public" schema to the anon/authenticated roles; with RLS on and no
-- policies, those roles can read and write nothing. Tenant isolation stays in
-- the API (src/lib/tenant-db.ts).
--
-- New tables need the same: add `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
-- to their migration (test/rls.test.ts fails otherwise).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
