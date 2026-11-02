-- =============================================================================
-- B.R.A.N.D 2.0 — GAME 4 Starlink — run binding, A/B/C verification seed pack,
-- server-authoritative submission. 2026-10-30.
--
-- Design (no shared Arcade RPC is replaced):
--   * The common lifecycle stays exactly as production:
--       student_create_arcade_run / student_create_arcade_verification_run
--       -> COUNTDOWN -> student_begin_arcade_run -> PLAYING -> submit.
--   * The shared create/begin RPCs reveal arcade_runs.schedule_seed during the
--     countdown. Starlink therefore never uses schedule_seed for gameplay.
--     When a Starlink run turns PLAYING, an AFTER UPDATE trigger binds a hidden
--     gameplay_seed + run_nonce in public.arcade_starlink_04_run_bindings:
--       STANDARD      -> fresh server random seed
--       VERIFICATION  -> period seed pack slot A/B/C chosen by the student's
--                        immutable permutation and the attempt opportunity.
--     The binding is created in the same transaction as the PLAYING stamp.
--   * Technical recovery keeps the same opportunity number (existing core
--     behaviour) and therefore the same A/B/C seed, with a new run/nonce.
--   * student_submit_starlink_04_run replays seed+events on the server and
--     writes the result into the existing arcade_runs / arcade_run_submissions
--     and arcade_capture_verification_attempt pipeline.
--
-- Safety:
--   * New tables only; existing tables are not altered.
--   * The trigger body returns immediately for every non-Starlink game.
--   * Internal helpers are not executable by anon/authenticated.
-- =============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_replay(bigint,jsonb,integer)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_generate_initial_board(bigint)') IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] apply 20261030_10_starlink_04_deterministic_engine.sql first.';
  END IF;
  IF to_regprocedure('public.student_begin_arcade_run(bigint)') IS NULL
     OR to_regprocedure('public.arcade_capture_verification_attempt(bigint)') IS NULL
     OR to_regprocedure('public.arcade_generate_run_seed()') IS NULL
     OR to_regprocedure('public.arcade_sha256_hex(text)') IS NULL
     OR to_regprocedure('public.arcade_pgcrypto_schema()') IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] required Arcade core functions are missing.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='arcade_runs' AND column_name='schedule_seed'
  ) THEN
    RAISE EXCEPTION '[STARLINK 04] arcade_runs.schedule_seed is missing; production schema differs.';
  END IF;
END;
$preflight$;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.arcade_starlink_04_seed_packs (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  status text NOT NULL DEFAULT 'READY',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  locked_at timestamptz,
  CONSTRAINT arcade_starlink_04_seed_packs_status_check CHECK (status IN ('READY','LOCKED')),
  CONSTRAINT arcade_starlink_04_seed_packs_lock_shape CHECK ((status='READY' AND locked_at IS NULL) OR (status='LOCKED' AND locked_at IS NOT NULL)),
  CONSTRAINT arcade_starlink_04_seed_packs_period_unique UNIQUE (game_id, period_id)
);

CREATE TABLE IF NOT EXISTS public.arcade_starlink_04_seed_pack_slots (
  pack_id bigint NOT NULL REFERENCES public.arcade_starlink_04_seed_packs(id),
  slot text NOT NULL,
  gameplay_seed bigint NOT NULL,
  initial_board_hash text NOT NULL,
  initial_largest_component integer NOT NULL,
  initial_accepted_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT arcade_starlink_04_seed_pack_slots_pkey PRIMARY KEY (pack_id, slot),
  CONSTRAINT arcade_starlink_04_seed_pack_slots_slot_check CHECK (slot IN ('A','B','C')),
  CONSTRAINT arcade_starlink_04_seed_pack_slots_seed_check CHECK (gameplay_seed BETWEEN 1 AND 4294967295),
  CONSTRAINT arcade_starlink_04_seed_pack_slots_seed_unique UNIQUE (pack_id, gameplay_seed),
  CONSTRAINT arcade_starlink_04_seed_pack_slots_board_unique UNIQUE (pack_id, initial_board_hash)
);

