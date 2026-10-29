-- =====================================================================
-- B.R.A.N.D 2.0 — Raid CLASH (격돌) V1 server
-- 2026-10-28
--
-- * Default OFF: a raid only uses CLASH after the teacher turns it on
--   (raid_clash_configs.enabled = true) while the raid is DRAFT/LOBBY_OPEN.
-- * Existing raids, results, rewards and the attack formula for raids
--   without an active CLASH buff stay identical.
-- * Requires Raid Element V1 (applied 2026-10-28): the attack formula
--   needle below contains the element multiplier.
-- * Existing production functions are patched by "replace exactly one
--   inspected text"; any source mismatch aborts the whole migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Backup of current raid functions + patch helper
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS brand_backup;
REVOKE ALL ON SCHEMA brand_backup FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS brand_backup.function_snapshots (
  id bigserial PRIMARY KEY,
  snapshot_label text NOT NULL,
  signature text NOT NULL,
  definition text NOT NULL,
  definition_md5 text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_label, signature)
);
REVOKE ALL ON brand_backup.function_snapshots FROM PUBLIC, anon, authenticated;

INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5)
SELECT 'PRE_CLASH_V1_20261028', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f','p') AND p.proname ILIKE '%raid%'
ON CONFLICT (snapshot_label, signature) DO NOTHING;

CREATE OR REPLACE FUNCTION brand_backup.replace_once(p_fn regprocedure, p_marker text, p_needle text, p_replacement text)
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_ddl text; v_pos integer;
BEGIN
  -- Windows copy/paste can turn LF into CRLF inside the $n$ / $r$ strings; ignore carriage returns.
  p_needle := replace(p_needle, E'\r', '');
  p_replacement := replace(p_replacement, E'\r', '');
  v_ddl := replace(pg_get_functiondef(p_fn), E'\r', '');
  IF strpos(v_ddl, p_marker) > 0 THEN RETURN 'SKIP_ALREADY_APPLIED'; END IF;
  v_pos := strpos(v_ddl, p_needle);
  IF v_pos = 0 OR strpos(substr(v_ddl, v_pos + length(p_needle)), p_needle) > 0 THEN
    RAISE EXCEPTION 'CLASH patch source mismatch in % (%). Aborting entire migration.', p_fn, p_marker;
  END IF;
  IF strpos(p_replacement, p_marker) = 0 THEN
    RAISE EXCEPTION 'CLASH patch replacement must contain its marker %', p_marker;
  END IF;
  EXECUTE overlay(v_ddl PLACING p_replacement FROM v_pos FOR length(p_needle));
  RETURN 'APPLIED';
