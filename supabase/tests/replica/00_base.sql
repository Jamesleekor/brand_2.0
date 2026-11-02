-- Local Supabase-like scaffolding for an isolated replica (NOT production).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT anon, authenticated, service_role TO postgres;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
GRANT USAGE ON SCHEMA auth, extensions, public TO anon, authenticated, service_role;
-- Same contract as Supabase: auth.uid() reads the JWT sub claim of the current request.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO anon, authenticated, service_role;
SET search_path = public, extensions;
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET search_path = public, extensions', current_database()); END $$;

-- Minimal base tables (only the columns the arcade/tikatuka functions read).
CREATE TABLE public.classrooms (
  id serial PRIMARY KEY,
  teacher_user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  name text
);
CREATE TABLE public.students (
  id serial PRIMARY KEY,
  user_id uuid UNIQUE,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  role text NOT NULL DEFAULT 'STUDENT',
  transferred_at timestamptz,
  is_test_account boolean NOT NULL DEFAULT false,
  name text NOT NULL,
  brand_name text
);
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classrooms ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.test_classroom_fixtures (fixture_code text, classroom_id integer);

-- Sequences used by the production table defaults.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'arcade_game_rule_versions_id_seq','arcade_games_id_seq','arcade_monthly_finalizations_id_seq',
    'arcade_monthly_snapshot_entries_id_seq','arcade_monthly_snapshot_student_ranks_id_seq',
    'arcade_monthly_snapshots_id_seq','arcade_prerelease_test_access_id_seq','arcade_ranking_periods_id_seq',
    'arcade_run_moderation_events_id_seq','arcade_run_submissions_id_seq','arcade_runs_id_seq',
    'arcade_verification_attempts_id_seq','arcade_verification_audit_events_id_seq',
    'arcade_verification_corrections_id_seq','arcade_verification_official_results_id_seq',
    'arcade_verification_period_games_id_seq','arcade_verification_provisional_entries_id_seq',
    'arcade_verification_sessions_id_seq','tikatuka_monthly_official_snapshot_entries_id_seq',
    'tikatuka_monthly_official_snapshots_id_seq','tikatuka_official_sessions_id_seq']
  LOOP EXECUTE format('CREATE SEQUENCE public.%I', s); END LOOP;
END $$;
