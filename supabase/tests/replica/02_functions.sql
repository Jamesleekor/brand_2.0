SET check_function_bodies = off;
-- source: brand_2.0/supabase/migrations/20260815_04_test_classroom_fixture.sql (CRLF) [prod md5 match]
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

-- source: brand_2.0/supabase/migrations/20260815_04_test_classroom_fixture.sql (CRLF) [prod md5 match]
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

-- source: brand_2.0/supabase/migrations/20260814_02_arcade_game01_server_validation.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_focus_reaction_01_schedule(
  p_seed bigint,
  p_until_ms integer,
  p_config jsonb
)
RETURNS TABLE(
  signal_index integer,
  spawn_ms integer,
  target_ms integer,
  lane integer,
  signal_kind text,
  travel_ms integer,
  hit_window_ms integer
)
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint := p_seed;
  v_spawn_ms integer := 0;
  v_signal_index integer := 0;
  v_tier text;
  v_tier_config jsonb;
  v_extreme_config jsonb;
  v_overdrive jsonb;
  v_steps integer := 0;
  v_spawn_min integer;
  v_spawn_max integer;
  v_travel integer;
  v_hit_window integer;
  v_no_go_rate integer;
  v_burst_chance integer;
  v_burst_min_length integer;
  v_burst_max_length integer;
  v_burst_min_interval integer;
  v_burst_max_interval integer;
  v_interval integer;
  v_target integer;
  v_lane integer;
  v_last_lane integer := -1;
  v_same_lane_count integer := 0;
  v_kind text;
  v_burst_length integer;
  v_burst_number integer;
  v_loop_step integer;
BEGIN
  IF p_seed NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[ARCADE] schedule seed is invalid.' USING ERRCODE = 'P0191';
  END IF;
  IF p_until_ms NOT BETWEEN 0 AND 3600000 OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION '[ARCADE] schedule arguments are invalid.' USING ERRCODE = 'P0192';
  END IF;

  v_overdrive := p_config -> 'overdrive';
  IF jsonb_typeof(v_overdrive) <> 'object' THEN
    RAISE EXCEPTION '[ARCADE] focus_reaction_01 rule configuration is missing overdrive values.' USING ERRCODE = 'P0193';
  END IF;

  LOOP
    IF v_spawn_ms < 60000 THEN
      v_tier := 'EASY';
    ELSIF v_spawn_ms < 120000 THEN
      v_tier := 'NORMAL';
    ELSIF v_spawn_ms < 180000 THEN
      v_tier := 'HARD';
    ELSIF v_spawn_ms < 240000 THEN
      v_tier := 'VERY_HARD';
    ELSIF v_spawn_ms < 300000 THEN
      v_tier := 'EXTREME';
    ELSE
      v_tier := 'OVERDRIVE';
    END IF;

    IF v_tier = 'OVERDRIVE' THEN
      v_extreme_config := p_config #> '{tiers,EXTREME}';
      v_steps := greatest(0, (v_spawn_ms - (v_overdrive ->> 'starts_at_ms')::integer)
        / (v_overdrive ->> 'step_ms')::integer);
      v_spawn_min := (v_extreme_config ->> 'spawn_min_ms')::integer;
      v_spawn_max := (v_extreme_config ->> 'spawn_max_ms')::integer;
      FOR v_loop_step IN 1..v_steps LOOP
        v_spawn_min := greatest((v_overdrive ->> 'spawn_min_floor_ms')::integer,
          (v_spawn_min * (v_overdrive ->> 'spawn_interval_multiplier_percent')::integer) / 100);
        v_spawn_max := greatest((v_overdrive ->> 'spawn_max_floor_ms')::integer,
          (v_spawn_max * (v_overdrive ->> 'spawn_interval_multiplier_percent')::integer) / 100);
      END LOOP;
      v_travel := greatest((v_overdrive ->> 'travel_floor_ms')::integer,
        (v_extreme_config ->> 'travel_ms')::integer + v_steps * (v_overdrive ->> 'travel_delta_ms')::integer);
      v_hit_window := greatest((v_overdrive ->> 'hit_window_floor_ms')::integer,
        (v_extreme_config ->> 'hit_window_ms')::integer + v_steps * (v_overdrive ->> 'hit_window_delta_ms')::integer);
      v_no_go_rate := least((v_overdrive ->> 'no_go_cap_bp')::integer,
        (v_extreme_config ->> 'no_go_rate_bp')::integer + v_steps * (v_overdrive ->> 'no_go_delta_bp')::integer);
      v_burst_chance := least((v_overdrive ->> 'burst_chance_cap_bp')::integer,
        (v_extreme_config ->> 'burst_chance_bp')::integer + v_steps * (v_overdrive ->> 'burst_chance_delta_bp')::integer);
      v_burst_min_length := (v_extreme_config ->> 'burst_min_length')::integer;
      v_burst_max_length := (v_extreme_config ->> 'burst_max_length')::integer;
      v_burst_min_interval := greatest((v_overdrive ->> 'burst_interval_floor_ms')::integer,
        (v_extreme_config ->> 'burst_min_interval_ms')::integer + v_steps * (v_overdrive ->> 'burst_interval_delta_ms')::integer);
      v_burst_max_interval := greatest(v_burst_min_interval,
        (v_extreme_config ->> 'burst_max_interval_ms')::integer + v_steps * (v_overdrive ->> 'burst_interval_delta_ms')::integer);
    ELSE
      v_tier_config := p_config #> ARRAY['tiers', v_tier];
      IF jsonb_typeof(v_tier_config) <> 'object' THEN
        RAISE EXCEPTION '[ARCADE] focus_reaction_01 rule configuration is missing tier %.', v_tier USING ERRCODE = 'P0193';
      END IF;
      v_spawn_min := (v_tier_config ->> 'spawn_min_ms')::integer;
      v_spawn_max := (v_tier_config ->> 'spawn_max_ms')::integer;
      v_travel := (v_tier_config ->> 'travel_ms')::integer;
      v_hit_window := (v_tier_config ->> 'hit_window_ms')::integer;
      v_no_go_rate := (v_tier_config ->> 'no_go_rate_bp')::integer;
      v_burst_chance := (v_tier_config ->> 'burst_chance_bp')::integer;
      v_burst_min_length := (v_tier_config ->> 'burst_min_length')::integer;
      v_burst_max_length := (v_tier_config ->> 'burst_max_length')::integer;
      v_burst_min_interval := (v_tier_config ->> 'burst_min_interval_ms')::integer;
      v_burst_max_interval := (v_tier_config ->> 'burst_max_interval_ms')::integer;
    END IF;

    IF v_spawn_min <= 0 OR v_spawn_max < v_spawn_min OR v_travel <= 0 OR v_hit_window <= 0
       OR v_no_go_rate NOT BETWEEN 0 AND 10000 OR v_burst_chance NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION '[ARCADE] focus_reaction_01 rule configuration is invalid.' USING ERRCODE = 'P0193';
    END IF;

    v_state := public.arcade_xorshift32_next(v_state);
    v_interval := v_spawn_min + (v_state % (v_spawn_max - v_spawn_min + 1))::integer;
    v_spawn_ms := v_spawn_ms + v_interval;
    v_target := v_spawn_ms + v_travel;
    EXIT WHEN v_target > p_until_ms;

    v_state := public.arcade_xorshift32_next(v_state);
    v_lane := (v_state % 4)::integer;
    IF v_lane = v_last_lane AND v_same_lane_count >= 2 THEN
      v_state := public.arcade_xorshift32_next(v_state);
      v_lane := (v_last_lane + 1 + (v_state % 3)::integer) % 4;
    END IF;
    IF v_lane = v_last_lane THEN
      v_same_lane_count := v_same_lane_count + 1;
    ELSE
      v_last_lane := v_lane;
      v_same_lane_count := 1;
    END IF;

    v_state := public.arcade_xorshift32_next(v_state);
    v_kind := CASE WHEN (v_state % 10000)::integer < v_no_go_rate THEN 'NO_GO' ELSE 'GO' END;
    v_signal_index := v_signal_index + 1;
    signal_index := v_signal_index;
    spawn_ms := v_spawn_ms;
    target_ms := v_target;
    lane := v_lane;
    signal_kind := v_kind;
    travel_ms := v_travel;
    hit_window_ms := v_hit_window;
    RETURN NEXT;

    IF v_tier <> 'EASY' AND v_burst_chance > 0 THEN
      v_state := public.arcade_xorshift32_next(v_state);
      IF (v_state % 10000)::integer < v_burst_chance THEN
        v_state := public.arcade_xorshift32_next(v_state);
        v_burst_length := v_burst_min_length
          + (v_state % (v_burst_max_length - v_burst_min_length + 1))::integer;
        FOR v_burst_number IN 1..v_burst_length LOOP
          v_state := public.arcade_xorshift32_next(v_state);
          v_interval := v_burst_min_interval
            + (v_state % (v_burst_max_interval - v_burst_min_interval + 1))::integer;
          v_spawn_ms := v_spawn_ms + v_interval;
          v_target := v_spawn_ms + v_travel;
          EXIT WHEN v_target > p_until_ms;

          v_state := public.arcade_xorshift32_next(v_state);
          v_lane := (v_state % 4)::integer;
          IF v_lane = v_last_lane AND v_same_lane_count >= 2 THEN
            v_state := public.arcade_xorshift32_next(v_state);
            v_lane := (v_last_lane + 1 + (v_state % 3)::integer) % 4;
          END IF;
          IF v_lane = v_last_lane THEN
            v_same_lane_count := v_same_lane_count + 1;
          ELSE
            v_last_lane := v_lane;
            v_same_lane_count := 1;
          END IF;

          v_signal_index := v_signal_index + 1;
          signal_index := v_signal_index;
          spawn_ms := v_spawn_ms;
          target_ms := v_target;
          lane := v_lane;
          signal_kind := 'GO';
          travel_ms := v_travel;
          hit_window_ms := v_hit_window;
          RETURN NEXT;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_07_arcade_pgcrypto_schema_resolution.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_generate_run_seed()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pgcrypto_schema text;
  v_seed_bytes bytea;
  v_seed bigint;
BEGIN
  v_pgcrypto_schema := public.arcade_pgcrypto_schema();
  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION '[ARCADE] pgcrypto extension schema is missing.' USING ERRCODE = 'P0225';
  END IF;

  EXECUTE format('SELECT %I.gen_random_bytes($1)', v_pgcrypto_schema)
    INTO v_seed_bytes
    USING 4;
  v_seed := get_byte(v_seed_bytes, 0)::bigint * 16777216
    + get_byte(v_seed_bytes, 1)::bigint * 65536
    + get_byte(v_seed_bytes, 2)::bigint * 256
    + get_byte(v_seed_bytes, 3)::bigint;

  RETURN greatest(v_seed, 1);
END;
$$;

-- source: brand_2.0/supabase/migrations/20261002_02_arcade_game_verification_force_close.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_guard_closed_verification_official_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period_id bigint;
  v_game_id bigint;
BEGIN
  v_period_id := CASE WHEN TG_OP='DELETE' THEN OLD.period_id ELSE NEW.period_id END;
  v_game_id := CASE WHEN TG_OP='DELETE' THEN OLD.game_id ELSE NEW.game_id END;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id=v_period_id
      AND pg.game_id=v_game_id
      AND pg.verification_closed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this game verification is already closed.'
      USING ERRCODE='P0277';
  END IF;

  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- source: brand_2.0/supabase/migrations/20261002_02_arcade_game_verification_force_close.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_guard_closed_verification_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status='ACTIVE'
     AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'ACTIVE')
     AND EXISTS (
       SELECT 1
       FROM public.arcade_verification_period_games pg
       WHERE pg.period_id=NEW.period_id
         AND pg.game_id=NEW.game_id
         AND pg.verification_closed_at IS NOT NULL
     )
  THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this game verification is already closed.'
      USING ERRCODE='P0277';
  END IF;
  RETURN NEW;
END;
$function$;

-- source: brand_2.0/supabase/migrations/20260814_03_arcade_monthly_finalization_guild2_adapter.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_monthly_finalization_is_complete(
  p_classroom_id integer,
  p_year_month text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.arcade_monthly_finalizations finalization
    JOIN public.arcade_ranking_periods period ON period.id = finalization.period_id
    WHERE finalization.classroom_id = p_classroom_id
      AND finalization.contribution_year_month = p_year_month
      AND period.classroom_id = p_classroom_id
      AND period.period_kind = 'MONTHLY'
      AND finalization.eligible_game_count = (
        SELECT count(*)
        FROM public.arcade_monthly_snapshots snapshot
        WHERE snapshot.finalization_id = finalization.id
      )
  );
$$;

-- source: brand_2.0/supabase/migrations/20260814_07_arcade_pgcrypto_schema_resolution.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_pgcrypto_schema()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT namespace.nspname
  FROM pg_catalog.pg_extension extension
  JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
  WHERE extension.extname = 'pgcrypto';
$$;

-- source: brand_2.0/supabase/APPLY_ARCADE_PURE_REACTION_02.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_pure_reaction_02_waits(p_seed bigint,p_config jsonb)
RETURNS TABLE(trial_index integer,wait_ms integer)
LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=public,pg_temp
AS $$
DECLARE
  v_state bigint:=p_seed;
  v_min integer;
  v_max integer;
  v_count integer;
  v_i integer;
BEGIN
  IF p_seed NOT BETWEEN 1 AND 4294967295 OR jsonb_typeof(p_config)<>'object' THEN
    RAISE EXCEPTION '[ARCADE GAME02] invalid wait generator arguments.' USING ERRCODE='P0192';
  END IF;
  v_min:=(p_config->>'waitMinMs')::integer;
  v_max:=(p_config->>'waitMaxMs')::integer;
  v_count:=(p_config->>'trialCount')::integer;
  IF v_min<>1500 OR v_max<>4500 OR v_count<>5 THEN
    RAISE EXCEPTION '[ARCADE GAME02] v0.1 wait configuration mismatch.' USING ERRCODE='P0193';
  END IF;
  FOR v_i IN 0..v_count-1 LOOP
    v_state:=public.arcade_xorshift32_next(v_state);
    trial_index:=v_i;
    wait_ms:=v_min+(v_state % (v_max-v_min+1))::integer;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- source: brand_2.0/supabase/migrations/20261001002900_arcade_verification_all_students.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_student_ranks(
  p_classroom_id integer,
  p_period_id bigint,
  p_game_id bigint
)
RETURNS TABLE(
  source_run_id bigint,
  student_id integer,
  official_score bigint,
  achieved_at timestamptz,
  rank integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_snapshot_id bigint;
BEGIN
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
    AND classroom_id = p_classroom_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status = 'FINALIZED' THEN
    SELECT s.id INTO v_snapshot_id
    FROM public.arcade_monthly_snapshots s
    WHERE s.period_id = v_period.id
      AND s.game_id = p_game_id;
    IF v_snapshot_id IS NULL THEN
      RAISE EXCEPTION '[ARCADE] finalized monthly snapshot is missing for this period/game; data integrity error.'
        USING ERRCODE = 'P0220';
    END IF;

    RETURN QUERY
    SELECT r.source_run_id, r.student_id, r.official_score, r.achieved_at, r.rank
    FROM public.arcade_monthly_snapshot_student_ranks r
    WHERE r.snapshot_id = v_snapshot_id
      AND public.is_official_participant(r.student_id)
    ORDER BY r.rank;
    RETURN;
  END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RETURN QUERY
    WITH candidates AS (
      SELECT
        COALESCE(o.source_run_id, p.source_run_id) AS source_run_id,
        COALESCE(o.student_id, p.student_id) AS student_id,
        COALESCE(o.official_score, p.official_score) AS official_score,
        COALESCE(o.achieved_at, p.achieved_at) AS achieved_at,
        COALESCE(o.ranking_eligible, true) AS ranking_eligible
      FROM public.arcade_verification_provisional_entries p
      FULL OUTER JOIN public.arcade_verification_official_results o
        ON o.period_id = p.period_id
       AND o.game_id = p.game_id
       AND o.student_id = p.student_id
      WHERE COALESCE(o.classroom_id, p.classroom_id) = p_classroom_id
        AND COALESCE(o.period_id, p.period_id) = p_period_id
        AND COALESCE(o.game_id, p.game_id) = p_game_id
        AND public.is_official_participant(COALESCE(o.student_id, p.student_id))
    ), ranked AS (
      SELECT c.source_run_id,
             c.student_id,
             c.official_score,
             c.achieved_at,
             row_number() OVER (
               ORDER BY c.official_score DESC, c.achieved_at ASC, c.source_run_id ASC
             )::integer AS rank
      FROM candidates c
      WHERE c.ranking_eligible
        AND c.source_run_id IS NOT NULL
        AND c.official_score IS NOT NULL
    )
    SELECT r.source_run_id, r.student_id, r.official_score, r.achieved_at, r.rank
    FROM ranked r
    ORDER BY r.rank;
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidate_runs AS (
    SELECT r.id AS source_run_id,
           r.student_id,
           r.official_score,
           r.game_over_at,
           row_number() OVER (
             PARTITION BY r.student_id
             ORDER BY r.official_score DESC, r.game_over_at ASC, r.id ASC
           ) AS student_best_row
    FROM public.arcade_runs r
    WHERE r.classroom_id = p_classroom_id
      AND r.game_id = p_game_id
      AND r.run_context = 'STANDARD'
      AND r.status = 'VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id = r.id AND m.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT c.source_run_id,
           c.student_id,
           c.official_score,
           c.game_over_at,
           row_number() OVER (
             ORDER BY c.official_score DESC, c.game_over_at ASC, c.source_run_id ASC
           )::integer AS rank
    FROM candidate_runs c
    WHERE c.student_best_row = 1
  )
  SELECT r.source_run_id, r.student_id, r.official_score, r.game_over_at, r.rank
  FROM ranked r
  ORDER BY r.rank;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_top10(
  p_classroom_id integer,
  p_period_id bigint,
  p_game_id bigint
)
RETURNS TABLE(
  source_run_id bigint,
  student_id integer,
  official_score bigint,
  achieved_at timestamptz,
  rank integer,
  raw_bonus numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT r.source_run_id,
         r.student_id,
         r.official_score,
         r.achieved_at,
         r.rank,
         CASE
           WHEN r.rank = 1 THEN 30::numeric
           WHEN r.rank = 2 THEN 27::numeric
           WHEN r.rank = 3 THEN 24::numeric
           WHEN r.rank BETWEEN 4 AND 6 THEN 18::numeric
           WHEN r.rank BETWEEN 7 AND 10 THEN 15::numeric
         END AS raw_bonus
  FROM public.arcade_resolve_period_student_ranks(p_classroom_id,p_period_id,p_game_id) r
  WHERE r.rank <= 10
  ORDER BY r.rank;
$$;

-- source: brand_2.0/supabase/migrations/20260814_01_arcade_foundation.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_07_arcade_pgcrypto_schema_resolution.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_sha256_hex(p_payload text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pgcrypto_schema text;
  v_hash text;
BEGIN
  v_pgcrypto_schema := public.arcade_pgcrypto_schema();
  IF v_pgcrypto_schema IS NULL THEN
    RAISE EXCEPTION '[ARCADE] pgcrypto extension schema is missing.' USING ERRCODE = 'P0225';
  END IF;

  EXECUTE format('SELECT encode(%I.digest($1, $2), ''hex'')', v_pgcrypto_schema)
    INTO v_hash
    USING p_payload, 'sha256';
  RETURN v_hash;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_10_arcade_game01_no_go_pass_validation_fix.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_validate_focus_reaction_01_submission(
  p_seed bigint,
  p_config jsonb,
  p_input_events jsonb,
  p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_input record;
  v_signal record;
  v_key text;
  v_times integer[] := ARRAY[]::integer[];
  v_lanes integer[] := ARRAY[]::integer[];
  v_event_count integer := 0;
  v_previous_time integer := -1;
  v_time_text text;
  v_lane_text text;
  v_input_index integer := 1;
  v_lives integer;
  v_combo integer := 0;
  v_max_combo integer := 0;
  v_score bigint := 0;
  v_correct integer := 0;
  v_misses integer := 0;
  v_no_go_errors integer := 0;
  v_wrong_lane_errors integer := 0;
  v_recovery_until integer := -1;
  v_loss_time integer;
  v_game_over_ms integer := NULL;
  v_window_start integer;
  v_window_end integer;
  v_error_ms integer;
  v_base_points integer;
  v_multiplier_percent integer;
  v_accuracy_percent numeric(8,2);
  v_max_events integer;
  v_max_elapsed integer;
  v_end_tolerance integer;
  v_schedule_until_ms integer;
BEGIN
  IF jsonb_typeof(p_input_events) <> 'array' THEN
    RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENTS_NOT_ARRAY', 'message', '입력 기록 형식이 올바르지 않습니다.');
  END IF;
  IF jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION '[ARCADE] rule configuration is invalid.' USING ERRCODE = 'P0194';
  END IF;

  v_max_events := coalesce((p_config ->> 'max_input_events')::integer, 20000);
  v_max_elapsed := coalesce((p_config ->> 'max_client_elapsed_ms')::integer, 3600000);
  v_end_tolerance := coalesce((p_config ->> 'client_end_tolerance_ms')::integer, 2000);
  v_lives := coalesce((p_config ->> 'lives')::integer, 3);

  IF p_client_game_over_elapsed_ms NOT BETWEEN 0 AND v_max_elapsed THEN
    RETURN jsonb_build_object('valid', false, 'code', 'ELAPSED_OUT_OF_RANGE', 'message', '게임 시간 기록이 허용 범위를 벗어났습니다.');
  END IF;

  FOR v_input IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_input_events) WITH ORDINALITY
  LOOP
    v_event_count := v_event_count + 1;
    IF v_event_count > v_max_events OR jsonb_typeof(v_input.value) <> 'object' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_INVALID', 'message', '입력 기록이 너무 많거나 형식이 올바르지 않습니다.');
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_input.value) LOOP
      IF v_key NOT IN ('elapsed_ms', 'lane') THEN
        RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_EXTRA_FIELD', 'message', '허용되지 않은 입력 기록 항목이 있습니다.');
      END IF;
    END LOOP;
    IF NOT (v_input.value ? 'elapsed_ms') OR NOT (v_input.value ? 'lane')
       OR jsonb_typeof(v_input.value -> 'elapsed_ms') <> 'number'
       OR jsonb_typeof(v_input.value -> 'lane') <> 'number' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_SHAPE', 'message', '입력 기록에 시간 또는 레인이 없습니다.');
    END IF;
    v_time_text := v_input.value ->> 'elapsed_ms';
    v_lane_text := v_input.value ->> 'lane';
    IF v_time_text !~ '^[0-9]+$' OR char_length(v_time_text) > 7
       OR v_lane_text !~ '^[0-3]$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_VALUE', 'message', '입력 시간 또는 레인 값이 올바르지 않습니다.');
    END IF;
    IF v_time_text::integer <= v_previous_time OR v_time_text::integer > p_client_game_over_elapsed_ms THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_ORDER', 'message', '입력 시간 순서가 올바르지 않습니다.');
    END IF;
    v_previous_time := v_time_text::integer;
    v_times := array_append(v_times, v_previous_time);
    v_lanes := array_append(v_lanes, v_lane_text::integer);
  END LOOP;

  v_schedule_until_ms := least(v_max_elapsed, p_client_game_over_elapsed_ms + 6000);

  FOR v_signal IN
    SELECT *
    FROM public.arcade_focus_reaction_01_schedule(p_seed, v_schedule_until_ms, p_config)
    ORDER BY signal_index
  LOOP
    EXIT WHEN v_lives <= 0;

    WHILE v_input_index <= v_event_count AND v_times[v_input_index] <= v_recovery_until LOOP
      v_input_index := v_input_index + 1;
    END LOOP;
    IF v_signal.target_ms <= v_recovery_until THEN
      CONTINUE;
    END IF;

    v_window_start := v_signal.target_ms - v_signal.hit_window_ms;
    v_window_end := v_signal.target_ms + v_signal.hit_window_ms;

    IF v_input_index <= v_event_count AND v_times[v_input_index] < v_window_start THEN
      v_loss_time := v_times[v_input_index];
      v_input_index := v_input_index + 1;
      v_lives := v_lives - 1;
      v_combo := 0;
      v_wrong_lane_errors := v_wrong_lane_errors + 1;
      v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
      IF v_lives <= 0 THEN
        v_game_over_ms := v_loss_time;
      END IF;
      CONTINUE;
    END IF;

    IF v_input_index <= v_event_count AND v_times[v_input_index] <= v_window_end THEN
      v_loss_time := v_times[v_input_index];
      IF v_signal.signal_kind = 'NO_GO' THEN
        v_input_index := v_input_index + 1;
        v_lives := v_lives - 1;
        v_combo := 0;
        v_no_go_errors := v_no_go_errors + 1;
        v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
        IF v_lives <= 0 THEN
          v_game_over_ms := v_loss_time;
        END IF;
        CONTINUE;
      END IF;

      IF v_lanes[v_input_index] <> v_signal.lane OR v_times[v_input_index] < v_window_start THEN
        v_input_index := v_input_index + 1;
        v_lives := v_lives - 1;
        v_combo := 0;
        v_wrong_lane_errors := v_wrong_lane_errors + 1;
        v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
        IF v_lives <= 0 THEN
          v_game_over_ms := v_loss_time;
        END IF;
        CONTINUE;
      END IF;

      v_error_ms := abs(v_times[v_input_index] - v_signal.target_ms);
      v_input_index := v_input_index + 1;
      v_combo := v_combo + 1;
      v_max_combo := greatest(v_max_combo, v_combo);
      v_base_points := 200 - floor((100::numeric * v_error_ms) / v_signal.hit_window_ms)::integer;
      v_multiplier_percent := CASE
        WHEN v_combo >= 100 THEN 140
        WHEN v_combo >= 50 THEN 130
        WHEN v_combo >= 25 THEN 120
        WHEN v_combo >= 10 THEN 110
        ELSE 100
      END;
      v_score := v_score + floor((v_base_points::numeric * v_multiplier_percent) / 100)::bigint;
      v_correct := v_correct + 1;
    ELSIF v_window_end <= p_client_game_over_elapsed_ms THEN
      -- A GO whose window has fully elapsed is a miss. A NO GO with no input
      -- is a successful pass and must simply continue to the next signal.
      IF v_signal.signal_kind = 'GO' THEN
        v_loss_time := v_window_end;
        v_lives := v_lives - 1;
        v_combo := 0;
        v_misses := v_misses + 1;
        v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
        IF v_lives <= 0 THEN
          v_game_over_ms := v_loss_time;
        END IF;
      END IF;
    ELSE
      -- The current signal has not finished by the submitted end time and
      -- there is no input that can affect it. Later signals cannot affect run.
      EXIT;
    END IF;
  END LOOP;

  IF v_lives > 0 OR v_game_over_ms IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'code', 'GAME_NOT_OVER', 'message', '게임 종료 전에는 공식 기록을 제출할 수 없습니다.');
  END IF;
  IF p_client_game_over_elapsed_ms < v_game_over_ms
     OR p_client_game_over_elapsed_ms > v_game_over_ms + v_end_tolerance THEN
    RETURN jsonb_build_object('valid', false, 'code', 'GAME_OVER_TIME_MISMATCH', 'message', '게임 종료 시간이 검증 결과와 일치하지 않습니다.');
  END IF;
  IF v_input_index <= v_event_count THEN
    RETURN jsonb_build_object('valid', false, 'code', 'INPUT_AFTER_GAME_OVER', 'message', '게임 종료 뒤의 입력 기록이 감지되었습니다.');
  END IF;

  v_accuracy_percent := CASE
    WHEN v_correct + v_misses + v_wrong_lane_errors = 0 THEN 0
    ELSE round((100.0 * v_correct) / (v_correct + v_misses + v_wrong_lane_errors), 2)
  END;

  RETURN jsonb_build_object(
    'valid', true,
    'official_score', v_score,
    'official_duration_ms', v_game_over_ms,
    'stats', jsonb_build_object(
      'accuracy_percent', v_accuracy_percent,
      'max_combo', v_max_combo,
      'correct_inputs', v_correct,
      'misses', v_misses,
      'no_go_errors', v_no_go_errors,
      'wrong_lane_errors', v_wrong_lane_errors,
      'remaining_lives', greatest(v_lives, 0)
    )
  );
