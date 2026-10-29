-- =====================================================================
-- B.R.A.N.D 2.0 — Raid CLASH (격돌) V2: 대표 3인 동시 도전
-- 2026-10-29
--
-- Requires CLASH V1 (20261028_01_raid_clash_v1.sql, applied 2026-10-29).
--
-- What changes
-- * Up to 3 volunteers are drawn at random (profile.player_count = 3).
--   Each plays the SAME 8 notes at the same time.
-- * Team score = sum of every player's points.
--   Thresholds = per-player thresholds x number of drawn players
--   (3 players: success 24, great 39 out of 48 / 2 players: 16, 26 / 1 player: 8, 13 as before).
-- * A drawn player who has not sent READY when the ready timer ends gets
--   MISS on all 8 notes (source NOT_READY); the others play normally.
-- * Effects (buff, attack block, 20% barrier penalty), the 50% trigger,
--   the freeze, pause guard and damage formula are unchanged.
--
-- What does not change
-- * Existing V1 data: the one finished session keeps its result; it is
--   back-filled as a 1-player session (slot 0).
-- * Production functions patched by V1 (tap batch, tick, patterns,
--   battle/broadcast state, feedback, pause/resume) are NOT touched again:
--   they call the CLASH helpers below by the same names and signatures.
-- =====================================================================

-- Safety: never swap the rules in the middle of a running CLASH.
DO $guard$
BEGIN
  IF to_regclass('public.raid_clash_sessions') IS NULL THEN
    RAISE EXCEPTION 'CLASH V1 must be applied before V2';
  END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE phase IN ('VOLUNTEERING','SELECTED','PLAYING')) THEN
    RAISE EXCEPTION '격돌이 진행 중인 레이드가 있습니다. 격돌이 끝난 뒤 다시 적용해 주세요.';
  END IF;
END;
$guard$;

-- ---------------------------------------------------------------------
-- 0. Backup of the current CLASH functions
-- ---------------------------------------------------------------------
INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5)
SELECT 'PRE_CLASH_V2_20261029', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f','p') AND p.proname ILIKE '%raid_clash%'
ON CONFLICT (snapshot_label, signature) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------
ALTER TABLE public.raid_clash_sessions ADD COLUMN IF NOT EXISTS player_count smallint;

CREATE TABLE IF NOT EXISTS public.raid_clash_players (
  session_id bigint NOT NULL REFERENCES public.raid_clash_sessions(id) ON DELETE CASCADE,
  slot smallint NOT NULL CHECK (slot BETWEEN 0 AND 2),
  participant_id bigint NOT NULL REFERENCES public.raid_participants(id) ON DELETE CASCADE,
  ready_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, slot),
  UNIQUE (session_id, participant_id)
);
ALTER TABLE public.raid_clash_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.raid_clash_players FROM PUBLIC, anon, authenticated;

ALTER TABLE public.raid_clash_inputs ADD COLUMN IF NOT EXISTS slot smallint NOT NULL DEFAULT 0;
DO $pk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.raid_clash_inputs'::regclass AND conname = 'raid_clash_inputs_slot_check') THEN
    ALTER TABLE public.raid_clash_inputs ADD CONSTRAINT raid_clash_inputs_slot_check CHECK (slot BETWEEN 0 AND 2);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.raid_clash_inputs'::regclass AND conname = 'raid_clash_inputs_pkey'
               AND pg_get_constraintdef(oid) = 'PRIMARY KEY (session_id, note_index)') THEN
    ALTER TABLE public.raid_clash_inputs DROP CONSTRAINT raid_clash_inputs_pkey;
    ALTER TABLE public.raid_clash_inputs ADD CONSTRAINT raid_clash_inputs_pkey PRIMARY KEY (session_id, slot, note_index);
  END IF;
  ALTER TABLE public.raid_clash_inputs DROP CONSTRAINT IF EXISTS raid_clash_inputs_source_check;
  ALTER TABLE public.raid_clash_inputs ADD CONSTRAINT raid_clash_inputs_source_check
    CHECK (source IN ('INPUT','CLIENT_MISS','TIMEOUT','FORCED','NOT_READY'));
