-- =============================================================================
-- B.R.A.N.D 2.0 — GAME 4 Starlink — deterministic server engine (pure functions)
-- 2026-10-30 mainline re-integration.
--
-- Source: starlink-step2a-core-schema @ c8fe5f9 (2026-10-11/12), files
--   20261011_05_starlink_04_deterministic_board_engine.sql
--   20261011_06_starlink_04_path_scoring_engine.sql
--   20261012_01_starlink_04_full_run_replay.sql
-- copied verbatim below (each section keeps its own BEGIN/COMMIT and inline
-- golden assertions, so a wrong engine aborts the apply).
--
-- Safety:
--   * Creates only new public.arcade_starlink_04_* functions. No table changes.
--   * Depends only on existing public.arcade_xorshift32_next(bigint).
--   * Every function is REVOKEd from PUBLIC/anon/authenticated (internal only).
--   * Re-running is safe (CREATE OR REPLACE of the same pure functions).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- section: 20261011_05_starlink_04_deterministic_board_engine.sql
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- section: 20261011_06_starlink_04_path_scoring_engine.sql
-- ---------------------------------------------------------------------------
-- =============================================================================
-- B.R.A.N.D 2.0 — Starlink #04 path / loop / scoring engine
-- FINAL v0.3 — 2026-10-11
--
-- Reusable server-authoritative primitives:
--   * exact CELL_ENTER precedence
--   * immediate backtrack
--   * simple-polygon loop validation
--   * integer shoelace twiceArea >= 2
--   * release removal set
--   * normal/loop score + combo boundaries
--
-- No public submit RPC is enabled here.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_assert_board(smallint[])') IS NULL THEN
    RAISE EXCEPTION '[STARLINK 04 PATH] deterministic board engine is missing.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_are_adjacent(
  p_a integer,
  p_b integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT
    p_a BETWEEN 0 AND 48
    AND p_b BETWEEN 0 AND 48
    AND p_a<>p_b
    AND abs((p_a/7)-(p_b/7))<=1
    AND abs((p_a%7)-(p_b%7))<=1;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_loop_twice_area(p_path integer[])
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer:=cardinality(p_path);
  v_i integer;
  v_a integer;
  v_b integer;
  v_sum integer:=0;