END;
$$;

-- source: brand_2.0/supabase/APPLY_ARCADE_PURE_REACTION_02.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_validate_pure_reaction_02_submission(
  p_seed bigint,p_config jsonb,p_input_events jsonb,p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_event record;
  v_key text;
  v_times integer[]:=ARRAY[]::integer[];
  v_sources text[]:=ARRAY[]::text[];
  v_event_count integer:=0;
  v_prev integer:=-1;
  v_time_text text;
  v_source text;
  v_waits integer[]:=ARRAY[]::integer[];
  v_wait record;
  v_input_index integer:=1;
  v_trial integer;
  v_cursor integer:=0;
  v_signal integer;
  v_input integer;
  v_reaction integer;
  v_reactions integer[]:=ARRAY[]::integer[];
  v_sum integer:=0;
  v_avg_x10 integer;
  v_score bigint;
  v_official_duration integer;
  v_min_reaction integer;
  v_timeout integer;
  v_feedback integer;
  v_max_elapsed integer;
  v_end_tolerance integer;
BEGIN
  IF jsonb_typeof(p_config)<>'object' OR p_config->>'game_code'<>'pure_reaction_02' THEN
    RAISE EXCEPTION '[ARCADE GAME02] rule configuration is invalid.' USING ERRCODE='P0194';
  END IF;
  v_min_reaction:=(p_config->>'minValidReactionMs')::integer;
  v_timeout:=(p_config->>'responseTimeoutMs')::integer;
  v_feedback:=(p_config->>'interTrialFeedbackMs')::integer;
  v_max_elapsed:=coalesce((p_config->>'max_client_elapsed_ms')::integer,60000);
  v_end_tolerance:=coalesce((p_config->>'client_end_tolerance_ms')::integer,2000);
  IF v_min_reaction<>120 OR v_timeout<>3000 OR v_feedback<>700 OR (p_config->>'trialCount')::integer<>5 THEN
    RAISE EXCEPTION '[ARCADE GAME02] v0.1 configuration mismatch.' USING ERRCODE='P0194';
  END IF;
  IF jsonb_typeof(p_input_events)<>'array' THEN
    RETURN jsonb_build_object('valid',false,'code','INPUT_EVENTS_NOT_ARRAY','message','입력 기록 형식이 올바르지 않습니다.');
  END IF;
  IF p_client_game_over_elapsed_ms IS NULL OR p_client_game_over_elapsed_ms NOT BETWEEN 0 AND v_max_elapsed THEN
    RETURN jsonb_build_object('valid',false,'code','ELAPSED_OUT_OF_RANGE','message','게임 시간 기록이 허용 범위를 벗어났습니다.');
  END IF;

  FOR v_event IN SELECT value,ordinality FROM jsonb_array_elements(p_input_events) WITH ORDINALITY LOOP
    v_event_count:=v_event_count+1;
    IF v_event_count>5 OR jsonb_typeof(v_event.value)<>'object' THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_INVALID','message','입력 기록이 너무 많거나 형식이 올바르지 않습니다.');
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_event.value) LOOP
      IF v_key NOT IN ('elapsed_ms','source') THEN
        RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_EXTRA_FIELD','message','허용되지 않은 입력 기록 항목이 있습니다.');
      END IF;
    END LOOP;
    IF NOT(v_event.value?'elapsed_ms') OR NOT(v_event.value?'source')
       OR jsonb_typeof(v_event.value->'elapsed_ms')<>'number' OR jsonb_typeof(v_event.value->'source')<>'string' THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_SHAPE','message','입력 기록 형식이 올바르지 않습니다.');
    END IF;
    v_time_text:=v_event.value->>'elapsed_ms'; v_source:=v_event.value->>'source';
    IF v_time_text!~'^[0-9]+$' OR char_length(v_time_text)>7 OR v_source NOT IN('SPACE','POINTER') THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_VALUE','message','입력 시간 또는 입력 방식이 올바르지 않습니다.');
    END IF;
    IF v_time_text::integer<=v_prev OR v_time_text::integer>p_client_game_over_elapsed_ms THEN
      RETURN jsonb_build_object('valid',false,'code','INPUT_EVENT_ORDER','message','입력 시간 순서가 올바르지 않습니다.');
    END IF;
    v_prev:=v_time_text::integer;
    v_times:=array_append(v_times,v_prev); v_sources:=array_append(v_sources,v_source);
  END LOOP;

  FOR v_wait IN SELECT * FROM public.arcade_pure_reaction_02_waits(p_seed,p_config) ORDER BY trial_index LOOP
    v_waits:=array_append(v_waits,v_wait.wait_ms);
  END LOOP;
  IF array_length(v_waits,1) IS DISTINCT FROM 5 THEN RAISE EXCEPTION '[ARCADE GAME02] deterministic wait generation failed.'; END IF;

  FOR v_trial IN 1..5 LOOP
    v_signal:=v_cursor+v_waits[v_trial];
    IF v_input_index<=v_event_count THEN v_input:=v_times[v_input_index]; ELSE v_input:=NULL; END IF;

    IF v_input IS NOT NULL AND v_input<v_signal THEN
      IF p_client_game_over_elapsed_ms < v_input OR p_client_game_over_elapsed_ms > v_input+v_end_tolerance THEN
        RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
      END IF;
      RETURN jsonb_build_object('valid',false,'terminal',true,'code','FALSE_START_PRE_SIGNAL','message','부정 출발로 실격당했습니다. 신호가 나오기 전에 입력했습니다.','official_duration_ms',v_input);
    END IF;

    IF v_input IS NULL OR v_input>=v_signal+v_timeout THEN
      v_official_duration:=v_signal+v_timeout;
      IF p_client_game_over_elapsed_ms < v_official_duration OR p_client_game_over_elapsed_ms > v_official_duration+v_end_tolerance THEN
        RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
      END IF;
      RETURN jsonb_build_object('valid',false,'terminal',true,'code','REACTION_TIMEOUT','message','반응 실패. 제한 시간 안에 반응하지 못했습니다.','official_duration_ms',v_official_duration);
    END IF;

    v_reaction:=v_input-v_signal;
    IF v_reaction<v_min_reaction THEN
      IF p_client_game_over_elapsed_ms < v_input OR p_client_game_over_elapsed_ms > v_input+v_end_tolerance THEN
        RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
      END IF;
      RETURN jsonb_build_object('valid',false,'terminal',true,'code','FALSE_START_UNDER_120MS','message','부정 출발로 실격당했습니다. 정상 반응 범위보다 지나치게 빠른 입력이 감지되었습니다.','official_duration_ms',v_input);
    END IF;

    v_reactions:=array_append(v_reactions,v_reaction); v_sum:=v_sum+v_reaction; v_input_index:=v_input_index+1;
    IF v_trial<5 THEN v_cursor:=v_input+v_feedback; ELSE v_official_duration:=v_input; END IF;
  END LOOP;

  IF v_input_index<=v_event_count THEN
    RETURN jsonb_build_object('valid',false,'code','INPUT_AFTER_GAME_OVER','message','게임 종료 뒤의 입력 기록이 감지되었습니다.');
  END IF;
  IF p_client_game_over_elapsed_ms < v_official_duration OR p_client_game_over_elapsed_ms > v_official_duration+v_end_tolerance THEN
    RETURN jsonb_build_object('valid',false,'code','GAME_OVER_TIME_MISMATCH','message','게임 종료 시간이 검증 결과와 일치하지 않습니다.');
  END IF;

  v_avg_x10:=v_sum*2;
  v_score:=floor(25000000000::numeric/(v_sum::numeric*v_sum::numeric))::bigint;
  RETURN jsonb_build_object(
    'valid',true,'official_score',v_score,'official_duration_ms',v_official_duration,
    'stats',jsonb_build_object(
      'trial_reaction_ms',to_jsonb(v_reactions),'sum_reaction_ms',v_sum,'average_reaction_ms_x10',v_avg_x10,
      'best_reaction_ms',(SELECT min(x) FROM unnest(v_reactions) x),'worst_reaction_ms',(SELECT max(x) FROM unnest(v_reactions) x)
    )
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_02_arcade_game01_server_validation.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.arcade_xorshift32_next(p_state bigint)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint := p_state;
BEGIN
  IF p_state NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[ARCADE] xorshift32 state must be a non-zero unsigned 32-bit integer.'
      USING ERRCODE = 'P0190';
  END IF;

  v_state := (v_state # ((v_state << 13) & 4294967295)) & 4294967295;
  v_state := (v_state # (v_state >> 17)) & 4294967295;
  v_state := (v_state # ((v_state << 5) & 4294967295)) & 4294967295;
  RETURN v_state;
END;
$$;

-- source: brand_2.0/supabase/APPLY_ARCADE_PURE_REACTION_02.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(
  p_game_code text,
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer := public.current_classroom_id();
  v_student_id integer := public.current_student_id();
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_result jsonb;
BEGIN
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE='P0204';
  END IF;

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
    AND classroom_id = v_classroom_id;

  IF NOT FOUND
     OR v_period.status NOT IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED') THEN
    RAISE EXCEPTION '[ARCADE] ranking period was not found or is not visible.'
      USING ERRCODE='P0205';
  END IF;

  SELECT id
  INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206';
  END IF;

  WITH
  ranks AS (
    SELECT *
    FROM public.arcade_resolve_period_student_ranks(
      v_classroom_id,
      v_period.id,
      v_game_id
    )
  ),
  standard_candidates AS (
    SELECT
      r.student_id,
      r.official_score,
      r.game_over_at,
      r.id AS source_run_id,
      row_number() OVER (
        PARTITION BY r.student_id
        ORDER BY r.official_score DESC, r.game_over_at ASC, r.id ASC
      ) AS student_best_row
    FROM public.arcade_runs r
    WHERE r.classroom_id = v_classroom_id
      AND r.game_id = v_game_id
      AND r.run_context = 'STANDARD'
      AND r.status = 'VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id = r.id
          AND m.event_kind = 'INVALIDATE'
      )
  ),
  general_scores AS (
    SELECT
      c.student_id,
      c.official_score AS general_score,
      c.game_over_at AS general_achieved_at,
      c.source_run_id AS general_source_run_id
    FROM standard_candidates c
    WHERE c.student_best_row = 1
  ),
  decorated AS (
    SELECT
      r.rank,
      r.student_id,
      s.name AS student_name,
      r.official_score,
      COALESCE(gs.general_score, r.official_score) AS general_score,
      CASE
        WHEN o.id IS NOT NULL AND o.ranking_eligible
          THEN o.official_score
        ELSE NULL
      END AS certified_score,
      CASE
        WHEN v_period.period_kind <> 'MONTHLY'
          OR v_period.status = 'ACTIVE'
          THEN 'NONE'
        WHEN o.id IS NOT NULL AND o.ranking_eligible
          THEN 'CERTIFIED'
        WHEN o.id IS NOT NULL AND NOT o.ranking_eligible
          THEN 'FAILED'
        WHEN r.rank <= 10
          THEN 'PENDING'
        ELSE 'NONE'
      END AS certification_status,
      r.achieved_at AS game_over_at,
      CASE WHEN p_game_code='pure_reaction_02' THEN nullif(source_run.stats->>'average_reaction_ms_x10','')::integer ELSE NULL END AS average_reaction_ms_x10
    FROM ranks r
    JOIN public.students s
      ON s.id = r.student_id
    LEFT JOIN public.arcade_runs source_run
      ON source_run.id = r.source_run_id
    LEFT JOIN general_scores gs
      ON gs.student_id = r.student_id
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id = v_period.id
     AND o.game_id = v_game_id
     AND o.student_id = r.student_id
  ),
  guild_aggregate AS (
    SELECT
      g.id AS guild_id,
      g.name AS guild_name,
      g.logo_url AS guild_logo_url,
      count(gm.student_id)::integer AS member_count,
      count(gs.student_id)::integer AS participant_count,
      count(o.student_id) FILTER (
        WHERE o.ranking_eligible
          AND o.official_score IS NOT NULL
      )::integer AS certified_count,
      COALESCE(sum(gs.general_score), 0)::bigint AS general_total,
      COALESCE(sum(
        CASE
          WHEN o.ranking_eligible THEN o.official_score
          ELSE 0
        END
      ), 0)::bigint AS certified_total
    FROM public.guilds g
    LEFT JOIN public.guild_members gm
      ON gm.guild_id = g.id
     AND gm.left_at IS NULL
     AND public.is_official_participant(gm.student_id)
    LEFT JOIN general_scores gs
      ON gs.student_id = gm.student_id
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id = v_period.id
     AND o.game_id = v_game_id
     AND o.student_id = gm.student_id
    WHERE g.classroom_id = v_classroom_id
      AND g.is_active
    GROUP BY g.id, g.name, g.logo_url
  ),
  guild_ranked AS (
    SELECT
      row_number() OVER (
        ORDER BY ga.general_total DESC, ga.certified_total DESC, ga.guild_id ASC
      )::integer AS rank,
      ga.*
    FROM guild_aggregate ga
  )
  SELECT jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank', d.rank,
            'student_id', d.student_id,
            'student_name', d.student_name,
            'official_score', d.official_score,
            'general_score', d.general_score,
            'certified_score', d.certified_score,
            'certification_status', d.certification_status,
            'game_over_at', d.game_over_at,
            'average_reaction_ms_x10', d.average_reaction_ms_x10
          )
          ORDER BY d.rank
        )
        FROM decorated d
        WHERE d.rank <= 10
      ),
      '[]'::jsonb
    ),
    'guild_totals', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank', gr.rank,
            'guild_id', gr.guild_id,
            'guild_name', gr.guild_name,
            'guild_logo_url', gr.guild_logo_url,
            'member_count', gr.member_count,
            'participant_count', gr.participant_count,
            'certified_count', gr.certified_count,
            'general_total', gr.general_total,
            'certified_total', gr.certified_total
          )
          ORDER BY gr.rank
        )
        FROM guild_ranked gr
      ),
      '[]'::jsonb
    ),
    'my_rank', (
      SELECT d.rank
      FROM decorated d
      WHERE d.student_id = v_student_id
      LIMIT 1
    ),
    'my_score', (
      SELECT d.official_score
      FROM decorated d
      WHERE d.student_id = v_student_id
      LIMIT 1
    )
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260903_01_live_test_agent_foundation.sql (CRLF) [prod md5 match]
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

-- source: brand_2.0/supabase/migrations/20260903_01_live_test_agent_foundation.sql (CRLF) [prod md5 match]
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

