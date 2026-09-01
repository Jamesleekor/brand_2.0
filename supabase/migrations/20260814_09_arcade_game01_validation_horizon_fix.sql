-- =============================================================================
-- B.R.A.N.D 2.0 — Game #01 server validation horizon repair
-- 2026-08-14
--
-- Fixes rejected GAME_NOT_OVER runs when the final valid/early input belongs
-- to a signal whose target time is after the client-reported game-over time.
-- The rule/scoring model is unchanged; the server now generates enough of the
-- deterministic schedule to evaluate the same final input as the client.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_game_rule_versions') IS NULL
     OR to_regprocedure('public.arcade_focus_reaction_01_schedule(bigint,integer,jsonb)') IS NULL
     OR to_regprocedure('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)') IS NULL
     OR to_regprocedure('public.student_submit_focus_reaction_01_run(bigint,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION '[ARCADE] Arcade 01~08 migrations must be applied first.';
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

  -- The client can lose Life by pressing before a signal reaches its target.
  -- Generate enough future schedule to evaluate that final input, but never
  -- turn a GO signal into a miss until its window has actually elapsed.
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
    ELSIF v_signal.signal_kind = 'GO' AND v_window_end <= p_client_game_over_elapsed_ms THEN
      v_loss_time := v_window_end;
      v_lives := v_lives - 1;
      v_combo := 0;
      v_misses := v_misses + 1;
      v_recovery_until := v_loss_time + coalesce((p_config ->> 'damage_recovery_ms')::integer, 600);
      IF v_lives <= 0 THEN
        v_game_over_ms := v_loss_time;
      END IF;
    ELSE
      -- No recorded input can affect this not-yet-finished signal by the
      -- submitted end time, so later schedule rows cannot affect this run.
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
-- SQL Editor-safe structural and deterministic regression postcheck
-- This SELECT calls only the pure validation helper. It creates no runs,
-- changes no data, and does not need a logged-in teacher session.
-- =============================================================================
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.oid = 'public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'::regprocedure;

SELECT pg_get_functiondef('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'::regprocedure)
         ILIKE '%p_client_game_over_elapsed_ms + 6000%' AS uses_final_input_validation_horizon,
       pg_get_functiondef('public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'::regprocedure)
         ILIKE '%ELSIF v_signal.signal_kind = ''GO'' AND v_window_end <= p_client_game_over_elapsed_ms THEN%' AS does_not_miss_after_submitted_end_time;

WITH active_game_config AS (
  SELECT version.config
  FROM public.arcade_games game
  JOIN public.arcade_game_rule_versions version
    ON version.game_id = game.id
  WHERE game.code = 'focus_reaction_01'
    AND version.is_active
  ORDER BY version.id DESC
  LIMIT 1
)
SELECT (validation.result ->> 'valid')::boolean AS three_early_wrong_inputs_are_accepted_as_game_over,
       (validation.result ->> 'official_duration_ms')::integer = 1203 AS game_over_time_matches_last_input,
       (validation.result #>> '{stats,wrong_lane_errors}')::integer = 3 AS all_three_life_losses_are_counted
FROM active_game_config config
CROSS JOIN LATERAL public.arcade_validate_focus_reaction_01_submission(
  1,
  config.config,
  '[
    {"elapsed_ms": 1, "lane": 0},
    {"elapsed_ms": 602, "lane": 0},
    {"elapsed_ms": 1203, "lane": 0}
  ]'::jsonb,
  1203
) AS validation(result);
