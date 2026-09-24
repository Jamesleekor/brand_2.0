-- B.R.A.N.D 2.0
-- Home dashboard credit summary RPC
-- Keeps the dashboard credit card on the same v2 scoring engine as the profile detail view,
-- without loading the heavier history/detail payload.

create or replace function public.student_get_my_credit_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_current jsonb;
begin
  v_student_id := public.current_student_id();

  if auth.uid() is null or v_student_id is null then
    raise exception '학생 로그인이 필요합니다.' using errcode = 'PCS10';
  end if;

  v_current := public._credit_score_v2_compute(v_student_id, v_today);

  if v_current is null then
    raise exception '신용점수를 계산할 학생 정보를 찾을 수 없습니다.' using errcode = 'PCS11';
  end if;

  return jsonb_build_object(
    'student_id', v_student_id,
    'as_of_date', v_current->>'as_of_date',
    'grade', v_current->>'grade',
    'total_score', (v_current->>'total_score')::integer
  );
end;
$function$;

revoke execute on function public.student_get_my_credit_summary() from public, anon;
grant execute on function public.student_get_my_credit_summary() to authenticated;