-- source: brand_2.0/supabase/migrations/20260814_02_arcade_game01_server_validation.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_begin_arcade_run(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_countdown_ms integer;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  SELECT run.* INTO v_run
  FROM public.arcade_runs run
  WHERE run.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  IF v_run.status <> 'COUNTDOWN' THEN
    RAISE EXCEPTION '[ARCADE] run cannot begin from its current state.' USING ERRCODE = 'P0200';
  END IF;

  SELECT config INTO v_config FROM public.arcade_game_rule_versions WHERE id = v_run.rule_version_id;
  v_countdown_ms := (v_config ->> 'countdown_ms')::integer;
  IF clock_timestamp() < v_run.countdown_started_at + (v_countdown_ms * interval '1 millisecond') THEN
    RAISE EXCEPTION '[ARCADE] 5-second countdown is not complete yet.' USING ERRCODE = 'P0201';
  END IF;

  UPDATE public.arcade_runs
  SET status = 'PLAYING', play_started_at = clock_timestamp()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'play_started_at', v_run.play_started_at,
    'schedule_seed', v_run.schedule_seed,
    'config', v_config
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_06_arcade_prerelease_test_runs.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_get_arcade_run_result(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_run public.arcade_runs%ROWTYPE;
BEGIN
  v_student_id := public.current_student_id();
  SELECT * INTO v_run FROM public.arcade_runs WHERE id = p_run_id;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'status', v_run.status,
    'is_prerelease_test', v_run.is_prerelease_test,
    'official_score', v_run.official_score,
    'official_duration_ms', v_run.official_duration_ms,
    'game_over_at', v_run.game_over_at,
    'stats', v_run.stats,
    'rejection_code', v_run.rejection_code,
    'rejection_reason', v_run.rejection_reason
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_get_my_arcade_history(p_period_id bigint,p_limit integer DEFAULT 50,p_offset integer DEFAULT 0,p_game_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_student_id integer:=public.current_student_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint; v_result jsonb;
BEGIN
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN RAISE EXCEPTION '[ARCADE] authenticated student context is required.' USING ERRCODE='P0195'; END IF;
  IF p_limit IS NULL OR p_limit<1 OR p_limit>100 OR p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION '[ARCADE] invalid history pagination.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id AND status IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED');
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE] visible ranking period was not found.' USING ERRCODE='P0205'; END IF;
  IF p_game_code IS NOT NULL THEN SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code; IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF; END IF;
  WITH filtered AS (
    SELECT r.id run_id,g.code game_code,g.internal_name game_name,r.status,r.official_score,r.official_duration_ms,r.game_over_at,r.submitted_at,
      coalesce(r.game_over_at,r.submitted_at,r.created_at) occurred_at,r.rejection_code,r.rejection_reason,(inv.created_at IS NOT NULL)is_invalidated,inv.reason invalidation_reason,inv.created_at invalidated_at
    FROM public.arcade_runs r JOIN public.arcade_games g ON g.id=r.game_id
    LEFT JOIN LATERAL(SELECT m.reason,m.created_at FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE' ORDER BY m.id DESC LIMIT 1)inv ON true
    WHERE r.classroom_id=v_classroom_id AND r.student_id=v_student_id AND r.run_context='STANDARD' AND r.status IN('VERIFIED','REJECTED') AND NOT r.is_prerelease_test
      AND coalesce(r.game_over_at,r.submitted_at,r.created_at)>=v_period.starts_at AND coalesce(r.game_over_at,r.submitted_at,r.created_at)<v_period.ends_at_exclusive
      AND (v_game_id IS NULL OR r.game_id=v_game_id)
  ), page AS(SELECT * FROM filtered ORDER BY occurred_at DESC,run_id DESC LIMIT p_limit OFFSET p_offset)
  SELECT jsonb_build_object('period_id',v_period.id,'period_kind',v_period.period_kind,'display_name',v_period.display_name,'period_status',v_period.status,'total_count',(SELECT count(*) FROM filtered),'limit',p_limit,'offset',p_offset,
    'rows',coalesce((SELECT jsonb_agg(jsonb_build_object('run_id',page.run_id,'game_code',page.game_code,'game_name',page.game_name,'status',page.status,'official_score',page.official_score,'official_duration_ms',page.official_duration_ms,'game_over_at',page.game_over_at,'submitted_at',page.submitted_at,'occurred_at',page.occurred_at,'rejection_code',page.rejection_code,'rejection_reason',page.rejection_reason,'is_invalidated',page.is_invalidated,'invalidation_reason',page.invalidation_reason,'invalidated_at',page.invalidated_at)ORDER BY page.occurred_at DESC,page.run_id DESC)FROM page),'[]'::jsonb)) INTO v_result;
  RETURN v_result;
END; $$;

-- source: brand_2.0/supabase/migrations/20260913_01_tikatuka_official_day_single_attempt.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_get_tikatuka_competition_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  RETURN public.tikatuka_competition_payload_v2(v_classroom_id, v_student_id);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_get_tikatuka_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  RETURN public.tikatuka_progress_payload(v_classroom_id, v_student_id);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_01_tikatuka_official_day_single_attempt.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_start_tikatuka_official_challenge_v1(
  p_difficulty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_highest integer;
  v_window_open boolean := false;
  v_existing bigint;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_difficulty IS NULL OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty must be 1..10.' USING ERRCODE = 'PTK41';
  END IF;

  SELECT coalesce(w.is_open, false)
  INTO v_window_open
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id = v_classroom_id
    AND w.period_key = v_period;

  IF coalesce(v_window_open, false) = false THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge is not open.' USING ERRCODE = 'PTK44';
  END IF;

  SELECT coalesce(highest_unlocked_difficulty, 1)
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id AND student_id = v_student_id;
  v_highest := coalesce(v_highest, 1);

  IF p_difficulty > v_highest THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty % is locked; highest unlocked is %.', p_difficulty, v_highest
      USING ERRCODE = 'PTK03';
  END IF;

  SELECT id INTO v_existing
  FROM public.tikatuka_official_sessions
  WHERE classroom_id = v_classroom_id
    AND student_id = v_student_id
    AND period_key = v_period
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge attempt has already been used for this period.' USING ERRCODE = 'PTK45';
  END IF;

  BEGIN
    INSERT INTO public.tikatuka_official_sessions(
      classroom_id, student_id, period_key, difficulty
    ) VALUES (
      v_classroom_id, v_student_id, v_period, p_difficulty
    );
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge attempt has already been used for this period.' USING ERRCODE = 'PTK45';
  END;

  RETURN public.tikatuka_competition_payload_v2(v_classroom_id, v_student_id);
END;
$$;

-- source: brand_2.0/supabase/APPLY_ARCADE_PURE_REACTION_02.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_submit_pure_reaction_02_run(p_run_id bigint,p_input_events jsonb,p_client_game_over_elapsed_ms integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_validation jsonb;
  v_submitted_at timestamptz:=clock_timestamp();
  v_server_elapsed_ms integer;
  v_server_tolerance_ms integer;
  v_payload_hash text;
  v_input_event_count integer;
  v_capture jsonb;
BEGIN
  SELECT run.* INTO v_run FROM public.arcade_runs run WHERE run.id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE='P0199';
  END IF;
  IF v_run.status<>'PLAYING' OR v_run.play_started_at IS NULL THEN RAISE EXCEPTION '[ARCADE] this run is not ready for submission.' USING ERRCODE='P0202'; END IF;
  SELECT config INTO v_config FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
  IF v_config->>'game_code'<>'pure_reaction_02' THEN RAISE EXCEPTION '[ARCADE GAME02] this run does not use Game #02 rules.' USING ERRCODE='P0203'; END IF;

  IF p_input_events IS NULL OR jsonb_typeof(p_input_events)<>'array' OR jsonb_array_length(p_input_events)>5 THEN
    UPDATE public.arcade_runs SET status='REJECTED',submitted_at=v_submitted_at,rejection_code='INPUT_EVENTS_INVALID',rejection_reason='입력 기록 형식이 올바르지 않습니다.' WHERE id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','INPUT_EVENTS_INVALID','message','입력 기록 형식이 올바르지 않습니다.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;
  v_input_event_count:=jsonb_array_length(p_input_events);
  UPDATE public.arcade_runs SET status='SUBMITTING',submitted_at=v_submitted_at WHERE id=v_run.id;
  v_validation:=public.arcade_validate_pure_reaction_02_submission(v_run.schedule_seed,v_config,p_input_events,p_client_game_over_elapsed_ms);
  v_payload_hash:=public.arcade_sha256_hex(p_input_events::text||'|'||coalesce(p_client_game_over_elapsed_ms::text,''));
  INSERT INTO public.arcade_run_submissions(run_id,input_events,input_event_count,client_game_over_elapsed_ms,payload_hash,validation_metadata,submitted_at)
  VALUES(v_run.id,p_input_events,v_input_event_count,p_client_game_over_elapsed_ms,v_payload_hash,v_validation,v_submitted_at);

  IF coalesce((v_validation->>'valid')::boolean,false) IS NOT TRUE THEN
    UPDATE public.arcade_runs SET status='REJECTED',game_over_at=CASE WHEN (v_validation->>'terminal')::boolean IS TRUE AND v_validation?'official_duration_ms' THEN v_run.play_started_at+((v_validation->>'official_duration_ms')::integer*interval '1 millisecond') ELSE NULL END,
      rejection_code=coalesce(v_validation->>'code','VALIDATION_FAILED'),rejection_reason=coalesce(v_validation->>'message','게임 기록을 검증하지 못했습니다.') WHERE id=v_run.id RETURNING * INTO v_run;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'run_id',v_run.id,'code',v_run.rejection_code,'message',v_run.rejection_reason,'run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  v_server_elapsed_ms:=floor(extract(epoch FROM(v_submitted_at-v_run.play_started_at))*1000)::integer;
  v_server_tolerance_ms:=coalesce((v_config->>'server_elapsed_tolerance_ms')::integer,10000);
  IF v_server_elapsed_ms < (v_validation->>'official_duration_ms')::integer-2000 OR v_server_elapsed_ms > (v_validation->>'official_duration_ms')::integer+v_server_tolerance_ms THEN
    UPDATE public.arcade_runs SET status='REJECTED',rejection_code='SERVER_TIME_MISMATCH',rejection_reason='서버 시간과 게임 진행 시간이 크게 달라 공식 기록으로 인정되지 않았습니다.' WHERE id=v_run.id RETURNING * INTO v_run;
    UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_elapsed_ms',v_server_elapsed_ms,'server_time_valid',false) WHERE run_id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'code','SERVER_TIME_MISMATCH','message','게임 시간 검증에 실패했습니다. 다시 시도해 주세요.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  UPDATE public.arcade_runs SET status='VERIFIED',game_over_at=v_run.play_started_at+((v_validation->>'official_duration_ms')::integer*interval '1 millisecond'),verified_at=v_submitted_at,
    official_score=(v_validation->>'official_score')::bigint,official_duration_ms=(v_validation->>'official_duration_ms')::integer,stats=v_validation->'stats',rejection_code=NULL,rejection_reason=NULL
  WHERE id=v_run.id RETURNING * INTO v_run;
  UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_elapsed_ms',v_server_elapsed_ms,'server_time_valid',true) WHERE run_id=v_run.id;
  IF v_run.run_context='VERIFICATION' THEN v_capture:=public.arcade_capture_verification_attempt(v_run.id); END IF;
  RETURN jsonb_build_object('accepted',true,'run_id',v_run.id,'official_score',v_run.official_score,'official_duration_ms',v_run.official_duration_ms,'game_over_at',v_run.game_over_at,'stats',v_run.stats,'run_context',v_run.run_context,'verification_capture',v_capture);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.student_submit_tikatuka_result(
  p_game_id uuid,
  p_engine_version integer,
  p_winner text,
  p_difficulty integer,
  p_player_row_wins integer,
  p_ai_row_wins integer,
  p_tied_rows integer,
  p_player_score integer,
  p_ai_score integer,
  p_player_raw_pips integer,
  p_ai_raw_pips integer,
  p_player_knock_count integer,
  p_ai_knock_count integer,
  p_player_dice_removed integer,
  p_ai_dice_removed integer,
  p_player_shields_earned integer,
  p_ai_shields_earned integer,
  p_player_tazza_used integer,
  p_ai_tazza_used integer,
  p_player_hold_used integer,
  p_ai_hold_used integer,
  p_total_turns integer,
  p_final_boards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_game public.tikatuka_games;
  v_progress public.tikatuka_progress;
  v_submission jsonb;
  v_player_top integer;
  v_player_middle integer;
  v_player_bottom integer;
  v_ai_top integer;
  v_ai_middle integer;
  v_ai_bottom integer;
  v_server_player_row_wins integer := 0;
  v_server_ai_row_wins integer := 0;
  v_server_tied_rows integer := 0;
  v_server_player_score integer;
  v_server_ai_score integer;
  v_server_player_raw integer;
  v_server_ai_raw integer;
  v_server_winner text;
  v_player_tazza_limit integer;
  v_player_hold_limit integer;
  v_ai_tazza_limit integer;
  v_ai_hold_limit integer;
  v_server_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_game_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] game id is required.' USING ERRCODE = 'PTK04';
  END IF;

  SELECT * INTO v_game
  FROM public.tikatuka_games
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_game.student_id IS DISTINCT FROM v_student_id
     OR v_game.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[TIKATUKA] issued game was not found for this student.' USING ERRCODE = 'PTK04';
  END IF;

  v_submission := jsonb_build_object(
    'game_id', p_game_id,
    'engine_version', p_engine_version,
    'winner', p_winner,
    'difficulty', p_difficulty,
    'player_row_wins', p_player_row_wins,
    'ai_row_wins', p_ai_row_wins,
    'tied_rows', p_tied_rows,
    'player_score', p_player_score,
    'ai_score', p_ai_score,
    'player_raw_pips', p_player_raw_pips,
    'ai_raw_pips', p_ai_raw_pips,
    'player_knock_count', p_player_knock_count,
    'ai_knock_count', p_ai_knock_count,
    'player_dice_removed', p_player_dice_removed,
    'ai_dice_removed', p_ai_dice_removed,
    'player_shields_earned', p_player_shields_earned,
    'ai_shields_earned', p_ai_shields_earned,
    'player_tazza_used', p_player_tazza_used,
    'ai_tazza_used', p_ai_tazza_used,
    'player_hold_used', p_player_hold_used,
    'ai_hold_used', p_ai_hold_used,
    'total_turns', p_total_turns,
    'final_boards', p_final_boards
  );

  IF v_game.status = 'COMPLETED' THEN
    IF v_game.client_submission IS DISTINCT FROM v_submission THEN
      RAISE EXCEPTION '[TIKATUKA] duplicate game id was submitted with different result data.' USING ERRCODE = 'PTK05';
    END IF;

    RETURN jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'game_id', v_game.id,
      'server_winner', v_game.server_winner,
      'server_result', v_game.server_result,
      'progress', public.tikatuka_progress_payload(v_classroom_id, v_student_id)
    );
  END IF;

  IF p_engine_version IS DISTINCT FROM v_game.engine_version
     OR p_engine_version <> 1 THEN
    RAISE EXCEPTION '[TIKATUKA] engine version mismatch.' USING ERRCODE = 'PTK06';
  END IF;

  IF p_difficulty IS DISTINCT FROM v_game.difficulty
     OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] difficulty does not match the issued game.' USING ERRCODE = 'PTK07';
  END IF;

  IF p_winner NOT IN ('player', 'ai', 'draw') THEN
    RAISE EXCEPTION '[TIKATUKA] winner value is invalid.' USING ERRCODE = 'PTK08';
  END IF;

  IF p_total_turns IS NULL OR p_total_turns < 18 OR p_total_turns > 5000 THEN
    RAISE EXCEPTION '[TIKATUKA] total turn count is outside the supported range.' USING ERRCODE = 'PTK09';
  END IF;

  PERFORM public.tikatuka_validate_final_boards(p_final_boards);

  v_player_top := public.tikatuka_row_score(p_final_boards -> 'player' -> 'top');
  v_player_middle := public.tikatuka_row_score(p_final_boards -> 'player' -> 'middle');
  v_player_bottom := public.tikatuka_row_score(p_final_boards -> 'player' -> 'bottom');
  v_ai_top := public.tikatuka_row_score(p_final_boards -> 'ai' -> 'top');
  v_ai_middle := public.tikatuka_row_score(p_final_boards -> 'ai' -> 'middle');
  v_ai_bottom := public.tikatuka_row_score(p_final_boards -> 'ai' -> 'bottom');

  IF v_player_top > v_ai_top THEN v_server_player_row_wins := v_server_player_row_wins + 1;
  ELSIF v_ai_top > v_player_top THEN v_server_ai_row_wins := v_server_ai_row_wins + 1;
  ELSE v_server_tied_rows := v_server_tied_rows + 1;
  END IF;

  IF v_player_middle > v_ai_middle THEN v_server_player_row_wins := v_server_player_row_wins + 1;
  ELSIF v_ai_middle > v_player_middle THEN v_server_ai_row_wins := v_server_ai_row_wins + 1;
  ELSE v_server_tied_rows := v_server_tied_rows + 1;
  END IF;

  IF v_player_bottom > v_ai_bottom THEN v_server_player_row_wins := v_server_player_row_wins + 1;
  ELSIF v_ai_bottom > v_player_bottom THEN v_server_ai_row_wins := v_server_ai_row_wins + 1;
  ELSE v_server_tied_rows := v_server_tied_rows + 1;
  END IF;

  v_server_player_score := v_player_top + v_player_middle + v_player_bottom;
  v_server_ai_score := v_ai_top + v_ai_middle + v_ai_bottom;
  v_server_player_raw := public.tikatuka_board_raw_pips(p_final_boards -> 'player');
  v_server_ai_raw := public.tikatuka_board_raw_pips(p_final_boards -> 'ai');

  IF v_server_player_row_wins > v_server_ai_row_wins THEN
    v_server_winner := 'player';
  ELSIF v_server_ai_row_wins > v_server_player_row_wins THEN
    v_server_winner := 'ai';
  ELSIF v_server_player_raw > v_server_ai_raw THEN
    v_server_winner := 'player';
  ELSIF v_server_ai_raw > v_server_player_raw THEN
    v_server_winner := 'ai';
  ELSE
    v_server_winner := 'draw';
  END IF;

  IF p_player_row_wins IS DISTINCT FROM v_server_player_row_wins
     OR p_ai_row_wins IS DISTINCT FROM v_server_ai_row_wins
     OR p_tied_rows IS DISTINCT FROM v_server_tied_rows
     OR p_player_score IS DISTINCT FROM v_server_player_score
     OR p_ai_score IS DISTINCT FROM v_server_ai_score
     OR p_player_raw_pips IS DISTINCT FROM v_server_player_raw
     OR p_ai_raw_pips IS DISTINCT FROM v_server_ai_raw
     OR p_winner IS DISTINCT FROM v_server_winner THEN
    RAISE EXCEPTION '[TIKATUKA] submitted result does not match server-recomputed final board result.' USING ERRCODE = 'PTK11';
  END IF;

  IF p_player_knock_count IS NULL OR p_player_knock_count < 0
     OR p_ai_knock_count IS NULL OR p_ai_knock_count < 0
     OR p_player_dice_removed IS NULL OR p_player_dice_removed < 0
     OR p_ai_dice_removed IS NULL OR p_ai_dice_removed < 0
     OR p_player_shields_earned IS NULL OR p_player_shields_earned < 0
     OR p_ai_shields_earned IS NULL OR p_ai_shields_earned < 0
     OR p_player_tazza_used IS NULL OR p_player_tazza_used < 0
     OR p_ai_tazza_used IS NULL OR p_ai_tazza_used < 0
     OR p_player_hold_used IS NULL OR p_player_hold_used < 0
     OR p_ai_hold_used IS NULL OR p_ai_hold_used < 0 THEN
    RAISE EXCEPTION '[TIKATUKA] result counters cannot be negative.' USING ERRCODE = 'PTK12';
  END IF;

  IF p_player_knock_count > p_total_turns
     OR p_ai_knock_count > p_total_turns
     OR p_player_shields_earned <> p_player_knock_count
     OR p_ai_shields_earned <> p_ai_knock_count
     OR p_player_dice_removed < p_player_knock_count
     OR p_ai_dice_removed < p_ai_knock_count
     OR p_player_dice_removed > p_player_knock_count * 3
     OR p_ai_dice_removed > p_ai_knock_count * 3 THEN
    RAISE EXCEPTION '[TIKATUKA] knock/shield counters are inconsistent.' USING ERRCODE = 'PTK13';
  END IF;

  v_player_tazza_limit := CASE p_difficulty
    WHEN 1 THEN 5 WHEN 2 THEN 5 WHEN 3 THEN 4 WHEN 4 THEN 4 WHEN 5 THEN 3
    WHEN 6 THEN 3 WHEN 7 THEN 2 WHEN 8 THEN 2 WHEN 9 THEN 1 WHEN 10 THEN 0 END;
  v_player_hold_limit := CASE WHEN p_difficulty BETWEEN 1 AND 5 THEN 2 ELSE 1 END;
  v_ai_tazza_limit := CASE p_difficulty
    WHEN 1 THEN 0 WHEN 2 THEN 0 WHEN 3 THEN 0
    WHEN 4 THEN 1 WHEN 5 THEN 1 WHEN 6 THEN 1 WHEN 7 THEN 1
    WHEN 8 THEN 2 WHEN 9 THEN 2 WHEN 10 THEN 2 END;
  v_ai_hold_limit := CASE WHEN p_difficulty BETWEEN 7 AND 10 THEN 1 ELSE 0 END;

  IF p_player_tazza_used > v_player_tazza_limit
     OR p_player_hold_used > v_player_hold_limit
     OR p_ai_tazza_used > v_ai_tazza_limit
     OR p_ai_hold_used > v_ai_hold_limit THEN
    RAISE EXCEPTION '[TIKATUKA] skill usage exceeds the issued difficulty limits.' USING ERRCODE = 'PTK14';
  END IF;

  INSERT INTO public.tikatuka_progress(classroom_id, student_id, highest_unlocked_difficulty)
  VALUES (v_classroom_id, v_student_id, 1)
  ON CONFLICT (classroom_id, student_id) DO NOTHING;

  SELECT * INTO v_progress
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id AND student_id = v_student_id
  FOR UPDATE;

  IF v_game.difficulty > v_progress.highest_unlocked_difficulty THEN
    RAISE EXCEPTION '[TIKATUKA] issued game difficulty is no longer valid for progression.' USING ERRCODE = 'PTK15';
  END IF;

  v_server_result := jsonb_build_object(
    'winner', v_server_winner,
    'difficulty', v_game.difficulty,
    'player_row_wins', v_server_player_row_wins,
    'ai_row_wins', v_server_ai_row_wins,
    'tied_rows', v_server_tied_rows,
    'player_score', v_server_player_score,
    'ai_score', v_server_ai_score,
    'player_raw_pips', v_server_player_raw,
    'ai_raw_pips', v_server_ai_raw,
    'player_knock_count', p_player_knock_count,
    'ai_knock_count', p_ai_knock_count,
    'player_dice_removed', p_player_dice_removed,
    'ai_dice_removed', p_ai_dice_removed,
    'player_shields_earned', p_player_shields_earned,
    'ai_shields_earned', p_ai_shields_earned,
    'player_tazza_used', p_player_tazza_used,
    'ai_tazza_used', p_ai_tazza_used,
    'player_hold_used', p_player_hold_used,
    'ai_hold_used', p_ai_hold_used,
    'total_turns', p_total_turns
  );

  UPDATE public.tikatuka_games
  SET status = 'COMPLETED',
      client_submission = v_submission,
      final_boards = p_final_boards,
      server_result = v_server_result,
      server_winner = v_server_winner,
      completed_at = now()
  WHERE id = v_game.id;

  IF v_server_winner = 'player' THEN
    UPDATE public.tikatuka_progress
    SET highest_unlocked_difficulty = greatest(
      highest_unlocked_difficulty,
      least(10, v_game.difficulty + 1)
    )
    WHERE classroom_id = v_classroom_id AND student_id = v_student_id;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'game_id', v_game.id,
    'server_winner', v_server_winner,
    'server_result', v_server_result,
    'progress', public.tikatuka_progress_payload(v_classroom_id, v_student_id)
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_01_arcade_foundation.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_create_arcade_ranking_period(
  p_period_kind text,
  p_display_name text,
  p_guild_season_id integer,
  p_contribution_year_month text,
  p_starts_at timestamptz,
  p_ends_at_exclusive timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] teacher classroom context is missing.' USING ERRCODE = 'P0182';
  END IF;

  IF p_period_kind NOT IN ('MONTHLY', 'SEASON') THEN
    RAISE EXCEPTION '[ARCADE] period kind must be MONTHLY or SEASON.' USING ERRCODE = 'P0183';
  END IF;
  IF coalesce(btrim(p_display_name), '') = '' OR char_length(btrim(p_display_name)) > 120 THEN
    RAISE EXCEPTION '[ARCADE] period display name must be 1 to 120 characters.' USING ERRCODE = 'P0184';
  END IF;
  IF p_ends_at_exclusive <= p_starts_at THEN
    RAISE EXCEPTION '[ARCADE] period end must be after its start.' USING ERRCODE = 'P0185';
  END IF;
  IF (p_period_kind = 'MONTHLY' AND coalesce(p_contribution_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
     OR (p_period_kind = 'SEASON' AND p_contribution_year_month IS NOT NULL) THEN
    RAISE EXCEPTION '[ARCADE] monthly periods require YYYY-MM; season periods must not have a contribution month.' USING ERRCODE = 'P0186';
  END IF;

  IF p_guild_season_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.guild_seasons gs
    WHERE gs.id = p_guild_season_id AND gs.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION '[ARCADE] guild season does not belong to this classroom.' USING ERRCODE = 'P0187';
  END IF;

  INSERT INTO public.arcade_ranking_periods (
    classroom_id, period_kind, display_name, guild_season_id,
    contribution_year_month, starts_at, ends_at_exclusive, status
  ) VALUES (
    v_classroom_id, p_period_kind, btrim(p_display_name), p_guild_season_id,
    p_contribution_year_month, p_starts_at, p_ends_at_exclusive, 'DRAFT'
  )
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'classroom_id', v_period.classroom_id,
    'status', v_period.status
  );
END;
$$;

-- source: brand_2.0/supabase/APPLY_ARCADE_TEACHER_END_PERIOD_NOW.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_end_arcade_ranking_period_now(
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE = 'P0188';
  END IF;

  IF v_period.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE] finalized period is immutable.' USING ERRCODE = 'P0216';
  END IF;

  IF v_period.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE] activate the ranking period before ending it.' USING ERRCODE = 'P0217';
  END IF;

  IF v_period.starts_at >= v_now THEN
    RAISE EXCEPTION '[ARCADE] ranking period has not started yet.' USING ERRCODE = 'P0225';
  END IF;

  -- Idempotent: an already-ended ACTIVE period stays untouched.
  IF v_period.ends_at_exclusive <= v_now THEN
    RETURN jsonb_build_object(
      'period_id', v_period.id,
      'classroom_id', v_period.classroom_id,
      'status', v_period.status,
      'ended_at', v_period.ends_at_exclusive,
      'already_ended', true
    );
  END IF;

  UPDATE public.arcade_ranking_periods
  SET ends_at_exclusive = v_now
  WHERE id = v_period.id
  RETURNING * INTO v_period;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'classroom_id', v_period.classroom_id,
    'status', v_period.status,
    'ended_at', v_period.ends_at_exclusive,
    'already_ended', false
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_end_arcade_verification_session(
  p_session_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session not found.' USING ERRCODE='P0251';
  END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE='P0216';
  END IF;
  RETURN public.arcade_finalize_verification_session(v_session.id);
END;
$$;

-- source: brand_2.0/supabase/migrations/20261002_02_arcade_game_verification_force_close.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_force_close_arcade_game_verification(p_period_id bigint, p_game_code text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_run record;
  v_forced_result_count integer := 0;
  v_cancelled_run_count integer := 0;
  v_overridden_session_count integer := 0;
  v_game_missing integer := 0;
  v_period_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] force-close reason must be 2 to 500 characters.'
      USING ERRCODE='22023';
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found.'
      USING ERRCODE='P0256';
  END IF;

  IF v_period.period_kind<>'MONTHLY'
     OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period is not in verification stage.'
      USING ERRCODE='P0261';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.'
      USING ERRCODE='P0206';
  END IF;

  SELECT * INTO v_config
  FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id
    AND game_id=v_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.'
      USING ERRCODE='P0260';
  END IF;

  IF v_config.verification_closed_at IS NOT NULL THEN
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      );

    RETURN jsonb_build_object(
      'period_id',v_period.id,
      'game_code',p_game_code,
      'game_ready',(v_game_missing=0),
      'game_verification_closed',true,
      'game_verification_closed_at',v_config.verification_closed_at,
      'already_closed',true,
      'period_status',v_period.status
    );
  END IF;

  -- Lock all currently active sessions for this game first so no new run can
  -- be issued while the teacher is force-closing the game.
  PERFORM s.id
  FROM public.arcade_verification_sessions s
  WHERE s.classroom_id=v_classroom_id
    AND s.period_id=v_period.id
    AND s.game_id=v_game_id
    AND s.status='ACTIVE'
  FOR UPDATE;

  -- If someone is literally playing when the teacher force-closes,
  -- cancel that run as a technical cancellation and return the attempt slot.
  FOR v_run IN
    SELECT r.id AS run_id,
           a.id AS attempt_id,
           a.opportunity_number,
           s.id AS session_id,
           s.student_id
    FROM public.arcade_runs r
    JOIN public.arcade_verification_attempts a ON a.run_id=r.id
    JOIN public.arcade_verification_sessions s ON s.id=a.session_id
    WHERE s.classroom_id=v_classroom_id
      AND s.period_id=v_period.id
      AND s.game_id=v_game_id
      AND s.status='ACTIVE'
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    ORDER BY r.id
  LOOP
    UPDATE public.arcade_runs
    SET status='EXPIRED',
        rejection_code='VERIFICATION_FORCE_CLOSED',
        rejection_reason=btrim(p_reason)
    WHERE id=v_run.run_id;

    UPDATE public.arcade_verification_attempts
    SET status='TECHNICAL_CANCELLED',
        consumed=false,
        valid_run=false,
        terminal_outcome='TECHNICAL_CANCELLED',
        terminal_at=now()
    WHERE id=v_run.attempt_id;

    INSERT INTO public.arcade_verification_audit_events(
      classroom_id,period_id,game_id,student_id,session_id,attempt_id,
      event_kind,reason,metadata,actor_user_id
    )
    VALUES(
      v_classroom_id,v_period.id,v_game_id,v_run.student_id,v_run.session_id,v_run.attempt_id,
      'RUN_FORCE_CANCELLED_BY_GAME_CLOSE',btrim(p_reason),
      jsonb_build_object('run_id',v_run.run_id,'opportunity_number',v_run.opportunity_number),
      auth.uid()
    );

    v_cancelled_run_count := v_cancelled_run_count + 1;
  END LOOP;

  -- Preserve every result already officially decided.
  -- For unresolved students currently inside the reward range, adopt the
  -- already-frozen provisional record so nobody can hold the month open.
  WITH target_rows AS (
    SELECT r.student_id
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.student_id,
           p.source_run_id,
           p.official_score,
           p.official_duration_ms,
           p.stats,
           p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=v_game_id
     AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_corrections(
    classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason
  )
  SELECT v_classroom_id,v_period.id,v_game_id,s.student_id,'SET_SOURCE',s.source_run_id,btrim(p_reason)
  FROM source_rows s;

  WITH target_rows AS (
    SELECT r.student_id
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.student_id,
           p.source_run_id,
           p.official_score,
           p.official_duration_ms,
           p.stats,
           p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id
     AND p.game_id=v_game_id
     AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,
    ranking_eligible,decided_by_user_id
  )
  SELECT v_classroom_id,v_period.id,v_game_id,s.student_id,NULL,'MANUAL_SOURCE',
         s.source_run_id,s.official_score,s.official_duration_ms,s.stats,s.achieved_at,
         true,auth.uid()
  FROM source_rows s
  ON CONFLICT(period_id,game_id,student_id) DO NOTHING;
  GET DIAGNOSTICS v_forced_result_count=ROW_COUNT;

  UPDATE public.arcade_verification_sessions
  SET status='OVERRIDDEN',
      ended_at=now()
  WHERE classroom_id=v_classroom_id
    AND period_id=v_period.id
    AND game_id=v_game_id
    AND status='ACTIVE';
  GET DIAGNOSTICS v_overridden_session_count=ROW_COUNT;

  SELECT count(*) INTO v_game_missing
  FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
  WHERE r.rank<=v_config.target_rank_count
    AND NOT EXISTS (
      SELECT 1
      FROM public.arcade_verification_official_results o
      WHERE o.period_id=v_period.id
        AND o.game_id=v_game_id
        AND o.student_id=r.student_id
    );

  IF v_game_missing<>0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] game force-close left % unresolved reward-range record(s).',v_game_missing
      USING ERRCODE='P0278';
  END IF;

  UPDATE public.arcade_verification_period_games
  SET verification_closed_at=now(),
      verification_closed_by_user_id=auth.uid(),
      verification_close_reason=btrim(p_reason)
  WHERE id=v_config.id
  RETURNING * INTO v_config;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,v_period.id,v_game_id,
    'GAME_VERIFICATION_FORCE_CLOSED',btrim(p_reason),
    jsonb_build_object(
      'forced_provisional_results',v_forced_result_count,
      'cancelled_active_runs',v_cancelled_run_count,
      'overridden_active_sessions',v_overridden_session_count,
      'target_rank_count',v_config.target_rank_count
    ),
    auth.uid()
  );

  v_period_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'game_code',p_game_code,
    'game_ready',true,
    'game_verification_closed',true,
    'game_verification_closed_at',v_config.verification_closed_at,
    'forced_provisional_results',v_forced_result_count,
    'cancelled_active_runs',v_cancelled_run_count,
    'overridden_active_sessions',v_overridden_session_count,
    'period_status',v_period_status
  );
