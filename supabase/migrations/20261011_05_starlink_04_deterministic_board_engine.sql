-- =============================================================================
-- B.R.A.N.D 2.0 — Starlink #04 deterministic 7x7 board engine
-- FINAL v0.3 RNG contract — 2026-10-11
--
-- gameplay_seed is a non-zero uint32. Three independent streams are derived:
--   INITIAL    domain 0xA341316C
--   REFILL     domain 0xC8013EA4
--   RESHUFFLE  domain 0xAD90777D
--   ZERO fallback      0x6D2B79F5
--
-- deriveSeed32(base,domain):
--   uint32(base XOR domain) -> zero fallback -> exactly 4 xorshift32 rounds.
--
-- No production gameplay submit RPC is enabled by this migration.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.arcade_xorshift32_next(bigint)') IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04] arcade_xorshift32_next(bigint) is missing.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_derive_seed32(
  p_base_seed bigint,
  p_domain bigint
)
RETURNS bigint
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint;
  v_round integer;
BEGIN
  IF p_base_seed NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] gameplay seed must be a non-zero uint32.'
      USING ERRCODE='P0190';
  END IF;
  IF p_domain NOT BETWEEN 0 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] RNG domain must be uint32.'
      USING ERRCODE='22023';
  END IF;

  v_state := (p_base_seed # p_domain) & 4294967295;
  IF v_state=0 THEN v_state:=1831565813; END IF;

  FOR v_round IN 1..4 LOOP
    v_state:=public.arcade_xorshift32_next(v_state);
  END LOOP;

  IF v_state=0 THEN v_state:=1831565813; END IF;
  RETURN v_state;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_rng_streams(p_gameplay_seed bigint)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'initial',public.arcade_starlink_04_derive_seed32(p_gameplay_seed,2738958700),
    'refill',public.arcade_starlink_04_derive_seed32(p_gameplay_seed,3355524772),
    'reshuffle',public.arcade_starlink_04_derive_seed32(p_gameplay_seed,2911926141)
  );
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
     OR cardinality(p_board)<>49
     OR array_lower(p_board,1)<>1
     OR array_upper(p_board,1)<>49 THEN
    RAISE EXCEPTION '[STARLINK 04] board must contain exactly 49 cells.'
      USING ERRCODE='22023';
  END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(p_board) value
    WHERE value IS NULL OR value<0 OR value>5
  ) THEN
    RAISE EXCEPTION '[STARLINK 04] board contains invalid star type.'
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
  v_visited boolean[]:=array_fill(false,ARRAY[49]);
  v_distribution integer[]:=array_fill(0,ARRAY[6]);
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
  v_component_count integer:=0;
  v_playable_component_count integer:=0;
  v_largest_component integer:=0;
  v_removable_star_count integer:=0;
  v_component_count_ge4 integer:=0;
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);

  FOR v_idx IN 1..49 LOOP
    v_distribution[p_board[v_idx]::integer+1]:=
      v_distribution[p_board[v_idx]::integer+1]+1;
  END LOOP;

  FOR v_start IN 1..49 LOOP
    IF v_visited[v_start] THEN CONTINUE; END IF;

    v_component_count:=v_component_count+1;
    v_type:=p_board[v_start];
    v_queue:=ARRAY[v_start];
    v_visited[v_start]:=true;
    v_cursor:=1;
    v_component_size:=0;

    WHILE v_cursor<=cardinality(v_queue) LOOP
      v_idx:=v_queue[v_cursor];
      v_cursor:=v_cursor+1;
      v_component_size:=v_component_size+1;
      v_row:=(v_idx-1)/7;
      v_col:=(v_idx-1)%7;

      FOR v_dr IN -1..1 LOOP
        FOR v_dc IN -1..1 LOOP
          IF v_dr=0 AND v_dc=0 THEN CONTINUE; END IF;
          v_nr:=v_row+v_dr;
          v_nc:=v_col+v_dc;
          IF v_nr<0 OR v_nr>=7 OR v_nc<0 OR v_nc>=7 THEN CONTINUE; END IF;

          v_neighbor:=v_nr*7+v_nc+1;
          IF NOT v_visited[v_neighbor] AND p_board[v_neighbor]=v_type THEN
            v_visited[v_neighbor]:=true;
            v_queue:=array_append(v_queue,v_neighbor);
          END IF;
        END LOOP;
      END LOOP;
    END LOOP;

    v_largest_component:=greatest(v_largest_component,v_component_size);
    IF v_component_size>=3 THEN
      v_playable_component_count:=v_playable_component_count+1;
      v_removable_star_count:=v_removable_star_count+v_component_size;
    END IF;
    IF v_component_size>=4 THEN
      v_component_count_ge4:=v_component_count_ge4+1;
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

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_force_playable_fallback(p_board smallint[])
RETURNS smallint[]
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_next smallint[]:=p_board;
  v_counts integer[]:=array_fill(0,ARRAY[6]);
  v_target_type integer:=0;
  v_type integer;
  v_idx integer;
  v_target_idx integer;
  v_source_idx integer;
  v_temp smallint;
  v_targets integer[]:=ARRAY[24,25,26]; -- cell IDs 23,24,25
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);

  FOR v_idx IN 1..49 LOOP
    v_counts[p_board[v_idx]::integer+1]:=v_counts[p_board[v_idx]::integer+1]+1;
  END LOOP;

  -- count DESC, tie type id ASC.
  FOR v_type IN 1..5 LOOP
    IF v_counts[v_type+1]>v_counts[v_target_type+1] THEN
      v_target_type:=v_type;
    END IF;
  END LOOP;

  FOREACH v_target_idx IN ARRAY v_targets LOOP
    IF v_next[v_target_idx]=v_target_type THEN CONTINUE; END IF;

    v_source_idx:=NULL;
    FOR v_idx IN 1..49 LOOP
      IF v_idx=ANY(v_targets) THEN CONTINUE; END IF;
      IF v_next[v_idx]=v_target_type THEN
        v_source_idx:=v_idx;
        EXIT;
      END IF;
    END LOOP;

    IF v_source_idx IS NULL THEN
      RAISE EXCEPTION '[STARLINK 04] fallback source star missing.'
        USING ERRCODE='P0290';
    END IF;

    v_temp:=v_next[v_target_idx];
    v_next[v_target_idx]:=v_target_type::smallint;
    v_next[v_source_idx]:=v_temp;
  END LOOP;

  IF NOT (public.arcade_starlink_04_board_metrics(v_next)->>'playable')::boolean THEN
    RAISE EXCEPTION '[STARLINK 04] hard fallback failed.'
      USING ERRCODE='P0290';
  END IF;

  RETURN v_next;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_generate_initial_board(p_gameplay_seed bigint)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint:=public.arcade_starlink_04_derive_seed32(p_gameplay_seed,2738958700);
  v_attempt integer;
  v_cell integer;
  v_candidate smallint[];
  v_first_playable smallint[];
  v_first_metrics jsonb;
  v_last_candidate smallint[];
  v_metrics jsonb;
  v_fallback smallint[];
