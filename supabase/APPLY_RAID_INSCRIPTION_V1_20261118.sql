-- B.R.A.N.D 2.0 — Raid 패턴 「주문 각인」(INSCRIPTION) + 실패 상태 「타락」(CORRUPTION) V1 (2026-11-18)
-- INSCRIPTION_V1_20261118
--
-- 무엇을 하나
--   · 보스 체력이 정한 지점에 닿거나 선생님이 버튼을 누르면 「주문 각인」이 시작된다.
--   · 지원(5초+2초) → 각인자 선발(무작위 / 선생님 선택, 학생에게 비공개) → 발표·준비 → 입력(제한 시간)
--   · 각인자 전원이 시간 안에 글자 배열 하나를 완성하면 성공: 보스 피해 + 공명방벽 회복
--   · 한 명이라도 못 끝내면 실패: 각인자 중 무작위 N명이 D초 동안 「타락」(공격하면 그만큼 보스가 회복)
--   · 진행 중에는 격돌처럼 전투가 멈추고, 멈춘 시간은 레이드 시간·보스 공격 시각·타락 시간에 돌려준다.
--
-- 기존 기능과의 관계
--   · 격돌 테이블/함수는 그대로 두고, 아래 함수에 표식(marker)만 붙여 연결한다.
--       submit_raid_tap_batch   /*INSCRIPTION:vars*/ /*INSCRIPTION:frozen*/ /*INSCRIPTION:corrupted_flag*/
--                               /*INSCRIPTION:corruption*/ /*INSCRIPTION:after_batch*/
--       raid_combat_tick        /*INSCRIPTION:tick*/
--       raid_clash_is_frozen    /*INSCRIPTION:frozen_check*/  (패턴 진행·일시정지 금지에 같이 쓰임)
--       raid_clash_shift_timeline /*INSCRIPTION:shift*/       (타락 종료 시각도 함께 밀기)
--       raid_clash_begin        /*INSCRIPTION:clash_guard*/   (각인 중에는 격돌 시작 안 함)
--       get_raid_battle_state   /*INSCRIPTION:state*/
--       teacher_get_raid_broadcast_state /*INSCRIPTION:broadcast*/
--   · 설정을 켜지 않은 레이드에는 아무 변화가 없다.
-- 두 번 실행해도 안전. 격돌이 진행 중이면 적용을 거부한다.

DO $guard$
BEGIN
  IF to_regprocedure('public.raid_clash_begin(bigint)') IS NULL
     OR to_regprocedure('public.raid_clash_is_frozen(bigint)') IS NULL
     OR to_regprocedure('public.raid_clash_shift_timeline(bigint,interval)') IS NULL
     OR to_regprocedure('public.raid_clash_attack_context(bigint)') IS NULL
     OR to_regprocedure('public.raid_combat_tick(bigint)') IS NULL
     OR to_regprocedure('public.raid_teacher_require_raid(bigint)') IS NULL
     OR to_regprocedure('public.raid_current_student_for_raid(bigint)') IS NULL THEN
    RAISE EXCEPTION 'CLASH V1~V4가 먼저 적용되어 있어야 합니다.';
  END IF;
  IF to_regprocedure('brand_backup.replace_once(regprocedure,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'brand_backup.replace_once not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE phase IN ('VOLUNTEERING','SELECTED','PLAYING')) THEN
    RAISE EXCEPTION '격돌이 진행 중입니다. 격돌이 끝난 뒤 다시 실행해 주세요.';
  END IF;
END
$guard$;

-- 0) backup of every function this migration patches (once)
INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5, captured_at)
SELECT 'PRE_INSCRIPTION_V1_20261118', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid)), now()
  FROM pg_proc p
 WHERE p.oid IN ('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
                 'public.raid_combat_tick(bigint)'::regprocedure,
                 'public.raid_clash_is_frozen(bigint)'::regprocedure,
                 'public.raid_clash_shift_timeline(bigint,interval)'::regprocedure,
                 'public.raid_clash_begin(bigint)'::regprocedure,
                 'public.get_raid_battle_state(bigint)'::regprocedure,
                 'public.teacher_get_raid_broadcast_state(bigint)'::regprocedure)
   AND NOT EXISTS (SELECT 1 FROM brand_backup.function_snapshots s
                    WHERE s.snapshot_label = 'PRE_INSCRIPTION_V1_20261118' AND s.signature = p.oid::regprocedure::text);

