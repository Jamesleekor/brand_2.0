-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade analytics: Rakaruka + clear level
-- 2026-09-14
--
-- Existing Arcade #01/#02 continue to use teacher_get_arcade_statistics().
-- This additive v2 wrapper keeps those results intact, adds clear_level=0 to
-- their student rows, and appends Rakaruka as a synthetic analytics game.
--
-- Rakaruka semantics
--   * play_count  = all server-issued Rakaruka games (READY + COMPLETED)
--   * PB          = best completed official-challenge points (0..15)
--   * clear_level = highest difficulty actually won in a verified completion
--   * current rank / historical TOP metrics follow official ranking semantics:
--                    difficulty DESC, points DESC, minimum 3 points
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.teacher_get_arcade_statistics(integer,integer,text,boolean)') IS NULL
     OR to_regclass('public.tikatuka_games') IS NULL
     OR to_regclass('public.tikatuka_official_sessions') IS NULL
     OR to_regclass('public.arcade_ranking_periods') IS NULL THEN
    RAISE EXCEPTION '[ANALYTICS] Rakaruka analytics prerequisites are missing.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_statistics_v2(
  p_classroom_id integer,
  p_guild_season_id integer DEFAULT NULL,
  p_year_month text DEFAULT NULL,
  p_include_test boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base jsonb;
  v_period_id bigint;
  v_season_id integer;
  v_rakaruka_rows jsonb := '[]'::jsonb;
  v_base_rows jsonb := '[]'::jsonb;
  v_rakaruka_game jsonb;
  v_game_count integer;
