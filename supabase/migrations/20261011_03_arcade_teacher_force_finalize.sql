-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade STEP 2-C teacher force-finalize
-- 2026-10-11
--
-- Adds:
--   * safe preview of what a forced monthly finalization will close
--   * one teacher RPC that force-closes every Arcade verification game,
--     cancels unfinished Rakaruka official sessions, and finalizes the monthly
--     snapshot/Guild2 contribution in the SAME database transaction
--
-- Important:
--   * existing official results are preserved
--   * unresolved reward-range records fall back to frozen provisional records
--     through teacher_force_close_arcade_game_verification()
--   * ACTIVE monthly periods are NOT accepted; teacher must end/freeze first
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.teacher_force_close_arcade_game_verification(bigint,text,text)') IS NULL
     OR to_regprocedure('public.teacher_finalize_arcade_monthly_snapshot(bigint)') IS NULL
     OR to_regprocedure('public.arcade_refresh_verification_readiness(integer,bigint)') IS NULL
     OR to_regclass('public.arcade_verification_period_games') IS NULL
     OR to_regclass('public.arcade_verification_official_results') IS NULL
     OR to_regclass('public.tikatuka_official_sessions') IS NULL
     OR to_regclass('public.tikatuka_official_windows') IS NULL
  THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] required Arcade/Rakaruka baseline is missing.';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Read-only preview payload for the teacher confirmation modal.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_force_finalize_preview(
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_games jsonb;
  v_rakaruka_active integer:=0;
  v_decided integer:=0;
  v_adopt integer:=0;
  v_active_runs integer:=0;
  v_active_sessions integer:=0;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
    AND classroom_id=v_classroom_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] monthly period not found in this classroom.'
      USING ERRCODE='P0214';
  END IF;

  IF v_period.period_kind<>'MONTHLY' THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] only a monthly period can be finalized.'
      USING ERRCODE='P0215';
  END IF;

  WITH per_game AS(
    SELECT
      pg.game_id,
      g.code AS game_code,
      pg.target_rank_count,
      pg.verification_closed_at,
      (
        SELECT count(*)::integer
        FROM public.arcade_resolve_period_student_ranks(
          v_classroom_id,v_period.id,pg.game_id
        ) r
        WHERE r.rank<=pg.target_rank_count
          AND NOT EXISTS(
            SELECT 1
            FROM public.arcade_verification_official_results o
            WHERE o.period_id=v_period.id
              AND o.game_id=pg.game_id
              AND o.student_id=r.student_id
          )
      ) AS unresolved_reward_range,
      (
        SELECT count(*)::integer
        FROM public.arcade_verification_sessions s
        WHERE s.classroom_id=v_classroom_id
          AND s.period_id=v_period.id
          AND s.game_id=pg.game_id
          AND s.status='ACTIVE'
      ) AS active_sessions,
      (
        SELECT count(*)::integer
        FROM public.arcade_runs r
        JOIN public.arcade_verification_sessions s
          ON s.id=r.verification_session_id
        WHERE s.classroom_id=v_classroom_id
          AND s.period_id=v_period.id
          AND s.game_id=pg.game_id
          AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
      ) AS active_runs,
      (
        SELECT count(*)::integer
        FROM public.arcade_resolve_period_student_ranks(
          v_classroom_id,v_period.id,pg.game_id
        ) r
        JOIN public.arcade_verification_provisional_entries p
          ON p.period_id=v_period.id
         AND p.game_id=pg.game_id
         AND p.student_id=r.student_id
        WHERE r.rank<=pg.target_rank_count
          AND NOT EXISTS(
            SELECT 1
            FROM public.arcade_verification_official_results o
            WHERE o.period_id=v_period.id
              AND o.game_id=pg.game_id
              AND o.student_id=r.student_id
          )
      ) AS will_adopt_frozen_provisional
    FROM public.arcade_verification_period_games pg
    JOIN public.arcade_games g ON g.id=pg.game_id
    WHERE pg.period_id=v_period.id
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'game_code',game_code,
          'target_rank_count',target_rank_count,
          'verification_closed',(verification_closed_at IS NOT NULL),
          'unresolved_reward_range',unresolved_reward_range,
          'active_sessions',active_sessions,
          'active_runs',active_runs,
          'will_adopt_frozen_provisional',will_adopt_frozen_provisional
        )
        ORDER BY game_id
      ),
      '[]'::jsonb
    ),
    coalesce(sum(active_sessions),0)::integer,
    coalesce(sum(active_runs),0)::integer,
    coalesce(sum(will_adopt_frozen_provisional),0)::integer
  INTO v_games,v_active_sessions,v_active_runs,v_adopt
  FROM per_game;

  SELECT count(*)::integer
  INTO v_decided
  FROM public.arcade_verification_official_results o
  WHERE o.classroom_id=v_classroom_id
    AND o.period_id=v_period.id;

  SELECT count(*)::integer
  INTO v_rakaruka_active
  FROM public.tikatuka_official_sessions os
  WHERE os.classroom_id=v_classroom_id
    AND os.arcade_period_id=v_period.id
    AND os.status='ACTIVE';

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'period_name',v_period.display_name,
    'period_status',v_period.status,
    'already_finalized',(v_period.status='FINALIZED'),
    'games',v_games,
    'active_verification_sessions',v_active_sessions,
    'active_verification_runs',v_active_runs,
    'already_decided_records',v_decided,
    'will_adopt_frozen_provisional',v_adopt,
    'rakaruka_active_sessions',v_rakaruka_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_get_arcade_force_finalize_preview(bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_force_finalize_preview(bigint)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. Force-close everything left in the period and finalize atomically.
-- A PostgreSQL function call is one transaction: any later failure rolls all
-- prior game/session close operations back.
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.teacher_force_finalize_arcade_period(
  p_period_id bigint,
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
  v_game record;
  v_game_result jsonb;
  v_game_results jsonb:='[]'::jsonb;
  v_rakaruka_cancelled integer:=0;
  v_rakaruka_window_closed integer:=0;
  v_ready text;
  v_finalize jsonb;
  v_finalization_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();

  IF char_length(btrim(coalesce(p_reason,''))) NOT BETWEEN 2 AND 500 THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] reason must be 2 to 500 characters.'
      USING ERRCODE='22023';
  END IF;

  SELECT *
  INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id=p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] monthly period not found in this classroom.'
      USING ERRCODE='P0214';
  END IF;

  IF v_period.period_kind<>'MONTHLY'
     OR v_period.contribution_year_month IS NULL THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] only a monthly period can be finalized.'
      USING ERRCODE='P0215';
  END IF;

  IF v_period.status='FINALIZED' THEN
    SELECT f.id
    INTO v_finalization_id
    FROM public.arcade_monthly_finalizations f
    WHERE f.period_id=v_period.id
    ORDER BY f.id DESC
    LIMIT 1;

    RETURN jsonb_build_object(
      'period_id',v_period.id,
      'status','FINALIZED',
      'already_finalized',true,
      'finalization_id',v_finalization_id
    );
  END IF;

  IF v_period.status NOT IN ('VERIFICATION','READY_TO_FINALIZE') THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] end and freeze the monthly period before force-finalizing.'
      USING ERRCODE='P0287';
  END IF;

  -- Lock all frozen game scopes in stable order before students can transition
  -- any new verification run into PLAYING.
  PERFORM pg.id
  FROM public.arcade_verification_period_games pg
  WHERE pg.period_id=v_period.id
  ORDER BY pg.game_id
  FOR UPDATE;

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,
    v_period.id,
    'PERIOD_FORCE_FINALIZE_STARTED',
    btrim(p_reason),
    jsonb_build_object('status_before',v_period.status),
    auth.uid()
  );

  FOR v_game IN
    SELECT g.code
    FROM public.arcade_verification_period_games pg
    JOIN public.arcade_games g ON g.id=pg.game_id
    WHERE pg.period_id=v_period.id
    ORDER BY pg.game_id
  LOOP
    v_game_result:=public.teacher_force_close_arcade_game_verification(
      v_period.id,
      v_game.code,
      btrim(p_reason)
    );

    v_game_results:=v_game_results||jsonb_build_array(
      jsonb_build_object(
        'game_code',v_game.code,
        'result',v_game_result
      )
    );
  END LOOP;

  -- Rakaruka uses the same monthly Arcade period but a separate official-session
  -- subsystem. Closing the window is terminal for unfinished official sessions.
  UPDATE public.tikatuka_official_windows w
  SET is_open=false,
      closed_at=coalesce(w.closed_at,now()),
      updated_at=now()
  WHERE w.classroom_id=v_classroom_id
    AND w.arcade_period_id=v_period.id
    AND w.is_open;

  GET DIAGNOSTICS v_rakaruka_window_closed=ROW_COUNT;

  UPDATE public.tikatuka_official_sessions os
  SET status='CANCELLED',
      completed_at=coalesce(os.completed_at,now())
  WHERE os.classroom_id=v_classroom_id
    AND os.arcade_period_id=v_period.id
    AND os.status='ACTIVE';

  GET DIAGNOSTICS v_rakaruka_cancelled=ROW_COUNT;

  IF v_rakaruka_cancelled>0 OR v_rakaruka_window_closed>0 THEN
    INSERT INTO public.arcade_verification_audit_events(
      classroom_id,period_id,event_kind,reason,metadata,actor_user_id
    )
    VALUES(
      v_classroom_id,
      v_period.id,
      'PERIOD_FORCE_FINALIZE_RAKARUKA_CANCELLED',
      btrim(p_reason),
      jsonb_build_object(
        'cancelled_active_sessions',v_rakaruka_cancelled,
        'closed_official_window_rows',v_rakaruka_window_closed
      ),
      auth.uid()
    );
  END IF;

  v_ready:=public.arcade_refresh_verification_readiness(
    v_classroom_id,
    v_period.id
  );

  IF v_ready<>'READY_TO_FINALIZE' THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] forced close did not reach READY_TO_FINALIZE (status=%).',v_ready
      USING ERRCODE='P0288';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.arcade_runs r
    JOIN public.arcade_verification_sessions s
      ON s.id=r.verification_session_id
    WHERE s.period_id=v_period.id
      AND r.status IN ('READY','COUNTDOWN','PLAYING','GAME_OVER','SUBMITTING')
  ) THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] verification run remains active after forced close.'
      USING ERRCODE='P0288';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id=v_classroom_id
      AND os.arcade_period_id=v_period.id
      AND os.status='ACTIVE'
  ) THEN
    RAISE EXCEPTION '[ARCADE FORCE FINALIZE] Rakaruka official session remains active after forced close.'
      USING ERRCODE='P0288';
  END IF;

  v_finalize:=public.teacher_finalize_arcade_monthly_snapshot(v_period.id);

  INSERT INTO public.arcade_verification_audit_events(
    classroom_id,period_id,event_kind,reason,metadata,actor_user_id
  )
  VALUES(
    v_classroom_id,
    v_period.id,
    'PERIOD_FORCE_FINALIZED',
    btrim(p_reason),
    jsonb_build_object(
      'game_results',v_game_results,
      'rakaruka_cancelled_active_sessions',v_rakaruka_cancelled,
      'rakaruka_window_closed_rows',v_rakaruka_window_closed,
      'finalization',v_finalize
    ),
    auth.uid()
  );

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'status','FINALIZED',
    'already_finalized',false,
    'game_results',v_game_results,
    'rakaruka_cancelled_active_sessions',v_rakaruka_cancelled,
    'rakaruka_window_closed_rows',v_rakaruka_window_closed,
    'finalization',v_finalize
  );
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_force_finalize_arcade_period(bigint,text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_force_finalize_arcade_period(bigint,text)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
