-- B.R.A.N.D 2.0 — Raid CLASH V4: 선생님이 격돌잡이 선택 (2026-11-09)
-- CLASH_V4_20261109
--
-- 무엇이 바뀌나
--   1) raid_clash_configs.selection_mode: 'RANDOM'(기본, 지금과 같음) / 'TEACHER'(선생님이 선택)
--      → 레이드 진행 중에도 언제든 바꿀 수 있음 (teacher_set_raid_clash_selection_mode)
--   2) 지원 마감 뒤 '격돌잡이 추첨 중' 시간
--      · RANDOM : 마감 후 4~8초(무작위) 뒤 추첨 → 학생은 어느 방식인지 알 수 없음
--      · TEACHER: 선생님이 확정하는 즉시, 30초 안에 확정하지 않으면 무작위 추첨
--      · 선생님이 고른 인원이 모자라면 남은 자리는 다른 지원자 중 무작위
--   3) 선택 방식·선생님이 고른 명단은 학생·중계에 나가는 공개 상태(raid_clash_public_state)와
--      전투 이벤트에 전혀 실리지 않음 (교사 전용 함수에서만 보임)
--
-- 안전장치: 격돌이 진행 중(VOLUNTEERING/SELECTED/PLAYING)이면 적용을 거부. 두 번 실행해도 안전.

DO $guard$
BEGIN
  IF to_regclass('public.raid_clash_players') IS NULL OR to_regprocedure('public.raid_clash_advance(bigint)') IS NULL THEN
    RAISE EXCEPTION 'CLASH V2/V3가 먼저 적용되어 있어야 합니다.';
  END IF;
  IF to_regprocedure('brand_backup.replace_once(regprocedure,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'brand_backup.replace_once not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE phase IN ('VOLUNTEERING','SELECTED','PLAYING')) THEN
    RAISE EXCEPTION '격돌이 진행 중입니다. 격돌이 끝난 뒤 다시 실행해 주세요.';
  END IF;
END
$guard$;

-- 0) backup (once)
INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5, captured_at)
SELECT 'PRE_CLASH_V4_20261109', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid)), now()
  FROM pg_proc p
 WHERE p.oid IN ('public.raid_clash_advance(bigint)'::regprocedure, 'public.teacher_get_raid_clash_config(bigint)'::regprocedure)
   AND NOT EXISTS (SELECT 1 FROM brand_backup.function_snapshots s
                    WHERE s.snapshot_label = 'PRE_CLASH_V4_20261109' AND s.signature = p.oid::regprocedure::text);

-- 1) columns
ALTER TABLE public.raid_clash_configs ADD COLUMN IF NOT EXISTS selection_mode text NOT NULL DEFAULT 'RANDOM';
DO $c$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'raid_clash_configs_selection_mode_check') THEN
    ALTER TABLE public.raid_clash_configs ADD CONSTRAINT raid_clash_configs_selection_mode_check CHECK (selection_mode IN ('RANDOM','TEACHER'));
  END IF;
END
$c$;
ALTER TABLE public.raid_clash_sessions ADD COLUMN IF NOT EXISTS teacher_pick bigint[];
ALTER TABLE public.raid_clash_sessions ADD COLUMN IF NOT EXISTS draw_at timestamptz;

-- 2) helpers (internal only)
-- 선생님 선택 방식일 때만 선생님이 고른 명단을 돌려준다(무작위 방식이면 NULL → 전원 무작위)
CREATE OR REPLACE FUNCTION public.raid_clash_v4_pick(p_session_id bigint)
RETURNS bigint[]
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN c.selection_mode = 'TEACHER' THEN s.teacher_pick END
    FROM public.raid_clash_sessions s
    LEFT JOIN public.raid_clash_configs c ON c.raid_id = s.raid_id
   WHERE s.id = p_session_id;
$function$;

