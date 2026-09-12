-- =============================================================================
-- B.R.A.N.D 2.0 — Rakaruka ranking period alignment
-- 2026-09-13
--
-- Rakaruka now uses the same public.arcade_ranking_periods rows as Arcade #01/#02.
-- Calendar-month keys remain only as legacy metadata; period identity is the
-- arcade_ranking_periods.id FK.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regclass('public.tikatuka_official_sessions') IS NULL
     OR to_regclass('public.tikatuka_official_windows') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] Arcade period alignment prerequisites are missing.' USING ERRCODE = 'PTK40';
  END IF;
END;
$$;

ALTER TABLE public.tikatuka_official_sessions
  ADD COLUMN IF NOT EXISTS arcade_period_id bigint REFERENCES public.arcade_ranking_periods(id);

ALTER TABLE public.tikatuka_official_windows
  ADD COLUMN IF NOT EXISTS arcade_period_id bigint REFERENCES public.arcade_ranking_periods(id);

-- Backfill legacy rows if this migration is ever applied after real official use.
UPDATE public.tikatuka_official_sessions s
SET arcade_period_id = matched.id
FROM LATERAL (
  SELECT p.id
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id = s.classroom_id
    AND (
      p.contribution_year_month = to_char(s.period_key, 'YYYY-MM')
      OR (s.started_at >= p.starts_at AND s.started_at < p.ends_at_exclusive)
    )
  ORDER BY (p.period_kind = 'MONTHLY') DESC, p.starts_at DESC, p.id DESC
  LIMIT 1
) matched
WHERE s.arcade_period_id IS NULL;

UPDATE public.tikatuka_official_windows w
SET arcade_period_id = matched.id
FROM LATERAL (
  SELECT p.id
  FROM public.arcade_ranking_periods p
  WHERE p.classroom_id = w.classroom_id
    AND (
      p.contribution_year_month = to_char(w.period_key, 'YYYY-MM')
      OR ((w.opened_at IS NOT NULL) AND w.opened_at >= p.starts_at AND w.opened_at < p.ends_at_exclusive)
    )
  ORDER BY (p.period_kind = 'MONTHLY') DESC, p.starts_at DESC, p.id DESC
  LIMIT 1
) matched
WHERE w.arcade_period_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.tikatuka_official_sessions WHERE arcade_period_id IS NULL)
     OR EXISTS (SELECT 1 FROM public.tikatuka_official_windows WHERE arcade_period_id IS NULL) THEN
    RAISE EXCEPTION '[TIKATUKA] legacy official rows could not be mapped to an Arcade ranking period.' USING ERRCODE = 'PTK48';
  END IF;
END;
$$;

ALTER TABLE public.tikatuka_official_sessions ALTER COLUMN arcade_period_id SET NOT NULL;
ALTER TABLE public.tikatuka_official_windows ALTER COLUMN arcade_period_id SET NOT NULL;

DROP INDEX IF EXISTS public.ux_tikatuka_official_active_student_period;
DROP INDEX IF EXISTS public.ux_tikatuka_official_one_attempt_student_period;
CREATE UNIQUE INDEX ux_tikatuka_official_active_student_arcade_period
  ON public.tikatuka_official_sessions(classroom_id, student_id, arcade_period_id)
  WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX ux_tikatuka_official_one_attempt_student_arcade_period
  ON public.tikatuka_official_sessions(classroom_id, student_id, arcade_period_id);

ALTER TABLE public.tikatuka_official_windows
  DROP CONSTRAINT IF EXISTS tikatuka_official_windows_pkey;
ALTER TABLE public.tikatuka_official_windows
  ADD CONSTRAINT tikatuka_official_windows_pkey PRIMARY KEY (classroom_id, arcade_period_id);

