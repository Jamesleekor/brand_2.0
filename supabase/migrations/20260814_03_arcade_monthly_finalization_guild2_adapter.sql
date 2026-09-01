-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade 0.1 atomic monthly finalization + Guild 2 adapter
-- 2026-08-14
--
-- Scope
--   * Finalizes every eligible game for one monthly period in one transaction.
--   * Eligible games are determined from availability dates and the period, not
--     from the value of is_active at finalization time.
--   * Extends the verified production Guild 2 refresh functions without
--     rewriting Guild 1/Guild 2 history or legacy rankings.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_monthly_finalizations') IS NULL
     OR to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_gs_summary(integer,text,integer)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] foundation and Game #01 migrations must be applied first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Guild 2 +90 applied-cap compatibility and internal snapshot helpers
-- -----------------------------------------------------------------------------
-- Production preflight confirmed the existing LOCKED Guild 2 constraints:
--   arcade_applied BETWEEN 0 AND 90
--   final_total BETWEEN 0 AND 990
-- Keep them unchanged. Arcade raw totals remain fully auditable, while only
-- the Guild 2 applied amount is capped at +90.

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
  WITH period_scope AS (
    SELECT period.id, period.starts_at, period.ends_at_exclusive
    FROM public.arcade_ranking_periods period
    WHERE period.id = p_period_id
      AND period.classroom_id = p_classroom_id
      AND period.period_kind = 'MONTHLY'
  ), candidate_runs AS (
    SELECT run.id AS source_run_id,
           run.student_id,
           run.official_score,
           run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS student_best_row
    FROM public.arcade_runs run
    JOIN period_scope period ON run.game_over_at >= period.starts_at
                           AND run.game_over_at < period.ends_at_exclusive
    WHERE run.classroom_id = p_classroom_id
      AND run.game_id = p_game_id
      AND run.status = 'VERIFIED'
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.source_run_id,
           candidate.student_id,
           candidate.official_score,
           candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.source_run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.student_best_row = 1
  )
  SELECT ranked.source_run_id,
         ranked.student_id,
         ranked.official_score,
         ranked.game_over_at AS achieved_at,
         ranked.rank::integer,
         CASE
           WHEN ranked.rank = 1 THEN 30::numeric
           WHEN ranked.rank = 2 THEN 27::numeric
           WHEN ranked.rank = 3 THEN 24::numeric
           WHEN ranked.rank BETWEEN 4 AND 6 THEN 18::numeric
           WHEN ranked.rank BETWEEN 7 AND 10 THEN 15::numeric
         END AS raw_bonus
  FROM ranked
  WHERE ranked.rank <= 10
  ORDER BY ranked.rank;
$$;

