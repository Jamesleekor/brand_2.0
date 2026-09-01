-- =============================================================================
-- B.R.A.N.D 2.0 — dedicated TEST classroom fixture
-- Incremental migration.  Never run an older Guild/Arcade migration again.
--
-- Production compatibility basis
--   * PREFLIGHT_TEST_CLASSROOM_FIXTURES.sql confirmed that B.R.A.N.D TEST and
--     TEST01..TEST05 do not exist yet, while the current 25 student rows are
--     already auth-linked.
--   * The role-only addendum confirmed one current TEACHER student record.
--     Therefore the TEST TEACHER is deliberately a teacher-only auth account:
--     it gets no students row and owns exactly one active TEST classroom.
--   * Existing current_classroom_id()/get_current_user_context() helpers are
--     intentionally not changed.  A second active classroom under the real
--     teacher account would be ambiguous in the current production helper.
--
-- Safety model
--   * auth.users accounts are created only by the paired Edge Function using
--     the Supabase Auth Admin API.  SQL only receives already-created UUIDs.
--   * Browser clients cannot call the service reconciliation RPC.
--   * Reset accepts no classroom ID.  It resolves BRAND_TEST_V1 solely from
--     the fixture registry and re-checks it inside the transaction.
--   * The immutable-history trigger exception is available only while the
--     reset RPC has set a transaction-local, registry-validated TEST context.
--     Direct table writes remain unavailable to authenticated clients.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.classrooms') IS NULL
     OR to_regclass('public.students') IS NULL
     OR to_regclass('public.guild_seasons') IS NULL
     OR to_regclass('public.guilds') IS NULL
     OR to_regclass('public.guild_members') IS NULL
     OR to_regclass('public.guild_membership_events') IS NULL
     OR to_regclass('public.guild_sessions') IS NULL
     OR to_regclass('public.guild_session_participants') IS NULL
     OR to_regclass('public.guild2_observation_events') IS NULL
     OR to_regclass('public.guild2_compensation_configs') IS NULL
     OR to_regclass('public.guild2_individual_contributions') IS NULL
     OR to_regclass('public.guild2_gs_events') IS NULL
     OR to_regclass('public.guild2_monthly_gs_summaries') IS NULL
     OR to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild3_mission_participants') IS NULL
     OR to_regclass('public.guild3_mission_submissions') IS NULL
     OR to_regclass('public.guild3_mission_activity_records') IS NULL
     OR to_regclass('public.guild3_mission_grade_events') IS NULL
     OR to_regclass('public.guild3_mission_judgment_events') IS NULL
     OR to_regclass('public.guild3_mission_audit_events') IS NULL
     OR to_regclass('public.guild3_peer_review_openings') IS NULL
     OR to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_run_submissions') IS NULL
     OR to_regclass('public.arcade_run_moderation_events') IS NULL
     OR to_regclass('public.arcade_monthly_finalizations') IS NULL
     OR to_regclass('public.arcade_monthly_snapshots') IS NULL
     OR to_regclass('public.arcade_monthly_snapshot_entries') IS NULL
     OR to_regclass('public.arcade_monthly_snapshot_student_ranks') IS NULL
     OR to_regclass('public.arcade_prerelease_test_access') IS NULL THEN
    RAISE EXCEPTION '[TEST] required Guild/Arcade tables are missing; stop before creating a fixture.'
      USING ERRCODE = 'P0600';
  END IF;

  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.is_teacher_or_admin()') IS NULL THEN
    RAISE EXCEPTION '[TEST] required teacher identity helpers are missing; stop before creating a fixture.'
      USING ERRCODE = 'P0601';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Strong server-side marker and the five explicit fixture identities.
-- -----------------------------------------------------------------------------
CREATE TABLE public.test_classroom_fixtures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_code text NOT NULL UNIQUE
    CONSTRAINT test_classroom_fixtures_fixture_code_check
      CHECK (fixture_code = 'BRAND_TEST_V1'),
  classroom_id integer NOT NULL UNIQUE REFERENCES public.classrooms(id) ON DELETE RESTRICT,
  season_id integer NOT NULL UNIQUE REFERENCES public.guild_seasons(id) ON DELETE RESTRICT,
  guild_id integer NOT NULL UNIQUE REFERENCES public.guilds(id) ON DELETE RESTRICT,
  test_teacher_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_reset_at timestamptz,
  last_reset_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT test_classroom_fixtures_metadata_object_check
      CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE TABLE public.test_classroom_fixture_students (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_id bigint NOT NULL REFERENCES public.test_classroom_fixtures(id) ON DELETE RESTRICT,
  fixture_slot smallint NOT NULL CHECK (fixture_slot BETWEEN 1 AND 5),
  fixture_student_code text NOT NULL CHECK (fixture_student_code ~ '^TEST0[1-5]$'),
  student_id integer NOT NULL UNIQUE REFERENCES public.students(id) ON DELETE RESTRICT,
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT test_classroom_fixture_students_slot_unique UNIQUE (fixture_id, fixture_slot),
  CONSTRAINT test_classroom_fixture_students_code_unique UNIQUE (fixture_id, fixture_student_code)
);

