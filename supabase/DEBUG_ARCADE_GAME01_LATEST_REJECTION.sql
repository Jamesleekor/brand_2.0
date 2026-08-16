-- =============================================================================
-- B.R.A.N.D 2.0 — Game #01 latest rejected-run diagnostic
-- Read-only. It does not create, edit, delete, or invalidate any record.
--
-- Run the entire file in Supabase SQL Editor and send the one JSON result.
-- It selects the newest rejected Game #01 run and replays its already-stored
-- input events through the currently installed validation helper.
-- =============================================================================

WITH latest_rejected_run AS (
  SELECT run.id AS run_id,
         run.student_id,
         run.status,
         run.schedule_seed,
         run.created_at,
         run.submitted_at,
         run.rejection_code,
         run.rejection_reason,
         submission.input_events,
         submission.input_event_count,
         submission.client_game_over_elapsed_ms,
         submission.validation_metadata AS stored_validation_metadata,
         version.config
  FROM public.arcade_runs run
  JOIN public.arcade_games game
    ON game.id = run.game_id
  JOIN public.arcade_game_rule_versions version
    ON version.id = run.rule_version_id
  LEFT JOIN public.arcade_run_submissions submission
    ON submission.run_id = run.id
  WHERE game.code = 'focus_reaction_01'
    AND run.status = 'REJECTED'
  ORDER BY coalesce(run.submitted_at, run.created_at) DESC, run.id DESC
  LIMIT 1
), replayed AS (
  SELECT rejected.*,
         public.arcade_validate_focus_reaction_01_submission(
           rejected.schedule_seed,
           rejected.config,
           rejected.input_events,
           rejected.client_game_over_elapsed_ms
         ) AS replay_validation
  FROM latest_rejected_run rejected
), schedule_window AS (
  SELECT replayed.run_id,
         coalesce(jsonb_agg(
           jsonb_build_object(
             'signal_index', schedule.signal_index,
             'spawn_ms', schedule.spawn_ms,
             'target_ms', schedule.target_ms,
             'window_start_ms', schedule.target_ms - schedule.hit_window_ms,
             'window_end_ms', schedule.target_ms + schedule.hit_window_ms,
             'lane', schedule.lane,
             'signal_kind', schedule.signal_kind
           )
           ORDER BY schedule.signal_index
         ), '[]'::jsonb) AS nearby_schedule
  FROM replayed
  CROSS JOIN LATERAL public.arcade_focus_reaction_01_schedule(
    replayed.schedule_seed,
    least(3600000, replayed.client_game_over_elapsed_ms + 6000),
    replayed.config
  ) schedule
  WHERE schedule.target_ms >= greatest(0, replayed.client_game_over_elapsed_ms - 4000)
  GROUP BY replayed.run_id
), input_preview AS (
  SELECT replayed.run_id,
         coalesce(jsonb_agg(input.value ORDER BY input.ordinality)
           FILTER (WHERE input.ordinality <= 20), '[]'::jsonb) AS first_input_events,
         coalesce(jsonb_agg(input.value ORDER BY input.ordinality)
           FILTER (WHERE input.ordinality > greatest(0, jsonb_array_length(replayed.input_events) - 20)), '[]'::jsonb) AS last_input_events
  FROM replayed
  LEFT JOIN LATERAL jsonb_array_elements(replayed.input_events) WITH ORDINALITY AS input(value, ordinality)
    ON true
  GROUP BY replayed.run_id, replayed.input_events
)
SELECT jsonb_build_object(
  'run_id', replayed.run_id,
  'student_id', replayed.student_id,
  'status', replayed.status,
  'created_at', replayed.created_at,
  'submitted_at', replayed.submitted_at,
  'rejection_code', replayed.rejection_code,
  'rejection_reason', replayed.rejection_reason,
  'schedule_seed', replayed.schedule_seed,
  'client_game_over_elapsed_ms', replayed.client_game_over_elapsed_ms,
  'input_event_count', replayed.input_event_count,
  'stored_validation_metadata', replayed.stored_validation_metadata,
  'replay_validation_with_current_server_function', replayed.replay_validation,
  'first_20_input_events', input_preview.first_input_events,
  'last_20_input_events', input_preview.last_input_events,
  'schedule_near_submitted_end', coalesce(schedule_window.nearby_schedule, '[]'::jsonb),
  'validator_09_definition_present', pg_get_functiondef(
    'public.arcade_validate_focus_reaction_01_submission(bigint,jsonb,jsonb,integer)'::regprocedure
  ) ILIKE '%p_client_game_over_elapsed_ms + 6000%'
) AS latest_rejected_game01_diagnostic
FROM replayed
LEFT JOIN input_preview ON input_preview.run_id = replayed.run_id
LEFT JOIN schedule_window ON schedule_window.run_id = replayed.run_id;
