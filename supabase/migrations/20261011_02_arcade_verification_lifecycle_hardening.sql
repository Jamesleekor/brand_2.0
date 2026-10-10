-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade / Starlink STEP 2-B verification lifecycle hardening
-- 2026-10-11
--
-- Goals:
--   * period/game rule-version pin is authoritative for new standard runs
--   * verification attempt is consumed atomically when PLAYING begins
--   * PERIOD_PACK_PERMUTED seed stays hidden until PLAYING
--   * per-student A/B/C assignments survive session resets
--   * abandon / stale recovery cannot create free post-start retries
--   * current GAME 1 / GAME 2 keep RANDOM_PER_ATTEMPT seed strategy
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_period_game_rule_pins') IS NULL
     OR to_regclass('public.arcade_verification_seed_pack_slots') IS NULL
     OR to_regclass('public.arcade_verification_seed_assignments') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='run_nonce'
     )
  THEN
    RAISE EXCEPTION '[ARCADE STARLINK 2B] STEP 2-A schema foundation is missing.';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Resolve one authoritative rule version across all currently-active
-- ranking periods that overlap a new STANDARD run.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.arcade_resolve_or_pin_rule_version(
  p_classroom_id integer,
  p_game_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_rule_id bigint;
  v_distinct integer;
  v_period record;
BEGIN
  IF p_classroom_id IS NULL OR p_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE RULE PIN] classroom/game is required.'
      USING ERRCODE='22023';
  END IF;

  SELECT count(DISTINCT pin.rule_version_id)::integer,
         min(pin.rule_version_id)
  INTO v_distinct, v_rule_id
  FROM public.arcade_period_game_rule_pins pin
  JOIN public.arcade_ranking_periods p ON p.id=pin.period_id
  WHERE pin.classroom_id=p_classroom_id
    AND pin.game_id=p_game_id
    AND p.classroom_id=p_classroom_id
    AND p.status='ACTIVE'
    AND v_now>=p.starts_at
    AND v_now<p.ends_at_exclusive;

  IF v_distinct > 1 THEN
    RAISE EXCEPTION '[ARCADE RULE PIN] overlapping active periods use conflicting rule versions.'
      USING ERRCODE='P0283';
  END IF;

  IF v_rule_id IS NULL THEN
    SELECT rv.id
    INTO v_rule_id
    FROM public.arcade_game_rule_versions rv
    WHERE rv.game_id=p_game_id
      AND rv.is_active
    ORDER BY rv.id DESC
    LIMIT 1;

    IF v_rule_id IS NULL THEN
      RAISE EXCEPTION '[ARCADE] active game rule version is missing.'
        USING ERRCODE='P0198';
    END IF;
  END IF;

  FOR v_period IN
    SELECT p.id
    FROM public.arcade_ranking_periods p
    WHERE p.classroom_id=p_classroom_id
      AND p.status='ACTIVE'
      AND v_now>=p.starts_at
      AND v_now<p.ends_at_exclusive
    ORDER BY p.id
  LOOP
    INSERT INTO public.arcade_period_game_rule_pins(
      classroom_id,period_id,game_id,rule_version_id,pinned_by_user_id
    )
    VALUES(
      p_classroom_id,v_period.id,p_game_id,v_rule_id,auth.uid()
    )
    ON CONFLICT(period_id,game_id) DO NOTHING;
  END LOOP;

  SELECT count(DISTINCT pin.rule_version_id)::integer,
         min(pin.rule_version_id)
  INTO v_distinct, v_rule_id
  FROM public.arcade_period_game_rule_pins pin
  JOIN public.arcade_ranking_periods p ON p.id=pin.period_id
  WHERE pin.classroom_id=p_classroom_id
    AND pin.game_id=p_game_id
    AND p.classroom_id=p_classroom_id
    AND p.status='ACTIVE'
    AND v_now>=p.starts_at
    AND v_now<p.ends_at_exclusive;

  IF v_distinct > 1 THEN
    RAISE EXCEPTION '[ARCADE RULE PIN] concurrent rule pin conflict detected.'
      USING ERRCODE='P0283';
  END IF;

  IF v_rule_id IS NULL THEN
    -- No active ranking period: use current active game rule without creating a pin.
    SELECT rv.id
    INTO v_rule_id
    FROM public.arcade_game_rule_versions rv
    WHERE rv.game_id=p_game_id
      AND rv.is_active
    ORDER BY rv.id DESC
    LIMIT 1;
  END IF;

  IF v_rule_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active game rule version is missing.'
      USING ERRCODE='P0198';
  END IF;

  RETURN v_rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_resolve_or_pin_rule_version(integer,bigint)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Seed-pack preparation dispatch.
