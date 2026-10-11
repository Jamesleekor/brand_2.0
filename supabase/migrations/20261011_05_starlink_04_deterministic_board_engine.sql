-- =============================================================================
-- B.R.A.N.D 2.0 — Starlink #04 deterministic 7x7 board engine
-- 2026-10-11
--
-- Cross-language contract:
--   * non-zero uint32 xorshift32 (public.arcade_xorshift32_next)
--   * initial candidate draw order: cell_id 0 -> 48 (row-major)
--   * initial SOFT search: up to 64 candidates, playable HARD, max component <= 8 SOFT
--   * FIRST_PLAYABLE fallback keeps the RNG state after all attempted candidates
--   * gravity refill: column 0 -> 6, lower empty row -> upper row
--   * reshuffle: each attempt Fisher-Yates shuffles the SAME source board;
--                only RNG state advances between attempts
--   * hard fallback: count-preserving swaps into center cells [23,24,25]
--
-- No production gameplay RPC is enabled by this migration.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.arcade_xorshift32_next(bigint)') IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] arcade_xorshift32_next(bigint) is missing.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_assert_board(p_board smallint[])
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
BEGIN
  IF array_ndims(p_board) IS DISTINCT FROM 1
     OR cardinality(p_board) <> 49
     OR array_lower(p_board,1) <> 1
     OR array_upper(p_board,1) <> 49 THEN
    RAISE EXCEPTION '[STARLINK 04] board must contain exactly 49 one-dimensional cells.'
      USING ERRCODE='22023';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM unnest(p_board) AS value
    WHERE value IS NULL OR value < 0 OR value > 5
  ) THEN
    RAISE EXCEPTION '[STARLINK 04] board contains an invalid star type.'
      USING ERRCODE='22023';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_board_signature(p_board smallint[])
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);
  RETURN array_to_string(p_board,'');
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_board_metrics(p_board smallint[])
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_visited boolean[] := array_fill(false,ARRAY[49]);
  v_distribution integer[] := array_fill(0,ARRAY[6]);
  v_queue integer[];
  v_cursor integer;
  v_start integer;
  v_idx integer;
  v_neighbor integer;
  v_row integer;
  v_col integer;
  v_nr integer;
  v_nc integer;
  v_dr integer;
  v_dc integer;
  v_type integer;
  v_component_size integer;
  v_component_count integer := 0;
  v_playable_component_count integer := 0;
  v_largest_component integer := 0;
  v_removable_star_count integer := 0;
  v_component_count_ge4 integer := 0;
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);

  FOR v_idx IN 1..49 LOOP
    v_distribution[p_board[v_idx]::integer+1] :=
      v_distribution[p_board[v_idx]::integer+1] + 1;
  END LOOP;

  FOR v_start IN 1..49 LOOP
    IF v_visited[v_start] THEN
      CONTINUE;
    END IF;

    v_component_count := v_component_count + 1;
    v_type := p_board[v_start];
    v_queue := ARRAY[v_start];
    v_visited[v_start] := true;
    v_cursor := 1;
    v_component_size := 0;

    WHILE v_cursor <= cardinality(v_queue) LOOP
      v_idx := v_queue[v_cursor];
      v_cursor := v_cursor + 1;
      v_component_size := v_component_size + 1;

      v_row := (v_idx-1) / 7;
      v_col := (v_idx-1) % 7;

      FOR v_dr IN -1..1 LOOP
        FOR v_dc IN -1..1 LOOP
          IF v_dr=0 AND v_dc=0 THEN
            CONTINUE;
          END IF;

          v_nr := v_row + v_dr;
          v_nc := v_col + v_dc;

          IF v_nr < 0 OR v_nr >= 7 OR v_nc < 0 OR v_nc >= 7 THEN
            CONTINUE;
          END IF;

          v_neighbor := v_nr*7+v_nc+1;
          IF NOT v_visited[v_neighbor] AND p_board[v_neighbor]=v_type THEN
            v_visited[v_neighbor] := true;
            v_queue := array_append(v_queue,v_neighbor);
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;

    v_largest_component := greatest(v_largest_component,v_component_size);

    IF v_component_size >= 3 THEN
      v_playable_component_count := v_playable_component_count + 1;
      v_removable_star_count := v_removable_star_count + v_component_size;
    END IF;

    IF v_component_size >= 4 THEN
      v_component_count_ge4 := v_component_count_ge4 + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'componentCount',v_component_count,
    'playableComponentCount',v_playable_component_count,
    'largestComponent',v_largest_component,
    'removableStarCount',v_removable_star_count,
    'componentCountAtLeastFour',v_component_count_ge4,
    'typeDistribution',to_jsonb(v_distribution),
    'playable',(v_playable_component_count>0)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_force_playable_fallback(
  p_board smallint[]
)
RETURNS smallint[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next smallint[] := p_board;
  v_counts integer[] := array_fill(0,ARRAY[6]);
  v_target_type integer := 0;
  v_type integer;
  v_idx integer;
  v_target_idx integer;
  v_source_idx integer;
  v_temp smallint;
  -- cell IDs [23,24,25] -> PostgreSQL array indexes [24,25,26]
  v_targets integer[] := ARRAY[24,25,26];
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);

  FOR v_idx IN 1..49 LOOP
    v_counts[p_board[v_idx]::integer+1] :=
      v_counts[p_board[v_idx]::integer+1] + 1;
  END LOOP;

  -- Tie-break: lower star type wins because only strictly larger counts replace it.
  FOR v_type IN 1..5 LOOP
    IF v_counts[v_type+1] > v_counts[v_target_type+1] THEN
      v_target_type := v_type;
    END IF;
  END LOOP;

  FOREACH v_target_idx IN ARRAY v_targets LOOP
    IF v_next[v_target_idx]=v_target_type THEN
      CONTINUE;
    END IF;

    v_source_idx := NULL;
    FOR v_idx IN 1..49 LOOP
      IF v_idx=ANY(v_targets) THEN
        CONTINUE;
      END IF;
      IF v_next[v_idx]=v_target_type THEN
        v_source_idx := v_idx;
        EXIT;
      END IF;
    END LOOP;

    IF v_source_idx IS NULL THEN
      RAISE EXCEPTION '[STARLINK 04] hard fallback could not find a count-preserving source star.'
        USING ERRCODE='P0290';
    END IF;

    v_temp := v_next[v_target_idx];
    v_next[v_target_idx] := v_target_type::smallint;
    v_next[v_source_idx] := v_temp;
  END LOOP;

  IF NOT (public.arcade_starlink_04_board_metrics(v_next)->>'playable')::boolean THEN
    RAISE EXCEPTION '[STARLINK 04] hard fallback failed to create a playable board.'
      USING ERRCODE='P0290';
  END IF;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_generate_initial_board(
  p_seed bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint := p_seed;
  v_attempt integer;
  v_cell integer;
  v_candidate smallint[];
  v_first_playable smallint[];
  v_first_metrics jsonb;
  v_last_candidate smallint[];
  v_metrics jsonb;
  v_fallback smallint[];
BEGIN
  IF p_seed NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] seed must be a non-zero unsigned 32-bit integer.'
      USING ERRCODE='P0190';
  END IF;

  FOR v_attempt IN 1..64 LOOP
    v_candidate := ARRAY[]::smallint[];

    -- Locked consumption order: cell_id 0 -> 48.
    FOR v_cell IN 0..48 LOOP
      v_state := public.arcade_xorshift32_next(v_state);
      v_candidate := array_append(v_candidate,(v_state % 6)::smallint);
    END LOOP;

    v_last_candidate := v_candidate;
    v_metrics := public.arcade_starlink_04_board_metrics(v_candidate);

    IF (v_metrics->>'playable')::boolean AND v_first_playable IS NULL THEN
      v_first_playable := v_candidate;
      v_first_metrics := v_metrics;
    END IF;

    IF (v_metrics->>'playable')::boolean
       AND (v_metrics->>'largestComponent')::integer <= 8 THEN
      RETURN jsonb_build_object(
        'board',to_jsonb(v_candidate),
        'rngState',v_state,
        'attempts',v_attempt,
        'acceptedBy','SOFT',
        'metrics',v_metrics
      );
    END IF;
  END LOOP;

  -- The 64 candidate generations were actually consumed. Future RNG therefore
  -- continues from the final state even if the first playable board is selected.
  IF v_first_playable IS NOT NULL THEN
    RETURN jsonb_build_object(
      'board',to_jsonb(v_first_playable),
      'rngState',v_state,
      'attempts',64,
      'acceptedBy','FIRST_PLAYABLE',
      'metrics',v_first_metrics
    );
  END IF;

  IF v_last_candidate IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] initial generator produced no candidate.'
      USING ERRCODE='P0290';
  END IF;

  v_fallback := public.arcade_starlink_04_force_playable_fallback(v_last_candidate);
  v_metrics := public.arcade_starlink_04_board_metrics(v_fallback);

  RETURN jsonb_build_object(
    'board',to_jsonb(v_fallback),
    'rngState',v_state,
    'attempts',64,
    'acceptedBy','HARD_FALLBACK',
    'metrics',v_metrics
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_refill_board(
  p_board smallint[],
  p_removed_cells integer[],
  p_rng_state bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_removed integer[] := coalesce(p_removed_cells,ARRAY[]::integer[]);
  v_result smallint[] := array_fill(NULL::smallint,ARRAY[49]);
  v_state bigint := p_rng_state;
  v_col integer;
  v_source_row integer;
  v_target_row integer;
  v_refill_row integer;
  v_source_cell integer;
  v_source_idx integer;
  v_target_idx integer;
  v_duplicate_count integer;
BEGIN
  IF p_board IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] board is required.'
      USING ERRCODE='22023';
  END IF;
  PERFORM public.arcade_starlink_04_assert_board(p_board);

  IF p_rng_state NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] RNG state must be a non-zero unsigned 32-bit integer.'
      USING ERRCODE='P0190';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM unnest(v_removed) AS cell
    WHERE cell IS NULL OR cell < 0 OR cell > 48
  ) THEN
    RAISE EXCEPTION '[STARLINK 04] removed cell is outside the board.'
      USING ERRCODE='22023';
  END IF;

  SELECT cardinality(v_removed)-count(DISTINCT cell)
  INTO v_duplicate_count
  FROM unnest(v_removed) AS cell;

  IF coalesce(v_duplicate_count,0) <> 0 THEN
    RAISE EXCEPTION '[STARLINK 04] removed cell list contains duplicates.'
      USING ERRCODE='22023';
  END IF;

  FOR v_col IN 0..6 LOOP
    v_target_row := 6;

    -- Compact downward, preserving survivor vertical order.
    FOR v_source_row IN REVERSE 6..0 LOOP
      v_source_cell := v_source_row*7+v_col;
      IF v_source_cell=ANY(v_removed) THEN
        CONTINUE;
      END IF;

      v_source_idx := v_source_cell+1;
      v_target_idx := v_target_row*7+v_col+1;
      v_result[v_target_idx] := p_board[v_source_idx];
      v_target_row := v_target_row-1;
    END LOOP;

    -- Locked refill consumption: column 0 -> 6, lower empty row -> upper row.
    IF v_target_row >= 0 THEN
      FOR v_refill_row IN REVERSE v_target_row..0 LOOP
        v_state := public.arcade_xorshift32_next(v_state);
        v_target_idx := v_refill_row*7+v_col+1;
        v_result[v_target_idx] := (v_state % 6)::smallint;
      END LOOP;
    END IF;
  END LOOP;

  IF EXISTS(SELECT 1 FROM unnest(v_result) AS value WHERE value IS NULL) THEN
    RAISE EXCEPTION '[STARLINK 04] refill left an empty cell.'
      USING ERRCODE='P0290';
  END IF;

  RETURN jsonb_build_object(
    'board',to_jsonb(v_result),
    'rngState',v_state,
    'removedCount',cardinality(v_removed),
    'metrics',public.arcade_starlink_04_board_metrics(v_result)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_reshuffle_dead_board(
  p_board smallint[],
  p_rng_state bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint := p_rng_state;
  v_source smallint[] := p_board;
  v_candidate smallint[];
  v_last_candidate smallint[];
  v_attempt integer;
  v_i integer;
  v_j integer;
  v_temp smallint;
  v_metrics jsonb;
  v_fallback smallint[];
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);

  IF p_rng_state NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] RNG state must be a non-zero unsigned 32-bit integer.'
      USING ERRCODE='P0190';
  END IF;

  IF (public.arcade_starlink_04_board_metrics(p_board)->>'playable')::boolean THEN
    RAISE EXCEPTION '[STARLINK 04] reshuffle may only be called for a dead board.'
      USING ERRCODE='22023';
  END IF;

  FOR v_attempt IN 1..64 LOOP
    -- Each attempt starts from the same source board; only RNG state advances.
    v_candidate := v_source;

    FOR v_i IN REVERSE 49..2 LOOP
      v_state := public.arcade_xorshift32_next(v_state);
      v_j := (v_state % v_i)::integer+1;

      v_temp := v_candidate[v_i];
      v_candidate[v_i] := v_candidate[v_j];
      v_candidate[v_j] := v_temp;
    END LOOP;

    v_last_candidate := v_candidate;
    v_metrics := public.arcade_starlink_04_board_metrics(v_candidate);

    IF (v_metrics->>'playable')::boolean THEN
      RETURN jsonb_build_object(
        'board',to_jsonb(v_candidate),
        'rngState',v_state,
        'attempts',v_attempt,
        'usedHardFallback',false,
        'metrics',v_metrics
      );
    END IF;
  END LOOP;

  IF v_last_candidate IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] reshuffle produced no candidate.'
      USING ERRCODE='P0290';
  END IF;

  v_fallback := public.arcade_starlink_04_force_playable_fallback(v_last_candidate);
  v_metrics := public.arcade_starlink_04_board_metrics(v_fallback);

  RETURN jsonb_build_object(
    'board',to_jsonb(v_fallback),
    'rngState',v_state,
    'attempts',64,
    'usedHardFallback',true,
    'metrics',v_metrics
  );
