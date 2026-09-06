-- ============================================================================
-- B.R.A.N.D 2.0 — Analytics & Records
-- 2026-09-06
-- Persist Record Room candidate integrity checks in the teacher validation RPC.
--
-- Production already received this function hardening during analytics rollout;
-- this migration keeps GitHub main reproducible from migrations alone.
-- ============================================================================

create or replace function public.teacher_get_data_validation_report(
  p_classroom_id integer,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_raw jsonb;
  v_extra jsonb := '[]'::jsonb;
  v_error_types integer := 0;
  v_test_candidates integer := 0;
  v_approved_without_entry integer := 0;
  v_unapproved_with_entry integer := 0;
  v_missing_source integer := 0;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  v_raw := public._analytics_data_validation_report_raw_v2(p_classroom_id,p_include_test);

  select count(*)::integer into v_test_candidates
  from public.records_candidates c
  join public.students s on s.id=c.student_id
  where c.classroom_id=p_classroom_id and coalesce(s.is_test_account,false);

  select count(*)::integer into v_approved_without_entry
  from public.records_candidates c
  where c.classroom_id=p_classroom_id and c.status='APPROVED' and c.published_entry_id is null;

  select count(*)::integer into v_unapproved_with_entry
  from public.records_candidates c
  where c.classroom_id=p_classroom_id and c.status<>'APPROVED' and c.published_entry_id is not null;

  select count(*)::integer into v_missing_source
  from public.records_candidates c
  where c.classroom_id=p_classroom_id
    and (coalesce(btrim(c.source_type),'')='' or coalesce(btrim(c.source_id),'')='');

  if v_test_candidates>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object(
      'severity','ERROR',
      'code','RECORD_CANDIDATE_TEST_ACCOUNT',
      'count',v_test_candidates,
      'message','A TEST account appears in the Record Room candidate queue.'
    ));
    v_error_types:=v_error_types+1;
  end if;

  if v_approved_without_entry>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object(
      'severity','ERROR',
      'code','RECORD_CANDIDATE_APPROVED_WITHOUT_ENTRY',
      'count',v_approved_without_entry,
      'message','An approved Record Room candidate has no published historical entry.'
    ));
    v_error_types:=v_error_types+1;
  end if;

  if v_unapproved_with_entry>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object(
      'severity','ERROR',
      'code','RECORD_CANDIDATE_UNAPPROVED_WITH_ENTRY',
      'count',v_unapproved_with_entry,
      'message','A non-approved Record Room candidate points to a published historical entry.'
    ));
    v_error_types:=v_error_types+1;
  end if;

  if v_missing_source>0 then
    v_extra := v_extra || jsonb_build_array(jsonb_build_object(
      'severity','ERROR',
      'code','RECORD_CANDIDATE_MISSING_SOURCE',
      'count',v_missing_source,
      'message','A Record Room candidate is missing source provenance.'
    ));
    v_error_types:=v_error_types+1;
  end if;

  v_raw := jsonb_set(v_raw,'{issues}',coalesce(v_raw->'issues','[]'::jsonb)||v_extra,true);
  v_raw := jsonb_set(v_raw,'{sections,record_candidates}',jsonb_build_object(
    'total_count',(select count(*) from public.records_candidates c where c.classroom_id=p_classroom_id),
    'test_account_count',v_test_candidates,
    'approved_without_entry_count',v_approved_without_entry,
    'unapproved_with_entry_count',v_unapproved_with_entry,
    'missing_source_count',v_missing_source
  ),true);
  v_raw := jsonb_set(
    v_raw,
    '{summary,error_issue_types}',
    to_jsonb(coalesce((v_raw->'summary'->>'error_issue_types')::integer,0)+v_error_types),
    true
  );

  if v_error_types>0 then
    v_raw:=jsonb_set(v_raw,'{summary,status}',to_jsonb('ERROR'::text),true);
  end if;

  return v_raw;
end;
$function$;

revoke all on function public.teacher_get_data_validation_report(integer,boolean) from public, anon;
grant execute on function public.teacher_get_data_validation_report(integer,boolean) to authenticated, service_role;