CREATE INDEX test_classroom_fixture_students_student_idx
  ON public.test_classroom_fixture_students(student_id);

COMMENT ON TABLE public.test_classroom_fixtures IS
  'Dedicated, server-verified B.R.A.N.D TEST fixture marker. Reset functions must resolve this row; classroom name is never sufficient.';
COMMENT ON TABLE public.test_classroom_fixture_students IS
  'Five immutable fixture identity mappings. Auth accounts are created by the TEST fixture Edge Function, never by this SQL migration.';

ALTER TABLE public.test_classroom_fixtures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.test_classroom_fixture_students ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.test_classroom_fixtures FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.test_classroom_fixture_students FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Internal baseline membership helpers. They are intentionally not exposed
--    to browsers. Reconcile never removes history; reset explicitly recreates
--    only the five TEST baseline memberships after feature history is cleared.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.test_fixture_ensure_membership_baseline(
  p_fixture_id bigint,
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.test_classroom_fixtures%ROWTYPE;
  v_student record;
  v_active_membership public.guild_members%ROWTYPE;
  v_membership_id bigint;
  v_element_codes text[] := ARRAY['EARTH', 'WATER', 'FIRE', 'WIND', 'LIGHT'];
BEGIN
  SELECT * INTO v_fixture
  FROM public.test_classroom_fixtures
  WHERE id = p_fixture_id
    AND fixture_code = 'BRAND_TEST_V1'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[TEST] fixture registry validation failed.' USING ERRCODE = 'P0602';
  END IF;

  FOR v_student IN
    SELECT fixture_student.fixture_slot,
           fixture_student.fixture_student_code,
           fixture_student.student_id
    FROM public.test_classroom_fixture_students AS fixture_student
    WHERE fixture_student.fixture_id = v_fixture.id
    ORDER BY fixture_student.fixture_slot
  LOOP
    SELECT * INTO v_active_membership
    FROM public.guild_members AS membership
    WHERE membership.student_id = v_student.student_id
      AND membership.left_at IS NULL
    FOR UPDATE;

    IF FOUND AND (
      v_active_membership.guild_id IS DISTINCT FROM v_fixture.guild_id
      OR v_active_membership.season_id IS DISTINCT FROM v_fixture.season_id
    ) THEN
      RAISE EXCEPTION '[TEST] TEST student % has a different active guild membership. Run TEST reset before reconciling.', v_student.fixture_student_code
        USING ERRCODE = 'P0603';
    END IF;

    IF NOT FOUND THEN
      INSERT INTO public.guild_members (
        guild_id,
        student_id,
        season_id,
        element,
        note,
        changed_by_user_id
      )
      VALUES (
        v_fixture.guild_id,
        v_student.student_id,
        v_fixture.season_id,
        v_element_codes[v_student.fixture_slot]::public.guild_element,
        'BRAND_TEST_V1 fixture baseline',
        p_actor_user_id
      )
      RETURNING id INTO v_membership_id;

      INSERT INTO public.guild_membership_events (
        classroom_id,
        student_id,
        from_guild_id,
        to_guild_id,
        from_membership_id,
        to_membership_id,
        from_guild_name,
        to_guild_name,
        event_type,
        element_before,
        element_after,
        reason,
        effective_at,
        actor_user_id
      )
      SELECT
        v_fixture.classroom_id,
        v_student.student_id,
        NULL,
        v_fixture.guild_id,
        NULL,
        v_membership_id,
        NULL,
        guild_row.name,
        'ASSIGN',
        NULL,
        v_element_codes[v_student.fixture_slot],
        'BRAND_TEST_V1 fixture baseline',
        now(),
        p_actor_user_id
      FROM public.guilds AS guild_row
      WHERE guild_row.id = v_fixture.guild_id;
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public.test_classroom_fixture_students WHERE fixture_id = v_fixture.id) <> 5 THEN
    RAISE EXCEPTION '[TEST] fixture must contain exactly five mapped students.' USING ERRCODE = 'P0604';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.test_fixture_restore_membership_baseline(
  p_fixture_id bigint,
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.test_classroom_fixtures%ROWTYPE;
BEGIN
  SELECT * INTO v_fixture
  FROM public.test_classroom_fixtures
  WHERE id = p_fixture_id
    AND fixture_code = 'BRAND_TEST_V1'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[TEST] fixture registry validation failed.' USING ERRCODE = 'P0605';
  END IF;

  -- TEST fixture membership history is test-only activity. The intended five
  -- active baseline rows are re-created immediately below.
  DELETE FROM public.guild_membership_events
  WHERE classroom_id = v_fixture.classroom_id;

  DELETE FROM public.guild_members AS membership
  USING public.test_classroom_fixture_students AS fixture_student
  WHERE fixture_student.fixture_id = v_fixture.id
    AND membership.student_id = fixture_student.student_id;

  PERFORM public.test_fixture_ensure_membership_baseline(v_fixture.id, p_actor_user_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Service-role-only database reconciliation. Auth account creation happens
--    before this call in the paired Edge Function; this function only verifies
--    and links those already-existing auth UUIDs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.service_reconcile_test_classroom_fixture(
  p_manager_user_id uuid,
  p_test_teacher_user_id uuid,
  p_test_student_auth_user_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.test_classroom_fixtures%ROWTYPE;
  v_source_classroom_ids integer[];
  v_source_classroom_id integer;
  v_source_season public.guild_seasons%ROWTYPE;
  v_classroom_id integer;
  v_season_id integer;
  v_guild_id integer;
  v_student_id integer;
  v_existing_user_id uuid;
  v_slot smallint;
  v_student_code text;
  v_distinct_auth_count integer;
  v_created boolean := false;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION '[TEST] service-role fixture reconciliation only.' USING ERRCODE = 'P0606';
  END IF;

  IF p_manager_user_id IS NULL
     OR p_test_teacher_user_id IS NULL
     OR p_manager_user_id = p_test_teacher_user_id
     OR coalesce(cardinality(p_test_student_auth_user_ids), 0) <> 5 THEN
    RAISE EXCEPTION '[TEST] invalid fixture identity input.' USING ERRCODE = 'P0607';
  END IF;

  SELECT count(DISTINCT auth_id)
  INTO v_distinct_auth_count
  FROM unnest(p_test_student_auth_user_ids) AS supplied(auth_id);

  IF v_distinct_auth_count <> 5
     OR p_manager_user_id = ANY(p_test_student_auth_user_ids)
     OR p_test_teacher_user_id = ANY(p_test_student_auth_user_ids) THEN
    RAISE EXCEPTION '[TEST] fixture auth identities must be five distinct students and one separate teacher.'
      USING ERRCODE = 'P0608';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_test_teacher_user_id)
     OR EXISTS (
       SELECT 1
       FROM unnest(p_test_student_auth_user_ids) AS supplied(auth_id)
       LEFT JOIN auth.users AS auth_user ON auth_user.id = supplied.auth_id
       WHERE auth_user.id IS NULL
     ) THEN
    RAISE EXCEPTION '[TEST] one or more Auth accounts have not been created by the server.'
      USING ERRCODE = 'P0609';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.students AS student_row
    WHERE student_row.user_id = p_test_teacher_user_id
  ) THEN
    RAISE EXCEPTION '[TEST] TEST TEACHER must not have a student row.' USING ERRCODE = 'P0610';
  END IF;

  SELECT array_agg(manager_classroom.classroom_id ORDER BY manager_classroom.classroom_id)
  INTO v_source_classroom_ids
  FROM (
    SELECT student_row.classroom_id
    FROM public.students AS student_row
    WHERE student_row.user_id = p_manager_user_id
      AND student_row.transferred_at IS NULL
      AND student_row.role::text IN ('TEACHER', 'ADMIN')
    UNION
    SELECT classroom_row.id
    FROM public.classrooms AS classroom_row
    WHERE classroom_row.teacher_user_id = p_manager_user_id
      AND classroom_row.is_active = true
  ) AS manager_classroom;

  IF coalesce(cardinality(v_source_classroom_ids), 0) <> 1 THEN
    RAISE EXCEPTION '[TEST] fixture manager must resolve to exactly one active source classroom.'
      USING ERRCODE = 'P0611';
  END IF;
  v_source_classroom_id := v_source_classroom_ids[1];

  SELECT * INTO v_fixture
  FROM public.test_classroom_fixtures
  WHERE fixture_code = 'BRAND_TEST_V1'
  FOR UPDATE;

  IF FOUND THEN
    IF v_fixture.test_teacher_user_id IS DISTINCT FROM p_test_teacher_user_id THEN
      RAISE EXCEPTION '[TEST] existing fixture is tied to a different TEST TEACHER Auth account.'
        USING ERRCODE = 'P0612';
    END IF;

    SELECT classroom_row.id, fixture_season.id, fixture_guild.id
    INTO v_classroom_id, v_season_id, v_guild_id
    FROM public.classrooms AS classroom_row
    JOIN public.guild_seasons AS fixture_season ON fixture_season.id = v_fixture.season_id
    JOIN public.guilds AS fixture_guild ON fixture_guild.id = v_fixture.guild_id
    WHERE classroom_row.id = v_fixture.classroom_id
      AND classroom_row.name = 'B.R.A.N.D TEST'
      AND classroom_row.teacher_user_id = p_test_teacher_user_id
      AND classroom_row.is_active = true
      AND fixture_season.classroom_id = classroom_row.id
      AND fixture_guild.classroom_id = classroom_row.id
      AND fixture_guild.season_id = fixture_season.id
      AND fixture_guild.name = 'TEST GUILD';

    IF v_classroom_id IS NULL THEN
      RAISE EXCEPTION '[TEST] existing fixture registry is inconsistent; refusing to adopt or repair it automatically.'
        USING ERRCODE = 'P0613';
    END IF;
  ELSE
    IF EXISTS (SELECT 1 FROM public.classrooms WHERE name = 'B.R.A.N.D TEST') THEN
      RAISE EXCEPTION '[TEST] a B.R.A.N.D TEST named classroom exists without the fixture registry; refusing to adopt it.'
        USING ERRCODE = 'P0614';
    END IF;

    SELECT * INTO v_source_season
    FROM public.guild_seasons AS season_row
    WHERE season_row.classroom_id = v_source_classroom_id
      AND season_row.lifecycle_status = 'ACTIVE'
    ORDER BY season_row.starts_on DESC NULLS LAST, season_row.id DESC
    LIMIT 1;

    -- Older production data can have its legacy is_active flag populated while
    -- lifecycle_status was added later.  Reuse the same compatibility fallback
    -- as Guild 1 instead of inventing a TEST-only season timeline.
    IF NOT FOUND THEN
      SELECT * INTO v_source_season
      FROM public.guild_seasons AS season_row
      WHERE season_row.classroom_id = v_source_classroom_id
        AND season_row.is_active = true
      ORDER BY season_row.starts_on DESC NULLS LAST, season_row.id DESC
      LIMIT 1;
    END IF;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[TEST] the manager source classroom needs one active Guild season before fixture setup.'
        USING ERRCODE = 'P0615';
    END IF;

    INSERT INTO public.classrooms (
      name,
      school_id,
      teacher_user_id,
      school_year,
      grade_level,
      cover_image_url,
      is_active
    )
    SELECT
      'B.R.A.N.D TEST',
      source_classroom.school_id,
      p_test_teacher_user_id,
      source_classroom.school_year,
      source_classroom.grade_level,
      source_classroom.cover_image_url,
      true
    FROM public.classrooms AS source_classroom
    WHERE source_classroom.id = v_source_classroom_id
    RETURNING id INTO v_classroom_id;

    INSERT INTO public.guild_seasons (
      classroom_id,
      season_number,
      name,
      start_date,
      end_date,
      is_active,
      display_name,
      school_year,
      starts_on,
      ends_on,
      lifecycle_status,
      created_by_user_id
    )
    VALUES (
      v_classroom_id,
      v_source_season.season_number,
      'TEST — ' || v_source_season.name,
      v_source_season.start_date,
      v_source_season.end_date,
      true,
      'TEST — ' || coalesce(v_source_season.display_name, v_source_season.name),
      coalesce(v_source_season.school_year, (SELECT school_year FROM public.classrooms WHERE id = v_classroom_id)),
      coalesce(v_source_season.starts_on, v_source_season.start_date),
      coalesce(v_source_season.ends_on, v_source_season.end_date),
      'ACTIVE',
      p_manager_user_id
    )
    RETURNING id INTO v_season_id;

    INSERT INTO public.guilds (
      classroom_id,
      season_id,
      guild_uid,
      name,
      slogan,
      description,
      is_active
    )
    VALUES (
      v_classroom_id,
      v_season_id,
      'GUILD_TEST_V1',
      'TEST GUILD',
      '반복 테스트 전용 길드',
      'B.R.A.N.D TEST fixture baseline guild',
      true
    )
    RETURNING id INTO v_guild_id;

    INSERT INTO public.test_classroom_fixtures (
      fixture_code,
      classroom_id,
      season_id,
      guild_id,
      test_teacher_user_id,
      created_by_user_id,
      metadata
    )
    VALUES (
      'BRAND_TEST_V1',
      v_classroom_id,
      v_season_id,
      v_guild_id,
      p_test_teacher_user_id,
      p_manager_user_id,
      jsonb_build_object('classroom_name', 'B.R.A.N.D TEST', 'guild_name', 'TEST GUILD')
    )
    RETURNING * INTO v_fixture;

    v_created := true;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.classrooms AS other_classroom
    WHERE other_classroom.teacher_user_id = p_test_teacher_user_id
      AND other_classroom.is_active = true
      AND other_classroom.id <> v_fixture.classroom_id
  ) THEN
    RAISE EXCEPTION '[TEST] TEST TEACHER must own only the registered TEST classroom.'
      USING ERRCODE = 'P0622';
  END IF;

  FOR v_slot IN 1..5 LOOP
    v_student_code := 'TEST' || lpad(v_slot::text, 2, '0');

    SELECT student_row.id, student_row.user_id
    INTO v_student_id, v_existing_user_id
    FROM public.students AS student_row
    WHERE student_row.classroom_id = v_fixture.classroom_id
      AND student_row.name = v_student_code
    FOR UPDATE;

    IF NOT FOUND THEN
      INSERT INTO public.students (
        user_id,
        classroom_id,
        name,
        brand_name,
        role,
        note
      )
      VALUES (
        p_test_student_auth_user_ids[v_slot],
        v_fixture.classroom_id,
        v_student_code,
        v_student_code,
        'STUDENT'::public.student_role,
        'BRAND_TEST_V1 fixture student'
      )
      RETURNING id, user_id INTO v_student_id, v_existing_user_id;
    ELSIF v_existing_user_id IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.students AS other_student
        WHERE other_student.user_id = p_test_student_auth_user_ids[v_slot]
          AND other_student.id <> v_student_id
      ) THEN
        RAISE EXCEPTION '[TEST] a TEST student Auth account is already linked elsewhere.' USING ERRCODE = 'P0616';
      END IF;

      UPDATE public.students
      SET user_id = p_test_student_auth_user_ids[v_slot],
          updated_at = now()
      WHERE id = v_student_id;
      v_existing_user_id := p_test_student_auth_user_ids[v_slot];
    ELSIF v_existing_user_id IS DISTINCT FROM p_test_student_auth_user_ids[v_slot] THEN
      RAISE EXCEPTION '[TEST] existing % is linked to a different Auth account.', v_student_code
        USING ERRCODE = 'P0617';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.test_classroom_fixture_students AS mapped_student
      WHERE mapped_student.fixture_id = v_fixture.id
        AND mapped_student.fixture_slot = v_slot
        AND (
          mapped_student.student_id IS DISTINCT FROM v_student_id
          OR mapped_student.auth_user_id IS DISTINCT FROM p_test_student_auth_user_ids[v_slot]
        )
    ) THEN
      RAISE EXCEPTION '[TEST] existing fixture student mapping is inconsistent; refusing to relink it.'
        USING ERRCODE = 'P0618';
    END IF;

    INSERT INTO public.test_classroom_fixture_students (
      fixture_id,
      fixture_slot,
      fixture_student_code,
      student_id,
      auth_user_id
    )
    SELECT
      v_fixture.id,
      v_slot,
      v_student_code,
      v_student_id,
      p_test_student_auth_user_ids[v_slot]
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.test_classroom_fixture_students AS mapped_student
      WHERE mapped_student.fixture_id = v_fixture.id
        AND mapped_student.fixture_slot = v_slot
    );
  END LOOP;

  PERFORM public.test_fixture_ensure_membership_baseline(v_fixture.id, p_manager_user_id);

  RETURN jsonb_build_object(
    'status', CASE WHEN v_created THEN 'CREATED' ELSE 'RECONCILED' END,
    'fixture_code', v_fixture.fixture_code,
    'classroom_id', v_fixture.classroom_id,
    'classroom_name', 'B.R.A.N.D TEST',
    'season_id', v_fixture.season_id,
    'guild_id', v_fixture.guild_id,
    'guild_name', 'TEST GUILD',
    'test_student_count', 5
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. The only permitted exception to production immutable-history triggers.
--    These functions still reject every normal Guild 3/Arcade mutation. The
--    reset RPC below sets the context transaction-locally after resolving the
--    registry row; clients have no direct DELETE permission on these tables.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_block_finalized_period_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures AS fixture
    WHERE fixture.fixture_code = 'BRAND_TEST_V1'
      AND fixture.classroom_id = CASE
        WHEN coalesce(current_setting('brand.test_fixture_reset_classroom_id', true), '') ~ '^[0-9]+$'
          THEN current_setting('brand.test_fixture_reset_classroom_id', true)::integer
        ELSE NULL
      END
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF OLD.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE] finalized monthly/season period is immutable; use a future explicit correction flow.'
      USING ERRCODE = 'P0180';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_block_immutable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures AS fixture
    WHERE fixture.fixture_code = 'BRAND_TEST_V1'
      AND fixture.classroom_id = CASE
        WHEN coalesce(current_setting('brand.test_fixture_reset_classroom_id', true), '') ~ '^[0-9]+$'
          THEN current_setting('brand.test_fixture_reset_classroom_id', true)::integer
        ELSE NULL
      END
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION '[ARCADE] % history is append-only and immutable.', TG_TABLE_NAME
    USING ERRCODE = 'P0181';