END;
$$;

-- Internal deterministic helpers. Browsers must only reach them through narrow
-- server-authoritative RPCs added in the validator phase.
REVOKE ALL ON FUNCTION public.arcade_starlink_04_assert_board(smallint[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_board_signature(smallint[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_board_metrics(smallint[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_force_playable_fallback(smallint[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_generate_initial_board(bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_refill_board(smallint[],integer[],bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_reshuffle_dead_board(smallint[],bigint)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Golden fixture. Migration fails if PostgreSQL diverges from the TS contract.
-- ---------------------------------------------------------------------------

DO $golden$
DECLARE
  v_state bigint := 5;
  v_expected_rng bigint[] := ARRAY[
    1351845,336141829,3472693697,3580160835,1234782181,
    1306475959,3881343203,2094324449,379170181,1175100977
  ];
  v_i integer;

  v_initial_expected smallint[] := ARRAY[
    5,3,5,5,0,0,0,
    1,1,2,5,4,5,0,
    4,3,4,0,1,3,0,
    0,5,2,2,4,1,3,
    2,2,3,2,2,5,4,
    4,4,1,0,2,4,1,
    2,0,2,1,5,5,4
  ]::smallint[];

  v_refill_expected smallint[] := ARRAY[
    2,0,1,3,4,0,0,
    5,3,5,5,5,5,0,
    1,1,2,5,0,3,0,
    4,3,4,5,4,1,3,
    0,5,3,0,1,5,4,
    4,4,1,0,4,4,1,
    2,0,2,1,5,5,4
  ]::smallint[];

  v_dead smallint[] := ARRAY[
    0,2,4,0,2,4,0,
    1,3,5,1,3,5,1,
    2,4,0,2,4,0,2,
    3,5,1,3,5,1,3,
    4,0,2,4,0,2,4,
    5,1,3,5,1,3,5,
    0,2,4,0,2,4,0
  ]::smallint[];

  v_fallback_expected smallint[] := ARRAY[
    1,2,4,3,2,4,5,
    1,3,5,1,3,5,1,
    2,4,0,2,4,0,2,
    3,5,0,0,0,1,3,
    4,0,2,4,0,2,4,
    5,1,3,5,1,3,5,
    0,2,4,0,2,4,0
  ]::smallint[];

  v_reshuffle_expected smallint[] := ARRAY[
    4,2,0,0,1,4,1,
    2,0,4,4,5,3,5,
    2,1,3,3,5,1,0,
    3,5,1,3,5,2,0,
    0,1,2,0,4,2,0,
    5,2,5,0,4,2,3,
    3,2,0,4,4,4,1
  ]::smallint[];

  v_result jsonb;
BEGIN
  FOR v_i IN 1..10 LOOP
    v_state := public.arcade_xorshift32_next(v_state);
    IF v_state IS DISTINCT FROM v_expected_rng[v_i] THEN
      RAISE EXCEPTION '[STARLINK 04 GOLDEN] RNG mismatch at step %: got %, expected %.',
        v_i,v_state,v_expected_rng[v_i];
    END IF;
  END LOOP;

  v_result := public.arcade_starlink_04_generate_initial_board(5);

  IF (v_result->>'attempts')::integer <> 3
     OR (v_result->>'rngState')::bigint <> 3052492330
     OR v_result->>'acceptedBy' <> 'SOFT'
     OR v_result->'board' <> to_jsonb(v_initial_expected) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] initial-board fixture mismatch: %',v_result;
  END IF;

  IF v_result->'metrics' <> jsonb_build_object(
    'componentCount',29,
    'playableComponentCount',4,
    'largestComponent',7,
    'removableStarCount',18,
    'componentCountAtLeastFour',2,
    'typeDistribution',to_jsonb(ARRAY[9,7,10,5,9,9]),
    'playable',true
  ) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] initial metrics mismatch: %',v_result->'metrics';
  END IF;

  v_result := public.arcade_starlink_04_refill_board(
    v_initial_expected,
    ARRAY[23,24,28,29,31,32,39],
    3052492330
  );

  IF (v_result->>'rngState')::bigint <> 1892184262
     OR (v_result->>'removedCount')::integer <> 7
     OR v_result->'board' <> to_jsonb(v_refill_expected) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] refill fixture mismatch: %',v_result;
  END IF;

  IF (public.arcade_starlink_04_board_metrics(v_dead)->>'playable')::boolean THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] dead-board fixture unexpectedly playable.';
  END IF;

  IF public.arcade_starlink_04_force_playable_fallback(v_dead)
     IS DISTINCT FROM v_fallback_expected THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] hard fallback fixture mismatch.';
  END IF;

  v_result := public.arcade_starlink_04_reshuffle_dead_board(v_dead,4863);

  IF (v_result->>'attempts')::integer <> 2
     OR (v_result->>'rngState')::bigint <> 359457395
     OR (v_result->>'usedHardFallback')::boolean
     OR v_result->'board' <> to_jsonb(v_reshuffle_expected) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] reshuffle fixture mismatch: %',v_result;
  END IF;

  IF v_result->'metrics' <> jsonb_build_object(
    'componentCount',26,
    'playableComponentCount',10,
    'largestComponent',5,
    'removableStarCount',32,
    'componentCountAtLeastFour',1,
    'typeDistribution',to_jsonb(ARRAY[10,7,9,7,9,7]),
    'playable',true
  ) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] reshuffle metrics mismatch: %',v_result->'metrics';
  END IF;

  RAISE NOTICE '[STARLINK 04 GOLDEN] deterministic board engine fixture passed.';
END;
$golden$;

COMMIT;

NOTIFY pgrst, 'reload schema';
