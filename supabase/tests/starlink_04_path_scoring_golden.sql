-- B.R.A.N.D 2.0 — Starlink #04 path/loop/scoring postcheck
DO $test$
DECLARE
  v_board smallint[]:=ARRAY[
    5,1,2,3,0,1,5,3,5,5,2,3,0,1,2,5,0,5,2,3,0,1,2,5,5,1,2,3,
    5,1,2,3,0,1,5,3,0,1,2,3,0,1,5,3,0,1,2,3,5
  ]::smallint[];
  v_reduced jsonb;
  v_release jsonb;
BEGIN
  IF to_regprocedure('public.arcade_starlink_04_reduce_path(smallint[],integer[])') IS NULL
     OR to_regprocedure('public.arcade_starlink_04_score_clear(text,integer,integer,integer)') IS NULL THEN
    RAISE EXCEPTION '[TEST STARLINK PATH] path/scoring helper missing.';
  END IF;

  v_reduced:=public.arcade_starlink_04_reduce_path(
    v_board,ARRAY[8,8,10,9,17,9,17,48,23,9,15,8,9]
  );
  IF v_reduced->'path'<>to_jsonb(ARRAY[8,9,17,23,15])
     OR NOT (v_reduced->>'loopClosed')::boolean
     OR (v_reduced->>'loopTwiceArea')::integer<>5 THEN
    RAISE EXCEPTION '[TEST STARLINK PATH] reducer mismatch: %',v_reduced;
  END IF;

  v_release:=public.arcade_starlink_04_release_path(v_board,ARRAY[8,9,17,23,15],true);
  IF (v_release->>'removedCount')::integer<>12 THEN
    RAISE EXCEPTION '[TEST STARLINK PATH] loop removal mismatch: %',v_release;
  END IF;

  IF (public.arcade_starlink_04_score_clear('NORMAL',6,6,4)->>'awardedScore')::integer<>862
     OR (public.arcade_starlink_04_score_clear('LOOP',5,12,4)->>'awardedScore')::integer<>4743 THEN
    RAISE EXCEPTION '[TEST STARLINK PATH] scoring mismatch.';
  END IF;

  IF has_function_privilege('authenticated','public.arcade_starlink_04_reduce_path(smallint[],integer[])','EXECUTE')
     OR has_function_privilege('authenticated','public.arcade_starlink_04_score_clear(text,integer,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION '[TEST STARLINK PATH] internal helper exposed to browser role.';
  END IF;

  RAISE NOTICE '[TEST STARLINK PATH] path/loop/scoring fixture passed.';
END;
$test$;
