-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 3 → Guild 2 Mission contribution adapter
-- 2026-08-15
--
-- Depends on:
--   20260815_01_guild3_mission_foundation.sql
--   20260815_02_guild3_mission_lifecycle.sql
--
-- This is an incremental replacement of the two confirmed production Guild 2
-- refresh functions. It preserves every locked Guild 2 component and only
-- replaces the former Mission 0 / NOT_READY placeholder with Guild 3 data.
-- It does not create Guild 5 monthly-close data or alter legacy Guild tables.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild3_mission_participants') IS NULL
     OR to_regclass('public.guild3_mission_grade_events') IS NULL THEN
    RAISE EXCEPTION '[G3] Guild 3 foundation and lifecycle migrations must be applied first.';
  END IF;

  IF to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_gs_summary(integer,text,integer)') IS NULL
     OR to_regprocedure('public.arcade_monthly_finalization_is_complete(integer,text)') IS NULL THEN
    RAISE EXCEPTION '[G3] expected Guild 2 / Arcade production refresh functions are missing.';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Guild 3 read-only source helpers.
--
-- CANCELLED and VOIDED missions do not participate in the denominator.
-- FAILED missions remain in it. A month with no valid mission is READY with a
-- real numeric Mission value of 0, rather than an unresolved placeholder.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild3_mission_month_is_ready(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.guild3_missions mission
    WHERE mission.classroom_id = p_classroom_id
      AND mission.season_id = p_season_id
      AND mission.contribution_year_month = p_year_month
      AND mission.lifecycle_state NOT IN ('CANCELLED', 'VOIDED')
      AND mission.lifecycle_state <> 'FINALIZED'
  );
$$;