-- 1) tables ----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raid_inscription_configs (
  raid_id bigint PRIMARY KEY REFERENCES public.raids(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  difficulty text NOT NULL DEFAULT 'EASY' CHECK (difficulty IN ('EASY','NORMAL','HARD','CUSTOM')),
  letter_count smallint NOT NULL DEFAULT 8 CHECK (letter_count BETWEEN 8 AND 16),
  use_gh boolean NOT NULL DEFAULT false,
  time_limit_ms integer NOT NULL DEFAULT 20000 CHECK (time_limit_ms BETWEEN 10000 AND 60000),
  player_count smallint NOT NULL DEFAULT 8 CHECK (player_count BETWEEN 1 AND 12),
  auto_trigger_ratios numeric[] NOT NULL DEFAULT ARRAY[]::numeric[],
  boss_damage_ratio numeric NOT NULL DEFAULT 0.03 CHECK (boss_damage_ratio >= 0 AND boss_damage_ratio <= 0.15),
  barrier_heal_ratio numeric NOT NULL DEFAULT 0.15 CHECK (barrier_heal_ratio >= 0 AND barrier_heal_ratio <= 0.5),
  corruption_count smallint NOT NULL DEFAULT 2 CHECK (corruption_count BETWEEN 1 AND 12),
  corruption_seconds smallint NOT NULL DEFAULT 10 CHECK (corruption_seconds BETWEEN 5 AND 30),
  corruption_label text NOT NULL DEFAULT '타락' CHECK (char_length(btrim(corruption_label)) BETWEEN 1 AND 6),
  selection_mode text NOT NULL DEFAULT 'RANDOM' CHECK (selection_mode IN ('RANDOM','TEACHER')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.raid_inscription_sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raid_id bigint NOT NULL REFERENCES public.raids(id) ON DELETE CASCADE,
  seq_no integer NOT NULL,
  phase text NOT NULL CHECK (phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING','RESOLVED','CANCELLED')),
  trigger_source text NOT NULL CHECK (trigger_source IN ('AUTO','TEACHER')),
  trigger_ratio numeric,
  config jsonb NOT NULL,
  first_sequence text NOT NULL,
  triggered_at timestamptz,
  volunteer_closes_at timestamptz,
  volunteer_accept_until timestamptz,
  draw_at timestamptz,
  teacher_pick bigint[],
  selected_at timestamptz,
  play_starts_at timestamptz,
  play_deadline_at timestamptz,
  outcome text CHECK (outcome IS NULL OR outcome IN ('SUCCESS','FAILED')),
  outcome_reason text,
  resolved_at timestamptz,
  resume_at timestamptz,
  frozen_seconds numeric,
  boss_damage bigint NOT NULL DEFAULT 0,
  boss_damage_capped boolean NOT NULL DEFAULT false,
  barrier_heal bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raid_id, seq_no)
);
CREATE UNIQUE INDEX IF NOT EXISTS raid_inscription_sessions_one_open
  ON public.raid_inscription_sessions(raid_id) WHERE phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING');

CREATE TABLE IF NOT EXISTS public.raid_inscription_entries (
  session_id bigint NOT NULL REFERENCES public.raid_inscription_sessions(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES public.raid_participants(id) ON DELETE CASCADE,
  volunteered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  slot smallint,
  sequences text[],
  attempt_index integer NOT NULL DEFAULT 0,
  typed_count integer NOT NULL DEFAULT 0,
  mistakes integer NOT NULL DEFAULT 0,
  completed_at timestamptz,
  completed_ms integer,
  corrupted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS public.raid_corruptions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  raid_id bigint NOT NULL REFERENCES public.raids(id) ON DELETE CASCADE,
  session_id bigint NOT NULL REFERENCES public.raid_inscription_sessions(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES public.raid_participants(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  until timestamptz NOT NULL,
  healed_amount bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS raid_corruptions_lookup ON public.raid_corruptions(raid_id, participant_id, until);

ALTER TABLE public.raid_inscription_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_inscription_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_inscription_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_corruptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.raid_inscription_configs, public.raid_inscription_sessions,
                   public.raid_inscription_entries, public.raid_corruptions FROM PUBLIC, anon, authenticated;

-- 2) small helpers (internal) ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raid_inscription_profile(p_difficulty text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'version', 1,
    'volunteer_ms', 5000, 'volunteer_grace_ms', 2000, 'volunteer_button_delay_ms', 1000,
    'random_draw_min_ms', 4000, 'random_draw_max_ms', 8000, 'pick_timeout_ms', 30000,
    'reveal_ms', 2600, 'countdown_ms', 3000, 'result_ms', 3000,
    'latency_slack_ms', 1500, 'min_ms_per_letter', 120, 'miss_lock_ms', 400, 'sequence_pool', 40
  ) || CASE upper(COALESCE(p_difficulty, 'EASY'))
    WHEN 'HARD' THEN jsonb_build_object('difficulty','HARD','letter_count',12,'use_gh',true,'time_limit_ms',26000,
                     'boss_damage_ratio',0.06,'barrier_heal_ratio',0.30,'corruption_count',3,'corruption_seconds',15)
    WHEN 'NORMAL' THEN jsonb_build_object('difficulty','NORMAL','letter_count',10,'use_gh',false,'time_limit_ms',22000,
                     'boss_damage_ratio',0.04,'barrier_heal_ratio',0.20,'corruption_count',3,'corruption_seconds',12)
    ELSE jsonb_build_object('difficulty','EASY','letter_count',8,'use_gh',false,'time_limit_ms',20000,
                     'boss_damage_ratio',0.03,'barrier_heal_ratio',0.15,'corruption_count',2,'corruption_seconds',10)
  END;
$function$;

-- the snapshot a session keeps (no selection mode, no trigger list: nothing a student must not see)
CREATE OR REPLACE FUNCTION public.raid_inscription_effective_config(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cfg public.raid_inscription_configs%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;
  IF NOT FOUND THEN
    RETURN public.raid_inscription_profile('EASY') || jsonb_build_object('player_count', 8, 'corruption_label', '타락');
  END IF;
  RETURN public.raid_inscription_profile(CASE WHEN v_cfg.difficulty = 'CUSTOM' THEN 'EASY' ELSE v_cfg.difficulty END)
      || jsonb_build_object(
           'difficulty', v_cfg.difficulty,
           'letter_count', v_cfg.letter_count, 'use_gh', v_cfg.use_gh, 'time_limit_ms', v_cfg.time_limit_ms,
           'player_count', v_cfg.player_count,
           'boss_damage_ratio', v_cfg.boss_damage_ratio, 'barrier_heal_ratio', v_cfg.barrier_heal_ratio,
           'corruption_count', v_cfg.corruption_count, 'corruption_seconds', v_cfg.corruption_seconds,
           'corruption_label', v_cfg.corruption_label);
END;
$function$;

-- random letters from the keyboard's middle row, never the same letter 3 times in a row
CREATE OR REPLACE FUNCTION public.raid_inscription_make_sequence(p_len integer, p_use_gh boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_keys text := CASE WHEN p_use_gh THEN 'ASDFGHJKL' ELSE 'ASDFJKL' END;
  v_out text := ''; v_c text; i integer; v_len integer := GREATEST(1, LEAST(32, COALESCE(p_len, 8)));
BEGIN
  FOR i IN 1..v_len LOOP
    LOOP
      v_c := substr(v_keys, 1 + floor(random() * length(v_keys))::integer, 1);
      EXIT WHEN length(v_out) < 2 OR NOT (right(v_out, 1) = v_c AND substr(v_out, length(v_out) - 1, 1) = v_c);
    END LOOP;
    v_out := v_out || v_c;
  END LOOP;
  RETURN v_out;
END;
$function$;

-- true while the battle is stopped by an inscription (including the 3-second result screen)
CREATE OR REPLACE FUNCTION public.raid_inscription_is_active(p_raid_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.raid_inscription_sessions s
     WHERE s.raid_id = p_raid_id
       AND (s.phase IN ('VOLUNTEERING','SELECTED','PLAYING')
            OR (s.phase IN ('RESOLVED','CANCELLED') AND s.resume_at IS NOT NULL AND s.resume_at > clock_timestamp())));
$function$;

CREATE OR REPLACE FUNCTION public.raid_corruption_active(p_raid_id bigint, p_participant_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.raid_corruptions c
     WHERE c.raid_id = p_raid_id AND c.participant_id = p_participant_id
       AND c.starts_at <= clock_timestamp() AND c.until > clock_timestamp());
$function$;

-- clash's own frozen check (raid_clash_is_frozen also answers for inscriptions after the patch below)
CREATE OR REPLACE FUNCTION public.raid_inscription_clash_busy(p_raid_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.raid_clash_sessions s
                  WHERE s.raid_id = p_raid_id AND s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'));
$function$;

-- 3) state machine (internal; callers hold advisory lock 77116 for the raid) --------------------
CREATE OR REPLACE FUNCTION public.raid_inscription_open_volunteering(p_session_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_inscription_sessions%ROWTYPE; v_now timestamptz := clock_timestamp(); v_cfg jsonb;
        v_accept timestamptz; v_raid public.raids%ROWTYPE; v_draw_ms numeric;
BEGIN
  SELECT * INTO v_s FROM public.raid_inscription_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'PENDING' THEN RETURN; END IF;
  v_cfg := v_s.config;
  v_accept := v_now + make_interval(secs => (((v_cfg->>'volunteer_ms')::numeric + (v_cfg->>'volunteer_grace_ms')::numeric) / 1000.0)::double precision);
  v_draw_ms := (v_cfg->>'random_draw_min_ms')::numeric
             + floor(random() * ((v_cfg->>'random_draw_max_ms')::numeric - (v_cfg->>'random_draw_min_ms')::numeric + 1));
  UPDATE public.raid_inscription_sessions
     SET phase = 'VOLUNTEERING',
         triggered_at = v_now,
         volunteer_closes_at = v_now + make_interval(secs => ((v_cfg->>'volunteer_ms')::numeric / 1000.0)::double precision),
         volunteer_accept_until = v_accept,
         draw_at = v_accept + make_interval(secs => (v_draw_ms / 1000.0)::double precision),
         updated_at = now()
   WHERE id = v_s.id;
  SELECT * INTO v_raid FROM public.raids WHERE id = v_s.raid_id;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'INSCRIPTION_STARTED', 0, jsonb_build_object(
    'inscription_session_id', v_s.id, 'seq_no', v_s.seq_no, 'trigger_source', v_s.trigger_source,
    'trigger_ratio', v_s.trigger_ratio, 'boss_hp', v_raid.current_hp, 'boss_max_hp', v_raid.max_hp));
END;
$function$;

CREATE OR REPLACE FUNCTION public.raid_inscription_begin(p_raid_id bigint, p_source text, p_ratio numeric)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cfg public.raid_inscription_configs%ROWTYPE; v_raid public.raids%ROWTYPE; v_conf jsonb; v_seq integer; v_id bigint;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_inscription_configs WHERE raid_id = p_raid_id AND enabled = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  IF NOT FOUND OR v_raid.status <> 'ACTIVE' OR v_raid.current_hp <= 0 THEN RETURN NULL; END IF;
  IF public.raid_inscription_is_active(p_raid_id)
     OR EXISTS (SELECT 1 FROM public.raid_inscription_sessions
                 WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')) THEN
    RETURN NULL;
  END IF;
  v_conf := public.raid_inscription_effective_config(p_raid_id);
  SELECT COALESCE(max(seq_no), 0) + 1 INTO v_seq FROM public.raid_inscription_sessions WHERE raid_id = p_raid_id;
  INSERT INTO public.raid_inscription_sessions(raid_id, seq_no, phase, trigger_source, trigger_ratio, config, first_sequence)
  VALUES (p_raid_id, v_seq, 'PENDING', CASE WHEN p_source = 'AUTO' THEN 'AUTO' ELSE 'TEACHER' END, p_ratio, v_conf,
          public.raid_inscription_make_sequence((v_conf->>'letter_count')::integer, (v_conf->>'use_gh')::boolean))
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF public.raid_inscription_clash_busy(p_raid_id) THEN
    -- a clash is running: wait for it, raid_inscription_advance opens the volunteering afterwards
    INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
    VALUES (p_raid_id, 'INSCRIPTION_PENDING', 0, jsonb_build_object('inscription_session_id', v_id, 'seq_no', v_seq));
  ELSE
    PERFORM public.raid_inscription_open_volunteering(v_id);
  END IF;
  RETURN v_id;
END;
$function$;

-- fire the highest automatic trigger point the boss HP has reached and that has not fired yet
CREATE OR REPLACE FUNCTION public.raid_inscription_check_auto(p_raid_id bigint)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_cfg public.raid_inscription_configs%ROWTYPE; v_raid public.raids%ROWTYPE; v_ratio numeric; v_hit numeric;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_inscription_configs WHERE raid_id = p_raid_id AND enabled = true;
  IF NOT FOUND OR cardinality(v_cfg.auto_trigger_ratios) = 0 THEN RETURN NULL; END IF;
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  IF NOT FOUND OR v_raid.status <> 'ACTIVE' OR v_raid.max_hp <= 0 OR v_raid.current_hp <= 0 THEN RETURN NULL; END IF;
  v_ratio := v_raid.current_hp::numeric / v_raid.max_hp::numeric;
  SELECT r INTO v_hit
    FROM unnest(v_cfg.auto_trigger_ratios) r
   WHERE v_ratio <= r
     AND NOT EXISTS (SELECT 1 FROM public.raid_inscription_sessions s
                      WHERE s.raid_id = p_raid_id AND s.trigger_source = 'AUTO' AND s.trigger_ratio = r)
   ORDER BY r DESC
   LIMIT 1;
  IF v_hit IS NULL THEN RETURN NULL; END IF;
  RETURN public.raid_inscription_begin(p_raid_id, 'AUTO', v_hit);
END;
$function$;

-- shared by resolve and cancel: give back the stopped time
CREATE OR REPLACE FUNCTION public.raid_inscription_return_time(p_raid_id bigint, p_since timestamptz, p_freeze interval)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF p_freeze IS NULL OR p_freeze <= interval '0 seconds' THEN RETURN; END IF;
  -- raid end time, pattern timers, boss attack and groggy (+ active corruptions, patched below)
  PERFORM public.raid_clash_shift_timeline(p_raid_id, p_freeze);
  -- a clash success buff that was running when the inscription began keeps its remaining seconds
  UPDATE public.raid_clash_sessions
     SET buff_until = buff_until + p_freeze,
         boss_attack_block_until = CASE WHEN boss_attack_block_until IS NULL THEN NULL ELSE boss_attack_block_until + p_freeze END,
         updated_at = now()
   WHERE raid_id = p_raid_id AND phase = 'RESOLVED' AND buff_until IS NOT NULL AND buff_until > p_since;
END;
$function$;

CREATE OR REPLACE FUNCTION public.raid_inscription_resolve(p_session_id bigint, p_outcome text, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_s public.raid_inscription_sessions%ROWTYPE; v_raid public.raids%ROWTYPE; v_cfg jsonb;
  v_now timestamptz := clock_timestamp(); v_resume timestamptz; v_freeze interval := interval '0 seconds';
  v_dmg bigint := 0; v_capped boolean := false; v_heal bigint := 0; v_n integer; v_per bigint; v_rem bigint;
  v_bar_cur bigint; v_bar_max bigint; v_victims jsonb := '[]'::jsonb; v_selected integer; v_done integer;
BEGIN
  SELECT * INTO v_s FROM public.raid_inscription_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase NOT IN ('VOLUNTEERING','SELECTED','PLAYING') THEN RETURN; END IF;
  v_cfg := v_s.config;
  v_resume := v_now + make_interval(secs => ((v_cfg->>'result_ms')::numeric / 1000.0)::double precision);
  IF v_s.triggered_at IS NOT NULL THEN v_freeze := v_resume - v_s.triggered_at; END IF;
  SELECT * INTO v_raid FROM public.raids WHERE id = v_s.raid_id FOR UPDATE;
  SELECT count(*) FILTER (WHERE slot IS NOT NULL), count(*) FILTER (WHERE slot IS NOT NULL AND completed_at IS NOT NULL)
    INTO v_selected, v_done FROM public.raid_inscription_entries WHERE session_id = v_s.id;

  IF p_outcome = 'SUCCESS' THEN
    v_dmg := LEAST(GREATEST(v_raid.current_hp - 1, 0),
                   GREATEST(0, ROUND(v_raid.max_hp::numeric * (v_cfg->>'boss_damage_ratio')::numeric))::bigint);
    -- keep the CLASH 50% trigger reachable: it fires only from an attack that crosses the line
    IF COALESCE((public.raid_clash_attack_context(v_s.raid_id)->>'armed')::boolean, false)
       AND v_raid.current_hp * 2 > v_raid.max_hp
       AND (v_raid.current_hp - v_dmg) * 2 <= v_raid.max_hp THEN
      v_dmg := GREATEST(0, v_raid.current_hp - (v_raid.max_hp / 2 + 1));
      v_capped := true;
    END IF;
    IF v_dmg > 0 THEN
      UPDATE public.raids SET current_hp = current_hp - v_dmg, updated_at = now() WHERE id = v_s.raid_id;
      v_n := v_selected;
      IF v_n > 0 THEN
        v_per := v_dmg / v_n; v_rem := v_dmg - v_per * v_n;
        UPDATE public.raid_participants p
           SET total_damage = p.total_damage + v_per + CASE WHEN e.slot <= v_rem THEN 1 ELSE 0 END,
               updated_at = now()
          FROM public.raid_inscription_entries e
         WHERE e.session_id = v_s.id AND e.slot IS NOT NULL AND p.id = e.participant_id;
      END IF;
    END IF;
    SELECT barrier_current_hp, barrier_max_hp INTO v_bar_cur, v_bar_max
      FROM public.raid_combat_states WHERE raid_id = v_s.raid_id FOR UPDATE;
    IF FOUND AND v_bar_cur > 0 AND v_bar_max > 0 THEN
      v_heal := LEAST(v_bar_max - v_bar_cur, GREATEST(0, ROUND(v_bar_max::numeric * (v_cfg->>'barrier_heal_ratio')::numeric))::bigint);
      IF v_heal > 0 THEN
        UPDATE public.raid_combat_states SET barrier_current_hp = barrier_current_hp + v_heal, updated_at = now()
         WHERE raid_id = v_s.raid_id;
      END IF;
    END IF;
  END IF;

  -- stopped time goes back first, so the new corruptions below are not pushed a second time
  PERFORM public.raid_inscription_return_time(v_s.raid_id, v_s.triggered_at, v_freeze);

  IF p_outcome = 'FAILED' THEN
    IF v_selected > 0 THEN
      INSERT INTO public.raid_corruptions(raid_id, session_id, participant_id, starts_at, until)
      SELECT v_s.raid_id, v_s.id, x.participant_id, v_resume,
             v_resume + make_interval(secs => (v_cfg->>'corruption_seconds')::double precision)
        FROM (SELECT e.participant_id FROM public.raid_inscription_entries e
               WHERE e.session_id = v_s.id AND e.slot IS NOT NULL
               ORDER BY random() LIMIT (v_cfg->>'corruption_count')::integer) x;
    ELSE
      -- nobody volunteered: the corruption falls on anyone in the raid
      INSERT INTO public.raid_corruptions(raid_id, session_id, participant_id, starts_at, until)
      SELECT v_s.raid_id, v_s.id, x.id, v_resume,
             v_resume + make_interval(secs => (v_cfg->>'corruption_seconds')::double precision)
        FROM (SELECT p.id FROM public.raid_participants p
               WHERE p.raid_id = v_s.raid_id AND NOT COALESCE(p.attack_blocked, false)
               ORDER BY random() LIMIT (v_cfg->>'corruption_count')::integer) x;
    END IF;
    UPDATE public.raid_inscription_entries e SET corrupted = true
     WHERE e.session_id = v_s.id
       AND EXISTS (SELECT 1 FROM public.raid_corruptions c WHERE c.session_id = v_s.id AND c.participant_id = e.participant_id);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('participant_id', p.id, 'student_name', p.snapshot_student_name,
                                                 'guild_name', p.snapshot_guild_name) ORDER BY c.id), '[]'::jsonb)
      INTO v_victims
      FROM public.raid_corruptions c JOIN public.raid_participants p ON p.id = c.participant_id
     WHERE c.session_id = v_s.id;
  END IF;

  UPDATE public.raid_inscription_sessions
     SET phase = 'RESOLVED', outcome = p_outcome, outcome_reason = p_reason,
         resolved_at = v_now, resume_at = v_resume,
         frozen_seconds = EXTRACT(EPOCH FROM v_freeze),
         boss_damage = v_dmg, boss_damage_capped = v_capped, barrier_heal = v_heal, updated_at = now()
   WHERE id = v_s.id;

  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'INSCRIPTION_RESOLVED', v_dmg, jsonb_build_object(
    'inscription_session_id', v_s.id, 'seq_no', v_s.seq_no, 'outcome', p_outcome, 'reason', p_reason,
    'selected_count', v_selected, 'completed_count', v_done,
    'boss_damage', v_dmg, 'boss_damage_capped', v_capped, 'barrier_heal', v_heal,
    'corrupted', v_victims, 'corruption_seconds', (v_cfg->>'corruption_seconds')::integer,
    'frozen_seconds', EXTRACT(EPOCH FROM v_freeze)));
END;
$function$;

CREATE OR REPLACE FUNCTION public.raid_inscription_draw(p_session_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_inscription_sessions%ROWTYPE; v_cfg jsonb; v_mode text; v_pick bigint[]; v_planned integer;
        v_count integer; v_now timestamptz := clock_timestamp(); v_start timestamptz; v_players jsonb;
BEGIN
  SELECT * INTO v_s FROM public.raid_inscription_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'VOLUNTEERING' THEN RETURN; END IF;
  v_cfg := v_s.config;
  SELECT selection_mode INTO v_mode FROM public.raid_inscription_configs WHERE raid_id = v_s.raid_id;
  v_pick := CASE WHEN COALESCE(v_mode, 'RANDOM') = 'TEACHER' THEN v_s.teacher_pick ELSE NULL END;
  v_planned := GREATEST(1, LEAST(12, COALESCE((v_cfg->>'player_count')::integer, 8)));

  WITH cand AS (
    SELECT e.participant_id,
           COALESCE(array_position(v_pick, e.participant_id), 100000) AS ord,
           random() AS rnd
      FROM public.raid_inscription_entries e
      JOIN public.raid_participants p ON p.id = e.participant_id
     WHERE e.session_id = v_s.id AND NOT COALESCE(p.attack_blocked, false)
  ), ranked AS (
    SELECT participant_id, row_number() OVER (ORDER BY ord, rnd) AS rn FROM cand
  )
  UPDATE public.raid_inscription_entries e
     SET slot = r.rn,
         sequences = ARRAY[v_s.first_sequence]
                     || ARRAY(SELECT public.raid_inscription_make_sequence((v_cfg->>'letter_count')::integer, (v_cfg->>'use_gh')::boolean)
                                FROM generate_series(2, (v_cfg->>'sequence_pool')::integer) g
                               WHERE e.participant_id IS NOT NULL)
    FROM ranked r
   WHERE e.session_id = v_s.id AND e.participant_id = r.participant_id AND r.rn <= v_planned;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    PERFORM public.raid_inscription_resolve(v_s.id, 'FAILED', 'NO_VOLUNTEERS');
    RETURN;
  END IF;

  v_start := v_now + make_interval(secs => (((v_cfg->>'reveal_ms')::numeric + (v_cfg->>'countdown_ms')::numeric) / 1000.0)::double precision);
  UPDATE public.raid_inscription_sessions
     SET phase = 'SELECTED', selected_at = v_now, play_starts_at = v_start,
         play_deadline_at = v_start + make_interval(secs => ((v_cfg->>'time_limit_ms')::numeric / 1000.0)::double precision),
         updated_at = now()
   WHERE id = v_s.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('participant_id', p.id, 'student_name', p.snapshot_student_name) ORDER BY e.slot), '[]'::jsonb)
    INTO v_players
    FROM public.raid_inscription_entries e JOIN public.raid_participants p ON p.id = e.participant_id
   WHERE e.session_id = v_s.id AND e.slot IS NOT NULL;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'INSCRIPTION_SELECTED', 0, jsonb_build_object('inscription_session_id', v_s.id, 'seq_no', v_s.seq_no, 'players', v_players));
END;
$function$;

-- moves the open inscription forward by the clock; returns {frozen, phase}
CREATE OR REPLACE FUNCTION public.raid_inscription_advance(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_inscription_sessions%ROWTYPE; v_status text; v_now timestamptz; v_mode text; v_ready boolean;
        v_total integer; v_done integer; v_step integer := 0; v_cfg jsonb; v_phase text;
BEGIN
  LOOP
    v_step := v_step + 1;
    EXIT WHEN v_step > 8;
    v_now := clock_timestamp();
    SELECT * INTO v_s FROM public.raid_inscription_sessions
     WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')
     ORDER BY id DESC LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;
    SELECT status INTO v_status FROM public.raids WHERE id = p_raid_id;
    IF v_status IS NULL OR v_status NOT IN ('ACTIVE','PAUSED') THEN
      UPDATE public.raid_inscription_sessions
         SET phase = 'CANCELLED', outcome_reason = 'RAID_ENDED', resolved_at = v_now, resume_at = v_now, updated_at = now()
       WHERE id = v_s.id;
      CONTINUE;
    END IF;
    EXIT WHEN v_status = 'PAUSED';
    v_cfg := v_s.config;

    IF v_s.phase = 'PENDING' THEN
      EXIT WHEN public.raid_inscription_clash_busy(p_raid_id);
      PERFORM public.raid_inscription_open_volunteering(v_s.id);
    ELSIF v_s.phase = 'VOLUNTEERING' THEN
      SELECT selection_mode INTO v_mode FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;
      IF COALESCE(v_mode, 'RANDOM') = 'TEACHER' THEN
        v_ready := v_now >= v_s.volunteer_accept_until
                   AND (v_s.teacher_pick IS NOT NULL
                        OR v_now >= v_s.volunteer_accept_until + make_interval(secs => ((v_cfg->>'pick_timeout_ms')::numeric / 1000.0)::double precision));
      ELSE
        v_ready := v_now >= v_s.draw_at;
      END IF;
      EXIT WHEN NOT v_ready;
      PERFORM public.raid_inscription_draw(v_s.id);
    ELSIF v_s.phase = 'SELECTED' THEN
      EXIT WHEN v_now < v_s.play_starts_at;
      UPDATE public.raid_inscription_sessions SET phase = 'PLAYING', updated_at = now() WHERE id = v_s.id;
    ELSE
      SELECT count(*) FILTER (WHERE slot IS NOT NULL), count(*) FILTER (WHERE slot IS NOT NULL AND completed_at IS NOT NULL)
        INTO v_total, v_done FROM public.raid_inscription_entries WHERE session_id = v_s.id;
      IF v_total > 0 AND v_done >= v_total THEN
        PERFORM public.raid_inscription_resolve(v_s.id, 'SUCCESS', 'ALL_COMPLETED');
      ELSIF v_now > v_s.play_deadline_at + make_interval(secs => ((v_cfg->>'latency_slack_ms')::numeric / 1000.0)::double precision) THEN
        PERFORM public.raid_inscription_resolve(v_s.id, 'FAILED', 'TIME_UP');
      ELSE
        EXIT;
      END IF;
    END IF;
  END LOOP;
  SELECT phase INTO v_phase FROM public.raid_inscription_sessions WHERE raid_id = p_raid_id ORDER BY id DESC LIMIT 1;
  RETURN jsonb_build_object('frozen', public.raid_inscription_is_active(p_raid_id), 'phase', v_phase);
END;
$function$;

-- 4) what screens see (internal; embedded into the existing state RPCs) ------------------------
-- never contains the selection mode, the teacher's pick or anyone else's letters
CREATE OR REPLACE FUNCTION public.raid_inscription_public_state(p_raid_id bigint, p_participant_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_inscription_sessions%ROWTYPE; v_now timestamptz := clock_timestamp(); v_cfg jsonb;
        v_players jsonb := '[]'::jsonb; v_me jsonb := NULL; v_vol integer := 0; v_e public.raid_inscription_entries%ROWTYPE;
        v_victims jsonb := '[]'::jsonb; v_len integer;
BEGIN
  SELECT * INTO v_s FROM public.raid_inscription_sessions WHERE raid_id = p_raid_id ORDER BY id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_s.phase IN ('RESOLVED','CANCELLED') AND v_s.resolved_at < v_now - interval '20 seconds' THEN RETURN NULL; END IF;
  v_cfg := v_s.config;
  v_len := (v_cfg->>'letter_count')::integer;

  IF v_s.phase = 'CANCELLED' THEN
    RETURN jsonb_build_object('id', v_s.id, 'seq_no', v_s.seq_no, 'phase', 'CANCELLED', 'server_now', v_now,
                              'resume_at', v_s.resume_at, 'frozen', public.raid_inscription_is_active(p_raid_id));
  END IF;

  SELECT count(*) INTO v_vol FROM public.raid_inscription_entries WHERE session_id = v_s.id;

  IF v_s.phase IN ('SELECTED','PLAYING','RESOLVED') THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'participant_id', e.participant_id, 'slot', e.slot,
             'student_name', p.snapshot_student_name, 'guild_name', p.snapshot_guild_name,
             'typed_count', CASE WHEN e.completed_at IS NOT NULL THEN v_len ELSE e.typed_count END,
             'mistakes', e.mistakes, 'completed', e.completed_at IS NOT NULL, 'completed_ms', e.completed_ms,
             'corrupted', e.corrupted) ORDER BY e.slot), '[]'::jsonb)
      INTO v_players
      FROM public.raid_inscription_entries e JOIN public.raid_participants p ON p.id = e.participant_id
     WHERE e.session_id = v_s.id AND e.slot IS NOT NULL;
  END IF;

  IF p_participant_id IS NOT NULL THEN
    SELECT * INTO v_e FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = p_participant_id;
    IF FOUND THEN
      v_me := jsonb_build_object(
        'volunteered', true, 'selected', v_e.slot IS NOT NULL, 'slot', v_e.slot,
        'attempt_index', v_e.attempt_index, 'typed_count', v_e.typed_count, 'mistakes', v_e.mistakes,
        'completed', v_e.completed_at IS NOT NULL, 'completed_ms', v_e.completed_ms, 'corrupted', v_e.corrupted,
        'sequences', CASE WHEN v_e.slot IS NOT NULL AND v_s.phase = 'PLAYING' AND v_e.completed_at IS NULL
                          THEN to_jsonb(v_e.sequences) ELSE NULL END);
    ELSE
      v_me := jsonb_build_object('volunteered', false, 'selected', false);
    END IF;
  END IF;

  IF v_s.phase = 'RESOLVED' AND v_s.outcome = 'FAILED' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('participant_id', p.id, 'student_name', p.snapshot_student_name,
                                                 'guild_name', p.snapshot_guild_name) ORDER BY c.id), '[]'::jsonb)
      INTO v_victims
      FROM public.raid_corruptions c JOIN public.raid_participants p ON p.id = c.participant_id
     WHERE c.session_id = v_s.id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_s.id, 'seq_no', v_s.seq_no, 'phase', v_s.phase, 'server_now', v_now,
    'frozen', public.raid_inscription_is_active(p_raid_id),
    'triggered_at', v_s.triggered_at,
    'volunteer_closes_at', v_s.volunteer_closes_at, 'volunteer_accept_until', v_s.volunteer_accept_until,
    'volunteer_button_delay_ms', (v_cfg->>'volunteer_button_delay_ms')::integer,
    'selected_at', v_s.selected_at, 'play_starts_at', v_s.play_starts_at, 'play_deadline_at', v_s.play_deadline_at,
    'reveal_ms', (v_cfg->>'reveal_ms')::integer, 'countdown_ms', (v_cfg->>'countdown_ms')::integer,
    'miss_lock_ms', (v_cfg->>'miss_lock_ms')::integer,
    'resolved_at', v_s.resolved_at, 'resume_at', v_s.resume_at,
    'difficulty', v_cfg->>'difficulty', 'letter_count', v_len, 'use_gh', (v_cfg->>'use_gh')::boolean,
    'time_limit_ms', (v_cfg->>'time_limit_ms')::integer,
    'planned_player_count', (v_cfg->>'player_count')::integer,
    'corruption_label', v_cfg->>'corruption_label', 'corruption_seconds', (v_cfg->>'corruption_seconds')::integer,
    'volunteer_count', v_vol,
    'first_sequence', CASE WHEN v_s.phase IN ('PLAYING','RESOLVED') THEN v_s.first_sequence ELSE NULL END,
    'players', v_players,
    'me', v_me,
    'outcome', v_s.outcome, 'outcome_reason', v_s.outcome_reason,
    'boss_damage', v_s.boss_damage, 'barrier_heal', v_s.barrier_heal,
    'corrupted', v_victims);
