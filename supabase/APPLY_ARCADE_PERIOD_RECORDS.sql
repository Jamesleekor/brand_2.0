-- Read-only teacher report: the selected period's ordinary records for all three games.
-- No record, period status, verification decision, snapshot or reward is changed.
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
REVOKE ALL ON FUNCTION public.teacher_get_arcade_period_records(bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_period_records(bigint) TO authenticated;
COMMENT ON FUNCTION public.teacher_get_arcade_period_records(bigint) IS
  'Teacher-only, classroom-scoped, read-only period report for reaction games and Rakaruka. Ordinary play remains visible before verification opens.';
NOTIFY pgrst, 'reload schema';
