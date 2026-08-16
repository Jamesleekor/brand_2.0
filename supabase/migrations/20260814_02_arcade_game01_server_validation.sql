-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade 0.1 Game #01 server validation
-- 2026-08-14
--
-- Scope
--   * Registers the locked Focus + Reaction + Combo Game #01 rule version.
--   * Issues server-owned runs, deterministically replays input events, and
--     persists only server-verified scores.
--   * Provides read-only leaderboard/result RPCs and teacher invalidation.
--   * Does not perform any Guild 2 monthly contribution update; that belongs
--     to the following atomic-finalization migration.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regprocedure('public.teacher_create_arcade_ranking_period(text,text,integer,text,timestamptz,timestamptz)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] foundation migration must be applied first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    RAISE EXCEPTION '[ARCADE] pgcrypto is required for server-generated run seeds and submission hashes.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Locked Game #01 registry and versioned configuration
-- -----------------------------------------------------------------------------
INSERT INTO public.arcade_games (
  code, internal_name, is_active, available_from, available_until
) VALUES (
  'focus_reaction_01', 'Focus + Reaction + Combo', true, DATE '2026-08-24', NULL
);

INSERT INTO public.arcade_game_rule_versions (
  game_id, version_code, config, is_active, created_by_user_id
)
SELECT
  game.id,
  'v0.1',
  $config$
  {
    "game_code": "focus_reaction_01",
    "countdown_ms": 5000,
    "lives": 3,
    "damage_recovery_ms": 600,
    "max_input_events": 20000,
    "max_client_elapsed_ms": 3600000,
    "client_end_tolerance_ms": 2000,
    "server_elapsed_tolerance_ms": 10000,
    "tiers": {
      "EASY": { "spawn_min_ms": 950, "spawn_max_ms": 1200, "travel_ms": 1800, "hit_window_ms": 260, "no_go_rate_bp": 500, "burst_chance_bp": 0, "burst_min_length": 0, "burst_max_length": 0, "burst_min_interval_ms": 0, "burst_max_interval_ms": 0 },
      "NORMAL": { "spawn_min_ms": 760, "spawn_max_ms": 1000, "travel_ms": 1550, "hit_window_ms": 220, "no_go_rate_bp": 1000, "burst_chance_bp": 1000, "burst_min_length": 2, "burst_max_length": 2, "burst_min_interval_ms": 480, "burst_max_interval_ms": 560 },
      "HARD": { "spawn_min_ms": 600, "spawn_max_ms": 820, "travel_ms": 1350, "hit_window_ms": 180, "no_go_rate_bp": 1500, "burst_chance_bp": 2000, "burst_min_length": 2, "burst_max_length": 2, "burst_min_interval_ms": 360, "burst_max_interval_ms": 440 },
      "VERY_HARD": { "spawn_min_ms": 480, "spawn_max_ms": 700, "travel_ms": 1150, "hit_window_ms": 150, "no_go_rate_bp": 2000, "burst_chance_bp": 3000, "burst_min_length": 2, "burst_max_length": 3, "burst_min_interval_ms": 280, "burst_max_interval_ms": 360 },
      "EXTREME": { "spawn_min_ms": 380, "spawn_max_ms": 580, "travel_ms": 1000, "hit_window_ms": 125, "no_go_rate_bp": 2500, "burst_chance_bp": 4000, "burst_min_length": 2, "burst_max_length": 3, "burst_min_interval_ms": 220, "burst_max_interval_ms": 300 }
    },
    "overdrive": {
      "starts_at_ms": 300000,
      "step_ms": 30000,
      "spawn_interval_multiplier_percent": 95,
      "spawn_min_floor_ms": 280,
      "spawn_max_floor_ms": 420,
      "travel_delta_ms": -40,
      "travel_floor_ms": 820,
      "hit_window_delta_ms": -5,
      "hit_window_floor_ms": 90,
      "no_go_delta_bp": 150,
      "no_go_cap_bp": 3000,
      "burst_chance_delta_bp": 200,
      "burst_chance_cap_bp": 5500,
      "burst_interval_delta_ms": -10,
      "burst_interval_floor_ms": 190
    },
    "combo_multiplier_percent": [100, 110, 120, 130, 140]
  }
  $config$::jsonb,
  true,
  NULL
FROM public.arcade_games game
WHERE game.code = 'focus_reaction_01';

-- -----------------------------------------------------------------------------
-- 2. Internal deterministic Game #01 helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_xorshift32_next(p_state bigint)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint := p_state;
BEGIN
  IF p_state NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[ARCADE] xorshift32 state must be a non-zero unsigned 32-bit integer.'
      USING ERRCODE = 'P0190';
  END IF;

  v_state := (v_state # ((v_state << 13) & 4294967295)) & 4294967295;
  v_state := (v_state # (v_state >> 17)) & 4294967295;
  v_state := (v_state # ((v_state << 5) & 4294967295)) & 4294967295;
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_focus_reaction_01_schedule(
  p_seed bigint,
  p_until_ms integer,
  p_config jsonb
)
RETURNS TABLE(
  signal_index integer,
  spawn_ms integer,
  target_ms integer,
  lane integer,
  signal_kind text,
  travel_ms integer,
  hit_window_ms integer
)
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint := p_seed;
  v_spawn_ms integer := 0;
  v_signal_index integer := 0;
  v_tier text;
  v_tier_config jsonb;
  v_extreme_config jsonb;
  v_overdrive jsonb;
  v_steps integer := 0;
  v_spawn_min integer;
  v_spawn_max integer;
  v_travel integer;
  v_hit_window integer;
  v_no_go_rate integer;
  v_burst_chance integer;
  v_burst_min_length integer;
  v_burst_max_length integer;
  v_burst_min_interval integer;
  v_burst_max_interval integer;
  v_interval integer;
  v_target integer;
  v_lane integer;
  v_last_lane integer := -1;
  v_same_lane_count integer := 0;
  v_kind text;
  v_burst_length integer;
  v_burst_number integer;
  v_loop_step integer;
BEGIN
  IF p_seed NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[ARCADE] schedule seed is invalid.' USING ERRCODE = 'P0191';
  END IF;
  IF p_until_ms NOT BETWEEN 0 AND 3600000 OR jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION '[ARCADE] schedule arguments are invalid.' USING ERRCODE = 'P0192';
  END IF;

  v_overdrive := p_config -> 'overdrive';
  IF jsonb_typeof(v_overdrive) <> 'object' THEN
    RAISE EXCEPTION '[ARCADE] focus_reaction_01 rule configuration is missing overdrive values.' USING ERRCODE = 'P0193';
  END IF;

  LOOP
    IF v_spawn_ms < 60000 THEN
      v_tier := 'EASY';
    ELSIF v_spawn_ms < 120000 THEN
      v_tier := 'NORMAL';
    ELSIF v_spawn_ms < 180000 THEN
      v_tier := 'HARD';
    ELSIF v_spawn_ms < 240000 THEN
      v_tier := 'VERY_HARD';
    ELSIF v_spawn_ms < 300000 THEN
      v_tier := 'EXTREME';
    ELSE
      v_tier := 'OVERDRIVE';
    END IF;

    IF v_tier = 'OVERDRIVE' THEN
      v_extreme_config := p_config #> '{tiers,EXTREME}';
      v_steps := greatest(0, (v_spawn_ms - (v_overdrive ->> 'starts_at_ms')::integer)
        / (v_overdrive ->> 'step_ms')::integer);
      v_spawn_min := (v_extreme_config ->> 'spawn_min_ms')::integer;
      v_spawn_max := (v_extreme_config ->> 'spawn_max_ms')::integer;
      FOR v_loop_step IN 1..v_steps LOOP
        v_spawn_min := greatest((v_overdrive ->> 'spawn_min_floor_ms')::integer,
          (v_spawn_min * (v_overdrive ->> 'spawn_interval_multiplier_percent')::integer) / 100);
        v_spawn_max := greatest((v_overdrive ->> 'spawn_max_floor_ms')::integer,
          (v_spawn_max * (v_overdrive ->> 'spawn_interval_multiplier_percent')::integer) / 100);
      END LOOP;
      v_travel := greatest((v_overdrive ->> 'travel_floor_ms')::integer,
        (v_extreme_config ->> 'travel_ms')::integer + v_steps * (v_overdrive ->> 'travel_delta_ms')::integer);
      v_hit_window := greatest((v_overdrive ->> 'hit_window_floor_ms')::integer,
        (v_extreme_config ->> 'hit_window_ms')::integer + v_steps * (v_overdrive ->> 'hit_window_delta_ms')::integer);
      v_no_go_rate := least((v_overdrive ->> 'no_go_cap_bp')::integer,
        (v_extreme_config ->> 'no_go_rate_bp')::integer + v_steps * (v_overdrive ->> 'no_go_delta_bp')::integer);
      v_burst_chance := least((v_overdrive ->> 'burst_chance_cap_bp')::integer,
        (v_extreme_config ->> 'burst_chance_bp')::integer + v_steps * (v_overdrive ->> 'burst_chance_delta_bp')::integer);
      v_burst_min_length := (v_extreme_config ->> 'burst_min_length')::integer;
      v_burst_max_length := (v_extreme_config ->> 'burst_max_length')::integer;
      v_burst_min_interval := greatest((v_overdrive ->> 'burst_interval_floor_ms')::integer,
        (v_extreme_config ->> 'burst_min_interval_ms')::integer + v_steps * (v_overdrive ->> 'burst_interval_delta_ms')::integer);
      v_burst_max_interval := greatest(v_burst_min_interval,
        (v_extreme_config ->> 'burst_max_interval_ms')::integer + v_steps * (v_overdrive ->> 'burst_interval_delta_ms')::integer);
    ELSE
      v_tier_config := p_config #> ARRAY['tiers', v_tier];
      IF jsonb_typeof(v_tier_config) <> 'object' THEN
        RAISE EXCEPTION '[ARCADE] focus_reaction_01 rule configuration is missing tier %.', v_tier USING ERRCODE = 'P0193';
      END IF;
      v_spawn_min := (v_tier_config ->> 'spawn_min_ms')::integer;
      v_spawn_max := (v_tier_config ->> 'spawn_max_ms')::integer;
      v_travel := (v_tier_config ->> 'travel_ms')::integer;
      v_hit_window := (v_tier_config ->> 'hit_window_ms')::integer;
      v_no_go_rate := (v_tier_config ->> 'no_go_rate_bp')::integer;
      v_burst_chance := (v_tier_config ->> 'burst_chance_bp')::integer;
      v_burst_min_length := (v_tier_config ->> 'burst_min_length')::integer;
      v_burst_max_length := (v_tier_config ->> 'burst_max_length')::integer;
      v_burst_min_interval := (v_tier_config ->> 'burst_min_interval_ms')::integer;
      v_burst_max_interval := (v_tier_config ->> 'burst_max_interval_ms')::integer;
    END IF;

    IF v_spawn_min <= 0 OR v_spawn_max < v_spawn_min OR v_travel <= 0 OR v_hit_window <= 0
       OR v_no_go_rate NOT BETWEEN 0 AND 10000 OR v_burst_chance NOT BETWEEN 0 AND 10000 THEN
      RAISE EXCEPTION '[ARCADE] focus_reaction_01 rule configuration is invalid.' USING ERRCODE = 'P0193';
    END IF;

    v_state := public.arcade_xorshift32_next(v_state);
    v_interval := v_spawn_min + (v_state % (v_spawn_max - v_spawn_min + 1))::integer;
    v_spawn_ms := v_spawn_ms + v_interval;
    v_target := v_spawn_ms + v_travel;
    EXIT WHEN v_target > p_until_ms;

    v_state := public.arcade_xorshift32_next(v_state);
    v_lane := (v_state % 4)::integer;
    IF v_lane = v_last_lane AND v_same_lane_count >= 2 THEN
      v_state := public.arcade_xorshift32_next(v_state);
      v_lane := (v_last_lane + 1 + (v_state % 3)::integer) % 4;
    END IF;
    IF v_lane = v_last_lane THEN
      v_same_lane_count := v_same_lane_count + 1;
    ELSE
      v_last_lane := v_lane;
      v_same_lane_count := 1;
    END IF;

    v_state := public.arcade_xorshift32_next(v_state);
    v_kind := CASE WHEN (v_state % 10000)::integer < v_no_go_rate THEN 'NO_GO' ELSE 'GO' END;
    v_signal_index := v_signal_index + 1;
    signal_index := v_signal_index;
    spawn_ms := v_spawn_ms;
    target_ms := v_target;
    lane := v_lane;
    signal_kind := v_kind;
    travel_ms := v_travel;
    hit_window_ms := v_hit_window;
    RETURN NEXT;

    IF v_tier <> 'EASY' AND v_burst_chance > 0 THEN
      v_state := public.arcade_xorshift32_next(v_state);
      IF (v_state % 10000)::integer < v_burst_chance THEN
        v_state := public.arcade_xorshift32_next(v_state);
        v_burst_length := v_burst_min_length
          + (v_state % (v_burst_max_length - v_burst_min_length + 1))::integer;
        FOR v_burst_number IN 1..v_burst_length LOOP
          v_state := public.arcade_xorshift32_next(v_state);
          v_interval := v_burst_min_interval
            + (v_state % (v_burst_max_interval - v_burst_min_interval + 1))::integer;
          v_spawn_ms := v_spawn_ms + v_interval;
          v_target := v_spawn_ms + v_travel;
          EXIT WHEN v_target > p_until_ms;

          v_state := public.arcade_xorshift32_next(v_state);
          v_lane := (v_state % 4)::integer;
          IF v_lane = v_last_lane AND v_same_lane_count >= 2 THEN
            v_state := public.arcade_xorshift32_next(v_state);
            v_lane := (v_last_lane + 1 + (v_state % 3)::integer) % 4;
          END IF;
          IF v_lane = v_last_lane THEN
            v_same_lane_count := v_same_lane_count + 1;
          ELSE
            v_last_lane := v_lane;
            v_same_lane_count := 1;
          END IF;

          v_signal_index := v_signal_index + 1;
          signal_index := v_signal_index;
          spawn_ms := v_spawn_ms;
          target_ms := v_target;
          lane := v_lane;
          signal_kind := 'GO';
          travel_ms := v_travel;
          hit_window_ms := v_hit_window;
          RETURN NEXT;
        END LOOP;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_validate_focus_reaction_01_submission(
  p_seed bigint,
  p_config jsonb,
  p_input_events jsonb,
  p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_input record;
  v_signal record;
  v_key text;
  v_times integer[] := ARRAY[]::integer[];
  v_lanes integer[] := ARRAY[]::integer[];
  v_event_count integer := 0;
  v_previous_time integer := -1;
  v_time_text text;
  v_lane_text text;
  v_input_index integer := 1;
  v_lives integer;
  v_combo integer := 0;
  v_max_combo integer := 0;
  v_score bigint := 0;
  v_correct integer := 0;
  v_misses integer := 0;
  v_no_go_errors integer := 0;
  v_wrong_lane_errors integer := 0;
  v_recovery_until integer := -1;
  v_loss_time integer;
  v_game_over_ms integer := NULL;
  v_window_start integer;
  v_window_end integer;
  v_error_ms integer;
  v_base_points integer;
  v_multiplier_percent integer;
  v_accuracy_percent numeric(8,2);
  v_max_events integer;
  v_max_elapsed integer;
  v_end_tolerance integer;
BEGIN
  IF jsonb_typeof(p_input_events) <> 'array' THEN
    RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENTS_NOT_ARRAY', 'message', '입력 기록 형식이 올바르지 않습니다.');
  END IF;
  IF jsonb_typeof(p_config) <> 'object' THEN
    RAISE EXCEPTION '[ARCADE] rule configuration is invalid.' USING ERRCODE = 'P0194';
  END IF;

  v_max_events := coalesce((p_config ->> 'max_input_events')::integer, 20000);
  v_max_elapsed := coalesce((p_config ->> 'max_client_elapsed_ms')::integer, 3600000);
  v_end_tolerance := coalesce((p_config ->> 'client_end_tolerance_ms')::integer, 2000);
  v_lives := coalesce((p_config ->> 'lives')::integer, 3);

  IF p_client_game_over_elapsed_ms NOT BETWEEN 0 AND v_max_elapsed THEN
    RETURN jsonb_build_object('valid', false, 'code', 'ELAPSED_OUT_OF_RANGE', 'message', '게임 시간 기록이 허용 범위를 벗어났습니다.');
  END IF;

  FOR v_input IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_input_events) WITH ORDINALITY
  LOOP
    v_event_count := v_event_count + 1;
    IF v_event_count > v_max_events OR jsonb_typeof(v_input.value) <> 'object' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_INVALID', 'message', '입력 기록이 너무 많거나 형식이 올바르지 않습니다.');
    END IF;
    FOR v_key IN SELECT jsonb_object_keys(v_input.value) LOOP
      IF v_key NOT IN ('elapsed_ms', 'lane') THEN
        RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_EXTRA_FIELD', 'message', '허용되지 않은 입력 기록 항목이 있습니다.');
      END IF;
    END LOOP;
    IF NOT (v_input.value ? 'elapsed_ms') OR NOT (v_input.value ? 'lane')
       OR jsonb_typeof(v_input.value -> 'elapsed_ms') <> 'number'
       OR jsonb_typeof(v_input.value -> 'lane') <> 'number' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_SHAPE', 'message', '입력 기록에 시간 또는 레인이 없습니다.');
    END IF;
    v_time_text := v_input.value ->> 'elapsed_ms';
    v_lane_text := v_input.value ->> 'lane';
    IF v_time_text !~ '^[0-9]+$' OR char_length(v_time_text) > 7
       OR v_lane_text !~ '^[0-3]$' THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_VALUE', 'message', '입력 시간 또는 레인 값이 올바르지 않습니다.');
    END IF;
    IF v_time_text::integer <= v_previous_time OR v_time_text::integer > p_client_game_over_elapsed_ms THEN
      RETURN jsonb_build_object('valid', false, 'code', 'INPUT_EVENT_ORDER', 'message', '입력 시간 순서가 올바르지 않습니다.');
    END IF;
    v_previous_time := v_time_text::integer;
    v_times := array_append(v_times, v_previous_time);
    v_lanes := array_append(v_lanes, v_lane_text::integer);
  END LOOP;

  FOR v_signal IN
    SELECT *
    FROM public.arcade_focus_reaction_01_schedule(p_seed, p_client_game_over_elapsed_ms, p_config)
    ORDER BY signal_index
  LOOP
    EXIT WHEN v_lives <= 0;

    -- Damage recovery neutralizes nearby scheduled signals and ignores inputs
    -- during the 600 ms cascade-protection window.
    WHILE v_input_index <= v_event_count AND v_times[v_input_index] <= v_recovery_until LOOP
      v_input_index := v_input_index + 1;
    END LOOP;
    IF v_signal.target_ms <= v_recovery_until THEN
      CONTINUE;
    END IF;

    v_window_start := v_signal.target_ms - v_signal.hit_window_ms;
    v_window_end := v_signal.target_ms + v_signal.hit_window_ms;

    -- An input before the next active signal's valid window is a wrong input.
    IF v_input_index <= v_event_count AND v_times[v_input_index] < v_window_start THEN
      v_loss_time := v_times[v_input_index];
      v_input_index := v_input_index + 1;
      v_lives := v_lives - 1;
      v_combo := 0;
      v_wrong_lane_errors := v_wrong_lane_errors + 1;
      v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
      IF v_lives <= 0 THEN
        v_game_over_ms := v_loss_time;
      END IF;
      CONTINUE;
    END IF;

    IF v_input_index <= v_event_count AND v_times[v_input_index] <= v_window_end THEN
      v_loss_time := v_times[v_input_index];
      IF v_signal.signal_kind = 'NO_GO' THEN
        v_input_index := v_input_index + 1;
        v_lives := v_lives - 1;
        v_combo := 0;
        v_no_go_errors := v_no_go_errors + 1;
        v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
        IF v_lives <= 0 THEN
          v_game_over_ms := v_loss_time;
        END IF;
        CONTINUE;
      END IF;

      IF v_lanes[v_input_index] <> v_signal.lane OR v_times[v_input_index] < v_window_start THEN
        v_input_index := v_input_index + 1;
        v_lives := v_lives - 1;
        v_combo := 0;
        v_wrong_lane_errors := v_wrong_lane_errors + 1;
        v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
        IF v_lives <= 0 THEN
          v_game_over_ms := v_loss_time;
        END IF;
        CONTINUE;
      END IF;

      v_error_ms := abs(v_times[v_input_index] - v_signal.target_ms);
      v_input_index := v_input_index + 1;
      v_combo := v_combo + 1;
      v_max_combo := greatest(v_max_combo, v_combo);
      v_base_points := 200 - floor((100::numeric * v_error_ms) / v_signal.hit_window_ms)::integer;
      v_multiplier_percent := CASE
        WHEN v_combo >= 100 THEN 140
        WHEN v_combo >= 50 THEN 130
        WHEN v_combo >= 25 THEN 120
        WHEN v_combo >= 10 THEN 110
        ELSE 100
      END;
      v_score := v_score + floor((v_base_points::numeric * v_multiplier_percent) / 100)::bigint;
      v_correct := v_correct + 1;
    ELSIF v_signal.signal_kind = 'GO' THEN
      v_loss_time := v_window_end;
      v_lives := v_lives - 1;
      v_combo := 0;
      v_misses := v_misses + 1;
      v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
      IF v_lives <= 0 THEN
        v_game_over_ms := v_loss_time;
      END IF;
    END IF;
  END LOOP;

  IF v_lives > 0 OR v_game_over_ms IS NULL THEN
    RETURN jsonb_build_object('valid', false, 'code', 'GAME_NOT_OVER', 'message', '게임 종료 전에는 공식 기록을 제출할 수 없습니다.');
  END IF;
  IF p_client_game_over_elapsed_ms < v_game_over_ms
     OR p_client_game_over_elapsed_ms > v_game_over_ms + v_end_tolerance THEN
    RETURN jsonb_build_object('valid', false, 'code', 'GAME_OVER_TIME_MISMATCH', 'message', '게임 종료 시간이 검증 결과와 일치하지 않습니다.');
  END IF;
  IF v_input_index <= v_event_count THEN
    RETURN jsonb_build_object('valid', false, 'code', 'INPUT_AFTER_GAME_OVER', 'message', '게임 종료 뒤의 입력 기록이 감지되었습니다.');
  END IF;

  v_accuracy_percent := CASE
    WHEN v_correct + v_misses + v_wrong_lane_errors = 0 THEN 0
    ELSE round((100.0 * v_correct) / (v_correct + v_misses + v_wrong_lane_errors), 2)
  END;

  RETURN jsonb_build_object(
    'valid', true,
    'official_score', v_score,
    'official_duration_ms', v_game_over_ms,
    'stats', jsonb_build_object(
      'accuracy_percent', v_accuracy_percent,
      'max_combo', v_max_combo,
      'correct_inputs', v_correct,
      'misses', v_misses,
      'no_go_errors', v_no_go_errors,
      'wrong_lane_errors', v_wrong_lane_errors,
      'remaining_lives', greatest(v_lives, 0)
    )
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Public student/teacher RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_seed_bytes bytea;
  v_seed bigint;
  v_seoul_today date;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;
  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code
    AND is_active
    AND available_from <= v_seoul_today
    AND (available_until IS NULL OR available_until >= v_seoul_today);
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
  END IF;

  SELECT * INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id = v_game.id AND is_active
  ORDER BY id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] active game rule version is missing.' USING ERRCODE = 'P0198';
  END IF;

  v_seed_bytes := gen_random_bytes(4);
  v_seed := get_byte(v_seed_bytes, 0)::bigint * 16777216
    + get_byte(v_seed_bytes, 1)::bigint * 65536
    + get_byte(v_seed_bytes, 2)::bigint * 256
    + get_byte(v_seed_bytes, 3)::bigint;
  IF v_seed = 0 THEN
    v_seed := 1;
  END IF;

  INSERT INTO public.arcade_runs (
    classroom_id, student_id, game_id, rule_version_id, status,
    schedule_seed, countdown_started_at
  ) VALUES (
    v_classroom_id, v_student_id, v_game.id, v_rule.id, 'COUNTDOWN',
    v_seed, now()
  )
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'game_code', v_game.code,
    'rule_version', v_rule.version_code,
    'countdown_started_at', v_run.countdown_started_at,
    'countdown_ends_at', v_run.countdown_started_at + ((v_rule.config ->> 'countdown_ms')::integer * interval '1 millisecond'),
    'schedule_seed', v_run.schedule_seed,
    'config', v_rule.config
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_begin_arcade_run(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_countdown_ms integer;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  SELECT run.* INTO v_run
  FROM public.arcade_runs run
  WHERE run.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  IF v_run.status <> 'COUNTDOWN' THEN
    RAISE EXCEPTION '[ARCADE] run cannot begin from its current state.' USING ERRCODE = 'P0200';
  END IF;

  SELECT config INTO v_config FROM public.arcade_game_rule_versions WHERE id = v_run.rule_version_id;
  v_countdown_ms := (v_config ->> 'countdown_ms')::integer;
  IF clock_timestamp() < v_run.countdown_started_at + (v_countdown_ms * interval '1 millisecond') THEN
    RAISE EXCEPTION '[ARCADE] 5-second countdown is not complete yet.' USING ERRCODE = 'P0201';
  END IF;

  UPDATE public.arcade_runs
  SET status = 'PLAYING', play_started_at = clock_timestamp()
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'play_started_at', v_run.play_started_at,
    'schedule_seed', v_run.schedule_seed,
    'config', v_config
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.student_submit_focus_reaction_01_run(
  p_run_id bigint,
  p_input_events jsonb,
  p_client_game_over_elapsed_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_config jsonb;
  v_validation jsonb;
  v_submitted_at timestamptz := clock_timestamp();
  v_server_elapsed_ms integer;
  v_server_tolerance_ms integer;
  v_payload_hash text;
  v_input_event_count integer;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  SELECT run.* INTO v_run
  FROM public.arcade_runs run
  WHERE run.id = p_run_id
  FOR UPDATE;

  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id
     OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  IF v_run.status <> 'PLAYING' OR v_run.play_started_at IS NULL THEN
    RAISE EXCEPTION '[ARCADE] this run is not ready for submission.' USING ERRCODE = 'P0202';
  END IF;
  IF p_client_game_over_elapsed_ms IS NULL
     OR p_client_game_over_elapsed_ms NOT BETWEEN 0 AND 3600000 THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED', submitted_at = v_submitted_at,
        rejection_code = 'ELAPSED_OUT_OF_RANGE', rejection_reason = '게임 시간 기록이 허용 범위를 벗어났습니다.'
    WHERE id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'ELAPSED_OUT_OF_RANGE', 'message', '게임 시간 기록이 올바르지 않습니다.');
  END IF;
  IF p_input_events IS NULL OR jsonb_typeof(p_input_events) <> 'array' THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED', submitted_at = v_submitted_at,
        rejection_code = 'INPUT_EVENTS_NOT_ARRAY', rejection_reason = '입력 기록 형식이 올바르지 않습니다.'
    WHERE id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'INPUT_EVENTS_NOT_ARRAY', 'message', '입력 기록 형식이 올바르지 않습니다.');
  END IF;
  v_input_event_count := jsonb_array_length(p_input_events);
  IF v_input_event_count IS NULL OR v_input_event_count > 20000 THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED', submitted_at = v_submitted_at,
        rejection_code = 'INPUT_EVENT_COUNT_EXCEEDED', rejection_reason = '입력 기록이 허용된 개수를 초과했습니다.'
    WHERE id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'INPUT_EVENT_COUNT_EXCEEDED', 'message', '입력 기록이 너무 많아 공식 기록으로 인정되지 않았습니다.');
  END IF;

  SELECT config INTO v_config
  FROM public.arcade_game_rule_versions
  WHERE id = v_run.rule_version_id;
  IF v_config ->> 'game_code' <> 'focus_reaction_01' THEN
    RAISE EXCEPTION '[ARCADE] this run does not use Game #01 rules.' USING ERRCODE = 'P0203';
  END IF;

  UPDATE public.arcade_runs SET status = 'SUBMITTING', submitted_at = v_submitted_at WHERE id = v_run.id;
  v_validation := public.arcade_validate_focus_reaction_01_submission(
    v_run.schedule_seed, v_config, p_input_events, p_client_game_over_elapsed_ms
  );
  v_payload_hash := encode(digest(p_input_events::text || '|' || p_client_game_over_elapsed_ms::text, 'sha256'), 'hex');

  INSERT INTO public.arcade_run_submissions (
    run_id, input_events, input_event_count, client_game_over_elapsed_ms,
    payload_hash, validation_metadata, submitted_at
  ) VALUES (
    v_run.id, p_input_events, v_input_event_count, p_client_game_over_elapsed_ms,
    v_payload_hash, v_validation, v_submitted_at
  );

  IF coalesce((v_validation ->> 'valid')::boolean, false) IS NOT TRUE THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED',
        rejection_code = v_validation ->> 'code',
        rejection_reason = v_validation ->> 'message'
    WHERE id = v_run.id;
    RETURN jsonb_build_object(
      'accepted', false,
      'code', coalesce(v_validation ->> 'code', 'VALIDATION_FAILED'),
      'message', coalesce(v_validation ->> 'message', '게임 기록을 검증하지 못했습니다.')
    );
  END IF;

  v_server_elapsed_ms := floor(extract(epoch FROM (v_submitted_at - v_run.play_started_at)) * 1000)::integer;
  v_server_tolerance_ms := coalesce((v_config ->> 'server_elapsed_tolerance_ms')::integer, 10000);
  IF v_server_elapsed_ms < (v_validation ->> 'official_duration_ms')::integer - 2000
     OR v_server_elapsed_ms > (v_validation ->> 'official_duration_ms')::integer + v_server_tolerance_ms THEN
    UPDATE public.arcade_runs
    SET status = 'REJECTED',
        rejection_code = 'SERVER_TIME_MISMATCH',
        rejection_reason = '서버 시간과 게임 진행 시간이 크게 달라 공식 기록으로 인정되지 않았습니다.'
    WHERE id = v_run.id;
    UPDATE public.arcade_run_submissions
    SET validation_metadata = validation_metadata || jsonb_build_object(
      'server_elapsed_ms', v_server_elapsed_ms,
      'server_time_valid', false
    )
    WHERE run_id = v_run.id;
    RETURN jsonb_build_object('accepted', false, 'code', 'SERVER_TIME_MISMATCH', 'message', '게임 시간 검증에 실패했습니다. 다시 시도해 주세요.');
  END IF;

  UPDATE public.arcade_runs
  SET status = 'VERIFIED',
      game_over_at = v_run.play_started_at + ((v_validation ->> 'official_duration_ms')::integer * interval '1 millisecond'),
      verified_at = v_submitted_at,
      official_score = (v_validation ->> 'official_score')::bigint,
      official_duration_ms = (v_validation ->> 'official_duration_ms')::integer,
      stats = v_validation -> 'stats',
      rejection_code = NULL,
      rejection_reason = NULL
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  UPDATE public.arcade_run_submissions
  SET validation_metadata = validation_metadata || jsonb_build_object(
    'server_elapsed_ms', v_server_elapsed_ms,
    'server_time_valid', true
  )
  WHERE run_id = v_run.id;

  RETURN jsonb_build_object(
    'accepted', true,
    'run_id', v_run.id,
    'official_score', v_run.official_score,
    'official_duration_ms', v_run.official_duration_ms,
    'game_over_at', v_run.game_over_at,
    'stats', v_run.stats
  );
END;
$$;

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
  v_classroom_id integer;
  v_student_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_result jsonb;
BEGIN
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE = 'P0204';
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND OR v_period.status NOT IN ('ACTIVE', 'FINALIZED') THEN
    RAISE EXCEPTION '[ARCADE] active or finalized ranking period was not found.' USING ERRCODE = 'P0205';
  END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  WITH candidate_runs AS (
    SELECT run.id AS run_id, run.student_id, run.official_score, run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS best_row
    FROM public.arcade_runs run
    WHERE run.classroom_id = v_classroom_id
      AND run.game_id = v_game_id
      AND run.status = 'VERIFIED'
      AND run.game_over_at >= v_period.starts_at
      AND run.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1 FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.run_id, candidate.student_id, candidate.official_score, candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.best_row = 1
  )
  SELECT jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank', ranked.rank,
          'student_id', ranked.student_id,
          'student_name', student.name,
          'official_score', ranked.official_score,
          'game_over_at', ranked.game_over_at
        ) ORDER BY ranked.rank
      ) FILTER (WHERE ranked.rank <= 10),
      '[]'::jsonb
    ),
    'my_rank', max(ranked.rank) FILTER (WHERE ranked.student_id = v_student_id),
    'my_score', max(ranked.official_score) FILTER (WHERE ranked.student_id = v_student_id)
  ) INTO v_result
  FROM ranked
  JOIN public.students student ON student.id = ranked.student_id;

  RETURN coalesce(v_result, jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', '[]'::jsonb,
    'my_rank', NULL,
    'my_score', NULL
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_arcade_run_result(p_run_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_run public.arcade_runs%ROWTYPE;
BEGIN
  v_student_id := public.current_student_id();
  SELECT * INTO v_run FROM public.arcade_runs WHERE id = p_run_id;
  IF NOT FOUND OR v_run.student_id IS DISTINCT FROM v_student_id THEN
    RAISE EXCEPTION '[ARCADE] run not found for this student.' USING ERRCODE = 'P0199';
  END IF;
  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'status', v_run.status,
    'official_score', v_run.official_score,
    'official_duration_ms', v_run.official_duration_ms,
    'game_over_at', v_run.game_over_at,
    'stats', v_run.stats,
    'rejection_code', v_run.rejection_code,
    'rejection_reason', v_run.rejection_reason
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_invalidate_arcade_run(
  p_run_id bigint,
  p_reason text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_run public.arcade_runs%ROWTYPE;
  v_event public.arcade_run_moderation_events%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  IF coalesce(btrim(p_reason), '') = '' OR char_length(btrim(p_reason)) NOT BETWEEN 2 AND 300 THEN
    RAISE EXCEPTION '[ARCADE] invalidation reason must be 2 to 300 characters.' USING ERRCODE = 'P0207';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION '[ARCADE] idempotency key is required.' USING ERRCODE = 'P0208';
  END IF;

  SELECT * INTO v_run FROM public.arcade_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[ARCADE] run not found in this classroom.' USING ERRCODE = 'P0209';
  END IF;
  IF v_run.status <> 'VERIFIED' THEN
    RAISE EXCEPTION '[ARCADE] only verified runs can be invalidated.' USING ERRCODE = 'P0210';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arcade_monthly_snapshot_entries entry
    WHERE entry.source_run_id = v_run.id
  ) THEN
    RAISE EXCEPTION '[ARCADE] this run is already part of a finalized snapshot; use a future explicit correction flow.' USING ERRCODE = 'P0211';
  END IF;

  SELECT * INTO v_event
  FROM public.arcade_run_moderation_events
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_event.run_id IS DISTINCT FROM v_run.id THEN
      RAISE EXCEPTION '[ARCADE] idempotency key belongs to a different moderation action.' USING ERRCODE = 'P0212';
    END IF;
    RETURN jsonb_build_object('moderation_event_id', v_event.id, 'run_id', v_event.run_id, 'invalidated', true);
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.arcade_run_moderation_events event
    WHERE event.run_id = v_run.id
  ) THEN
    RAISE EXCEPTION '[ARCADE] this run was already invalidated.' USING ERRCODE = 'P0213';
  END IF;

  INSERT INTO public.arcade_run_moderation_events (
    run_id, classroom_id, event_kind, reason, idempotency_key
  ) VALUES (
    v_run.id, v_classroom_id, 'INVALIDATE', btrim(p_reason), p_idempotency_key
  )
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('moderation_event_id', v_event.id, 'run_id', v_event.run_id, 'invalidated', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_arcade_run_audit(
  p_period_id bigint,
  p_game_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  SELECT * INTO v_period FROM public.arcade_ranking_periods WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] ranking period not found in this classroom.' USING ERRCODE = 'P0205';
  END IF;
  SELECT id INTO v_game_id FROM public.arcade_games WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  RETURN (
    SELECT coalesce(jsonb_agg(row_data ORDER BY (row_data ->> 'event_at')::timestamptz DESC), '[]'::jsonb)
    FROM (
      SELECT jsonb_build_object(
        'run_id', run.id,
        'student_id', run.student_id,
        'student_name', student.name,
        'status', run.status,
        'official_score', run.official_score,
        'official_duration_ms', run.official_duration_ms,
        'game_over_at', run.game_over_at,
        'submitted_at', run.submitted_at,
        'event_at', coalesce(run.game_over_at, run.submitted_at, run.created_at),
        'rejection_code', run.rejection_code,
        'rejection_reason', run.rejection_reason,
        'invalidated', moderation.id IS NOT NULL,
        'invalidation_reason', moderation.reason
      ) AS row_data
      FROM public.arcade_runs run
      JOIN public.students student ON student.id = run.student_id
      LEFT JOIN public.arcade_run_moderation_events moderation ON moderation.run_id = run.id
      WHERE run.classroom_id = v_classroom_id
        AND run.game_id = v_game_id
        AND coalesce(run.game_over_at, run.submitted_at, run.created_at) >= v_period.starts_at
        AND coalesce(run.game_over_at, run.submitted_at, run.created_at) < v_period.ends_at_exclusive
      ORDER BY coalesce(run.game_over_at, run.submitted_at, run.created_at) DESC, run.id DESC
      LIMIT 200
    ) audit_rows
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Explicit function ACL boundary
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.arcade_xorshift32_next(bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_focus_reaction_01_schedule(bigint, integer, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_validate_focus_reaction_01_submission(bigint, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.student_create_arcade_run(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_begin_arcade_run(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_submit_focus_reaction_01_run(bigint, jsonb, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_arcade_leaderboard(text, bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_get_arcade_run_result(bigint) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_invalidate_arcade_run(bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_arcade_run_audit(bigint, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.student_create_arcade_run(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_begin_arcade_run(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_submit_focus_reaction_01_run(bigint, jsonb, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_arcade_leaderboard(text, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_arcade_run_result(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_invalidate_arcade_run(bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_arcade_run_audit(bigint, text) TO authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only; no auth/JWT-dependent RPC)
-- =============================================================================
SELECT game.code AS game_code,
       game.available_from,
       game.available_until,
       version.version_code,
       version.is_active AS rule_version_active,
       version.config ->> 'countdown_ms' AS countdown_ms,
       version.config #>> '{tiers,EASY,hit_window_ms}' AS easy_hit_window_ms,
       version.config #>> '{tiers,EXTREME,burst_max_interval_ms}' AS extreme_burst_max_interval_ms
FROM public.arcade_games game
JOIN public.arcade_game_rule_versions version ON version.game_id = game.id
WHERE game.code = 'focus_reaction_01';

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'student_create_arcade_run', 'student_begin_arcade_run',
    'student_submit_focus_reaction_01_run', 'get_arcade_leaderboard',
    'teacher_invalidate_arcade_run', 'arcade_focus_reaction_01_schedule'
  )
ORDER BY function_name, identity_arguments;

SELECT c.relname AS relation_name,
       pg_get_indexdef(i.indexrelid) AS index_definition
FROM pg_index i
JOIN pg_class c ON c.oid = i.indrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('arcade_game_rule_versions', 'arcade_runs', 'arcade_run_submissions')
ORDER BY relation_name, index_definition;