-- -----------------------------------------------------------------------------
-- 2. Exact production Guild 2 function signatures, extended for Arcade
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_scores(
  p_classroom_id integer,
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id integer;
  v_month_start date;
  v_month_end date;
  v_count integer := 0;
  v_arcade_ready boolean;
BEGIN
  IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G2A] year_month must be YYYY-MM.' USING ERRCODE = 'P0164';
  END IF;

  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);
  v_month_start := (p_year_month || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;
  v_season_id := public.guild2_resolve_season_for_month(p_classroom_id, p_year_month);
  v_arcade_ready := public.arcade_monthly_finalization_is_complete(p_classroom_id, p_year_month);

  WITH active_roster AS (
    SELECT s.id AS student_id, gm.guild_id
    FROM public.students s
    JOIN public.guild_members gm
      ON gm.student_id = s.id
     AND gm.season_id = v_season_id
     AND gm.joined_at::date <= v_month_end
     AND gm.left_at IS NULL
    JOIN public.guilds g ON g.id = gm.guild_id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
      AND g.classroom_id = p_classroom_id
      AND g.season_id = v_season_id
  ), session_rollup AS (
    SELECT participant.student_id,
           array_agg(DISTINCT participant.guild_id_at_session) AS guild_ids,
           count(*) AS session_count,
           count(*) FILTER (WHERE participant.attendance_status = 'ABSENT') AS absent_count,
           count(*) FILTER (WHERE participant.attendance_status = 'UNMARKED') AS unmarked_count
    FROM public.guild_session_participants participant
    JOIN public.guild_sessions session ON session.id = participant.session_id
    WHERE session.classroom_id = p_classroom_id
      AND session.season_id = v_season_id
      AND session.session_date BETWEEN v_month_start AND v_month_end
    GROUP BY participant.student_id
  ), observation_rollup AS (
    SELECT event.student_id,
           array_agg(DISTINCT event.guild_id) AS guild_ids,
           count(*) AS recognition_count,
           jsonb_object_agg(event.category, event.category_count) AS category_counts
    FROM (
      SELECT observation.student_id, observation.guild_id, observation.category,
             count(*) AS category_count
      FROM public.guild2_observation_events observation
      WHERE observation.classroom_id = p_classroom_id
        AND observation.season_id = v_season_id
        AND observation.year_month = p_year_month
        AND observation.event_kind = 'RECOGNITION'
        AND NOT EXISTS (
          SELECT 1 FROM public.guild2_observation_events reversal
          WHERE reversal.reversal_of = observation.id AND reversal.event_kind = 'REVERSAL'
        )
      GROUP BY observation.student_id, observation.guild_id, observation.category
    ) event
    GROUP BY event.student_id
  ), previous_contribution_context AS (
    SELECT contribution.student_id, previous_context.guild_id_text::integer AS guild_id
    FROM public.guild2_individual_contributions contribution
    CROSS JOIN LATERAL jsonb_array_elements_text(contribution.guild_context_ids) AS previous_context(guild_id_text)
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), arcade_rollup AS (
    SELECT entry.student_id, sum(entry.raw_bonus)::numeric(8,2) AS arcade_raw_total
    FROM public.arcade_monthly_finalizations finalization
    JOIN public.arcade_monthly_snapshots snapshot ON snapshot.finalization_id = finalization.id
    JOIN public.arcade_monthly_snapshot_entries entry ON entry.snapshot_id = snapshot.id
    WHERE v_arcade_ready
      AND finalization.classroom_id = p_classroom_id
      AND finalization.contribution_year_month = p_year_month
    GROUP BY entry.student_id
  ), previous_arcade_students AS (
    SELECT contribution.student_id
    FROM public.guild2_individual_contributions contribution
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), student_scope AS (
    SELECT student_id FROM active_roster
    UNION SELECT student_id FROM session_rollup
    UNION SELECT student_id FROM observation_rollup
    UNION SELECT student_id FROM previous_contribution_context
    UNION SELECT student_id FROM arcade_rollup
    UNION SELECT student_id FROM previous_arcade_students
  ), all_contexts AS (
    SELECT context_row.student_id,
           array_agg(DISTINCT context_row.guild_id ORDER BY context_row.guild_id) AS guild_ids
    FROM (
      SELECT student_id, guild_id FROM active_roster
      UNION SELECT student_id, unnest(guild_ids) FROM session_rollup
      UNION SELECT student_id, unnest(guild_ids) FROM observation_rollup
      UNION SELECT student_id, guild_id FROM previous_contribution_context
    ) context_row
    GROUP BY context_row.student_id
  ), calculated AS (
    SELECT scope.student_id,
           CASE WHEN roster.guild_id IS NOT NULL
                     AND cardinality(contexts.guild_ids) = 1
                     AND contexts.guild_ids[1] = roster.guild_id
                THEN roster.guild_id ELSE NULL END AS scoring_guild_id,
           CASE WHEN roster.guild_id IS NOT NULL
                     AND cardinality(contexts.guild_ids) = 1
                     AND contexts.guild_ids[1] = roster.guild_id
                THEN 'RESOLVED' ELSE 'NEEDS_ROSTER_RESOLUTION' END AS guild_context_status,
           contexts.guild_ids,
           coalesce(session.session_count, 0)::integer AS session_count,
           coalesce(session.absent_count, 0)::integer AS session_absent_count,
           coalesce(session.unmarked_count, 0)::integer AS session_unmarked_count,
           CASE WHEN coalesce(session.session_count, 0) = 0 THEN 0::numeric(8,2)
                ELSE greatest(0, 150 - 30 * coalesce(session.absent_count, 0))::numeric(8,2) END AS session_points,
           CASE WHEN coalesce(session.session_count, 0) = 0 THEN 'NOT_READY'
                WHEN coalesce(session.unmarked_count, 0) > 0 THEN 'PENDING'
                ELSE 'READY' END AS session_status,
           coalesce(observation.recognition_count, 0)::integer AS observation_count,
           least(coalesce(observation.recognition_count, 0) * 10, 150)::numeric(8,2) AS teacher_observation_points,
           coalesce(observation.category_counts, '{}'::jsonb) AS category_counts,
           coalesce(arcade.arcade_raw_total, 0)::numeric(8,2) AS arcade_raw_total
    FROM student_scope scope
    JOIN all_contexts contexts ON contexts.student_id = scope.student_id
    LEFT JOIN active_roster roster ON roster.student_id = scope.student_id
    LEFT JOIN session_rollup session ON session.student_id = scope.student_id
    LEFT JOIN observation_rollup observation ON observation.student_id = scope.student_id
    LEFT JOIN arcade_rollup arcade ON arcade.student_id = scope.student_id
  )
  INSERT INTO public.guild2_individual_contributions (
    classroom_id, season_id, year_month, student_id,
    scoring_guild_id, guild_context_status, guild_context_ids,
    peer_points, mission_points, session_points, teacher_observation_points,
    basic_total, arcade_raw_total, arcade_applied, final_total,
    peer_status, mission_status, session_status, teacher_observation_status, arcade_status,
    session_absent_count, session_unmarked_count, observation_count,
    calculation_metadata, formula_version, calculated_by_user_id, calculated_at, updated_at
  )
  SELECT p_classroom_id, v_season_id, p_year_month, calculated.student_id,
         calculated.scoring_guild_id, calculated.guild_context_status, to_jsonb(calculated.guild_ids),
         0, 0, calculated.session_points, calculated.teacher_observation_points,
         calculated.session_points + calculated.teacher_observation_points,
         calculated.arcade_raw_total, least(calculated.arcade_raw_total, 90),
         calculated.session_points + calculated.teacher_observation_points + least(calculated.arcade_raw_total, 90),
         'NOT_READY', 'NOT_READY', calculated.session_status, 'READY',
         CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
         calculated.session_absent_count, calculated.session_unmarked_count, calculated.observation_count,
         jsonb_build_object(
           'session_count', calculated.session_count,
           'observation_category_counts', calculated.category_counts,
           'arcade_raw_total', calculated.arcade_raw_total,
           'arcade_applied', least(calculated.arcade_raw_total, 90),
           'arcade_status', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
           'allocation_note', CASE WHEN calculated.guild_context_status = 'RESOLVED'
             THEN 'CURRENT_DRAFT_CONTEXT'
             ELSE 'MID_MONTH_OR_HISTORICAL_GUILD_CONTEXT_REQUIRES_GUILD5_ROSTER_RESOLUTION' END
         ),
         'GUILD_CONTRIBUTION_V2_2026', auth.uid(), now(), now()
  FROM calculated
  ON CONFLICT (classroom_id, season_id, year_month, student_id) DO UPDATE SET
    scoring_guild_id = EXCLUDED.scoring_guild_id,
    guild_context_status = EXCLUDED.guild_context_status,
    guild_context_ids = EXCLUDED.guild_context_ids,
    peer_points = EXCLUDED.peer_points,
    mission_points = EXCLUDED.mission_points,
    session_points = EXCLUDED.session_points,
    teacher_observation_points = EXCLUDED.teacher_observation_points,
    basic_total = EXCLUDED.basic_total,
    arcade_raw_total = EXCLUDED.arcade_raw_total,
    arcade_applied = EXCLUDED.arcade_applied,
    final_total = EXCLUDED.final_total,
    peer_status = EXCLUDED.peer_status,
    mission_status = EXCLUDED.mission_status,
    session_status = EXCLUDED.session_status,
    teacher_observation_status = EXCLUDED.teacher_observation_status,
    arcade_status = EXCLUDED.arcade_status,
    session_absent_count = EXCLUDED.session_absent_count,
    session_unmarked_count = EXCLUDED.session_unmarked_count,
    observation_count = EXCLUDED.observation_count,
    calculation_metadata = EXCLUDED.calculation_metadata,
    formula_version = EXCLUDED.formula_version,
    calculated_by_user_id = EXCLUDED.calculated_by_user_id,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.guild2_refresh_monthly_gs_summary(p_classroom_id, p_year_month, v_season_id);

  RETURN jsonb_build_object(
    'classroom_id', p_classroom_id,
    'season_id', v_season_id,
    'year_month', p_year_month,
    'contributions_recalculated', v_count,
    'arcade_status', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
    'formula_version', 'GUILD_CONTRIBUTION_V2_2026'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_gs_summary(
  p_classroom_id integer,
  p_year_month text,
  p_season_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  contribution record;
  compensation record;
  prior_event record;
  v_arcade_ready boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);
  v_arcade_ready := public.arcade_monthly_finalization_is_complete(p_classroom_id, p_year_month);

  FOR contribution IN
    SELECT contribution_row.*
    FROM public.guild2_individual_contributions contribution_row
    WHERE contribution_row.classroom_id = p_classroom_id
      AND contribution_row.season_id = p_season_id
      AND contribution_row.year_month = p_year_month
      AND contribution_row.guild_context_status = 'RESOLVED'
      AND contribution_row.scoring_guild_id IS NOT NULL
  LOOP
    SELECT ledger.* INTO prior_event
    FROM public.guild2_gs_events ledger
    WHERE ledger.source_type = 'INDIVIDUAL_CONTRIBUTION'
      AND ledger.source_id = contribution.id
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
    ORDER BY ledger.id DESC LIMIT 1;

    IF contribution.final_total = 0 THEN
      IF prior_event.id IS NOT NULL THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          student_id, event_kind, points, reason, metadata, reversal_of
        ) VALUES (
          prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
          'REVERSAL', prior_event.source_id, prior_event.student_id,
          'REVERSAL', -prior_event.points, '개인 기여도 0점 전환 취소',
          jsonb_build_object('reversal_reason', 'RECALCULATION_TO_ZERO'), prior_event.id
        );
      END IF;
    ELSIF prior_event.id IS NULL THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        student_id, event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, contribution.scoring_guild_id,
        'INDIVIDUAL_CONTRIBUTION', contribution.id, contribution.student_id,
        'POST', contribution.final_total, '개인 기여도 초안 반영',
        jsonb_build_object('formula_version', contribution.formula_version, 'arcade_status', contribution.arcade_status)
      );
    ELSIF prior_event.points IS DISTINCT FROM contribution.final_total
       OR prior_event.guild_id IS DISTINCT FROM contribution.scoring_guild_id THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        student_id, event_kind, points, reason, metadata, reversal_of
      ) VALUES (
        prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
        'REVERSAL', prior_event.source_id, prior_event.student_id,
        'REVERSAL', -prior_event.points, '개인 기여도 초안 변경 취소',
        jsonb_build_object('reversal_reason', 'RECALCULATION'), prior_event.id
      );
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        student_id, event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, contribution.scoring_guild_id,
        'INDIVIDUAL_CONTRIBUTION', contribution.id, contribution.student_id,
        'POST', contribution.final_total, '개인 기여도 초안 재계산 반영',
        jsonb_build_object('formula_version', contribution.formula_version, 'arcade_status', contribution.arcade_status, 'replaces_event_id', prior_event.id)
      );
    END IF;
  END LOOP;

  FOR prior_event IN
    SELECT ledger.*
    FROM public.guild2_gs_events ledger
    JOIN public.guild2_individual_contributions contribution_row ON contribution_row.id = ledger.source_id
    WHERE ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.source_type = 'INDIVIDUAL_CONTRIBUTION'
      AND ledger.event_kind = 'POST'
      AND contribution_row.guild_context_status <> 'RESOLVED'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
  LOOP
    INSERT INTO public.guild2_gs_events (
      classroom_id, season_id, year_month, guild_id, source_type, source_id,
      student_id, event_kind, points, reason, metadata, reversal_of
    ) VALUES (
      prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
      'REVERSAL', prior_event.source_id, prior_event.student_id,
      'REVERSAL', -prior_event.points, '길드 소속 맥락 확인 전 배정 보류',
      jsonb_build_object('reversal_reason', 'UNRESOLVED_GUILD_CONTEXT'), prior_event.id
    );
  END LOOP;

  FOR compensation IN
    SELECT config.id AS config_id, config.guild_id, config.enabled,
           coalesce(round((avg(contribution_row.basic_total) * config.factor) / 10) * 10, 0)::numeric(10,2) AS desired_points
    FROM public.guild2_compensation_configs config
    LEFT JOIN public.guild2_individual_contributions contribution_row
      ON contribution_row.classroom_id = p_classroom_id
     AND contribution_row.season_id = p_season_id
     AND contribution_row.year_month = p_year_month
     AND contribution_row.scoring_guild_id = config.guild_id
     AND contribution_row.guild_context_status = 'RESOLVED'
    WHERE config.classroom_id = p_classroom_id AND config.season_id = p_season_id
    GROUP BY config.id, config.guild_id, config.enabled, config.factor
  LOOP
    SELECT ledger.* INTO prior_event
    FROM public.guild2_gs_events ledger
    WHERE ledger.source_type = 'MEMBER_COMPENSATION'
      AND ledger.source_id = compensation.config_id
      AND ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
    ORDER BY ledger.id DESC LIMIT 1;

    IF compensation.enabled AND compensation.desired_points > 0 THEN
      IF prior_event.id IS NULL THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata
        ) VALUES (
          p_classroom_id, p_season_id, p_year_month, compensation.guild_id,
          'MEMBER_COMPENSATION', compensation.config_id,
          'POST', compensation.desired_points, '수동 지정 인원 보정 반영',
          jsonb_build_object('factor', 0.50, 'rounding', 'NEAREST_10_BASIC_ONLY')
        );
      ELSIF prior_event.points IS DISTINCT FROM compensation.desired_points THEN
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata, reversal_of
        ) VALUES (
          prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
          'REVERSAL', prior_event.source_id,
          'REVERSAL', -prior_event.points, '인원 보정 재계산 취소',
          jsonb_build_object('reversal_reason', 'RECALCULATION'), prior_event.id
        );
        INSERT INTO public.guild2_gs_events (
          classroom_id, season_id, year_month, guild_id, source_type, source_id,
          event_kind, points, reason, metadata
        ) VALUES (
          p_classroom_id, p_season_id, p_year_month, compensation.guild_id,
          'MEMBER_COMPENSATION', compensation.config_id,
          'POST', compensation.desired_points, '수동 지정 인원 보정 재계산 반영',
          jsonb_build_object('factor', 0.50, 'rounding', 'NEAREST_10_BASIC_ONLY', 'replaces_event_id', prior_event.id)
        );
      END IF;
    ELSIF prior_event.id IS NOT NULL THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata, reversal_of
      ) VALUES (
        prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
        'REVERSAL', prior_event.source_id,
        'REVERSAL', -prior_event.points, '인원 보정 해제 또는 산정 대상 없음',
        jsonb_build_object('reversal_reason', 'CONFIG_DISABLED_OR_EMPTY_ROSTER'), prior_event.id
      );
    END IF;
  END LOOP;

  WITH guild_scope AS (
    SELECT g.id AS guild_id
    FROM public.guilds g
    WHERE g.classroom_id = p_classroom_id
      AND g.season_id = p_season_id
      AND coalesce(g.is_active, true)
  ), ledger_totals AS (
    SELECT event.guild_id,
           coalesce(sum(event.points) FILTER (WHERE event.source_type = 'INDIVIDUAL_CONTRIBUTION'), 0) AS individual_subtotal,
           coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MISSION_GS'), 0) AS mission_gs_subtotal,
           coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MEMBER_COMPENSATION'), 0) AS compensation_amount,
           coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MANUAL_ADJUSTMENT'), 0) AS manual_adjustment_total,
           coalesce(sum(event.points), 0) AS draft_gs_total
    FROM public.guild2_gs_events event
    WHERE event.classroom_id = p_classroom_id
      AND event.season_id = p_season_id
      AND event.year_month = p_year_month
    GROUP BY event.guild_id
  ), roster_totals AS (
    SELECT scoring_guild_id AS guild_id, count(*) AS scoring_roster_count
    FROM public.guild2_individual_contributions
    WHERE classroom_id = p_classroom_id
      AND season_id = p_season_id
      AND year_month = p_year_month
      AND guild_context_status = 'RESOLVED'
    GROUP BY scoring_guild_id
  ), config AS (
    SELECT guild_id, enabled
    FROM public.guild2_compensation_configs
    WHERE classroom_id = p_classroom_id AND season_id = p_season_id
  )
  INSERT INTO public.guild2_monthly_gs_summaries (
    classroom_id, season_id, year_month, guild_id, scoring_roster_count,
    individual_subtotal, mission_gs_subtotal, compensation_amount, manual_adjustment_total,
    draft_gs_total, compensation_enabled, source_readiness, formula_version, calculated_at, updated_at
  )
  SELECT p_classroom_id, p_season_id, p_year_month, guild_scope.guild_id,
         coalesce(roster_totals.scoring_roster_count, 0),
         coalesce(ledger_totals.individual_subtotal, 0),
         coalesce(ledger_totals.mission_gs_subtotal, 0),
         coalesce(ledger_totals.compensation_amount, 0),
         coalesce(ledger_totals.manual_adjustment_total, 0),
         coalesce(ledger_totals.draft_gs_total, 0),
         coalesce(config.enabled, false),
         jsonb_build_object(
           'peer', 'NOT_READY', 'mission', 'NOT_READY', 'session', 'READY',
           'teacher_observation', 'READY',
           'arcade', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
           'guild_mission_gs', 'NOT_READY'
         ),
         'GUILD_CONTRIBUTION_V2_2026', now(), now()
  FROM guild_scope
  LEFT JOIN ledger_totals ON ledger_totals.guild_id = guild_scope.guild_id
  LEFT JOIN roster_totals ON roster_totals.guild_id = guild_scope.guild_id
  LEFT JOIN config ON config.guild_id = guild_scope.guild_id
  ON CONFLICT (classroom_id, season_id, year_month, guild_id) DO UPDATE SET
    scoring_roster_count = EXCLUDED.scoring_roster_count,
    individual_subtotal = EXCLUDED.individual_subtotal,
    mission_gs_subtotal = EXCLUDED.mission_gs_subtotal,
    compensation_amount = EXCLUDED.compensation_amount,
    manual_adjustment_total = EXCLUDED.manual_adjustment_total,
    draft_gs_total = EXCLUDED.draft_gs_total,
    compensation_enabled = EXCLUDED.compensation_enabled,
    source_readiness = EXCLUDED.source_readiness,
    formula_version = EXCLUDED.formula_version,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  WITH ranked AS (
    SELECT summary.id,
           rank() OVER (ORDER BY summary.draft_gs_total DESC) AS new_rank
    FROM public.guild2_monthly_gs_summaries summary
    WHERE summary.classroom_id = p_classroom_id
      AND summary.season_id = p_season_id
      AND summary.year_month = p_year_month
  )
  UPDATE public.guild2_monthly_gs_summaries summary
  SET draft_rank = ranked.new_rank, updated_at = now()
  FROM ranked
  WHERE summary.id = ranked.id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Atomic teacher finalization
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_finalize_arcade_monthly_snapshot(
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
  v_finalization public.arcade_monthly_finalizations%ROWTYPE;
  v_game record;
  v_snapshot public.arcade_monthly_snapshots%ROWTYPE;
  v_eligible_game_count integer := 0;
  v_snapshot_count integer := 0;
  v_refresh_result jsonb;
  v_period_start_date date;
  v_period_end_date date;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id
  FOR UPDATE;

  IF NOT FOUND OR v_period.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] monthly ranking period not found in this classroom.' USING ERRCODE = 'P0214';
  END IF;
  IF v_period.period_kind <> 'MONTHLY' OR v_period.contribution_year_month IS NULL THEN
    RAISE EXCEPTION '[ARCADE] only a monthly period can update Guild 2 Arcade contribution.' USING ERRCODE = 'P0215';
  END IF;
  IF v_period.status = 'FINALIZED' OR EXISTS (
    SELECT 1 FROM public.arcade_monthly_finalizations finalization WHERE finalization.period_id = v_period.id
  ) THEN
    RAISE EXCEPTION '[ARCADE] this monthly period is already finalized and immutable.' USING ERRCODE = 'P0216';
  END IF;
  IF v_period.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '[ARCADE] activate the monthly period before finalization.' USING ERRCODE = 'P0217';
  END IF;
  IF v_period.ends_at_exclusive > clock_timestamp() THEN
    RAISE EXCEPTION '[ARCADE] this monthly period has not ended yet.' USING ERRCODE = 'P0218';
  END IF;

  PERFORM pg_advisory_xact_lock(v_classroom_id, replace(v_period.contribution_year_month, '-', '')::integer);
  v_period_start_date := (v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date;
  v_period_end_date := ((v_period.ends_at_exclusive AT TIME ZONE 'Asia/Seoul')::date - 1);

  SELECT count(*) INTO v_eligible_game_count
  FROM public.arcade_games game
  WHERE game.available_from <= v_period_end_date
    AND (game.available_until IS NULL OR game.available_until >= v_period_start_date);

  INSERT INTO public.arcade_monthly_finalizations (
    classroom_id, period_id, contribution_year_month, eligible_game_count
  ) VALUES (
    v_classroom_id, v_period.id, v_period.contribution_year_month, v_eligible_game_count
  )
  RETURNING * INTO v_finalization;

  FOR v_game IN
    SELECT game.id, game.code
    FROM public.arcade_games game
    WHERE game.available_from <= v_period_end_date
      AND (game.available_until IS NULL OR game.available_until >= v_period_start_date)
    ORDER BY game.id
  LOOP
    INSERT INTO public.arcade_monthly_snapshots (
      finalization_id, classroom_id, period_id, game_id, contribution_year_month
    ) VALUES (
      v_finalization.id, v_classroom_id, v_period.id, v_game.id, v_period.contribution_year_month
    )
    RETURNING * INTO v_snapshot;

    INSERT INTO public.arcade_monthly_snapshot_entries (
      snapshot_id, student_id, source_run_id, rank, official_score, achieved_at, raw_bonus
    )
    SELECT v_snapshot.id, top10.student_id, top10.source_run_id, top10.rank,
           top10.official_score, top10.achieved_at, top10.raw_bonus
    FROM public.arcade_resolve_period_top10(v_classroom_id, v_period.id, v_game.id) top10;
  END LOOP;

  SELECT count(*) INTO v_snapshot_count
  FROM public.arcade_monthly_snapshots snapshot
  WHERE snapshot.finalization_id = v_finalization.id;
  IF v_snapshot_count <> v_eligible_game_count THEN
    RAISE EXCEPTION '[ARCADE] incomplete monthly snapshot set; transaction was not finalized.' USING ERRCODE = 'P0219';
  END IF;

  -- This call sees the complete finalization parent and every game snapshot in
  -- the same transaction. Any error below rolls the parent, snapshots, Guild 2
  -- contribution cache/ledger changes, and period status back together.
  v_refresh_result := public.guild2_refresh_monthly_scores(
    v_classroom_id, v_period.contribution_year_month
  );

  UPDATE public.arcade_ranking_periods
  SET status = 'FINALIZED'
  WHERE id = v_period.id;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'finalization_id', v_finalization.id,
    'eligible_game_count', v_eligible_game_count,
    'snapshot_count', v_snapshot_count,
    'guild2_refresh', v_refresh_result,
    'status', 'FINALIZED'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. ACL: only the teacher finalization entry point is browser-callable
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_scores(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_gs_summary(integer, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_monthly_finalization_is_complete(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_resolve_period_top10(integer, bigint, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.teacher_finalize_arcade_monthly_snapshot(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_arcade_monthly_snapshot(bigint) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT conname AS constraint_name,
       pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE conrelid = 'public.guild2_individual_contributions'::regclass
  AND conname IN ('guild2_contribution_arcade_applied_check', 'guild2_contribution_final_range_check')
ORDER BY conname;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'guild2_refresh_monthly_scores', 'guild2_refresh_monthly_gs_summary',
    'teacher_finalize_arcade_monthly_snapshot', 'arcade_resolve_period_top10'
  )
ORDER BY function_name, identity_arguments;

SELECT pg_get_functiondef('public.guild2_refresh_monthly_scores(integer,text)'::regprocedure) ILIKE '%arcade_rollup%' AS guild2_reads_arcade_snapshot,
       pg_get_functiondef('public.guild2_refresh_monthly_gs_summary(integer,text,integer)'::regprocedure) ILIKE '%''arcade''%' AS summary_reports_arcade_readiness;