END;
$pk$;

-- Back-fill: V1 sessions become 1-player sessions (slot 0).
INSERT INTO public.raid_clash_players(session_id, slot, participant_id, ready_at)
SELECT s.id, 0, s.selected_participant_id, COALESCE(s.ready_at, s.play_starts_at)
FROM public.raid_clash_sessions s
WHERE s.selected_participant_id IS NOT NULL
ON CONFLICT DO NOTHING;
UPDATE public.raid_clash_sessions
   SET player_count = 1
 WHERE player_count IS NULL AND selected_participant_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. Pure helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raid_clash_profile(p_difficulty text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE
  v_d text := upper(COALESCE(p_difficulty,'EASY'));
  v_approach integer; v_spacing integer; v_perfect integer; v_good integer; v_bad integer;
BEGIN
  /*CLASH_V2*/
  IF v_d = 'HARD' THEN
    v_approach := 1050; v_spacing := 1150; v_perfect := 55; v_good := 125; v_bad := 230;
  ELSIF v_d = 'NORMAL' THEN
    v_approach := 1300; v_spacing := 1400; v_perfect := 80; v_good := 180; v_bad := 300;
  ELSE
    v_d := 'EASY';
    v_approach := 1600; v_spacing := 1700; v_perfect := 100; v_good := 230; v_bad := 360;
  END IF;
  RETURN jsonb_build_object(
    'version',2,'difficulty',v_d,'note_count',8,'player_count',3,
    'keys',jsonb_build_array('KeyQ','KeyW','KeyE','KeyR'),
    'volunteer_ms',5000,'volunteer_grace_ms',2000,'volunteer_button_delay_ms',1000,
    'reveal_ms',2600,'ready_timeout_ms',5000,'countdown_ms',3000,
    'latency_slack_ms',2500,'early_slack_ms',1200,
    'approach_ms',v_approach,'spacing_ms',v_spacing,
    'perfect_ms',v_perfect,'good_ms',v_good,'bad_ms',v_bad,
    'points',jsonb_build_object('PERFECT',2,'GOOD',1,'BAD',0,'MISS',0),
    -- per player; the session threshold is this x number of drawn players
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

-- Planned number of players for a session config (V1 configs have no player_count → 1).
CREATE OR REPLACE FUNCTION public.raid_clash_planned_players(p_cfg jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT GREATEST(1, LEAST(3, COALESCE(NULLIF(p_cfg->>'player_count','')::integer, 1)));
$clash$;

-- Team outcome: per-player thresholds x number of drawn players.
CREATE OR REPLACE FUNCTION public.raid_clash_outcome(p_score integer, p_cfg jsonb, p_players integer)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT CASE
    WHEN COALESCE(p_score,0) >= COALESCE((p_cfg->>'great_score')::integer,13) * GREATEST(1,COALESCE(p_players,1)) THEN 'GREAT_SUCCESS'
    WHEN COALESCE(p_score,0) >= COALESCE((p_cfg->>'success_score')::integer,8) * GREATEST(1,COALESCE(p_players,1)) THEN 'SUCCESS'
    ELSE 'FAILED' END;
$clash$;

-- ---------------------------------------------------------------------
-- 3. Runtime (internal)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raid_clash_start_play(p_session_id bigint, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_now timestamptz := clock_timestamp(); v_start timestamptz; v_not_ready jsonb;
BEGIN
  /*CLASH_V2*/
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

  -- A drawn player who never sent READY: all 8 notes MISS; the others play normally.
  SELECT COALESCE(jsonb_agg(pl.slot ORDER BY pl.slot), '[]'::jsonb) INTO v_not_ready
    FROM public.raid_clash_players pl WHERE pl.session_id = v_s.id AND pl.ready_at IS NULL;
  INSERT INTO public.raid_clash_inputs(session_id, slot, note_index, participant_id, expected_key, judgment, points, source, flag, received_at)
  SELECT v_s.id, pl.slot, g.i, pl.participant_id, v_s.note_keys[g.i + 1], 'MISS', 0, 'NOT_READY', 'NOT_READY', v_now
    FROM public.raid_clash_players pl CROSS JOIN generate_series(0,7) g(i)
   WHERE pl.session_id = v_s.id AND pl.ready_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (v_s.raid_id, 'CLASH_PLAY_STARTED', 0, jsonb_build_object('clash_session_id', v_s.id, 'reason', p_reason,
          'play_starts_at', v_start, 'not_ready_slots', v_not_ready));
END;
$clash$;

CREATE OR REPLACE FUNCTION public.raid_clash_finish_play(p_session_id bigint, p_source text, p_reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_score integer; v_players integer;
BEGIN
  /*CLASH_V2*/
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND OR v_s.phase <> 'PLAYING' THEN RETURN; END IF;
  INSERT INTO public.raid_clash_inputs(session_id, slot, note_index, participant_id, expected_key, judgment, points, source, flag, received_at)
  SELECT v_s.id, pl.slot, g.i, pl.participant_id, v_s.note_keys[g.i + 1], 'MISS', 0, p_source, 'NOT_SUBMITTED', clock_timestamp()
    FROM public.raid_clash_players pl CROSS JOIN generate_series(0,7) g(i)
   WHERE pl.session_id = v_s.id
     AND NOT EXISTS (SELECT 1 FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id AND x.slot = pl.slot AND x.note_index = g.i);
  SELECT COALESCE(sum(points),0)::integer INTO v_score FROM public.raid_clash_inputs WHERE session_id = v_s.id;
  v_players := GREATEST(1, COALESCE(v_s.player_count, 1));
  PERFORM public.raid_clash_resolve(v_s.id, public.raid_clash_outcome(v_score, v_s.config, v_players), p_reason, v_score);
END;
$clash$;

-- Advances the CLASH state machine by the server clock. Callers already hold the raid mutation gate.
CREATE OR REPLACE FUNCTION public.raid_clash_advance(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_s public.raid_clash_sessions%ROWTYPE; v_status text; v_now timestamptz; v_count integer; v_picked integer; v_first bigint;
BEGIN
  /*CLASH_V2*/
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
        -- Draw up to N players at random among the volunteers who can still attack.
        INSERT INTO public.raid_clash_players(session_id, slot, participant_id)
        SELECT v_s.id, (row_number() OVER () - 1)::smallint, q.participant_id
          FROM (SELECT v.participant_id
                  FROM public.raid_clash_volunteers v
                  JOIN public.raid_participants p ON p.id = v.participant_id AND NOT COALESCE(p.attack_blocked,false)
                 WHERE v.session_id = v_s.id
                 ORDER BY random()
                 LIMIT public.raid_clash_planned_players(v_s.config)) q
        ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_picked = ROW_COUNT;
        IF v_picked = 0 THEN
          PERFORM public.raid_clash_resolve(v_s.id, 'FAILED', 'NO_VOLUNTEER', NULL);
        ELSE
          SELECT participant_id INTO v_first FROM public.raid_clash_players WHERE session_id = v_s.id AND slot = 0;
          UPDATE public.raid_clash_sessions
             SET phase = 'SELECTED', selected_participant_id = v_first, player_count = v_picked, selected_at = v_now,
                 ready_deadline_at = v_now + make_interval(secs => (((v_s.config->>'reveal_ms')::numeric + (v_s.config->>'ready_timeout_ms')::numeric)/1000.0)::double precision),
                 version = version + 1, updated_at = now()
           WHERE id = v_s.id;
          INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
          VALUES (p_raid_id, 'CLASH_SELECTED', 0, jsonb_build_object('clash_session_id', v_s.id, 'participant_id', v_first,
                  'participant_ids', (SELECT jsonb_agg(participant_id ORDER BY slot) FROM public.raid_clash_players WHERE session_id = v_s.id),
                  'player_count', v_picked,
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
        IF v_count >= 8 * GREATEST(1, COALESCE(v_s.player_count,1)) OR v_now >= v_s.play_deadline_at THEN
          PERFORM public.raid_clash_finish_play(v_s.id, 'TIMEOUT',
            CASE WHEN v_count >= 8 * GREATEST(1, COALESCE(v_s.player_count,1)) THEN 'SCORED' ELSE 'TIMEOUT' END);
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
  v_players jsonb := '[]'::jsonb; v_selected jsonb := NULL; v_notes jsonb := NULL; v_inputs jsonb; v_score integer;
  v_volunteers integer := 0; v_me boolean := false; v_my_slot integer := NULL; v_n integer; v_planned integer;
BEGIN
  /*CLASH_V2*/
  SELECT * INTO v_cfg FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id;
  IF v_s.id IS NULL THEN
    RETURN jsonb_build_object('enabled', COALESCE(v_cfg.enabled,false), 'difficulty', COALESCE(v_cfg.difficulty,'EASY'),
                              'session', NULL, 'server_now', v_now);
  END IF;
  SELECT count(*) INTO v_volunteers FROM public.raid_clash_volunteers WHERE session_id = v_s.id;
  IF p_participant_id IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.raid_clash_volunteers WHERE session_id = v_s.id AND participant_id = p_participant_id) INTO v_me;
    SELECT slot INTO v_my_slot FROM public.raid_clash_players WHERE session_id = v_s.id AND participant_id = p_participant_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'slot', pl.slot, 'participant_id', p.id, 'student_name', p.snapshot_student_name,
           'guild_name', p.snapshot_guild_name, 'guild_logo_url', p.snapshot_guild_logo_url,
           'character_name', p.snapshot_equipped_character_name, 'character_image_url', p.snapshot_equipped_character_image_url,
           'ready', pl.ready_at IS NOT NULL,
           'judged', (SELECT count(*) FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id AND x.slot = pl.slot),
           'score', (SELECT COALESCE(sum(x.points),0) FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id AND x.slot = pl.slot))
         ORDER BY pl.slot), '[]'::jsonb)
    INTO v_players
    FROM public.raid_clash_players pl JOIN public.raid_participants p ON p.id = pl.participant_id
   WHERE pl.session_id = v_s.id;
  IF jsonb_array_length(v_players) > 0 THEN
    v_selected := (v_players->0) - 'slot' - 'ready' - 'judged' - 'score';
  END IF;

  IF v_s.play_starts_at IS NOT NULL THEN
    SELECT jsonb_agg(jsonb_build_object('index', g.i, 'key', v_s.note_keys[g.i + 1],
             'ideal_at', v_s.play_starts_at + make_interval(secs => (public.raid_clash_ideal_ms(v_s.config, g.i)::numeric/1000.0)::double precision))
             ORDER BY g.i)
      INTO v_notes FROM generate_series(0,7) g(i);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('slot', x.slot, 'index', x.note_index, 'judgment', x.judgment, 'points', x.points)
                            ORDER BY x.slot, x.note_index),'[]'::jsonb),
         COALESCE(sum(x.points),0)::integer
    INTO v_inputs, v_score FROM public.raid_clash_inputs x WHERE x.session_id = v_s.id;

  v_planned := public.raid_clash_planned_players(v_s.config);
  v_n := GREATEST(1, COALESCE(v_s.player_count, v_planned));
  RETURN jsonb_build_object(
    'enabled', COALESCE(v_cfg.enabled,false), 'difficulty', v_s.difficulty, 'server_now', v_now,
    'session', jsonb_build_object(
      'id', v_s.id, 'version', v_s.version, 'phase', v_s.phase,
      'frozen', v_s.phase IN ('VOLUNTEERING','SELECTED','PLAYING'),
      'triggered_at', v_s.triggered_at, 'volunteer_closes_at', v_s.volunteer_closes_at,
      'volunteer_accept_until', v_s.volunteer_accept_until,
      'volunteer_count', v_volunteers, 'i_volunteered', v_me,
      'i_am_selected', v_my_slot IS NOT NULL, 'my_slot', v_my_slot,
      'planned_player_count', v_planned, 'player_count', v_n, 'players', v_players,
      'selected', v_selected, 'selected_at', v_s.selected_at, 'ready_deadline_at', v_s.ready_deadline_at,
      'play_starts_at', v_s.play_starts_at, 'play_deadline_at', v_s.play_deadline_at,
      'profile', v_s.config - 'effects', 'effects', v_s.config->'effects',
      'notes', v_notes, 'inputs', v_inputs, 'score', v_score,
      'score_success', COALESCE((v_s.config->>'success_score')::integer,8) * v_n,
      'score_great', COALESCE((v_s.config->>'great_score')::integer,13) * v_n,
      'score_max', 16 * v_n,
      'outcome', v_s.outcome, 'outcome_reason', v_s.outcome_reason, 'resolved_at', v_s.resolved_at,
      'frozen_seconds', v_s.frozen_seconds,
      'buff_until', v_s.buff_until, 'buff_active', v_s.phase = 'RESOLVED' AND v_s.buff_until > v_now AND v_s.clash_component > 0,
      'boss_attack_block_until', v_s.boss_attack_block_until,
      'clash_component', v_s.clash_component, 'weak_zone', v_s.weak_zone,
      'barrier_penalty_amount', v_s.barrier_penalty_amount));
END;
$clash$;

-- ---------------------------------------------------------------------
-- 4. Student RPCs (same names and signatures as V1)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_ready_raid_clash(p_raid_id bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $clash$
DECLARE v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE;
  v_pl public.raid_clash_players%ROWTYPE; v_reason text := NULL;
BEGIN
  /*CLASH_V2*/
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  PERFORM public.raid_clash_advance(p_raid_id);
  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_pl FROM public.raid_clash_players WHERE session_id = v_s.id AND participant_id = v_part.id FOR UPDATE;
  END IF;
  IF v_s.id IS NULL OR v_pl.session_id IS NULL THEN
    v_reason := 'NOT_SELECTED';
  ELSIF v_s.phase = 'SELECTED' THEN
    UPDATE public.raid_clash_players SET ready_at = COALESCE(ready_at, clock_timestamp())
     WHERE session_id = v_s.id AND slot = v_pl.slot;
    IF NOT EXISTS (SELECT 1 FROM public.raid_clash_players WHERE session_id = v_s.id AND ready_at IS NULL) THEN
      PERFORM public.raid_clash_start_play(v_s.id, 'READY');
    END IF;
  ELSIF v_s.phase = 'PLAYING' THEN
    IF v_pl.ready_at IS NULL THEN v_reason := 'TOO_LATE'; END IF;
  ELSE
    v_reason := 'NOT_READY_PHASE';
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
  v_student integer; v_part public.raid_participants%ROWTYPE; v_s public.raid_clash_sessions%ROWTYPE; v_slot integer;
  v_existing public.raid_clash_inputs%ROWTYPE; v_now timestamptz; v_ideal timestamptz; v_delta integer;
  v_expected text; v_judgment text; v_source text := 'INPUT'; v_flag text := NULL; v_count integer;
BEGIN
  /*CLASH_V2*/
  IF p_note_index IS NULL OR p_note_index < 0 OR p_note_index > 7 THEN RAISE EXCEPTION 'Invalid CLASH note index' USING ERRCODE = 'P0213'; END IF;
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_part FROM public.raid_participants WHERE raid_id = p_raid_id AND student_id = v_student;
  IF NOT FOUND THEN RAISE EXCEPTION 'Raid participant snapshot not found' USING ERRCODE = 'P0202'; END IF;
  PERFORM pg_advisory_xact_lock(77116, (p_raid_id % 2147483647)::integer);
  v_now := clock_timestamp();

  SELECT * INTO v_s FROM public.raid_clash_sessions WHERE raid_id = p_raid_id FOR UPDATE;
  IF FOUND THEN
    SELECT slot INTO v_slot FROM public.raid_clash_players WHERE session_id = v_s.id AND participant_id = v_part.id;
  END IF;
  IF v_s.id IS NULL OR v_slot IS NULL THEN
    RETURN jsonb_build_object('accepted', false, 'reason', 'NOT_SELECTED', 'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
  END IF;
  SELECT * INTO v_existing FROM public.raid_clash_inputs WHERE session_id = v_s.id AND slot = v_slot AND note_index = p_note_index;
  IF FOUND THEN
    RETURN jsonb_build_object('accepted', true, 'duplicate', true, 'note_index', p_note_index,
                              'judgment', v_existing.judgment, 'points', v_existing.points, 'flag', v_existing.flag,
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

  INSERT INTO public.raid_clash_inputs(session_id, slot, note_index, participant_id, expected_key, key_code, client_offset_ms,
                                       server_delta_ms, judgment, points, source, flag, received_at)
  VALUES (v_s.id, v_slot, p_note_index, v_part.id, v_expected, p_key_code, p_offset_ms, v_delta, v_judgment,
          public.raid_clash_points(v_judgment), v_source, v_flag, v_now);
  UPDATE public.raid_clash_sessions SET version = version + 1, updated_at = now() WHERE id = v_s.id;
  INSERT INTO public.raid_combat_events(raid_id, event_type, amount, payload)
  VALUES (p_raid_id, 'CLASH_NOTE_JUDGED', public.raid_clash_points(v_judgment),
          jsonb_build_object('clash_session_id', v_s.id, 'slot', v_slot, 'participant_id', v_part.id,
                             'note_index', p_note_index, 'judgment', v_judgment,
                             'points', public.raid_clash_points(v_judgment), 'flag', v_flag));

  SELECT count(*) INTO v_count FROM public.raid_clash_inputs WHERE session_id = v_s.id;
  IF v_count >= 8 * GREATEST(1, COALESCE(v_s.player_count,1)) THEN PERFORM public.raid_clash_finish_play(v_s.id, 'TIMEOUT', 'SCORED'); END IF;

  RETURN jsonb_build_object('accepted', true, 'duplicate', false, 'note_index', p_note_index,
                            'judgment', v_judgment, 'points', public.raid_clash_points(v_judgment), 'flag', v_flag,
                            'clash', public.raid_clash_public_state(p_raid_id, v_part.id));
END;
$clash$;

-- ---------------------------------------------------------------------
-- 5. Privileges (new helpers are internal; student RPC grants are kept by CREATE OR REPLACE)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.raid_clash_planned_players(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.raid_clash_outcome(integer,jsonb,integer) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. Sanity
-- ---------------------------------------------------------------------
DO $sanity$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t.fn, ', ') INTO v_missing FROM (VALUES
    ('raid_clash_profile(text)'),
    ('raid_clash_start_play(bigint,text)'),
    ('raid_clash_finish_play(bigint,text,text)'),
    ('raid_clash_advance(bigint)'),
    ('raid_clash_public_state(bigint,bigint)'),
    ('student_ready_raid_clash(bigint)'),
    ('student_submit_raid_clash_input(bigint,integer,text,integer)')
  ) AS t(fn)
  WHERE strpos(pg_get_functiondef(('public.' || fn)::regprocedure), '/*CLASH_V2*/') = 0;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'CLASH V2 incomplete: %', v_missing; END IF;
  IF (public.raid_clash_profile('EASY')->>'player_count')::integer <> 3 THEN RAISE EXCEPTION 'CLASH V2 profile not updated'; END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_sessions s WHERE s.selected_participant_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM public.raid_clash_players pl WHERE pl.session_id = s.id)) THEN
    RAISE EXCEPTION 'CLASH V2 back-fill incomplete';
  END IF;
  IF NOT has_function_privilege('authenticated','public.student_ready_raid_clash(bigint)','EXECUTE')
     OR has_function_privilege('anon','public.student_ready_raid_clash(bigint)','EXECUTE')
     OR has_table_privilege('authenticated','public.raid_clash_players','SELECT') THEN
    RAISE EXCEPTION 'CLASH V2 privileges are not as expected';
  END IF;
END;
$sanity$;
