-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 2A observation RLS recursion fix
-- 2026-08-13
--
-- Why this patch exists
--   The original student SELECT policy checked for a REVERSAL row by querying
--   guild2_observation_events inside a policy on that same table. PostgreSQL
--   correctly detects that as recursive RLS evaluation and rejects the query.
--
-- Safety
--   * No Guild 1 or Guild 2 history rows are changed or deleted.
--   * Only the affected read policy is replaced.
--   * The helper can return true only for the logged-in student's own public
--     RECOGNITION record that has no REVERSAL record.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.guild2_observation_visible_to_current_student(
  p_observation_event_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
BEGIN
  v_student_id := public.current_student_id();
  IF v_student_id IS NULL THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.guild2_observation_events observation
    WHERE observation.id = p_observation_event_id
      AND observation.student_id = v_student_id
      AND observation.event_kind = 'RECOGNITION'
      AND observation.is_public = true
      AND NOT EXISTS (
        SELECT 1
        FROM public.guild2_observation_events reversal
        WHERE reversal.reversal_of = observation.id
          AND reversal.event_kind = 'REVERSAL'
      )
  );
END;
$$;

-- This helper has no write capability. It is callable only by logged-in app
-- sessions because PostgreSQL evaluates RLS policy expressions as that role.
REVOKE ALL ON FUNCTION public.guild2_observation_visible_to_current_student(bigint)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guild2_observation_visible_to_current_student(bigint)
  TO authenticated;

DROP POLICY IF EXISTS guild2_observation_student_public_select
  ON public.guild2_observation_events;

CREATE POLICY guild2_observation_student_public_select
  ON public.guild2_observation_events
  FOR SELECT TO authenticated
  USING (
    public.guild2_observation_visible_to_current_student(id)
  );

NOTIFY pgrst, 'reload schema';

COMMIT;

-- SQL Editor-safe postcheck: confirms the replacement policy and helper ACL.
SELECT policyname, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'guild2_observation_events'
ORDER BY policyname;

SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  coalesce(grantee.rolname, 'PUBLIC') AS grantee,
  acl.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
LEFT JOIN pg_roles grantee ON grantee.oid = acl.grantee
WHERE n.nspname = 'public'
  AND p.proname = 'guild2_observation_visible_to_current_student'
ORDER BY grantee, acl.privilege_type;
