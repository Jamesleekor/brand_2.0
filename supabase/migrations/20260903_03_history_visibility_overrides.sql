-- ============================================================================
-- B.R.A.N.D 2.0 — Teacher integrated history visibility controls
-- 2026-09-03
--
-- Purpose
--   * Never DELETE or rewrite source transactions / inventory history.
--   * Let teachers hide/restore individual history rows by stable event_key.
--   * Support single, multi-select, and Live Test Agent cleanup from the UI.
--
-- This migration intentionally does NOT replace teacher_get_economy_history().
-- Production has legacy/manual versions of that RPC, so visibility is an
-- independent overlay and cannot change source-ledger integrity.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.history_visibility_overrides (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  event_key text NOT NULL,
  hidden boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT 'MANUAL',
  changed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT history_visibility_event_key_not_blank CHECK (char_length(btrim(event_key)) BETWEEN 1 AND 240),
  CONSTRAINT history_visibility_reason_length CHECK (char_length(reason) BETWEEN 1 AND 200),
  CONSTRAINT history_visibility_unique_event UNIQUE (classroom_id, event_key)
);

CREATE INDEX IF NOT EXISTS ix_history_visibility_classroom_hidden
  ON public.history_visibility_overrides(classroom_id, hidden, changed_at DESC);

COMMENT ON TABLE public.history_visibility_overrides IS
  'Display-only overlay for teacher integrated history. Source ledger rows are never deleted.';
COMMENT ON COLUMN public.history_visibility_overrides.event_key IS
  'Stable event_key emitted by teacher_get_economy_history().';

ALTER TABLE public.history_visibility_overrides ENABLE ROW LEVEL SECURITY;

-- No browser role writes/reads this table directly. Teacher access is only via
-- SECURITY DEFINER RPCs below, which enforce teacher + classroom membership.
REVOKE ALL ON TABLE public.history_visibility_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.history_visibility_overrides TO service_role;

-- --------------------------------------------------------------------------
-- Read visibility state for only the event keys currently needed by the UI.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_history_visibility(
  p_classroom_id integer,
  p_event_keys text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rows jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();

  IF p_classroom_id IS NULL OR p_classroom_id <= 0 THEN
    RAISE EXCEPTION '[HISTORY] classroom id is required.' USING ERRCODE = 'P0710';
  END IF;
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[HISTORY] classroom access denied.' USING ERRCODE = 'P0711';
  END IF;

  IF p_event_keys IS NULL OR cardinality(p_event_keys) = 0 THEN
    RETURN jsonb_build_object('classroom_id', p_classroom_id, 'rows', '[]'::jsonb);
  END IF;
  IF cardinality(p_event_keys) > 500 THEN
    RAISE EXCEPTION '[HISTORY] at most 500 event keys can be checked at once.' USING ERRCODE = 'P0712';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_key', h.event_key,
        'hidden', h.hidden,
        'reason', h.reason,
        'changed_at', h.changed_at
      ) ORDER BY h.changed_at DESC, h.event_key
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.history_visibility_overrides h
  WHERE h.classroom_id = p_classroom_id
    AND h.event_key = ANY(p_event_keys);

  RETURN jsonb_build_object('classroom_id', p_classroom_id, 'rows', v_rows);
END;
$function$;

-- --------------------------------------------------------------------------
-- Hide or restore one or many rows. This updates ONLY the visibility overlay.
-- The original economy/inventory ledger remains untouched.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_set_history_visibility(
  p_classroom_id integer,
  p_event_keys text[],
  p_hidden boolean,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_reason text;
  v_count integer := 0;
BEGIN
  PERFORM public.ensure_teacher_role();

  IF p_classroom_id IS NULL OR p_classroom_id <= 0 THEN
    RAISE EXCEPTION '[HISTORY] classroom id is required.' USING ERRCODE = 'P0710';
  END IF;
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[HISTORY] classroom access denied.' USING ERRCODE = 'P0711';
  END IF;
  IF p_hidden IS NULL THEN
    RAISE EXCEPTION '[HISTORY] visibility state is required.' USING ERRCODE = 'P0713';
  END IF;
  IF p_event_keys IS NULL OR cardinality(p_event_keys) = 0 THEN
    RAISE EXCEPTION '[HISTORY] select at least one history row.' USING ERRCODE = 'P0714';
  END IF;
  IF cardinality(p_event_keys) > 500 THEN
    RAISE EXCEPTION '[HISTORY] at most 500 history rows can be changed at once.' USING ERRCODE = 'P0715';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM unnest(p_event_keys) AS key_row(event_key)
    WHERE event_key IS NULL
       OR char_length(btrim(event_key)) NOT BETWEEN 1 AND 240
  ) THEN
    RAISE EXCEPTION '[HISTORY] invalid event key was supplied.' USING ERRCODE = 'P0716';
  END IF;

  v_reason := coalesce(
    nullif(btrim(p_reason), ''),
    CASE WHEN p_hidden THEN 'MANUAL_HIDE' ELSE 'MANUAL_RESTORE' END
  );
  IF char_length(v_reason) > 200 THEN
    RAISE EXCEPTION '[HISTORY] reason must be 200 characters or fewer.' USING ERRCODE = 'P0717';
  END IF;

  INSERT INTO public.history_visibility_overrides (
    classroom_id, event_key, hidden, reason, changed_by, changed_at
  )
  SELECT
    p_classroom_id,
    normalized.event_key,
    p_hidden,
    v_reason,
    auth.uid(),
    now()
  FROM (
    SELECT DISTINCT btrim(key_row.event_key) AS event_key
    FROM unnest(p_event_keys) AS key_row(event_key)
  ) AS normalized
  ON CONFLICT (classroom_id, event_key) DO UPDATE SET
    hidden = EXCLUDED.hidden,
    reason = EXCLUDED.reason,
    changed_by = EXCLUDED.changed_by,
    changed_at = EXCLUDED.changed_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'classroom_id', p_classroom_id,
    'updated_count', v_count,
    'hidden', p_hidden,
    'reason', v_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_get_history_visibility(integer, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_history_visibility(integer, text[]) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.teacher_set_history_visibility(integer, text[], boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_history_visibility(integer, text[], boolean, text) TO authenticated, service_role;

COMMIT;

-- SQL Editor-safe structural postcheck. No authenticated teacher JWT is needed.
SELECT jsonb_build_object(
  'table_ready', to_regclass('public.history_visibility_overrides') IS NOT NULL,
  'functions_ready', jsonb_build_object(
    'get_visibility', to_regprocedure('public.teacher_get_history_visibility(integer,text[])') IS NOT NULL,
    'set_visibility', to_regprocedure('public.teacher_set_history_visibility(integer,text[],boolean,text)') IS NOT NULL
  ),
  'acl_ready', jsonb_build_object(
    'authenticated_can_get', has_function_privilege('authenticated', 'public.teacher_get_history_visibility(integer,text[])', 'EXECUTE'),
    'authenticated_can_set', has_function_privilege('authenticated', 'public.teacher_set_history_visibility(integer,text[],boolean,text)', 'EXECUTE'),
    'anon_can_get', has_function_privilege('anon', 'public.teacher_get_history_visibility(integer,text[])', 'EXECUTE'),
    'anon_can_set', has_function_privilege('anon', 'public.teacher_set_history_visibility(integer,text[],boolean,text)', 'EXECUTE')
  ),
  'source_ledgers_untouched', true
) AS history_visibility_postcheck;