-- 지원 마감(volunteer_accept_until) 뒤 언제 추첨할지
--   RANDOM : draw_at(마감 + 4~8초) 이후
--   TEACHER: 선생님이 확정했으면 바로, 아니면 마감 + 30초 이후
CREATE OR REPLACE FUNCTION public.raid_clash_v4_draw_ready(p_session_id bigint, p_now timestamptz)
RETURNS boolean
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_mode text;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_s.volunteer_accept_until IS NULL THEN RETURN true; END IF;
  IF p_now < v_s.volunteer_accept_until THEN RETURN false; END IF;
  SELECT COALESCE(selection_mode, 'RANDOM') INTO v_mode FROM public.raid_clash_configs WHERE raid_id = v_s.raid_id;
  IF v_s.draw_at IS NULL THEN
    v_s.draw_at := v_s.volunteer_accept_until + make_interval(secs => (4 + random() * 4)::double precision);
    UPDATE public.raid_clash_sessions SET draw_at = v_s.draw_at WHERE id = p_session_id;
  END IF;
  IF COALESCE(v_mode, 'RANDOM') = 'TEACHER' THEN
    RETURN v_s.teacher_pick IS NOT NULL OR p_now >= v_s.volunteer_accept_until + interval '30 seconds';
  END IF;
  RETURN p_now >= v_s.draw_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.raid_clash_v4_pick(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_v4_draw_ready(bigint,timestamptz) FROM PUBLIC, anon, authenticated;

-- 3) draw: picked volunteers first (TEACHER mode only), then random
SELECT brand_backup.replace_once(
  'public.raid_clash_advance(bigint)'::regprocedure,
  '/*CLASH_V4*/',
  $n$      IF v_s.phase = 'VOLUNTEERING' AND v_now >= v_s.volunteer_accept_until THEN
        -- Draw up to N players at random among the volunteers who can still attack.
        INSERT INTO public.raid_clash_players(session_id, slot, participant_id)
        SELECT v_s.id, (row_number() OVER () - 1)::smallint, q.participant_id
          FROM (SELECT v.participant_id
                  FROM public.raid_clash_volunteers v
                  JOIN public.raid_participants p ON p.id = v.participant_id AND NOT COALESCE(p.attack_blocked,false)
                 WHERE v.session_id = v_s.id
                 ORDER BY random()
                 LIMIT public.raid_clash_planned_players(v_s.config)) q
        ON CONFLICT DO NOTHING;$n$,
  $r$      IF v_s.phase = 'VOLUNTEERING' AND v_now >= v_s.volunteer_accept_until
         AND public.raid_clash_v4_draw_ready(v_s.id, v_now) /*CLASH_V4*/ THEN
        -- V4: teacher-picked volunteers first (TEACHER mode only), the remaining seats at random.
        INSERT INTO public.raid_clash_players(session_id, slot, participant_id)
        SELECT v_s.id, (row_number() OVER (ORDER BY q.ord, q.rnd) - 1)::smallint, q.participant_id
          FROM (SELECT v.participant_id,
                       COALESCE(array_position(public.raid_clash_v4_pick(v_s.id), v.participant_id), 1000000) AS ord,
                       random() AS rnd
                  FROM public.raid_clash_volunteers v
                  JOIN public.raid_participants p ON p.id = v.participant_id AND NOT COALESCE(p.attack_blocked,false)
                 WHERE v.session_id = v_s.id
                 ORDER BY 2, 3
                 LIMIT public.raid_clash_planned_players(v_s.config)) q
        ON CONFLICT DO NOTHING;$r$
);

-- 4) teacher config read also returns selection_mode (teacher-only RPC)
SELECT brand_backup.replace_once(
  'public.teacher_get_raid_clash_config(bigint)'::regprocedure,
  '/*CLASH_V4:get*/',
  $n$'max_player_count', 12,$n$,
  $r$'max_player_count', 12, /*CLASH_V4:get*/ 'selection_mode', COALESCE(v_cfg.selection_mode, 'RANDOM'),$r$
);