-- STEP 2-D / Starlink engine migration will provide the game-specific preparer.
-- Keeping this strict means an enabled pack game can never freeze without a
-- complete server-side seed pack.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.arcade_prepare_verification_seed_pack(
  p_period_game_id bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pg public.arcade_verification_period_games%ROWTYPE;
  v_game_code text;
BEGIN
  SELECT *
  INTO v_pg
  FROM public.arcade_verification_period_games
  WHERE id=p_period_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] period-game scope is missing.'
      USING ERRCODE='P0260';
  END IF;

  IF v_pg.seed_strategy='RANDOM_PER_ATTEMPT' THEN
    RETURN;
  END IF;

  SELECT g.code
  INTO v_game_code
  FROM public.arcade_games g
  WHERE g.id=v_pg.game_id;

  IF v_game_code='starlink_04'
     AND to_regprocedure('public.arcade_starlink_04_prepare_seed_pack(bigint)') IS NOT NULL THEN
    EXECUTE 'SELECT public.arcade_starlink_04_prepare_seed_pack($1)'
      USING p_period_game_id;
    RETURN;
  END IF;

  RAISE EXCEPTION '[ARCADE VERIFY SEED] seed-pack preparer is missing for game %.',coalesce(v_game_code,'?')
    USING ERRCODE='P0285';
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_prepare_verification_seed_pack(bigint)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Standard run creation now obeys period/game rule pins.
-- Existing availability / prerelease / GAME 2 daily-limit behavior is preserved.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_rule_id bigint;
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
    RAISE EXCEPTION '[ARCADE] active student context is required.'
      USING ERRCODE='P0195';
  END IF;

  IF coalesce(p_game_code,'') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.'
      USING ERRCODE='P0196';
  END IF;

  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_day_start := v_seoul_today::timestamp AT TIME ZONE 'Asia/Seoul';
  v_day_end := (v_seoul_today + 1)::timestamp AT TIME ZONE 'Asia/Seoul';

  SELECT *
  INTO v_game
  FROM public.arcade_games
  WHERE code=p_game_code
    AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] this game is not currently available.'
      USING ERRCODE='P0197';
  END IF;

  v_public_available := v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);

  IF NOT v_public_available THEN
    IF v_seoul_today >= v_game.available_from THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.'
        USING ERRCODE='P0197';
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id=v_classroom_id
        AND access_row.student_id=v_student_id
        AND access_row.game_id=v_game.id
        AND access_row.is_enabled
    )
    INTO v_is_prerelease_test;

    IF NOT v_is_prerelease_test THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.'
        USING ERRCODE='P0197';
    END IF;
  END IF;

  v_is_live_test_agent := public.is_live_test_agent(v_student_id);
  v_is_prerelease_test := v_is_prerelease_test OR v_is_live_test_agent;

  IF v_game.code='pure_reaction_02' AND NOT v_is_live_test_agent THEN
    PERFORM 1
    FROM public.students student_row
    WHERE student_row.id=v_student_id
    FOR UPDATE;

    SELECT count(*)::integer
    INTO v_daily_attempt_used
    FROM public.arcade_runs run
    WHERE run.student_id=v_student_id
      AND run.game_id=v_game.id
      AND run.run_context='STANDARD'
      AND run.created_at>=v_day_start
      AND run.created_at<v_day_end;

    IF v_daily_attempt_used>=v_daily_attempt_limit THEN
      RAISE EXCEPTION '[ARCADE GAME02] daily challenge limit reached (50/KST day).'
        USING ERRCODE='P0274';
    END IF;
  END IF;

  v_rule_id := public.arcade_resolve_or_pin_rule_version(v_classroom_id,v_game.id);

  SELECT *
  INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE id=v_rule_id
    AND game_id=v_game.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] resolved game rule version is missing.'
      USING ERRCODE='P0198';
  END IF;

  v_seed := public.arcade_generate_run_seed();

  INSERT INTO public.arcade_runs(
    classroom_id,student_id,game_id,rule_version_id,status,
    schedule_seed,countdown_started_at,is_prerelease_test
  )
  VALUES(
    v_classroom_id,v_student_id,v_game.id,v_rule.id,'COUNTDOWN',
    v_seed,now(),v_is_prerelease_test
  )
  RETURNING * INTO v_run;

  IF v_game.code='pure_reaction_02' AND NOT v_is_live_test_agent THEN
    v_daily_attempt_used := v_daily_attempt_used + 1;
  END IF;

  RETURN jsonb_build_object(
    'run_id',v_run.id,
    'run_nonce',v_run.run_nonce,
    'game_code',v_game.code,
    'rule_version',v_rule.version_code,
    'countdown_started_at',v_run.countdown_started_at,
    'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
    'schedule_seed',v_run.schedule_seed,
    'config',v_rule.config,
    'is_prerelease_test',v_run.is_prerelease_test,
    'daily_attempt_limit',CASE WHEN v_game.code='pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_limit ELSE NULL END,
    'daily_attempt_used',CASE WHEN v_game.code='pure_reaction_02' AND NOT v_is_live_test_agent THEN v_daily_attempt_used ELSE NULL END,
    'daily_attempt_remaining',CASE WHEN v_game.code='pure_reaction_02' AND NOT v_is_live_test_agent THEN greatest(v_daily_attempt_limit-v_daily_attempt_used,0) ELSE NULL END,
    'daily_attempt_resets_at',CASE WHEN v_game.code='pure_reaction_02' AND NOT v_is_live_test_agent THEN v_day_end ELSE NULL END
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Freeze: pin each eligible game's rule and freeze seed strategy.
-- Pack-mode games must prepare their complete A/B/C pack in the same transaction.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_freeze_arcade_monthly_period(p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_start_date date;
  v_end_date date;
  v_missing_config integer;
  v_recent_inflight integer;
  v_frozen integer;
  v_status text;
  v_game record;
  v_rule_id bigint;
  v_distinct_rules integer;
  v_pack record;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] monthly period not found in this classroom.'
      USING ERRCODE='P0256';
  END IF;

  IF v_period.period_kind<>'MONTHLY' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only monthly periods use record verification.'
      USING ERRCODE='P0257';
  END IF;

  IF v_period.status IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RETURN jsonb_build_object(
      'period_id',v_period.id,
      'status',v_period.status,
      'already_frozen',true
    );
  END IF;

  IF v_period.status<>'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] only an active monthly period can be frozen.'
      USING ERRCODE='P0258';
  END IF;

  IF v_period.ends_at_exclusive>clock_timestamp() THEN
    RAISE EXCEPTION '[ARCADE VERIFY] end the monthly period before freezing records.'
      USING ERRCODE='P0218';
  END IF;

  SELECT count(*)::integer
  INTO v_recent_inflight
  FROM public.arcade_runs r
  WHERE r.classroom_id=v_classroom_id
    AND r.run_context='STANDARD'
    AND NOT r.is_prerelease_test
    AND r.status IN ('COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    AND r.created_at>=greatest(v_period.starts_at,clock_timestamp()-interval '15 minutes')
    AND r.created_at<v_period.ends_at_exclusive;

  IF v_recent_inflight>0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % recent standard run(s) are still in progress; wait for submission before freezing.',v_recent_inflight
      USING ERRCODE='P0272';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_verification_provisional_entries
    WHERE period_id=v_period.id
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] unexpected frozen rows already exist for an ACTIVE period.'
      USING ERRCODE='P0259';
  END IF;

  v_start_date := (v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date;
  v_end_date := ((v_period.ends_at_exclusive-interval '1 microsecond') AT TIME ZONE 'Asia/Seoul')::date;

  SELECT count(*)::integer
  INTO v_missing_config
  FROM public.arcade_games g
  WHERE g.available_from<=v_end_date
    AND (g.available_until IS NULL OR g.available_until>=v_start_date)
    AND NOT EXISTS(
      SELECT 1
      FROM public.arcade_verification_game_configs c
      WHERE c.game_id=g.id
        AND c.is_enabled
    );

  IF v_missing_config>0 THEN
    RAISE EXCEPTION '[ARCADE VERIFY] % eligible game(s) lack an enabled verification config; integrate the game validator first.',v_missing_config
      USING ERRCODE='P0260';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_games g
    JOIN public.arcade_verification_game_configs c
      ON c.game_id=g.id
     AND c.is_enabled
    WHERE g.available_from<=v_end_date
      AND (g.available_until IS NULL OR g.available_until>=v_start_date)
      AND c.target_rank_count<>10
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] current monthly Guild 2 rewards cover Top 10; every eligible game must verify all Top 10 ranks.'
      USING ERRCODE='P0260';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_verification_period_games
    WHERE period_id=v_period.id
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] unexpected frozen game scope already exists for an ACTIVE period.'
      USING ERRCODE='P0259';
  END IF;

  -- Resolve/pin exactly one rule version for every game that will participate.
  FOR v_game IN
    SELECT g.id AS game_id,g.code
    FROM public.arcade_games g
    JOIN public.arcade_verification_game_configs c
      ON c.game_id=g.id
     AND c.is_enabled
    WHERE g.available_from<=v_end_date
      AND (g.available_until IS NULL OR g.available_until>=v_start_date)
    ORDER BY g.id
  LOOP
    SELECT count(DISTINCT r.rule_version_id)::integer,
           min(r.rule_version_id)
    INTO v_distinct_rules,v_rule_id
    FROM public.arcade_runs r
    WHERE r.classroom_id=v_classroom_id
      AND r.game_id=v_game.game_id
      AND r.run_context='STANDARD'
      AND r.status='VERIFIED'
      AND NOT r.is_prerelease_test
      AND r.game_over_at>=v_period.starts_at
      AND r.game_over_at<v_period.ends_at_exclusive
      AND public.is_official_participant(r.student_id)
      AND NOT EXISTS(
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id=r.id
          AND m.event_kind='INVALIDATE'
      );

    IF v_distinct_rules>1 THEN
      RAISE EXCEPTION '[ARCADE RULE PIN] period % game % already contains multiple verified rule versions.',v_period.id,v_game.code
        USING ERRCODE='P0284';
    END IF;

    SELECT pin.rule_version_id
    INTO v_rule_id
    FROM public.arcade_period_game_rule_pins pin
    WHERE pin.period_id=v_period.id
      AND pin.game_id=v_game.game_id;

    IF v_rule_id IS NULL THEN
      SELECT min(r.rule_version_id)
      INTO v_rule_id
      FROM public.arcade_runs r
      WHERE r.classroom_id=v_classroom_id
        AND r.game_id=v_game.game_id
        AND r.run_context='STANDARD'
        AND r.status='VERIFIED'
        AND NOT r.is_prerelease_test
        AND r.game_over_at>=v_period.starts_at
        AND r.game_over_at<v_period.ends_at_exclusive
        AND public.is_official_participant(r.student_id)
        AND NOT EXISTS(
          SELECT 1 FROM public.arcade_run_moderation_events m
          WHERE m.run_id=r.id AND m.event_kind='INVALIDATE'
        );

      IF v_rule_id IS NULL THEN
        SELECT rv.id
        INTO v_rule_id
        FROM public.arcade_game_rule_versions rv
        WHERE rv.game_id=v_game.game_id
          AND rv.is_active
        ORDER BY rv.id DESC
        LIMIT 1;
      END IF;

      IF v_rule_id IS NULL THEN
        RAISE EXCEPTION '[ARCADE VERIFY] game % has no rule version to freeze.',v_game.code
          USING ERRCODE='P0198';
      END IF;

      INSERT INTO public.arcade_period_game_rule_pins(
        classroom_id,period_id,game_id,rule_version_id,pinned_by_user_id
      )
      VALUES(
        v_classroom_id,v_period.id,v_game.game_id,v_rule_id,auth.uid()
      )
      ON CONFLICT(period_id,game_id) DO NOTHING;

      SELECT pin.rule_version_id
      INTO v_rule_id
      FROM public.arcade_period_game_rule_pins pin
      WHERE pin.period_id=v_period.id
        AND pin.game_id=v_game.game_id;
    END IF;

    IF EXISTS(
      SELECT 1
      FROM public.arcade_runs r
      WHERE r.classroom_id=v_classroom_id
        AND r.game_id=v_game.game_id
        AND r.run_context='STANDARD'
        AND r.status='VERIFIED'
        AND NOT r.is_prerelease_test
        AND r.game_over_at>=v_period.starts_at
        AND r.game_over_at<v_period.ends_at_exclusive
        AND r.rule_version_id<>v_rule_id
        AND public.is_official_participant(r.student_id)
        AND NOT EXISTS(
          SELECT 1 FROM public.arcade_run_moderation_events m
          WHERE m.run_id=r.id AND m.event_kind='INVALIDATE'
        )
    ) THEN
      RAISE EXCEPTION '[ARCADE RULE PIN] frozen rule pin conflicts with an existing verified run for game %.',v_game.code
        USING ERRCODE='P0284';
    END IF;
  END LOOP;

  INSERT INTO public.arcade_verification_period_games(
    classroom_id,period_id,game_id,target_rank_count,threshold_percent,max_attempts,
    rule_version_id,seed_strategy,seed_pack_status
  )
  SELECT
    v_classroom_id,
    v_period.id,
    g.id,
    c.target_rank_count,
    c.threshold_percent,
    c.max_attempts,
    pin.rule_version_id,
    c.seed_strategy,
    CASE WHEN c.seed_strategy='PERIOD_PACK_PERMUTED' THEN 'DRAFT' ELSE 'NONE' END
  FROM public.arcade_games g
  JOIN public.arcade_verification_game_configs c
    ON c.game_id=g.id
   AND c.is_enabled
  JOIN public.arcade_period_game_rule_pins pin
    ON pin.period_id=v_period.id
   AND pin.game_id=g.id
  WHERE g.available_from<=v_end_date
    AND (g.available_until IS NULL OR g.available_until>=v_start_date);

  FOR v_pack IN
    SELECT pg.id
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id=v_period.id
      AND pg.seed_strategy='PERIOD_PACK_PERMUTED'
    ORDER BY pg.id
  LOOP
    PERFORM public.arcade_prepare_verification_seed_pack(v_pack.id);
  END LOOP;

  WITH eligible_games AS(
    SELECT pg.game_id AS id
    FROM public.arcade_verification_period_games pg
    WHERE pg.period_id=v_period.id
  ), candidate_runs AS(
    SELECT
      r.id AS source_run_id,
      r.game_id,
      r.student_id,
      r.rule_version_id,
      r.official_score,
      r.official_duration_ms,
      r.stats,
      r.game_over_at,
      row_number() OVER(
        PARTITION BY r.game_id,r.student_id
        ORDER BY r.official_score DESC,r.game_over_at ASC,r.id ASC
      ) AS best_row
    FROM public.arcade_runs r
    JOIN eligible_games eg ON eg.id=r.game_id
    JOIN public.arcade_verification_period_games pg
      ON pg.period_id=v_period.id
     AND pg.game_id=r.game_id
    WHERE r.classroom_id=v_classroom_id
      AND r.run_context='STANDARD'
      AND r.status='VERIFIED'
      AND public.is_official_participant(r.student_id)
      AND NOT r.is_prerelease_test
      AND r.game_over_at>=v_period.starts_at
      AND r.game_over_at<v_period.ends_at_exclusive
      AND r.rule_version_id=pg.rule_version_id
      AND NOT EXISTS(
        SELECT 1
        FROM public.arcade_run_moderation_events m
        WHERE m.run_id=r.id
          AND m.event_kind='INVALIDATE'
      )
  )
  INSERT INTO public.arcade_verification_provisional_entries(
    classroom_id,period_id,game_id,student_id,source_run_id,rule_version_id,
    official_score,official_duration_ms,stats,achieved_at
  )
  SELECT
    v_classroom_id,v_period.id,c.game_id,c.student_id,c.source_run_id,c.rule_version_id,
    c.official_score,c.official_duration_ms,c.stats,c.game_over_at
  FROM candidate_runs c
  WHERE c.best_row=1;

  GET DIAGNOSTICS v_frozen=ROW_COUNT;

  UPDATE public.arcade_ranking_periods
  SET status='VERIFICATION'
  WHERE id=v_period.id;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,
    v_period.id,
    'PERIOD_FROZEN',
    jsonb_build_object('frozen_student_game_rows',v_frozen),
    auth.uid()
  );

  v_status:=public.arcade_refresh_verification_readiness(v_classroom_id,v_period.id);

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'status',v_status,
    'frozen_rows',v_frozen,
    'already_frozen',false
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Teacher starts a verification session.
-- For pack-mode games, create the student's immutable A/B/C permutation once.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_start_arcade_verification_session(
  p_period_id bigint,
  p_game_code text,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_config public.arcade_verification_period_games%ROWTYPE;
  v_provisional public.arcade_verification_provisional_entries%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_threshold bigint;
  v_has_provisional boolean:=false;
  v_assignment_count integer:=0;
  v_slot_count integer:=0;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.'
      USING ERRCODE='P0256';
  END IF;

  IF v_period.period_kind<>'MONTHLY'
     OR v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period is not in verification stage.'
      USING ERRCODE='P0261';
  END IF;

  SELECT id
  INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.'
      USING ERRCODE='P0206';
  END IF;

  SELECT *
  INTO v_config
  FROM public.arcade_verification_period_games
  WHERE period_id=v_period.id
    AND game_id=v_game_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.'
      USING ERRCODE='P0260';
  END IF;

  IF v_config.verification_closed_at IS NOT NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this game verification is already closed.'
      USING ERRCODE='P0277';
  END IF;

  IF NOT EXISTS(
    SELECT 1
    FROM public.students student
    WHERE student.id=p_student_id
      AND student.classroom_id=v_classroom_id
      AND public.is_official_participant(student.id)
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student is not an official participant in this classroom.'
      USING ERRCODE='P0270';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_verification_official_results o
    WHERE o.period_id=v_period.id
      AND o.game_id=v_game_id
      AND o.student_id=p_student_id
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] student already has an official verification result.'
      USING ERRCODE='P0262';
  END IF;

  IF v_config.seed_strategy='PERIOD_PACK_PERMUTED' THEN
    SELECT count(*)::integer
    INTO v_slot_count
    FROM public.arcade_verification_seed_pack_slots slot
    WHERE slot.period_game_id=v_config.id
      AND slot.preflight_status='READY';

    IF v_slot_count<>3 OR v_config.seed_pack_status NOT IN ('DRAFT','LOCKED') THEN
      RAISE EXCEPTION '[ARCADE VERIFY SEED] complete A/B/C seed pack is unavailable.'
        USING ERRCODE='P0282';
    END IF;

    SELECT count(*)::integer
    INTO v_assignment_count
    FROM public.arcade_verification_seed_assignments a
    WHERE a.period_game_id=v_config.id
      AND a.student_id=p_student_id;

    IF v_assignment_count=0 THEN
      WITH shuffled AS(
        SELECT
          slot.id AS seed_slot_id,
          row_number() OVER(ORDER BY extensions.gen_random_uuid())::smallint AS opportunity_number
        FROM public.arcade_verification_seed_pack_slots slot
        WHERE slot.period_game_id=v_config.id
          AND slot.preflight_status='READY'
      )
      INSERT INTO public.arcade_verification_seed_assignments(
        period_game_id,student_id,opportunity_number,seed_slot_id
      )
      SELECT v_config.id,p_student_id,s.opportunity_number,s.seed_slot_id
      FROM shuffled s
      ORDER BY s.opportunity_number;

      SELECT count(*)::integer
      INTO v_assignment_count
      FROM public.arcade_verification_seed_assignments a
      WHERE a.period_game_id=v_config.id
        AND a.student_id=p_student_id;
    END IF;

    IF v_assignment_count<>3 THEN
      RAISE EXCEPTION '[ARCADE VERIFY SEED] student seed assignment is incomplete.'
        USING ERRCODE='P0286';
    END IF;
  END IF;

  SELECT *
  INTO v_session
  FROM public.arcade_verification_sessions
  WHERE period_id=v_period.id
    AND game_id=v_game_id
    AND student_id=p_student_id
    AND status='ACTIVE';

  IF FOUND THEN
    RETURN jsonb_build_object(
      'session_id',v_session.id,
      'status',v_session.status,
      'already_active',true,
      'has_provisional_record',(v_session.provisional_entry_id IS NOT NULL),
      'verification_threshold',v_session.verification_threshold
    );
  END IF;

  SELECT *
  INTO v_provisional
  FROM public.arcade_verification_provisional_entries
  WHERE period_id=v_period.id
    AND game_id=v_game_id
    AND student_id=p_student_id;

  v_has_provisional:=FOUND;

  IF v_config.rule_version_id IS NOT NULL THEN
    SELECT *
    INTO v_rule
    FROM public.arcade_game_rule_versions
    WHERE id=v_config.rule_version_id
      AND game_id=v_game_id;
  ELSIF v_has_provisional THEN
    SELECT *
    INTO v_rule
    FROM public.arcade_game_rule_versions
    WHERE id=v_provisional.rule_version_id
      AND game_id=v_game_id;
  ELSE
    SELECT *
    INTO v_rule
    FROM public.arcade_game_rule_versions
    WHERE game_id=v_game_id
      AND is_active
    ORDER BY id DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen rule version is missing.'
      USING ERRCODE='P0198';
  END IF;

  IF v_has_provisional THEN
    v_threshold:=ceil(
      (v_provisional.official_score::numeric*v_config.threshold_percent::numeric)/100::numeric
    )::bigint;

    INSERT INTO public.arcade_verification_sessions(
      classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
      rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
    )
    VALUES(
      v_classroom_id,v_period.id,v_game_id,p_student_id,v_provisional.id,v_provisional.source_run_id,
      v_rule.id,v_provisional.official_score,v_threshold,v_config.threshold_percent,v_config.max_attempts
    )
    RETURNING * INTO v_session;
  ELSE
    INSERT INTO public.arcade_verification_sessions(
      classroom_id,period_id,game_id,student_id,provisional_entry_id,provisional_source_run_id,
      rule_version_id,provisional_score,verification_threshold,threshold_percent,max_attempts
    )
    VALUES(
      v_classroom_id,v_period.id,v_game_id,p_student_id,NULL,NULL,
      v_rule.id,NULL,NULL,v_config.threshold_percent,v_config.max_attempts
    )
    RETURNING * INTO v_session;
  END IF;

  UPDATE public.arcade_ranking_periods
  SET status='VERIFICATION'
  WHERE id=v_period.id
    AND status='READY_TO_FINALIZE';

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,event_kind,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,v_period.id,v_game_id,p_student_id,v_session.id,'SESSION_STARTED',
    jsonb_build_object(
      'has_provisional_record',v_has_provisional,
      'provisional_score',CASE WHEN v_has_provisional THEN v_provisional.official_score ELSE NULL END,
      'threshold',v_threshold,
      'percent',v_config.threshold_percent,
      'max_attempts',v_config.max_attempts,
      'seed_strategy',v_config.seed_strategy
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'session_id',v_session.id,
    'status','ACTIVE',
    'already_active',false,
    'has_provisional_record',v_has_provisional,
    'verification_threshold',v_session.verification_threshold,
    'max_attempts',v_config.max_attempts
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Expire abandoned/stale verification runs safely.
-- This helper only touches one student's session scope per call.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.arcade_expire_stale_verification_runs(
  p_classroom_id integer,
  p_student_id integer,
  p_session_id bigint DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row record;
  v_count integer:=0;
  v_countdown_ms integer;
  v_preplay_grace_ms integer;
  v_max_elapsed_ms integer;
  v_server_tolerance_ms integer;
  v_submit_grace_ms integer;
  v_used integer;
BEGIN
  FOR v_row IN
    SELECT
      r.id AS run_id,
      r.status AS run_status,
      r.countdown_started_at,
      r.play_started_at,
      r.rule_version_id,
      a.id AS attempt_id,
      a.session_id,
      a.consumed,
      s.max_attempts,
      s.status AS session_status,
      rv.config
    FROM public.arcade_runs r
    JOIN public.arcade_verification_attempts a ON a.run_id=r.id
    JOIN public.arcade_verification_sessions s ON s.id=a.session_id
    JOIN public.arcade_game_rule_versions rv ON rv.id=r.rule_version_id
    WHERE r.classroom_id=p_classroom_id
      AND r.student_id=p_student_id
      AND r.run_context='VERIFICATION'
      AND s.status='ACTIVE'
      AND (p_session_id IS NULL OR s.id=p_session_id)
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
    ORDER BY r.id
    FOR UPDATE OF r,a,s
  LOOP
    v_countdown_ms:=coalesce((v_row.config->>'countdown_ms')::integer,5000);
    v_preplay_grace_ms:=coalesce((v_row.config->>'verification_countdown_stale_ms')::integer,120000);
    v_max_elapsed_ms:=coalesce((v_row.config->>'max_client_elapsed_ms')::integer,3600000);
    v_server_tolerance_ms:=coalesce((v_row.config->>'server_elapsed_tolerance_ms')::integer,10000);
    v_submit_grace_ms:=coalesce((v_row.config->>'verification_submission_grace_ms')::integer,120000);

    IF v_row.run_status IN ('READY','COUNTDOWN')
       AND v_row.countdown_started_at IS NOT NULL
       AND clock_timestamp()>
         v_row.countdown_started_at+
         ((v_countdown_ms+v_preplay_grace_ms)::text||' milliseconds')::interval THEN

      UPDATE public.arcade_runs
      SET status='EXPIRED',
          rejection_code='VERIFICATION_PREPLAY_STALE',
          rejection_reason='Verification countdown expired before PLAYING.'
      WHERE id=v_row.run_id;

      UPDATE public.arcade_verification_attempts
      SET status='TECHNICAL_CANCELLED',
          consumed=false,
          valid_run=false,
          terminal_outcome='PREPLAY_STALE',
          terminal_at=now()
      WHERE id=v_row.attempt_id;

      INSERT INTO public.arcade_verification_audit_events(
        classroom_id,period_id,game_id,student_id,session_id,attempt_id,
        event_kind,reason,metadata,actor_user_id
      )
      SELECT
        s.classroom_id,s.period_id,s.game_id,s.student_id,s.id,v_row.attempt_id,
        'VERIFICATION_RUN_STALE_EXPIRED',
        'Pre-PLAY verification countdown expired.',
        jsonb_build_object('run_id',v_row.run_id,'consumed',false),
        auth.uid()
      FROM public.arcade_verification_sessions s
      WHERE s.id=v_row.session_id;

      v_count:=v_count+1;

    ELSIF v_row.run_status IN ('PLAYING','GAME_OVER','SUBMITTING')
       AND v_row.play_started_at IS NOT NULL
       AND clock_timestamp()>
         v_row.play_started_at+
         ((v_max_elapsed_ms+v_server_tolerance_ms+v_submit_grace_ms)::text||' milliseconds')::interval THEN

      UPDATE public.arcade_runs
      SET status='EXPIRED',
          rejection_code='VERIFICATION_STALE_AFTER_START',
          rejection_reason='Verification run exceeded the server stale ceiling after PLAYING.'
      WHERE id=v_row.run_id;

      UPDATE public.arcade_verification_attempts
      SET status='TERMINAL',
          consumed=true,
          consumed_at=coalesce(consumed_at,v_row.play_started_at,now()),
          valid_run=false,
          terminal_outcome='STALE_EXPIRED',
          official_score=NULL,
          official_duration_ms=NULL,
          stats='{}'::jsonb,
          terminal_at=now()
      WHERE id=v_row.attempt_id;

      INSERT INTO public.arcade_verification_audit_events(
        classroom_id,period_id,game_id,student_id,session_id,attempt_id,
        event_kind,reason,metadata,actor_user_id
      )
      SELECT
        s.classroom_id,s.period_id,s.game_id,s.student_id,s.id,v_row.attempt_id,
        'VERIFICATION_RUN_STALE_EXPIRED',
        'Post-PLAY verification run exceeded stale ceiling.',
        jsonb_build_object('run_id',v_row.run_id,'consumed',true),
        auth.uid()
      FROM public.arcade_verification_sessions s
      WHERE s.id=v_row.session_id;

      SELECT count(*)::integer
      INTO v_used
      FROM public.arcade_verification_attempts a
      WHERE a.session_id=v_row.session_id
        AND a.consumed;

      IF v_used>=v_row.max_attempts THEN
        PERFORM public.arcade_finalize_verification_session(v_row.session_id);
      END IF;

      v_count:=v_count+1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_expire_stale_verification_runs(integer,integer,bigint)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Create verification run.
-- Pack-mode seed is stored server-side but hidden from COUNTDOWN response.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_create_arcade_verification_run(
  p_session_id bigint,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_game public.arcade_games%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_period_game public.arcade_verification_period_games%ROWTYPE;
  v_used integer;
  v_issue integer;
  v_opportunity integer;
  v_seed bigint;
  v_seed_visible boolean;
BEGIN
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.'
      USING ERRCODE='P0195';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY] idempotency key is required.'
      USING ERRCODE='P0208';
  END IF;

  PERFORM public.arcade_expire_stale_verification_runs(
    v_classroom_id,v_student_id,p_session_id
  );

  SELECT a.*
  INTO v_attempt
  FROM public.arcade_verification_attempts a
  JOIN public.arcade_verification_sessions s ON s.id=a.session_id
  WHERE a.idempotency_key=p_idempotency_key
    AND s.classroom_id=v_classroom_id
    AND s.student_id=v_student_id;

  IF FOUND THEN
    SELECT * INTO v_run FROM public.arcade_runs WHERE id=v_attempt.run_id;
    SELECT * INTO v_rule FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
    SELECT * INTO v_game FROM public.arcade_games WHERE id=v_run.game_id;
    SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id;
    SELECT * INTO v_period_game
    FROM public.arcade_verification_period_games
    WHERE period_id=v_session.period_id
      AND game_id=v_session.game_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.'
        USING ERRCODE='P0260';
    END IF;

    v_seed_visible:=
      coalesce(v_period_game.seed_strategy,'RANDOM_PER_ATTEMPT')='RANDOM_PER_ATTEMPT'
      OR v_run.play_started_at IS NOT NULL;

    RETURN jsonb_build_object(
      'run_id',v_run.id,
      'run_nonce',v_run.run_nonce,
      'game_code',v_game.code,
      'rule_version',v_rule.version_code,
      'countdown_started_at',v_run.countdown_started_at,
      'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
      'schedule_seed',CASE WHEN v_seed_visible THEN v_run.schedule_seed ELSE NULL END,
      'config',v_rule.config,
      'is_prerelease_test',false,
      'run_context','VERIFICATION',
      'verification_session_id',v_attempt.session_id,
      'verification_opportunity_number',v_attempt.opportunity_number
    );
  END IF;

  SELECT *
  INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=p_session_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_session.classroom_id IS DISTINCT FROM v_classroom_id
     OR v_session.student_id IS DISTINCT FROM v_student_id
     OR v_session.status<>'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session not found for this student.'
      USING ERRCODE='P0255';
  END IF;

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id;

  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not accepting verification.'
      USING ERRCODE='P0261';
  END IF;

  SELECT *
  INTO v_period_game
  FROM public.arcade_verification_period_games
  WHERE period_id=v_session.period_id
    AND game_id=v_session.game_id
  FOR UPDATE;

  IF NOT FOUND OR v_period_game.verification_closed_at IS NOT NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY] this game verification is closed.'
      USING ERRCODE='P0277';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_runs r
    WHERE r.verification_session_id=v_session.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY] another verification run is already in progress.'
      USING ERRCODE='P0269';
  END IF;

  SELECT count(*)::integer
  INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id
    AND a.consumed;

  IF v_used>=v_session.max_attempts THEN
    RAISE EXCEPTION '[ARCADE VERIFY] no verification attempts remain.'
      USING ERRCODE='P0269';
  END IF;

  SELECT coalesce(max(a.issue_number),0)+1
  INTO v_issue
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id;

  SELECT slot.n
  INTO v_opportunity
  FROM generate_series(1,v_session.max_attempts) AS slot(n)
  WHERE NOT EXISTS(
    SELECT 1
    FROM public.arcade_verification_attempts a
    WHERE a.session_id=v_session.id
      AND a.opportunity_number=slot.n
      AND a.consumed
  )
  ORDER BY slot.n
  LIMIT 1;

  IF v_opportunity IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY] no verification opportunity slot remains.'
      USING ERRCODE='P0269';
  END IF;

  SELECT *
  INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE id=v_session.rule_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen rule version is missing.'
      USING ERRCODE='P0198';
  END IF;

  SELECT *
  INTO v_game
  FROM public.arcade_games
  WHERE id=v_session.game_id;

  IF v_period_game.seed_strategy='PERIOD_PACK_PERMUTED' THEN
    SELECT slot.gameplay_seed
    INTO v_seed
    FROM public.arcade_verification_seed_assignments assignment
    JOIN public.arcade_verification_seed_pack_slots slot
      ON slot.id=assignment.seed_slot_id
     AND slot.period_game_id=assignment.period_game_id
    WHERE assignment.period_game_id=v_period_game.id
      AND assignment.student_id=v_student_id
      AND assignment.opportunity_number=v_opportunity
      AND slot.preflight_status='READY';

    IF v_seed IS NULL THEN
      RAISE EXCEPTION '[ARCADE VERIFY SEED] assigned verification seed is missing.'
        USING ERRCODE='P0286';
    END IF;

    v_seed_visible:=false;
  ELSE
    v_seed:=public.arcade_generate_run_seed();
    v_seed_visible:=true;
  END IF;

  INSERT INTO public.arcade_runs(
    classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,
    countdown_started_at,is_prerelease_test,run_context,verification_session_id
  )
  VALUES(
    v_classroom_id,v_student_id,v_session.game_id,v_session.rule_version_id,
    'COUNTDOWN',v_seed,now(),false,'VERIFICATION',v_session.id
  )
  RETURNING * INTO v_run;

  INSERT INTO public.arcade_verification_attempts(
    session_id,issue_number,opportunity_number,run_id,idempotency_key
  )
  VALUES(
    v_session.id,v_issue,v_opportunity,v_run.id,p_idempotency_key
  )
  RETURNING * INTO v_attempt;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,
    event_kind,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,v_session.period_id,v_session.game_id,v_student_id,
    v_session.id,v_attempt.id,'ATTEMPT_ISSUED',
    jsonb_build_object(
      'run_id',v_run.id,
      'issue_number',v_issue,
      'opportunity_number',v_opportunity,
      'seed_strategy',v_period_game.seed_strategy
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'run_id',v_run.id,
    'run_nonce',v_run.run_nonce,
    'game_code',v_game.code,
    'rule_version',v_rule.version_code,
    'countdown_started_at',v_run.countdown_started_at,
    'countdown_ends_at',v_run.countdown_started_at+((v_rule.config->>'countdown_ms')::integer*interval '1 millisecond'),
    'schedule_seed',CASE WHEN v_seed_visible THEN v_run.schedule_seed ELSE NULL END,
    'config',v_rule.config,
    'is_prerelease_test',false,
    'run_context','VERIFICATION',
    'verification_session_id',v_session.id,
    'verification_opportunity_number',v_opportunity
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. Begin run.
-- Verification attempt consumption and pack LOCK happen atomically with PLAYING.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_begin_arcade_run(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_countdown_ms integer;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period_game public.arcade_verification_period_games%ROWTYPE;
  v_expected_seed bigint;
  v_now timestamptz;
BEGIN
  v_student_id:=public.current_student_id();
  v_classroom_id:=public.current_classroom_id();

  SELECT run.*
  INTO v_run
  FROM public.arcade_runs run
  WHERE run.id=p_run_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_run.student_id IS DISTINCT FROM v_student_id
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.'
      USING ERRCODE='P0199';
  END IF;

  SELECT config
  INTO v_config
  FROM public.arcade_game_rule_versions
  WHERE id=v_run.rule_version_id;

  -- Idempotent begin recovery if the first response was lost.
  -- Also normalizes a verification run that was already PLAYING when this
  -- migration was deployed under the legacy "consume at terminal" behavior.
  IF v_run.status='PLAYING' AND v_run.play_started_at IS NOT NULL THEN
    IF v_run.run_context='VERIFICATION' THEN
      SELECT *
      INTO v_attempt
      FROM public.arcade_verification_attempts
      WHERE run_id=v_run.id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.'
          USING ERRCODE='P0254';
      END IF;

      SELECT *
      INTO v_session
      FROM public.arcade_verification_sessions
      WHERE id=v_attempt.session_id
      FOR UPDATE;

      IF NOT FOUND OR v_session.status<>'ACTIVE' THEN
        RAISE EXCEPTION '[ARCADE VERIFY] active verification session is missing.'
          USING ERRCODE='P0255';
      END IF;

      SELECT *
      INTO v_period_game
      FROM public.arcade_verification_period_games
      WHERE period_id=v_session.period_id
        AND game_id=v_session.game_id
      FOR UPDATE;

      IF NOT FOUND OR v_period_game.verification_closed_at IS NOT NULL THEN
        RAISE EXCEPTION '[ARCADE VERIFY] this game verification is closed.'
          USING ERRCODE='P0277';
      END IF;

      IF NOT v_attempt.consumed THEN
        UPDATE public.arcade_verification_attempts
        SET consumed=true,
            consumed_at=coalesce(consumed_at,v_run.play_started_at)
        WHERE id=v_attempt.id
        RETURNING * INTO v_attempt;

        INSERT INTO public.arcade_verification_audit_events(
          classroom_id,period_id,game_id,student_id,session_id,attempt_id,
          event_kind,metadata,actor_user_id
        )
        VALUES(
          v_session.classroom_id,v_session.period_id,v_session.game_id,
          v_session.student_id,v_session.id,v_attempt.id,
          'VERIFICATION_ATTEMPT_CONSUMED_ON_PLAY',
          jsonb_build_object(
            'run_id',v_run.id,
            'opportunity_number',v_attempt.opportunity_number,
            'legacy_playing_normalized',true
          ),
          auth.uid()
        );
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'run_id',v_run.id,
      'run_nonce',v_run.run_nonce,
      'play_started_at',v_run.play_started_at,
      'schedule_seed',v_run.schedule_seed,
      'config',v_config
    );
  END IF;

  IF v_run.status<>'COUNTDOWN' THEN
    RAISE EXCEPTION '[ARCADE] run cannot begin from its current state.'
      USING ERRCODE='P0200';
  END IF;

  v_countdown_ms:=(v_config->>'countdown_ms')::integer;

  IF clock_timestamp()<
     v_run.countdown_started_at+(v_countdown_ms*interval '1 millisecond') THEN
    RAISE EXCEPTION '[ARCADE] 5-second countdown is not complete yet.'
      USING ERRCODE='P0201';
  END IF;

  v_now:=clock_timestamp();

  IF v_run.run_context='VERIFICATION' THEN
    SELECT *
    INTO v_attempt
    FROM public.arcade_verification_attempts
    WHERE run_id=v_run.id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.'
        USING ERRCODE='P0254';
    END IF;

    SELECT *
    INTO v_session
    FROM public.arcade_verification_sessions
    WHERE id=v_attempt.session_id
    FOR UPDATE;

    IF NOT FOUND OR v_session.status<>'ACTIVE' THEN
      RAISE EXCEPTION '[ARCADE VERIFY] active verification session is missing.'
        USING ERRCODE='P0255';
    END IF;

    SELECT *
    INTO v_period_game
    FROM public.arcade_verification_period_games
    WHERE period_id=v_session.period_id
      AND game_id=v_session.game_id
    FOR UPDATE;

    IF NOT FOUND OR v_period_game.verification_closed_at IS NOT NULL THEN
      RAISE EXCEPTION '[ARCADE VERIFY] this game verification is closed.'
        USING ERRCODE='P0277';
    END IF;

    IF v_attempt.status<>'ISSUED' OR v_attempt.consumed THEN
      RAISE EXCEPTION '[ARCADE VERIFY] verification opportunity is no longer available.'
        USING ERRCODE='P0269';
    END IF;

    IF v_period_game.seed_strategy='PERIOD_PACK_PERMUTED' THEN
      SELECT slot.gameplay_seed
      INTO v_expected_seed
      FROM public.arcade_verification_seed_assignments assignment
      JOIN public.arcade_verification_seed_pack_slots slot
        ON slot.id=assignment.seed_slot_id
       AND slot.period_game_id=assignment.period_game_id
      WHERE assignment.period_game_id=v_period_game.id
        AND assignment.student_id=v_student_id
        AND assignment.opportunity_number=v_attempt.opportunity_number
        AND slot.preflight_status='READY';

      IF v_expected_seed IS NULL
         OR v_expected_seed IS DISTINCT FROM v_run.schedule_seed THEN
        RAISE EXCEPTION '[ARCADE VERIFY SEED] run seed does not match immutable assignment.'
          USING ERRCODE='P0286';
      END IF;

      IF v_period_game.seed_pack_status='DRAFT' THEN
        UPDATE public.arcade_verification_period_games
        SET seed_pack_status='LOCKED',
            seed_pack_locked_at=v_now,
            seed_pack_locked_by_run_id=v_run.id
        WHERE id=v_period_game.id
        RETURNING * INTO v_period_game;

        INSERT INTO public.arcade_verification_audit_events(
          classroom_id,period_id,game_id,student_id,session_id,attempt_id,
          event_kind,metadata,actor_user_id
        )
        VALUES(
          v_session.classroom_id,v_session.period_id,v_session.game_id,
          v_session.student_id,v_session.id,v_attempt.id,
          'VERIFICATION_SEED_PACK_LOCKED',
          jsonb_build_object('run_id',v_run.id),
          auth.uid()
        );
      ELSIF v_period_game.seed_pack_status<>'LOCKED' THEN
        RAISE EXCEPTION '[ARCADE VERIFY SEED] verification seed pack is not ready.'
          USING ERRCODE='P0282';
      END IF;
    END IF;

    UPDATE public.arcade_verification_attempts
    SET consumed=true,
        consumed_at=coalesce(consumed_at,v_now)
    WHERE id=v_attempt.id
    RETURNING * INTO v_attempt;

    INSERT INTO public.arcade_verification_audit_events(
      classroom_id,period_id,game_id,student_id,session_id,attempt_id,
      event_kind,metadata,actor_user_id
    )
    VALUES(
      v_session.classroom_id,v_session.period_id,v_session.game_id,
      v_session.student_id,v_session.id,v_attempt.id,
      'VERIFICATION_ATTEMPT_CONSUMED_ON_PLAY',
      jsonb_build_object(
        'run_id',v_run.id,
        'opportunity_number',v_attempt.opportunity_number
      ),
      auth.uid()
    );
  END IF;

  UPDATE public.arcade_runs
  SET status='PLAYING',
      play_started_at=v_now
  WHERE id=v_run.id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id',v_run.id,
    'run_nonce',v_run.run_nonce,
    'play_started_at',v_run.play_started_at,
    'schedule_seed',v_run.schedule_seed,
    'config',v_config
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 9. Capture terminal verification attempt.
-- consumed=true should already be set at PLAYING, but legacy in-flight runs are
-- tolerated and backfilled at capture.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.arcade_capture_verification_attempt(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_run public.arcade_runs%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_used integer;
  v_valid boolean;
  v_result jsonb;
BEGIN
  SELECT *
  INTO v_run
  FROM public.arcade_runs
  WHERE id=p_run_id;

  IF NOT FOUND OR v_run.run_context<>'VERIFICATION' THEN
    RETURN jsonb_build_object('captured',false,'reason','NOT_VERIFICATION');
  END IF;

  IF v_run.status NOT IN ('VERIFIED','REJECTED') THEN
    RETURN jsonb_build_object('captured',false,'reason','NOT_TERMINAL');
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE run_id=v_run.id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.'
      USING ERRCODE='P0254';
  END IF;

  SELECT *
  INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session is missing.'
      USING ERRCODE='P0255';
  END IF;

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id
    AND classroom_id=v_session.classroom_id;

  IF NOT FOUND OR v_period.status='FINALIZED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] target period is not mutable.'
      USING ERRCODE='P0216';
  END IF;

  SELECT *
  INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id
  FOR UPDATE;

  SELECT *
  INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE id=v_attempt.id
  FOR UPDATE;

  IF v_attempt.status='TERMINAL' AND v_attempt.consumed THEN
    RETURN jsonb_build_object(
      'captured',true,
      'already_captured',true,
      'attempt_id',v_attempt.id
    );
  END IF;

  IF v_attempt.status IN ('TECHNICAL_CANCELLED','RESTORED') THEN
    RETURN jsonb_build_object('captured',false,'reason',v_attempt.status);
  END IF;

  IF v_session.status<>'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE VERIFY] active verification session is missing.'
      USING ERRCODE='P0255';
  END IF;

  v_valid:=v_run.status='VERIFIED' AND v_run.official_score IS NOT NULL;

  UPDATE public.arcade_verification_attempts
  SET status='TERMINAL',
      consumed=true,
      consumed_at=coalesce(consumed_at,v_run.play_started_at,now()),
      valid_run=v_valid,
      terminal_outcome=CASE
        WHEN v_valid THEN 'VERIFIED'
        ELSE coalesce(v_run.rejection_code,'REJECTED')
      END,
      official_score=CASE WHEN v_valid THEN v_run.official_score ELSE NULL END,
      official_duration_ms=CASE WHEN v_valid THEN v_run.official_duration_ms ELSE NULL END,
      stats=CASE WHEN v_valid THEN v_run.stats ELSE '{}'::jsonb END,
      terminal_at=now()
  WHERE id=v_attempt.id
  RETURNING * INTO v_attempt;

  IF v_valid
     AND v_session.verification_threshold IS NOT NULL
     AND v_run.official_score>=v_session.verification_threshold THEN
    UPDATE public.arcade_verification_sessions
    SET success_achieved=true
    WHERE id=v_session.id;

    v_session.success_achieved:=true;
  END IF;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,
    event_kind,metadata,actor_user_id
  )
  VALUES(
    v_session.classroom_id,v_session.period_id,v_session.game_id,
    v_session.student_id,v_session.id,v_attempt.id,
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

  SELECT count(*)::integer
  INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id
    AND a.consumed;

  IF v_used>=v_session.max_attempts THEN
    v_result:=public.arcade_finalize_verification_session(v_session.id);
  END IF;

  RETURN jsonb_build_object(
    'captured',true,
    'attempt_id',v_attempt.id,
    'consumed_attempts',v_used,
    'success_achieved',v_session.success_achieved,
    'session_result',v_result
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. Student explicitly abandons a run.
-- Pre-PLAY cancellation is free; post-PLAY abandonment consumes the attempt.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_abandon_arcade_run(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_run public.arcade_runs%ROWTYPE;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_used integer;
  v_result jsonb;
BEGIN
  SELECT *
  INTO v_run
  FROM public.arcade_runs
  WHERE id=p_run_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id
     OR v_run.student_id IS DISTINCT FROM v_student_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.'
      USING ERRCODE='P0199';
  END IF;

  IF v_run.status IN ('VERIFIED','REJECTED','EXPIRED') THEN
    RETURN jsonb_build_object(
      'run_id',v_run.id,
      'status',v_run.status,
      'already_terminal',true
    );
  END IF;

  IF v_run.run_context='STANDARD' THEN
    UPDATE public.arcade_runs
    SET status='EXPIRED',
        rejection_code='STUDENT_ABANDONED',
        rejection_reason='Student abandoned the standard run.'
    WHERE id=v_run.id;

    RETURN jsonb_build_object(
      'run_id',v_run.id,
      'status','EXPIRED',
      'attempt_consumed',NULL
    );
  END IF;

  SELECT *
  INTO v_attempt
  FROM public.arcade_verification_attempts
  WHERE run_id=v_run.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification attempt link is missing.'
      USING ERRCODE='P0254';
  END IF;

  SELECT *
  INTO v_session
  FROM public.arcade_verification_sessions
  WHERE id=v_attempt.session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] verification session is missing.'
      USING ERRCODE='P0255';
  END IF;

  IF v_run.play_started_at IS NULL
     AND v_run.status IN ('READY','COUNTDOWN') THEN

    UPDATE public.arcade_runs
    SET status='EXPIRED',
        rejection_code='VERIFICATION_PREPLAY_CANCELLED',
        rejection_reason='Student cancelled before PLAYING.'
    WHERE id=v_run.id;

    UPDATE public.arcade_verification_attempts
    SET status='TECHNICAL_CANCELLED',
        consumed=false,
        valid_run=false,
        terminal_outcome='PREPLAY_CANCELLED',
        terminal_at=now()
    WHERE id=v_attempt.id;

    INSERT INTO public.arcade_verification_audit_events(
      classroom_id,period_id,game_id,student_id,session_id,attempt_id,
      event_kind,reason,metadata,actor_user_id
    )
    VALUES(
      v_session.classroom_id,v_session.period_id,v_session.game_id,
      v_session.student_id,v_session.id,v_attempt.id,
      'VERIFICATION_RUN_ABANDONED',
      'Student cancelled before PLAYING.',
      jsonb_build_object('run_id',v_run.id,'consumed',false),
      auth.uid()
    );

    RETURN jsonb_build_object(
      'run_id',v_run.id,
      'status','EXPIRED',
      'attempt_consumed',false,
      'opportunity_number',v_attempt.opportunity_number
    );
  END IF;

  UPDATE public.arcade_runs
  SET status='EXPIRED',
      rejection_code='VERIFICATION_ABANDONED_AFTER_START',
      rejection_reason='Student abandoned after PLAYING.'
  WHERE id=v_run.id;

  UPDATE public.arcade_verification_attempts
  SET status='TERMINAL',
      consumed=true,
      consumed_at=coalesce(consumed_at,v_run.play_started_at,now()),
      valid_run=false,
      terminal_outcome='ABANDONED',
      official_score=NULL,
      official_duration_ms=NULL,
      stats='{}'::jsonb,
      terminal_at=now()
  WHERE id=v_attempt.id;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,game_id,student_id,session_id,attempt_id,
    event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_session.classroom_id,v_session.period_id,v_session.game_id,
    v_session.student_id,v_session.id,v_attempt.id,
    'VERIFICATION_RUN_ABANDONED',
    'Student abandoned after PLAYING.',
    jsonb_build_object(
      'run_id',v_run.id,
      'consumed',true,
      'opportunity_number',v_attempt.opportunity_number
    ),
    auth.uid()
  );

  SELECT count(*)::integer
  INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id
    AND a.consumed;

  IF v_session.status='ACTIVE' AND v_used>=v_session.max_attempts THEN
    v_result:=public.arcade_finalize_verification_session(v_session.id);
  END IF;

  RETURN jsonb_build_object(
    'run_id',v_run.id,
    'status','EXPIRED',
    'attempt_consumed',true,
    'opportunity_number',v_attempt.opportunity_number,
    'consumed_attempts',v_used,
    'session_result',v_result
  );
END;
$$;

REVOKE ALL ON FUNCTION public.student_abandon_arcade_run(bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_abandon_arcade_run(bigint)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 11. Student verification state with stale cleanup and active-run status.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_get_arcade_verification_state(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id integer:=public.current_classroom_id();
  v_student_id integer:=public.current_student_id();
  v_game_id bigint;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_period_game public.arcade_verification_period_games%ROWTYPE;
  v_used integer;
  v_active_run_id bigint;
  v_active_run_status text;
  v_active_run_started_at timestamptz;
  v_rank integer;
BEGIN
  IF v_classroom_id IS NULL OR v_student_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.'
      USING ERRCODE='P0195';
  END IF;

  SELECT id
  INTO v_game_id
  FROM public.arcade_games
  WHERE code=p_game_code;

  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.'
      USING ERRCODE='P0206';
  END IF;

  SELECT s.*
  INTO v_session
  FROM public.arcade_verification_sessions s
  JOIN public.arcade_ranking_periods p ON p.id=s.period_id
  WHERE s.classroom_id=v_classroom_id
    AND s.student_id=v_student_id
    AND s.game_id=v_game_id
    AND p.status IN ('VERIFICATION','READY_TO_FINALIZE')
    AND s.status IN ('ACTIVE','COMPLETED')
  ORDER BY (s.status='ACTIVE') DESC,s.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'available',false,
      'game_code',p_game_code
    );
  END IF;

  IF v_session.status='ACTIVE' THEN
    PERFORM public.arcade_expire_stale_verification_runs(
      v_classroom_id,v_student_id,v_session.id
    );

    SELECT *
    INTO v_session
    FROM public.arcade_verification_sessions
    WHERE id=v_session.id;
  END IF;

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=v_session.period_id;

  SELECT *
  INTO v_period_game
  FROM public.arcade_verification_period_games
  WHERE period_id=v_session.period_id
    AND game_id=v_game_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] frozen game verification config is missing.'
      USING ERRCODE='P0260';
  END IF;

  SELECT count(*)::integer
  INTO v_used
  FROM public.arcade_verification_attempts a
  WHERE a.session_id=v_session.id
    AND a.consumed;

  SELECT r.id,r.status,r.play_started_at
  INTO v_active_run_id,v_active_run_status,v_active_run_started_at
  FROM public.arcade_runs r
  WHERE r.verification_session_id=v_session.id
    AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ORDER BY r.id DESC
  LIMIT 1;

  SELECT r.rank
  INTO v_rank
  FROM public.arcade_resolve_period_student_ranks(
    v_classroom_id,v_session.period_id,v_game_id
  ) r
  WHERE r.student_id=v_student_id;

  RETURN jsonb_build_object(
    'available',true,
    'game_code',p_game_code,
    'period_id',v_period.id,
    'period_name',v_period.display_name,
    'period_status',v_period.status,
    'game_verification_closed',(v_period_game.verification_closed_at IS NOT NULL),
    'session_id',v_session.id,
    'session_status',v_session.status,
    'has_provisional_record',(v_session.provisional_entry_id IS NOT NULL),
    'provisional_score',v_session.provisional_score,
    'verification_threshold',v_session.verification_threshold,
    'threshold_percent',v_session.threshold_percent,
    'max_attempts',v_session.max_attempts,
    'used_attempts',v_used,
    'remaining_attempts',greatest(v_session.max_attempts-v_used,0),
    'success_achieved',v_session.success_achieved,
    'result_status',v_session.result_status,
    'current_rank',v_rank,
    'active_run_id',v_active_run_id,
    'active_run_status',v_active_run_status,
    'active_run_play_started_at',v_active_run_started_at,
    'can_attempt',(
      v_session.status='ACTIVE'
      AND v_period_game.verification_closed_at IS NULL
      AND v_used<v_session.max_attempts
      AND v_active_run_id IS NULL
    ),
    'attempts',coalesce((
      SELECT jsonb_agg(
        jsonb_build_object(
          'attempt_id',a.id,
          'issue_number',a.issue_number,
          'opportunity_number',a.opportunity_number,
          'run_id',a.run_id,
          'status',a.status,
          'consumed',a.consumed,
          'consumed_at',a.consumed_at,
          'valid_run',a.valid_run,
          'terminal_outcome',a.terminal_outcome,
          'official_score',a.official_score,
          'issued_at',a.issued_at,
          'terminal_at',a.terminal_at
        )
        ORDER BY a.issue_number
      )
      FROM public.arcade_verification_attempts a
      WHERE a.session_id=v_session.id
    ),'[]'::jsonb)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Grants / reload.
-- Existing public RPC grants are preserved by CREATE OR REPLACE.
-- -----------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.student_create_arcade_run(text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_create_arcade_verification_run(bigint,uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_begin_arcade_run(bigint)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_get_arcade_verification_state(text)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
