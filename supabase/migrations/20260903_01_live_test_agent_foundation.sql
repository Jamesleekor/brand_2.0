-- =============================================================================
-- B.R.A.N.D 2.0 — Live Test Agent foundation (Phase A)
-- 2026-09-03
--
-- Purpose
--   * Adds a strong marker for exactly one ACTIVE live test agent inside a
--     production classroom while keeping the account's normal role STUDENT.
--   * Provides one shared official-participant predicate for later Phase B
--     exclusions (rankings, statistics, MVP, Guild, Arcade, Records, etc.).
--   * Adds a service-only creation helper. Auth user creation remains outside
--     SQL and must use Supabase Auth Admin / Dashboard first.
--
-- Important scope
--   * students.is_test_account means LIVE TEST AGENT in a real classroom.
--   * It does NOT classify the five students in the separate B.R.A.N.D TEST
--     fixture classroom. Those remain managed by test_classroom_fixtures.
--   * This migration does NOT yet change any ranking/statistics/game query.
--     Official-data exclusions are Phase B.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Production contract checks.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.classrooms') IS NULL THEN
    RAISE EXCEPTION '[LIVE_TEST] required students/classrooms tables are missing.'
      USING ERRCODE = 'P0700';
  END IF;

  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL THEN
    RAISE EXCEPTION '[LIVE_TEST] identity helpers are missing.'
      USING ERRCODE = 'P0701';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Strong marker on students.
--    Existing rows become false automatically; no existing student is changed
--    into a test account by this migration.
-- -----------------------------------------------------------------------------
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS is_test_account boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.students.is_test_account IS
  'True only for the single live QA/test agent placed inside a real classroom. The account keeps role=STUDENT but is excluded from official B.R.A.N.D results by is_official_participant(). Dedicated B.R.A.N.D TEST fixture students are identified separately.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.students'::regclass
      AND conname = 'students_live_test_agent_role_check'
  ) THEN
    ALTER TABLE public.students
      ADD CONSTRAINT students_live_test_agent_role_check
      CHECK (NOT is_test_account OR role = 'STUDENT'::public.student_role);
  END IF;
END;
$$;

-- Exactly one ACTIVE live test agent per classroom. A transferred/deactivated
-- historical row does not block creation of a future replacement agent.
CREATE UNIQUE INDEX IF NOT EXISTS students_one_active_live_test_agent_per_classroom_uidx
  ON public.students (classroom_id)
  WHERE is_test_account = true
    AND transferred_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_students_live_test_agent_lookup
  ON public.students (classroom_id, id)
  WHERE is_test_account = true;

