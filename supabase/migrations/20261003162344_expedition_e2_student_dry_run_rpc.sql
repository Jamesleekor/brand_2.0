create or replace function public._expedition_run_result_json(p_run_id bigint)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $function$
  select case when r.id is null then null else jsonb_build_object(
    'run_id',r.id,'classroom_id',r.classroom_id,'student_id',r.student_id,'week_id',r.week_id,'week_site_id',r.week_site_id,
    'phase',r.phase,'fit_formula_version',r.fit_formula_version,'fit_percent',r.fit_percent,'fit_grade',r.fit_grade,
    'fit_grade_ko',case r.fit_grade when 'VULNERABLE' then '취약' when 'NORMAL' then '보통' when 'STABLE' then '안정' when 'STRONG' then '강인' end,
    'trace_contribution',r.trace_contribution,'counts_for_world',r.counts_for_world,'submitted_at',r.submitted_at,
    'site',jsonb_build_object('site_name',ws.site_name_snapshot,'specialty_code',ws.specialty_code_snapshot,'environment_label',ws.environment_label_snapshot),
    'members',coalesce((select jsonb_agg(jsonb_build_object('slot',m.slot,'character_id',m.character_id,'character_uid',m.character_uid_snapshot,'character_name',m.character_name_snapshot,'element_budget',m.element_budget_snapshot,'primary_element',m.primary_element_snapshot,'primary_points',m.primary_points_snapshot,'secondary_element',m.secondary_element_snapshot,'secondary_points',m.secondary_points_snapshot,'specialty_code',m.specialty_code_snapshot,'specialty_matched',m.specialty_matched,'major_points',m.major_points_contribution,'minor_points',m.minor_points_contribution) order by m.slot) from public.expedition_run_members m where m.run_id=r.id),'[]'::jsonb)
  ) end
  from public.expedition_runs r join public.expedition_week_sites ws on ws.id=r.week_site_id where r.id=p_run_id;
$function$;
revoke all on function public._expedition_run_result_json(bigint) from public,anon,authenticated;
grant execute on function public._expedition_run_result_json(bigint) to service_role;

create or replace function public._expedition_assert_student_party(p_student_id integer,p_classroom_id integer,p_week_id bigint,p_phase text,p_character_ids bigint[])
returns void language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare v_owned integer;
begin
  if coalesce(array_length(p_character_ids,1),0)<>3 or (select count(distinct x) from unnest(p_character_ids)x)<>3 or exists(select 1 from unnest(p_character_ids)x where x is null) then raise exception 'EXPEDITION_PARTY_MUST_HAVE_3_DISTINCT_CHARACTERS' using errcode='P0E31'; end if;
  select count(distinct sc.character_id) into v_owned from public.student_characters sc where sc.student_id=p_student_id and sc.classroom_id=p_classroom_id and sc.is_owned=true and sc.revoked_at is null and sc.character_id=any(p_character_ids);
  if v_owned<>3 then raise exception 'EXPEDITION_PARTY_CONTAINS_UNOWNED_CHARACTER' using errcode='P0E40'; end if;
  if (select count(*) from public.expedition_week_character_profiles wp where wp.week_id=p_week_id and wp.character_id=any(p_character_ids))<>3 then raise exception 'EXPEDITION_PARTY_PROFILE_SNAPSHOT_MISSING' using errcode='P0E41'; end if;
  if p_phase='SUN' and exists(select 1 from public.expedition_runs r join public.expedition_run_members m on m.run_id=r.id where r.student_id=p_student_id and r.week_id=p_week_id and r.phase='SAT' and m.character_id=any(p_character_ids)) then raise exception 'EXPEDITION_SUNDAY_CHARACTER_NEEDS_RECOVERY' using errcode='P0E42',detail='Saturday expedition members cannot be used again on Sunday.'; end if;
end;
$function$;
revoke all on function public._expedition_assert_student_party(integer,integer,bigint,text,bigint[]) from public,anon,authenticated;
grant execute on function public._expedition_assert_student_party(integer,integer,bigint,text,bigint[]) to service_role;

