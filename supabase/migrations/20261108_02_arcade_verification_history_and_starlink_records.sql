-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade 2026-11-04
--   1. 교사용 공인 인증 1·2·3차 기록 조회 RPC (신규, 읽기 전용)
--   2. teacher_get_arcade_period_records 에 스타링크(starlink_04) 추가
--      + 확정된 달에 없던 게임은 순위 계산을 건너뜀 (P0220 방지)
-- 학생 기록·순위·Guild 2 데이터는 바꾸지 않습니다.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. 공인 인증 도전 1·2·3차 기록 조회 (교사 전용, 읽기 전용)
--    * 모든 기간 상태(인증 중 / 확정 대기 / 확정 완료)에서 동작합니다.
--    * arcade_resolve_period_student_ranks 를 호출하지 않으므로, 그 달에
--      없던 게임(예: 10월 스타링크)을 조회해도 오류가 나지 않습니다.
--    * 업적 판정 규칙은 _achievement_helper_arcade_evidence_v5 와 동일합니다.
--        ARC-003: 1차 기회의 유효 기록 >= 인증 기준점
--        ARC-010: 유효 인증 기록 > 인증 시작 당시 잠정 최고기록
--        ARC-018: 같은 세션에서 1·2차 유효 기록 < 기준, 3차 유효 기록 >= 기준
--    * 데이터를 바꾸지 않습니다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_verification_attempt_history(
  p_period_id bigint,
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_rows jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE VERIFY] period not found.' USING ERRCODE = 'P0256';
  END IF;

  SELECT id INTO v_game_id FROM public.arcade_games WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  WITH sessions AS (
    SELECT s.*,
      (o.session_id IS NOT NULL AND o.session_id = s.id) AS is_decisive
    FROM public.arcade_verification_sessions s
    LEFT JOIN public.arcade_verification_official_results o
      ON o.period_id = s.period_id AND o.game_id = s.game_id AND o.student_id = s.student_id
    WHERE s.classroom_id = v_classroom_id
      AND s.period_id = v_period.id
      AND s.game_id = v_game_id
  ), attempts AS (
    SELECT a.*,
      s.verification_threshold,
      s.provisional_score,
      (a.status = 'TERMINAL' AND coalesce(a.valid_run, false) AND a.official_score IS NOT NULL
        AND s.verification_threshold IS NOT NULL AND a.official_score >= s.verification_threshold) AS meets_threshold,
      (coalesce(a.valid_run, false) AND a.official_score IS NOT NULL
        AND s.provisional_score IS NOT NULL AND a.official_score > s.provisional_score) AS beats_provisional
    FROM public.arcade_verification_attempts a
    JOIN sessions s ON s.id = a.session_id
  ), session_flags AS (
    SELECT s.id AS session_id,
      min(a.opportunity_number) FILTER (WHERE a.meets_threshold) AS first_success_opportunity,
      coalesce(bool_or(a.opportunity_number = 1 AND coalesce(a.valid_run, false) AND a.official_score IS NOT NULL
        AND a.official_score >= s.verification_threshold), false) AS arc003,
      coalesce(bool_or(a.beats_provisional), false) AS arc010,
      coalesce(
        bool_or(a.opportunity_number = 1 AND coalesce(a.valid_run, false) AND coalesce(a.official_score, -9223372036854775808) < s.verification_threshold)
        AND bool_or(a.opportunity_number = 2 AND coalesce(a.valid_run, false) AND coalesce(a.official_score, -9223372036854775808) < s.verification_threshold)
        AND bool_or(a.opportunity_number = 3 AND coalesce(a.valid_run, false) AND coalesce(a.official_score, -9223372036854775808) >= s.verification_threshold),
        false) AS arc018,
      max(a.official_score) FILTER (WHERE a.status = 'TERMINAL' AND coalesce(a.valid_run, false)) AS best_verification_score
    FROM sessions s
    LEFT JOIN attempts a ON a.session_id = s.id
    GROUP BY s.id
  ), session_json AS (
    SELECT s.student_id,
      bool_or(s.is_decisive) AS has_decisive,
      jsonb_agg(jsonb_build_object(
        'session_id', s.id,
        'status', s.status,
        'result_status', s.result_status,
        'is_decisive', s.is_decisive,
        'provisional_score', s.provisional_score,
        'verification_threshold', s.verification_threshold,
        'threshold_percent', s.threshold_percent,
        'max_attempts', s.max_attempts,
        'success_achieved', s.success_achieved,
        'activated_at', s.activated_at,
        'ended_at', s.ended_at,
        'best_verification_score', f.best_verification_score,
        'first_success_opportunity', f.first_success_opportunity,
        'arc003_first_try_success', f.arc003,
        'arc010_beat_provisional', f.arc010,
        'arc018_third_try_success', f.arc018,
        'attempts', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'attempt_id', a.id,
            'issue_number', a.issue_number,
            'opportunity_number', a.opportunity_number,
            'run_id', a.run_id,
            'status', a.status,
            'consumed', a.consumed,
            'valid_run', a.valid_run,
            'terminal_outcome', a.terminal_outcome,
            'official_score', a.official_score,
            'issued_at', a.issued_at,
            'terminal_at', a.terminal_at,
            'meets_threshold', a.meets_threshold,
            'beats_provisional', a.beats_provisional
          ) ORDER BY a.issue_number, a.id)
          FROM attempts a WHERE a.session_id = s.id
        ), '[]'::jsonb)
      ) ORDER BY s.is_decisive DESC, s.id DESC) AS sessions
    FROM sessions s
    JOIN session_flags f ON f.session_id = s.id
    GROUP BY s.student_id
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'student_id', st.id,
    'student_name', st.name,
    'brand_name', st.brand_name,
    'decision_kind', o.decision_kind,
    'official_score', o.official_score,
    'ranking_eligible', o.ranking_eligible,
    'sessions', sj.sessions
  ) ORDER BY st.name, st.id), '[]'::jsonb)
  INTO v_rows
  FROM session_json sj
  JOIN public.students st ON st.id = sj.student_id
  LEFT JOIN public.arcade_verification_official_results o
    ON o.period_id = v_period.id AND o.game_id = v_game_id AND o.student_id = st.id;

  RETURN jsonb_build_object(
    'period_id', v_period.id,
    'period_name', v_period.display_name,
    'period_status', v_period.status,
    'game_code', p_game_code,
    'students', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_get_arcade_verification_attempt_history(bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_verification_attempt_history(bigint, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. 기간 기록 조회에 스타링크 추가 (기존 함수와 동일, 표시한 두 곳만 변경)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_arcade_period_records(p_period_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
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
    WHERE g.code IN ('focus_reaction_01', 'pure_reaction_02', 'starlink_04')
  ), rank_games AS MATERIALIZED (
    -- A finalized month only has snapshots for games that existed then
    -- (e.g. Starlink did not exist in October). Skip those games instead of
    -- letting arcade_resolve_period_student_ranks raise P0220.
    SELECT g.* FROM games g
    WHERE v_period.period_kind <> 'MONTHLY' OR v_period.status <> 'FINALIZED'
       OR EXISTS (SELECT 1 FROM public.arcade_monthly_snapshots ms
                  WHERE ms.period_id = v_period.id AND ms.game_id = g.id)
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
    SELECT g.id game_id, r.* FROM rank_games g
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

NOTIFY pgrst, 'reload schema';

COMMIT;