-- -----------------------------------------------------------------------------
-- 2. Shared predicates.
--    Phase B and later Records work should call is_official_participant()
--    instead of re-inventing role/is_test filters in each feature.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_live_test_agent(p_student_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT coalesce((
    SELECT student.is_test_account
    FROM public.students AS student
    WHERE student.id = p_student_id
      AND student.transferred_at IS NULL
  ), false);
$$;

CREATE OR REPLACE FUNCTION public.is_official_participant(p_student_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.id = p_student_id
      AND student.transferred_at IS NULL
      AND student.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD')
      AND student.is_test_account = false
  );
$$;

COMMENT ON FUNCTION public.is_live_test_agent(integer) IS
  'Returns true only for an active production-classroom live test agent row.';
COMMENT ON FUNCTION public.is_official_participant(integer) IS
  'Canonical B.R.A.N.D official-participant predicate. Active student-like role and NOT a live test agent.';

-- Browser clients may safely use these read-only predicates. They reveal only
-- a boolean for a student id and bypass no write policy.
REVOKE ALL ON FUNCTION public.is_live_test_agent(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_official_participant(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_live_test_agent(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_official_participant(integer) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Service-only creation helper.
--    Auth account must already exist. The students INSERT trigger will create
--    the normal wallet exactly as it does for an ordinary student.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_create_live_test_agent(
  p_classroom_id integer,
  p_auth_user_id uuid,
  p_name text DEFAULT '테스트요원',
  p_brand_name text DEFAULT 'QA-01'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student public.students%ROWTYPE;
BEGIN
  IF p_classroom_id IS NULL OR p_classroom_id <= 0 THEN
    RAISE EXCEPTION '[LIVE_TEST] classroom_id is required.' USING ERRCODE = 'P0702';
  END IF;

  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION '[LIVE_TEST] Auth user UUID is required.' USING ERRCODE = 'P0703';
  END IF;

  IF nullif(btrim(coalesce(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION '[LIVE_TEST] test-agent name is required.' USING ERRCODE = 'P0704';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.classrooms AS classroom
    WHERE classroom.id = p_classroom_id
      AND classroom.is_active = true
  ) THEN
    RAISE EXCEPTION '[LIVE_TEST] active classroom % was not found.', p_classroom_id
      USING ERRCODE = 'P0705';
  END IF;

  -- The dedicated destructive TEST fixture is a different testing mechanism.
  IF to_regclass('public.test_classroom_fixtures') IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.test_classroom_fixtures AS fixture
       WHERE fixture.classroom_id = p_classroom_id
     ) THEN
    RAISE EXCEPTION '[LIVE_TEST] use the existing TEST01~05 fixture in the dedicated B.R.A.N.D TEST classroom.'
      USING ERRCODE = 'P0706';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = p_auth_user_id
  ) THEN
    RAISE EXCEPTION '[LIVE_TEST] Auth user % does not exist.', p_auth_user_id
      USING ERRCODE = 'P0707';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.user_id = p_auth_user_id
  ) THEN
    RAISE EXCEPTION '[LIVE_TEST] Auth user % is already linked to a students row.', p_auth_user_id
      USING ERRCODE = 'P0708';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.classroom_id = p_classroom_id
      AND student.is_test_account = true
      AND student.transferred_at IS NULL
  ) THEN
    RAISE EXCEPTION '[LIVE_TEST] this classroom already has an active live test agent.'
      USING ERRCODE = 'P0709';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.students AS student
    WHERE student.classroom_id = p_classroom_id
      AND student.name = btrim(p_name)
  ) THEN
    RAISE EXCEPTION '[LIVE_TEST] student name % already exists in this classroom.', btrim(p_name)
      USING ERRCODE = 'P0710';
  END IF;

  INSERT INTO public.students (
    user_id,
    classroom_id,
    name,
    brand_name,
    role,
    note,
    is_test_account
  )
  VALUES (
    p_auth_user_id,
    p_classroom_id,
    btrim(p_name),
    nullif(btrim(coalesce(p_brand_name, '')), ''),
    'STUDENT'::public.student_role,
    'LIVE_TEST_AGENT_V1 — official rankings/statistics/records excluded',
    true
  )
  RETURNING * INTO v_student;

  RETURN jsonb_build_object(
    'student_id', v_student.id,
    'classroom_id', v_student.classroom_id,
    'name', v_student.name,
    'brand_name', v_student.brand_name,
    'role', v_student.role,
    'is_test_account', v_student.is_test_account,
    'wallet_initialized_by_students_trigger', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_create_live_test_agent(integer, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_create_live_test_agent(integer, uuid, text, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- -----------------------------------------------------------------------------
-- SQL Editor-safe structural/data postcheck. This changes nothing.
-- Expected before the actual live test agent is created:
--   classroom 1 => official_participants = 24, live_test_agents = 0
-- -----------------------------------------------------------------------------
SELECT jsonb_build_object(
  'column_ready', EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'is_test_account'
      AND is_nullable = 'NO'
  ),
  'single_active_agent_index_ready', to_regclass(
    'public.students_one_active_live_test_agent_per_classroom_uidx'
  ) IS NOT NULL,
  'functions_ready', jsonb_build_object(
    'is_live_test_agent', to_regprocedure('public.is_live_test_agent(integer)') IS NOT NULL,
    'is_official_participant', to_regprocedure('public.is_official_participant(integer)') IS NOT NULL,
    'service_create_live_test_agent', to_regprocedure('public.service_create_live_test_agent(integer,uuid,text,text)') IS NOT NULL
  ),
  'classroom_counts', coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'classroom_id', classroom.id,
        'classroom_name', classroom.name,
        'official_participants', (
          SELECT count(*)
          FROM public.students student
          WHERE student.classroom_id = classroom.id
            AND public.is_official_participant(student.id)
        ),
        'live_test_agents', (
          SELECT count(*)
          FROM public.students student
          WHERE student.classroom_id = classroom.id
            AND student.is_test_account = true
            AND student.transferred_at IS NULL
        )
      )
      ORDER BY classroom.id
    )
    FROM public.classrooms classroom
    WHERE classroom.is_active = true
  ), '[]'::jsonb)
) AS live_test_agent_phase_a_postcheck;
