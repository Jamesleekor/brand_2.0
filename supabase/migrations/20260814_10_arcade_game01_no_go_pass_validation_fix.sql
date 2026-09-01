-- =============================================================================
-- B.R.A.N.D 2.0 — Game #01 NO GO pass validation repair
-- 2026-08-14
--
-- 09 correctly widened the validation horizon, but its end-time guard stopped
-- validation after a safely ignored NO GO signal. A passed NO GO must advance
-- to the next scheduled signal; only an unfinished signal window may stop the
-- replay. This preserves all score and anti-cheat rules.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.arcade_focus_reaction_01_schedule(bigint,integer,jsonb)') IS NULL
     OR to_regprocedure('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('public.student_submit_focus_reaction_01_run(bigint,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~09 migrations must be applied first.';
  END IF;
END $$;

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
  v_schedule_until_ms integer;
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

  v_schedule_until_ms := least(v_max_elapsed, p_client_game_over_elapsed_ms + 6000);

  FOR v_signal IN
    SELECT *
    FROM public.arcade_focus_reaction_01_schedule(p_seed, v_schedule_until_ms, p_config)
    ORDER BY signal_index
  LOOP
    EXIT WHEN v_lives <= 0;

    WHILE v_input_index <= v_event_count AND v_times[v_input_index] <= v_recovery_until LOOP
      v_input_index := v_input_index + 1;
    END LOOP;
    IF v_signal.target_ms <= v_recovery_until THEN
      CONTINUE;
    END IF;

    v_window_start := v_signal.target_ms - v_signal.hit_window_ms;
    v_window_end := v_signal.target_ms + v_signal.hit_window_ms;

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
    ELSIF v_window_end <= p_client_game_over_elapsed_ms THEN
      -- A GO whose window has fully elapsed is a miss. A NO GO with no input
      -- is a successful pass and must simply continue to the next signal.
      IF v_signal.signal_kind = 'GO' THEN
        v_loss_time := v_window_end;
        v_lives := v_lives - 1;
        v_combo := 0;
        v_misses := v_misses + 1;
        v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
        IF v_lives <= 0 THEN
          v_game_over_ms := v_loss_time;
        END IF;
      END IF;
    ELSE
      -- The current signal has not finished by the submitted end time and
      -- there is no input that can affect it. Later signals cannot affect run.
      EXIT;
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

REVOKE ALL ON FUNCTION public.arcade_validate_focus_reaction_01_submission(bigint, jsonb, jsonb, integer) FROM PUBLIC, anon, authenticated;

COMMIT;

-- =============================================================================
-- SQL Editor-safe postcheck. The last SELECT is a deterministic, read-only
-- regression test: a passed NO GO followed by three early wrong inputs must
-- produce a valid game-over result instead of GAME_NOT_OVER.
-- =============================================================================
SELECT pg_get_functiondef('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'::regprocedure)
         ILIKE '%ELSIF v_window_end <= p_client_game_over_elapsed_ms THEN%' AS advances_after_expired_no_go,
       pg_get_functiondef('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'::regprocedure)
         ILIKE '%IF v_signal.signal_kind = ''GO'' THEN%' AS applies_miss_only_to_go;

WITH regression_config AS (
  SELECT '{
    "game_code": "focus_reaction_01",
    "lives": 3,
    "damage_recovery_ms": 600,
    "max_input_events": 20000,
    "max_client_elapsed_ms": 3600000,
    "client_end_tolerance_ms": 2000,
    "tiers": {
      "EASY": {
        "spawn_min_ms": 1000,
        "spawn_max_ms": 1000,
        "travel_ms": 100,
        "hit_window_ms": 50,
        "no_go_rate_bp": 10000,
        "burst_chance_bp": 0,
        "burst_min_length": 0,
        "burst_max_length": 0,
        "burst_min_interval_ms": 0,
        "burst_max_interval_ms": 0
      }
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
    }
  }'::jsonb AS config
)
SELECT (validation.result ->> 'valid')::boolean AS passed_no_go_then_three_early_wrong_inputs_finishes,
       (validation.result ->> 'official_duration_ms')::integer = 2403 AS end_time_matches_last_life_loss,
       (validation.result #>> '{stats,wrong_lane_errors}')::integer = 3 AS all_three_wrong_inputs_counted
FROM regression_config config
CROSS JOIN LATERAL public.arcade_validate_focus_reaction_01_submission(
  1,
  config.config,
  '[
    {"elapsed_ms": 1201, "lane": 0},
    {"elapsed_ms": 1802, "lane": 0},
    {"elapsed_ms": 2403, "lane": 0}
  ]'::jsonb,
  2403
) AS validation(result);
