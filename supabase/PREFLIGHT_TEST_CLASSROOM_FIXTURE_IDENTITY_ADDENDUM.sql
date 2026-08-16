-- =============================================================================
-- B.R.A.N.D 2.0 TEST classroom fixture — identity addendum (read-only)
--
-- Purpose
--   Confirm, without exposing any student identity, whether the current
--   auth-linked student records include TEACHER or ADMIN roles.  This matters
--   because current_classroom_id() checks a student row before its teacher
--   classroom fallback.
--
-- Safety
--   Read-only aggregate query only.  It creates, changes, or calls nothing.
--   No student names, IDs, e-mail addresses, or auth UUIDs are returned.
-- =============================================================================

WITH student_role_counts AS (
  SELECT
    CASE
      WHEN student_row.role IS NULL THEN '(NULL)'
      ELSE student_row.role::text
    END AS role_name,
    CASE
      WHEN student_row.transferred_at IS NULL THEN 'CURRENT'
      ELSE 'TRANSFERRED'
    END AS student_status,
    count(*)::bigint AS student_count,
    count(*) FILTER (WHERE student_row.user_id IS NOT NULL)::bigint AS auth_linked_student_count
  FROM public.students AS student_row
  GROUP BY
    CASE
      WHEN student_row.role IS NULL THEN '(NULL)'
      ELSE student_row.role::text
    END,
    CASE
      WHEN student_row.transferred_at IS NULL THEN 'CURRENT'
      ELSE 'TRANSFERRED'
    END
), auth_linked_role_totals AS (
  SELECT
    role_name,
    sum(auth_linked_student_count)::bigint AS auth_linked_student_count
  FROM student_role_counts
  GROUP BY role_name
)
SELECT jsonb_build_object(
  'purpose', 'Aggregate role check only — no personal student or auth data is included.',
  'auth_linked_student_role_counts', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'role', role_name,
          'auth_linked_student_count', auth_linked_student_count
        )
        ORDER BY role_name
      )
      FROM auth_linked_role_totals
    ),
    '[]'::jsonb
  ),
  'all_student_role_counts_by_status', coalesce(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'role', role_name,
          'student_status', student_status,
          'student_count', student_count,
          'auth_linked_student_count', auth_linked_student_count
        )
        ORDER BY role_name, student_status
      )
      FROM student_role_counts
    ),
    '[]'::jsonb
  ),
  'auth_linked_teacher_or_admin_student_record_count', (
    SELECT coalesce(sum(auth_linked_student_count), 0)::bigint
    FROM auth_linked_role_totals
    WHERE role_name IN ('TEACHER', 'ADMIN')
  ),
  'has_auth_linked_teacher_or_admin_student_record', (
    SELECT coalesce(sum(auth_linked_student_count), 0) > 0
    FROM auth_linked_role_totals
    WHERE role_name IN ('TEACHER', 'ADMIN')
  )
) AS fixture_identity_role_report;
