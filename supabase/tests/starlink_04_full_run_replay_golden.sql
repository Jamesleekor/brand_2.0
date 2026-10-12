-- B.R.A.N.D — Starlink #04 full-run replay Golden Fixture v0.3
-- Safe on ephemeral PostgreSQL; doesn't create runs or student records.
DO $golden$
DECLARE
  v_events jsonb := '[
    {"type":"PATH_START","elapsed_ms":100,"cell":22},
    {"type":"CELL_ENTER","elapsed_ms":150,"cell":29},
    {"type":"CELL_ENTER","elapsed_ms":200,"cell":30},
    {"type":"CELL_ENTER","elapsed_ms":220,"cell":36},
    {"type":"PATH_RELEASE","elapsed_ms":250},
    {"type":"PATH_START","elapsed_ms":450,"cell":3},
    {"type":"CELL_ENTER","elapsed_ms":470,"cell":9},
    {"type":"CELL_ENTER","elapsed_ms":490,"cell":10},
    {"type":"PATH_RELEASE","elapsed_ms":500}
  ]'::jsonb;
  v_initial_board smallint[] := ARRAY[
    2,4,2,2,3,1,0,1,2,1,2,5,0,1,5,5,2,4,5,5,1,1,4,1,0,4,0,4,
    0,4,4,1,1,2,3,5,4,0,4,5,4,2,0,0,2,3,1,5,5
  ]::smallint[];
  v_final_board smallint[] := ARRAY[
    2,4,2,4,3,1,0,1,5,4,3,5,0,1,5,5,1,4,5,5,1,1,4,2,0,4,0,4,
    0,2,1,1,1,2,3,5,5,0,4,5,4,2,0,0,2,3,1,5,5
  ]::smallint[];
  v_late jsonb := '[
    {"type":"PATH_START","elapsed_ms":59900,"cell":22},
    {"type":"CELL_ENTER","elapsed_ms":59910,"cell":29},
    {"type":"CELL_ENTER","elapsed_ms":59920,"cell":30},
    {"type":"CELL_ENTER","elapsed_ms":59930,"cell":36},
    {"type":"PATH_RELEASE","elapsed_ms":59999}
  ]'::jsonb;
  v_result jsonb;
  v_threw boolean;
BEGIN
  v_result := public.arcade_starlink_04_replay(6059,v_events,60000);
  IF (v_result->>'official_score')::integer <> 457
     OR (v_result->>'official_duration_ms')::integer <> 60000
     OR (v_result->>'game_end_wall_ms')::integer <> 60000
     OR (v_result->>'paused_total_ms')::integer <> 0
     OR (v_result->>'refill_rng_state')::bigint <> 1054902790
     OR (v_result->>'reshuffle_rng_state')::bigint <> 3968834942
     OR v_result->'board' <> to_jsonb(v_final_board)
     OR v_result->'stats' <> jsonb_build_object(
       'totalRemovedStars',7,
       'normalClearCount',2,
       'loopCount',0,
       'maxLinkLength',4,
       'maxCombo',2,
       'largestLoopRemovedCount',0,
       'reshuffleCount',0
     )
     OR (v_result->'clear_log'->0->>'awardedScore')::integer <> 300
     OR (v_result->'clear_log'->1->>'awardedScore')::integer <> 157 THEN
    RAISE EXCEPTION '[STARLINK REPLAY GOLDEN] two clear run mismatch: %',v_result;
  END IF;

  v_result := public.arcade_starlink_04_replay(6059,v_late,60000);
  IF (v_result->>'official_score')::integer <> 300
     OR (v_result->>'refill_rng_state')::bigint <> 150626425
     OR v_result->'board' <> to_jsonb(v_initial_board) THEN
    RAISE EXCEPTION '[STARLINK REPLAY GOLDEN] GAME_END during settle mismatch: %',v_result;
  END IF;

  v_threw := false;
  BEGIN
    PERFORM public.arcade_starlink_04_replay(
      6059,
      '[{"type":"PATH_START","elapsed_ms":100,"cell":22},{"type":"CELL_ENTER","elapsed_ms":150,"cell":29},{"type":"CELL_ENTER","elapsed_ms":200,"cell":30},{"type":"CELL_ENTER","elapsed_ms":220,"cell":36},{"type":"PATH_RELEASE","elapsed_ms":250},{"type":"PATH_START","elapsed_ms":300,"cell":3}]'::jsonb,
      60000
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_threw := true;
  END;
  IF NOT v_threw THEN RAISE EXCEPTION '[STARLINK REPLAY GOLDEN] accepted settle-locked input.'; END IF;

  v_threw := false;
  BEGIN
    PERFORM public.arcade_starlink_04_replay(6059,v_events,59999);
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_threw := true;
  END;
  IF NOT v_threw THEN RAISE EXCEPTION '[STARLINK REPLAY GOLDEN] accepted premature normal finish.'; END IF;

  IF has_function_privilege('authenticated','public.arcade_starlink_04_replay(bigint,jsonb,integer)','EXECUTE')
    OR has_function_privilege('anon','public.arcade_starlink_04_replay(bigint,jsonb,integer)','EXECUTE') THEN
    RAISE EXCEPTION '[STARLINK REPLAY GOLDEN] internal replay helper executable by browser roles.';
  END IF;

  RAISE NOTICE '[STARLINK REPLAY GOLDEN] two clears + terminal settle + lock + early finish passed.';
END;
$golden$;