-- 5) teacher: pick panel state (volunteers + total clash count across all raids)
CREATE OR REPLACE FUNCTION public.teacher_get_raid_clash_pick_state(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE; v_cfg public.raid_clash_configs%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE;
  v_now timestamptz; v_volunteers jsonb := '[]'::jsonb; v_players jsonb := '[]'::jsonb; v_planned integer;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_clash_advance(p_raid_id);
  v_now := clock_timestamp();
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  SELECT * INTO v_cfg FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id;

  IF v_s.id IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'participant_id', p.id,
             'student_id', p.student_id,
             'student_name', p.snapshot_student_name,
             'guild_name', p.snapshot_guild_name,
             'guild_logo_url', p.snapshot_guild_logo_url,
             'character_image_url', p.snapshot_equipped_character_image_url,
             'attack_blocked', COALESCE(p.attack_blocked, false),
             'volunteered_at', v.created_at,
             'clash_count_total', (
               SELECT count(*) FROM public.raid_clash_players pl2
                 JOIN public.raid_clash_sessions s2 ON s2.id = pl2.session_id
                 JOIN public.raid_participants p2 ON p2.id = pl2.participant_id
                WHERE p2.student_id = p.student_id
                  AND s2.id <> v_s.id
                  AND s2.phase <> 'CANCELLED'))
           ORDER BY v.created_at, p.id), '[]'::jsonb)
      INTO v_volunteers
      FROM public.raid_clash_volunteers v
      JOIN public.raid_participants p ON p.id = v.participant_id
     WHERE v.session_id = v_s.id;
    SELECT COALESCE(jsonb_agg(pl.participant_id ORDER BY pl.slot), '[]'::jsonb) INTO v_players
      FROM public.raid_clash_players pl WHERE pl.session_id = v_s.id;
    v_planned := public.raid_clash_planned_players(v_s.config);
  ELSE
    v_planned := GREATEST(1, LEAST(12, COALESCE(v_cfg.player_count, 3)::integer));
  END IF;

  RETURN jsonb_build_object(
    'raid_id', p_raid_id,
    'raid_status', v_raid.status,
    'enabled', COALESCE(v_cfg.enabled, false),
    'configured', v_cfg.raid_id IS NOT NULL,
    'selection_mode', COALESCE(v_cfg.selection_mode, 'RANDOM'),
    'planned_player_count', v_planned,
    'server_now', v_now,
    'session', CASE WHEN v_s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_s.id,
      'phase', v_s.phase,
      'volunteer_closes_at', v_s.volunteer_closes_at,
      'volunteer_accept_until', v_s.volunteer_accept_until,
      'pick_deadline_at', v_s.volunteer_accept_until + interval '30 seconds',
      'teacher_pick', to_jsonb(v_s.teacher_pick),
      'picked', v_s.teacher_pick IS NOT NULL,
      'volunteers', v_volunteers,
      'players', v_players
    ) END
  );
END;
$function$;

