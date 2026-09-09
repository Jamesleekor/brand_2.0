-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade leaderboard UI contract v2
-- 2026-09-09
--
-- Adds read-only leaderboard fields required by the student Arcade UI:
--   * general_score / certified_score / certification_status per Top 10 row
--   * guild_totals: current guild members' best STANDARD score sum and
--                   completed certified-record sum
--
-- Existing ranking, verification, monthly finalization and Guild 2 bonus rules
-- are NOT changed.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.get_arcade_leaderboard(text,bigint)') IS NULL
     OR to_regprocedure('public.arcade_resolve_period_student_ranks(integer,bigint,bigint)') IS NULL
     OR to_regclass('public.arcade_verification_provisional_entries') IS NULL
     OR to_regclass('public.arcade_verification_official_results') IS NULL
     OR to_regclass('public.guilds') IS NULL
     OR to_regclass('public.guild_members') IS NULL THEN
    RAISE EXCEPTION '[ARCADE LEADERBOARD V2] required Arcade/Guild baseline is missing.';
  END IF;
END $$;

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
      r.achieved_at AS game_over_at
    FROM ranks r
    JOIN public.students s
      ON s.id = r.student_id
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
            'game_over_at', d.game_over_at
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

REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text,bigint) TO authenticated;

COMMIT;