END;
$$;

CREATE OR REPLACE FUNCTION public.guild3_block_immutable_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures AS fixture
    WHERE fixture.fixture_code = 'BRAND_TEST_V1'
      AND fixture.classroom_id = CASE
        WHEN coalesce(current_setting('brand.test_fixture_reset_classroom_id', true), '') ~ '^[0-9]+$'
          THEN current_setting('brand.test_fixture_reset_classroom_id', true)::integer
        ELSE NULL
      END
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  RAISE EXCEPTION '[G3] % is append-only mission history and cannot be changed or deleted.', TG_TABLE_NAME
    USING ERRCODE = 'P0301';
END;
$$;

CREATE OR REPLACE FUNCTION public.guild3_guard_mission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.test_classroom_fixtures AS fixture
    WHERE fixture.fixture_code = 'BRAND_TEST_V1'
      AND fixture.classroom_id = CASE
        WHEN coalesce(current_setting('brand.test_fixture_reset_classroom_id', true), '') ~ '^[0-9]+$'
          THEN current_setting('brand.test_fixture_reset_classroom_id', true)::integer
        ELSE NULL
      END
  ) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[G3] missions are historical records and cannot be deleted.' USING ERRCODE = 'P0302';
  END IF;

  IF OLD.lifecycle_state IN ('CANCELLED', 'VOIDED') THEN
    RAISE EXCEPTION '[G3] cancelled or voided mission is terminal and immutable.' USING ERRCODE = 'P0303';
  END IF;

  IF OLD.lifecycle_state = 'FINALIZED' AND NEW.lifecycle_state NOT IN ('FINALIZED', 'VOIDED') THEN
    RAISE EXCEPTION '[G3] finalized mission can change only through the explicit VOIDED correction flow.' USING ERRCODE = 'P0304';
  END IF;

  IF OLD.lifecycle_state <> 'DRAFT' AND (
    NEW.classroom_id IS DISTINCT FROM OLD.classroom_id
    OR NEW.season_id IS DISTINCT FROM OLD.season_id
    OR NEW.contribution_year_month IS DISTINCT FROM OLD.contribution_year_month
    OR NEW.weight IS DISTINCT FROM OLD.weight
    OR NEW.submission_scope IS DISTINCT FROM OLD.submission_scope
    OR NEW.submission_requirement IS DISTINCT FROM OLD.submission_requirement
    OR NEW.peer_review_required IS DISTINCT FROM OLD.peer_review_required
  ) THEN
    RAISE EXCEPTION '[G3] scoring-critical mission configuration is frozen after publication.' USING ERRCODE = 'P0305';
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Browser-callable teacher status and TEST-only reset. Neither function
--    accepts a classroom id. No real-classroom table can match this registry.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_test_classroom_fixture_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.test_classroom_fixtures%ROWTYPE;
  v_student_count integer;
  v_linked_student_count integer;