-- -----------------------------------------------------------------------------
-- Shared period-scoped payload.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tikatuka_competition_payload_v3(
  p_classroom_id integer,
  p_student_id integer,
  p_period_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods;
  v_general jsonb;
  v_official jsonb;
  v_my_general jsonb;
  v_my_official jsonb;
  v_active jsonb;
  v_recent jsonb;
  v_open boolean := false;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_attempt_used boolean := false;
BEGIN
  SELECT * INTO v_period
  FROM public.arcade_ranking_periods p
  WHERE p.id = p_period_id
    AND p.classroom_id = p_classroom_id
    AND p.status IN ('ACTIVE','VERIFICATION','READY_TO_FINALIZE','FINALIZED');

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] selected Arcade ranking period was not found.' USING ERRCODE = 'PTK49';
  END IF;

  WITH levels AS (
    SELECT s.id AS student_id, s.name AS student_name, s.brand_name,
      coalesce(max(g.difficulty) FILTER (WHERE g.server_winner = 'player'), 0)::integer AS cleared_level
    FROM public.students s
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id = s.classroom_id
     AND g.student_id = s.id
     AND g.status = 'COMPLETED'
     AND g.completed_at >= v_period.starts_at
     AND g.completed_at < v_period.ends_at_exclusive
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD','TEST')
      AND coalesce(s.is_test_account, false) = false
    GROUP BY s.id, s.name, s.brand_name
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY cleared_level DESC)::integer AS rank FROM levels
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank',rank,'student_id',student_id,'student_name',student_name,'brand_name',brand_name,'cleared_level',cleared_level
  ) ORDER BY rank, student_name, student_id), '[]'::jsonb)
  INTO v_general FROM ranked;

  WITH eligible AS (
    SELECT os.*, row_number() OVER (
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
    SELECT e.*, s.name AS student_name, s.brand_name
    FROM eligible e JOIN public.students s ON s.id=e.student_id WHERE e.pick=1
  ), ranked AS (
    SELECT *, dense_rank() OVER (ORDER BY difficulty DESC, points DESC)::integer AS rank FROM best
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'rank',rank,'student_id',student_id,'student_name',student_name,'brand_name',brand_name,
    'difficulty',difficulty,'wins',wins,'draws',draws,'losses',losses,'points',points,
    'ranking_score',difficulty*16+points,'completed_at',completed_at
  ) ORDER BY rank, student_name, student_id), '[]'::jsonb)
  INTO v_official FROM ranked;

  WITH levels AS (
    SELECT s.id AS student_id,
      coalesce(max(g.difficulty) FILTER (WHERE g.server_winner='player'),0)::integer AS cleared_level
    FROM public.students s
    LEFT JOIN public.tikatuka_games g
      ON g.classroom_id=s.classroom_id AND g.student_id=s.id AND g.status='COMPLETED'
     AND g.completed_at >= v_period.starts_at AND g.completed_at < v_period.ends_at_exclusive
    WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD','TEST')
      AND coalesce(s.is_test_account,false)=false
    GROUP BY s.id
  ), ranked AS (
    SELECT *,dense_rank() OVER(ORDER BY cleared_level DESC)::integer AS rank FROM levels
  )
  SELECT jsonb_build_object('rank',rank,'cleared_level',cleared_level)
  INTO v_my_general FROM ranked WHERE student_id=p_student_id;

  WITH best AS (
    SELECT os.*, row_number() OVER (
      PARTITION BY os.student_id ORDER BY os.difficulty DESC,os.points DESC,os.completed_at ASC,os.id ASC
    ) AS pick
    FROM public.tikatuka_official_sessions os
    JOIN public.students s ON s.id=os.student_id
    WHERE os.classroom_id=p_classroom_id AND os.arcade_period_id=p_period_id
      AND os.status='COMPLETED' AND os.points>=3
      AND s.transferred_at IS NULL AND coalesce(s.is_test_account,false)=false
  ), chosen AS (SELECT * FROM best WHERE pick=1), ranked AS (
    SELECT *,dense_rank() OVER(ORDER BY difficulty DESC,points DESC)::integer AS rank FROM chosen
  )
  SELECT jsonb_build_object(
    'rank',rank,'difficulty',difficulty,'wins',wins,'draws',draws,'losses',losses,
    'points',points,'ranking_score',difficulty*16+points,'completed_at',completed_at
  ) INTO v_my_official FROM ranked WHERE student_id=p_student_id;

  SELECT jsonb_build_object(
    'session_id',id,'difficulty',difficulty,'games_played',games_played,'remaining_games',5-games_played,
    'wins',wins,'draws',draws,'losses',losses,'points',points,'started_at',started_at
  ) INTO v_active
  FROM public.tikatuka_official_sessions
  WHERE classroom_id=p_classroom_id AND student_id=p_student_id
    AND arcade_period_id=p_period_id AND status='ACTIVE'
  LIMIT 1;

  SELECT coalesce(jsonb_agg(item ORDER BY (item->>'completed_at') DESC),'[]'::jsonb)
  INTO v_recent
  FROM (
    SELECT jsonb_build_object(
      'session_id',id,'difficulty',difficulty,'wins',wins,'draws',draws,'losses',losses,'points',points,
      'qualified',points>=3,'ranking_score',CASE WHEN points>=3 THEN difficulty*16+points ELSE NULL END,
      'completed_at',completed_at
    ) AS item
    FROM public.tikatuka_official_sessions
    WHERE classroom_id=p_classroom_id AND student_id=p_student_id
      AND arcade_period_id=p_period_id AND status='COMPLETED'
    ORDER BY completed_at DESC,id DESC LIMIT 5
  ) recent;

  SELECT w.is_open,w.opened_at,w.closed_at
  INTO v_open,v_opened_at,v_closed_at
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id=p_classroom_id AND w.arcade_period_id=p_period_id;

  SELECT EXISTS(
    SELECT 1 FROM public.tikatuka_official_sessions s
    WHERE s.classroom_id=p_classroom_id AND s.student_id=p_student_id AND s.arcade_period_id=p_period_id
  ) INTO v_attempt_used;

  RETURN jsonb_build_object(
    'period_id',v_period.id,
    'period_key',coalesce(v_period.contribution_year_month,to_char(v_period.starts_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')),
    'period_display_name',v_period.display_name,
    'period_kind',v_period.period_kind,
    'period_status',v_period.status,
    'period_starts_at',v_period.starts_at,
    'period_ends_at_exclusive',v_period.ends_at_exclusive,
    'general_leaderboard',v_general,
    'official_leaderboard',v_official,
    'my_general',v_my_general,
    'my_official',v_my_official,
    'active_challenge',v_active,
    'recent_challenges',v_recent,
    'official_window_open',coalesce(v_open,false),
    'official_window_opened_at',v_opened_at,
    'official_window_closed_at',v_closed_at,
    'official_attempt_used',v_attempt_used,
    'official_can_start',coalesce(v_open,false) AND NOT v_attempt_used
      AND v_period.status='ACTIVE' AND now()>=v_period.starts_at AND now()<v_period.ends_at_exclusive,
    'rules',jsonb_build_object(
      'matches_per_challenge',5,'win_points',3,'draw_points',1,'loss_points',0,'minimum_qualifying_points',3
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_tikatuka_competition_v2(p_period_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE='PTK01';
  END IF;
  RETURN public.tikatuka_competition_payload_v3(v_classroom_id,v_student_id,p_period_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.student_start_tikatuka_official_challenge_v2(
  p_period_id bigint,
  p_difficulty integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_student_id integer:=public.current_student_id();
  v_classroom_id integer:=public.current_classroom_id();
  v_period public.arcade_ranking_periods;
  v_legacy_key date;
  v_highest integer;
  v_window_open boolean:=false;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE='PTK01';
  END IF;
  IF p_difficulty IS NULL OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty must be 1..10.' USING ERRCODE='PTK41';
  END IF;

  SELECT * INTO v_period FROM public.arcade_ranking_periods p
  WHERE p.id=p_period_id AND p.classroom_id=v_classroom_id;
  IF v_period.id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] selected Arcade ranking period was not found.' USING ERRCODE='PTK49';
  END IF;
  IF v_period.status<>'ACTIVE' OR now()<v_period.starts_at OR now()>=v_period.ends_at_exclusive THEN
    RAISE EXCEPTION '[TIKATUKA] selected Arcade ranking period is not accepting new official challenges.' USING ERRCODE='PTK50';
  END IF;

  SELECT coalesce(w.is_open,false) INTO v_window_open
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id=v_classroom_id AND w.arcade_period_id=p_period_id;
  IF coalesce(v_window_open,false)=false THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge is not open.' USING ERRCODE='PTK44';
  END IF;

  SELECT coalesce(highest_unlocked_difficulty,1) INTO v_highest
  FROM public.tikatuka_progress WHERE classroom_id=v_classroom_id AND student_id=v_student_id;
  v_highest:=coalesce(v_highest,1);
  IF p_difficulty>v_highest THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge difficulty % is locked; highest unlocked is %.',p_difficulty,v_highest USING ERRCODE='PTK03';
  END IF;
  IF EXISTS(
    SELECT 1 FROM public.tikatuka_official_sessions s
    WHERE s.classroom_id=v_classroom_id AND s.student_id=v_student_id AND s.arcade_period_id=p_period_id
  ) THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge attempt has already been used for this period.' USING ERRCODE='PTK45';
  END IF;

  v_legacy_key:=coalesce(to_date(v_period.contribution_year_month||'-01','YYYY-MM-DD'),date_trunc('month',v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date);
  BEGIN
    INSERT INTO public.tikatuka_official_sessions(classroom_id,student_id,period_key,arcade_period_id,difficulty)
    VALUES(v_classroom_id,v_student_id,v_legacy_key,p_period_id,p_difficulty);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge attempt has already been used for this period.' USING ERRCODE='PTK45';
  END;

  RETURN public.tikatuka_competition_payload_v3(v_classroom_id,v_student_id,p_period_id);
END;
$$;

-- Tag verified completions against any ACTIVE official session, now keyed by Arcade period.
CREATE OR REPLACE FUNCTION public.a_tikatuka_capture_official_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_session public.tikatuka_official_sessions;
BEGIN
  IF OLD.status='READY' AND NEW.status='COMPLETED' THEN
    SELECT os.* INTO v_session
    FROM public.tikatuka_official_sessions os
    JOIN public.arcade_ranking_periods p ON p.id=os.arcade_period_id
    WHERE os.classroom_id=OLD.classroom_id AND os.student_id=OLD.student_id
      AND os.status='ACTIVE' AND os.difficulty=OLD.difficulty
      AND OLD.issued_at>=os.started_at
      AND OLD.issued_at>=p.starts_at AND OLD.issued_at<p.ends_at_exclusive
      AND os.games_played<5
    ORDER BY os.started_at DESC,os.id DESC LIMIT 1 FOR UPDATE OF os;
    IF v_session.id IS NOT NULL THEN
      NEW.official_session_id:=v_session.id;
      NEW.official_match_number:=v_session.games_played+1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tikatuka_guard_active_official_difficulty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_difficulty integer;
BEGIN
  SELECT s.difficulty INTO v_difficulty
  FROM public.tikatuka_official_sessions s
  WHERE s.classroom_id=NEW.classroom_id AND s.student_id=NEW.student_id AND s.status='ACTIVE'
  ORDER BY s.started_at DESC,s.id DESC LIMIT 1;
  IF v_difficulty IS NOT NULL AND NEW.difficulty<>v_difficulty THEN
    RAISE EXCEPTION '[TIKATUKA] official challenge is active at difficulty %; new games must use the same difficulty.',v_difficulty USING ERRCODE='PTK43';
  END IF;
  RETURN NEW;
END;
$$;

-- Teacher window uses the currently live ACTIVE Arcade period instead of the calendar month.
CREATE OR REPLACE FUNCTION public.tikatuka_current_arcade_period(p_classroom_id integer)
RETURNS public.arcade_ranking_periods
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path=public,pg_temp
AS $$
  SELECT p.* FROM public.arcade_ranking_periods p
  WHERE p.classroom_id=p_classroom_id AND p.status='ACTIVE'
    AND now()>=p.starts_at AND now()<p.ends_at_exclusive
  ORDER BY (p.period_kind='MONTHLY') DESC,p.starts_at DESC,p.id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.tikatuka_official_window_admin_payload(p_classroom_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path=public,pg_temp
AS $$
DECLARE
  v_period public.arcade_ranking_periods;
  v_open boolean:=false; v_opened_at timestamptz; v_closed_at timestamptz;
  v_started integer:=0; v_completed integer:=0;
BEGIN
  v_period:=public.tikatuka_current_arcade_period(p_classroom_id);
  IF v_period.id IS NULL THEN
    RETURN jsonb_build_object('period_key',to_char(now() AT TIME ZONE 'Asia/Seoul','YYYY-MM'),'period_id',NULL,
      'period_display_name',NULL,'is_open',false,'opened_at',NULL,'closed_at',NULL,'started_count',0,'completed_count',0);
  END IF;
  SELECT w.is_open,w.opened_at,w.closed_at INTO v_open,v_opened_at,v_closed_at
  FROM public.tikatuka_official_windows w
  WHERE w.classroom_id=p_classroom_id AND w.arcade_period_id=v_period.id;
  SELECT count(*)::integer,count(*) FILTER(WHERE os.status='COMPLETED')::integer
  INTO v_started,v_completed
  FROM public.tikatuka_official_sessions os JOIN public.students s ON s.id=os.student_id
  WHERE os.classroom_id=p_classroom_id AND os.arcade_period_id=v_period.id
    AND s.transferred_at IS NULL AND coalesce(s.is_test_account,false)=false;
  RETURN jsonb_build_object(
    'period_key',coalesce(v_period.contribution_year_month,to_char(v_period.starts_at AT TIME ZONE 'Asia/Seoul','YYYY-MM')),
    'period_id',v_period.id,'period_display_name',v_period.display_name,
    'is_open',coalesce(v_open,false),'opened_at',v_opened_at,'closed_at',v_closed_at,
    'started_count',coalesce(v_started,0),'completed_count',coalesce(v_completed,0));
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_tikatuka_official_window_v1(p_is_open boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer; v_period public.arcade_ranking_periods; v_legacy_key date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE='PTK31'; END IF;
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  IF v_classroom_id IS NULL THEN RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE='PTK31'; END IF;
  IF p_is_open IS NULL THEN RAISE EXCEPTION '공인 도전 공개 상태가 필요합니다.' USING ERRCODE='PTK47'; END IF;
  v_period:=public.tikatuka_current_arcade_period(v_classroom_id);
  IF v_period.id IS NULL THEN RAISE EXCEPTION '현재 진행 중인 Arcade 랭킹 기간이 없습니다.' USING ERRCODE='PTK50'; END IF;
  v_legacy_key:=coalesce(to_date(v_period.contribution_year_month||'-01','YYYY-MM-DD'),date_trunc('month',v_period.starts_at AT TIME ZONE 'Asia/Seoul')::date);
  INSERT INTO public.tikatuka_official_windows(classroom_id,period_key,arcade_period_id,is_open,opened_at,closed_at,updated_at)
  VALUES(v_classroom_id,v_legacy_key,v_period.id,p_is_open,CASE WHEN p_is_open THEN now() END,CASE WHEN p_is_open THEN NULL ELSE now() END,now())
  ON CONFLICT(classroom_id,arcade_period_id) DO UPDATE SET
    is_open=EXCLUDED.is_open,
    opened_at=CASE WHEN EXCLUDED.is_open THEN now() ELSE public.tikatuka_official_windows.opened_at END,
    closed_at=CASE WHEN EXCLUDED.is_open THEN NULL ELSE now() END,
    updated_at=now();
  RETURN public.tikatuka_official_window_admin_payload(v_classroom_id);
END;
$$;

REVOKE ALL ON FUNCTION public.tikatuka_competition_payload_v3(integer,integer,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_current_arcade_period(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.student_get_tikatuka_competition_v2(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.student_start_tikatuka_official_challenge_v2(bigint,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_get_tikatuka_competition_v2(bigint) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.student_start_tikatuka_official_challenge_v2(bigint,integer) TO authenticated,service_role;

COMMIT;
