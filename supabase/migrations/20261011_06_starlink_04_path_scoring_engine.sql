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