END;
$function$;

-- corruption now in effect (or about to start after the result screen); NULL when nobody is corrupted
CREATE OR REPLACE FUNCTION public.raid_corruption_public_state(p_raid_id bigint, p_participant_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_now timestamptz := clock_timestamp(); v_label text; v_list jsonb; v_me jsonb := NULL; v_count integer;
BEGIN
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'participant_id', p.id, 'student_name', p.snapshot_student_name, 'guild_name', p.snapshot_guild_name,
           'starts_at', c.starts_at, 'until', c.until, 'started', c.starts_at <= v_now,
           'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (c.until - GREATEST(v_now, c.starts_at))))) ORDER BY c.until, c.id), '[]'::jsonb),
         count(*)
    INTO v_list, v_count
    FROM public.raid_corruptions c JOIN public.raid_participants p ON p.id = c.participant_id
   WHERE c.raid_id = p_raid_id AND c.until > v_now;
  IF v_count = 0 THEN RETURN NULL; END IF;
  SELECT COALESCE(corruption_label, '타락') INTO v_label FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;
  IF p_participant_id IS NOT NULL THEN
    SELECT jsonb_build_object('active', c.starts_at <= v_now, 'starts_at', c.starts_at, 'until', c.until,
                              'seconds_remaining', GREATEST(0, EXTRACT(EPOCH FROM (c.until - GREATEST(v_now, c.starts_at)))))
      INTO v_me
      FROM public.raid_corruptions c
     WHERE c.raid_id = p_raid_id AND c.participant_id = p_participant_id AND c.until > v_now
     ORDER BY c.until DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('label', COALESCE(v_label, '타락'), 'count', v_count, 'server_now', v_now,
                            'active', v_list, 'me', v_me);
END;
$function$;

-- 5) student RPCs ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_volunteer_raid_inscription(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_inscription_sessions%ROWTYPE; v_reason text := NULL;
BEGIN
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_inscription_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_inscription_sessions
   WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'VOLUNTEERING' THEN v_reason := 'NOT_VOLUNTEERING';
  ELSIF COALESCE(v_part.attack_blocked, false) THEN v_reason := 'ATTACK_BLOCKED';
  ELSIF clock_timestamp() > v_s.volunteer_accept_until THEN v_reason := 'CLOSED';
  ELSE
    INSERT INTO public.raid_inscription_entries(session_id, participant_id) VALUES (v_s.id, v_part.id)
    ON CONFLICT (session_id, participant_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('accepted', v_reason IS NULL, 'reason', v_reason,
                            'inscription', public.raid_inscription_public_state(p_raid_id, v_part.id));
END;
$function$;

-- live progress for the progress bars (sent about every 0.3 s while typing); no lock, own row only
CREATE OR REPLACE FUNCTION public.student_report_raid_inscription_progress(p_raid_id bigint, p_attempt_index integer, p_typed_count integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_student integer; v_part_id bigint; v_rows integer;
BEGIN
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT id INTO v_part_id FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF v_part_id IS NULL THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  IF p_attempt_index IS NULL OR p_attempt_index < 0 OR p_attempt_index > 10000 OR p_typed_count IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID');
  END IF;
  UPDATE public.raid_inscription_entries e
     SET mistakes = e.mistakes + GREATEST(0, p_attempt_index - e.attempt_index),
         typed_count = CASE WHEN p_attempt_index > e.attempt_index
                            THEN LEAST((s.config->>'letter_count')::integer, GREATEST(0, p_typed_count))
                            ELSE GREATEST(e.typed_count, LEAST((s.config->>'letter_count')::integer, GREATEST(0, p_typed_count))) END,
         attempt_index = GREATEST(e.attempt_index, p_attempt_index)
    FROM public.raid_inscription_sessions s
   WHERE s.id = e.session_id AND s.raid_id = p_raid_id AND s.phase = 'PLAYING'
     AND e.participant_id = v_part_id AND e.slot IS NOT NULL AND e.completed_at IS NULL
     AND p_attempt_index >= e.attempt_index;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_rows > 0);
END;
$function$;

-- a finished sequence; the server checks the letters and the time
CREATE OR REPLACE FUNCTION public.student_submit_raid_inscription(p_raid_id bigint, p_attempt_index integer, p_typed text, p_elapsed_ms integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_inscription_sessions%ROWTYPE;
        v_e public.raid_inscription_entries%ROWTYPE; v_reason text := NULL; v_cfg jsonb; v_expected text; v_typed text;
        v_server_ms numeric; v_len integer; v_min_ms numeric; v_limit numeric; v_done_ms integer; v_pool integer;
BEGIN
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_inscription_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_inscription_sessions
   WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'PLAYING' THEN
    v_reason := 'NOT_PLAYING';
  ELSE
    SELECT * INTO v_e FROM public.raid_inscription_entries WHERE session_id = v_s.id AND participant_id = v_part.id FOR UPDATE;
    v_cfg := v_s.config;
    v_len := (v_cfg->>'letter_count')::integer;
    v_min_ms := v_len * (v_cfg->>'min_ms_per_letter')::numeric;
    v_limit := (v_cfg->>'time_limit_ms')::numeric;
    v_server_ms := EXTRACT(EPOCH FROM (clock_timestamp() - v_s.play_starts_at)) * 1000;
    IF NOT FOUND OR v_e.slot IS NULL THEN v_reason := 'NOT_SELECTED';
    ELSIF v_e.completed_at IS NOT NULL THEN v_reason := NULL;  -- already done: answer as accepted
    ELSIF p_attempt_index IS NULL OR p_attempt_index < 0 OR p_attempt_index > 10000 THEN v_reason := 'INVALID';
    ELSE
      v_pool := GREATEST(1, COALESCE(array_length(v_e.sequences, 1), 1));
      v_expected := v_e.sequences[(p_attempt_index % v_pool) + 1];
      v_typed := upper(btrim(COALESCE(p_typed, '')));
      IF v_expected IS NULL OR v_typed <> v_expected THEN v_reason := 'WRONG_SEQUENCE';
      ELSIF v_server_ms > v_limit + (v_cfg->>'latency_slack_ms')::numeric THEN v_reason := 'TOO_LATE';
      ELSIF v_server_ms < v_min_ms THEN v_reason := 'TOO_FAST';
      ELSE
        v_done_ms := ROUND(LEAST(v_limit, GREATEST(v_min_ms, LEAST(v_server_ms, COALESCE(p_elapsed_ms::numeric, v_server_ms)))))::integer;
        UPDATE public.raid_inscription_entries
           SET completed_at = clock_timestamp(), completed_ms = v_done_ms,
               mistakes = mistakes + GREATEST(0, p_attempt_index - attempt_index),
               attempt_index = GREATEST(attempt_index, p_attempt_index), typed_count = v_len
         WHERE session_id = v_s.id AND participant_id = v_part.id;
        PERFORM public.raid_inscription_advance(p_raid_id);
      END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('accepted', v_reason IS NULL, 'reason', v_reason,
                            'inscription', public.raid_inscription_public_state(p_raid_id, v_part.id));
END;
$function$;

-- 6) teacher RPCs ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_raid_inscription_config(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_raid public.raids%ROWTYPE; v_cfg public.raid_inscription_configs%ROWTYPE; v_found boolean; v_eff jsonb;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  SELECT * INTO v_cfg FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;
  v_found := FOUND;
  v_eff := public.raid_inscription_effective_config(p_raid_id);
  RETURN jsonb_build_object(
    'raid_id', p_raid_id, 'raid_status', v_raid.status,
    'editable', v_raid.status IN ('DRAFT','LOBBY_OPEN'),
    'configured', v_found,
    'enabled', CASE WHEN v_found THEN v_cfg.enabled ELSE false END,
    'difficulty', v_eff->>'difficulty',
    'letter_count', (v_eff->>'letter_count')::integer,
    'use_gh', (v_eff->>'use_gh')::boolean,
    'time_limit_seconds', ROUND((v_eff->>'time_limit_ms')::numeric / 1000.0, 1),
    'player_count', (v_eff->>'player_count')::integer,
    'auto_trigger_percents', CASE WHEN v_found
        THEN (SELECT COALESCE(jsonb_agg(ROUND(r * 100)::integer ORDER BY r DESC), '[]'::jsonb) FROM unnest(v_cfg.auto_trigger_ratios) r)
        ELSE '[]'::jsonb END,
    'boss_damage_percent', ROUND((v_eff->>'boss_damage_ratio')::numeric * 100, 1),
    'barrier_heal_percent', ROUND((v_eff->>'barrier_heal_ratio')::numeric * 100, 1),
    'corruption_count', (v_eff->>'corruption_count')::integer,
    'corruption_seconds', (v_eff->>'corruption_seconds')::integer,
    'corruption_label', v_eff->>'corruption_label',
    'selection_mode', CASE WHEN v_found THEN v_cfg.selection_mode ELSE 'RANDOM' END,
    'presets', jsonb_build_object(
       'EASY', public.raid_inscription_profile('EASY'),
       'NORMAL', public.raid_inscription_profile('NORMAL'),
       'HARD', public.raid_inscription_profile('HARD')));
END;
$function$;

-- payload: enabled, difficulty(EASY|NORMAL|HARD|CUSTOM), letter_count, use_gh, time_limit_seconds (CUSTOM only),
--          player_count, auto_trigger_percents[int], boss_damage_percent, barrier_heal_percent,
--          corruption_count, corruption_seconds, corruption_label, selection_mode
CREATE OR REPLACE FUNCTION public.teacher_save_raid_inscription_config(p_raid_id bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_raid public.raids%ROWTYPE; v_diff text; v_pre jsonb; v_len integer; v_gh boolean; v_ms integer; v_players integer;
        v_ratios numeric[]; v_dmg numeric; v_heal numeric; v_ccount integer; v_csec integer; v_label text; v_mode text;
        v_old public.raid_inscription_configs%ROWTYPE; v_p jsonb := COALESCE(p_payload, '{}'::jsonb);
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  IF v_raid.status NOT IN ('DRAFT','LOBBY_OPEN') THEN
    RAISE EXCEPTION '주문 각인 설정은 전투 시작 전에만 바꿀 수 있습니다 (선발 방식은 전투 중에도 바꿀 수 있어요)' USING ERRCODE = 'P0215';
  END IF;
  IF jsonb_typeof(v_p) <> 'object' THEN RAISE EXCEPTION 'Invalid INSCRIPTION configuration' USING ERRCODE = 'P0213'; END IF;
  SELECT * INTO v_old FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;

  BEGIN
    v_diff := upper(COALESCE(NULLIF(btrim(v_p->>'difficulty'), ''), 'EASY'));
    IF v_diff NOT IN ('EASY','NORMAL','HARD','CUSTOM') THEN RAISE EXCEPTION 'bad difficulty'; END IF;
    v_pre := public.raid_inscription_profile(CASE WHEN v_diff = 'CUSTOM' THEN 'EASY' ELSE v_diff END);
    IF v_diff = 'CUSTOM' THEN
      v_len := COALESCE(NULLIF(v_p->>'letter_count', '')::integer, (v_pre->>'letter_count')::integer);
      v_gh := COALESCE((v_p->>'use_gh')::boolean, false);
      v_ms := ROUND(COALESCE(NULLIF(v_p->>'time_limit_seconds', '')::numeric, (v_pre->>'time_limit_ms')::numeric / 1000.0) * 1000)::integer;
    ELSE
      v_len := (v_pre->>'letter_count')::integer; v_gh := (v_pre->>'use_gh')::boolean; v_ms := (v_pre->>'time_limit_ms')::integer;
    END IF;
    v_players := COALESCE(NULLIF(v_p->>'player_count', '')::integer, 8);
    v_dmg := COALESCE(NULLIF(v_p->>'boss_damage_percent', '')::numeric / 100.0, (v_pre->>'boss_damage_ratio')::numeric);
    v_heal := COALESCE(NULLIF(v_p->>'barrier_heal_percent', '')::numeric / 100.0, (v_pre->>'barrier_heal_ratio')::numeric);
    v_ccount := COALESCE(NULLIF(v_p->>'corruption_count', '')::integer, (v_pre->>'corruption_count')::integer);
    v_csec := COALESCE(NULLIF(v_p->>'corruption_seconds', '')::integer, (v_pre->>'corruption_seconds')::integer);
    v_label := COALESCE(NULLIF(btrim(v_p->>'corruption_label'), ''), '타락');
    v_mode := upper(COALESCE(NULLIF(btrim(v_p->>'selection_mode'), ''), v_old.selection_mode, 'RANDOM'));
    IF jsonb_typeof(v_p->'auto_trigger_percents') = 'array' THEN
      SELECT COALESCE(array_agg(DISTINCT (x::numeric / 100.0) ORDER BY (x::numeric / 100.0) DESC), ARRAY[]::numeric[])
        INTO v_ratios FROM jsonb_array_elements_text(v_p->'auto_trigger_percents') x;
    ELSE
      v_ratios := COALESCE(v_old.auto_trigger_ratios, ARRAY[]::numeric[]);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '주문 각인 설정 값을 읽을 수 없습니다. 숫자로 입력해 주세요.' USING ERRCODE = 'P0213';
  END;

  IF v_len NOT BETWEEN 8 AND 16 THEN RAISE EXCEPTION '글자 수는 8~16자로 정할 수 있습니다' USING ERRCODE = 'P0213'; END IF;
  IF v_ms NOT BETWEEN 10000 AND 60000 THEN RAISE EXCEPTION '제한 시간은 10~60초로 정할 수 있습니다' USING ERRCODE = 'P0213'; END IF;
  IF v_players NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION '각인 인원은 1~12명으로 정할 수 있습니다' USING ERRCODE = 'P0213'; END IF;
  IF cardinality(v_ratios) > 3 OR EXISTS (SELECT 1 FROM unnest(v_ratios) r WHERE r <= 0 OR r >= 1) THEN
    RAISE EXCEPTION '자동 발동 지점은 1~99%% 사이로 최대 3개까지 정할 수 있습니다' USING ERRCODE = 'P0213';
  END IF;
  IF v_dmg < 0 OR v_dmg > 0.15 THEN RAISE EXCEPTION '성공 보스 피해는 최대 체력의 0~15%%로 정할 수 있습니다' USING ERRCODE = 'P0213'; END IF;
  IF v_heal < 0 OR v_heal > 0.5 THEN RAISE EXCEPTION '공명방벽 회복은 0~50%%로 정할 수 있습니다' USING ERRCODE = 'P0213'; END IF;
  IF v_ccount < 1 OR v_ccount > v_players THEN RAISE EXCEPTION '타락 인원은 1명부터 각인 인원(%명)까지 정할 수 있습니다', v_players USING ERRCODE = 'P0213'; END IF;
  IF v_csec NOT BETWEEN 5 AND 30 THEN RAISE EXCEPTION '타락 시간은 5~30초로 정할 수 있습니다' USING ERRCODE = 'P0213'; END IF;
  IF char_length(v_label) > 6 THEN RAISE EXCEPTION '타락 표시 이름은 6자 이내로 정해 주세요' USING ERRCODE = 'P0213'; END IF;
  IF v_mode NOT IN ('RANDOM','TEACHER') THEN RAISE EXCEPTION '선발 방식은 RANDOM 또는 TEACHER입니다' USING ERRCODE = 'P0213'; END IF;

  INSERT INTO public.raid_inscription_configs(raid_id, enabled, difficulty, letter_count, use_gh, time_limit_ms, player_count,
         auto_trigger_ratios, boss_damage_ratio, barrier_heal_ratio, corruption_count, corruption_seconds, corruption_label,
         selection_mode, updated_by, updated_at)
  VALUES (p_raid_id, COALESCE((v_p->>'enabled')::boolean, false), v_diff, v_len, v_gh, v_ms, v_players,
          v_ratios, v_dmg, v_heal, v_ccount, v_csec, v_label, v_mode, auth.uid(), now())
  ON CONFLICT (raid_id) DO UPDATE SET
    enabled = excluded.enabled, difficulty = excluded.difficulty, letter_count = excluded.letter_count,
    use_gh = excluded.use_gh, time_limit_ms = excluded.time_limit_ms, player_count = excluded.player_count,
    auto_trigger_ratios = excluded.auto_trigger_ratios, boss_damage_ratio = excluded.boss_damage_ratio,
    barrier_heal_ratio = excluded.barrier_heal_ratio, corruption_count = excluded.corruption_count,
    corruption_seconds = excluded.corruption_seconds, corruption_label = excluded.corruption_label,
    selection_mode = excluded.selection_mode, updated_by = excluded.updated_by, updated_at = now();
  RETURN public.teacher_get_raid_inscription_config(p_raid_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_set_raid_inscription_selection_mode(p_raid_id bigint, p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_mode text := upper(COALESCE(btrim(p_mode), '')); v_status text;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  IF v_mode NOT IN ('RANDOM','TEACHER') THEN RAISE EXCEPTION '선발 방식은 RANDOM 또는 TEACHER입니다' USING ERRCODE = 'P0213'; END IF;
  SELECT status INTO v_status FROM public.raids WHERE id = p_raid_id;
  IF v_status IN ('COMPLETED','FAILED','ARCHIVED') THEN
    RAISE EXCEPTION '끝난 레이드의 선발 방식은 바꿀 수 없습니다' USING ERRCODE = 'P0215';
  END IF;
  UPDATE public.raid_inscription_configs SET selection_mode = v_mode, updated_by = auth.uid(), updated_at = now()
   WHERE raid_id = p_raid_id;
  IF NOT FOUND THEN RAISE EXCEPTION '먼저 「주문 각인」 탭에서 설정을 저장해 주세요' USING ERRCODE = 'P0215'; END IF;
  RETURN jsonb_build_object('raid_id', p_raid_id, 'selection_mode', v_mode);
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_get_raid_inscription_pick_state(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_raid public.raids%ROWTYPE; v_cfg public.raid_inscription_configs%ROWTYPE; v_found boolean;
        v_s public.raid_inscription_sessions%ROWTYPE; v_now timestamptz; v_vol jsonb := '[]'::jsonb; v_players jsonb := '[]'::jsonb;
        v_eff jsonb; v_open boolean; v_len integer;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_inscription_advance(p_raid_id);
  v_now := clock_timestamp();
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  SELECT * INTO v_cfg FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;
  v_found := FOUND;
  v_eff := public.raid_inscription_effective_config(p_raid_id);
  SELECT * INTO v_s FROM public.raid_inscription_sessions WHERE raid_id = p_raid_id ORDER BY id DESC LIMIT 1;
  v_open := v_s.id IS NOT NULL AND v_s.phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING');

  IF v_s.id IS NOT NULL THEN
    v_len := (v_s.config->>'letter_count')::integer;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'participant_id', p.id, 'student_id', p.student_id,
             'student_name', p.snapshot_student_name, 'guild_name', p.snapshot_guild_name,
             'attack_blocked', COALESCE(p.attack_blocked, false), 'volunteered_at', e.volunteered_at,
             'inscription_count_total', h.cnt, 'avg_completed_ms', h.avg_ms)
           ORDER BY h.cnt, e.volunteered_at, p.id), '[]'::jsonb)
      INTO v_vol
      FROM public.raid_inscription_entries e
      JOIN public.raid_participants p ON p.id = e.participant_id
      CROSS JOIN LATERAL (
        SELECT count(*)::integer AS cnt, ROUND(avg(e2.completed_ms))::integer AS avg_ms
          FROM public.raid_inscription_entries e2
          JOIN public.raid_inscription_sessions s2 ON s2.id = e2.session_id
          JOIN public.raid_participants p2 ON p2.id = e2.participant_id
         WHERE p2.student_id = p.student_id AND e2.slot IS NOT NULL
           AND s2.id <> v_s.id AND s2.phase <> 'CANCELLED') h
     WHERE e.session_id = v_s.id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'participant_id', p.id, 'slot', e.slot, 'student_name', p.snapshot_student_name, 'guild_name', p.snapshot_guild_name,
             'typed_count', CASE WHEN e.completed_at IS NOT NULL THEN v_len ELSE e.typed_count END,
             'attempt_index', e.attempt_index, 'mistakes', e.mistakes,
             'completed', e.completed_at IS NOT NULL, 'completed_ms', e.completed_ms, 'corrupted', e.corrupted) ORDER BY e.slot), '[]'::jsonb)
      INTO v_players
      FROM public.raid_inscription_entries e JOIN public.raid_participants p ON p.id = e.participant_id
     WHERE e.session_id = v_s.id AND e.slot IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'raid_id', p_raid_id, 'raid_status', v_raid.status, 'server_now', v_now,
    'configured', v_found, 'enabled', CASE WHEN v_found THEN v_cfg.enabled ELSE false END,
    'selection_mode', CASE WHEN v_found THEN v_cfg.selection_mode ELSE 'RANDOM' END,
    'planned_player_count', (COALESCE(v_s.config, v_eff)->>'player_count')::integer,
    'config', jsonb_build_object(
      'difficulty', v_eff->>'difficulty', 'letter_count', (v_eff->>'letter_count')::integer,
      'use_gh', (v_eff->>'use_gh')::boolean, 'time_limit_ms', (v_eff->>'time_limit_ms')::integer,
      'player_count', (v_eff->>'player_count')::integer,
      'corruption_count', (v_eff->>'corruption_count')::integer, 'corruption_seconds', (v_eff->>'corruption_seconds')::integer,
      'auto_trigger_percents', CASE WHEN v_found
          THEN (SELECT COALESCE(jsonb_agg(ROUND(r * 100)::integer ORDER BY r DESC), '[]'::jsonb) FROM unnest(v_cfg.auto_trigger_ratios) r)
          ELSE '[]'::jsonb END),
    'can_trigger', v_raid.status = 'ACTIVE' AND v_found AND v_cfg.enabled AND NOT v_open
                   AND NOT public.raid_inscription_is_active(p_raid_id) AND NOT public.raid_inscription_clash_busy(p_raid_id),
    'clash_busy', public.raid_inscription_clash_busy(p_raid_id),
    'session', CASE WHEN v_s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_s.id, 'seq_no', v_s.seq_no, 'phase', v_s.phase, 'open', v_open,
      'trigger_source', v_s.trigger_source,
      'trigger_percent', CASE WHEN v_s.trigger_ratio IS NULL THEN NULL ELSE ROUND(v_s.trigger_ratio * 100)::integer END,
      'letter_count', v_len, 'time_limit_ms', (v_s.config->>'time_limit_ms')::integer,
      'volunteer_closes_at', v_s.volunteer_closes_at, 'volunteer_accept_until', v_s.volunteer_accept_until,
      'pick_deadline_at', v_s.volunteer_accept_until + make_interval(secs => ((v_s.config->>'pick_timeout_ms')::numeric / 1000.0)::double precision),
      'play_starts_at', v_s.play_starts_at, 'play_deadline_at', v_s.play_deadline_at,
      'resolved_at', v_s.resolved_at, 'resume_at', v_s.resume_at,
      'teacher_pick', to_jsonb(v_s.teacher_pick), 'picked', v_s.teacher_pick IS NOT NULL,
      'volunteers', v_vol, 'players', v_players,
      'outcome', v_s.outcome, 'outcome_reason', v_s.outcome_reason,
      'boss_damage', v_s.boss_damage, 'boss_damage_capped', v_s.boss_damage_capped, 'barrier_heal', v_s.barrier_heal
    ) END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_pick_raid_inscription_players(p_raid_id bigint, p_participant_ids bigint[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_inscription_sessions%ROWTYPE; v_mode text; v_ids bigint[]; v_bad integer; v_planned integer;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_inscription_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_inscription_sessions
   WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'VOLUNTEERING' THEN
    RAISE EXCEPTION '지금은 각인자를 고를 수 없습니다 (이미 정해졌거나 주문 각인이 없습니다)' USING ERRCODE = 'P0215';
  END IF;
  SELECT selection_mode INTO v_mode FROM public.raid_inscription_configs WHERE raid_id = p_raid_id;
  IF COALESCE(v_mode, 'RANDOM') <> 'TEACHER' THEN
    RAISE EXCEPTION '선발 방식이 ''선생님이 선택''일 때만 고를 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  IF v_s.teacher_pick IS NOT NULL THEN RAISE EXCEPTION '이미 확정했습니다' USING ERRCODE = 'P0215'; END IF;
  v_ids := COALESCE(p_participant_ids, ARRAY[]::bigint[]);
  v_planned := GREATEST(1, LEAST(12, COALESCE((v_s.config->>'player_count')::integer, 8)));
  IF array_position(v_ids, NULL) IS NOT NULL OR (SELECT count(DISTINCT x) FROM unnest(v_ids) x) <> cardinality(v_ids) THEN
    RAISE EXCEPTION '같은 학생을 두 번 고를 수 없습니다' USING ERRCODE = 'P0213';
  END IF;
  IF cardinality(v_ids) > v_planned THEN
    RAISE EXCEPTION '각인 인원(%명)보다 많이 고를 수 없습니다', v_planned USING ERRCODE = 'P0213';
  END IF;
  SELECT count(*) INTO v_bad FROM unnest(v_ids) x
   WHERE NOT EXISTS (SELECT 1 FROM public.raid_inscription_entries e
                       JOIN public.raid_participants p ON p.id = e.participant_id AND NOT COALESCE(p.attack_blocked, false)
                      WHERE e.session_id = v_s.id AND e.participant_id = x);
  IF v_bad > 0 THEN RAISE EXCEPTION '지원하지 않았거나 공격이 막힌 학생이 포함되어 있습니다' USING ERRCODE = 'P0213'; END IF;
  UPDATE public.raid_inscription_sessions SET teacher_pick = v_ids, updated_at = now() WHERE id = v_s.id;
  PERFORM public.raid_inscription_advance(p_raid_id);
  RETURN public.teacher_get_raid_inscription_pick_state(p_raid_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_trigger_raid_inscription(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_raid public.raids%ROWTYPE; v_id bigint;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_inscription_advance(p_raid_id);
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF v_raid.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '주문 각인은 전투 중(ACTIVE)일 때만 발동할 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.raid_inscription_configs WHERE raid_id = p_raid_id AND enabled = true) THEN
    RAISE EXCEPTION '이 레이드는 주문 각인이 꺼져 있습니다' USING ERRCODE = 'P0215';
  END IF;
  IF public.raid_inscription_clash_busy(p_raid_id) THEN
    RAISE EXCEPTION '격돌이 끝난 뒤에 발동할 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  IF public.raid_inscription_is_active(p_raid_id)
     OR EXISTS (SELECT 1 FROM public.raid_inscription_sessions WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')) THEN
    RAISE EXCEPTION '이미 주문 각인이 진행 중입니다' USING ERRCODE = 'P0215';
  END IF;
  v_id := public.raid_inscription_begin(p_raid_id, 'TEACHER', NULL);
  IF v_id IS NOT NULL THEN
    INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
    VALUES (p_raid_id, 'INSCRIPTION_MANUAL_TRIGGER', 0, jsonb_build_object('inscription_session_id', v_id, 'by', auth.uid(),
            'boss_hp', v_raid.current_hp, 'boss_max_hp', v_raid.max_hp));
  END IF;
  RETURN jsonb_build_object('triggered', v_id IS NOT NULL, 'inscription', public.raid_inscription_public_state(p_raid_id, NULL));
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_cancel_raid_inscription(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_s public.raid_inscription_sessions%ROWTYPE; v_now timestamptz;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  SELECT * INTO v_s FROM public.raid_inscription_sessions
   WHERE raid_id = p_raid_id AND phase IN ('PENDING','VOLUNTEERING','SELECTED','PLAYING')
   ORDER BY id DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '진행 중인 주문 각인이 없습니다' USING ERRCODE = 'P0215'; END IF;
  v_now := clock_timestamp();
  IF v_s.triggered_at IS NOT NULL THEN
    PERFORM public.raid_inscription_return_time(p_raid_id, v_s.triggered_at, v_now - v_s.triggered_at);
  END IF;
  UPDATE public.raid_inscription_sessions
     SET phase = 'CANCELLED', outcome_reason = 'TEACHER_CANCELLED', resolved_at = v_now, resume_at = v_now,
         frozen_seconds = CASE WHEN triggered_at IS NULL THEN 0 ELSE EXTRACT(EPOCH FROM (v_now - triggered_at)) END,
         updated_at = now()
   WHERE id = v_s.id;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (p_raid_id, 'INSCRIPTION_CANCELLED', 0, jsonb_build_object('inscription_session_id', v_s.id, 'seq_no', v_s.seq_no, 'by', auth.uid()));
  RETURN public.teacher_get_raid_inscription_pick_state(p_raid_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_get_raid_inscription_history(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_rows jsonb;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', s.id, 'seq_no', s.seq_no, 'phase', s.phase, 'trigger_source', s.trigger_source,
           'trigger_percent', CASE WHEN s.trigger_ratio IS NULL THEN NULL ELSE ROUND(s.trigger_ratio * 100)::integer END,
           'outcome', s.outcome, 'outcome_reason', s.outcome_reason,
           'triggered_at', s.triggered_at, 'resolved_at', s.resolved_at,
           'difficulty', s.config->>'difficulty', 'letter_count', (s.config->>'letter_count')::integer,
           'time_limit_ms', (s.config->>'time_limit_ms')::integer,
           'boss_damage', s.boss_damage, 'boss_damage_capped', s.boss_damage_capped, 'barrier_heal', s.barrier_heal,
           'players', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                          'participant_id', p.id, 'student_name', p.snapshot_student_name, 'guild_name', p.snapshot_guild_name,
                          'completed', e.completed_at IS NOT NULL, 'completed_ms', e.completed_ms, 'mistakes', e.mistakes,
                          'corrupted', e.corrupted) ORDER BY e.slot), '[]'::jsonb)
                         FROM public.raid_inscription_entries e JOIN public.raid_participants p ON p.id = e.participant_id
                        WHERE e.session_id = s.id AND e.slot IS NOT NULL),
           'corruptions', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                              'participant_id', p.id, 'student_name', p.snapshot_student_name,
                              'healed_amount', c.healed_amount) ORDER BY c.id), '[]'::jsonb)
                             FROM public.raid_corruptions c JOIN public.raid_participants p ON p.id = c.participant_id
                            WHERE c.session_id = s.id)
         ) ORDER BY s.seq_no DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.raid_inscription_sessions s WHERE s.raid_id = p_raid_id;
  RETURN jsonb_build_object('raid_id', p_raid_id, 'sessions', v_rows);
