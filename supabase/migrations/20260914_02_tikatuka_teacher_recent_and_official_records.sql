-- =============================================================================
-- B.R.A.N.D 2.0 — Rakaruka teacher progress detail
-- 2026-09-14
--
-- Adds read-only derived fields to the teacher progress list:
--   * recent_results: latest five completed ORDINARY games, oldest -> newest.
--   * official_challenge: latest official five-match session and per-match results.
-- No history is mutated and teacher unlock override semantics remain unchanged.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tikatuka_games') IS NULL
     OR to_regclass('public.tikatuka_official_sessions') IS NULL
     OR to_regprocedure('public.tikatuka_progress_payload(integer,integer)') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] teacher record prerequisites are missing.' USING ERRCODE = 'PTK30';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_tikatuka_progress_v1()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_items jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PTK31';
  END IF;

  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'PTK31';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'student_id', s.id,
        'student_name', s.name,
        'brand_name', s.brand_name,
        'recent_results', coalesce(recent.results, '[]'::jsonb),
        'official_challenge', official.payload
      ) || public.tikatuka_progress_payload(v_classroom_id, s.id)
      ORDER BY s.name, s.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.students s
  LEFT JOIN LATERAL (
    SELECT coalesce(
      jsonb_agg(r.server_winner ORDER BY r.completed_at, r.id),
      '[]'::jsonb
    ) AS results
    FROM (
      SELECT g.id, g.server_winner, g.completed_at
      FROM public.tikatuka_games g
      WHERE g.classroom_id = v_classroom_id
        AND g.student_id = s.id
        AND g.status = 'COMPLETED'
        AND g.official_session_id IS NULL
      ORDER BY g.completed_at DESC, g.id DESC
      LIMIT 5
    ) r
  ) recent ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object(
      'session_id', os.id,
      'status', os.status,
      'difficulty', os.difficulty,
      'games_played', os.games_played,
      'wins', os.wins,
      'draws', os.draws,
      'losses', os.losses,
      'points', os.points,
      'results', (
        SELECT coalesce(
          jsonb_agg(g.server_winner ORDER BY g.official_match_number, g.completed_at, g.id),
          '[]'::jsonb
        )
        FROM public.tikatuka_games g
        WHERE g.official_session_id = os.id
          AND g.status = 'COMPLETED'
      ),
      'started_at', os.started_at,
      'completed_at', os.completed_at
    ) AS payload
    FROM public.tikatuka_official_sessions os
    WHERE os.classroom_id = v_classroom_id
      AND os.student_id = s.id
    ORDER BY os.started_at DESC, os.id DESC
    LIMIT 1
  ) official ON true
  WHERE s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT', 'STUDENT_LEADER', 'GUARD', 'TEST');

  RETURN jsonb_build_object('items', v_items);
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_get_tikatuka_progress_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_tikatuka_progress_v1() TO authenticated, service_role;

COMMIT;