BEGIN
  -- Preserve all established #01/#02 analytics and permission checks.
  v_base := public.teacher_get_arcade_statistics(
    p_classroom_id,
    p_guild_season_id,
    p_year_month,
    p_include_test
  );

  v_period_id := nullif(v_base #>> '{scope,monthly_period_id}', '')::bigint;
  v_season_id := nullif(v_base #>> '{scope,guild_season_id}', '')::integer;

  WITH
  eligible_students AS (
    SELECT s.id, s.name, s.brand_name, s.is_test_account
    FROM public.students s
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND (
        s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD')
        OR (p_include_test AND s.role::text = 'TEST')
      )
      AND (p_include_test OR NOT coalesce(s.is_test_account, false))
  ),
  game_agg AS (
    SELECT
      es.id AS student_id,
      count(g.id)::integer AS play_count,
      count(g.id) FILTER (WHERE g.status = 'COMPLETED')::integer AS completed_count,
      min(g.issued_at) AS first_play_at,
      max(g.issued_at) AS latest_play_at,
      coalesce(max(g.difficulty) FILTER (
        WHERE g.status = 'COMPLETED' AND g.server_winner = 'player'
      ), 0)::integer AS clear_level
    FROM eligible_students es
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id = p_classroom_id
     AND g.student_id = es.id
    GROUP BY es.id
  ),
  alltime_pb_candidates AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN eligible_students es ON es.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.status = 'COMPLETED'
  ),
  alltime_pb AS (
    SELECT * FROM alltime_pb_candidates WHERE pick = 1
  ),
  current_pb_candidates AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN eligible_students es ON es.id = os.student_id
    WHERE v_period_id IS NOT NULL
      AND os.classroom_id = p_classroom_id
      AND os.arcade_period_id = v_period_id
      AND os.status = 'COMPLETED'
  ),
  current_pb AS (
    SELECT * FROM current_pb_candidates WHERE pick = 1
  ),
  current_rank_candidates AS (
    SELECT
      os.*,
      row_number() OVER (
        PARTITION BY os.student_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN eligible_students es ON es.id = os.student_id
    WHERE v_period_id IS NOT NULL
      AND os.classroom_id = p_classroom_id
      AND os.arcade_period_id = v_period_id
      AND os.status = 'COMPLETED'
      AND os.points >= 3
  ),
  current_ranked AS (
    SELECT
      c.student_id,
      c.difficulty,
      c.points,
      c.completed_at,
      dense_rank() OVER (ORDER BY c.difficulty DESC, c.points DESC)::integer AS rank
    FROM current_rank_candidates c
    WHERE c.pick = 1
  ),
  monthly_candidates AS (
    SELECT
      os.*,
      p.guild_season_id,
      p.id AS period_id,
      coalesce(
        p.contribution_year_month,
        to_char(p.starts_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM')
      ) AS month_key,
      row_number() OVER (
        PARTITION BY os.student_id, os.arcade_period_id
        ORDER BY os.difficulty DESC, os.points DESC, os.completed_at ASC, os.id ASC
      ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.arcade_ranking_periods p ON p.id = os.arcade_period_id
    JOIN eligible_students es ON es.id = os.student_id
    WHERE os.classroom_id = p_classroom_id
      AND os.status = 'COMPLETED'
      AND os.points >= 3
      AND p.classroom_id = p_classroom_id
      AND p.period_kind = 'MONTHLY'
      AND p.status = 'FINALIZED'
  ),
  monthly_ranked AS (
    SELECT
      m.student_id,
      m.guild_season_id,
      m.period_id,
      m.month_key,
      m.difficulty,
      m.points,
      dense_rank() OVER (
        PARTITION BY m.period_id
        ORDER BY m.difficulty DESC, m.points DESC
      )::integer AS rank
    FROM monthly_candidates m
    WHERE m.pick = 1
  ),
  official_agg AS (
    SELECT
      mr.student_id,
      min(mr.rank)::integer AS monthly_best_rank_all_time,
      min(mr.rank) FILTER (WHERE mr.guild_season_id = v_season_id)::integer AS season_best_rank,
      count(*) FILTER (WHERE mr.rank = 1)::integer AS monthly_win_count,
      count(*) FILTER (WHERE mr.rank <= 3)::integer AS monthly_top3_count,
      count(*) FILTER (WHERE mr.rank <= 10)::integer AS monthly_top10_count
    FROM monthly_ranked mr
    GROUP BY mr.student_id
  ),
  top10_months AS (
    SELECT
      mr.student_id,
      (substring(mr.month_key, 1, 4)::integer * 12
        + substring(mr.month_key, 6, 2)::integer) AS month_index,
      row_number() OVER (
        PARTITION BY mr.student_id
        ORDER BY mr.month_key
      ) AS rn
    FROM monthly_ranked mr
    WHERE mr.rank <= 10
  ),
  top10_groups AS (
    SELECT t.*, t.month_index - t.rn::integer AS grp
    FROM top10_months t
  ),
  top10_streaks AS (
    SELECT
      student_id,
      grp,
      count(*)::integer AS streak_len,
      max(month_index) AS end_idx
    FROM top10_groups
    GROUP BY student_id, grp
  ),
  latest_month AS (
    SELECT max(
      substring(month_key, 1, 4)::integer * 12
      + substring(month_key, 6, 2)::integer
    ) AS latest_idx
    FROM monthly_ranked
  ),
  streak_agg AS (
    SELECT
      ts.student_id,
      max(ts.streak_len)::integer AS max_consecutive_top10,
      coalesce(max(ts.streak_len) FILTER (
        WHERE ts.end_idx = (SELECT latest_idx FROM latest_month)
      ), 0)::integer AS current_consecutive_top10
    FROM top10_streaks ts
    GROUP BY ts.student_id
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'student_id', es.id,
      'student_name', es.name,
      'brand_name', es.brand_name,
      'is_test_account', es.is_test_account,
      'game_id', -3,
      'game_code', 'rakaruka_03',
      'game_name', '라카루카',
      'comparison_mode', 'CUSTOM',
      'play_count', coalesce(ga.play_count, 0),
      'official_submission_count', coalesce(ga.completed_count, 0),
      'verification_success_count', coalesce(ga.completed_count, 0),
      'verification_failure_count', 0,
      'first_play_at', ga.first_play_at,
      'latest_play_at', ga.latest_play_at,
      'all_time_pb', apb.points,
      'all_time_pb_at', apb.completed_at,
      'all_time_pb_run_id', NULL,
      'all_time_pb_rule_version', NULL,
      'all_time_pb_duration_ms', NULL,
      'all_time_pb_stats', CASE WHEN apb.id IS NULL THEN NULL ELSE jsonb_build_object(
        'difficulty', apb.difficulty,
        'wins', apb.wins,
        'draws', apb.draws,
        'losses', apb.losses
      ) END,
      'clear_level', coalesce(ga.clear_level, 0),
      'current_period_pb', cpb.points,
      'current_period_rank', cr.rank,
      'current_period_pb_at', cpb.completed_at,
      'monthly_best_rank_all_time', oa.monthly_best_rank_all_time,
      'season_best_rank', oa.season_best_rank,
      'monthly_win_count', coalesce(oa.monthly_win_count, 0),
      'monthly_top3_count', coalesce(oa.monthly_top3_count, 0),
      'monthly_top10_count', coalesce(oa.monthly_top10_count, 0),
      'current_consecutive_top10', coalesce(sa.current_consecutive_top10, 0),
      'max_consecutive_top10', coalesce(sa.max_consecutive_top10, 0)
    )
    ORDER BY es.name, es.id
  ), '[]'::jsonb)
  INTO v_rakaruka_rows
  FROM eligible_students es
  LEFT JOIN game_agg ga ON ga.student_id = es.id
  LEFT JOIN alltime_pb apb ON apb.student_id = es.id
  LEFT JOIN current_pb cpb ON cpb.student_id = es.id
  LEFT JOIN current_ranked cr ON cr.student_id = es.id
  LEFT JOIN official_agg oa ON oa.student_id = es.id
  LEFT JOIN streak_agg sa ON sa.student_id = es.id;

  SELECT coalesce(jsonb_agg(
    item || jsonb_build_object('clear_level', 0)
  ), '[]'::jsonb)
  INTO v_base_rows
  FROM jsonb_array_elements(coalesce(v_base -> 'student_game_rows', '[]'::jsonb)) AS x(item);

  SELECT jsonb_build_object(
    'game_id', -3,
    'game_code', 'rakaruka_03',
    'game_name', '라카루카',
    'is_active', true,
    'comparison_mode', 'CUSTOM',
    'semantics_notes', 'PB=best official challenge points; clear_level=highest verified winning difficulty.',
    'rule_versions', '[]'::jsonb,
    'play_count', count(g.id)::integer,
    'verified_count', count(g.id) FILTER (WHERE g.status = 'COMPLETED')::integer,
    'rejected_count', 0,
    'tracking_start_at', min(g.issued_at)
  )
  INTO v_rakaruka_game
  FROM public.tikatuka_games g
  JOIN public.students s ON s.id = g.student_id
  WHERE g.classroom_id = p_classroom_id
    AND s.classroom_id = p_classroom_id
    AND s.transferred_at IS NULL
    AND (
      s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD')
      OR (p_include_test AND s.role::text = 'TEST')
    )
    AND (p_include_test OR NOT coalesce(s.is_test_account, false));

  v_base := jsonb_set(
    v_base,
    '{student_game_rows}',
    v_base_rows || v_rakaruka_rows,
    true
  );

  v_base := jsonb_set(
    v_base,
    '{games}',
    coalesce(v_base -> 'games', '[]'::jsonb) || jsonb_build_array(v_rakaruka_game),
    true
  );

  v_base := jsonb_set(
    v_base,
    '{definitions,rakaruka_pb}',
    to_jsonb('best completed official-challenge points (win=3, draw=1, loss=0)'::text),
    true
  );
  v_base := jsonb_set(
    v_base,
    '{definitions,clear_level}',
    to_jsonb('Rakaruka highest verified winning difficulty; other Arcade games are 0'::text),
    true
  );

  v_game_count := coalesce(nullif(v_base #>> '{data_quality,game_count}', '')::integer, 0) + 1;
  v_base := jsonb_set(v_base, '{data_quality,game_count}', to_jsonb(v_game_count), true);

  RETURN v_base;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_get_arcade_statistics_v2(integer,integer,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_statistics_v2(integer,integer,text,boolean) TO authenticated, service_role;

COMMIT;