-- 6) teacher: choose players (fewer than needed → the rest random)
CREATE OR REPLACE FUNCTION public.teacher_pick_raid_clash_players(p_raid_id bigint, p_participant_ids bigint[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_mode text; v_ids bigint[]; v_bad integer;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_clash_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'VOLUNTEERING' THEN
    RAISE EXCEPTION '지금은 격돌잡이를 고를 수 없습니다 (이미 정해졌거나 격돌이 없습니다)' USING ERRCODE = 'P0215';
  END IF;
  SELECT selection_mode INTO v_mode FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
  IF COALESCE(v_mode, 'RANDOM') <> 'TEACHER' THEN
    RAISE EXCEPTION '선택 방식이 ''선생님이 선택''일 때만 고를 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  IF v_s.teacher_pick IS NOT NULL THEN
    RAISE EXCEPTION '이미 확정했습니다' USING ERRCODE = 'P0215';
  END IF;

  v_ids := COALESCE(p_participant_ids, ARRAY[]::bigint[]);
  IF array_position(v_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> cardinality(v_ids) THEN
    RAISE EXCEPTION '같은 학생을 두 번 고를 수 없습니다' USING ERRCODE = 'P0213';
  END IF;
  IF cardinality(v_ids) > public.raid_clash_planned_players(v_s.config) THEN
    RAISE EXCEPTION '격돌 인원(%명)보다 많이 고를 수 없습니다', public.raid_clash_planned_players(v_s.config) USING ERRCODE = 'P0213';
  END IF;
  SELECT count(*) INTO v_bad
    FROM unnest(v_ids) x
   WHERE NOT EXISTS (
     SELECT 1 FROM public.raid_clash_volunteers v
       JOIN public.raid_participants p ON p.id = v.participant_id AND NOT COALESCE(p.attack_blocked, false)
      WHERE v.session_id = v_s.id AND v.participant_id = x);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '지원하지 않았거나 공격이 막힌 학생이 포함되어 있습니다' USING ERRCODE = 'P0213';
  END IF;

  UPDATE public.raid_clash_sessions SET teacher_pick = v_ids, updated_at = now() WHERE id = v_s.id;
  PERFORM public.raid_clash_advance(p_raid_id);
  RETURN public.teacher_get_raid_clash_pick_state(p_raid_id);
END;
$function$;

-- 7) teacher: switch selection mode (any time before the raid ends)
CREATE OR REPLACE FUNCTION public.teacher_set_raid_clash_selection_mode(p_raid_id bigint, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_status text; v_mode text := upper(btrim(COALESCE(p_mode, '')));
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  IF v_mode NOT IN ('RANDOM','TEACHER') THEN
    RAISE EXCEPTION '선택 방식은 RANDOM 또는 TEACHER입니다' USING ERRCODE = 'P0213';
  END IF;
  SELECT status INTO v_status FROM public.raids WHERE id = p_raid_id;
  IF v_status IN ('COMPLETED','FAILED','ARCHIVED') THEN
    RAISE EXCEPTION '끝난 레이드는 바꿀 수 없습니다' USING ERRCODE = 'P0215';
  END IF;
  UPDATE public.raid_clash_configs SET selection_mode = v_mode, updated_by = auth.uid(), updated_at = now() WHERE raid_id = p_raid_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '격돌 설정을 먼저 저장해 주세요' USING ERRCODE = 'P0215';
  END IF;
  RETURN public.teacher_get_raid_clash_pick_state(p_raid_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_get_raid_clash_pick_state(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_pick_raid_clash_players(bigint,bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_raid_clash_selection_mode(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_clash_pick_state(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_pick_raid_clash_players(bigint,bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_raid_clash_selection_mode(bigint,text) TO authenticated;

-- 8) sanity
DO $sanity$
BEGIN
  IF strpos(pg_get_functiondef('public.raid_clash_advance(bigint)'::regprocedure), '/*CLASH_V4*/') = 0
     OR strpos(pg_get_functiondef('public.teacher_get_raid_clash_config(bigint)'::regprocedure), '/*CLASH_V4:get*/') = 0 THEN
    RAISE EXCEPTION 'CLASH_V4 sanity: markers missing';
  END IF;
  IF strpos(pg_get_functiondef('public.raid_clash_public_state(bigint,bigint)'::regprocedure), 'selection_mode') > 0
     OR strpos(pg_get_functiondef('public.raid_clash_public_state(bigint,bigint)'::regprocedure), 'teacher_pick') > 0 THEN
    RAISE EXCEPTION 'CLASH_V4 sanity: public state must not expose the selection mode';
  END IF;
  IF has_function_privilege('anon', 'public.teacher_pick_raid_clash_players(bigint,bigint[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.raid_clash_v4_draw_ready(bigint,timestamptz)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.teacher_get_raid_clash_pick_state(bigint)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CLASH_V4 sanity: privileges';
  END IF;
END
$sanity$;

SELECT 'CLASH V4 applied' AS result;