BEGIN
  PERFORM public.ensure_teacher_role();

  SELECT * INTO v_fixture
  FROM public.test_classroom_fixtures
  WHERE fixture_code = 'BRAND_TEST_V1';

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'fixture_exists', false,
      'fixture_code', 'BRAND_TEST_V1',
      'classroom_name', 'B.R.A.N.D TEST',
      'guild_name', 'TEST GUILD',
      'test_student_count', 0,
      'linked_student_count', 0
    );
  END IF;

  SELECT count(*), count(*) FILTER (WHERE student_row.user_id = fixture_student.auth_user_id)
  INTO v_student_count, v_linked_student_count
  FROM public.test_classroom_fixture_students AS fixture_student
  JOIN public.students AS student_row ON student_row.id = fixture_student.student_id
  WHERE fixture_student.fixture_id = v_fixture.id
    AND student_row.classroom_id = v_fixture.classroom_id
    AND student_row.transferred_at IS NULL;

  RETURN jsonb_build_object(
    'fixture_exists', true,
    'fixture_code', v_fixture.fixture_code,
    'classroom_id', v_fixture.classroom_id,
    'classroom_name', 'B.R.A.N.D TEST',
    'season_id', v_fixture.season_id,
    'guild_id', v_fixture.guild_id,
    'guild_name', 'TEST GUILD',
    'test_student_count', v_student_count,
    'linked_student_count', v_linked_student_count,
    'last_reset_at', v_fixture.last_reset_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_reset_test_classroom_fixture()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_fixture public.test_classroom_fixtures%ROWTYPE;
  v_deleted_count bigint;
  v_deleted jsonb := '{}'::jsonb;
  v_remaining_count bigint;
BEGIN
  PERFORM public.ensure_teacher_role();

  SELECT * INTO v_fixture
  FROM public.test_classroom_fixtures
  WHERE fixture_code = 'BRAND_TEST_V1'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[TEST] registered BRAND_TEST_V1 fixture not found; reset cannot target any classroom.'
      USING ERRCODE = 'P0619';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.classrooms AS classroom_row
    JOIN public.guild_seasons AS season_row ON season_row.id = v_fixture.season_id
    JOIN public.guilds AS guild_row ON guild_row.id = v_fixture.guild_id
    WHERE classroom_row.id = v_fixture.classroom_id
      AND classroom_row.name = 'B.R.A.N.D TEST'
      AND classroom_row.teacher_user_id = v_fixture.test_teacher_user_id
      AND classroom_row.is_active = true
      AND season_row.classroom_id = classroom_row.id
      AND guild_row.classroom_id = classroom_row.id
      AND guild_row.season_id = season_row.id
      AND guild_row.name = 'TEST GUILD'
  ) THEN
    RAISE EXCEPTION '[TEST] fixture registry/base records are inconsistent; reset aborted before any deletion.'
      USING ERRCODE = 'P0620';
  END IF;

  -- A transaction-local marker is checked by the four immutable-trigger
  -- functions above. It is never supplied by the browser.
  PERFORM set_config('brand.test_fixture_reset_classroom_id', v_fixture.classroom_id::text, true);

  -- Guild 3: leaf/audit evidence first, then instances and mission definitions.
  DELETE FROM public.guild3_peer_review_openings
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_peer_review_openings', v_deleted_count);

  DELETE FROM public.guild3_mission_audit_events
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_audit_events', v_deleted_count);

  DELETE FROM public.guild3_mission_judgment_events
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_judgment_events', v_deleted_count);

  DELETE FROM public.guild3_mission_grade_events AS grade_event
  USING public.guild3_missions AS mission
  WHERE grade_event.mission_id = mission.id
    AND mission.classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_grade_events', v_deleted_count);

  DELETE FROM public.guild3_mission_activity_records
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_activity_records', v_deleted_count);

  DELETE FROM public.guild3_mission_submissions
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_submissions', v_deleted_count);

  DELETE FROM public.guild3_mission_participants
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_participants', v_deleted_count);

  DELETE FROM public.guild3_mission_instances
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_mission_instances', v_deleted_count);

  DELETE FROM public.guild3_missions
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild3_missions', v_deleted_count);

  -- Arcade: immutable final evidence must be removed from leaves to period.
  DELETE FROM public.arcade_monthly_snapshot_student_ranks
  WHERE snapshot_id IN (
    SELECT snapshot.id
    FROM public.arcade_monthly_snapshots AS snapshot
    WHERE snapshot.classroom_id = v_fixture.classroom_id
  );
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_monthly_snapshot_student_ranks', v_deleted_count);

  DELETE FROM public.arcade_monthly_snapshot_entries
  WHERE snapshot_id IN (
    SELECT snapshot.id
    FROM public.arcade_monthly_snapshots AS snapshot
    WHERE snapshot.classroom_id = v_fixture.classroom_id
  );
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_monthly_snapshot_entries', v_deleted_count);

  DELETE FROM public.arcade_monthly_snapshots
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_monthly_snapshots', v_deleted_count);

  DELETE FROM public.arcade_monthly_finalizations
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_monthly_finalizations', v_deleted_count);

  DELETE FROM public.arcade_run_moderation_events
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_run_moderation_events', v_deleted_count);

  DELETE FROM public.arcade_run_submissions
  WHERE run_id IN (
    SELECT run.id FROM public.arcade_runs AS run WHERE run.classroom_id = v_fixture.classroom_id
  );
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_run_submissions', v_deleted_count);

  DELETE FROM public.arcade_runs
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_runs', v_deleted_count);

  DELETE FROM public.arcade_prerelease_test_access
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_prerelease_test_access', v_deleted_count);

  DELETE FROM public.arcade_ranking_periods
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('arcade_ranking_periods', v_deleted_count);

  -- Guild 2: all are classroom-scoped draft/cache/ledger evidence for TEST.
  DELETE FROM public.guild2_individual_contributions
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild2_individual_contributions', v_deleted_count);

  DELETE FROM public.guild2_monthly_gs_summaries
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild2_monthly_gs_summaries', v_deleted_count);

  DELETE FROM public.guild2_compensation_configs
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild2_compensation_configs', v_deleted_count);

  DELETE FROM public.guild2_observation_events
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild2_observation_events', v_deleted_count);

  DELETE FROM public.guild2_gs_events
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild2_gs_events', v_deleted_count);

  -- Guild 1 current session runtime only. Legacy Guild 1 tables are not
  -- touched: current app flows no longer write them and their historical
  -- compatibility contract remains intact.
  DELETE FROM public.guild_session_participants
  WHERE session_id IN (
    SELECT session_row.id
    FROM public.guild_sessions AS session_row
    WHERE session_row.classroom_id = v_fixture.classroom_id
  );
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild_session_participants', v_deleted_count);

  DELETE FROM public.guild_sessions
  WHERE classroom_id = v_fixture.classroom_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  v_deleted := v_deleted || jsonb_build_object('guild_sessions', v_deleted_count);

  -- Re-create the five active TEST GUILD assignments after every activity and
  -- score record that could reference them has been cleared.
  PERFORM public.test_fixture_restore_membership_baseline(v_fixture.id, auth.uid());

  SELECT
    (SELECT count(*) FROM public.guild3_missions WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild3_mission_instances WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild3_mission_participants WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild3_mission_submissions WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild3_mission_activity_records WHERE classroom_id = v_fixture.classroom_id)
    + (
      SELECT count(*)
      FROM public.guild3_mission_grade_events AS grade_event
      JOIN public.guild3_missions AS mission ON mission.id = grade_event.mission_id
      WHERE mission.classroom_id = v_fixture.classroom_id
    )
    + (SELECT count(*) FROM public.guild3_mission_judgment_events WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild3_mission_audit_events WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild3_peer_review_openings WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.arcade_ranking_periods WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.arcade_runs WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.arcade_run_moderation_events WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.arcade_monthly_finalizations WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.arcade_monthly_snapshots WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.arcade_prerelease_test_access WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild2_observation_events WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild2_compensation_configs WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild2_individual_contributions WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild2_gs_events WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild2_monthly_gs_summaries WHERE classroom_id = v_fixture.classroom_id)
    + (SELECT count(*) FROM public.guild_sessions WHERE classroom_id = v_fixture.classroom_id)
  INTO v_remaining_count;

  IF v_remaining_count <> 0 THEN
    RAISE EXCEPTION '[TEST] reset verification found % leftover activity rows; transaction rolled back.', v_remaining_count
      USING ERRCODE = 'P0621';
  END IF;

  UPDATE public.test_classroom_fixtures
  SET updated_at = now(),
      last_reset_at = now(),
      last_reset_by_user_id = auth.uid()
  WHERE id = v_fixture.id;

  RETURN jsonb_build_object(
    'status', 'RESET_COMPLETE',
    'fixture_code', v_fixture.fixture_code,
    'classroom_id', v_fixture.classroom_id,
    'deleted_row_counts', v_deleted,
    'verification', jsonb_build_object(
      'remaining_activity_rows', v_remaining_count,
      'baseline_test_students', 5,
      'baseline_guild_name', 'TEST GUILD'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.test_fixture_ensure_membership_baseline(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.test_fixture_restore_membership_baseline(bigint, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_reconcile_test_classroom_fixture(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_get_test_classroom_fixture_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_reset_test_classroom_fixture() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.service_reconcile_test_classroom_fixture(uuid, uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_test_classroom_fixture_status() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.teacher_reset_test_classroom_fixture() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- -----------------------------------------------------------------------------
-- SQL Editor-safe structural postcheck: one result only, no auth-dependent RPC.
-- -----------------------------------------------------------------------------
SELECT jsonb_build_object(
  'fixture_registry_tables_ready', (
    SELECT count(*) = 2
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN ('test_classroom_fixtures', 'test_classroom_fixture_students')
  ),
  'fixture_functions', coalesce((
    SELECT jsonb_agg(
      jsonb_build_object(
        'function_name', procedure_data.proname,
        'identity_arguments', pg_get_function_identity_arguments(procedure_data.oid),
        'security_definer', procedure_data.prosecdef,
        'function_config', procedure_data.proconfig
      )
      ORDER BY procedure_data.proname
    )
    FROM pg_proc AS procedure_data
    JOIN pg_namespace AS namespace ON namespace.oid = procedure_data.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure_data.proname IN (
        'service_reconcile_test_classroom_fixture',
        'teacher_get_test_classroom_fixture_status',
        'teacher_reset_test_classroom_fixture'
      )
  ), '[]'::jsonb),
  'authenticated_reset_execute_granted', has_function_privilege(
    'authenticated',
    'public.teacher_reset_test_classroom_fixture()',
    'EXECUTE'
  ),
  'authenticated_service_reconcile_execute_denied', NOT has_function_privilege(
    'authenticated',
    'public.service_reconcile_test_classroom_fixture(uuid, uuid, uuid[])',
    'EXECUTE'
  ),
  'fixture_rows_created_by_migration', (SELECT count(*) FROM public.test_classroom_fixtures)
) AS test_classroom_fixture_postcheck;