END;
$function$;

-- source: brand_2.0/supabase/APPLY_ARCADE_PERIOD_RECORDS.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_period_records(p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_rows jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE = 'P0205';
  END IF;

  WITH students AS (
    SELECT s.id, s.name, s.brand_name FROM public.students s
    WHERE s.classroom_id = v_classroom_id AND public.is_official_participant(s.id)
  ), games AS (
    SELECT g.id, g.code FROM public.arcade_games g
    WHERE g.code IN ('focus_reaction_01', 'pure_reaction_02')
  ), runs AS MATERIALIZED (
    SELECT r.* FROM public.arcade_runs r JOIN students s ON s.id = r.student_id
    JOIN games g ON g.id = r.game_id
    WHERE r.classroom_id = v_classroom_id AND r.run_context = 'STANDARD'
      AND NOT r.is_prerelease_test
      AND coalesce(r.game_over_at, r.submitted_at, r.created_at) >= v_period.starts_at
      AND coalesce(r.game_over_at, r.submitted_at, r.created_at) < v_period.ends_at_exclusive
      AND NOT EXISTS (SELECT 1 FROM public.arcade_run_moderation_events m
        WHERE m.run_id = r.id AND m.event_kind = 'INVALIDATE')
  ), run_counts AS (
    SELECT student_id, game_id,
      count(*) FILTER (WHERE play_started_at IS NOT NULL)::integer play_count,
      count(*) FILTER (WHERE status = 'VERIFIED')::integer completed_count,
      count(*) FILTER (WHERE status = 'REJECTED')::integer rejected_count,
      max(play_started_at) last_played_at
    FROM runs GROUP BY student_id, game_id
  ), best_runs AS (
    SELECT DISTINCT ON (student_id, game_id) student_id, game_id, official_score,
      nullif(stats->>'average_reaction_ms_x10', '')::integer average_reaction_ms_x10
    FROM runs WHERE status = 'VERIFIED' AND official_score IS NOT NULL
    ORDER BY student_id, game_id, official_score DESC, game_over_at, id
  ), reaction_ranks AS (
    SELECT g.id game_id, r.* FROM games g
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(v_classroom_id, v_period.id, g.id) r
    WHERE v_period.status <> 'DRAFT'
  ), ordinary_matches AS (
    SELECT g.* FROM public.tikatuka_games g JOIN students s ON s.id = g.student_id
    WHERE g.classroom_id = v_classroom_id AND g.official_session_id IS NULL
      AND g.issued_at >= v_period.starts_at AND g.issued_at < v_period.ends_at_exclusive
  ), match_counts AS (
    SELECT student_id, count(*) FILTER (WHERE status = 'COMPLETED')::integer play_count,
      coalesce(max(difficulty) FILTER (WHERE status = 'COMPLETED' AND server_winner = 'player'), 0)::integer clear_level,
      count(*) FILTER (WHERE status = 'COMPLETED' AND server_winner = 'player')::integer wins,
      count(*) FILTER (WHERE status = 'COMPLETED' AND server_winner = 'ai')::integer losses,
      count(*) FILTER (WHERE status = 'COMPLETED' AND server_winner = 'draw')::integer draws,
      max(issued_at) FILTER (WHERE status = 'COMPLETED') last_played_at
    FROM ordinary_matches GROUP BY student_id
  ), official_sessions AS (
    SELECT os.* FROM public.tikatuka_official_sessions os JOIN students s ON s.id = os.student_id
    WHERE os.classroom_id = v_classroom_id AND os.arcade_period_id = v_period.id
  ), live_official_ranks AS (
    SELECT r.student_id, r.points::bigint official_score, r.difficulty::integer official_difficulty, r.rank
    FROM public.tikatuka_resolve_period_official_ranks(v_classroom_id, v_period.id) r
    WHERE v_period.status <> 'FINALIZED' AND v_period.status <> 'DRAFT'
  ), closed_official_ranks AS (
    SELECT e.student_id, e.points::bigint official_score, e.difficulty::integer official_difficulty, e.rank
    FROM public.tikatuka_monthly_official_snapshots sn
    JOIN public.tikatuka_monthly_official_snapshot_entries e ON e.snapshot_id = sn.id
    WHERE v_period.status = 'FINALIZED' AND sn.classroom_id = v_classroom_id AND sn.period_id = v_period.id
  ), official_ranks AS (
    SELECT * FROM live_official_ranks UNION ALL SELECT * FROM closed_official_ranks
  ), rows AS (
    SELECT s.id student_id, s.name student_name, s.brand_name, g.code game_code,
      coalesce(c.play_count, 0) play_count, coalesce(c.completed_count, 0) completed_count,
      coalesce(c.rejected_count, 0) rejected_count, b.official_score general_best_score,
      b.average_reaction_ms_x10, r.official_score, r.rank current_rank,
      0 clear_level, NULL::integer official_difficulty, NULL::text official_status,
      0 wins, 0 losses, 0 draws, c.last_played_at
    FROM students s CROSS JOIN games g
    LEFT JOIN run_counts c ON c.student_id = s.id AND c.game_id = g.id
    LEFT JOIN best_runs b ON b.student_id = s.id AND b.game_id = g.id
    LEFT JOIN reaction_ranks r ON r.student_id = s.id AND r.game_id = g.id
    UNION ALL
    SELECT s.id, s.name, s.brand_name, 'rakaruka_03',
      coalesce(c.play_count, 0), coalesce(c.play_count, 0), 0, NULL::bigint,
      NULL::integer, r.official_score, r.rank, coalesce(c.clear_level, 0), r.official_difficulty,
      os.status, coalesce(c.wins, 0), coalesce(c.losses, 0), coalesce(c.draws, 0), c.last_played_at
    FROM students s
    LEFT JOIN match_counts c ON c.student_id = s.id
    LEFT JOIN official_ranks r ON r.student_id = s.id
    LEFT JOIN LATERAL (
      SELECT x.status FROM official_sessions x WHERE x.student_id = s.id ORDER BY x.started_at DESC, x.id DESC LIMIT 1
    ) os ON true
  )
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.game_code, r.current_rank NULLS LAST, r.student_name, r.student_id), '[]'::jsonb)
  INTO v_rows FROM rows r;

  RETURN jsonb_build_object('period_id', v_period.id, 'period_name', v_period.display_name,
    'period_status', v_period.status, 'starts_at', v_period.starts_at,
    'ends_at_exclusive', v_period.ends_at_exclusive, 'rows', v_rows);
END;
$function$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_prerelease_test_leaderboard(p_period_id bigint,p_game_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role(); SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE] ranking period was not found in this classroom.' USING ERRCODE='P0205'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code; IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  WITH candidate_runs AS(SELECT r.id run_id,r.student_id,r.official_score,r.game_over_at,row_number()OVER(PARTITION BY r.student_id ORDER BY r.official_score DESC,r.game_over_at,r.id)best_row FROM public.arcade_runs r
    WHERE r.classroom_id=v_classroom_id AND r.game_id=v_game_id AND r.run_context='STANDARD' AND r.status='VERIFIED' AND r.is_prerelease_test AND r.game_over_at>=v_period.starts_at AND r.game_over_at<v_period.ends_at_exclusive
      AND NOT EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=r.id AND m.event_kind='INVALIDATE')),
  ranked AS(SELECT c.*,row_number()OVER(ORDER BY c.official_score DESC,c.game_over_at,c.run_id)rank FROM candidate_runs c WHERE c.best_row=1)
  SELECT jsonb_build_object('period_id',v_period.id,'game_code',p_game_code,'participant_count',count(*),'top10',coalesce(jsonb_agg(jsonb_build_object('rank',r.rank,'student_id',r.student_id,'student_name',s.name,'official_score',r.official_score,'game_over_at',r.game_over_at)ORDER BY r.rank)FILTER(WHERE r.rank<=10),'[]'::jsonb)) INTO v_result FROM ranked r JOIN public.students s ON s.id=r.student_id;
  RETURN coalesce(v_result,jsonb_build_object('period_id',v_period.id,'game_code',p_game_code,'participant_count',0,'top10','[]'::jsonb));
END; $$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_run_audit(p_period_id bigint,p_game_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_period public.arcade_ranking_periods%ROWTYPE; v_game_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role(); SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id AND classroom_id=v_classroom_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE='P0205'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code; IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  RETURN(SELECT coalesce(jsonb_agg(row_data ORDER BY(row_data->>'event_at')::timestamptz DESC),'[]'::jsonb) FROM(
    SELECT jsonb_build_object('run_id',r.id,'student_id',r.student_id,'student_name',s.name,'status',r.status,'run_context',r.run_context,'is_prerelease_test',r.is_prerelease_test,
      'official_score',r.official_score,'official_duration_ms',r.official_duration_ms,'game_over_at',r.game_over_at,'submitted_at',r.submitted_at,'event_at',coalesce(r.game_over_at,r.submitted_at,r.created_at),
      'rejection_code',r.rejection_code,'rejection_reason',r.rejection_reason,'invalidated',m.id IS NOT NULL,'invalidation_reason',m.reason)row_data
    FROM public.arcade_runs r JOIN public.students s ON s.id=r.student_id LEFT JOIN public.arcade_run_moderation_events m ON m.run_id=r.id
    WHERE r.classroom_id=v_classroom_id AND r.game_id=v_game_id AND r.run_context='STANDARD'
      AND coalesce(r.game_over_at,r.submitted_at,r.created_at)>=v_period.starts_at AND coalesce(r.game_over_at,r.submitted_at,r.created_at)<v_period.ends_at_exclusive
    ORDER BY coalesce(r.game_over_at,r.submitted_at,r.created_at)DESC,r.id DESC LIMIT 200)audit_rows);
END; $$;

-- source: brand_2.0/supabase/migrations/20261002_02_arcade_game_verification_force_close.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_verification_overview(p_period_id bigint, p_game_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_game_missing integer := 0;
  v_game_active_sessions integer := 0;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
    AND classroom_id=v_classroom_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206';
  END IF;

  SELECT * INTO v_config
  FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id
    AND game_id=v_game_id;

  IF FOUND THEN
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id) r
    WHERE r.rank<=v_config.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id
          AND o.game_id=v_game_id
          AND o.student_id=r.student_id
      );

    SELECT count(*) INTO v_game_active_sessions
    FROM public.arcade_verification_sessions s
    WHERE s.classroom_id=v_classroom_id
      AND s.period_id=v_period.id
      AND s.game_id=v_game_id
      AND s.status='ACTIVE';
  END IF;

  WITH all_ranks AS (
    SELECT * FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game_id)
  ), subject_ids AS (
    SELECT student.id AS student_id
    FROM public.students student
    WHERE student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ), subject AS (
    SELECT r.rank,ids.student_id,r.source_run_id AS current_source_run_id,r.official_score AS current_official_score,r.achieved_at,
           p.official_score AS provisional_score,p.source_run_id AS provisional_source_run_id,p.id AS provisional_entry_id,
           (p.id IS NOT NULL) AS has_provisional_record,
           s.id AS session_id,s.status AS session_status,s.verification_threshold,s.threshold_percent,s.max_attempts,
           s.success_achieved,s.result_status,s.activated_at,s.ended_at,
           o.decision_kind,o.source_run_id AS official_source_run_id,o.official_score AS decided_official_score,o.ranking_eligible,
           student.name AS student_name,student.brand_name,
           (SELECT count(*) FROM public.arcade_verification_attempts a WHERE a.session_id=s.id AND a.consumed)::integer AS used_attempts,
           (SELECT max(a.official_score) FROM public.arcade_verification_attempts a WHERE a.session_id=s.id AND a.status='TERMINAL' AND a.valid_run) AS best_verification_score,
           (SELECT rr.id FROM public.arcade_runs rr WHERE rr.verification_session_id=s.id AND rr.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') ORDER BY rr.id DESC LIMIT 1) AS active_run_id
    FROM subject_ids ids
    LEFT JOIN all_ranks r ON r.student_id=ids.student_id
    LEFT JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=v_game_id AND p.student_id=ids.student_id
    JOIN public.students student ON student.id=ids.student_id
    LEFT JOIN LATERAL (
      SELECT ss.* FROM public.arcade_verification_sessions ss
      WHERE ss.period_id=v_period.id AND ss.game_id=v_game_id AND ss.student_id=ids.student_id
      ORDER BY (ss.status='ACTIVE') DESC,ss.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id=v_period.id AND o.game_id=v_game_id AND o.student_id=ids.student_id
  )
  SELECT jsonb_build_object(
    'period_id',v_period.id,
    'period_status',v_period.status,
    'period_name',v_period.display_name,
    'game_code',p_game_code,
    'game_ready',(v_config.id IS NOT NULL AND v_game_missing=0 AND v_game_active_sessions=0),
    'game_missing_count',v_game_missing,
    'game_active_session_count',v_game_active_sessions,
    'game_verification_closed',(v_config.verification_closed_at IS NOT NULL),
    'game_verification_closed_at',v_config.verification_closed_at,
    'game_verification_close_reason',v_config.verification_close_reason,
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'rank',subject.rank,'student_id',subject.student_id,'student_name',subject.student_name,'brand_name',subject.brand_name,
      'has_provisional_record',subject.has_provisional_record,
      'provisional_score',subject.provisional_score,'provisional_source_run_id',subject.provisional_source_run_id,
      'current_official_score',subject.current_official_score,'current_source_run_id',subject.current_source_run_id,
      'session_id',subject.session_id,'session_status',subject.session_status,'verification_threshold',subject.verification_threshold,
      'threshold_percent',subject.threshold_percent,'max_attempts',subject.max_attempts,'used_attempts',coalesce(subject.used_attempts,0),
      'success_achieved',coalesce(subject.success_achieved,false),'result_status',subject.result_status,
      'best_verification_score',subject.best_verification_score,'active_run_id',subject.active_run_id,
      'decision_kind',subject.decision_kind,'official_source_run_id',subject.official_source_run_id,
      'decided_official_score',subject.decided_official_score,'ranking_eligible',subject.ranking_eligible,
      'is_current_reward_range',(subject.rank IS NOT NULL AND subject.rank<=coalesce(v_config.target_rank_count,10)),
      'attempts',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'attempt_id',a.id,'issue_number',a.issue_number,'opportunity_number',a.opportunity_number,
          'run_id',a.run_id,'status',a.status,'consumed',a.consumed,'valid_run',a.valid_run,
          'terminal_outcome',a.terminal_outcome,'official_score',a.official_score,
          'issued_at',a.issued_at,'terminal_at',a.terminal_at,'restored_at',a.restored_at,
          'restore_reason',a.restore_reason
        ) ORDER BY a.issue_number)
        FROM public.arcade_verification_attempts a
        WHERE a.session_id=subject.session_id
      ),'[]'::jsonb)
    ) ORDER BY subject.rank NULLS LAST,subject.student_name,subject.student_id),'[]'::jsonb)
  ) INTO v_result
  FROM subject;

  RETURN coalesce(
    v_result,
    jsonb_build_object(
      'period_id',v_period.id,
      'period_status',v_period.status,
      'period_name',v_period.display_name,
      'game_code',p_game_code,
      'game_ready',(v_config.id IS NOT NULL AND v_game_missing=0 AND v_game_active_sessions=0),
      'game_missing_count',v_game_missing,
      'game_active_session_count',v_game_active_sessions,
      'game_verification_closed',(v_config.verification_closed_at IS NOT NULL),
      'game_verification_closed_at',v_config.verification_closed_at,
      'game_verification_close_reason',v_config.verification_close_reason,
      'rows','[]'::jsonb
    )
  );