CREATE OR REPLACE FUNCTION public.guild3_mission_component_rollup(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS TABLE (
  student_id integer,
  mission_points numeric,
  mission_status text,
  guild_ids integer[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ready boolean;
BEGIN
  v_ready := public.guild3_mission_month_is_ready(
    p_classroom_id,
    p_season_id,
    p_year_month
  );

  RETURN QUERY
  WITH valid_missions AS (
    SELECT mission.id,
           mission.weight,
           mission.lifecycle_state,
           sum(mission.weight) OVER () AS monthly_weight_sum
    FROM public.guild3_missions mission
    WHERE mission.classroom_id = p_classroom_id
      AND mission.season_id = p_season_id
      AND mission.contribution_year_month = p_year_month
      AND mission.lifecycle_state NOT IN ('CANCELLED', 'VOIDED')
  ), participant_scope AS (
    SELECT participant.student_id,
           participant.guild_id,
           mission.id AS mission_id,
           mission.weight,
           mission.monthly_weight_sum,
           mission.lifecycle_state,
           instance.current_guild_result,
           participant.id AS participant_id
    FROM valid_missions mission
    JOIN public.guild3_mission_participants participant
      ON participant.mission_id = mission.id
    JOIN public.guild3_mission_instances instance
      ON instance.id = participant.mission_instance_id
  ), latest_grade AS (
    SELECT DISTINCT ON (grade.participant_id)
           grade.participant_id,
           grade.grade
    FROM public.guild3_mission_grade_events grade
    JOIN participant_scope scope ON scope.participant_id = grade.participant_id
    ORDER BY grade.participant_id, grade.id DESC
  )
  SELECT scope.student_id,
         least(
           coalesce(sum(
             CASE WHEN scope.lifecycle_state = 'FINALIZED' THEN
               (300::numeric * scope.weight / nullif(scope.monthly_weight_sum, 0))
               * (
                 CASE WHEN scope.current_guild_result = 'CLEARED' THEN 0.80::numeric ELSE 0::numeric END
                 + CASE coalesce(grade.grade, 'F')
                     WHEN 'S' THEN 0.20::numeric
                     WHEN 'A' THEN 0.15::numeric
                     WHEN 'B' THEN 0.10::numeric
                     WHEN 'C' THEN 0.05::numeric
                     ELSE 0::numeric
                   END
               )
             ELSE 0::numeric END
           ), 0::numeric),
           300::numeric
         )::numeric(18,8) AS mission_points,
         CASE WHEN v_ready THEN 'READY' ELSE 'NOT_READY' END AS mission_status,
         array_agg(DISTINCT scope.guild_id ORDER BY scope.guild_id) AS guild_ids
  FROM participant_scope scope
  LEFT JOIN latest_grade grade ON grade.participant_id = scope.participant_id
  GROUP BY scope.student_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guild3_official_mission_gs_rollup(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS TABLE (
  mission_instance_id bigint,
  guild_id integer,
  mission_id bigint,
  mission_weight numeric,
  mission_gs_points numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH valid_missions AS (
    SELECT mission.id,
           mission.weight,
           mission.lifecycle_state,
           sum(mission.weight) OVER () AS monthly_weight_sum
    FROM public.guild3_missions mission
    WHERE mission.classroom_id = p_classroom_id
      AND mission.season_id = p_season_id
      AND mission.contribution_year_month = p_year_month
      AND mission.lifecycle_state NOT IN ('CANCELLED', 'VOIDED')
  )
  SELECT instance.id AS mission_instance_id,
         instance.guild_id,
         mission.id AS mission_id,
         mission.weight AS mission_weight,
         CASE WHEN instance.current_guild_result = 'CLEARED'
              THEN (5000::numeric * mission.weight / nullif(mission.monthly_weight_sum, 0))
              ELSE 0::numeric
          END::numeric(18,8) AS mission_gs_points
  FROM valid_missions mission
  JOIN public.guild3_mission_instances instance ON instance.mission_id = mission.id
  WHERE mission.lifecycle_state = 'FINALIZED';
$$;

-- -----------------------------------------------------------------------------
-- 2. Guild 2 individual draft refresh.
--
-- All pre-existing Session, Observation, Arcade (+90 cap), roster-resolution,
-- and summary refresh behavior is retained. Guild 4 Peer remains NOT_READY.
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
  v_mission_ready boolean;
BEGIN
  IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G2A] year_month must be YYYY-MM.' USING ERRCODE = 'P0164';
  END IF;

  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);
  v_month_start := (p_year_month || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;
  v_season_id := public.guild2_resolve_season_for_month(p_classroom_id, p_year_month);
  v_arcade_ready := public.arcade_monthly_finalization_is_complete(p_classroom_id, p_year_month);
  v_mission_ready := public.guild3_mission_month_is_ready(p_classroom_id, v_season_id, p_year_month);

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
  ), mission_rollup AS (
    SELECT mission.student_id,
           mission.mission_points,
           mission.guild_ids
    FROM public.guild3_mission_component_rollup(p_classroom_id, v_season_id, p_year_month) mission
  ), previous_contribution_context AS (
    SELECT contribution.student_id, previous_context.guild_id_text::integer AS guild_id
    FROM public.guild2_individual_contributions contribution
    CROSS JOIN LATERAL jsonb_array_elements_text(contribution.guild_context_ids) AS previous_context(guild_id_text)
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), arcade_rollup AS (
    SELECT entry.student_id, sum(entry.raw_bonus)::numeric(18,8) AS arcade_raw_total
    FROM public.arcade_monthly_finalizations finalization
    JOIN public.arcade_monthly_snapshots snapshot ON snapshot.finalization_id = finalization.id
    JOIN public.arcade_monthly_snapshot_entries entry ON entry.snapshot_id = snapshot.id
    WHERE v_arcade_ready
      AND finalization.classroom_id = p_classroom_id
      AND finalization.contribution_year_month = p_year_month
    GROUP BY entry.student_id
  ), previous_scored_students AS (
    SELECT contribution.student_id
    FROM public.guild2_individual_contributions contribution
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), student_scope AS (
    SELECT student_id FROM active_roster
    UNION SELECT student_id FROM session_rollup
    UNION SELECT student_id FROM observation_rollup
    UNION SELECT student_id FROM mission_rollup
    UNION SELECT student_id FROM previous_contribution_context
    UNION SELECT student_id FROM arcade_rollup
    UNION SELECT student_id FROM previous_scored_students
  ), all_contexts AS (
    SELECT context_row.student_id,
           array_agg(DISTINCT context_row.guild_id ORDER BY context_row.guild_id) AS guild_ids
    FROM (
      SELECT student_id, guild_id FROM active_roster
      UNION SELECT student_id, unnest(guild_ids) FROM session_rollup
      UNION SELECT student_id, unnest(guild_ids) FROM observation_rollup
      UNION SELECT student_id, unnest(guild_ids) FROM mission_rollup
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
           least(coalesce(mission.mission_points, 0::numeric), 300::numeric)::numeric(18,8) AS mission_points,
           coalesce(session.session_count, 0)::integer AS session_count,
           coalesce(session.absent_count, 0)::integer AS session_absent_count,
           coalesce(session.unmarked_count, 0)::integer AS session_unmarked_count,
           CASE WHEN coalesce(session.session_count, 0) = 0 THEN 0::numeric(18,8)
                ELSE greatest(0, 150 - 30 * coalesce(session.absent_count, 0))::numeric(18,8) END AS session_points,
           CASE WHEN coalesce(session.session_count, 0) = 0 THEN 'NOT_READY'
                WHEN coalesce(session.unmarked_count, 0) > 0 THEN 'PENDING'
                ELSE 'READY' END AS session_status,
           coalesce(observation.recognition_count, 0)::integer AS observation_count,
           least(coalesce(observation.recognition_count, 0) * 10, 150)::numeric(18,8) AS teacher_observation_points,
           coalesce(observation.category_counts, '{}'::jsonb) AS category_counts,
           coalesce(arcade.arcade_raw_total, 0)::numeric(18,8) AS arcade_raw_total
    FROM student_scope scope
    JOIN all_contexts contexts ON contexts.student_id = scope.student_id
    LEFT JOIN active_roster roster ON roster.student_id = scope.student_id
    LEFT JOIN session_rollup session ON session.student_id = scope.student_id
    LEFT JOIN observation_rollup observation ON observation.student_id = scope.student_id
    LEFT JOIN mission_rollup mission ON mission.student_id = scope.student_id
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
         0, calculated.mission_points, calculated.session_points, calculated.teacher_observation_points,
         calculated.mission_points + calculated.session_points + calculated.teacher_observation_points,
         calculated.arcade_raw_total, least(calculated.arcade_raw_total, 90),
         calculated.mission_points + calculated.session_points + calculated.teacher_observation_points
           + least(calculated.arcade_raw_total, 90),
         'NOT_READY', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
         calculated.session_status, 'READY',
         CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
         calculated.session_absent_count, calculated.session_unmarked_count, calculated.observation_count,
         jsonb_build_object(
           'mission_points', calculated.mission_points,
           'mission_status', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
           'mission_rounding', 'RAW_NORMALIZED_NUMERIC; DISPLAY_ROUNDED_IN_GUILD2_SUMMARY',
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
    'mission_status', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
    'arcade_status', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
    'formula_version', 'GUILD_CONTRIBUTION_V2_2026'
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Guild 2 DRAFT GS summary and append-only official Mission GS ledger.
--
-- Mission GS is held at raw normalized precision in the append-only ledger.
-- The summary is the documented display/storage boundary and rounds aggregate
-- subtotals and the total deterministically to two decimal places.
-- -----------------------------------------------------------------------------
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
  mission_event record;
  prior_event record;
  v_arcade_ready boolean;
  v_mission_ready boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);
  v_arcade_ready := public.arcade_monthly_finalization_is_complete(p_classroom_id, p_year_month);
  v_mission_ready := public.guild3_mission_month_is_ready(p_classroom_id, p_season_id, p_year_month);

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
        jsonb_build_object(
          'formula_version', contribution.formula_version,
          'mission_status', contribution.mission_status,
          'arcade_status', contribution.arcade_status
        )
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
        jsonb_build_object(
          'formula_version', contribution.formula_version,
          'mission_status', contribution.mission_status,
          'arcade_status', contribution.arcade_status,
          'replaces_event_id', prior_event.id
        )
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

  -- One active POST per cleared finalized guild mission instance. A corrected,
  -- failed, cancelled, or voided source is reversed, never deleted.
  FOR mission_event IN
    SELECT *
    FROM public.guild3_official_mission_gs_rollup(p_classroom_id, p_season_id, p_year_month)
    WHERE mission_gs_points > 0
  LOOP
    SELECT ledger.* INTO prior_event
    FROM public.guild2_gs_events ledger
    WHERE ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.source_type = 'MISSION_GS'
      AND ledger.source_id = mission_event.mission_instance_id
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
    ORDER BY ledger.id DESC LIMIT 1;

    IF prior_event.id IS NULL THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, mission_event.guild_id,
        'MISSION_GS', mission_event.mission_instance_id,
        'POST', mission_event.mission_gs_points, 'Guild 3 공식 미션 CLEARED 초안 반영',
        jsonb_build_object(
          'guild3_mission_id', mission_event.mission_id,
          'mission_weight', mission_event.mission_weight,
          'normalization', '5000_X_WEIGHT_OVER_VALID_MONTHLY_WEIGHT_SUM'
        )
      );
    ELSIF prior_event.points IS DISTINCT FROM mission_event.mission_gs_points
       OR prior_event.guild_id IS DISTINCT FROM mission_event.guild_id THEN
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata, reversal_of
      ) VALUES (
        prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
        'REVERSAL', prior_event.source_id,
        'REVERSAL', -prior_event.points, 'Guild 3 공식 미션 GS 초안 변경 취소',
        jsonb_build_object('reversal_reason', 'GUILD3_MISSION_RECALCULATION'), prior_event.id
      );
      INSERT INTO public.guild2_gs_events (
        classroom_id, season_id, year_month, guild_id, source_type, source_id,
        event_kind, points, reason, metadata
      ) VALUES (
        p_classroom_id, p_season_id, p_year_month, mission_event.guild_id,
        'MISSION_GS', mission_event.mission_instance_id,
        'POST', mission_event.mission_gs_points, 'Guild 3 공식 미션 GS 초안 재계산 반영',
        jsonb_build_object(
          'guild3_mission_id', mission_event.mission_id,
          'mission_weight', mission_event.mission_weight,
          'normalization', '5000_X_WEIGHT_OVER_VALID_MONTHLY_WEIGHT_SUM',
          'replaces_event_id', prior_event.id
        )
      );
    END IF;
  END LOOP;

  FOR prior_event IN
    SELECT ledger.*
    FROM public.guild2_gs_events ledger
    WHERE ledger.classroom_id = p_classroom_id
      AND ledger.season_id = p_season_id
      AND ledger.year_month = p_year_month
      AND ledger.source_type = 'MISSION_GS'
      AND ledger.event_kind = 'POST'
      AND NOT EXISTS (
        SELECT 1 FROM public.guild2_gs_events reversal
        WHERE reversal.reversal_of = ledger.id AND reversal.event_kind = 'REVERSAL'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.guild3_official_mission_gs_rollup(p_classroom_id, p_season_id, p_year_month) desired
        WHERE desired.mission_instance_id = ledger.source_id
          AND desired.guild_id = ledger.guild_id
          AND desired.mission_gs_points > 0
      )
  LOOP
    INSERT INTO public.guild2_gs_events (
      classroom_id, season_id, year_month, guild_id, source_type, source_id,
      event_kind, points, reason, metadata, reversal_of
    ) VALUES (
      prior_event.classroom_id, prior_event.season_id, prior_event.year_month, prior_event.guild_id,
      'REVERSAL', prior_event.source_id,
      'REVERSAL', -prior_event.points, 'Guild 3 미션 실패·취소·무효 또는 재계산 취소',
      jsonb_build_object('reversal_reason', 'GUILD3_SOURCE_NO_LONGER_CLEARED'), prior_event.id
    );
  END LOOP;

  -- The accepted Guild 2 manual four-member compensation remains BASIC-only.
  -- Arcade is not part of this average and no automatic headcount inference is added.
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
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'INDIVIDUAL_CONTRIBUTION'), 0), 2) AS individual_subtotal,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MISSION_GS'), 0), 2) AS mission_gs_subtotal,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MEMBER_COMPENSATION'), 0), 2) AS compensation_amount,
           round(coalesce(sum(event.points) FILTER (WHERE event.source_type = 'MANUAL_ADJUSTMENT'), 0), 2) AS manual_adjustment_total,
           round(coalesce(sum(event.points), 0), 2) AS draft_gs_total
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
           'peer', 'NOT_READY',
           'mission', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
           'session', 'READY',
           'teacher_observation', 'READY',
           'arcade', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
           'guild_mission_gs', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
           'rounding', 'AGGREGATE_DISPLAY_AND_SUMMARY_STORAGE_ROUNDED_TO_2_DECIMALS'
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
-- 4. ACLs and one SQL Editor-safe structural postcheck.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guild3_mission_month_is_ready(integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild3_mission_component_rollup(integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild3_official_mission_gs_rollup(integer, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_scores(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild2_refresh_monthly_gs_summary(integer, text, integer) FROM PUBLIC, anon, authenticated;

SELECT
  to_regprocedure('public.guild3_mission_component_rollup(integer,integer,text)') IS NOT NULL AS mission_personal_rollup_exists,
  to_regprocedure('public.guild3_official_mission_gs_rollup(integer,integer,text)') IS NOT NULL AS official_mission_gs_rollup_exists,
  pg_get_functiondef('public.guild2_refresh_monthly_scores(integer,text)'::regprocedure)
    ILIKE '%guild3_mission_component_rollup%' AS guild2_reads_guild3_mission_rollup,
  pg_get_functiondef('public.guild2_refresh_monthly_gs_summary(integer,text,integer)'::regprocedure)
    ILIKE '%guild3_official_mission_gs_rollup%' AS guild2_reads_guild3_official_mission_gs,
  pg_get_functiondef('public.guild2_refresh_monthly_scores(integer,text)'::regprocedure)
    ILIKE '%least(calculated.arcade_raw_total, 90)%' AS guild2_preserves_arcade_plus_90_cap,
  NOT has_function_privilege('authenticated', 'public.guild3_mission_component_rollup(integer,integer,text)', 'EXECUTE') AS mission_rollup_not_browser_callable,
  NOT has_function_privilege('authenticated', 'public.guild2_refresh_monthly_scores(integer,text)', 'EXECUTE') AS guild2_refresh_not_browser_callable;

COMMIT;