create or replace function public.student_get_expedition_board()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare
  v_student public.students%rowtype; v_settings public.expedition_settings%rowtype; v_week public.expedition_weeks%rowtype;
  v_now timestamptz:=clock_timestamp(); v_phase text; v_sat_run_id bigint; v_sun_run_id bigint; v_sites jsonb; v_characters jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  select * into v_student from public.students where user_id=auth.uid() and transferred_at is null and role::text='STUDENT'; if not found then raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501'; end if;
  select * into v_settings from public.expedition_settings where classroom_id=v_student.classroom_id;
  if not found then return jsonb_build_object('enabled',false,'reason','NOT_CONFIGURED','server_now',v_now); end if;
  if not v_settings.is_core_enabled or not v_settings.is_student_ui_enabled then return jsonb_build_object('enabled',false,'reason','FEATURE_DISABLED','server_now',v_now,'core_enabled',v_settings.is_core_enabled,'student_ui_enabled',v_settings.is_student_ui_enabled); end if;
  select * into v_week from public.expedition_weeks where classroom_id=v_student.classroom_id and status='PUBLISHED' and v_now>=publish_at and v_now<settle_at order by week_start_date desc,id desc limit 1;
  if not found then return jsonb_build_object('enabled',true,'server_now',v_now,'week',null,'message','이번 주 공개된 원정이 없습니다.'); end if;
  v_phase:=public._expedition_current_phase(v_week.id,v_now);
  select id into v_sat_run_id from public.expedition_runs where student_id=v_student.id and week_id=v_week.id and phase='SAT';
  select id into v_sun_run_id from public.expedition_runs where student_id=v_student.id and week_id=v_week.id and phase='SUN';
  select coalesce(jsonb_agg(site_obj order by slot),'[]') into v_sites from (
    select ws.slot,jsonb_build_object('week_site_id',ws.id,'slot',ws.slot,'site_code',ws.site_code_snapshot,'site_name',ws.site_name_snapshot,'specialty_code',ws.specialty_code_snapshot,'specialty_label',sp.label_ko,'core_reward_code',ws.core_reward_code_snapshot,'core_reward_label',case ws.core_reward_code_snapshot when 'EXPEDITION_BOX' then '원정 상자' when 'GOLD' then 'GOLD' when 'FRAGMENT' then '편린 조각' end,'world_effect_code',ws.world_effect_code_snapshot,'world_effect_label',case ws.world_effect_code_snapshot when 'RESTORE' then '편린 복구 지원' when 'SHOP' then '상점 할인' when 'SUPPLY' then '골드 보급' when 'RECORD' then '고고학자의 발굴 지원' when 'COSMETIC' then '상점(명품관) 개방' end,'environment_label',ws.environment_label_snapshot,'major_element',case when v_phase='SUN' then ws.sunday_major_element else ws.saturday_major_element end,'minor_element',case when v_phase='SUN' then ws.sunday_minor_element else ws.saturday_minor_element end,'sunday_environment_changed',ws.sunday_event_applied,'weekly_trace',coalesce((select sum(r.trace_contribution) from public.expedition_runs r where r.week_id=v_week.id and r.week_site_id=ws.id and r.counts_for_world=true),0),'weekly_participants',coalesce((select count(distinct r.student_id) from public.expedition_runs r where r.week_id=v_week.id and r.week_site_id=ws.id and r.counts_for_world=true),0),'saturday_trace',coalesce((select sum(r.trace_contribution) from public.expedition_runs r where r.week_id=v_week.id and r.week_site_id=ws.id and r.phase='SAT' and r.counts_for_world=true),0),'saturday_participants',coalesce((select count(distinct r.student_id) from public.expedition_runs r where r.week_id=v_week.id and r.week_site_id=ws.id and r.phase='SAT' and r.counts_for_world=true),0)) site_obj
    from public.expedition_week_sites ws join public.expedition_specialties sp on sp.specialty_code=ws.specialty_code_snapshot where ws.week_id=v_week.id
  )q;
  select coalesce(jsonb_agg(char_obj order by sort_order,character_uid),'[]') into v_characters from (
    select c.sort_order,c.character_uid,jsonb_build_object('character_id',c.id,'character_uid',wp.character_uid_snapshot,'name',wp.character_name_snapshot,'epithet',c.epithet,'resource_kind',c.resource_kind,'resource_url',c.resource_url,'card_image_url',c.card_image_url,'avatar_image_url',c.avatar_image_url,'emoji',c.emoji,'element_budget',wp.element_budget,'primary_element',wp.primary_element,'primary_points',wp.primary_points,'secondary_element',wp.secondary_element,'secondary_points',wp.secondary_points,'specialty_code',wp.specialty_code,'recovery_required',(v_phase='SUN' and exists(select 1 from public.expedition_runs sr join public.expedition_run_members sm on sm.run_id=sr.id where sr.student_id=v_student.id and sr.week_id=v_week.id and sr.phase='SAT' and sm.character_id=c.id))) char_obj
    from public.student_characters sc join public.characters c on c.id=sc.character_id join public.expedition_week_character_profiles wp on wp.week_id=v_week.id and wp.character_id=c.id where sc.student_id=v_student.id and sc.classroom_id=v_student.classroom_id and sc.is_owned=true and sc.revoked_at is null and c.is_active=true
  )q;
  return jsonb_build_object('enabled',true,'server_now',v_now,'student',jsonb_build_object('student_id',v_student.id,'classroom_id',v_student.classroom_id,'is_test_account',v_student.is_test_account),'week',jsonb_build_object('week_id',v_week.id,'week_index',v_week.week_index,'week_start_date',v_week.week_start_date,'status',v_week.status,'reward_mode',v_week.reward_mode,'phase',v_phase,'publish_at',v_week.publish_at,'sat_open_at',v_week.sat_open_at,'sun_open_at',v_week.sun_open_at,'sun_close_at',v_week.sun_close_at,'settle_at',v_week.settle_at,'fit_formula_version',v_week.fit_formula_version),'sites',v_sites,'characters',v_characters,'my_sat_run',public._expedition_run_result_json(v_sat_run_id),'my_sun_run',public._expedition_run_result_json(v_sun_run_id),'can_submit_sat',(v_phase='SAT' and v_sat_run_id is null),'can_submit_sun',(v_phase='SUN' and v_sun_run_id is null));