END;
$clash$;
REVOKE ALL ON FUNCTION brand_backup.replace_once(regprocedure,text,text,text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. Tables (access only through SECURITY DEFINER RPCs)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.raid_clash_configs (
  raid_id bigint PRIMARY KEY REFERENCES public.raids(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  difficulty text NOT NULL DEFAULT 'EASY' CHECK (difficulty IN ('EASY','NORMAL','HARD')),
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.raid_clash_sessions (
  id bigserial PRIMARY KEY,
  raid_id bigint NOT NULL UNIQUE REFERENCES public.raids(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('VOLUNTEERING','SELECTED','PLAYING','RESOLVED','CANCELLED')),
  difficulty text NOT NULL CHECK (difficulty IN ('EASY','NORMAL','HARD')),
  config jsonb NOT NULL,
  note_keys text[] NOT NULL CHECK (array_length(note_keys,1) = 8),
  triggered_at timestamptz NOT NULL,
  volunteer_closes_at timestamptz NOT NULL,
  volunteer_accept_until timestamptz NOT NULL,
  selected_participant_id bigint REFERENCES public.raid_participants(id) ON DELETE SET NULL,
  selected_at timestamptz,
  ready_deadline_at timestamptz,
  ready_at timestamptz,
  play_starts_at timestamptz,
  play_deadline_at timestamptz,
  score integer,
  outcome text CHECK (outcome IN ('GREAT_SUCCESS','SUCCESS','FAILED')),
  outcome_reason text,
  resolved_at timestamptz,
  frozen_seconds numeric,
  buff_until timestamptz,
  boss_attack_block_until timestamptz,
  clash_component numeric NOT NULL DEFAULT 0,
  weak_zone jsonb,
  barrier_penalty_amount bigint,
  barrier_penalty_applied boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.raid_clash_volunteers (
  session_id bigint NOT NULL REFERENCES public.raid_clash_sessions(id) ON DELETE CASCADE,
  participant_id bigint NOT NULL REFERENCES public.raid_participants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, participant_id)
);

CREATE TABLE IF NOT EXISTS public.raid_clash_inputs (
  session_id bigint NOT NULL REFERENCES public.raid_clash_sessions(id) ON DELETE CASCADE,
  note_index smallint NOT NULL CHECK (note_index BETWEEN 0 AND 7),
  participant_id bigint REFERENCES public.raid_participants(id) ON DELETE SET NULL,
  expected_key text NOT NULL,
  key_code text,
  client_offset_ms integer,
  server_delta_ms integer,
  judgment text NOT NULL CHECK (judgment IN ('PERFECT','GOOD','BAD','MISS')),
  points smallint NOT NULL CHECK (points BETWEEN 0 AND 2),
  source text NOT NULL CHECK (source IN ('INPUT','CLIENT_MISS','TIMEOUT','FORCED')),
  flag text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, note_index)
);

ALTER TABLE public.raid_clash_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_clash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_clash_volunteers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raid_clash_inputs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raid_clash_configs, public.raid_clash_sessions, public.raid_clash_volunteers, public.raid_clash_inputs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.raid_clash_sessions_id_seq FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Pure helpers
-- ---------------------------------------------------------------------
-- Timing profiles: initial play-test values (handoff 4.2), not final.
CREATE OR REPLACE FUNCTION public.raid_clash_profile(p_difficulty text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE
  v_d text := upper(COALESCE(p_difficulty,'EASY'));
  v_approach integer; v_spacing integer; v_perfect integer; v_good integer; v_bad integer;
BEGIN
  IF v_d = 'HARD' THEN
    v_approach := 1050; v_spacing := 1150; v_perfect := 55; v_good := 125; v_bad := 230;
  ELSIF v_d = 'NORMAL' THEN
    v_approach := 1300; v_spacing := 1400; v_perfect := 80; v_good := 180; v_bad := 300;
  ELSE
    v_d := 'EASY';
    v_approach := 1600; v_spacing := 1700; v_perfect := 100; v_good := 230; v_bad := 360;
  END IF;
  RETURN jsonb_build_object(
    'version',1,'difficulty',v_d,'note_count',8,
    'keys',jsonb_build_array('KeyQ','KeyW','KeyE','KeyR'),
    'volunteer_ms',5000,'volunteer_grace_ms',2000,'volunteer_button_delay_ms',1000,
    'reveal_ms',2600,'ready_timeout_ms',5000,'countdown_ms',3000,
    'latency_slack_ms',2500,'early_slack_ms',1200,
    'approach_ms',v_approach,'spacing_ms',v_spacing,
    'perfect_ms',v_perfect,'good_ms',v_good,'bad_ms',v_bad,
    'points',jsonb_build_object('PERFECT',2,'GOOD',1,'BAD',0,'MISS',0),
    'success_score',8,'great_score',13,
    'effects',jsonb_build_object(
      'GREAT_SUCCESS',jsonb_build_object('buff_seconds',10,'block_seconds',16,'clash_component',3.0),
      'SUCCESS',jsonb_build_object('buff_seconds',10,'block_seconds',10,'clash_component',1.5),
      'FAILED',jsonb_build_object('barrier_penalty_ratio_of_current',0.20)
    ),
    'weak_zone',jsonb_build_object('x',0.40,'y',0.26,'width',0.20,'height',0.26,'multiplier',2.0)
  );
END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_ideal_ms(p_cfg jsonb, p_index integer)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT (p_cfg->>'countdown_ms')::integer + (p_cfg->>'approach_ms')::integer + p_index * (p_cfg->>'spacing_ms')::integer;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_judge(p_offset_ms integer, p_cfg jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT CASE
    WHEN p_offset_ms IS NULL THEN 'MISS'
    WHEN abs(p_offset_ms) <= (p_cfg->>'perfect_ms')::integer THEN 'PERFECT'
    WHEN abs(p_offset_ms) <= (p_cfg->>'good_ms')::integer THEN 'GOOD'
    WHEN abs(p_offset_ms) <= (p_cfg->>'bad_ms')::integer THEN 'BAD'
    ELSE 'MISS' END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_points(p_judgment text)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT CASE p_judgment WHEN 'PERFECT' THEN 2 WHEN 'GOOD' THEN 1 ELSE 0 END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_outcome(p_score integer, p_cfg jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT CASE
    WHEN COALESCE(p_score,0) >= COALESCE((p_cfg->>'great_score')::integer,13) THEN 'GREAT_SUCCESS'
    WHEN COALESCE(p_score,0) >= COALESCE((p_cfg->>'success_score')::integer,8) THEN 'SUCCESS'
    ELSE 'FAILED' END;
$clash$;

-- During the CLASH buff: GREATEST(weak + clash component, legacy pattern x groggy).
-- Without an active buff this returns exactly pattern x groggy (identical to the old formula).
CREATE OR REPLACE FUNCTION public.raid_clash_hit_factor(p_ctx jsonb, p_x numeric, p_y numeric, p_pattern_multiplier numeric, p_groggy_multiplier numeric)
RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE
  v_legacy numeric := p_pattern_multiplier * p_groggy_multiplier;
  v_zone jsonb; v_in_zone boolean := false; v_weak numeric; v_component numeric;
BEGIN
  IF p_ctx IS NULL OR NOT COALESCE((p_ctx->>'buff_active')::boolean,false) THEN
    RETURN v_legacy;
  END IF;
  v_component := GREATEST(0::numeric, COALESCE(NULLIF(p_ctx->>'clash_component','')::numeric,0));
  v_zone := p_ctx->'weak_zone';
  IF jsonb_typeof(v_zone) = 'object' THEN
    v_in_zone := p_x >= (v_zone->>'x')::numeric AND p_x <= (v_zone->>'x')::numeric + (v_zone->>'width')::numeric
             AND p_y >= (v_zone->>'y')::numeric AND p_y <= (v_zone->>'y')::numeric + (v_zone->>'height')::numeric;
  END IF;
  v_weak := CASE WHEN v_in_zone THEN GREATEST(0::numeric, COALESCE(NULLIF(v_zone->>'multiplier','')::numeric,2)) ELSE p_pattern_multiplier END;
  RETURN GREATEST(v_legacy, v_weak + v_component);
END;
$clash$;

-- First boss basic-attack slot at or after the block end, keeping the normal cadence (no backlog).
CREATE OR REPLACE FUNCTION public.raid_clash_next_attack_after(p_next timestamptz, p_block_until timestamptz, p_interval_seconds numeric)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_interval numeric := GREATEST(1::numeric, COALESCE(p_interval_seconds,10)); v_steps numeric;
BEGIN
  IF p_next IS NULL OR p_block_until IS NULL OR p_next >= p_block_until THEN RETURN p_next; END IF;
  v_steps := ceil(EXTRACT(EPOCH FROM (p_block_until - p_next)) / v_interval);
  RETURN p_next + make_interval(secs => (v_steps * v_interval)::double precision);
END;
$clash$;

-- ---------------------------------------------------------------------
-- 3. Runtime helpers (internal)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raid_clash_is_frozen(p_raid_id bigint)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT EXISTS (SELECT 1 FROM public.raid_clash_sessions s
                 WHERE s.raid_id = p_raid_id AND s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'));
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_attack_context(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_cfg public.raid_clash_configs%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE; v_combat_enabled boolean;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id;
  SELECT COALESCE(c.enabled,false) INTO v_combat_enabled FROM public.raid_combat_configs c WHERE c.raid_id = p_raid_id;
  RETURN jsonb_build_object(
    'frozen', v_s.id IS NOT NULL AND v_s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'),
    'armed', COALESCE(v_cfg.enabled,false) AND v_s.id IS NULL AND COALESCE(v_combat_enabled,false),
    'buff_active', v_s.id IS NOT NULL AND v_s.phase = 'RESOLVED' AND v_s.clash_component > 0
                   AND v_s.buff_until IS NOT NULL AND v_s.buff_until > clock_timestamp(),
    'clash_component', COALESCE(v_s.clash_component,0),
    'weak_zone', v_s.weak_zone
  );
END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_begin(p_raid_id bigint)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_cfg public.raid_clash_configs%ROWTYPE; v_profile jsonb; v_now timestamptz := clock_timestamp(); v_keys text[]; v_id bigint; v_raid public.raids%ROWTYPE;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_clash_configs WHERE raid_id = p_raid_id AND enabled = true;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_profile := public.raid_clash_profile(v_cfg.difficulty);
  SELECT array_agg((ARRAY['KeyQ','KeyW','KeyE','KeyR'])[1 + floor(random()*4)::integer]) INTO v_keys FROM generate_series(1,8);
  INSERT INTO public.raid_clash_sessions(raid_id, phase, difficulty, config, note_keys, triggered_at, volunteer_closes_at, volunteer_accept_until, weak_zone)
  VALUES (p_raid_id, 'VOLUNTEERING', v_profile->>'difficulty', v_profile, v_keys, v_now,
          v_now + make_interval(secs => ((v_profile->>'volunteer_ms')::numeric/1000.0)::double precision),
          v_now + make_interval(secs => (((v_profile->>'volunteer_ms')::numeric + (v_profile->>'volunteer_grace_ms')::numeric)/1000.0)::double precision),
          v_profile->'weak_zone')
  ON CONFLICT (raid_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
    INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
    VALUES (p_raid_id, 'CLASH_STARTED', 0, jsonb_build_object(
      'clash_session_id', v_id, 'difficulty', v_profile->>'difficulty',
      'volunteer_closes_at', v_now + make_interval(secs => ((v_profile->>'volunteer_ms')::numeric/1000.0)::double precision),
      'boss_hp', v_raid.current_hp, 'boss_max_hp', v_raid.max_hp));
  END IF;
  RETURN v_id;
END;
$clash$;

-- Same timer set as teacher_resume_raid, shifted once by the CLASH freeze length.
CREATE OR REPLACE FUNCTION public.raid_clash_shift_timeline(p_raid_id bigint, p_interval interval)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
BEGIN
  IF p_interval IS NULL OR p_interval <= interval '0 seconds' THEN RETURN; END IF;
  UPDATE public.raids
     SET starts_at = CASE WHEN starts_at IS NULL THEN NULL ELSE starts_at + p_interval END,
         ends_at = CASE WHEN ends_at IS NULL THEN NULL ELSE ends_at + p_interval END,
         updated_at = now()
   WHERE id = p_raid_id;
  UPDATE public.raid_pattern_runs
     SET started_at = started_at + p_interval,
         ends_at = ends_at + p_interval
   WHERE raid_id = p_raid_id AND status = 'ACTIVE';
  UPDATE public.raid_combat_states
     SET next_boss_attack_at = CASE WHEN next_boss_attack_at IS NULL THEN NULL ELSE next_boss_attack_at + p_interval END,
         groggy_until = CASE WHEN groggy_until IS NULL THEN NULL ELSE groggy_until + p_interval END,
         updated_at = now()
   WHERE raid_id = p_raid_id;
END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_resolve(p_session_id bigint, p_outcome text, p_reason text, p_score integer)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE
  v_s public.raid_clash_sessions%ROWTYPE; v_now timestamptz; v_freeze interval; v_eff jsonb;
  v_component numeric := 0; v_buff timestamptz; v_block timestamptz; v_attack_interval numeric;
  v_cur bigint; v_max bigint; v_pen bigint := NULL; v_barrier_ok boolean := false;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase IN ('RESOLVED','CANCELLED') THEN RETURN; END IF;
  IF p_outcome NOT IN ('GREAT_SUCCESS','SUCCESS','FAILED') THEN RAISE EXCEPTION 'Invalid CLASH outcome %', p_outcome; END IF;
  v_now := clock_timestamp();
  v_freeze := v_now - v_s.triggered_at;
  PERFORM public.raid_clash_shift_timeline(v_s.raid_id, v_freeze);
  v_eff := v_s.config->'effects'->p_outcome;

  IF p_outcome IN ('GREAT_SUCCESS','SUCCESS') THEN
    v_component := GREATEST(0::numeric, COALESCE((v_eff->>'clash_component')::numeric,0));
    v_buff := v_now + make_interval(secs => COALESCE((v_eff->>'buff_seconds')::numeric,10)::double precision);
    v_block := v_now + make_interval(secs => COALESCE((v_eff->>'block_seconds')::numeric,10)::double precision);
    SELECT boss_attack_interval_seconds INTO v_attack_interval FROM public.raid_combat_configs WHERE raid_id = v_s.raid_id;
    UPDATE public.raid_combat_states
       SET next_boss_attack_at = public.raid_clash_next_attack_after(next_boss_attack_at, v_block, v_attack_interval),
           updated_at = now()
     WHERE raid_id = v_s.raid_id;
  ELSE
    SELECT cs.barrier_current_hp, cs.barrier_max_hp, COALESCE(cfg.enabled,false)
      INTO v_cur, v_max, v_barrier_ok
      FROM public.raid_combat_states cs LEFT JOIN public.raid_combat_configs cfg ON cfg.raid_id = cs.raid_id
     WHERE cs.raid_id = v_s.raid_id FOR UPDATE OF cs;
    v_pen := ROUND(GREATEST(0,COALESCE(v_cur,0))::numeric * COALESCE((v_eff->>'barrier_penalty_ratio_of_current')::numeric,0.20))::bigint;
    IF v_barrier_ok AND COALESCE(v_max,0) > 0 AND v_pen > 0 THEN
      PERFORM public.raid_apply_barrier_damage(v_s.raid_id, v_pen, 0, 'CLASH_FAILED',
        jsonb_build_object('clash_session_id', v_s.id, 'ratio_of_current', COALESCE((v_eff->>'barrier_penalty_ratio_of_current')::numeric,0.20), 'barrier_before', v_cur));
    ELSE
      v_pen := 0;
    END IF;
  END IF;

  UPDATE public.raid_clash_sessions
     SET phase = 'RESOLVED', outcome = p_outcome, outcome_reason = p_reason, score = p_score,
         resolved_at = v_now, frozen_seconds = round(EXTRACT(EPOCH FROM v_freeze)::numeric, 3),
         buff_until = v_buff, boss_attack_block_until = v_block, clash_component = v_component,
         barrier_penalty_amount = v_pen, barrier_penalty_applied = (p_outcome = 'FAILED'),
         version = version + 1, updated_at = now()
   WHERE id = v_s.id;

  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'CLASH_' || p_outcome, COALESCE(CASE WHEN p_outcome = 'FAILED' THEN v_pen ELSE p_score END,0),
          jsonb_build_object('clash_session_id', v_s.id, 'score', p_score, 'reason', p_reason,
            'selected_participant_id', v_s.selected_participant_id,
            'buff_until', v_buff, 'boss_attack_block_until', v_block, 'clash_component', v_component,
            'barrier_penalty', v_pen, 'frozen_seconds', round(EXTRACT(EPOCH FROM v_freeze)::numeric,3)));
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'CLASH_RESUMED', 0, jsonb_build_object('clash_session_id', v_s.id, 'outcome', p_outcome,
          'frozen_seconds', round(EXTRACT(EPOCH FROM v_freeze)::numeric,3)));
END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_start_play(p_session_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_now timestamptz := clock_timestamp(); v_start timestamptz;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'SELECTED' THEN RETURN; END IF;
  v_start := GREATEST(v_now, v_s.selected_at + make_interval(secs => ((v_s.config->>'reveal_ms')::numeric/1000.0)::double precision));
  UPDATE public.raid_clash_sessions
     SET phase = 'PLAYING',
         ready_at = CASE WHEN p_reason = 'READY' THEN v_now ELSE ready_at END,
         play_starts_at = v_start,
         play_deadline_at = v_start + make_interval(secs => ((public.raid_clash_ideal_ms(v_s.config,7)
                              + (v_s.config->>'bad_ms')::integer + (v_s.config->>'latency_slack_ms')::integer)::numeric/1000.0)::double precision),
         version = version + 1, updated_at = now()
   WHERE id = v_s.id;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'CLASH_PLAY_STARTED', 0, jsonb_build_object('clash_session_id', v_s.id, 'reason', p_reason, 'play_starts_at', v_start));
END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_finish_play(p_session_id bigint, p_source text, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_score integer;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'PLAYING' THEN RETURN; END IF;
  INSERT INTO public.raid_clash_inputs(session_id, note_index, participant_id, expected_key, judgment, points, source, flag, received_at)
  SELECT v_s.id, g.i, v_s.selected_participant_id, v_s.note_keys[g.i + 1], 'MISS', 0, p_source, 'NOT_SUBMITTED', clock_timestamp()
    FROM generate_series(0,7) g(i)
   WHERE NOT EXISTS (SELECT 1 FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id AND x.note_index = g.i);
  SELECT COALESCE(sum(points),0)::integer INTO v_score FROM public.raid_clash_inputs WHERE session_id = v_s.id;
  PERFORM public.raid_clash_resolve(v_s.id, public.raid_clash_outcome(v_score, v_s.config), p_reason, v_score);
END;
$clash$;

-- Advances the CLASH state machine by the server clock. Callers already hold the raid mutation gate.
CREATE OR REPLACE FUNCTION public.raid_clash_advance(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_status text; v_now timestamptz; v_pick bigint; v_count integer;
BEGIN
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('frozen', false, 'phase', NULL); END IF;

  IF v_s.phase IN ('VOLUNTEERING','SELECTED','PLAYING') THEN
    SELECT status INTO v_status FROM public.raids WHERE id = p_raid_id;
    IF v_status IN ('COMPLETED','FAILED','ARCHIVED') THEN
      UPDATE public.raid_clash_sessions SET phase = 'CANCELLED', outcome_reason = 'RAID_ENDED_' || v_status,
             resolved_at = clock_timestamp(), version = version + 1, updated_at = now() WHERE id = v_s.id;
      INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
      VALUES (p_raid_id, 'CLASH_CANCELLED', 0, jsonb_build_object('clash_session_id', v_s.id, 'raid_status', v_status));
    ELSIF v_status = 'ACTIVE' THEN
      v_now := clock_timestamp();
      IF v_s.phase = 'VOLUNTEERING' AND v_now >= v_s.volunteer_accept_until THEN
        SELECT v.participant_id INTO v_pick
          FROM public.raid_clash_volunteers v
          JOIN public.raid_participants p ON p.id = v.participant_id AND NOT COALESCE(p.attack_blocked,false)
         WHERE v.session_id = v_s.id
         ORDER BY random() LIMIT 1;
        IF v_pick IS NULL THEN
          PERFORM public.raid_clash_resolve(v_s.id, 'FAILED', 'NO_VOLUNTEER', NULL);
        ELSE
          UPDATE public.raid_clash_sessions
             SET phase = 'SELECTED', selected_participant_id = v_pick, selected_at = v_now,
                 ready_deadline_at = v_now + make_interval(secs => (((v_s.config->>'reveal_ms')::numeric + (v_s.config->>'ready_timeout_ms')::numeric)/1000.0)::double precision),
                 version = version + 1, updated_at = now()
           WHERE id = v_s.id;
          INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
          VALUES (p_raid_id, 'CLASH_SELECTED', 0, jsonb_build_object('clash_session_id', v_s.id, 'participant_id', v_pick,
                  'volunteer_count', (SELECT count(*) FROM public.raid_clash_volunteers WHERE session_id = v_s.id)));
        END IF;
        SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = v_s.id;
      END IF;
      IF v_s.phase = 'SELECTED' AND v_now >= v_s.ready_deadline_at THEN
        PERFORM public.raid_clash_start_play(v_s.id, 'READY_TIMEOUT');
        SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = v_s.id;
      END IF;
      IF v_s.phase = 'PLAYING' THEN
        SELECT count(*) INTO v_count FROM public.raid_clash_inputs WHERE session_id = v_s.id;
        IF v_count >= 8 OR v_now >= v_s.play_deadline_at THEN
          PERFORM public.raid_clash_finish_play(v_s.id, 'TIMEOUT', CASE WHEN v_count >= 8 THEN 'SCORED' ELSE 'TIMEOUT' END);
        END IF;
      END IF;
    END IF;
    SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = v_s.id;
  END IF;

  RETURN jsonb_build_object(
    'frozen', v_s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'),
    'phase', v_s.phase,
    'buff_until', v_s.buff_until,
    'boss_attack_block_until', v_s.boss_attack_block_until);
END;
$clash$;

-- Public CLASH state for one student (p_participant_id) or for the broadcast (NULL).
CREATE OR REPLACE FUNCTION public.raid_clash_public_state(p_raid_id bigint, p_participant_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_cfg public.raid_clash_configs%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE; v_now timestamptz := clock_timestamp();
  v_selected jsonb := NULL; v_notes jsonb := NULL; v_inputs jsonb; v_score integer; v_volunteers integer := 0; v_me boolean := false;
BEGIN
  SELECT * INTO v_cfg FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('enabled', COALESCE(v_cfg.enabled,false), 'difficulty', COALESCE(v_cfg.difficulty,'EASY'),
                              'session', NULL, 'server_now', v_now);
  END IF;
  SELECT count(*) INTO v_volunteers FROM public.raid_clash_volunteers WHERE session_id = v_s.id;
  IF p_participant_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.raid_clash_volunteers WHERE session_id = v_s.id AND participant_id = p_participant_id) INTO v_me;
  END IF;
  IF v_s.selected_participant_id IS NOT NULL THEN
    SELECT jsonb_build_object('participant_id', p.id, 'student_name', p.snapshot_student_name,
             'guild_name', p.snapshot_guild_name, 'guild_logo_url', p.snapshot_guild_logo_url,
             'character_name', p.snapshot_equipped_character_name, 'character_image_url', p.snapshot_equipped_character_image_url)
      INTO v_selected FROM public.raid_participants p WHERE p.id = v_s.selected_participant_id;
  END IF;
  IF v_s.play_starts_at IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object('index', g.i, 'key', v_s.note_keys[g.i + 1],
             'ideal_at', v_s.play_starts_at + make_interval(secs => (public.raid_clash_ideal_ms(v_s.config, g.i)::numeric/1000.0)::double precision))
             ORDER BY g.i)
      INTO v_notes FROM generate_series(0,7) g(i);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('index', x.note_index, 'judgment', x.judgment, 'points', x.points) ORDER BY x.note_index),'[]'::jsonb),
         COALESCE(sum(x.points),0)::integer
    INTO v_inputs, v_score FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id;
  RETURN jsonb_build_object(
    'enabled', COALESCE(v_cfg.enabled,false), 'difficulty', v_s.difficulty, 'server_now', v_now,
    'session', jsonb_build_object(
      'id', v_s.id, 'version', v_s.version, 'phase', v_s.phase,
      'frozen', v_s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'),
      'triggered_at', v_s.triggered_at, 'volunteer_closes_at', v_s.volunteer_closes_at,
      'volunteer_accept_until', v_s.volunteer_accept_until,
      'volunteer_count', v_volunteers, 'i_volunteered', v_me,
      'i_am_selected', p_participant_id IS NOT NULL AND v_s.selected_participant_id = p_participant_id,
      'selected', v_selected, 'selected_at', v_s.selected_at, 'ready_deadline_at', v_s.ready_deadline_at,
      'play_starts_at', v_s.play_starts_at, 'play_deadline_at', v_s.play_deadline_at,
      'profile', v_s.config - 'effects', 'effects', v_s.config->'effects',
      'notes', v_notes, 'inputs', v_inputs, 'score', v_score,
      'outcome', v_s.outcome, 'outcome_reason', v_s.outcome_reason, 'resolved_at', v_s.resolved_at,
      'frozen_seconds', v_s.frozen_seconds,
      'buff_until', v_s.buff_until, 'buff_active', v_s.phase = 'RESOLVED' AND v_s.buff_until > v_now AND v_s.clash_component > 0,
      'boss_attack_block_until', v_s.boss_attack_block_until,
      'clash_component', v_s.clash_component, 'weak_zone', v_s.weak_zone,
      'barrier_penalty_amount', v_s.barrier_penalty_amount));
END;
$clash$;

-- ---------------------------------------------------------------------
-- 4. Student RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_volunteer_raid_clash(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE; v_reason text := NULL;
BEGIN
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_clash_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'VOLUNTEERING' THEN v_reason := 'NOT_VOLUNTEERING';
  ELSIF COALESCE(v_part.attack_blocked,false) THEN v_reason := 'ATTACK_BLOCKED';
  ELSIF clock_timestamp() > v_s.volunteer_accept_until THEN v_reason := 'CLOSED';
  ELSE
    INSERT INTO public.raid_clash_volunteers(session_id, participant_id) VALUES (v_s.id, v_part.id)
    ON CONFLICT (session_id, participant_id) DO NOTHING;
  END IF;
  RETURN jsonb_build_object('accepted', v_reason IS NULL, 'reason', v_reason,
                            'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
END;
$clash$;

CREATE OR REPLACE FUNCTION public.student_ready_raid_clash(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE; v_reason text := NULL;
BEGIN
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_clash_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND OR v_s.selected_participant_id IS DISTINCT FROM v_part.id THEN v_reason := 'NOT_SELECTED';
  ELSIF v_s.phase = 'SELECTED' THEN PERFORM public.raid_clash_start_play(v_s.id, 'READY');
  ELSIF v_s.phase <> 'PLAYING' THEN v_reason := 'NOT_READY_PHASE';
  END IF;
  RETURN jsonb_build_object('accepted', v_reason IS NULL, 'reason', v_reason,
                            'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
END;
$clash$;

CREATE OR REPLACE FUNCTION public.student_submit_raid_clash_input(p_raid_id bigint, p_note_index integer, p_key_code text, p_offset_ms integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE
  v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE;
  v_existing public.raid_clash_inputs%ROWTYPE; v_now timestamptz; v_ideal timestamptz; v_delta integer;
  v_expected text; v_judgment text; v_source text := 'INPUT'; v_flag text := NULL; v_count integer;
BEGIN
  IF p_note_index IS NULL OR p_note_index < 0 OR p_note_index > 7 THEN RAISE EXCEPTION 'Invalid CLASH note index' USING ERRCODE = 'P0213'; END IF;
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  v_now := clock_timestamp();

  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND OR v_s.selected_participant_id IS DISTINCT FROM v_part.id THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'NOT_SELECTED', 'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
  END IF;
  SELECT * INTO v_existing FROM public.raid_clash_inputs WHERE session_id = v_s.id AND note_index = p_note_index;
  IF FOUND THEN
    RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'note_index', p_note_index,
                              'judgment', v_existing.judgment, 'points', v_existing.points,
                              'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
  END IF;
  IF v_s.phase <> 'PLAYING' OR v_now > v_s.play_deadline_at THEN
    PERFORM public.raid_clash_advance(p_raid_id);
    RETURN jsonb_build_object('accepted', false, 'reason', 'NOT_PLAYING', 'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
  END IF;

  v_expected := v_s.note_keys[p_note_index + 1];
  v_ideal := v_s.play_starts_at + make_interval(secs => (public.raid_clash_ideal_ms(v_s.config, p_note_index)::numeric/1000.0)::double precision);
  v_delta := round(EXTRACT(EPOCH FROM (v_now - v_ideal)) * 1000)::integer;

  IF p_key_code IS NULL OR p_offset_ms IS NULL THEN
    v_judgment := 'MISS'; v_source := 'CLIENT_MISS';
  ELSIF p_key_code <> v_expected THEN
    v_judgment := 'MISS'; v_flag := 'WRONG_KEY';
  ELSIF (v_delta - p_offset_ms) < -((v_s.config->>'early_slack_ms')::integer)
     OR (v_delta - p_offset_ms) > (v_s.config->>'latency_slack_ms')::integer THEN
    v_judgment := 'MISS'; v_flag := 'IMPLAUSIBLE_TIMING';
  ELSE
    v_judgment := public.raid_clash_judge(p_offset_ms, v_s.config);
  END IF;

  INSERT INTO public.raid_clash_inputs(session_id, note_index, participant_id, expected_key, key_code, client_offset_ms,
                                       server_delta_ms, judgment, points, source, flag, received_at)
  VALUES (v_s.id, p_note_index, v_part.id, v_expected, p_key_code, p_offset_ms, v_delta, v_judgment,
          public.raid_clash_points(v_judgment), v_source, v_flag, v_now);
  UPDATE public.raid_clash_sessions SET version = version + 1, updated_at = now() WHERE id = v_s.id;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (p_raid_id, 'CLASH_NOTE_JUDGED', public.raid_clash_points(v_judgment),
          jsonb_build_object('clash_session_id', v_s.id, 'note_index', p_note_index, 'judgment', v_judgment,
                             'points', public.raid_clash_points(v_judgment), 'flag', v_flag));

  SELECT count(*) INTO v_count FROM public.raid_clash_inputs WHERE session_id = v_s.id;
  IF v_count >= 8 THEN PERFORM public.raid_clash_finish_play(v_s.id, 'TIMEOUT', 'SCORED'); END IF;

  RETURN jsonb_build_object('accepted', true, 'duplicate', false, 'note_index', p_note_index,
                            'judgment', v_judgment, 'points', public.raid_clash_points(v_judgment), 'flag', v_flag,
                            'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
END;
$clash$;

-- ---------------------------------------------------------------------
-- 5. Teacher RPCs
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_raid_clash_config(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_classroom integer; v_raid public.raids%ROWTYPE; v_cfg public.raid_clash_configs%ROWTYPE; v_barrier boolean;
BEGIN
  v_classroom := public.raid_teacher_require_raid(p_raid_id);
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id;
  SELECT * INTO v_cfg FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
  SELECT COALESCE(enabled,false) INTO v_barrier FROM public.raid_combat_configs WHERE raid_id = p_raid_id;
  RETURN jsonb_build_object(
    'raid_id', p_raid_id, 'raid_status', v_raid.status,
    'enabled', COALESCE(v_cfg.enabled,false), 'difficulty', COALESCE(v_cfg.difficulty,'EASY'),
    'editable', v_raid.status IN ('DRAFT','LOBBY_OPEN'),
    'barrier_enabled', COALESCE(v_barrier,false),
    'profiles', jsonb_build_object('EASY', public.raid_clash_profile('EASY'), 'NORMAL', public.raid_clash_profile('NORMAL'), 'HARD', public.raid_clash_profile('HARD')),
    'hp_ratio_warnings', COALESCE((SELECT jsonb_agg(jsonb_build_object('seq', p.seq, 'name', p.name, 'pattern_type', p.pattern_type, 'trigger_value', p.trigger_value) ORDER BY p.seq)
                                   FROM public.raid_patterns p WHERE p.raid_id = p_raid_id AND p.is_enabled AND p.trigger_kind = 'HP_RATIO'
                                     AND p.trigger_value BETWEEN 0.45 AND 0.55), '[]'::jsonb),
    'clash', public.raid_clash_public_state(p_raid_id, NULL));
END;
$clash$;

CREATE OR REPLACE FUNCTION public.teacher_save_raid_clash_config(p_raid_id bigint, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_raid public.raids%ROWTYPE; v_enabled boolean; v_difficulty text; v_barrier boolean;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);
  IF v_raid.status NOT IN ('DRAFT','LOBBY_OPEN') THEN
    RAISE EXCEPTION '격돌 설정은 전투 시작 전에만 바꿀 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Invalid CLASH configuration' USING ERRCODE = 'P0213'; END IF;
  v_enabled := COALESCE((p_payload->>'enabled')::boolean, false);
  v_difficulty := upper(COALESCE(NULLIF(btrim(p_payload->>'difficulty'),''),'EASY'));
  IF v_difficulty NOT IN ('EASY','NORMAL','HARD') THEN RAISE EXCEPTION 'CLASH difficulty must be EASY, NORMAL or HARD' USING ERRCODE = 'P0213'; END IF;
  SELECT COALESCE(enabled,false) INTO v_barrier FROM public.raid_combat_configs WHERE raid_id = p_raid_id;
  IF v_enabled AND NOT COALESCE(v_barrier,false) THEN
    RAISE EXCEPTION '격돌은 공명방벽이 켜진 레이드에서만 사용할 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  INSERT INTO public.raid_clash_configs(raid_id, enabled, difficulty, updated_by, updated_at)
  VALUES (p_raid_id, v_enabled, v_difficulty, auth.uid(), now())
  ON CONFLICT (raid_id) DO UPDATE SET enabled = excluded.enabled, difficulty = excluded.difficulty,
                                      updated_by = excluded.updated_by, updated_at = now();
  RETURN public.teacher_get_raid_clash_config(p_raid_id);
END;
$clash$;

CREATE OR REPLACE FUNCTION public.teacher_force_finish_raid_clash(p_raid_id bigint, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_classroom integer; v_s public.raid_clash_sessions%ROWTYPE; v_status text;
BEGIN
  v_classroom := public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_clash_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase NOT IN ('VOLUNTEERING','SELECTED','PLAYING') THEN
    RETURN jsonb_build_object('forced', false, 'reason', 'NOT_ACTIVE', 'clash', public.raid_clash_public_state(p_raid_id, NULL));
  END IF;
  SELECT status INTO v_status FROM public.raids WHERE id = p_raid_id;
  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'CLASH can only be force-finished while the raid is active' USING ERRCODE = 'P0215';
  END IF;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (p_raid_id, 'CLASH_FORCED', 0, jsonb_build_object('clash_session_id', v_s.id, 'phase', v_s.phase,
          'by', auth.uid(), 'note', NULLIF(btrim(COALESCE(p_reason,'')),'')));
  IF v_s.phase = 'PLAYING' THEN
    PERFORM public.raid_clash_finish_play(v_s.id, 'FORCED', 'FORCED');
  ELSE
    PERFORM public.raid_clash_resolve(v_s.id, 'FAILED', 'FORCED', NULL);
  END IF;
  RETURN jsonb_build_object('forced', true, 'clash', public.raid_clash_public_state(p_raid_id, NULL));
END;
$clash$;

-- Teacher test helper: start the CLASH now on an ACTIVE raid (HP is not changed). Once per raid like the 50% trigger.
CREATE OR REPLACE FUNCTION public.teacher_trigger_raid_clash(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_classroom integer; v_raid public.raids%ROWTYPE; v_ctx jsonb; v_id bigint;
BEGIN
  v_classroom := public.raid_teacher_require_raid(p_raid_id);
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  SELECT * INTO v_raid FROM public.raids WHERE id = p_raid_id FOR UPDATE;
  IF v_raid.status <> 'ACTIVE' THEN
    RAISE EXCEPTION '격돌은 전투 중(ACTIVE)일 때만 수동 발동할 수 있습니다' USING ERRCODE = 'P0215';
  END IF;
  v_ctx := public.raid_clash_attack_context(p_raid_id);
  IF NOT COALESCE((v_ctx->>'armed')::boolean,false) THEN
    RAISE EXCEPTION '격돌이 꺼져 있거나 이 레이드에서 이미 발동했습니다' USING ERRCODE = 'P0215';
  END IF;
  v_id := public.raid_clash_begin(p_raid_id);
  IF v_id IS NOT NULL THEN
    INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
    VALUES (p_raid_id, 'CLASH_MANUAL_TRIGGER', 0, jsonb_build_object('clash_session_id', v_id, 'by', auth.uid(),
            'boss_hp', v_raid.current_hp, 'boss_max_hp', v_raid.max_hp));
  END IF;
  RETURN jsonb_build_object('triggered', v_id IS NOT NULL, 'clash', public.raid_clash_public_state(p_raid_id, NULL));
END;
$clash$;

-- ---------------------------------------------------------------------
-- 6. Privileges
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.raid_clash_profile(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_ideal_ms(jsonb,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_judge(integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_points(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_outcome(integer,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_hit_factor(jsonb,numeric,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_next_attack_after(timestamptz,timestamptz,numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_is_frozen(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_attack_context(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_begin(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_shift_timeline(bigint,interval) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_resolve(bigint,text,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_start_play(bigint,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_finish_play(bigint,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_advance(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_public_state(bigint,bigint) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.student_volunteer_raid_clash(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_ready_raid_clash(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_submit_raid_clash_input(bigint,integer,text,integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_raid_clash_config(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_save_raid_clash_config(bigint,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_force_finish_raid_clash(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_trigger_raid_clash(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_volunteer_raid_clash(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_ready_raid_clash(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_raid_clash_input(bigint,integer,text,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_raid_clash_config(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_save_raid_clash_config(bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_force_finish_raid_clash(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_trigger_raid_clash(bigint) TO authenticated;

-- ---------------------------------------------------------------------
-- 7. Surgical patches of existing production functions
-- ---------------------------------------------------------------------
-- 7a. submit_raid_tap_batch: variables
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:vars*/',
$n$  v_break_success boolean:=false;
BEGIN$n$,
$r$  v_break_success boolean:=false;
  /*CLASH_V1:vars*/ v_clash_ctx jsonb:='{}'::jsonb; v_clash_armed boolean:=false; v_clash_trigger boolean:=false;
BEGIN$r$);

-- 7b. submit_raid_tap_batch: reject every tap while frozen (recorded for idempotent retries)
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:frozen_guard*/',
$n$  IF v_raid.status<>'ACTIVE' THEN RAISE EXCEPTION 'Raid is not accepting attacks' USING ERRCODE='P0215'; END IF;
$n$,
$r$  IF v_raid.status<>'ACTIVE' THEN RAISE EXCEPTION 'Raid is not accepting attacks' USING ERRCODE='P0215'; END IF;
  /*CLASH_V1:frozen_guard*/
  v_clash_ctx:=public.raid_clash_attack_context(p_raid_id);
  IF COALESCE((v_clash_ctx->>'frozen')::boolean,false) THEN
    v_result:=jsonb_build_object(
      'raid_id',p_raid_id,'batch_id',p_batch_id,'requested',v_requested,'accepted',0,'rejected',v_requested,
      'results',(SELECT COALESCE(jsonb_agg(jsonb_build_object('accepted',false,'reason','CLASH_ACTIVE')),'[]'::jsonb) FROM generate_series(1,v_requested)),
      'raid_hp',v_raid.current_hp,
      'raid_hp_ratio',CASE WHEN v_raid.max_hp>0 THEN v_raid.current_hp::numeric/v_raid.max_hp::numeric ELSE 0 END,
      'my_total_damage',v_participant.total_damage,'raid_status','ACTIVE','barrier_collapsed',false,
      'clash_active',true,'clash_triggered',false,'pattern',NULL);
    INSERT INTO public.raid_attack_batches(
      raid_id,participant_id,client_batch_id,requested_taps,accepted_taps,rejected_taps,total_damage,crit_count,
      zone_summary,damage_summary,result_payload,raid_hp_before,raid_hp_after,created_at
    ) VALUES (
      p_raid_id,v_participant.id,p_batch_id,v_requested,0,v_requested,0,0,
      jsonb_build_object('clash_active',true),jsonb_build_object('min',0,'max',0,'avg',0),
      v_result,v_raid.current_hp,v_raid.current_hp,clock_timestamp()
    );
    RETURN v_result;
  END IF;
  v_clash_armed:=COALESCE((v_clash_ctx->>'armed')::boolean,false) AND v_raid.max_hp>0 AND v_raid.current_hp*2>v_raid.max_hp;
$r$);

-- 7c. submit_raid_tap_batch: taps after the 50% crossing tap are rejected
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:loop_guard*/',
$n$  FOR v_tap IN SELECT value FROM jsonb_array_elements(p_taps) LOOP
$n$,
$r$  FOR v_tap IN SELECT value FROM jsonb_array_elements(p_taps) LOOP
    /*CLASH_V1:loop_guard*/
    IF v_clash_trigger THEN
      v_rejected:=v_rejected+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('accepted',false,'reason','CLASH'));
      CONTINUE;
    END IF;
$r$);

-- 7d. submit_raid_tap_batch: damage factor (identical without an active CLASH buff)
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:damage*/',
$n$*v_zone_multiplier*v_pattern_multiplier*v_player_multiplier*$n$,
$r$*v_zone_multiplier*/*CLASH_V1:damage*/public.raid_clash_hit_factor(v_clash_ctx,v_x,v_y,v_pattern_multiplier,v_groggy_multiplier)*v_enrage_multiplier*$r$);

-- 7e. submit_raid_tap_batch: detect the first tap that brings boss HP to <= 50%
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:detect*/',
$n$    v_batch_damage:=v_batch_damage+v_boss_damage;
    v_accepted:=v_accepted+1;
$n$,
$r$    /*CLASH_V1:detect*/
    IF v_clash_armed AND NOT v_clash_trigger AND v_hp_working>0 AND v_hp_working*2<=v_raid.max_hp THEN v_clash_trigger:=true; END IF;
    v_batch_damage:=v_batch_damage+v_boss_damage;
    v_accepted:=v_accepted+1;
$r$);

-- 7f. submit_raid_tap_batch: open the CLASH session together with the HP update
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:begin*/',
$n$  UPDATE public.raids SET current_hp=v_hp_working,updated_at=now() WHERE id=p_raid_id;
$n$,
$r$  UPDATE public.raids SET current_hp=v_hp_working,updated_at=now() WHERE id=p_raid_id;
  /*CLASH_V1:begin*/
  IF v_clash_trigger AND v_hp_working>0 THEN PERFORM public.raid_clash_begin(p_raid_id); END IF;
$r$);

-- 7g. submit_raid_tap_batch: tell the client a CLASH just began
SELECT brand_backup.replace_once('public.submit_raid_tap_batch(bigint,uuid,jsonb)'::regprocedure, '/*CLASH_V1:result*/',
$n$    'barrier_collapsed',v_barrier_collapsed,
$n$,
$r$    'barrier_collapsed',v_barrier_collapsed,
    /*CLASH_V1:result*/ 'clash_triggered',v_clash_trigger AND v_hp_working>0,
$r$);

-- 7h. raid_combat_tick: variables
SELECT brand_backup.replace_once('public.raid_combat_tick(bigint)'::regprocedure, '/*CLASH_V1:tick_vars*/',
$n$v_damage_result jsonb; v_next_at timestamptz;$n$,
$r$v_damage_result jsonb; v_next_at timestamptz; /*CLASH_V1:tick_vars*/ v_clash_tick jsonb:='{}'::jsonb; v_clash_interval numeric;$r$);

-- 7i. raid_combat_tick: advance CLASH; while frozen no patterns and no boss attacks
SELECT brand_backup.replace_once('public.raid_combat_tick(bigint)'::regprocedure, '/*CLASH_V1:tick_advance*/',
$n$  v_pattern_result:=public.raid_advance_patterns(p_raid_id); v_now:=clock_timestamp();$n$,
$r$  /*CLASH_V1:tick_advance*/
  v_clash_tick:=public.raid_clash_advance(p_raid_id);
  IF COALESCE((v_clash_tick->>'frozen')::boolean,false) THEN
    RETURN jsonb_build_object('raid_id',p_raid_id,'attack_applied',false,'reason','CLASH_FROZEN','clash_phase',v_clash_tick->>'phase','server_now',clock_timestamp());
  END IF;
  v_pattern_result:=public.raid_advance_patterns(p_raid_id); v_now:=clock_timestamp();$r$);

-- 7j. raid_combat_tick: no boss basic attack during the success block; next slot keeps the cadence
SELECT brand_backup.replace_once('public.raid_combat_tick(bigint)'::regprocedure, '/*CLASH_V1:tick_block*/',
$n$  IF v_preview_next IS NULL OR v_preview_next>v_now THEN$n$,
$r$  /*CLASH_V1:tick_block*/
  IF v_preview_next IS NOT NULL AND v_preview_next<=v_now AND NULLIF(v_clash_tick->>'boss_attack_block_until','') IS NOT NULL
     AND (v_clash_tick->>'boss_attack_block_until')::timestamptz>v_now THEN
    SELECT boss_attack_interval_seconds INTO v_clash_interval FROM public.raid_combat_configs WHERE raid_id=p_raid_id;
    v_preview_next:=public.raid_clash_next_attack_after(v_preview_next,(v_clash_tick->>'boss_attack_block_until')::timestamptz,v_clash_interval);
    UPDATE public.raid_combat_states SET next_boss_attack_at=v_preview_next,updated_at=now() WHERE raid_id=p_raid_id;
    RETURN jsonb_build_object('raid_id',p_raid_id,'attack_applied',false,'reason','CLASH_ATTACK_BLOCKED','next_boss_attack_at',v_preview_next,'boss_attack_seq',v_preview_seq,'pattern',v_pattern_result,'server_now',v_now);
  END IF;
  IF v_preview_next IS NULL OR v_preview_next>v_now THEN$r$);

-- 7k. raid_advance_patterns: frozen guard (also blocks manual pattern triggers)
SELECT brand_backup.replace_once('public.raid_advance_patterns(bigint)'::regprocedure, '/*CLASH_V1:patterns_guard*/',
$n$  IF v_raid.status<>'ACTIVE' THEN RETURN jsonb_build_object('raid_id',p_raid_id,'changed',false,'raid_status',v_raid.status,'server_now',v_now); END IF;
$n$,
$r$  IF v_raid.status<>'ACTIVE' THEN RETURN jsonb_build_object('raid_id',p_raid_id,'changed',false,'raid_status',v_raid.status,'server_now',v_now); END IF;
  /*CLASH_V1:patterns_guard*/
  IF public.raid_clash_is_frozen(p_raid_id) THEN RETURN jsonb_build_object('raid_id',p_raid_id,'changed',false,'reason','CLASH_FROZEN','server_now',v_now); END IF;
$r$);

-- 7l. get_raid_battle_state: CLASH state for this student
SELECT brand_backup.replace_once('public.get_raid_battle_state(bigint)'::regprocedure, '/*CLASH_V1:battle_state*/',
$n$'me',jsonb_build_object('participant_id',part.id,$n$,
$r$/*CLASH_V1:battle_state*/'clash',public.raid_clash_public_state(r.id,part.id),
    'me',jsonb_build_object('participant_id',part.id,$r$);

-- 7m. teacher_get_raid_broadcast_state: CLASH state for the 16:9 broadcast
SELECT brand_backup.replace_once('public.teacher_get_raid_broadcast_state(bigint)'::regprocedure, '/*CLASH_V1:broadcast_state*/',
$n$    'participants', coalesce(participants.rows,'[]'::jsonb)$n$,
$r$    /*CLASH_V1:broadcast_state*/ 'clash', public.raid_clash_public_state(r.id,NULL),
    'participants', coalesce(participants.rows,'[]'::jsonb)$r$);

-- 7n. broadcast feedback trigger: forward CLASH events to the teacher broadcast in real time
SELECT brand_backup.replace_once('public.raid_emit_combat_broadcast_feedback()'::regprocedure, '/*CLASH_V1:feedback*/',
$n$'BREAK_SUCCESS','BREAK_FAILED','GROGGY_STARTED','GROGGY_ENDED','ENRAGE_STARTED'$n$,
$r$'BREAK_SUCCESS','BREAK_FAILED','GROGGY_STARTED','GROGGY_ENDED','ENRAGE_STARTED',
      /*CLASH_V1:feedback*/ 'CLASH_STARTED','CLASH_SELECTED','CLASH_PLAY_STARTED','CLASH_NOTE_JUDGED','CLASH_RESUMED','CLASH_CANCELLED','CLASH_FORCED'$r$);

-- 7o. teacher_pause_raid: blocked while a CLASH is in progress
SELECT brand_backup.replace_once('public.teacher_pause_raid(bigint)'::regprocedure, '/*CLASH_V1:pause_guard*/',
$n$  if v_raid.status<>'ACTIVE' then
    raise exception 'Only an active Raid can be paused' using errcode='P0215';
  end if;
$n$,
$r$  if v_raid.status<>'ACTIVE' then
    raise exception 'Only an active Raid can be paused' using errcode='P0215';
  end if;
  /*CLASH_V1:pause_guard*/
  if public.raid_clash_is_frozen(p_raid_id) then
    raise exception '격돌 진행 중에는 일시정지할 수 없습니다' using errcode='P0215';
  end if;
$r$);

-- 7p. teacher_resume_raid: a running CLASH buff/block keeps its remaining time across a pause
SELECT brand_backup.replace_once('public.teacher_resume_raid(bigint)'::regprocedure, '/*CLASH_V1:resume_shift*/',
$n$      groggy_until = case when groggy_until is null then null else groggy_until + v_pause_interval end,
      updated_at=now()
  where raid_id=p_raid_id and v_pause_seconds>0;
$n$,
$r$      groggy_until = case when groggy_until is null then null else groggy_until + v_pause_interval end,
      updated_at=now()
  where raid_id=p_raid_id and v_pause_seconds>0;

  /*CLASH_V1:resume_shift*/
  update public.raid_clash_sessions
  set buff_until = case when buff_until is not null and buff_until > v_paused_at then buff_until + v_pause_interval else buff_until end,
      boss_attack_block_until = case when boss_attack_block_until is not null and boss_attack_block_until > v_paused_at then boss_attack_block_until + v_pause_interval else boss_attack_block_until end,
      updated_at = now()
  where raid_id=p_raid_id and phase='RESOLVED' and v_pause_seconds>0;
$r$);

-- ---------------------------------------------------------------------
-- 8. Sanity
-- ---------------------------------------------------------------------
DO $sanity$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t.fn || ' ' || t.marker, ', ') INTO v_missing FROM (VALUES
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:vars*/'),
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:frozen_guard*/'),
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:loop_guard*/'),
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:damage*/'),
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:detect*/'),
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:begin*/'),
    ('submit_raid_tap_batch(bigint,uuid,jsonb)','/*CLASH_V1:result*/'),
    ('raid_combat_tick(bigint)','/*CLASH_V1:tick_vars*/'),
    ('raid_combat_tick(bigint)','/*CLASH_V1:tick_advance*/'),
    ('raid_combat_tick(bigint)','/*CLASH_V1:tick_block*/'),
    ('raid_advance_patterns(bigint)','/*CLASH_V1:patterns_guard*/'),
    ('get_raid_battle_state(bigint)','/*CLASH_V1:battle_state*/'),
    ('teacher_get_raid_broadcast_state(bigint)','/*CLASH_V1:broadcast_state*/'),
    ('raid_emit_combat_broadcast_feedback()','/*CLASH_V1:feedback*/'),
    ('teacher_pause_raid(bigint)','/*CLASH_V1:pause_guard*/'),
    ('teacher_resume_raid(bigint)','/*CLASH_V1:resume_shift*/')
  ) AS t(fn, marker)
  WHERE strpos(pg_get_functiondef(('public.' || fn)::regprocedure), marker) = 0;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'CLASH patch incomplete: %', v_missing; END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_configs WHERE enabled) THEN
    RAISE EXCEPTION 'CLASH must not be enabled for any raid by this migration';
  END IF;
END;
$sanity$;