END;
$function$;

-- 7) privileges -------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.raid_inscription_profile(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_effective_config(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_make_sequence(integer,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_is_active(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_corruption_active(bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_clash_busy(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_open_volunteering(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_begin(bigint,text,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_check_auto(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_return_time(bigint,timestamptz,interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_resolve(bigint,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_draw(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_advance(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_inscription_public_state(bigint,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_corruption_public_state(bigint,bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.student_volunteer_raid_inscription(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_report_raid_inscription_progress(bigint,integer,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_submit_raid_inscription(bigint,integer,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_inscription_config(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_save_raid_inscription_config(bigint,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_raid_inscription_selection_mode(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_inscription_pick_state(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_pick_raid_inscription_players(bigint,bigint[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_trigger_raid_inscription(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_cancel_raid_inscription(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_inscription_history(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_volunteer_raid_inscription(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_report_raid_inscription_progress(bigint,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_raid_inscription(bigint,integer,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_inscription_config(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_save_raid_inscription_config(bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_raid_inscription_selection_mode(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_inscription_pick_state(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_pick_raid_inscription_players(bigint,bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_trigger_raid_inscription(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_cancel_raid_inscription(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_inscription_history(bigint) TO authenticated;

-- 8) markers on existing functions ------------------------------------------------------------
-- 8-1) attack: variables
SELECT brand_backup.replace_once(
  'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
  '/*INSCRIPTION:vars*/',
  $n$v_clash_armed boolean:=false; v_clash_trigger boolean:=false;$n$,
  $r$v_clash_armed boolean:=false; v_clash_trigger boolean:=false; /*INSCRIPTION:vars*/ v_corrupted boolean:=false; v_corruption_heal bigint:=0;$r$
);

-- 8-2) attack: rejected while an inscription stops the battle
SELECT brand_backup.replace_once(
  'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
  '/*INSCRIPTION:frozen*/',
  $n$  /*CLASH_V1:frozen_guard*/$n$,
  $r$  /*INSCRIPTION:frozen*/
  IF public.raid_inscription_is_active(p_raid_id) THEN
    v_result:=jsonb_build_object(
      'raid_id',p_raid_id,'batch_id',p_batch_id,'requested',v_requested,'accepted',0,'rejected',v_requested,
      'results',(SELECT COALESCE(jsonb_agg(jsonb_build_object('accepted',false,'reason','INSCRIPTION_ACTIVE')),'[]'::jsonb) FROM generate_series(1,v_requested)),
      'raid_hp',v_raid.current_hp,
      'raid_hp_ratio',CASE WHEN v_raid.max_hp>0 THEN v_raid.current_hp::numeric/v_raid.max_hp::numeric ELSE 0 END,
      'my_total_damage',v_participant.total_damage,'raid_status','ACTIVE','barrier_collapsed',false,
      'inscription_active',true,'clash_triggered',false,'pattern',NULL);
    INSERT INTO public.raid_attack_batches(
      raid_id,participant_id,client_batch_id,requested_taps,accepted_taps,rejected_taps,total_damage,crit_count,
      zone_summary,damage_summary,result_payload,raid_hp_before,raid_hp_after,created_at
    ) VALUES (
      p_raid_id,v_participant.id,p_batch_id,v_requested,0,v_requested,0,0,
      jsonb_build_object('inscription_active',true),jsonb_build_object('min',0,'max',0,'avg',0),
      v_result,v_raid.current_hp,v_raid.current_hp,clock_timestamp()
    );
    RETURN v_result;
  END IF;
  /*CLASH_V1:frozen_guard*/$r$
);

-- 8-3) attack: is this student corrupted right now?
SELECT brand_backup.replace_once(
  'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
  '/*INSCRIPTION:corrupted_flag*/',
  $n$  IF v_participant.attack_blocked THEN RAISE EXCEPTION 'Raid attacks are blocked for this participant' USING ERRCODE='42501'; END IF;$n$,
  $r$  IF v_participant.attack_blocked THEN RAISE EXCEPTION 'Raid attacks are blocked for this participant' USING ERRCODE='42501'; END IF;
  /*INSCRIPTION:corrupted_flag*/ v_corrupted:=public.raid_corruption_active(p_raid_id,v_participant.id);$r$
);

-- 8-4) attack: a corrupted student's hit heals the boss by the damage it would have done
SELECT brand_backup.replace_once(
  'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
  '/*INSCRIPTION:corruption*/',
  $n$    IF NOT v_pattern_active OR v_pattern_type IN ('WEAK_POINT','DOT') THEN$n$,
  $r$    IF /*INSCRIPTION:corruption*/ v_corrupted THEN
      v_tap_boss_heal:=LEAST(GREATEST(0::bigint,v_raid.max_hp-v_hp_working),v_damage);
      v_hp_working:=LEAST(v_raid.max_hp,v_hp_working+v_tap_boss_heal);
      v_corruption_heal:=v_corruption_heal+v_tap_boss_heal;
      v_pattern_effect:='CORRUPTED';
    ELSIF NOT v_pattern_active OR v_pattern_type IN ('WEAK_POINT','DOT') THEN$r$
);

-- 8-5) attack: record the healing, fire automatic inscriptions
SELECT brand_backup.replace_once(
  'public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure,
  '/*INSCRIPTION:after_batch*/',
  $n$  IF v_clash_trigger AND v_hp_working>0 THEN PERFORM public.raid_clash_begin(p_raid_id); END IF;$n$,
  $r$  IF v_clash_trigger AND v_hp_working>0 THEN PERFORM public.raid_clash_begin(p_raid_id); END IF;
  /*INSCRIPTION:after_batch*/
  IF v_corruption_heal>0 THEN
    UPDATE public.raid_corruptions SET healed_amount=healed_amount+v_corruption_heal
     WHERE id=(SELECT c.id FROM public.raid_corruptions c
                WHERE c.raid_id=p_raid_id AND c.participant_id=v_participant.id
                  AND c.starts_at<=clock_timestamp() AND c.until>v_now - interval '5 seconds'
                ORDER BY c.until DESC LIMIT 1);
  END IF;
  IF v_accepted>0 AND v_hp_working>0 THEN PERFORM public.raid_inscription_check_auto(p_raid_id); END IF;$r$
);

-- 8-6) combat tick: move the inscription forward; while it runs, nothing else happens
SELECT brand_backup.replace_once(
  'public.raid_combat_tick(bigint)'::regprocedure,
  '/*INSCRIPTION:tick*/',
  $n$  v_pattern_result:=public.raid_advance_patterns(p_raid_id); v_now:=clock_timestamp();$n$,
  $r$  /*INSCRIPTION:tick*/
  v_clash_tick:=v_clash_tick||jsonb_build_object('inscription',public.raid_inscription_advance(p_raid_id));
  IF COALESCE((v_clash_tick#>>'{inscription,frozen}')::boolean,false) THEN
    RETURN jsonb_build_object('raid_id',p_raid_id,'attack_applied',false,'reason','INSCRIPTION_FROZEN',
                              'inscription_phase',v_clash_tick#>>'{inscription,phase}','server_now',clock_timestamp());
  END IF;
  v_pattern_result:=public.raid_advance_patterns(p_raid_id); v_now:=clock_timestamp();$r$
);

-- 8-7) "battle is stopped" also covers inscriptions (pattern timers stop, teacher pause refused)
SELECT brand_backup.replace_once(
  'public.raid_clash_is_frozen(bigint)'::regprocedure,
  '/*INSCRIPTION:frozen_check*/',
  $n$WHERE s.raid_id = p_raid_id AND s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'));$n$,
  $r$WHERE s.raid_id = p_raid_id AND s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'))
  /*INSCRIPTION:frozen_check*/ OR public.raid_inscription_is_active(p_raid_id);$r$
);

-- 8-8) giving back stopped time also extends running corruptions
SELECT brand_backup.replace_once(
  'public.raid_clash_shift_timeline(bigint,interval)'::regprocedure,
  '/*INSCRIPTION:shift*/',
  $n$   WHERE raid_id = p_raid_id;
END;$n$,
  $r$   WHERE raid_id = p_raid_id;
  /*INSCRIPTION:shift*/
  UPDATE public.raid_corruptions
     SET starts_at = starts_at + p_interval, until = until + p_interval
   WHERE raid_id = p_raid_id AND until > clock_timestamp() - p_interval;
END;$r$
);

-- 8-9) no clash while an inscription stops the battle
SELECT brand_backup.replace_once(
  'public.raid_clash_begin(bigint)'::regprocedure,
  '/*INSCRIPTION:clash_guard*/',
  $n$  IF NOT FOUND THEN RETURN NULL; END IF;
  v_profile := public.raid_clash_profile(v_cfg.difficulty)$n$,
  $r$  IF NOT FOUND THEN RETURN NULL; END IF;
  /*INSCRIPTION:clash_guard*/ IF public.raid_inscription_is_active(p_raid_id) THEN RETURN NULL; END IF;
  v_profile := public.raid_clash_profile(v_cfg.difficulty)$r$
);

-- 8-10) student battle state
SELECT brand_backup.replace_once(
  'public.get_raid_battle_state(bigint)'::regprocedure,
  '/*INSCRIPTION:state*/',
  $n$/*CLASH_V1:battle_state*/'clash',public.raid_clash_public_state(r.id,part.id),$n$,
  $r$/*CLASH_V1:battle_state*/'clash',public.raid_clash_public_state(r.id,part.id),
    /*INSCRIPTION:state*/'inscription',public.raid_inscription_public_state(r.id,part.id),'corruption',public.raid_corruption_public_state(r.id,part.id),$r$
);

-- 8-11) broadcast state
SELECT brand_backup.replace_once(
  'public.teacher_get_raid_broadcast_state(bigint)'::regprocedure,
  '/*INSCRIPTION:broadcast*/',
  $n$/*CLASH_V1:broadcast_state*/ 'clash', public.raid_clash_public_state(r.id,NULL),$n$,
  $r$/*CLASH_V1:broadcast_state*/ 'clash', public.raid_clash_public_state(r.id,NULL),
    /*INSCRIPTION:broadcast*/ 'inscription', public.raid_inscription_public_state(r.id,NULL), 'corruption', public.raid_corruption_public_state(r.id,NULL),$r$
);