END;
$function$;

-- source: brand_2.0/supabase/migrations/20260913_01_tikatuka_official_day_single_attempt.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_get_tikatuka_official_window_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  RETURN public.tikatuka_official_window_admin_payload(v_classroom_id);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_invalidate_arcade_run(p_run_id bigint,p_reason text,p_idempotency_key uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer:=public.current_classroom_id(); v_run public.arcade_runs%ROWTYPE; v_event public.arcade_run_moderation_events%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF coalesce(btrim(p_reason),'')='' OR char_length(btrim(p_reason))NOT BETWEEN 2 AND 300 THEN RAISE EXCEPTION '[ARCADE] invalidation reason must be 2 to 300 characters.' USING ERRCODE='P0207'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION '[ARCADE] idempotency key is required.' USING ERRCODE='P0208'; END IF;
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[ARCADE] run not found in this classroom.' USING ERRCODE='P0209'; END IF;
  IF v_run.run_context<>'STANDARD' OR v_run.status<>'VERIFIED' THEN RAISE EXCEPTION '[ARCADE] only verified standard runs can be invalidated.' USING ERRCODE='P0210'; END IF;
  IF EXISTS(SELECT 1 FROM public.arcade_monthly_snapshot_entries e WHERE e.source_run_id=v_run.id)
     OR EXISTS(SELECT 1 FROM public.arcade_monthly_snapshot_student_ranks r WHERE r.source_run_id=v_run.id) THEN
    RAISE EXCEPTION '[ARCADE] this run is already part of a finalized snapshot; use correction flow.' USING ERRCODE='P0211';
  END IF;
  IF EXISTS(
    SELECT 1
    FROM public.arcade_verification_provisional_entries p
    JOIN public.arcade_ranking_periods period ON period.id=p.period_id
    WHERE p.source_run_id=v_run.id AND period.status IN('VERIFICATION','READY_TO_FINALIZE')
  ) OR EXISTS(
    SELECT 1
    FROM public.arcade_verification_official_results o
    JOIN public.arcade_ranking_periods period ON period.id=o.period_id
    WHERE o.source_run_id=v_run.id AND period.status IN('VERIFICATION','READY_TO_FINALIZE')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this run is frozen/selected as an official verification source; use verification correction instead.' USING ERRCODE='P0273';
  END IF;
  SELECT * INTO v_event FROM public.arcade_run_moderation_events WHERE idempotency_key=p_idempotency_key;
  IF FOUND THEN IF v_event.run_id IS DISTINCT FROM v_run.id THEN RAISE EXCEPTION '[ARCADE] idempotency key belongs to a different moderation action.' USING ERRCODE='P0212'; END IF; RETURN jsonb_build_object('moderation_event_id',v_event.id,'run_id',v_event.run_id,'invalidated',true); END IF;
  IF EXISTS(SELECT 1 FROM public.arcade_run_moderation_events e WHERE e.run_id=v_run.id) THEN RAISE EXCEPTION '[ARCADE] this run was already invalidated.' USING ERRCODE='P0213'; END IF;
  INSERT INTO public.arcade_run_moderation_events(run_id,classroom_id,event_kind,reason,idempotency_key)VALUES(v_run.id,v_classroom_id,'INVALIDATE',btrim(p_reason),p_idempotency_key)RETURNING * INTO v_event;
  RETURN jsonb_build_object('moderation_event_id',v_event.id,'run_id',v_event.run_id,'invalidated',true);
END; $$;

-- source: brand_2.0/supabase/migrations/20260814_06_arcade_prerelease_test_runs.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_list_arcade_prerelease_test_access(
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_game_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(
      jsonb_build_object(
        'access_id', access_row.id,
        'student_id', access_row.student_id,
        'student_name', student.name,
        'student_brand_name', student.brand_name,
        'is_enabled', access_row.is_enabled,
        'updated_at', access_row.updated_at
      ) ORDER BY student.name, access_row.id
    ), '[]'::jsonb)
    FROM public.arcade_prerelease_test_access access_row
    JOIN public.students student ON student.id = access_row.student_id
    WHERE access_row.classroom_id = v_classroom_id
      AND access_row.game_id = v_game_id
      AND access_row.is_enabled
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_reset_arcade_verification_session(
  p_session_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] reset reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[ARCADE VERIFY] session not found.' USING ERRCODE='P0251'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN RAISE EXCEPTION '[ARCADE VERIFY] finalized period cannot be changed.' USING ERRCODE='P0216'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id FOR UPDATE;
  IF v_session.status NOT IN ('ACTIVE','COMPLETED') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only active/completed sessions can be reset.' USING ERRCODE='P0255';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] cancel/finish the active verification run before resetting the session.' USING ERRCODE='P0268';
  END IF;
  DELETE FROM public.arcade_verification_official_results
  WHERE period_id=v_session.period_id AND game_id=v_session.game_id AND student_id=v_session.student_id AND session_id=v_session.id;
  UPDATE public.arcade_verification_sessions SET status='RESET',ended_at=now() WHERE id=v_session.id;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,event_kind,reason,actor_user_id)
  VALUES(v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,'SESSION_RESET',btrim(p_reason),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object('session_id',v_session.id,'status','RESET','period_status',v_status);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260814_06_arcade_prerelease_test_runs.sql (CRLF) [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_set_arcade_prerelease_test_access(
  p_student_id integer,
  p_game_code text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_game_id bigint;
  v_access public.arcade_prerelease_test_access%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF p_student_id IS NULL OR p_student_id <= 0 THEN
    RAISE EXCEPTION '[ARCADE] test student is required.' USING ERRCODE = 'P0221';
  END IF;
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION '[ARCADE] test access state is required.' USING ERRCODE = 'P0222';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code AND is_active;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active game was not found.' USING ERRCODE = 'P0223';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students student
    WHERE student.id = p_student_id
      AND student.classroom_id = v_classroom_id
      AND student.transferred_at IS NULL
      AND student.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST')
  ) THEN
    RAISE EXCEPTION '[ARCADE] test student was not found in this classroom.' USING ERRCODE = 'P0224';
  END IF;

  INSERT INTO public.arcade_prerelease_test_access (
    classroom_id, student_id, game_id, is_enabled, created_by_user_id, updated_by_user_id
  ) VALUES (
    v_classroom_id, p_student_id, v_game_id, p_enabled, auth.uid(), auth.uid()
  )
  ON CONFLICT (student_id, game_id) DO UPDATE SET
    classroom_id = EXCLUDED.classroom_id,
    is_enabled = EXCLUDED.is_enabled,
    updated_by_user_id = auth.uid(),
    updated_at = now()
  RETURNING * INTO v_access;

  RETURN jsonb_build_object(
    'access_id', v_access.id,
    'student_id', v_access.student_id,
    'game_id', v_access.game_id,
    'is_enabled', v_access.is_enabled
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20261001002900_arcade_verification_all_students.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_set_arcade_verification_correction(
  p_period_id bigint,
  p_game_code text,
  p_student_id integer,
  p_source_run_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_run public.arcade_runs%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_action text;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] correction reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id OR v_period.period_kind<>'MONTHLY' THEN RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found.' USING ERRCODE='P0256'; END IF;
  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN RAISE EXCEPTION '[ARCADE VERIFY] correction is allowed only during verification.' USING ERRCODE='P0261'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id=p_student_id
      AND student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not an official participant in this classroom.' USING ERRCODE='P0270';
  END IF;

  SELECT * INTO v_session FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id AND status='ACTIVE'
  FOR UPDATE;
  IF FOUND AND EXISTS (
    SELECT 1 FROM public.arcade_runs r
    WHERE r.verification_session_id=v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN RAISE EXCEPTION '[ARCADE VERIFY] finish/cancel the active verification run before correction.' USING ERRCODE='P0268'; END IF;
  IF FOUND THEN UPDATE public.arcade_verification_sessions SET status='OVERRIDDEN',ended_at=now() WHERE id=v_session.id; END IF;

  IF p_source_run_id IS NULL THEN
    v_action:='NO_RECORD';
    INSERT INTO public.arcade_verification_official_results(
      classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
    ) VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,'MANUAL_NONE',NULL,NULL,NULL,'{}'::jsonb,NULL,false,auth.uid())
    ON CONFLICT(period_id,game_id,student_id) DO UPDATE SET session_id=NULL,decision_kind='MANUAL_NONE',source_run_id=NULL,official_score=NULL,official_duration_ms=NULL,stats='{}'::jsonb,achieved_at=NULL,ranking_eligible=false,decided_by_user_id=auth.uid(),decided_at=now(),updated_at=now();
  ELSE
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_source_run_id;
    IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM v_classroom_id OR v_run.student_id IS DISTINCT FROM p_student_id OR v_run.game_id IS DISTINCT FROM v_game_id OR v_run.status<>'VERIFIED' THEN
      RAISE EXCEPTION '[ARCADE VERIFY] correction source run is not a matching verified run.' USING ERRCODE='P0267';
    END IF;
    IF v_run.run_context='STANDARD' THEN
      IF v_run.is_prerelease_test OR v_run.game_over_at<v_period.starts_at OR v_run.game_over_at>=v_period.ends_at_exclusive OR EXISTS(SELECT 1 FROM public.arcade_run_moderation_events m WHERE m.run_id=v_run.id AND m.event_kind='INVALIDATE') THEN
        RAISE EXCEPTION '[ARCADE VERIFY] standard correction source is outside this target period or invalid.' USING ERRCODE='P0267';
      END IF;
    ELSIF v_run.run_context='VERIFICATION' THEN
      IF NOT EXISTS(
        SELECT 1 FROM public.arcade_verification_sessions s
        WHERE s.id=v_run.verification_session_id AND s.period_id=v_period.id AND s.game_id=v_game_id AND s.student_id=p_student_id
      ) THEN RAISE EXCEPTION '[ARCADE VERIFY] verification correction source belongs to a different target period.' USING ERRCODE='P0267'; END IF;
    ELSE RAISE EXCEPTION '[ARCADE VERIFY] unsupported correction source context.' USING ERRCODE='P0267'; END IF;
    v_action:='SET_SOURCE';
    INSERT INTO public.arcade_verification_official_results(
      classroom_id,period_id,game_id,student_id,session_id,decision_kind,source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
    ) VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,'MANUAL_SOURCE',v_run.id,v_run.official_score,v_run.official_duration_ms,v_run.stats,v_run.game_over_at,true,auth.uid())
    ON CONFLICT(period_id,game_id,student_id) DO UPDATE SET session_id=NULL,decision_kind='MANUAL_SOURCE',source_run_id=EXCLUDED.source_run_id,official_score=EXCLUDED.official_score,official_duration_ms=EXCLUDED.official_duration_ms,stats=EXCLUDED.stats,achieved_at=EXCLUDED.achieved_at,ranking_eligible=true,decided_by_user_id=auth.uid(),decided_at=now(),updated_at=now();
  END IF;

  INSERT INTO public.arcade_verification_corrections(classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason)
  VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,v_action,p_source_run_id,btrim(p_reason));
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,event_kind,reason,metadata,actor_user_id)
  VALUES(v_classroom_id,v_period.id,v_game_id,p_student_id,'MANUAL_CORRECTION',btrim(p_reason),jsonb_build_object('action_kind',v_action,'source_run_id',p_source_run_id),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  RETURN jsonb_build_object('period_id',v_period.id,'student_id',p_student_id,'action_kind',v_action,'source_run_id',p_source_run_id,'period_status',v_status);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_05_tikatuka_win_gate_progression.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_set_tikatuka_progress_v1(
  p_student_id integer,
  p_highest_unlocked_difficulty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_student public.students;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  IF p_student_id IS NULL THEN
    RAISE EXCEPTION '학생을 선택해주세요.' USING ERRCODE = 'PTK32';
  END IF;

  IF p_highest_unlocked_difficulty IS NULL
     OR p_highest_unlocked_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '해금 난이도는 1~10이어야 합니다.' USING ERRCODE = 'PTK33';
  END IF;

  SELECT s.*
  INTO v_student
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST');

  IF v_student.id IS NULL THEN
    RAISE EXCEPTION '현재 학급에서 관리할 수 있는 학생을 찾을 수 없습니다.' USING ERRCODE = 'PTK32';
  END IF;

  PERFORM set_config('app.tikatuka_progress_override', 'teacher', true);

  INSERT INTO public.tikatuka_progress(
    classroom_id,
    student_id,
    highest_unlocked_difficulty,
    created_at,
    updated_at
  )
  VALUES (
    v_classroom_id,
    p_student_id,
    p_highest_unlocked_difficulty,
    now(),
    now()
  )
  ON CONFLICT (classroom_id, student_id)
  DO UPDATE SET
    highest_unlocked_difficulty = EXCLUDED.highest_unlocked_difficulty,
    updated_at = now();

  RETURN jsonb_build_object(
    'student_id', v_student.id,
    'student_name', v_student.name,
    'brand_name', v_student.brand_name
  ) || public.tikatuka_progress_payload(v_classroom_id, p_student_id);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260906_16_arcade_record_verification.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.teacher_update_arcade_ranking_period(
  p_period_id bigint,
  p_display_name text,
  p_guild_season_id integer,
  p_contribution_year_month text,
  p_starts_at timestamptz,
  p_ends_at_exclusive timestamptz,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE='P0188';
  END IF;
  IF v_period.status NOT IN ('DRAFT','ACTIVE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen/finalized periods cannot be changed by the general period editor.' USING ERRCODE='P0180';
  END IF;
  IF p_status NOT IN ('DRAFT','ACTIVE') THEN
    RAISE EXCEPTION '[ARCADE] general period updates may set only DRAFT or ACTIVE.' USING ERRCODE='P0189';
  END IF;
  IF coalesce(btrim(p_display_name),'')='' OR char_length(btrim(p_display_name))>120 THEN
    RAISE EXCEPTION '[ARCADE] period display name must be 1 to 120 characters.' USING ERRCODE='P0184';
  END IF;
  IF p_ends_at_exclusive<=p_starts_at THEN
    RAISE EXCEPTION '[ARCADE] period end must be after its start.' USING ERRCODE='P0185';
  END IF;
  IF (v_period.period_kind='MONTHLY' AND coalesce(p_contribution_year_month,'')!~'^[0-9]{4}-(0[1-9]|1[0-2])$')
     OR (v_period.period_kind='SEASON' AND p_contribution_year_month IS NOT NULL) THEN
    RAISE EXCEPTION '[ARCADE] monthly periods require YYYY-MM; season periods must not have a contribution month.' USING ERRCODE='P0186';
  END IF;
  IF p_guild_season_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM public.guild_seasons gs
    WHERE gs.id=p_guild_season_id AND gs.classroom_id=v_classroom_id
  ) THEN
    RAISE EXCEPTION '[ARCADE] guild season does not belong to this classroom.' USING ERRCODE='P0187';
  END IF;
  UPDATE public.arcade_ranking_periods
  SET display_name=btrim(p_display_name),guild_season_id=p_guild_season_id,
      contribution_year_month=p_contribution_year_month,starts_at=p_starts_at,
      ends_at_exclusive=p_ends_at_exclusive,status=p_status
  WHERE id=v_period.id
  RETURNING * INTO v_period;
  RETURN jsonb_build_object('period_id',v_period.id,'classroom_id',v_period.classroom_id,'status',v_period.status);
END;
$$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_board_raw_pips(p_board jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum((die ->> 'value')::integer), 0)::integer
  FROM (
    SELECT value AS die FROM jsonb_array_elements(p_board -> 'top')
    UNION ALL
    SELECT value AS die FROM jsonb_array_elements(p_board -> 'middle')
    UNION ALL
    SELECT value AS die FROM jsonb_array_elements(p_board -> 'bottom')
  ) dice;
$$;

-- source: brand_2.0/supabase/migrations/20260912_03_tikatuka_official_ranking.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_competition_payload(
  p_classroom_id integer,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_general jsonb;
  v_official jsonb;
  v_my_general jsonb;
  v_my_official jsonb;
  v_active jsonb;
  v_recent jsonb;
BEGIN
  WITH levels AS (
    SELECT
      s.id AS student_id,
      s.name AS student_name,
      s.brand_name,
      coalesce(max(g.difficulty) FILTER (
        WHERE g.status = 'COMPLETED' AND g.server_winner = 'player'
      ), 0)::integer AS cleared_level
    FROM public.students s
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id = s.classroom_id AND g.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST')
      AND coalesce(s.is_test_account, false) = false
    GROUP BY s.id, s.name, s.brand_name
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY cleared_level DESC)::integer AS rank
    FROM levels
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'student_id', student_id,
    'student_name', student_name,
    'brand_name', brand_name,
    'cleared_level', cleared_level
  ) ORDER BY rank, student_name, student_id), '[]'::jsonb)
  INTO v_general
  FROM ranked;

  WITH eligible AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.period_key = v_period
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND s.transferred_at IS NULL
      AND coalesce(s.is_test_account, false) = false
  ), best AS (
    SELECT e.*, s.name AS student_name, s.brand_name
    FROM eligible e
    JOIN public.students s ON s.id = e.student_id
    WHERE e.pick = 1
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY difficulty DESC, points DESC)::integer AS rank
    FROM best
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank', rank,
    'student_id', student_id,
    'student_name', student_name,
    'brand_name', brand_name,
    'difficulty', difficulty,
    'wins', wins,
    'draws', draws,
    'losses', losses,
    'points', points,
    'ranking_score', difficulty * 16 + points,
    'completed_at', completed_at
  ) ORDER BY rank, student_name, student_id), '[]'::jsonb)
  INTO v_official
  FROM ranked;

  WITH levels AS (
    SELECT
      s.id AS student_id,
      coalesce(max(g.difficulty) FILTER (
        WHERE g.status = 'COMPLETED' AND g.server_winner = 'player'
      ), 0)::integer AS cleared_level
    FROM public.students s
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id = s.classroom_id AND g.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST')
      AND coalesce(s.is_test_account, false) = false
    GROUP BY s.id
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY cleared_level DESC)::integer AS rank
    FROM levels
  )
  SELECT jsonb_build_object('rank', rank, 'cleared_level', cleared_level)
  INTO v_my_general
  FROM ranked
  WHERE student_id = p_student_id;

  WITH eligible AS (
    SELECT os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.period_key = v_period
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND s.transferred_at IS NULL
      AND coalesce(s.is_test_account, false) = false
  ), best AS (
    SELECT * FROM eligible WHERE pick = 1
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY difficulty DESC, points DESC)::integer AS rank
    FROM best
  )
  SELECT jsonb_build_object(
    'rank', rank,
    'difficulty', difficulty,
    'wins', wins,
    'draws', draws,
    'losses', losses,
    'points', points,
    'ranking_score', difficulty * 16 + points,
    'completed_at', completed_at
  )
  INTO v_my_official
  FROM ranked
  WHERE student_id = p_student_id;

  SELECT jsonb_build_object(
    'session_id', id,
    'difficulty', difficulty,
    'games_played', games_played,
    'remaining_games', 5 - games_played,
    'wins', wins,
    'draws', draws,
    'losses', losses,
    'points', points,
    'started_at', started_at
  )
  INTO v_active
  FROM public.tikatuka_official_sessions
  WHERE classroom_id = p_classroom_id
    AND student_id = p_student_id
    AND period_key = v_period
    AND status = 'ACTIVE'
  ORDER BY started_at DESC, id DESC
  LIMIT 1;

  SELECT coalesce(jsonb_agg(item ORDER BY (item ->> 'completed_at') DESC), '[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'session_id', id,
      'difficulty', difficulty,
      'wins', wins,
      'draws', draws,
      'losses', losses,
      'points', points,
      'qualified', points >= 3,
      'ranking_score', CASE WHEN points >= 3 THEN difficulty * 16 + points ELSE NULL END,
      'completed_at', completed_at
    ) AS item
    FROM public.tikatuka_official_sessions
    WHERE classroom_id = p_classroom_id
      AND student_id = p_student_id
      AND period_key = v_period
      AND status = 'COMPLETED'
    ORDER BY completed_at DESC, id DESC
    LIMIT 5
  ) recent;

  RETURN jsonb_build_object(
    'period_key', to_char(v_period, 'YYYY-MM'),
    'general_leaderboard', v_general,
    'official_leaderboard', v_official,
    'my_general', v_my_general,
    'my_official', v_my_official,
    'active_challenge', v_active,
    'recent_challenges', v_recent,
    'rules', jsonb_build_object(
      'matches_per_challenge', 5,
      'win_points', 3,
      'draw_points', 1,
      'loss_points', 0,
      'minimum_qualifying_points', 3
    )
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_01_tikatuka_official_day_single_attempt.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_competition_payload_v2(
  p_classroom_id integer,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_base jsonb;
  v_open boolean := false;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_attempt_used boolean := false;
BEGIN
  v_base := public.tikatuka_competition_payload(p_classroom_id, p_student_id);

  SELECT w.is_open, w.opened_at, w.closed_at
  INTO v_open, v_opened_at, v_closed_at
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id = p_classroom_id
    AND w.period_key = v_period;

  v_open := coalesce(v_open, false);

  SELECT EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions s
    WHERE s.classroom_id = p_classroom_id
      AND s.student_id = p_student_id
      AND s.period_key = v_period
  )
  INTO v_attempt_used;

  RETURN v_base || jsonb_build_object(
    'official_window_open', v_open,
    'official_window_opened_at', v_opened_at,
    'official_window_closed_at', v_closed_at,
    'official_attempt_used', v_attempt_used,
    'official_can_start', v_open AND NOT v_attempt_used
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_02_tikatuka_align_arcade_periods.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_competition_payload_v3(p_classroom_id integer,p_student_id integer,p_period_id bigint) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$
DECLARE v_period public.arcade_ranking_periods; v_general jsonb; v_official jsonb; v_my_general jsonb; v_my_official jsonb; v_active jsonb; v_recent jsonb; v_open boolean:=false; v_opened_at timestamptz; v_closed_at timestamptz; v_attempt_used boolean:=false;
BEGIN
 SELECT * INTO v_period FROM public.arcade_ranking_periods p WHERE p.id=p_period_id AND p.classroom_id=p_classroom_id AND p.status IN('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED');
 IF v_period.id IS NULL THEN RAISE EXCEPTION '[TIKATUKA] selected Arcade ranking period was not found.' USING ERRCODE='PTK49'; END IF;
 WITH levels AS (SELECT s.id student_id,s.name student_name,s.brand_name,coalesce(max(g.difficulty) FILTER(WHERE g.server_winner='player'),0)::integer cleared_level FROM public.students s LEFT JOIN public.tikatuka_games g ON g.classroom_id=s.classroom_id AND g.student_id=s.id AND g.status='COMPLETED' AND g.completed_at>=v_period.starts_at AND g.completed_at<v_period.ends_at_exclusive WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL AND s.role::text IN('STUDENT','STUDENT_LEADER','GUARD','TEST') AND coalesce(s.is_test_account,false)=false GROUP BY s.id,s.name,s.brand_name), ranked AS(SELECT *,dense_rank() OVER(ORDER BY cleared_level DESC)::integer rank FROM levels) SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'student_id',student_id,'student_name',student_name,'brand_name',brand_name,'cleared_level',cleared_level) ORDER BY rank,student_name,student_id),'[]'::jsonb) INTO v_general FROM ranked;
 WITH eligible AS(SELECT os.*,row_number() OVER(PARTITION BY os.student_id ORDER BY os.difficulty DESC,os.points DESC,os.completed_at ASC,os.id ASC) pick FROM public.tikatuka_official_sessions os JOIN public.students s ON s.id=os.student_id WHERE os.classroom_id=p_classroom_id AND os.arcade_period_id=p_period_id AND os.status='COMPLETED' AND os.points>=3 AND s.transferred_at IS NULL AND coalesce(s.is_test_account,false)=false),best AS(SELECT e.*,s.name student_name,s.brand_name FROM eligible e JOIN public.students s ON s.id=e.student_id WHERE e.pick=1),ranked AS(SELECT *,dense_rank() OVER(ORDER BY difficulty DESC,points DESC)::integer rank FROM best) SELECT coalesce(jsonb_agg(jsonb_build_object('rank',rank,'student_id',student_id,'student_name',student_name,'brand_name',brand_name,'difficulty',difficulty,'wins',wins,'draws',draws,'losses',losses,'points',points,'ranking_score',difficulty*16+points,'completed_at',completed_at) ORDER BY rank,student_name,student_id),'[]'::jsonb) INTO v_official FROM ranked;
 WITH levels AS(SELECT s.id student_id,coalesce(max(g.difficulty) FILTER(WHERE g.server_winner='player'),0)::integer cleared_level FROM public.students s LEFT JOIN public.tikatuka_games g ON g.classroom_id=s.classroom_id AND g.student_id=s.id AND g.status='COMPLETED' AND g.completed_at>=v_period.starts_at AND g.completed_at<v_period.ends_at_exclusive WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL AND s.role::text IN('STUDENT','STUDENT_LEADER','GUARD','TEST') AND coalesce(s.is_test_account,false)=false GROUP BY s.id),ranked AS(SELECT *,dense_rank() OVER(ORDER BY cleared_level DESC)::integer rank FROM levels) SELECT jsonb_build_object('rank',rank,'cleared_level',cleared_level) INTO v_my_general FROM ranked WHERE student_id=p_student_id;
 WITH best AS(SELECT os.*,row_number() OVER(PARTITION BY os.student_id ORDER BY os.difficulty DESC,os.points DESC,os.completed_at ASC,os.id ASC) pick FROM public.tikatuka_official_sessions os JOIN public.students s ON s.id=os.student_id WHERE os.classroom_id=p_classroom_id AND os.arcade_period_id=p_period_id AND os.status='COMPLETED' AND os.points>=3 AND s.transferred_at IS NULL AND coalesce(s.is_test_account,false)=false),chosen AS(SELECT * FROM best WHERE pick=1),ranked AS(SELECT *,dense_rank() OVER(ORDER BY difficulty DESC,points DESC)::integer rank FROM chosen) SELECT jsonb_build_object('rank',rank,'difficulty',difficulty,'wins',wins,'draws',draws,'losses',losses,'points',points,'ranking_score',difficulty*16+points,'completed_at',completed_at) INTO v_my_official FROM ranked WHERE student_id=p_student_id;
 SELECT jsonb_build_object('session_id',id,'difficulty',difficulty,'games_played',games_played,'remaining_games',5-games_played,'wins',wins,'draws',draws,'losses',losses,'points',points,'started_at',started_at) INTO v_active FROM public.tikatuka_official_sessions WHERE classroom_id=p_classroom_id AND student_id=p_student_id AND arcade_period_id=p_period_id AND status='ACTIVE' LIMIT 1;
 SELECT coalesce(jsonb_agg(item ORDER BY(item->>'completed_at') DESC),'[]'::jsonb) INTO v_recent FROM(SELECT jsonb_build_object('session_id',id,'difficulty',difficulty,'wins',wins,'draws',draws,'losses',losses,'points',points,'qualified',points>=3,'ranking_score',CASE WHEN points>=3 THEN difficulty*16+points ELSE NULL END,'completed_at',completed_at) item FROM public.tikatuka_official_sessions WHERE classroom_id=p_classroom_id AND student_id=p_student_id AND arcade_period_id=p_period_id AND status='COMPLETED' ORDER BY completed_at DESC,id DESC LIMIT 5) recent;
 SELECT w.is_open,w.opened_at,w.closed_at INTO v_open,v_opened_at,v_closed_at FROM public.tikatuka_official_windows w WHERE w.classroom_id=p_classroom_id AND w.arcade_period_id=p_period_id;
 SELECT EXISTS(SELECT 1 FROM public.tikatuka_official_sessions s WHERE s.classroom_id=p_classroom_id AND s.student_id=p_student_id AND s.arcade_period_id=p_period_id) INTO v_attempt_used;
 RETURN jsonb_build_object('period_id',v_period.id,'period_key',coalesce(v_period.contribution_year_month,to_char(v_period.starts_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')),'period_display_name',v_period.display_name,'period_kind',v_period.period_kind,'period_status',v_period.status,'period_starts_at',v_period.starts_at,'period_ends_at_exclusive',v_period.ends_at_exclusive,'general_leaderboard',v_general,'official_leaderboard',v_official,'my_general',v_my_general,'my_official',v_my_official,'active_challenge',v_active,'recent_challenges',v_recent,'official_window_open',coalesce(v_open,false),'official_window_opened_at',v_opened_at,'official_window_closed_at',v_closed_at,'official_attempt_used',v_attempt_used,'official_can_start',coalesce(v_open,false) AND NOT v_attempt_used AND v_period.status='ACTIVE' AND now()>=v_period.starts_at AND now()<v_period.ends_at_exclusive,'rules',jsonb_build_object('matches_per_challenge',5,'win_points',3,'draw_points',1,'loss_points',0,'minimum_qualifying_points',3));
END; $$;

-- source: brand_2.0/supabase/migrations/20260913_02_tikatuka_align_arcade_periods.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_guard_active_official_difficulty() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ DECLARE v_difficulty integer; BEGIN SELECT s.difficulty INTO v_difficulty FROM public.tikatuka_official_sessions s WHERE s.classroom_id=NEW.classroom_id AND s.student_id=NEW.student_id AND s.status='ACTIVE' ORDER BY s.started_at DESC,s.id DESC LIMIT 1; IF v_difficulty IS NOT NULL AND NEW.difficulty<>v_difficulty THEN RAISE EXCEPTION '[TIKATUKA] official challenge is active at difficulty %; new games must use the same difficulty.',v_difficulty USING ERRCODE='PTK43'; END IF; RETURN NEW; END; $$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_guard_game_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[TIKATUKA] game history is immutable.' USING ERRCODE = 'PTK20';
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION '[TIKATUKA] completed game history is immutable.' USING ERRCODE = 'PTK20';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.classroom_id IS DISTINCT FROM OLD.classroom_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
     OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION '[TIKATUKA] issued game identity is immutable.' USING ERRCODE = 'PTK20';
  END IF;

  IF NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION '[TIKATUKA] READY games may only transition to COMPLETED.' USING ERRCODE = 'PTK20';
  END IF;

  RETURN NEW;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_02_tikatuka_align_arcade_periods.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_official_window_admin_payload(p_classroom_id integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path=public,pg_temp AS $$ DECLARE v_period public.arcade_ranking_periods; v_open boolean:=false; v_opened_at timestamptz; v_closed_at timestamptz; v_started integer:=0; v_completed integer:=0; BEGIN v_period:=public.tikatuka_current_arcade_period(p_classroom_id); IF v_period.id IS NULL THEN RETURN jsonb_build_object('period_key',to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM'),'period_id',NULL,'period_display_name',NULL,'is_open',false,'opened_at',NULL,'closed_at',NULL,'started_count',0,'completed_count',0); END IF; SELECT w.is_open,w.opened_at,w.closed_at INTO v_open,v_opened_at,v_closed_at FROM public.tikatuka_official_windows w WHERE w.classroom_id=p_classroom_id AND w.arcade_period_id=v_period.id; SELECT count(*)::integer,count(*) FILTER(WHERE os.status='COMPLETED')::integer INTO v_started,v_completed FROM public.tikatuka_official_sessions os JOIN public.students s ON s.id=os.student_id WHERE os.classroom_id=p_classroom_id AND os.arcade_period_id=v_period.id AND s.transferred_at IS NULL AND coalesce(s.is_test_account,false)=false; RETURN jsonb_build_object('period_key',coalesce(v_period.contribution_year_month,to_char(v_period.starts_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')),'period_id',v_period.id,'period_display_name',v_period.display_name,'is_open',coalesce(v_open,false),'opened_at',v_opened_at,'closed_at',v_closed_at,'started_count',coalesce(v_started,0),'completed_count',coalesce(v_completed,0)); END; $$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_progress_payload(
  p_classroom_id integer,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_highest integer;
  v_cleared smallint[];
  v_games integer;
  v_wins integer;
  v_losses integer;
  v_draws integer;
  v_last_played timestamptz;
BEGIN
  SELECT highest_unlocked_difficulty
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = p_classroom_id AND student_id = p_student_id;

  v_highest := coalesce(v_highest, 1);

  SELECT
    coalesce(array_agg(DISTINCT difficulty ORDER BY difficulty)
      FILTER (WHERE server_winner = 'player'), ARRAY[]::smallint[]),
    count(*)::integer,
    count(*) FILTER (WHERE server_winner = 'player')::integer,
    count(*) FILTER (WHERE server_winner = 'ai')::integer,
    count(*) FILTER (WHERE server_winner = 'draw')::integer,
    max(completed_at)
  INTO v_cleared, v_games, v_wins, v_losses, v_draws, v_last_played
  FROM public.tikatuka_games
  WHERE classroom_id = p_classroom_id
    AND student_id = p_student_id
    AND status = 'COMPLETED';

  RETURN jsonb_build_object(
    'highest_unlocked_difficulty', v_highest,
    'cleared_difficulties', to_jsonb(v_cleared),
    'games_played', coalesce(v_games, 0),
    'wins', coalesce(v_wins, 0),
    'losses', coalesce(v_losses, 0),
    'draws', coalesce(v_draws, 0),
    'last_played_at', v_last_played
  );
END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_05_tikatuka_win_gate_progression.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_required_wins_for_unlock(p_difficulty integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_difficulty BETWEEN 1 AND 6 THEN 1
    WHEN p_difficulty IN (7, 8) THEN 2
    WHEN p_difficulty = 9 THEN 3
    WHEN p_difficulty = 10 THEN 0
    ELSE NULL
  END;
$$;

-- source: brand_2.0/supabase/migrations/20260913_03_tikatuka_official_top10_guild2.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_resolve_period_official_ranks(
  p_classroom_id integer,
  p_period_id bigint
)
RETURNS TABLE(
  source_session_id bigint,
  student_id integer,
  difficulty smallint,
  wins smallint,
  draws smallint,
  losses smallint,
  points smallint,
  completed_at timestamptz,
  rank integer,
  ranking_score integer,
  raw_bonus numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH eligible AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.arcade_period_id = p_period_id
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND s.transferred_at IS NULL
      AND coalesce(s.is_test_account, false) = false
  ), best AS (
    SELECT * FROM eligible WHERE pick = 1
  ), ranked AS (
    SELECT
      b.*,
      dense_rank() OVER (ORDER BY b.difficulty DESC, b.points DESC)::integer AS official_rank
    FROM best b
  )
  SELECT
    r.id AS source_session_id,
    r.student_id,
    r.difficulty,
    r.wins,
    r.draws,
    r.losses,
    r.points,
    r.completed_at,
    r.official_rank AS rank,
    (r.difficulty * 16 + r.points)::integer AS ranking_score,
    CASE
      WHEN r.official_rank = 1 THEN 30::numeric
      WHEN r.official_rank = 2 THEN 27::numeric
      WHEN r.official_rank = 3 THEN 24::numeric
      WHEN r.official_rank BETWEEN 4 AND 6 THEN 18::numeric
      WHEN r.official_rank BETWEEN 7 AND 10 THEN 15::numeric
      ELSE NULL::numeric
    END AS raw_bonus
  FROM ranked r
  ORDER BY r.official_rank, r.completed_at, r.id;
$function$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_row_score(p_row jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(face_value * CASE face_count WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 5 ELSE 0 END), 0)::integer
  FROM (
    SELECT (die ->> 'value')::integer AS face_value, count(*)::integer AS face_count
    FROM jsonb_array_elements(p_row) AS die
    GROUP BY (die ->> 'value')::integer
  ) grouped_faces;
$$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260912_01_tikatuka_progress_results.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.tikatuka_validate_final_boards(p_boards jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_side text;
  v_row text;
  v_board jsonb;
  v_row_data jsonb;
  v_die jsonb;
BEGIN
  IF p_boards IS NULL OR jsonb_typeof(p_boards) <> 'object' THEN
    RAISE EXCEPTION '[TIKATUKA] final boards must be an object.' USING ERRCODE = 'PTK10';
  END IF;

  FOREACH v_side IN ARRAY ARRAY['player', 'ai'] LOOP
    v_board := p_boards -> v_side;
    IF v_board IS NULL OR jsonb_typeof(v_board) <> 'object' THEN
      RAISE EXCEPTION '[TIKATUKA] final board is missing side %.', v_side USING ERRCODE = 'PTK10';
    END IF;

    FOREACH v_row IN ARRAY ARRAY['top', 'middle', 'bottom'] LOOP
      v_row_data := v_board -> v_row;
      IF v_row_data IS NULL
         OR jsonb_typeof(v_row_data) <> 'array'
         OR jsonb_array_length(v_row_data) <> 3 THEN
        RAISE EXCEPTION '[TIKATUKA] final row %.% must contain exactly 3 dice.', v_side, v_row USING ERRCODE = 'PTK10';
      END IF;

      FOR v_die IN SELECT value FROM jsonb_array_elements(v_row_data) LOOP
        IF jsonb_typeof(v_die) <> 'object'
           OR coalesce(v_die ->> 'value', '') !~ '^[1-6]$'
           OR coalesce(v_die ->> 'kind', '') NOT IN ('normal', 'shield') THEN
          RAISE EXCEPTION '[TIKATUKA] final board contains an invalid die.' USING ERRCODE = 'PTK10';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

-- source: brand_2.0/supabase/migrations/20260912_03_tikatuka_official_ranking.sql  [prod md5 match]
CREATE OR REPLACE FUNCTION public.z_tikatuka_advance_official_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_points integer;
BEGIN
  IF OLD.status = 'READY'
     AND NEW.status = 'COMPLETED'
     AND NEW.official_session_id IS NOT NULL THEN
    v_points := CASE NEW.server_winner
      WHEN 'player' THEN 3
      WHEN 'draw' THEN 1
      ELSE 0
    END;

    UPDATE public.tikatuka_official_sessions s
    SET
      games_played = s.games_played + 1,
      wins = s.wins + CASE WHEN NEW.server_winner = 'player' THEN 1 ELSE 0 END,
      draws = s.draws + CASE WHEN NEW.server_winner = 'draw' THEN 1 ELSE 0 END,
      losses = s.losses + CASE WHEN NEW.server_winner = 'ai' THEN 1 ELSE 0 END,
      points = s.points + v_points,
      status = CASE WHEN s.games_played + 1 >= 5 THEN 'COMPLETED' ELSE 'ACTIVE' END,
      completed_at = CASE WHEN s.games_played + 1 >= 5 THEN now() ELSE NULL END
    WHERE s.id = NEW.official_session_id
      AND s.status = 'ACTIVE'
      AND s.games_played < 5;
  END IF;

  RETURN NULL;
END;
$$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.a_tikatuka_capture_official_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_session public.tikatuka_official_sessions;
begin
  if OLD.status = 'READY' and NEW.status = 'COMPLETED' then
    select os.*
    into v_session
    from public.tikatuka_official_sessions os
    join public.arcade_ranking_periods p
      on p.id = os.arcade_period_id
    where os.classroom_id = OLD.classroom_id
      and os.student_id = OLD.student_id
      and os.status = 'ACTIVE'
      and os.difficulty = OLD.difficulty
      and OLD.issued_at >= os.started_at
      and os.games_played < 5
      and p.status in ('ACTIVE', 'VERIFICATION', 'READY_TO_FINALIZE')
    order by os.started_at desc, os.id desc
    limit 1
    for update of os;

    if v_session.id is not null then
      NEW.official_session_id := v_session.id;
      NEW.official_match_number := v_session.games_played + 1;
    end if;
  end if;

  return NEW;
end;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.arcade_capture_verification_attempt(p_run_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.arcade_runs%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_used integer;
  v_valid boolean;
  v_result jsonb;
BEGIN
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id;
  IF NOT FOUND OR v_run.run_context <> 'VERIFICATION' THEN
    RETURN jsonb_build_object('captured',false,'reason','NOT_VERIFICATION');
  END IF;
  IF v_run.status NOT IN ('VERIFIED','REJECTED') THEN
    RETURN jsonb_build_object('captured',false,'reason','NOT_TERMINAL');
  END IF;

  SELECT * INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE run_id=v_run.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.' USING ERRCODE='P0254';
  END IF;

  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session is missing.' USING ERRCODE='P0255';
  END IF;

  -- IMPORTANT:
  -- Do not lock the shared ranking-period row for every student's attempt.
  -- Concurrent students must be able to finish verification attempts independently.
  -- Final period mutation remains serialized inside the finalization/readiness path.
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE='P0216';
  END IF;

  -- Per-student / per-attempt locks are retained.
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id
  FOR UPDATE;

  SELECT * INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE id=v_attempt.id
  FOR UPDATE;

  IF v_attempt.status = 'TERMINAL' AND v_attempt.consumed THEN
    RETURN jsonb_build_object('captured',true,'already_captured',true,'attempt_id',v_attempt.id);
  END IF;
  IF v_attempt.status IN ('TECHNICAL_CANCELLED','RESTORED') THEN
    RETURN jsonb_build_object('captured',false,'reason',v_attempt.status);
  END IF;
  IF v_session.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session is missing.' USING ERRCODE='P0255';
  END IF;

  v_valid := v_run.status='VERIFIED' AND v_run.official_score IS NOT NULL;

  UPDATE public.arcade_verification_attempts
  SET status='TERMINAL', consumed=true, valid_run=v_valid,
      terminal_outcome=CASE WHEN v_valid THEN 'VERIFIED' ELSE coalesce(v_run.rejection_code,'REJECTED') END,
      official_score=CASE WHEN v_valid THEN v_run.official_score ELSE NULL END,
      official_duration_ms=CASE WHEN v_valid THEN v_run.official_duration_ms ELSE NULL END,
      stats=CASE WHEN v_valid THEN v_run.stats ELSE '{}'::jsonb END,
      terminal_at=now()
  WHERE id=v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_valid
     AND v_session.verification_threshold IS NOT NULL
     AND v_run.official_score >= v_session.verification_threshold THEN
    UPDATE public.arcade_verification_sessions
    SET success_achieved=true
    WHERE id=v_session.id;
    v_session.success_achieved := true;
  END IF;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_attempt.id,
    'ATTEMPT_TERMINAL',
    jsonb_build_object(
      'run_id',v_run.id,
      'opportunity_number',v_attempt.opportunity_number,
      'valid_run',v_valid,
      'outcome',v_attempt.terminal_outcome,
      'official_score',v_attempt.official_score
    ),
    auth.uid()
  );

  SELECT count(*)::integer INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id AND a.consumed;

  IF v_used >= v_session.max_attempts THEN
    v_result := public.arcade_finalize_verification_session(v_session.id);
  END IF;

  RETURN jsonb_build_object(
    'captured',true,
    'attempt_id',v_attempt.id,
    'consumed_attempts',v_used,
    'success_achieved',v_session.success_achieved,
    'session_result',v_result
  );
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.arcade_refresh_verification_readiness(p_classroom_id integer, p_period_id bigint)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game record;
  v_game_missing bigint;
  v_active_sessions bigint := 0;
  v_missing bigint := 0;
  v_next text;
BEGIN
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = p_classroom_id
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE = 'P0250';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' OR v_period.status = 'FINALIZED' THEN
    RETURN v_period.status;
  END IF;

  SELECT count(*) INTO v_active_sessions
  FROM public.arcade_verification_sessions s
  WHERE s.classroom_id = p_classroom_id
    AND s.period_id = v_period.id
    AND s.status = 'ACTIVE';

  FOR v_game IN
    SELECT pg.game_id, pg.target_rank_count
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id = v_period.id
    ORDER BY pg.game_id
  LOOP
    SELECT count(*) INTO v_game_missing
    FROM public.arcade_resolve_period_student_ranks(p_classroom_id, v_period.id, v_game.game_id) r
    WHERE r.rank <= v_game.target_rank_count
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_verification_official_results o
        WHERE o.period_id = v_period.id
          AND o.game_id = v_game.game_id
          AND o.student_id = r.student_id
      );
    v_missing := v_missing + v_game_missing;
  END LOOP;

  v_next := CASE WHEN v_missing = 0 AND v_active_sessions = 0 THEN 'READY_TO_FINALIZE' ELSE 'VERIFICATION' END;
  IF v_period.status IS DISTINCT FROM v_next THEN
    UPDATE public.arcade_ranking_periods
    SET status = v_next
    WHERE id = v_period.id
      AND status IN ('VERIFICATION','READY_TO_FINALIZE');
  END IF;
  RETURN v_next;
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.current_classroom_id()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_classroom_id INTEGER;
BEGIN
    SELECT classroom_id INTO v_classroom_id
    FROM students
    WHERE user_id = auth.uid()
      AND transferred_at IS NULL;

    IF v_classroom_id IS NULL THEN
        SELECT id INTO v_classroom_id
        FROM classrooms
        WHERE teacher_user_id = auth.uid()
          AND is_active = TRUE
        LIMIT 1;
    END IF;

    RETURN v_classroom_id;
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.current_student_id()
 RETURNS integer
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_student_id INTEGER;
BEGIN
    SELECT id INTO v_student_id
    FROM students
    WHERE user_id = auth.uid()
      AND transferred_at IS NULL;

    RETURN v_student_id;
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.ensure_teacher_role()
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT is_teacher_or_admin() THEN
        RAISE EXCEPTION 'Permission denied: teacher or admin only'
            USING ERRCODE = 'P0511';
    END IF;
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.is_teacher_or_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM students
        WHERE user_id = auth.uid()
          AND role IN ('TEACHER', 'ADMIN')
          AND transferred_at IS NULL
    ) OR EXISTS (
        SELECT 1 FROM classrooms
        WHERE teacher_user_id = auth.uid()
          AND is_active = TRUE
    );
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.records_arcade_snapshot_game_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_code text;
  v_name text;
begin
  select game.code, game.internal_name into v_code, v_name
  from public.arcade_games game where game.id = new.game_id;
  if v_code is null then
    raise exception '[RECORDS] Arcade game identity missing for monthly snapshot.' using errcode='P0940';
  end if;
  new.game_code_at_close := coalesce(new.game_code_at_close, v_code);
  new.game_name_at_close := coalesce(new.game_name_at_close, v_name);
  return new;
end;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.records_arcade_snapshot_student_identity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_name text;
  v_brand text;
begin
  select student.name, student.brand_name into v_name, v_brand
  from public.students student where student.id = new.student_id;
  if v_name is null then
    raise exception '[RECORDS] Arcade student identity missing for monthly snapshot.' using errcode='P0941';
  end if;
  new.student_name_at_close := coalesce(new.student_name_at_close, v_name);
  new.brand_name_at_close := coalesce(new.brand_name_at_close, v_brand);
  return new;
end;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.student_get_arcade_verification_state(p_game_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer:=public.current_classroom_id();
  v_student_id integer:=public.current_student_id();
  v_game_id bigint;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_used integer;
  v_active_run_id bigint;
  v_rank integer;
BEGIN
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195'; END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  SELECT s.* INTO v_session
  FROM public.arcade_verification_sessions s
  JOIN public.arcade_ranking_periods p ON p.id=s.period_id
  WHERE s.classroom_id=v_classroom_id AND s.student_id=v_student_id AND s.game_id=v_game_id
    AND p.status IN ('VERIFICATION','READY_TO_FINALIZE')
    AND s.status IN ('ACTIVE','COMPLETED')
  ORDER BY (s.status='ACTIVE') DESC,s.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('available',false,'game_code',p_game_code); END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_session.period_id;
  SELECT count(*)::integer INTO v_used FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id AND a.consumed;
  SELECT r.id INTO v_active_run_id FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') ORDER BY r.id DESC LIMIT 1;
  SELECT r.rank INTO v_rank FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_session.period_id,v_game_id) r WHERE r.student_id=v_student_id;
  RETURN jsonb_build_object(
    'available',true,'game_code',p_game_code,'period_id',v_period.id,'period_name',v_period.display_name,'period_status',v_period.status,
    'session_id',v_session.id,'session_status',v_session.status,'has_provisional_record',(v_session.provisional_entry_id IS NOT NULL),
    'provisional_score',v_session.provisional_score,
    'verification_threshold',v_session.verification_threshold,'threshold_percent',v_session.threshold_percent,
    'max_attempts',v_session.max_attempts,'used_attempts',v_used,'remaining_attempts',greatest(v_session.max_attempts-v_used,0),
    'success_achieved',v_session.success_achieved,'result_status',v_session.result_status,'current_rank',v_rank,
    'active_run_id',v_active_run_id,
    'can_attempt',(v_session.status='ACTIVE' AND v_used<v_session.max_attempts AND v_active_run_id IS NULL),
    'attempts',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'attempt_id',a.id,'issue_number',a.issue_number,'opportunity_number',a.opportunity_number,'run_id',a.run_id,
      'status',a.status,'consumed',a.consumed,'valid_run',a.valid_run,'terminal_outcome',a.terminal_outcome,
      'official_score',a.official_score,'issued_at',a.issued_at,'terminal_at',a.terminal_at
    ) ORDER BY a.issue_number) FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id),'[]'::jsonb)
  );
