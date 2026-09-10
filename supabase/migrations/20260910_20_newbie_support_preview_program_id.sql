-- B.R.A.N.D. 2.0 — activation preview contract fix
-- Frontend activation must receive the draft program id with the server preview.
CREATE OR REPLACE FUNCTION public.teacher_preview_newbie_support_activation(p_program_id bigint)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=''
AS $$ SELECT private.teacher_preview_newbie_support_activation_impl(p_program_id) || jsonb_build_object('program_id',p_program_id); $$;
REVOKE ALL ON FUNCTION public.teacher_preview_newbie_support_activation(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_preview_newbie_support_activation(bigint) TO authenticated,service_role;
