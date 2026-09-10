-- B.R.A.N.D. 2.0 — Newbie Support must not inflate Credit Score V2 income creation.
-- Drift-guarded patch against the production definition audited immediately before rollout.

DO $patch$
DECLARE
  v_sig regprocedure := 'public._credit_score_v2_compute(integer,date)'::regprocedure;
  v_def text;
  v_expected_md5 text := '4a8db67f894261e9aeebcf2ba367ade2';
  v_old text := 'AND t.source_type::text NOT IN (''INITIAL_BALANCE'',''CORRECTION'',''REVERSAL'',''BV_REVOKE'');';
  v_new text := 'AND t.source_type::text NOT IN (''INITIAL_BALANCE'',''CORRECTION'',''REVERSAL'',''BV_REVOKE'',''NEWBIE_SETTLEMENT'');';
BEGIN
  v_def := pg_get_functiondef(v_sig);
  IF md5(v_def) <> v_expected_md5 THEN
    RAISE EXCEPTION '[NEWBIE] credit V2 definition drift detected; expected %, got %', v_expected_md5, md5(v_def);
  END IF;
  IF position(v_old IN v_def)=0 THEN
    RAISE EXCEPTION '[NEWBIE] credit V2 target predicate not found';
  END IF;
  v_def := replace(v_def,v_old,v_new);
  EXECUTE v_def;
END
$patch$;

DO $postcheck$
DECLARE v_def text;
BEGIN
  v_def:=pg_get_functiondef('public._credit_score_v2_compute(integer,date)'::regprocedure);
  IF position('''NEWBIE_SETTLEMENT''' IN v_def)=0 THEN
    RAISE EXCEPTION '[NEWBIE] credit V2 exclusion postcheck failed';
  END IF;
END
$postcheck$;