END;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.tikatuka_current_arcade_period(p_classroom_id integer)
 RETURNS arcade_ranking_periods
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p.*
  from public.arcade_ranking_periods p
  where p.classroom_id = p_classroom_id
    and p.status in ('ACTIVE', 'VERIFICATION', 'READY_TO_FINALIZE')
    and now() >= p.starts_at
    and (p.status <> 'ACTIVE' or now() < p.ends_at_exclusive)
  order by
    (p.status in ('VERIFICATION', 'READY_TO_FINALIZE')) desc,
    (p.period_kind = 'MONTHLY') desc,
    p.starts_at desc,
    p.id desc
  limit 1;
$function$;

-- source: production pg_get_functiondef (batch1.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.tikatuka_enforce_win_gate_progression()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_source_difficulty integer;
  v_required_wins integer;
  v_actual_wins integer;
  v_override text := current_setting('app.tikatuka_progress_override', true);
BEGIN
  IF NEW.highest_unlocked_difficulty <= OLD.highest_unlocked_difficulty THEN
    RETURN NEW;
  END IF;

  IF v_override = 'teacher' THEN
    RETURN NEW;
  END IF;

  IF NEW.highest_unlocked_difficulty > OLD.highest_unlocked_difficulty + 1 THEN
    NEW.highest_unlocked_difficulty := OLD.highest_unlocked_difficulty + 1;
  END IF;

  v_source_difficulty := NEW.highest_unlocked_difficulty - 1;
  v_required_wins := public.tikatuka_required_wins_for_unlock(v_source_difficulty);

  IF v_required_wins IS NULL OR v_required_wins <= 0 THEN
    NEW.highest_unlocked_difficulty := OLD.highest_unlocked_difficulty;
    RETURN NEW;
  END IF;

  SELECT count(*)::integer
  INTO v_actual_wins
  FROM public.tikatuka_games g
  WHERE g.classroom_id = NEW.classroom_id
    AND g.student_id = NEW.student_id
    AND g.status = 'COMPLETED'
    AND g.server_winner = 'player'
    AND g.difficulty = v_source_difficulty;

  IF coalesce(v_actual_wins, 0) < v_required_wins THEN
    NEW.highest_unlocked_difficulty := OLD.highest_unlocked_difficulty;
  END IF;

  RETURN NEW;
END;
$function$;

-- source: production pg_get_functiondef (batch2.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.arcade_finalize_verification_session(p_session_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_has_provisional boolean := false;
  v_used integer;
  v_best record;
  v_result_kind text;
  v_result_status text;
  v_source_run_id bigint;
  v_score bigint;
  v_duration integer;
  v_stats jsonb := '{}'::jsonb;
  v_achieved_at timestamptz;
  v_eligible boolean := true;
  v_period_status text;
BEGIN
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session not found.' USING ERRCODE = 'P0251';
  END IF;
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = v_session.period_id
    AND classroom_id = v_session.classroom_id
  FOR NO KEY UPDATE;
  IF NOT FOUND OR v_period.status = 'FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE = 'P0216';
  END IF;
  SELECT * INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF v_session.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('session_id',v_session.id,'status',v_session.status,'result_status',v_session.result_status);
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arcade_runs r
    WHERE r.verification_session_id = v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] a verification run is still in progress.' USING ERRCODE = 'P0268';
  END IF;

  SELECT count(*)::integer INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id = v_session.id AND a.consumed;
  IF NOT v_session.success_achieved AND v_used < v_session.max_attempts THEN
    RAISE EXCEPTION '[ARCADE VERIFY] remaining attempts exist and success has not been reached.' USING ERRCODE = 'P0252';
  END IF;

  IF v_session.provisional_entry_id IS NOT NULL THEN
    SELECT * INTO v_provisional
    FROM public.arcade_verification_provisional_entries p
    WHERE p.id = v_session.provisional_entry_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[ARCADE VERIFY] frozen provisional source is missing.' USING ERRCODE = 'P0253';
    END IF;
    v_has_provisional := true;
  END IF;

  SELECT a.run_id, a.official_score, a.official_duration_ms, a.stats, r.game_over_at
  INTO v_best
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_runs r ON r.id = a.run_id
  WHERE a.session_id = v_session.id
    AND a.status = 'TERMINAL'
    AND a.consumed
    AND a.valid_run
    AND a.official_score IS NOT NULL
  ORDER BY a.official_score DESC, r.game_over_at ASC, a.run_id ASC
  LIMIT 1;

  IF NOT v_has_provisional AND v_best.run_id IS NOT NULL THEN
    v_result_status := 'SUCCESS';
    v_result_kind := 'SESSION_SUCCESS_VERIFICATION';
    v_source_run_id := v_best.run_id;
    v_score := v_best.official_score;
    v_duration := v_best.official_duration_ms;
    v_stats := v_best.stats;
    v_achieved_at := v_best.game_over_at;
  ELSIF v_session.success_achieved THEN
    v_result_status := 'SUCCESS';
    IF v_best.run_id IS NOT NULL AND v_best.official_score > v_provisional.official_score THEN
      v_result_kind := 'SESSION_SUCCESS_VERIFICATION';
      v_source_run_id := v_best.run_id;
      v_score := v_best.official_score;
      v_duration := v_best.official_duration_ms;
      v_stats := v_best.stats;
      v_achieved_at := v_best.game_over_at;
    ELSE
      v_result_kind := 'SESSION_SUCCESS_PROVISIONAL';
      v_source_run_id := v_provisional.source_run_id;
      v_score := v_provisional.official_score;
      v_duration := v_provisional.official_duration_ms;
      v_stats := v_provisional.stats;
      v_achieved_at := v_provisional.achieved_at;
    END IF;
  ELSIF v_best.run_id IS NOT NULL THEN
    v_result_status := 'FAILURE_VALID';
    v_result_kind := 'SESSION_FAILURE_VERIFICATION';
    v_source_run_id := v_best.run_id;
    v_score := v_best.official_score;
    v_duration := v_best.official_duration_ms;
    v_stats := v_best.stats;
    v_achieved_at := v_best.game_over_at;
  ELSE
    v_result_status := 'FAILURE_NO_VALID';
    v_result_kind := 'SESSION_FAILURE_NO_VALID';
    v_source_run_id := NULL;
    v_score := NULL;
    v_duration := NULL;
    v_stats := '{}'::jsonb;
    v_achieved_at := NULL;
    v_eligible := false;
  END IF;

  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,
    decided_by_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_result_kind,
    v_source_run_id,v_score,v_duration,v_stats,v_achieved_at,v_eligible,auth.uid()
  )
  ON CONFLICT (period_id,game_id,student_id) DO UPDATE SET
    session_id=EXCLUDED.session_id,
    decision_kind=EXCLUDED.decision_kind,
    source_run_id=EXCLUDED.source_run_id,
    official_score=EXCLUDED.official_score,
    official_duration_ms=EXCLUDED.official_duration_ms,
    stats=EXCLUDED.stats,
    achieved_at=EXCLUDED.achieved_at,
    ranking_eligible=EXCLUDED.ranking_eligible,
    decided_by_user_id=EXCLUDED.decided_by_user_id,
    decided_at=now(),
    updated_at=now();

  UPDATE public.arcade_verification_sessions
  SET status='COMPLETED', result_status=v_result_status, ended_at=now()
  WHERE id=v_session.id;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,
    'SESSION_COMPLETED',
    jsonb_build_object('result_status',v_result_status,'decision_kind',v_result_kind,'source_run_id',v_source_run_id,'official_score',v_score,'had_provisional_record',v_has_provisional),
    auth.uid()
  );

  v_period_status := public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object(
    'session_id',v_session.id,'status','COMPLETED','result_status',v_result_status,
    'decision_kind',v_result_kind,'official_source_run_id',v_source_run_id,
    'official_score',v_score,'ranking_eligible',v_eligible,'period_status',v_period_status
  );