end;
$function$;
revoke all on function public.student_get_expedition_board() from public,anon;
grant execute on function public.student_get_expedition_board() to authenticated,service_role;

create or replace function public.student_preview_expedition(p_week_site_id bigint,p_character_ids bigint[])
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $function$
declare v_student public.students%rowtype; v_settings public.expedition_settings%rowtype; v_week public.expedition_weeks%rowtype; v_ws public.expedition_week_sites%rowtype; v_phase text; v_now timestamptz:=clock_timestamp(); v_fit jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if;
  select * into v_student from public.students where user_id=auth.uid() and transferred_at is null and role::text='STUDENT'; if not found then raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501'; end if;
  select * into v_ws from public.expedition_week_sites where id=p_week_site_id; if not found then raise exception 'EXPEDITION_WEEK_SITE_NOT_FOUND' using errcode='P0E32'; end if;
  select * into v_week from public.expedition_weeks where id=v_ws.week_id; if not found or v_week.classroom_id<>v_student.classroom_id or v_week.status<>'PUBLISHED' then raise exception 'EXPEDITION_WEEK_ACCESS_DENIED' using errcode='42501'; end if;
  select * into v_settings from public.expedition_settings where classroom_id=v_student.classroom_id; if not found or not v_settings.is_core_enabled or not v_settings.is_student_ui_enabled then raise exception 'EXPEDITION_FEATURE_DISABLED' using errcode='P0E43'; end if;
  v_phase:=public._expedition_current_phase(v_week.id,v_now); if v_phase not in ('SAT','SUN') then raise exception 'EXPEDITION_SUBMISSION_WINDOW_CLOSED phase=%',v_phase using errcode='P0E44'; end if;
  perform public._expedition_assert_student_party(v_student.id,v_student.classroom_id,v_week.id,v_phase,p_character_ids); v_fit:=public._expedition_compute_fit_v1(p_week_site_id,v_phase,p_character_ids);
  return v_fit||jsonb_build_object('server_now',v_now,'can_submit',not exists(select 1 from public.expedition_runs where student_id=v_student.id and week_id=v_week.id and phase=v_phase));
end;
$function$;
revoke all on function public.student_preview_expedition(bigint,bigint[]) from public,anon;
grant execute on function public.student_preview_expedition(bigint,bigint[]) to authenticated,service_role;

