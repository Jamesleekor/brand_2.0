-- =============================================================================
-- B.R.A.N.D 2.0 — Starlink #04 pure server-side full-run replay v0.3
-- 2026-10-12
--
-- INTERNAL helper, no student-facing RPC. Server trusts only seed + logical
-- event sequence after caller has validated run owner, nonce, rule pin,
-- server-stamped PLAYING, submission envelope, and period boundaries.
--
-- Input wall-clock elapsed_ms: monotonic nonnegative integer <= 180000.
-- ACTIVE CLOCK: wall minus completed 350ms reshuffle pauses.
-- Successful release: score/stats immediately; input locks for 200ms.
-- Dead board: after settle, deterministic 350ms hidden-board pause.
-- GAME_END outranks pending refill when 60000 active ms lands in settle.
-- Normal complete submission must reach the computed terminal time.
-- =============================================================================
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_generate_initial_board(bigint)') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_reduce_path(smallint[],integer[])') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_score_clear(text,integer,integer,integer)') IS NULL THEN
    RAISE EXCEPTION '[STARLINK REPLAY] prerequisite board/path migrations are missing.';
  END IF;
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_replay(
  p_gameplay_seed bigint,
  p_events jsonb,
  p_finish_wall_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $replay$
DECLARE
  v_streams jsonb;
  v_init jsonb;
  v_board smallint[];
  v_refill_state bigint;
  v_reshuffle_state bigint;
  v_event_count integer;
  v_idx integer;
  v_event jsonb;
  v_type text;
  v_t integer;
  v_last_t integer := 0;
  v_cell integer;
  v_raw_cells integer[] := NULL;
  v_reduced jsonb;
  v_path integer[];
  v_release jsonb;
  v_kind text;
  v_removed integer[];
  v_removed_count integer;
  v_path_len integer;
  v_score_row jsonb;
  v_active_commit integer;
  v_award integer;

  v_phase text := 'PLAYING';
  v_settle_end integer;
  v_pause_end integer;
  v_paused_total integer := 0;
  v_end_wall integer;
  v_deadline integer;
  v_can_process boolean;

  v_score integer := 0;
  v_combo integer := 0;
  v_last_commit_active integer := NULL;
  v_total_removed integer := 0;
  v_normal_clears integer := 0;
  v_loop_count integer := 0;
  v_max_link integer := 0;
  v_max_combo integer := 0;
  v_largest_loop_removed integer := 0;
  v_reshuffle_count integer := 0;
  v_clear_log jsonb := '[]'::jsonb;
  v_clock_guard integer;
  v_board_resolution jsonb;
  v_board_metrics jsonb;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' THEN
    RAISE EXCEPTION '[STARLINK REPLAY] events must be a JSON array.' USING ERRCODE='22023';
  END IF;
  v_event_count := jsonb_array_length(p_events);
  IF v_event_count > 5000 THEN
    RAISE EXCEPTION '[STARLINK REPLAY] too many events.' USING ERRCODE='22023';
  END IF;
  IF p_finish_wall_ms NOT BETWEEN 0 AND 180000 THEN
    RAISE EXCEPTION '[STARLINK REPLAY] invalid finish elapsed.' USING ERRCODE='22023';
  END IF;

  v_streams := public.arcade_starlink_04_rng_streams(p_gameplay_seed);
  v_init := public.arcade_starlink_04_generate_initial_board(p_gameplay_seed);
  SELECT array_agg(value::smallint ORDER BY ord)
  INTO v_board
  FROM jsonb_array_elements_text(v_init->'board') WITH ORDINALITY AS j(value,ord);
  v_refill_state := (v_streams->>'refill')::bigint;
  v_reshuffle_state := (v_streams->>'reshuffle')::bigint;

  -- An extra synthetic FINISH tick guarantees the exact same advance-clock
  -- transition logic is used for events and normal completion.
  FOR v_idx IN 0..v_event_count LOOP
    v_can_process := v_idx < v_event_count;

    IF v_can_process THEN
      v_event := p_events->v_idx;
      IF jsonb_typeof(v_event) <> 'object'
         OR jsonb_typeof(v_event->'type') <> 'string'
         OR jsonb_typeof(v_event->'elapsed_ms') <> 'number'
         OR (v_event->>'elapsed_ms') !~ '^(0|[1-9][0-9]{0,5})$' THEN
        RAISE EXCEPTION '[STARLINK REPLAY] malformed event at index %.',v_idx USING ERRCODE='22023';
      END IF;

      v_type := v_event->>'type';
      v_t := (v_event->>'elapsed_ms')::integer;
    ELSE
      v_type := 'FINISH';
      v_t := p_finish_wall_ms;
    END IF;

    IF v_t < v_last_t OR v_t > 180000 THEN
      RAISE EXCEPTION '[STARLINK REPLAY] non-monotonic/out-of-range wall time.' USING ERRCODE='22023';
    END IF;
    v_last_t := v_t;

    -- Drain deterministic clock transitions up to the event wall time.
    FOR v_clock_guard IN 1..8 LOOP
      v_deadline := 60000 + v_paused_total;

      IF v_phase='SETTLING' THEN
        -- Already committed score survives even if 60 seconds hits before refill.
        IF v_deadline <= v_settle_end AND v_t >= v_deadline THEN
          v_phase := 'GAME_OVER';
          v_end_wall := v_deadline;
          v_raw_cells := NULL;
          EXIT;
        END IF;
        IF v_t < v_settle_end THEN EXIT; END IF;

        v_board_resolution := public.arcade_starlink_04_refill_board(
          v_board,v_removed,v_refill_state
        );
        SELECT array_agg(value::smallint ORDER BY ord)
        INTO v_board
        FROM jsonb_array_elements_text(v_board_resolution->'board')
        WITH ORDINALITY AS j(value,ord);
        v_refill_state := (v_board_resolution->>'rngState')::bigint;
        v_board_metrics := v_board_resolution->'metrics';

        IF NOT (v_board_metrics->>'playable')::boolean THEN
          v_board_resolution := public.arcade_starlink_04_reshuffle_dead_board(
            v_board,v_reshuffle_state
          );
          SELECT array_agg(value::smallint ORDER BY ord)
          INTO v_board
          FROM jsonb_array_elements_text(v_board_resolution->'board')
          WITH ORDINALITY AS j(value,ord);
          v_reshuffle_state := (v_board_resolution->>'rngState')::bigint;
          v_reshuffle_count := v_reshuffle_count + 1;
          v_pause_end := v_settle_end + 350;
          v_phase := 'RESHUFFLING';
        ELSE
          v_phase := 'PLAYING';
        END IF;
        v_removed := NULL;
        v_settle_end := NULL;
        CONTINUE;
      END IF;

      IF v_phase='RESHUFFLING' THEN
        IF v_t < v_pause_end THEN EXIT; END IF;
        v_paused_total := v_paused_total + 350;
        v_pause_end := NULL;
        v_phase := 'PLAYING';
        CONTINUE;
      END IF;

      IF v_phase='PLAYING' AND v_t >= v_deadline THEN
        v_phase := 'GAME_OVER';
        v_end_wall := v_deadline;
        v_raw_cells := NULL;
      END IF;
      EXIT;
    END LOOP;

    IF NOT v_can_process THEN CONTINUE; END IF;
    IF v_phase='GAME_OVER' THEN CONTINUE; END IF;

    IF v_phase<>'PLAYING' THEN
      RAISE EXCEPTION '[STARLINK REPLAY] input during settle/reshuffle lock at wall %.',v_t
        USING ERRCODE='22023';
    END IF;

    IF v_type IN ('PATH_START','CELL_ENTER') THEN
      IF jsonb_typeof(v_event->'cell') <> 'number'
         OR (v_event->>'cell') !~ '^(0|[1-9][0-9]{0,2})$' THEN
        RAISE EXCEPTION '[STARLINK REPLAY] missing/invalid cell at %.',v_idx USING ERRCODE='22023';
      END IF;
      v_cell := (v_event->>'cell')::integer;
      IF v_cell NOT BETWEEN 0 AND 48 THEN
        RAISE EXCEPTION '[STARLINK REPLAY] cell outside board.' USING ERRCODE='22023';
      END IF;
    END IF;

    IF v_type='PATH_START' THEN
      IF v_raw_cells IS NOT NULL THEN
        RAISE EXCEPTION '[STARLINK REPLAY] nested PATH_START.' USING ERRCODE='22023';
      END IF;
      v_raw_cells := ARRAY[v_cell];
      CONTINUE;
    END IF;

    IF v_type='CELL_ENTER' THEN
      IF v_raw_cells IS NULL THEN
        RAISE EXCEPTION '[STARLINK REPLAY] CELL_ENTER without start.' USING ERRCODE='22023';
      END IF;
      v_raw_cells := array_append(v_raw_cells,v_cell);
      CONTINUE;
    END IF;

    IF v_type='PATH_CANCEL' THEN
      IF v_raw_cells IS NULL THEN
        RAISE EXCEPTION '[STARLINK REPLAY] PATH_CANCEL without start.' USING ERRCODE='22023';
      END IF;
      v_raw_cells := NULL;
      CONTINUE;
    END IF;

    IF v_type<>'PATH_RELEASE' THEN
      RAISE EXCEPTION '[STARLINK REPLAY] unknown event type: %.',v_type USING ERRCODE='22023';
    END IF;
    IF v_raw_cells IS NULL THEN
      RAISE EXCEPTION '[STARLINK REPLAY] PATH_RELEASE without start.' USING ERRCODE='22023';
    END IF;

    v_reduced := public.arcade_starlink_04_reduce_path(v_board,v_raw_cells);
    SELECT array_agg(value::integer ORDER BY ord)
    INTO v_path
    FROM jsonb_array_elements_text(v_reduced->'path')
    WITH ORDINALITY AS j(value,ord);
    v_release := public.arcade_starlink_04_release_path(
      v_board,v_path,(v_reduced->>'loopClosed')::boolean
    );
    v_raw_cells := NULL;
    v_kind := v_release->>'kind';

    IF v_kind='CANCEL' THEN CONTINUE; END IF;
    v_path_len := (v_release->>'pathLength')::integer;
    v_removed_count := (v_release->>'removedCount')::integer;
    SELECT array_agg(value::integer ORDER BY ord)
    INTO v_removed
    FROM jsonb_array_elements_text(v_release->'removedCells')
    WITH ORDINALITY AS j(value,ord);

    v_active_commit := v_t - v_paused_total;
    v_combo := public.arcade_starlink_04_next_combo(
      v_combo,v_last_commit_active,v_active_commit
    );
    v_score_row := public.arcade_starlink_04_score_clear(
      v_kind,v_path_len,v_removed_count,v_combo
    );
    v_award := (v_score_row->>'awardedScore')::integer;
    v_score := v_score + v_award;
    v_last_commit_active := v_active_commit;

    v_total_removed := v_total_removed + v_removed_count;
    IF v_kind='NORMAL' THEN
      v_normal_clears := v_normal_clears + 1;
    ELSE
      v_loop_count := v_loop_count + 1;
      v_largest_loop_removed := greatest(v_largest_loop_removed,v_removed_count);
    END IF;
    v_max_link := greatest(v_max_link,v_path_len);
    v_max_combo := greatest(v_max_combo,v_combo);

    v_clear_log := v_clear_log || jsonb_build_array(jsonb_build_object(
      'activeCommitMs',v_active_commit,
      'wallCommitMs',v_t,
      'pathLength',v_path_len,
      'removedCount',v_removed_count,
      'kind',v_kind,
      'combo',v_combo,
      'awardedScore',v_award
    ));

    v_phase := 'SETTLING';
    v_settle_end := v_t + 200;
  END LOOP;

  IF v_phase <> 'GAME_OVER' OR v_end_wall IS NULL THEN
    RAISE EXCEPTION '[STARLINK REPLAY] normal-complete submission before terminal 60000 active ms.'
      USING ERRCODE='22023';
  END IF;

  RETURN jsonb_build_object(
    'official_score',v_score,
    'official_duration_ms',60000,
    'game_end_wall_ms',v_end_wall,
    'paused_total_ms',v_paused_total,
    'board',to_jsonb(v_board),
    'refill_rng_state',v_refill_state,
    'reshuffle_rng_state',v_reshuffle_state,
    'stats',jsonb_build_object(
      'totalRemovedStars',v_total_removed,
      'normalClearCount',v_normal_clears,
      'loopCount',v_loop_count,
      'maxLinkLength',v_max_link,
      'maxCombo',v_max_combo,
      'largestLoopRemovedCount',v_largest_loop_removed,
      'reshuffleCount',v_reshuffle_count
    ),
    'clear_log',v_clear_log,
    'phase','GAME_OVER'
  );
END;
$replay$;

REVOKE ALL ON FUNCTION public.arcade_starlink_04_replay(bigint,jsonb,integer)
FROM PUBLIC,anon,authenticated;

COMMIT;
NOTIFY pgrst,'reload schema';