END;
$function$;

-- source: production pg_get_functiondef (batch2.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_seed bigint;
  v_seoul_today date;
  v_public_available boolean;
  v_is_prerelease_test boolean := false;
  v_is_live_test_agent boolean := false;
  v_daily_attempt_limit integer := 50;
  v_daily_attempt_used integer := 0;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;
  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_start := v_seoul_today::timestamp AT TIME ZONE 'Asia/Seoul';
  v_day_end := (v_seoul_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul';

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
  END IF;

  v_public_available := v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);
  IF NOT v_public_available THEN
    IF v_seoul_today >= v_game.available_from THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_is_prerelease_test;

    IF NOT v_is_prerelease_test THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;
  END IF;

  v_is_live_test_agent := public.is_live_test_agent(v_student_id);
  v_is_prerelease_test := v_is_prerelease_test OR v_is_live_test_agent;

  IF v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN
    PERFORM 1 FROM public.students student_row WHERE student_row.id = v_student_id FOR UPDATE;

    SELECT count(*)::integer
    INTO v_daily_attempt_used
    FROM public.arcade_runs run
    WHERE run.student_id = v_student_id
      AND run.game_id = v_game.id
      AND run.run_context = 'STANDARD'
      AND run.created_at >= v_day_start
      AND run.created_at < v_day_end;

    IF v_daily_attempt_used >= v_daily_attempt_limit THEN
      RAISE EXCEPTION '[ARCADE GAME02] daily challenge limit reached (50/KST day).' USING ERRCODE = 'P0274';
    END IF;
  END IF;

  SELECT * INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id = v_game.id AND is_active
  ORDER BY id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] active game rule version is missing.' USING ERRCODE = 'P0198';
  END IF;

  v_seed := public.arcade_generate_run_seed();

  INSERT INTO public.arcade_runs (
    classroom_id, student_id, game_id, rule_version_id, status,
    schedule_seed, countdown_started_at, is_prerelease_test
  ) VALUES (
    v_classroom_id, v_student_id, v_game.id, v_rule.id, 'COUNTDOWN',
    v_seed, now(), v_is_prerelease_test
  ) RETURNING * INTO v_run;

  IF v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN
    v_daily_attempt_used := v_daily_attempt_used + 1;
  END IF;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'game_code', v_game.code,
    'rule_version', v_rule.version_code,
    'countdown_started_at', v_run.countdown_started_at,
    'countdown_ends_at', v_run.countdown_started_at + ((v_rule.config ->> 'countdown_ms')::integer * interval '1 millisecond'),
    'schedule_seed', v_run.schedule_seed,
    'config', v_rule.config,
    'is_prerelease_test', v_run.is_prerelease_test,
    'daily_attempt_limit', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_limit ELSE NULL END,
    'daily_attempt_used', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_used ELSE NULL END,
    'daily_attempt_remaining', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN greatest(v_daily_attempt_limit - v_daily_attempt_used, 0) ELSE NULL END,
    'daily_attempt_resets_at', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_day_end ELSE NULL END
  );
END;
$function$;

-- source: production pg_get_functiondef (batch2.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.student_create_arcade_verification_run(p_session_id bigint, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_game public.arcade_games%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_used integer;
  v_issue integer;
  v_opportunity integer;
  v_seed bigint;
BEGIN
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195'; END IF;
  IF p_idempotency_key IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] idempotency key is required.' USING ERRCODE='P0208'; END IF;
  SELECT a.* INTO v_attempt
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_verification_sessions s ON s.id=a.session_id
  WHERE a.idempotency_key=p_idempotency_key
    AND s.classroom_id=v_classroom_id
    AND s.student_id=v_student_id;
  IF FOUND THEN
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,'verification_opportunity_number',v_attempt.opportunity_number);
  END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM v_classroom_id OR v_session.student_id IS DISTINCT FROM v_student_id OR v_session.status<>'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session not found for this student.' USING ERRCODE='P0255';
  END IF;
  SELECT a.* INTO v_attempt
  FROM public.arcade_verification_attempts a
  WHERE a.idempotency_key=p_idempotency_key;
  IF FOUND THEN
    IF v_attempt.session_id IS DISTINCT FROM v_session.id THEN
      RAISE EXCEPTION '[ARCADE VERIFY] idempotency key belongs to a different session.' USING ERRCODE='P0212';
    END IF;
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,'verification_opportunity_number',v_attempt.opportunity_number);
  END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_session.period_id;
  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN RAISE EXCEPTION '[ARCADE VERIFY] target period is not accepting verification.' USING ERRCODE='P0261'; END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] another verification run is already in progress.' USING ERRCODE='P0269';
  END IF;
  SELECT count(*)::integer INTO v_used FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id AND a.consumed;
  IF v_used>=v_session.max_attempts THEN RAISE EXCEPTION '[ARCADE VERIFY] no verification attempts remain.' USING ERRCODE='P0269'; END IF;
  SELECT coalesce(max(a.issue_number),0)+1 INTO v_issue FROM public.arcade_verification_attempts a WHERE a.session_id=v_session.id;
  SELECT slot.n INTO v_opportunity
  FROM generate_series(1,v_session.max_attempts) AS slot(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.arcade_verification_attempts a
    WHERE a.session_id=v_session.id
      AND a.opportunity_number=slot.n
      AND a.consumed
  )
  ORDER BY slot.n
  LIMIT 1;
  IF v_opportunity IS NULL THEN RAISE EXCEPTION '[ARCADE VERIFY] no verification opportunity slot remains.' USING ERRCODE='P0269'; END IF;
  SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_session.rule_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen rule version is missing.' USING ERRCODE='P0198'; END IF;
  SELECT * INTO v_game FROM public.arcade_games WHERE id=v_session.game_id;
  v_seed:=public.arcade_generate_run_seed();
  INSERT INTO public.arcade_runs(classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,countdown_started_at,is_prerelease_test,run_context,verification_session_id)
  VALUES(v_classroom_id,v_student_id,v_session.game_id,v_session.rule_version_id,'COUNTDOWN',v_seed,now(),false,'VERIFICATION',v_session.id)
  RETURNING * INTO v_run;
  INSERT INTO public.arcade_verification_attempts(session_id,issue_number,opportunity_number,run_id,idempotency_key)
  VALUES(v_session.id,v_issue,v_opportunity,v_run.id,p_idempotency_key) RETURNING * INTO v_attempt;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,metadata,actor_user_id)
  VALUES(v_classroom_id,v_session.period_id,v_session.game_id,v_student_id,v_session.id,v_attempt.id,'ATTEMPT_ISSUED',jsonb_build_object('run_id',v_run.id,'issue_number',v_issue,'opportunity_number',v_opportunity),auth.uid());
  RETURN jsonb_build_object('run_id',v_run.id,'game_code',v_game.code,'rule_version',v_rule.version_code,
    'countdown_started_at',v_run.countdown_started_at,'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
    'schedule_seed',v_run.schedule_seed,'config',v_rule.config,'is_prerelease_test',false,'run_context','VERIFICATION',
    'verification_session_id',v_session.id,'verification_opportunity_number',v_opportunity);
END;
$function$;

-- source: production pg_get_functiondef (batch2.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.teacher_finalize_arcade_monthly_snapshot(p_period_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer; v_period public.arcade_ranking_periods%ROWTYPE; v_finalization public.arcade_monthly_finalizations%ROWTYPE;
  v_game record; v_snapshot public.arcade_monthly_snapshots%ROWTYPE; v_eligible_game_count integer:=0; v_snapshot_count integer:=0; v_full_rank_count integer:=0;
  v_refresh_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role(); v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[ARCADE] monthly ranking period not found in this classroom.' USING ERRCODE='P0214'; END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.contribution_year_month IS NULL THEN RAISE EXCEPTION '[ARCADE] only a monthly period can update Guild 2 Arcade contribution.' USING ERRCODE='P0215'; END IF;
  IF v_period.status='FINALIZED' OR EXISTS(SELECT 1 FROM public.arcade_monthly_finalizations f WHERE f.period_id=v_period.id) THEN RAISE EXCEPTION '[ARCADE] this monthly period is already finalized and immutable.' USING ERRCODE='P0216'; END IF;
  IF v_period.status<>'READY_TO_FINALIZE' THEN RAISE EXCEPTION '[ARCADE VERIFY] current Top 10 verification is not complete.' USING ERRCODE='P0271'; END IF;
  IF EXISTS(
    SELECT 1 FROM public.arcade_runs r JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
    WHERE s.period_id=v_period.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN RAISE EXCEPTION '[ARCADE VERIFY] a verification run is still in progress.' USING ERRCODE='P0271'; END IF;
  IF public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id)<>'READY_TO_FINALIZE' THEN RAISE EXCEPTION '[ARCADE VERIFY] current Top 10 still contains unverified students.' USING ERRCODE='P0271'; END IF;
  WITH closed AS (
    UPDATE public.arcade_verification_sessions s
    SET status='OVERRIDDEN',ended_at=now()
    WHERE s.period_id=v_period.id AND s.status='ACTIVE'
      AND NOT EXISTS(
        SELECT 1
        FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,s.game_id) r
        WHERE r.student_id=s.student_id AND r.rank<=10
      )
    RETURNING s.classroom_id,s.period_id,s.game_id,s.student_id,s.id
  )
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  )
  SELECT c.classroom_id,c.period_id,c.game_id,c.student_id,c.id,'SESSION_AUTO_OVERRIDDEN_OUTSIDE_TOP10','{}'::jsonb,auth.uid()
  FROM closed c;

  IF EXISTS (
    SELECT 1
    FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id = v_classroom_id
      AND os.arcade_period_id = v_period.id
      AND os.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION '[RAKARUKA] an official five-match challenge is still in progress; finish it before monthly finalization.'
      USING ERRCODE = 'PTK50';
  END IF;
  PERFORM pg_advisory_xact_lock(v_classroom_id,replace(v_period.contribution_year_month,'-','')::integer);
  SELECT count(*) INTO v_eligible_game_count
  FROM public.arcade_verification_period_games pg
  WHERE pg.period_id=v_period.id;
  INSERT INTO public.arcade_monthly_finalizations(classroom_id,period_id,contribution_year_month,eligible_game_count)
  VALUES(v_classroom_id,v_period.id,v_period.contribution_year_month,v_eligible_game_count) RETURNING * INTO v_finalization;
  FOR v_game IN
    SELECT g.id,g.code
    FROM public.arcade_verification_period_games pg
    JOIN public.arcade_games g ON g.id=pg.game_id
    WHERE pg.period_id=v_period.id
    ORDER BY g.id
  LOOP
    INSERT INTO public.arcade_monthly_snapshots(finalization_id,classroom_id,period_id,game_id,contribution_year_month)
    VALUES(v_finalization.id,v_classroom_id,v_period.id,v_game.id,v_period.contribution_year_month) RETURNING * INTO v_snapshot;
    INSERT INTO public.arcade_monthly_snapshot_entries(snapshot_id,student_id,source_run_id,rank,official_score,achieved_at,raw_bonus)
    SELECT v_snapshot.id,t.student_id,t.source_run_id,t.rank,t.official_score,t.achieved_at,t.raw_bonus FROM public.arcade_resolve_period_top10(v_classroom_id,v_period.id,v_game.id)t;
    INSERT INTO public.arcade_monthly_snapshot_student_ranks(snapshot_id,student_id,source_run_id,rank,official_score,achieved_at)
    SELECT v_snapshot.id,r.student_id,r.source_run_id,r.rank,r.official_score,r.achieved_at FROM public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,v_game.id)r;
  END LOOP;

  WITH created_rakaruka_snapshot AS (
    INSERT INTO public.tikatuka_monthly_official_snapshots(
      finalization_id,
      classroom_id,
      period_id,
      contribution_year_month
    )
    VALUES(
      v_finalization.id,
      v_classroom_id,
      v_period.id,
      v_period.contribution_year_month
    )
    RETURNING id
  )
  INSERT INTO public.tikatuka_monthly_official_snapshot_entries(
    snapshot_id,
    student_id,
    source_session_id,
    rank,
    difficulty,
    wins,
    draws,
    losses,
    points,
    ranking_score,
    completed_at,
    raw_bonus
  )
  SELECT
    snapshot.id,
    ranking.student_id,
    ranking.source_session_id,
    ranking.rank,
    ranking.difficulty,
    ranking.wins,
    ranking.draws,
    ranking.losses,
    ranking.points,
    ranking.ranking_score,
    ranking.completed_at,
    ranking.raw_bonus
  FROM created_rakaruka_snapshot snapshot
  CROSS JOIN LATERAL public.tikatuka_resolve_period_official_ranks(v_classroom_id, v_period.id) ranking
  WHERE ranking.rank <= 10;

  SELECT count(*) INTO v_snapshot_count FROM public.arcade_monthly_snapshots s WHERE s.finalization_id=v_finalization.id;
  IF v_snapshot_count<>v_eligible_game_count THEN RAISE EXCEPTION '[ARCADE] incomplete monthly snapshot set; transaction was not finalized.' USING ERRCODE='P0219'; END IF;
  SELECT count(*) INTO v_full_rank_count FROM public.arcade_monthly_snapshot_student_ranks r JOIN public.arcade_monthly_snapshots s ON s.id=r.snapshot_id WHERE s.finalization_id=v_finalization.id;
  v_refresh_result:=public.guild2_refresh_monthly_scores(v_classroom_id,v_period.contribution_year_month);
  UPDATE public.arcade_ranking_periods SET status='FINALIZED' WHERE id=v_period.id;
  INSERT INTO public.arcade_verification_audit_events(classroom_id,period_id,event_kind,metadata,actor_user_id)
  VALUES(v_classroom_id,v_period.id,'PERIOD_FINALIZED',jsonb_build_object('finalization_id',v_finalization.id,'snapshot_count',v_snapshot_count),auth.uid());
  RETURN jsonb_build_object('period_id',v_period.id,'finalization_id',v_finalization.id,'eligible_game_count',v_eligible_game_count,'snapshot_count',v_snapshot_count,'full_rank_count',v_full_rank_count,'guild2_refresh',v_refresh_result,'status','FINALIZED');