BEGIN
  FOR v_attempt IN 1..64 LOOP
    v_candidate:=ARRAY[]::smallint[];

    FOR v_cell IN 0..48 LOOP
      v_state:=public.arcade_xorshift32_next(v_state);
      v_candidate:=array_append(v_candidate,(v_state%6)::smallint);
    END LOOP;

    v_last_candidate:=v_candidate;
    v_metrics:=public.arcade_starlink_04_board_metrics(v_candidate);

    IF (v_metrics->>'playable')::boolean AND v_first_playable IS NULL THEN
      v_first_playable:=v_candidate;
      v_first_metrics:=v_metrics;
    END IF;

    IF (v_metrics->>'playable')::boolean
       AND (v_metrics->>'largestComponent')::integer<=8 THEN
      RETURN jsonb_build_object(
        'board',to_jsonb(v_candidate),
        'rngState',v_state,
        'attempts',v_attempt,
        'acceptedBy','SOFT',
        'metrics',v_metrics
      );
    END IF;
  END LOOP;

  IF v_first_playable IS NOT NULL THEN
    RETURN jsonb_build_object(
      'board',to_jsonb(v_first_playable),
      'rngState',v_state,
      'attempts',64,
      'acceptedBy','FIRST_PLAYABLE',
      'metrics',v_first_metrics
    );
  END IF;

  v_fallback:=public.arcade_starlink_04_force_playable_fallback(v_last_candidate);
  RETURN jsonb_build_object(
    'board',to_jsonb(v_fallback),
    'rngState',v_state,
    'attempts',64,
    'acceptedBy','HARD_FALLBACK',
    'metrics',public.arcade_starlink_04_board_metrics(v_fallback)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_refill_board(
  p_board smallint[],
  p_removed_cells integer[],
  p_refill_rng_state bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_removed integer[]:=coalesce(p_removed_cells,ARRAY[]::integer[]);
  v_result smallint[]:=array_fill(NULL::smallint,ARRAY[49]);
  v_state bigint:=p_refill_rng_state;
  v_col integer;
  v_source_row integer;
  v_target_row integer;
  v_refill_row integer;
  v_source_cell integer;
  v_source_idx integer;
  v_target_idx integer;
  v_duplicate_count integer;
BEGIN
  IF p_board IS NULL THEN RAISE EXCEPTION '[STARLINK 04] board is required.'; END IF;
  PERFORM public.arcade_starlink_04_assert_board(p_board);
  IF p_refill_rng_state NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] refill RNG state must be non-zero uint32.'
      USING ERRCODE='P0190';
  END IF;

  IF EXISTS(SELECT 1 FROM unnest(v_removed) cell WHERE cell IS NULL OR cell<0 OR cell>48) THEN
    RAISE EXCEPTION '[STARLINK 04] removed cell outside board.' USING ERRCODE='22023';
  END IF;
  SELECT cardinality(v_removed)-count(DISTINCT cell)
  INTO v_duplicate_count FROM unnest(v_removed) cell;
  IF coalesce(v_duplicate_count,0)<>0 THEN
    RAISE EXCEPTION '[STARLINK 04] removed cells contain duplicates.' USING ERRCODE='22023';
  END IF;

  FOR v_col IN 0..6 LOOP
    v_target_row:=6;
    FOR v_source_row IN REVERSE 6..0 LOOP
      v_source_cell:=v_source_row*7+v_col;
      IF v_source_cell=ANY(v_removed) THEN CONTINUE; END IF;
      v_source_idx:=v_source_cell+1;
      v_target_idx:=v_target_row*7+v_col+1;
      v_result[v_target_idx]:=p_board[v_source_idx];
      v_target_row:=v_target_row-1;
    END LOOP;

    IF v_target_row>=0 THEN
      FOR v_refill_row IN REVERSE v_target_row..0 LOOP
        v_state:=public.arcade_xorshift32_next(v_state);
        v_target_idx:=v_refill_row*7+v_col+1;
        v_result[v_target_idx]:=(v_state%6)::smallint;
      END LOOP;
    END IF;
  END LOOP;

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
  p_reshuffle_rng_state bigint
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_state bigint:=p_reshuffle_rng_state;
  v_source smallint[]:=p_board;
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
  IF p_reshuffle_rng_state NOT BETWEEN 1 AND 4294967295 THEN
    RAISE EXCEPTION '[STARLINK 04] reshuffle RNG state must be non-zero uint32.'
      USING ERRCODE='P0190';
  END IF;
  IF (public.arcade_starlink_04_board_metrics(p_board)->>'playable')::boolean THEN
    RAISE EXCEPTION '[STARLINK 04] reshuffle requires a dead board.' USING ERRCODE='22023';
  END IF;

  FOR v_attempt IN 1..64 LOOP
    v_candidate:=v_source;
    FOR v_i IN REVERSE 49..2 LOOP
      v_state:=public.arcade_xorshift32_next(v_state);
      v_j:=(v_state%v_i)::integer+1;
      v_temp:=v_candidate[v_i];
      v_candidate[v_i]:=v_candidate[v_j];
      v_candidate[v_j]:=v_temp;
    END LOOP;

    v_last_candidate:=v_candidate;
    v_metrics:=public.arcade_starlink_04_board_metrics(v_candidate);
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

  v_fallback:=public.arcade_starlink_04_force_playable_fallback(v_last_candidate);
  RETURN jsonb_build_object(
    'board',to_jsonb(v_fallback),
    'rngState',v_state,
    'attempts',64,
    'usedHardFallback',true,
    'metrics',public.arcade_starlink_04_board_metrics(v_fallback)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_starlink_04_derive_seed32(bigint,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_rng_streams(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_assert_board(smallint[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_board_signature(smallint[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_board_metrics(smallint[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_force_playable_fallback(smallint[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_generate_initial_board(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_refill_board(smallint[],integer[],bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_reshuffle_dead_board(smallint[],bigint) FROM PUBLIC,anon,authenticated;

-- Golden fixture: final v0.3 stream isolation contract.
DO $golden$
DECLARE
  v_streams jsonb;
  v_initial_expected smallint[]:=ARRAY[
    2,4,2,2,3,1,0,1,2,1,2,5,0,1,5,5,2,4,5,5,1,1,4,1,0,4,0,4,
    0,4,4,1,1,2,3,5,4,0,4,5,4,2,0,0,2,3,1,5,5
  ]::smallint[];
  v_refill_expected smallint[]:=ARRAY[
    5,5,4,2,3,1,0,1,4,1,2,5,0,1,5,5,2,4,5,5,1,1,4,1,0,4,0,4,
    0,4,4,1,1,2,3,5,4,0,4,5,4,2,0,0,2,3,1,5,5
  ]::smallint[];
  v_dead smallint[]:=ARRAY[
    0,2,4,0,2,4,0,1,3,5,1,3,5,1,2,4,0,2,4,0,2,3,5,1,3,5,1,3,
    4,0,2,4,0,2,4,5,1,3,5,1,3,5,0,2,4,0,2,4,0
  ]::smallint[];
  v_fallback_expected smallint[]:=ARRAY[
    1,2,4,3,2,4,5,1,3,5,1,3,5,1,2,4,0,2,4,0,2,3,5,0,0,0,1,3,
    4,0,2,4,0,2,4,5,1,3,5,1,3,5,0,2,4,0,2,4,0
  ]::smallint[];
  v_reshuffle_expected smallint[]:=ARRAY[
    4,3,4,4,2,2,4,1,1,5,3,4,0,1,2,2,3,5,4,2,4,5,4,0,1,0,3,1,
    3,0,0,1,4,2,2,0,3,1,2,0,5,3,0,5,2,0,5,0,5
  ]::smallint[];
  v_result jsonb;
BEGIN
  v_streams:=public.arcade_starlink_04_rng_streams(6059);
  IF v_streams<>jsonb_build_object(
    'initial',2717272021,
    'refill',150626425,
    'reshuffle',3968834942
  ) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] derived streams mismatch: %',v_streams;
  END IF;

  v_result:=public.arcade_starlink_04_generate_initial_board(6059);
  IF (v_result->>'attempts')::integer<>2
     OR (v_result->>'rngState')::bigint<>3695321621
     OR v_result->>'acceptedBy'<>'SOFT'
     OR v_result->'board'<>to_jsonb(v_initial_expected) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] initial mismatch: %',v_result;
  END IF;

  v_result:=public.arcade_starlink_04_refill_board(
    v_initial_expected,ARRAY[0,8,2],150626425
  );
  IF (v_result->>'rngState')::bigint<>3117114772
     OR v_result->'board'<>to_jsonb(v_refill_expected) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] refill mismatch: %',v_result;
  END IF;

  IF public.arcade_starlink_04_force_playable_fallback(v_dead)
     IS DISTINCT FROM v_fallback_expected THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] hard fallback mismatch.';
  END IF;

  v_result:=public.arcade_starlink_04_reshuffle_dead_board(v_dead,3968834942);
  IF (v_result->>'attempts')::integer<>2
     OR (v_result->>'rngState')::bigint<>2063970340
     OR (v_result->>'usedHardFallback')::boolean
     OR v_result->'board'<>to_jsonb(v_reshuffle_expected) THEN
    RAISE EXCEPTION '[STARLINK 04 GOLDEN] reshuffle mismatch: %',v_result;
  END IF;

  RAISE NOTICE '[STARLINK 04 GOLDEN] final v0.3 deterministic board fixture passed.';
END;
$golden$;

COMMIT;
NOTIFY pgrst,'reload schema';
