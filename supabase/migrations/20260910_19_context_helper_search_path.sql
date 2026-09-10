-- B.R.A.N.D. 2.0 — context helper compatibility for private SECURITY DEFINER callers
-- current_student_id/current_classroom_id historically relied on caller search_path.
-- Pin them to public so they also work when invoked from hardened private functions.

DO $preflight$
BEGIN
  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL THEN
    RAISE EXCEPTION '[NEWBIE] required context helper missing';
  END IF;
END
$preflight$;

ALTER FUNCTION public.current_student_id() SET search_path TO public, pg_temp;
ALTER FUNCTION public.current_classroom_id() SET search_path TO public, pg_temp;

DO $postcheck$
DECLARE v_student_config text[]; v_class_config text[];
BEGIN
  SELECT p.proconfig INTO v_student_config FROM pg_proc p WHERE p.oid='public.current_student_id()'::regprocedure;
  SELECT p.proconfig INTO v_class_config FROM pg_proc p WHERE p.oid='public.current_classroom_id()'::regprocedure;
  IF v_student_config IS NULL OR NOT ('search_path=public, pg_temp'=ANY(v_student_config)) THEN
    RAISE EXCEPTION '[NEWBIE] current_student_id search_path postcheck failed';
  END IF;
  IF v_class_config IS NULL OR NOT ('search_path=public, pg_temp'=ANY(v_class_config)) THEN
    RAISE EXCEPTION '[NEWBIE] current_classroom_id search_path postcheck failed';
  END IF;
END
$postcheck$;