END;
$function$;

-- source: production pg_get_functiondef (batch3.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.teacher_cancel_arcade_verification_run(p_run_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_run public.arcade_runs%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] technical cancellation reason must be 2 to 500 characters.' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM public.current_classroom_id() OR v_run.run_context<>'VERIFICATION' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification run not found.' USING ERRCODE='P0263';
  END IF;
  IF v_run.status NOT IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only an in-progress verification run can be technically cancelled.' USING ERRCODE='P0264';
  END IF;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE run_id=v_run.id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.' USING ERRCODE='P0254'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] verification session is missing.' USING ERRCODE='P0255'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.' USING ERRCODE='P0216'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE run_id=v_run.id FOR UPDATE;
  IF v_session.status<>'ACTIVE' THEN RAISE EXCEPTION '[ARCADE VERIFY] verification session is not active.' USING ERRCODE='P0255'; END IF;
  UPDATE public.arcade_runs
  SET status='EXPIRED',rejection_code='VERIFICATION_TECHNICAL_CANCEL',rejection_reason=btrim(p_reason)
  WHERE id=v_run.id;
  UPDATE public.arcade_verification_attempts
  SET status='TECHNICAL_CANCELLED',consumed=false,valid_run=false,terminal_outcome='TECHNICAL_CANCELLED',terminal_at=now()
  WHERE id=v_attempt.id;
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,reason,metadata,actor_user_id
  ) VALUES (
    v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_attempt.id,
    'RUN_TECHNICAL_CANCELLED',btrim(p_reason),jsonb_build_object('run_id',v_run.id,'opportunity_number',v_attempt.opportunity_number),auth.uid()
  );
  RETURN jsonb_build_object('run_id',v_run.id,'cancelled',true,'attempt_consumed',false);
END;
$function$;

-- source: production pg_get_functiondef (batch3.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.teacher_freeze_arcade_monthly_period(p_period_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_start_date date;
  v_end_date date;
  v_missing_config integer;
  v_recent_inflight integer;
  v_frozen integer;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found in this classroom.' USING ERRCODE='P0256';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only monthly periods use record verification.' USING ERRCODE='P0257';
  END IF;
  IF v_period.status IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RETURN jsonb_build_object('period_id',v_period.id,'status',v_period.status,'already_frozen',true);
  END IF;
  IF v_period.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only an active monthly period can be frozen.' USING ERRCODE='P0258';
  END IF;
  IF v_period.ends_at_exclusive > clock_timestamp() THEN
    RAISE EXCEPTION '[ARCADE VERIFY] end the monthly period before freezing records.' USING ERRCODE='P0218';
  END IF;
  SELECT count(*)::integer INTO v_recent_inflight
  FROM public.arcade_runs r
  WHERE r.classroom_id=v_classroom_id
    AND r.run_context='STANDARD'
    AND NOT r.is_prerelease_test
    AND r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    AND r.created_at >= greatest(v_period.starts_at, clock_timestamp()-interval '15 minutes')
    AND r.created_at < v_period.ends_at_exclusive;
  IF v_recent_inflight > 0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % recent standard run(s) are still in progress; wait for submission before freezing.',v_recent_inflight
      USING ERRCODE='P0272';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_verification_provisional_entries WHERE period_id=v_period.id) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] unexpected frozen rows already exist for an ACTIVE period.' USING ERRCODE='P0259';
  END IF;
  v_start_date := (v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date;
  v_end_date := ((v_period.ends_at_exclusive - interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date;
  SELECT count(*)::integer INTO v_missing_config
  FROM public.arcade_games g
  WHERE g.available_from <= v_end_date
    AND (g.available_until IS NULL OR g.available_until >= v_start_date)
    AND NOT EXISTS (
      SELECT 1 FROM public.arcade_verification_game_configs c
      WHERE c.game_id=g.id AND c.is_enabled
    );
  IF v_missing_config > 0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % eligible game(s) lack an enabled verification config; integrate the game validator first.',v_missing_config
      USING ERRCODE='P0260';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.arcade_games g
    JOIN public.arcade_verification_game_configs c ON c.game_id=g.id AND c.is_enabled
    WHERE g.available_from <= v_end_date
      AND (g.available_until IS NULL OR g.available_until >= v_start_date)
      AND c.target_rank_count <> 10
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] current monthly Guild 2 rewards cover Top 10; every eligible game must verify all Top 10 ranks.'
      USING ERRCODE='P0260';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_verification_period_games WHERE period_id=v_period.id) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] unexpected frozen game scope already exists for an ACTIVE period.' USING ERRCODE='P0259';
  END IF;
  INSERT INTO public.arcade_verification_period_games(
    classroom_id,period_id,game_id,target_rank_count,threshold_percent,max_attempts
  )
  SELECT v_classroom_id,v_period.id,g.id,c.target_rank_count,c.threshold_percent,c.max_attempts
  FROM public.arcade_games g
  JOIN public.arcade_verification_game_configs c ON c.game_id=g.id AND c.is_enabled
  WHERE g.available_from <= v_end_date
    AND (g.available_until IS NULL OR g.available_until >= v_start_date);
  WITH eligible_games AS (
    SELECT pg.game_id AS id
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id=v_period.id
  ), candidate_runs AS (
    SELECT r.id AS source_run_id,r.game_id,r.student_id,r.rule_version_id,r.official_score,
           r.official_duration_ms,r.stats,r.game_over_at,
           row_number() OVER (
             PARTITION BY r.game_id,r.student_id
             ORDER BY r.official_score DESC,r.game_over_at ASC,r.id ASC
           ) AS best_row
    FROM public.arcade_runs r
    JOIN eligible_games eg ON eg.id=r.game_id
    WHERE r.classroom_id=v_classroom_id
      AND r.run_context='STANDARD'
      AND r.status='VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at >= v_period.starts_at
      AND r.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_run_moderation_events m
        WHERE m.run_id=r.id AND m.event_kind='INVALIDATE'
      )
  )
  INSERT INTO public.arcade_verification_provisional_entries(
    classroom_id,period_id,game_id,student_id,source_run_id,rule_version_id,
    official_score,official_duration_ms,stats,achieved_at
  )
  SELECT v_classroom_id,v_period.id,c.game_id,c.student_id,c.source_run_id,c.rule_version_id,
         c.official_score,c.official_duration_ms,c.stats,c.game_over_at
  FROM candidate_runs c
  WHERE c.best_row=1;
  GET DIAGNOSTICS v_frozen = ROW_COUNT;
  UPDATE public.arcade_ranking_periods SET status='VERIFICATION' WHERE id=v_period.id;
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_classroom_id,v_period.id,'PERIOD_FROZEN',jsonb_build_object('frozen_student_game_rows',v_frozen),auth.uid()
  );
  v_status := public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  RETURN jsonb_build_object('period_id',v_period.id,'status',v_status,'frozen_rows',v_frozen,'already_frozen',false);
END;
$function$;

-- source: production pg_get_functiondef (batch3.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.teacher_restore_arcade_verification_attempt(p_attempt_id bigint, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_success boolean;
  v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN RAISE EXCEPTION '[ARCADE VERIFY] restore reason must be 2 to 500 characters.' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE id=p_attempt_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] attempt not found.' USING ERRCODE='P0265'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id;
  IF NOT FOUND OR v_session.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[ARCADE VERIFY] attempt does not belong to this classroom.' USING ERRCODE='P0265'; END IF;
  SELECT * INTO v_period FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id AND classroom_id=v_session.classroom_id FOR UPDATE;
  IF NOT FOUND OR v_period.status='FINALIZED' THEN RAISE EXCEPTION '[ARCADE VERIFY] finalized period cannot be changed.' USING ERRCODE='P0216'; END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id FOR UPDATE;
  SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE id=p_attempt_id FOR UPDATE;
  IF v_session.status NOT IN ('ACTIVE','COMPLETED') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] reset/overridden sessions cannot restore attempts.' USING ERRCODE='P0266';
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_runs r WHERE r.verification_session_id=v_session.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] cancel/finish the active verification run before restoring an attempt.' USING ERRCODE='P0268';
  END IF;
  IF v_attempt.status<>'TERMINAL' OR NOT v_attempt.consumed OR v_attempt.valid_run THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only a consumed invalid attempt can be restored.' USING ERRCODE='P0266';
  END IF;
  UPDATE public.arcade_verification_attempts
  SET status='RESTORED',consumed=false,restored_at=now(),restored_by_user_id=auth.uid(),restore_reason=btrim(p_reason)
  WHERE id=v_attempt.id;
  IF v_session.status='COMPLETED' THEN
    DELETE FROM public.arcade_verification_official_results
    WHERE period_id=v_session.period_id AND game_id=v_session.game_id AND student_id=v_session.student_id AND session_id=v_session.id;
    SELECT EXISTS(
      SELECT 1 FROM public.arcade_verification_attempts a
      WHERE a.session_id=v_session.id AND a.status='TERMINAL' AND a.consumed AND a.valid_run AND a.official_score>=v_session.verification_threshold
    ) INTO v_success;
    UPDATE public.arcade_verification_sessions
    SET status='ACTIVE',result_status=NULL,ended_at=NULL,success_achieved=v_success
    WHERE id=v_session.id;
  END IF;
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,event_kind,reason,actor_user_id
  ) VALUES (v_session.classroom_id,v_session.period_id,v_session.game_id,v_session.student_id,v_session.id,v_attempt.id,'ATTEMPT_RESTORED',btrim(p_reason),auth.uid());
  v_status:=public.arcade_refresh_verification_readiness(v_session.classroom_id,v_session.period_id);
  RETURN jsonb_build_object('attempt_id',v_attempt.id,'restored',true,'session_id',v_session.id,'session_status',CASE WHEN v_session.status='COMPLETED' THEN 'ACTIVE' ELSE v_session.status END,'period_status',v_status);
END;
$function$;

-- source: production pg_get_functiondef (batch3.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.teacher_start_arcade_verification_session(p_period_id bigint, p_game_code text, p_student_id integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_threshold bigint;
  v_has_provisional boolean := false;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=p_period_id FOR UPDATE;
  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE='P0256';
  END IF;
  IF v_period.period_kind<>'MONTHLY' OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period is not in verification stage.' USING ERRCODE='P0261';
  END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code=p_game_code;
  IF v_game_id IS NULL THEN RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE='P0206'; END IF;
  SELECT * INTO v_config FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id AND game_id=v_game_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.' USING ERRCODE='P0260'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.students student
    WHERE student.id=p_student_id
      AND student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not an official participant in this classroom.' USING ERRCODE='P0270';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.arcade_verification_official_results o
    WHERE o.period_id=v_period.id AND o.game_id=v_game_id AND o.student_id=p_student_id
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student already has an official verification result.' USING ERRCODE='P0262';
  END IF;
  SELECT * INTO v_session FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id AND status='ACTIVE';
  IF FOUND THEN
    RETURN jsonb_build_object(
      'session_id',v_session.id,'status',v_session.status,'already_active',true,
      'has_provisional_record',(v_session.provisional_entry_id IS NOT NULL),
      'verification_threshold',v_session.verification_threshold
    );
  END IF;

  SELECT * INTO v_provisional FROM public.arcade_verification_provisional_entries
  WHERE period_id=v_period.id AND game_id=v_game_id AND student_id=p_student_id;
  v_has_provisional := FOUND;

  IF v_has_provisional THEN
    v_threshold := ceil((v_provisional.official_score::numeric * v_config.threshold_percent::numeric) / 100::numeric)::bigint;
    INSERT INTO public.arcade_verification_sessions(
      classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
      rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
    ) VALUES (
      v_classroom_id,v_period.id,v_game_id,p_student_id,v_provisional.id,v_provisional.source_run_id,
      v_provisional.rule_version_id,v_provisional.official_score,v_threshold,v_config.threshold_percent,v_config.max_attempts
    ) RETURNING * INTO v_session;
  ELSE
    SELECT rv.* INTO v_rule
    FROM public.arcade_game_rule_versions rv
    WHERE rv.id = (
      SELECT p.rule_version_id
      FROM public.arcade_verification_provisional_entries p
      WHERE p.period_id=v_period.id AND p.game_id=v_game_id
      ORDER BY p.achieved_at DESC,p.id DESC
      LIMIT 1
    );
    IF NOT FOUND THEN
      SELECT * INTO v_rule
      FROM public.arcade_game_rule_versions
      WHERE game_id=v_game_id AND is_active
      ORDER BY id DESC
      LIMIT 1;
    END IF;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[ARCADE VERIFY] game rule version is missing.' USING ERRCODE='P0198';
    END IF;

    INSERT INTO public.arcade_verification_sessions(
      classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
      rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
    ) VALUES (
      v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,NULL,
      v_rule.id,NULL,NULL,v_config.threshold_percent,v_config.max_attempts
    ) RETURNING * INTO v_session;
  END IF;

  UPDATE public.arcade_ranking_periods SET status='VERIFICATION' WHERE id=v_period.id AND status='READY_TO_FINALIZE';
  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  ) VALUES (
    v_classroom_id,v_period.id,v_game_id,p_student_id,v_session.id,'SESSION_STARTED',
    jsonb_build_object(
      'has_provisional_record',v_has_provisional,
      'provisional_score',CASE WHEN v_has_provisional THEN v_provisional.official_score ELSE NULL END,
      'threshold',v_threshold,
      'percent',v_config.threshold_percent,
      'max_attempts',v_config.max_attempts
    ),auth.uid()
  );
  RETURN jsonb_build_object(
    'session_id',v_session.id,'status','ACTIVE','already_active',false,
    'has_provisional_record',v_has_provisional,
    'verification_threshold',v_session.verification_threshold,
    'max_attempts',v_config.max_attempts
  );
END;
$function$;

-- source: production pg_get_functiondef (batch4.sql, CR stripped)
CREATE OR REPLACE FUNCTION public.student_get_arcade_game_access(p_game_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_seoul_today date;
  v_public_available boolean;
  v_prerelease_allowed boolean := false;
  v_is_live_test_agent boolean := false;
  v_can_start boolean;
  v_daily_attempt_limit integer := 50;
  v_daily_attempt_used integer := 0;
  v_day_start timestamptz;
  v_day_end timestamptz;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_start := v_seoul_today::timestamp AT TIME ZONE 'Asia/Seoul';
  v_day_end := (v_seoul_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul';
  v_is_live_test_agent := public.is_live_test_agent(v_student_id);

  v_public_available := v_game.is_active
    AND v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);

  IF NOT v_public_available
     AND v_game.is_active
     AND v_seoul_today < v_game.available_from THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_prerelease_allowed;
  END IF;

  v_can_start := v_public_available OR v_prerelease_allowed;

  IF v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN
    SELECT count(*)::integer
    INTO v_daily_attempt_used
    FROM public.arcade_runs run
    WHERE run.student_id = v_student_id
      AND run.game_id = v_game.id
      AND run.run_context = 'STANDARD'
      AND run.created_at >= v_day_start
      AND run.created_at < v_day_end;

    IF v_daily_attempt_used >= v_daily_attempt_limit THEN
      v_can_start := false;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'game_code', v_game.code,
    'available_from', v_game.available_from,
    'public_available', v_public_available,
    'can_start', v_can_start,
    'mode', CASE
      WHEN v_public_available THEN 'PUBLIC'
      WHEN v_prerelease_allowed THEN 'PRERELEASE_TEST'
      ELSE 'CLOSED'
    END,
    'daily_attempt_limit', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_limit ELSE NULL END,
    'daily_attempt_used', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_used ELSE NULL END,
    'daily_attempt_remaining', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN greatest(v_daily_attempt_limit - v_daily_attempt_used, 0) ELSE NULL END,
    'daily_attempt_resets_at', CASE WHEN v_game.code = 'pure_reaction_02' AND NOT v_is_live_test_agent THEN v_day_end ELSE NULL END
  );
END;
$function$;

-- source: repo (logic identical to prod, formatting differs)
CREATE OR REPLACE FUNCTION public.teacher_force_finalize_arcade_month_for_guild5(
  p_year_month text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_existing_finalization_id bigint;
  v_forced_result_count integer := 0;
  v_overridden_session_count integer := 0;
  v_status text;
  v_finalize_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G5 ARCADE] year_month must be YYYY-MM.' USING ERRCODE='22023';
  END IF;
  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready reason must be 2 to 500 characters.' USING ERRCODE='22023';
  END IF;

  SELECT f.id INTO v_existing_finalization_id
  FROM public.arcade_monthly_finalizations f
  WHERE f.classroom_id=v_classroom_id AND f.contribution_year_month=p_year_month;

  IF v_existing_finalization_id IS NOT NULL THEN
    RETURN jsonb_build_object('status','FINALIZED','already_finalized',true,'finalization_id',v_existing_finalization_id,'year_month',p_year_month);
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id=v_classroom_id AND p.period_kind='MONTHLY' AND p.contribution_year_month=p_year_month
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 ARCADE] monthly Arcade period not found for %.',p_year_month USING ERRCODE='P0273';
  END IF;
  IF v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[G5 ARCADE] period is FINALIZED but its monthly snapshot is missing.' USING ERRCODE='P0220';
  END IF;

  IF v_period.status='ACTIVE' THEN
    IF v_period.ends_at_exclusive > clock_timestamp() THEN
      RAISE EXCEPTION '[G5 ARCADE] the monthly Arcade period is still running. End it before force-ready.' USING ERRCODE='P0274';
    END IF;
    PERFORM public.teacher_freeze_arcade_monthly_period(v_period.id);
    SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id=v_period.id FOR UPDATE;
  END IF;

  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready requires a frozen monthly period; current status is %.',v_period.status USING ERRCODE='P0275';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_runs r
    JOIN public.arcade_verification_sessions s ON s.id=r.verification_session_id
    WHERE s.period_id=v_period.id AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[G5 ARCADE] an Arcade verification run is still in progress. Finish or cancel it first.' USING ERRCODE='P0268';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id=v_classroom_id AND os.arcade_period_id=v_period.id AND os.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION '[G5 ARCADE] a Rakaruka official challenge is still active. Finish it first.' USING ERRCODE='PTK50';
  END IF;

  WITH target_rows AS (
    SELECT pg.game_id,r.student_id
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,pg.game_id) r
    WHERE pg.period_id=v_period.id
      AND r.rank<=pg.target_rank_count
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id AND o.game_id=pg.game_id AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.game_id,t.student_id,p.source_run_id,p.official_score,p.official_duration_ms,p.stats,p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=t.game_id AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_corrections(
    classroom_id,period_id,game_id,student_id,action_kind,source_run_id,reason
  )
  SELECT v_classroom_id,v_period.id,s.game_id,s.student_id,'SET_SOURCE',s.source_run_id,btrim(p_reason)
  FROM source_rows s;

  WITH target_rows AS (
    SELECT pg.game_id,r.student_id
    FROM public.arcade_verification_period_games pg
    CROSS JOIN LATERAL public.arcade_resolve_period_student_ranks(v_classroom_id,v_period.id,pg.game_id) r
    WHERE pg.period_id=v_period.id
      AND r.rank<=pg.target_rank_count
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_verification_official_results o
        WHERE o.period_id=v_period.id AND o.game_id=pg.game_id AND o.student_id=r.student_id
      )
  ), source_rows AS (
    SELECT t.game_id,t.student_id,p.source_run_id,p.official_score,p.official_duration_ms,p.stats,p.achieved_at
    FROM target_rows t
    JOIN public.arcade_verification_provisional_entries p
      ON p.period_id=v_period.id AND p.game_id=t.game_id AND p.student_id=t.student_id
  )
  INSERT INTO public.arcade_verification_official_results(
    classroom_id,period_id,game_id,student_id,session_id,decision_kind,
    source_run_id,official_score,official_duration_ms,stats,achieved_at,ranking_eligible,decided_by_user_id
  )
  SELECT v_classroom_id,v_period.id,s.game_id,s.student_id,NULL,'MANUAL_SOURCE',
         s.source_run_id,s.official_score,s.official_duration_ms,s.stats,s.achieved_at,true,auth.uid()
  FROM source_rows s
  ON CONFLICT(period_id,game_id,student_id) DO NOTHING;
  GET DIAGNOSTICS v_forced_result_count=ROW_COUNT;

  UPDATE public.arcade_verification_sessions
  SET status='OVERRIDDEN',ended_at=now()
  WHERE classroom_id=v_classroom_id AND period_id=v_period.id AND status='ACTIVE';
  GET DIAGNOSTICS v_overridden_session_count=ROW_COUNT;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,v_period.id,'PERIOD_FORCE_READY_FOR_GUILD5',btrim(p_reason),
    jsonb_build_object('forced_provisional_results',v_forced_result_count,'overridden_active_sessions',v_overridden_session_count,'year_month',p_year_month),
    auth.uid()
  );

  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);
  IF v_status<>'READY_TO_FINALIZE' THEN
    RAISE EXCEPTION '[G5 ARCADE] force-ready could not resolve every current reward-range record; status is %.',v_status USING ERRCODE='P0276';
  END IF;

  v_finalize_result:=public.teacher_finalize_arcade_monthly_snapshot(v_period.id);
  RETURN coalesce(v_finalize_result,'{}'::jsonb) || jsonb_build_object(
    'forced_ready',true,
    'forced_provisional_results',v_forced_result_count,
    'overridden_active_sessions',v_overridden_session_count,
    'reason',btrim(p_reason)
  );
END;
$function$;