create or replace function public.student_submit_expedition(p_week_site_id bigint,p_character_ids bigint[],p_client_request_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $function$
declare v_student public.students%rowtype; v_settings public.expedition_settings%rowtype; v_week public.expedition_weeks%rowtype; v_ws public.expedition_week_sites%rowtype; v_phase text; v_now timestamptz:=clock_timestamp(); v_fit jsonb; v_existing_run_id bigint; v_run_id bigint; v_slot integer; v_member jsonb;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다.' using errcode='42501'; end if; if p_client_request_id is null then raise exception 'EXPEDITION_CLIENT_REQUEST_ID_REQUIRED' using errcode='P0E45'; end if;
  select * into v_student from public.students where user_id=auth.uid() and transferred_at is null and role::text='STUDENT'; if not found then raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501'; end if;
  select * into v_ws from public.expedition_week_sites where id=p_week_site_id; if not found then raise exception 'EXPEDITION_WEEK_SITE_NOT_FOUND' using errcode='P0E32'; end if;
  select * into v_week from public.expedition_weeks where id=v_ws.week_id; if not found or v_week.classroom_id<>v_student.classroom_id or v_week.status<>'PUBLISHED' then raise exception 'EXPEDITION_WEEK_ACCESS_DENIED' using errcode='42501'; end if;
  select * into v_settings from public.expedition_settings where classroom_id=v_student.classroom_id; if not found or not v_settings.is_core_enabled or not v_settings.is_student_ui_enabled then raise exception 'EXPEDITION_FEATURE_DISABLED' using errcode='P0E43'; end if;
  v_phase:=public._expedition_current_phase(v_week.id,v_now); if v_phase not in ('SAT','SUN') then raise exception 'EXPEDITION_SUBMISSION_WINDOW_CLOSED phase=%',v_phase using errcode='P0E44'; end if;
  perform pg_advisory_xact_lock(hashtextextended('EXPEDITION|'||v_week.id||'|'||v_student.id,0));
  select id into v_existing_run_id from public.expedition_runs where student_id=v_student.id and client_request_id=p_client_request_id; if found then return jsonb_build_object('success',true,'idempotent_replay',true,'already_submitted',true,'run',public._expedition_run_result_json(v_existing_run_id)); end if;
  select id into v_existing_run_id from public.expedition_runs where student_id=v_student.id and week_id=v_week.id and phase=v_phase; if found then return jsonb_build_object('success',true,'idempotent_replay',false,'already_submitted',true,'run',public._expedition_run_result_json(v_existing_run_id)); end if;
  perform public._expedition_assert_student_party(v_student.id,v_student.classroom_id,v_week.id,v_phase,p_character_ids); v_fit:=public._expedition_compute_fit_v1(p_week_site_id,v_phase,p_character_ids);
  insert into public.expedition_runs(classroom_id,student_id,week_id,week_site_id,phase,fit_formula_version,fit_percent,fit_grade,trace_contribution,counts_for_world,client_request_id,submitted_at) values(v_student.classroom_id,v_student.id,v_week.id,v_ws.id,v_phase,'ELEM_70_30_V1',(v_fit->>'fit_percent')::smallint,v_fit->>'fit_grade',(v_fit->>'trace_contribution')::smallint,not v_student.is_test_account,p_client_request_id,v_now) returning id into v_run_id;
  for v_member in select value from jsonb_array_elements(v_fit->'members') loop v_slot:=(v_member->>'slot')::integer; insert into public.expedition_run_members(run_id,slot,character_id,character_uid_snapshot,character_name_snapshot,element_budget_snapshot,primary_element_snapshot,primary_points_snapshot,secondary_element_snapshot,secondary_points_snapshot,specialty_code_snapshot,specialty_matched,major_points_contribution,minor_points_contribution) values(v_run_id,v_slot,(v_member->>'character_id')::bigint,v_member->>'character_uid',v_member->>'character_name',(v_member->>'element_budget')::smallint,v_member->>'primary_element',(v_member->>'primary_points')::smallint,nullif(v_member->>'secondary_element',''),(v_member->>'secondary_points')::smallint,v_member->>'specialty_code',(v_member->>'specialty_matched')::boolean,(v_member->>'major_points')::smallint,(v_member->>'minor_points')::smallint); end loop;
  return jsonb_build_object('success',true,'idempotent_replay',false,'already_submitted',false,'run',public._expedition_run_result_json(v_run_id),'weekly_site_trace',(select coalesce(sum(r.trace_contribution),0) from public.expedition_runs r where r.week_id=v_week.id and r.week_site_id=v_ws.id and r.counts_for_world=true));
end;
$function$;
revoke all on function public.student_submit_expedition(bigint,bigint[],uuid) from public,anon;
grant execute on function public.student_submit_expedition(bigint,bigint[],uuid) to authenticated,service_role;