BEGIN
  IF v_n<3 THEN RETURN 0; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_path) cell WHERE cell<0 OR cell>48) THEN
    RAISE EXCEPTION '[STARLINK 04 PATH] path cell outside board.' USING ERRCODE='22023';
  END IF;

  FOR v_i IN 1..v_n LOOP
    v_a:=p_path[v_i];
    v_b:=p_path[CASE WHEN v_i=v_n THEN 1 ELSE v_i+1 END];
    v_sum:=v_sum+((v_a%7)*(v_b/7)-(v_b%7)*(v_a/7));
  END LOOP;
  RETURN abs(v_sum);
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_segments_intersect(
  p_a0 integer,
  p_a1 integer,
  p_b0 integer,
  p_b1 integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ax integer:=p_a0%7; v_ay integer:=p_a0/7;
  v_bx integer:=p_a1%7; v_by integer:=p_a1/7;
  v_cx integer:=p_b0%7; v_cy integer:=p_b0/7;
  v_dx integer:=p_b1%7; v_dy integer:=p_b1/7;
  v_o1 integer; v_o2 integer; v_o3 integer; v_o4 integer;
  v_c1 integer; v_c2 integer; v_c3 integer; v_c4 integer;
BEGIN
  v_c1:=(v_bx-v_ax)*(v_cy-v_ay)-(v_by-v_ay)*(v_cx-v_ax);
  v_c2:=(v_bx-v_ax)*(v_dy-v_ay)-(v_by-v_ay)*(v_dx-v_ax);
  v_c3:=(v_dx-v_cx)*(v_ay-v_cy)-(v_dy-v_cy)*(v_ax-v_cx);
  v_c4:=(v_dx-v_cx)*(v_by-v_cy)-(v_dy-v_cy)*(v_bx-v_cx);

  v_o1:=CASE WHEN v_c1=0 THEN 0 WHEN v_c1>0 THEN 1 ELSE -1 END;
  v_o2:=CASE WHEN v_c2=0 THEN 0 WHEN v_c2>0 THEN 1 ELSE -1 END;
  v_o3:=CASE WHEN v_c3=0 THEN 0 WHEN v_c3>0 THEN 1 ELSE -1 END;
  v_o4:=CASE WHEN v_c4=0 THEN 0 WHEN v_c4>0 THEN 1 ELSE -1 END;

  IF v_o1<>v_o2 AND v_o3<>v_o4 THEN RETURN true; END IF;

  IF v_o1=0 AND v_cx BETWEEN least(v_ax,v_bx) AND greatest(v_ax,v_bx)
            AND v_cy BETWEEN least(v_ay,v_by) AND greatest(v_ay,v_by) THEN RETURN true; END IF;
  IF v_o2=0 AND v_dx BETWEEN least(v_ax,v_bx) AND greatest(v_ax,v_bx)
            AND v_dy BETWEEN least(v_ay,v_by) AND greatest(v_ay,v_by) THEN RETURN true; END IF;
  IF v_o3=0 AND v_ax BETWEEN least(v_cx,v_dx) AND greatest(v_cx,v_dx)
            AND v_ay BETWEEN least(v_cy,v_dy) AND greatest(v_cy,v_dy) THEN RETURN true; END IF;
  IF v_o4=0 AND v_bx BETWEEN least(v_cx,v_dx) AND greatest(v_cx,v_dx)
            AND v_by BETWEEN least(v_cy,v_dy) AND greatest(v_cy,v_dy) THEN RETURN true; END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_is_simple_loop(p_path integer[])
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_n integer:=cardinality(p_path);
  v_i integer;
  v_j integer;
  v_a0 integer;
  v_a1 integer;
  v_b0 integer;
  v_b1 integer;
BEGIN
  IF v_n<3 THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_path) cell WHERE cell<0 OR cell>48) THEN RETURN false; END IF;
  IF (SELECT count(DISTINCT cell) FROM unnest(p_path) cell)<>v_n THEN RETURN false; END IF;

  FOR v_i IN 1..v_n LOOP
    v_a0:=p_path[v_i];
    v_a1:=p_path[CASE WHEN v_i=v_n THEN 1 ELSE v_i+1 END];

    FOR v_j IN (v_i+1)..v_n LOOP
      IF v_j>v_n THEN CONTINUE; END IF;
      -- Neighboring edges share an intended endpoint.
      IF v_j=v_i+1 THEN CONTINUE; END IF;
      IF v_i=1 AND v_j=v_n THEN CONTINUE; END IF;

      v_b0:=p_path[v_j];
      v_b1:=p_path[CASE WHEN v_j=v_n THEN 1 ELSE v_j+1 END];

      IF public.arcade_starlink_04_segments_intersect(v_a0,v_a1,v_b0,v_b1) THEN
        RETURN false;
      END IF;
    END LOOP;
  END LOOP;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_reduce_path(
  p_board smallint[],
  p_cells integer[]
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_path integer[];
  v_actions jsonb:='[]'::jsonb;
  v_loop_closed boolean:=false;
  v_type integer;
  v_i integer;
  v_cell integer;
  v_len integer;
  v_last integer;
  v_first integer;
  v_can_loop boolean;
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);
  IF cardinality(p_cells)<1 THEN
    RAISE EXCEPTION '[STARLINK 04 PATH] at least one start cell is required.' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(p_cells) cell WHERE cell<0 OR cell>48) THEN
    RAISE EXCEPTION '[STARLINK 04 PATH] input cell outside board.' USING ERRCODE='22023';
  END IF;

  v_path:=ARRAY[p_cells[1]];
  v_type:=p_board[p_cells[1]+1];

  IF cardinality(p_cells)>=2 THEN
    FOR v_i IN 2..cardinality(p_cells) LOOP
      v_cell:=p_cells[v_i];
      v_len:=cardinality(v_path);
      v_last:=v_path[v_len];
      v_first:=v_path[1];

      -- 1. loop closed
      IF v_loop_closed THEN
        v_actions:=v_actions||jsonb_build_array('IGNORE');
        CONTINUE;
      END IF;

      -- 2. same as current last
      IF v_cell=v_last THEN
        v_actions:=v_actions||jsonb_build_array('IGNORE');
        CONTINUE;
      END IF;

      -- 3. immediate backtrack
      IF v_len>=2 AND v_cell=v_path[v_len-1] THEN
        v_path:=v_path[1:v_len-1];
        v_actions:=v_actions||jsonb_build_array('BACKTRACK');
        CONTINUE;
      END IF;

      -- 4. loop close
      v_can_loop:=
        v_cell=v_first
        AND v_len>=5
        AND public.arcade_starlink_04_are_adjacent(v_last,v_first)
        AND public.arcade_starlink_04_is_simple_loop(v_path)
        AND public.arcade_starlink_04_loop_twice_area(v_path)>=2;

      IF v_can_loop THEN
        v_loop_closed:=true;
        v_actions:=v_actions||jsonb_build_array('LOOP_CLOSE');
        CONTINUE;
      END IF;

      -- 5. earlier duplicate
      IF v_cell=ANY(v_path) THEN
        v_actions:=v_actions||jsonb_build_array('IGNORE');
        CONTINUE;
      END IF;

      -- 6. wrong type
      IF p_board[v_cell+1]<>v_type THEN
        v_actions:=v_actions||jsonb_build_array('IGNORE');
        CONTINUE;
      END IF;

      -- 7. non-adjacent
      IF NOT public.arcade_starlink_04_are_adjacent(v_last,v_cell) THEN
        v_actions:=v_actions||jsonb_build_array('IGNORE');
        CONTINUE;
      END IF;

      -- 8. append
      v_path:=array_append(v_path,v_cell);
      v_actions:=v_actions||jsonb_build_array('APPEND');
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'currentType',v_type,
    'path',to_jsonb(v_path),
    'loopClosed',v_loop_closed,
    'loopTwiceArea',CASE WHEN v_loop_closed THEN public.arcade_starlink_04_loop_twice_area(v_path) ELSE 0 END,
    'enterActions',v_actions
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_release_path(
  p_board smallint[],
  p_path integer[],
  p_loop_closed boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_len integer:=cardinality(p_path);
  v_type integer;
  v_i integer;
  v_removed integer[];
  v_twice_area integer:=0;
BEGIN
  PERFORM public.arcade_starlink_04_assert_board(p_board);
  IF v_len<1 THEN
    RETURN jsonb_build_object('kind','CANCEL','pathLength',0,'removedCells','[]'::jsonb,'removedCount',0,'starType',NULL,'loopTwiceArea',0);
  END IF;

  IF EXISTS(SELECT 1 FROM unnest(p_path) cell WHERE cell<0 OR cell>48) THEN
    RAISE EXCEPTION '[STARLINK 04 PATH] release path outside board.' USING ERRCODE='22023';
  END IF;
  IF (SELECT count(DISTINCT cell) FROM unnest(p_path) cell)<>v_len THEN
    RAISE EXCEPTION '[STARLINK 04 PATH] release path contains duplicate cell.' USING ERRCODE='22023';
  END IF;

  v_type:=p_board[p_path[1]+1];

  FOR v_i IN 1..v_len LOOP
    IF p_board[p_path[v_i]+1]<>v_type THEN
      RAISE EXCEPTION '[STARLINK 04 PATH] release path mixes star types.' USING ERRCODE='22023';
    END IF;
    IF v_i>1 AND NOT public.arcade_starlink_04_are_adjacent(p_path[v_i-1],p_path[v_i]) THEN
      RAISE EXCEPTION '[STARLINK 04 PATH] release path contains non-adjacent step.' USING ERRCODE='22023';
    END IF;
  END LOOP;

  IF v_len<3 THEN
    RETURN jsonb_build_object(
      'kind','CANCEL','pathLength',v_len,'removedCells','[]'::jsonb,
      'removedCount',0,'starType',v_type,'loopTwiceArea',0
    );
  END IF;

  IF p_loop_closed THEN
    IF v_len<5
       OR NOT public.arcade_starlink_04_are_adjacent(p_path[v_len],p_path[1])
       OR NOT public.arcade_starlink_04_is_simple_loop(p_path)
       OR public.arcade_starlink_04_loop_twice_area(p_path)<2 THEN
      RAISE EXCEPTION '[STARLINK 04 PATH] invalid loop-closed release.' USING ERRCODE='22023';
    END IF;

    SELECT array_agg(idx-1 ORDER BY idx)
    INTO v_removed
    FROM generate_subscripts(p_board,1) idx
    WHERE p_board[idx]=v_type;

    v_twice_area:=public.arcade_starlink_04_loop_twice_area(p_path);

    RETURN jsonb_build_object(
      'kind','LOOP','pathLength',v_len,'removedCells',to_jsonb(v_removed),
      'removedCount',cardinality(v_removed),'starType',v_type,'loopTwiceArea',v_twice_area
    );
  END IF;

  RETURN jsonb_build_object(
    'kind','NORMAL','pathLength',v_len,'removedCells',to_jsonb(p_path),
    'removedCount',v_len,'starType',v_type,'loopTwiceArea',0
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_combo_multiplier(p_combo_count integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_combo_count<1 THEN
    RAISE EXCEPTION '[STARLINK 04 SCORE] combo must be positive.' USING ERRCODE='22023';
  END IF;
  RETURN least(100+(p_combo_count-1)*5,150);
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_next_combo(
  p_current_combo integer,
  p_last_commit_active_ms integer,
  p_next_commit_active_ms integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_next_commit_active_ms IS NULL OR p_next_commit_active_ms<0 THEN
    RAISE EXCEPTION '[STARLINK 04 SCORE] next commit time invalid.' USING ERRCODE='22023';
  END IF;
  IF p_last_commit_active_ms IS NULL THEN RETURN 1; END IF;
  IF p_last_commit_active_ms<0 OR p_next_commit_active_ms<p_last_commit_active_ms THEN
    RAISE EXCEPTION '[STARLINK 04 SCORE] commit times must be monotonic.' USING ERRCODE='22023';
  END IF;

  RETURN CASE
    WHEN p_next_commit_active_ms-p_last_commit_active_ms<=2000
      THEN p_current_combo+1
    ELSE 1
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.arcade_starlink_04_score_clear(
  p_kind text,
  p_path_length integer,
  p_removed_count integer,
  p_combo_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
DECLARE
  v_base integer;
  v_before_combo integer;
  v_mult integer:=public.arcade_starlink_04_combo_multiplier(p_combo_count);
  v_awarded integer;
BEGIN
  IF p_kind='NORMAL' THEN
    IF p_path_length<3 THEN RAISE EXCEPTION '[STARLINK 04 SCORE] normal path too short.'; END IF;
    v_base:=25*p_path_length*(p_path_length-1);
    v_before_combo:=v_base;
  ELSIF p_kind='LOOP' THEN
    IF p_removed_count<5 THEN RAISE EXCEPTION '[STARLINK 04 SCORE] loop removed count invalid.'; END IF;
    v_base:=25*p_removed_count*(p_removed_count-1);
    v_before_combo:=floor(v_base*125/100.0)::integer;
  ELSE
    RAISE EXCEPTION '[STARLINK 04 SCORE] unsupported clear kind %.',p_kind USING ERRCODE='22023';
  END IF;

  v_awarded:=floor(v_before_combo*v_mult/100.0)::integer;

  RETURN jsonb_build_object(
    'clearKind',p_kind,
    'comboCount',p_combo_count,
    'comboMultiplierPercent',v_mult,
    'baseScore',v_base,
    'scoreBeforeCombo',v_before_combo,
    'awardedScore',v_awarded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.arcade_starlink_04_are_adjacent(integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_loop_twice_area(integer[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_segments_intersect(integer,integer,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_is_simple_loop(integer[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_reduce_path(smallint[],integer[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_release_path(smallint[],integer[],boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_combo_multiplier(integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_next_combo(integer,integer,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.arcade_starlink_04_score_clear(text,integer,integer,integer) FROM PUBLIC,anon,authenticated;

DO $golden$
DECLARE
  v_board smallint[]:=ARRAY[
    5,1,2,3,0,1,5,3,5,5,2,3,0,1,2,5,0,5,2,3,0,1,2,5,5,1,2,3,
    5,1,2,3,0,1,5,3,0,1,2,3,0,1,5,3,0,1,2,3,5
  ]::smallint[];
  v_sequence integer[]:=ARRAY[8,8,10,9,17,9,17,48,23,9,15,8,9];
  v_expected_actions jsonb:='["IGNORE","IGNORE","APPEND","APPEND","BACKTRACK","APPEND","IGNORE","APPEND","IGNORE","APPEND","LOOP_CLOSE","IGNORE"]'::jsonb;
  v_reduced jsonb;
  v_release jsonb;
  v_score jsonb;
BEGIN
  IF public.arcade_starlink_04_loop_twice_area(ARRAY[8,9,17,23,15])<>5 THEN
    RAISE EXCEPTION '[STARLINK 04 PATH GOLDEN] simple loop area mismatch.';
  END IF;
  IF NOT public.arcade_starlink_04_is_simple_loop(ARRAY[8,9,17,23,15]) THEN
    RAISE EXCEPTION '[STARLINK 04 PATH GOLDEN] valid simple loop rejected.';
  END IF;
  IF public.arcade_starlink_04_is_simple_loop(ARRAY[8,16,15,9,1]) THEN
    RAISE EXCEPTION '[STARLINK 04 PATH GOLDEN] self-intersection accepted.';
  END IF;

  v_reduced:=public.arcade_starlink_04_reduce_path(v_board,v_sequence);
  IF v_reduced->'path'<>to_jsonb(ARRAY[8,9,17,23,15])
     OR NOT (v_reduced->>'loopClosed')::boolean
     OR (v_reduced->>'loopTwiceArea')::integer<>5
     OR v_reduced->'enterActions'<>v_expected_actions THEN
    RAISE EXCEPTION '[STARLINK 04 PATH GOLDEN] reducer mismatch: %',v_reduced;
  END IF;

  v_release:=public.arcade_starlink_04_release_path(
    v_board,ARRAY[8,9,17,23,15],true
  );
  IF v_release->>'kind'<>'LOOP'
     OR (v_release->>'removedCount')::integer<>12
     OR (v_release->>'loopTwiceArea')::integer<>5 THEN
    RAISE EXCEPTION '[STARLINK 04 PATH GOLDEN] release mismatch: %',v_release;
  END IF;

  v_score:=public.arcade_starlink_04_score_clear('NORMAL',6,6,4);
  IF (v_score->>'awardedScore')::integer<>862 THEN
    RAISE EXCEPTION '[STARLINK 04 SCORE GOLDEN] normal score mismatch: %',v_score;
  END IF;

  v_score:=public.arcade_starlink_04_score_clear('LOOP',5,12,4);
  IF (v_score->>'baseScore')::integer<>3300
     OR (v_score->>'scoreBeforeCombo')::integer<>4125
     OR (v_score->>'awardedScore')::integer<>4743 THEN
    RAISE EXCEPTION '[STARLINK 04 SCORE GOLDEN] loop score mismatch: %',v_score;
  END IF;

  IF public.arcade_starlink_04_next_combo(3,10000,12000)<>4
     OR public.arcade_starlink_04_next_combo(3,10000,12001)<>1 THEN
    RAISE EXCEPTION '[STARLINK 04 SCORE GOLDEN] combo boundary mismatch.';
  END IF;

  RAISE NOTICE '[STARLINK 04 PATH GOLDEN] path/loop/scoring fixture passed.';
END;
$golden$;

COMMIT;
NOTIFY pgrst,'reload schema';

-- ---------------------------------------------------------------------------
-- section: 20261012_01_starlink_04_full_run_replay.sql
-- ---------------------------------------------------------------------------
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
