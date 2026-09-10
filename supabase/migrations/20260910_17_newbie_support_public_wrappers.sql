-- B.R.A.N.D. 2.0 — Newbie Support public API wrappers
-- Expose only narrow SECURITY INVOKER wrappers from public. Privileged logic remains in private.

GRANT USAGE ON SCHEMA private TO authenticated;

-- Only wrapper targets are executable by authenticated. Internal helpers remain private to postgres/service code.
GRANT EXECUTE ON FUNCTION private.student_get_newbie_support_summary_impl() TO authenticated;
GRANT EXECUTE ON FUNCTION private.student_get_newbie_support_board_impl() TO authenticated;
GRANT EXECUTE ON FUNCTION private.student_get_newbie_support_mentor_board_impl() TO authenticated;
GRANT EXECUTE ON FUNCTION private.student_submit_newbie_support_claim_impl(bigint,bigint,jsonb,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.student_request_newbie_support_completion_impl(bigint,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION private.student_get_current_month_bv_delta_impl() TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_create_newbie_support_program_impl(integer,text,integer,integer,bigint,date,date,integer[],bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_update_newbie_support_program_impl(bigint,integer,bigint,date,date,integer[],bigint[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_preview_newbie_support_activation_impl(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_activate_newbie_support_program_impl(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_review_newbie_support_claim_impl(bigint,text,bigint[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_revoke_newbie_support_claim_impl(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_extend_newbie_support_deadline_impl(bigint,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_finalize_newbie_support_program_impl(bigint,boolean,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_cancel_newbie_support_program_impl(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.teacher_get_newbie_support_board_impl() TO authenticated;

CREATE OR REPLACE FUNCTION public.student_get_newbie_support_summary()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.student_get_newbie_support_summary_impl(); $$;

CREATE OR REPLACE FUNCTION public.student_get_newbie_support_board()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.student_get_newbie_support_board_impl(); $$;

CREATE OR REPLACE FUNCTION public.student_get_newbie_support_mentor_board()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.student_get_newbie_support_mentor_board_impl(); $$;

CREATE OR REPLACE FUNCTION public.student_submit_newbie_support_claim(
  p_program_quest_id bigint,
  p_evidence_ref_id bigint,
  p_mentor_help jsonb DEFAULT '[]'::jsonb,
  p_student_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.student_submit_newbie_support_claim_impl(p_program_quest_id,p_evidence_ref_id,p_mentor_help,p_student_note); $$;

CREATE OR REPLACE FUNCTION public.student_request_newbie_support_completion(
  p_program_id bigint,
  p_best_mentor_student_id integer DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.student_request_newbie_support_completion_impl(p_program_id,p_best_mentor_student_id); $$;

CREATE OR REPLACE FUNCTION public.student_get_current_month_bv_delta()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.student_get_current_month_bv_delta_impl(); $$;

CREATE OR REPLACE FUNCTION public.teacher_create_newbie_support_program(
  p_student_id integer,
  p_template_code text,
  p_template_version integer,
  p_missed_opportunities integer,
  p_bv_per_opportunity bigint,
  p_start_on date,
  p_end_on date,
  p_mentor_student_ids integer[],
  p_public_request_ids bigint[]
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_create_newbie_support_program_impl(p_student_id,p_template_code,p_template_version,p_missed_opportunities,p_bv_per_opportunity,p_start_on,p_end_on,p_mentor_student_ids,p_public_request_ids); $$;

CREATE OR REPLACE FUNCTION public.teacher_update_newbie_support_program(
  p_program_id bigint,
  p_missed_opportunities integer,
  p_bv_per_opportunity bigint,
  p_start_on date,
  p_end_on date,
  p_mentor_student_ids integer[],
  p_public_request_ids bigint[]
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_update_newbie_support_program_impl(p_program_id,p_missed_opportunities,p_bv_per_opportunity,p_start_on,p_end_on,p_mentor_student_ids,p_public_request_ids); $$;

CREATE OR REPLACE FUNCTION public.teacher_preview_newbie_support_activation(p_program_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_preview_newbie_support_activation_impl(p_program_id) || jsonb_build_object('program_id',p_program_id); $$;

CREATE OR REPLACE FUNCTION public.teacher_activate_newbie_support_program(p_program_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_activate_newbie_support_program_impl(p_program_id); $$;

CREATE OR REPLACE FUNCTION public.teacher_review_newbie_support_claim(
  p_claim_id bigint,
  p_decision text,
  p_valid_mentor_assignment_ids bigint[] DEFAULT '{}'::bigint[],
  p_review_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_review_newbie_support_claim_impl(p_claim_id,p_decision,p_valid_mentor_assignment_ids,p_review_note); $$;

CREATE OR REPLACE FUNCTION public.teacher_revoke_newbie_support_claim(p_claim_id bigint,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_revoke_newbie_support_claim_impl(p_claim_id,p_reason); $$;

CREATE OR REPLACE FUNCTION public.teacher_extend_newbie_support_deadline(p_program_id bigint,p_new_end_on date,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_extend_newbie_support_deadline_impl(p_program_id,p_new_end_on,p_reason); $$;

CREATE OR REPLACE FUNCTION public.teacher_finalize_newbie_support_program(
  p_program_id bigint,
  p_skip_best_mentor boolean DEFAULT false,
  p_override_reason text DEFAULT NULL
) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_finalize_newbie_support_program_impl(p_program_id,p_skip_best_mentor,p_override_reason); $$;

CREATE OR REPLACE FUNCTION public.teacher_cancel_newbie_support_program(p_program_id bigint,p_reason text)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_cancel_newbie_support_program_impl(p_program_id,p_reason); $$;

CREATE OR REPLACE FUNCTION public.teacher_get_newbie_support_board()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_get_newbie_support_board_impl(); $$;

DO $grant$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.proname IN (
        'student_get_newbie_support_summary','student_get_newbie_support_board','student_get_newbie_support_mentor_board',
        'student_submit_newbie_support_claim','student_request_newbie_support_completion','student_get_current_month_bv_delta',
        'teacher_create_newbie_support_program','teacher_update_newbie_support_program','teacher_preview_newbie_support_activation',
        'teacher_activate_newbie_support_program','teacher_review_newbie_support_claim','teacher_revoke_newbie_support_claim',
        'teacher_extend_newbie_support_deadline','teacher_finalize_newbie_support_program','teacher_cancel_newbie_support_program',
        'teacher_get_newbie_support_board'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',r.sig);
  END LOOP;
END
$grant$;