-- One immutable A/B/C permutation per student per pack (period). A teacher
-- RESET + new session reuses this order, so permutations cannot be rerolled.
CREATE TABLE IF NOT EXISTS public.arcade_starlink_04_seed_orders (
  pack_id bigint NOT NULL REFERENCES public.arcade_starlink_04_seed_packs(id),
  student_id integer NOT NULL,
  slot_order text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT arcade_starlink_04_seed_orders_pkey PRIMARY KEY (pack_id, student_id),
  CONSTRAINT arcade_starlink_04_seed_orders_shape CHECK (
    array_length(slot_order,1)=3
    AND slot_order @> ARRAY['A','B','C']::text[]
    AND ARRAY['A','B','C']::text[] @> slot_order
  )
);

CREATE TABLE IF NOT EXISTS public.arcade_starlink_04_run_bindings (
  run_id bigint PRIMARY KEY REFERENCES public.arcade_runs(id),
  gameplay_seed bigint NOT NULL,
  run_nonce uuid NOT NULL,
  seed_source text NOT NULL,
  pack_id bigint REFERENCES public.arcade_starlink_04_seed_packs(id),
  pack_slot text,
  verification_session_id bigint,
  opportunity_number integer,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT arcade_starlink_04_run_bindings_nonce_unique UNIQUE (run_nonce),
  CONSTRAINT arcade_starlink_04_run_bindings_seed_check CHECK (gameplay_seed BETWEEN 1 AND 4294967295),
  CONSTRAINT arcade_starlink_04_run_bindings_source_check CHECK (
    (seed_source='STANDARD_RANDOM' AND pack_id IS NULL AND pack_slot IS NULL)
    OR (seed_source='VERIFICATION_PACK' AND pack_id IS NOT NULL AND pack_slot IN ('A','B','C') AND opportunity_number IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS ix_arcade_starlink_04_run_bindings_pack ON public.arcade_starlink_04_run_bindings(pack_id, pack_slot);

ALTER TABLE public.arcade_starlink_04_seed_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_starlink_04_seed_pack_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_starlink_04_seed_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_starlink_04_run_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.arcade_starlink_04_seed_packs, public.arcade_starlink_04_seed_pack_slots,
  public.arcade_starlink_04_seed_orders, public.arcade_starlink_04_run_bindings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_starlink_04_seed_packs_id_seq FROM PUBLIC, anon, authenticated;

-- Immutability: slots/orders/bindings are append-only; a pack can only go READY -> LOCKED.
CREATE OR REPLACE FUNCTION public.arcade_starlink_04_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Nested IFs: OLD/NEW fields are only touched for the packs table.
  IF TG_TABLE_NAME='arcade_starlink_04_seed_packs' AND TG_OP='UPDATE' THEN
    IF OLD.status='READY' AND NEW.status='LOCKED'
       AND NEW.id=OLD.id AND NEW.classroom_id=OLD.classroom_id AND NEW.period_id=OLD.period_id AND NEW.game_id=OLD.game_id THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION '[STARLINK 04] % is immutable (% blocked).', TG_TABLE_NAME, TG_OP USING ERRCODE='P0280';
END;
$$;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_block_mutation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS arcade_starlink_04_seed_packs_guard ON public.arcade_starlink_04_seed_packs;
CREATE TRIGGER arcade_starlink_04_seed_packs_guard BEFORE UPDATE OR DELETE ON public.arcade_starlink_04_seed_packs
  FOR EACH ROW EXECUTE FUNCTION public.arcade_starlink_04_block_mutation();
DROP TRIGGER IF EXISTS arcade_starlink_04_seed_pack_slots_guard ON public.arcade_starlink_04_seed_pack_slots;
CREATE TRIGGER arcade_starlink_04_seed_pack_slots_guard BEFORE UPDATE OR DELETE ON public.arcade_starlink_04_seed_pack_slots
  FOR EACH ROW EXECUTE FUNCTION public.arcade_starlink_04_block_mutation();
DROP TRIGGER IF EXISTS arcade_starlink_04_seed_orders_guard ON public.arcade_starlink_04_seed_orders;
CREATE TRIGGER arcade_starlink_04_seed_orders_guard BEFORE UPDATE OR DELETE ON public.arcade_starlink_04_seed_orders
  FOR EACH ROW EXECUTE FUNCTION public.arcade_starlink_04_block_mutation();
DROP TRIGGER IF EXISTS arcade_starlink_04_run_bindings_guard ON public.arcade_starlink_04_run_bindings;
CREATE TRIGGER arcade_starlink_04_run_bindings_guard BEFORE UPDATE OR DELETE ON public.arcade_starlink_04_run_bindings
  FOR EACH ROW EXECUTE FUNCTION public.arcade_starlink_04_block_mutation();

-- -----------------------------------------------------------------------------
-- 2. Internal helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_starlink_04_game_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$ SELECT id FROM public.arcade_games WHERE code='starlink_04' $$;

-- Server-side random permutation of A/B/C (pgcrypto, never client supplied).
CREATE OR REPLACE FUNCTION public.arcade_starlink_04_random_slot_order()
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bytes bytea;
  v_pick integer;
BEGIN
  EXECUTE format('SELECT %I.gen_random_bytes(2)', public.arcade_pgcrypto_schema()) INTO v_bytes;
  -- 65536 mod 6 bias is < 0.01%; acceptable for order assignment (not scoring).
  v_pick := (get_byte(v_bytes,0)*256 + get_byte(v_bytes,1)) % 6;
  RETURN CASE v_pick
    WHEN 0 THEN ARRAY['A','B','C'] WHEN 1 THEN ARRAY['A','C','B'] WHEN 2 THEN ARRAY['B','A','C']
    WHEN 3 THEN ARRAY['B','C','A'] WHEN 4 THEN ARRAY['C','A','B'] ELSE ARRAY['C','B','A'] END;
END;
$$;

-- Creates (once) the A/B/C pack for a period. Preflight per spec §33.2:
-- HARD playable + initial SOFT (largest component <= 8), distinct seeds,
-- distinct initial boards. Concurrent callers converge on one pack.
CREATE OR REPLACE FUNCTION public.arcade_starlink_04_ensure_seed_pack(
  p_classroom_id integer,
  p_period_id bigint
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_game_id bigint := public.arcade_starlink_04_game_id();
  v_pack_id bigint;
  v_slot text;
  v_seed bigint;
  v_board jsonb;
  v_hash text;
  v_tries integer;
BEGIN
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] game is not registered.' USING ERRCODE='P0281';
  END IF;
  SELECT id INTO v_pack_id FROM public.arcade_starlink_04_seed_packs
  WHERE game_id=v_game_id AND period_id=p_period_id;
  IF v_pack_id IS NOT NULL THEN
    RETURN v_pack_id;
  END IF;

  INSERT INTO public.arcade_starlink_04_seed_packs(classroom_id,period_id,game_id)
  VALUES (p_classroom_id,p_period_id,v_game_id)
  ON CONFLICT (game_id,period_id) DO NOTHING
  RETURNING id INTO v_pack_id;

  IF v_pack_id IS NULL THEN
    -- Another transaction created it; the unique index wait guarantees it is committed now.
    SELECT id INTO v_pack_id FROM public.arcade_starlink_04_seed_packs
    WHERE game_id=v_game_id AND period_id=p_period_id;
    RETURN v_pack_id;
  END IF;

  FOREACH v_slot IN ARRAY ARRAY['A','B','C'] LOOP
    v_tries := 0;
    LOOP
      v_tries := v_tries + 1;
      IF v_tries > 500 THEN
        RAISE EXCEPTION '[STARLINK 04] could not prepare verification seed slot %.', v_slot USING ERRCODE='P0282';
      END IF;
      v_seed := public.arcade_generate_run_seed();
      v_board := public.arcade_starlink_04_generate_initial_board(v_seed);
      CONTINUE WHEN v_board->>'acceptedBy' <> 'SOFT';
      v_hash := public.arcade_sha256_hex((v_board->'board')::text);
      CONTINUE WHEN EXISTS (
        SELECT 1 FROM public.arcade_starlink_04_seed_pack_slots s
        WHERE s.pack_id=v_pack_id AND (s.gameplay_seed=v_seed OR s.initial_board_hash=v_hash)
      );
      INSERT INTO public.arcade_starlink_04_seed_pack_slots(
        pack_id,slot,gameplay_seed,initial_board_hash,initial_largest_component,initial_accepted_by
      ) VALUES (
        v_pack_id,v_slot,v_seed,v_hash,(v_board->'metrics'->>'largestComponent')::integer,v_board->>'acceptedBy'
      );
      EXIT;
    END LOOP;
  END LOOP;
  RETURN v_pack_id;
END;
$$;

-- AFTER UPDATE trigger on arcade_runs. Binds gameplay seed + nonce at PLAYING.
CREATE OR REPLACE FUNCTION public.arcade_starlink_04_bind_on_playing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_game_id bigint;
  v_attempt public.arcade_verification_attempts%ROWTYPE;
  v_session public.arcade_verification_sessions%ROWTYPE;
  v_pack_id bigint;
  v_order text[];
  v_slot text;
  v_seed bigint;
BEGIN
  v_game_id := public.arcade_starlink_04_game_id();
  IF v_game_id IS NULL OR NEW.game_id IS DISTINCT FROM v_game_id THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.arcade_starlink_04_run_bindings b WHERE b.run_id=NEW.id) THEN
    RETURN NULL;
  END IF;

  IF NEW.run_context='VERIFICATION' THEN
    SELECT * INTO v_attempt FROM public.arcade_verification_attempts WHERE run_id=NEW.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[STARLINK 04] verification attempt link is missing.' USING ERRCODE='P0254';
    END IF;
    SELECT * INTO v_session FROM public.arcade_verification_sessions WHERE id=v_attempt.session_id;
    IF v_attempt.opportunity_number NOT BETWEEN 1 AND 3 THEN
      RAISE EXCEPTION '[STARLINK 04] verification opportunity must be 1..3 for the A/B/C pack.' USING ERRCODE='P0283';
    END IF;

    v_pack_id := public.arcade_starlink_04_ensure_seed_pack(v_session.classroom_id, v_session.period_id);
    -- Lock the pack at the first verification PLAYING (spec §33.2).
    UPDATE public.arcade_starlink_04_seed_packs
    SET status='LOCKED', locked_at=clock_timestamp()
    WHERE id=v_pack_id AND status='READY';

    INSERT INTO public.arcade_starlink_04_seed_orders(pack_id,student_id,slot_order)
    VALUES (v_pack_id, NEW.student_id, public.arcade_starlink_04_random_slot_order())
    ON CONFLICT (pack_id,student_id) DO NOTHING;
    SELECT slot_order INTO v_order FROM public.arcade_starlink_04_seed_orders
    WHERE pack_id=v_pack_id AND student_id=NEW.student_id;

    v_slot := v_order[v_attempt.opportunity_number];
    SELECT gameplay_seed INTO v_seed FROM public.arcade_starlink_04_seed_pack_slots
    WHERE pack_id=v_pack_id AND slot=v_slot;
    IF v_seed IS NULL THEN
      RAISE EXCEPTION '[STARLINK 04] verification seed slot % is missing.', v_slot USING ERRCODE='P0282';
    END IF;

    INSERT INTO public.arcade_starlink_04_run_bindings(
      run_id,gameplay_seed,run_nonce,seed_source,pack_id,pack_slot,verification_session_id,opportunity_number
    ) VALUES (
      NEW.id,v_seed,gen_random_uuid(),'VERIFICATION_PACK',v_pack_id,v_slot,v_session.id,v_attempt.opportunity_number
    );
  ELSE
    INSERT INTO public.arcade_starlink_04_run_bindings(run_id,gameplay_seed,run_nonce,seed_source)
    VALUES (NEW.id, public.arcade_generate_run_seed(), gen_random_uuid(), 'STANDARD_RANDOM');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS arcade_starlink_04_bind_on_playing ON public.arcade_runs;
CREATE TRIGGER arcade_starlink_04_bind_on_playing
  AFTER UPDATE OF status ON public.arcade_runs
  FOR EACH ROW
  WHEN (NEW.status = 'PLAYING' AND OLD.status IS DISTINCT FROM 'PLAYING')
  EXECUTE FUNCTION public.arcade_starlink_04_bind_on_playing();

-- -----------------------------------------------------------------------------
-- 3. Student RPCs
-- -----------------------------------------------------------------------------
-- Same as student_begin_arcade_run, plus the hidden gameplay seed and nonce,
-- which only exist after the server stamped PLAYING.
CREATE OR REPLACE FUNCTION public.student_begin_starlink_04_run(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_game_id bigint := public.arcade_starlink_04_game_id();
  v_run public.arcade_runs%ROWTYPE;
  v_begin jsonb;
  v_binding public.arcade_starlink_04_run_bindings%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id;
  IF NOT FOUND OR v_game_id IS NULL OR v_run.game_id IS DISTINCT FROM v_game_id
     OR v_run.student_id IS DISTINCT FROM public.current_student_id()
     OR v_run.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE='P0199';
  END IF;

  -- Validates owner/state/countdown and stamps PLAYING (+ binding trigger).
  v_begin := public.student_begin_arcade_run(p_run_id);

  SELECT * INTO v_binding FROM public.arcade_starlink_04_run_bindings WHERE run_id=p_run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[STARLINK 04] gameplay seed binding failed.' USING ERRCODE='P0284';
  END IF;

  RETURN (v_begin - 'schedule_seed') || jsonb_build_object(
    'gameplay_seed', v_binding.gameplay_seed,
    'run_nonce', v_binding.run_nonce,
    'run_context', v_run.run_context,
    'seed_source', v_binding.seed_source
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_submit_starlink_04_run(
  p_run_id bigint,
  p_run_nonce uuid,
  p_input_events jsonb,
  p_client_end_wall_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_game_id bigint := public.arcade_starlink_04_game_id();
  v_run public.arcade_runs%ROWTYPE;
  v_binding public.arcade_starlink_04_run_bindings%ROWTYPE;
  v_config jsonb;
  v_submitted_at timestamptz := clock_timestamp();
  v_payload_hash text;
  v_existing public.arcade_run_submissions%ROWTYPE;
  v_replay jsonb;
  v_error text;
  v_server_elapsed_ms integer;
  v_end_wall integer;
  v_tolerance_ms integer;
  v_early_tolerance_ms integer;
  v_stats jsonb;
  v_capture jsonb;
  v_event_count integer;
BEGIN
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE='P0195';
  END IF;
  SELECT * INTO v_run FROM public.arcade_runs WHERE id=p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id OR v_run.classroom_id IS DISTINCT FROM v_classroom_id
     OR v_game_id IS NULL OR v_run.game_id IS DISTINCT FROM v_game_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE='P0199';
  END IF;

  SELECT * INTO v_binding FROM public.arcade_starlink_04_run_bindings WHERE run_id=v_run.id;
  IF NOT FOUND OR p_run_nonce IS NULL OR v_binding.run_nonce IS DISTINCT FROM p_run_nonce THEN
    -- Never mutates the run: a forged/stale nonce cannot burn or overwrite a run.
    RAISE EXCEPTION '[STARLINK 04] run nonce does not match this run.' USING ERRCODE='P0285';
  END IF;

  v_payload_hash := public.arcade_sha256_hex(
    coalesce(p_input_events::text,'null')||'|'||coalesce(p_client_end_wall_ms::text,'')||'|'||p_run_nonce::text);

  -- Duplicate submit (e.g. lost response): same payload -> same stored result.
  SELECT * INTO v_existing FROM public.arcade_run_submissions WHERE run_id=v_run.id;
  IF FOUND THEN
    IF v_existing.payload_hash IS DISTINCT FROM v_payload_hash THEN
      RAISE EXCEPTION '[STARLINK 04] this run was already submitted with a different payload.' USING ERRCODE='P0286';
    END IF;
    RETURN jsonb_build_object(
      'accepted', v_run.status='VERIFIED', 'idempotent_replay', true, 'run_id', v_run.id,
      'official_score', v_run.official_score, 'official_duration_ms', v_run.official_duration_ms,
      'game_over_at', v_run.game_over_at, 'stats', v_run.stats,
      'code', v_run.rejection_code, 'message', v_run.rejection_reason,
      'run_context', v_run.run_context, 'verification_capture', NULL);
  END IF;

  IF v_run.status<>'PLAYING' OR v_run.play_started_at IS NULL THEN
    -- e.g. EXPIRED by a teacher technical cancel / force-close: late submits never revive a run.
    RAISE EXCEPTION '[ARCADE] this run is not ready for submission.' USING ERRCODE='P0202';
  END IF;

  SELECT config INTO v_config FROM public.arcade_game_rule_versions WHERE id=v_run.rule_version_id;
  IF v_config->>'game_code' IS DISTINCT FROM 'starlink_04' THEN
    RAISE EXCEPTION '[STARLINK 04] this run does not use Starlink rules.' USING ERRCODE='P0203';
  END IF;

  IF p_input_events IS NULL OR jsonb_typeof(p_input_events)<>'array' OR jsonb_array_length(p_input_events)>5000
     OR p_client_end_wall_ms IS NULL OR p_client_end_wall_ms < 0 OR p_client_end_wall_ms > 180000 THEN
    UPDATE public.arcade_runs SET status='REJECTED',submitted_at=v_submitted_at,
      rejection_code='INPUT_EVENTS_INVALID',rejection_reason='입력 기록 형식이 올바르지 않습니다.'
    WHERE id=v_run.id RETURNING * INTO v_run;
    IF v_run.run_context='VERIFICATION' THEN v_capture := public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'run_id',v_run.id,'code','INPUT_EVENTS_INVALID','message','입력 기록 형식이 올바르지 않습니다.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;
  v_event_count := jsonb_array_length(p_input_events);

  UPDATE public.arcade_runs SET status='SUBMITTING',submitted_at=v_submitted_at WHERE id=v_run.id;

  BEGIN
    v_replay := public.arcade_starlink_04_replay(v_binding.gameplay_seed, p_input_events, p_client_end_wall_ms);
  EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
    v_replay := NULL;
  END;

  v_server_elapsed_ms := floor(extract(epoch FROM (v_submitted_at - v_run.play_started_at))*1000)::integer;

  INSERT INTO public.arcade_run_submissions(run_id,input_events,input_event_count,client_game_over_elapsed_ms,payload_hash,validation_metadata,submitted_at)
  VALUES (v_run.id, p_input_events, v_event_count, p_client_end_wall_ms, v_payload_hash,
    jsonb_build_object(
      'valid', v_replay IS NOT NULL,
      'engine', 'starlink_04_v0.3',
      'seed_source', v_binding.seed_source,
      'pack_slot', v_binding.pack_slot,
      'replay_error', v_error,
      'server_elapsed_ms', v_server_elapsed_ms,
      'game_end_wall_ms', v_replay->'game_end_wall_ms',
      'paused_total_ms', v_replay->'paused_total_ms',
      'official_score', v_replay->'official_score'),
    v_submitted_at);

  IF v_replay IS NULL THEN
    UPDATE public.arcade_runs SET status='REJECTED',
      rejection_code='REPLAY_REJECTED',
      rejection_reason='게임 규칙상 불가능한 입력이 있어 공식 기록으로 인정되지 않았습니다.'
    WHERE id=v_run.id RETURNING * INTO v_run;
    IF v_run.run_context='VERIFICATION' THEN v_capture := public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'run_id',v_run.id,'code',v_run.rejection_code,'message',v_run.rejection_reason,'run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  v_end_wall := (v_replay->>'game_end_wall_ms')::integer;
  v_early_tolerance_ms := least(greatest(coalesce((v_config->>'submissionEarlyToleranceMs')::integer,100),0),100);
  v_tolerance_ms := coalesce((v_config->>'server_elapsed_tolerance_ms')::integer,20000);
  IF v_server_elapsed_ms < v_end_wall - v_early_tolerance_ms OR v_server_elapsed_ms > v_end_wall + v_tolerance_ms THEN
    UPDATE public.arcade_runs SET status='REJECTED',
      rejection_code=CASE WHEN v_server_elapsed_ms < v_end_wall - v_early_tolerance_ms THEN 'SERVER_TIME_TOO_EARLY' ELSE 'SERVER_TIME_MISMATCH' END,
      rejection_reason='서버 시간과 게임 진행 시간이 크게 달라 공식 기록으로 인정되지 않았습니다.'
    WHERE id=v_run.id RETURNING * INTO v_run;
    UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_time_valid',false) WHERE run_id=v_run.id;
    IF v_run.run_context='VERIFICATION' THEN v_capture := public.arcade_capture_verification_attempt(v_run.id); END IF;
    RETURN jsonb_build_object('accepted',false,'run_id',v_run.id,'code',v_run.rejection_code,'message','게임 시간 검증에 실패했습니다. 다시 시도해 주세요.','run_context',v_run.run_context,'verification_capture',v_capture);
  END IF;

  v_stats := jsonb_build_object(
    'total_removed_stars', (v_replay->'stats'->>'totalRemovedStars')::integer,
    'normal_clear_count', (v_replay->'stats'->>'normalClearCount')::integer,
    'loop_count', (v_replay->'stats'->>'loopCount')::integer,
    'max_link_length', (v_replay->'stats'->>'maxLinkLength')::integer,
    'max_combo', (v_replay->'stats'->>'maxCombo')::integer,
    'largest_loop_removed_count', (v_replay->'stats'->>'largestLoopRemovedCount')::integer,
    'reshuffle_count', (v_replay->'stats'->>'reshuffleCount')::integer,
    'game_end_wall_ms', v_end_wall);

  UPDATE public.arcade_runs SET status='VERIFIED',
    game_over_at=v_run.play_started_at + (v_end_wall * interval '1 millisecond'),
    verified_at=v_submitted_at,
    official_score=(v_replay->>'official_score')::bigint,
    official_duration_ms=(v_replay->>'official_duration_ms')::integer,
    stats=v_stats, rejection_code=NULL, rejection_reason=NULL
  WHERE id=v_run.id RETURNING * INTO v_run;
  UPDATE public.arcade_run_submissions SET validation_metadata=validation_metadata||jsonb_build_object('server_time_valid',true) WHERE run_id=v_run.id;
  IF v_run.run_context='VERIFICATION' THEN v_capture := public.arcade_capture_verification_attempt(v_run.id); END IF;
  RETURN jsonb_build_object('accepted',true,'run_id',v_run.id,'official_score',v_run.official_score,'official_duration_ms',v_run.official_duration_ms,
    'game_over_at',v_run.game_over_at,'stats',v_run.stats,'run_context',v_run.run_context,'verification_capture',v_capture);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. ACL — internal helpers closed; only the two narrow student RPCs are open.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.arcade_starlink_04_game_id() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_random_slot_order() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_ensure_seed_pack(integer,bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_bind_on_playing() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.student_begin_starlink_04_run(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.student_begin_starlink_04_run(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_starlink_04_run(bigint,uuid,jsonb,integer) TO authenticated;

COMMIT;
NOTIFY pgrst, 'reload schema';
