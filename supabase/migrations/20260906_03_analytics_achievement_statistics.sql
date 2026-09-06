-- B.R.A.N.D 2.0 — Analytics & Records: Achievement statistics
-- 2026-09-06
-- Read-only aggregation over authoritative achievement history.

create or replace function public.teacher_get_statistics_achievements(
  p_classroom_id integer,
  p_include_test boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $function$
declare
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  if p_classroom_id is null or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Permission denied: classroom mismatch' using errcode='P0511';
  end if;

  with students_scope as (
    select s.id as student_id,s.name as student_name,s.brand_name,s.is_test_account,
           (s.transferred_at is null) as is_active
    from public.students s
    where s.classroom_id=p_classroom_id
      and s.role::text in ('STUDENT','STUDENT_LEADER','GUARD','TEST')
      and (p_include_test or not s.is_test_account)
  ),
  catalog as (
    select a.* from public.achievements a where a.classroom_id=p_classroom_id
  ),
  active_catalog as (
    select count(*)::bigint as n from catalog where is_active
  ),
  grants as (
    select sa.*,a.achievement_uid,a.name as achievement_name,a.grade::text as grade,a.is_hidden,a.is_active as achievement_is_active,
           s.student_name,s.brand_name,s.is_test_account
    from public.student_achievements sa
    join catalog a on a.id=sa.achievement_id
    join students_scope s on s.student_id=sa.student_id
    where sa.classroom_id=p_classroom_id
  ),
  valid_current as (
    select * from grants where not is_revoked
  ),
  student_current as (
    select student_id,
      count(distinct achievement_id)::bigint as current_count,
      count(distinct achievement_id) filter(where achievement_is_active)::bigint as current_active_catalog_count,
      min(achieved_at) as first_achievement_at,
      max(achieved_at) as recent_achievement_at,
      count(distinct achievement_id) filter(where grade='초월')::bigint as transcend_count,
      min(achieved_at) filter(where grade='초월') as first_transcend_at,
      max(achieved_at) filter(where grade='초월') as recent_transcend_at,
      count(distinct achievement_id) filter(where grade='유일')::bigint as unique_count,
      count(distinct achievement_id) filter(where is_hidden or grade='히든')::bigint as hidden_count
    from valid_current group by student_id
  ),
  student_ever as (
    select student_id,count(distinct achievement_id)::bigint as lifetime_ever_count,
           min(achieved_at) as first_ever_at,max(achieved_at) as recent_ever_at
    from grants group by student_id
  ),
  achievement_counts as (
    select c.id as achievement_id,
      count(distinct g.student_id)::bigint as total_ever_achievers,
      count(distinct v.student_id)::bigint as current_achievers
    from catalog c
    left join grants g on g.achievement_id=c.id
    left join valid_current v on v.achievement_id=c.id
    group by c.id
  ),
  achievement_first_valid as (
    select distinct on(achievement_id)
      achievement_id,student_id,student_name,brand_name,achieved_at
    from valid_current
    order by achievement_id,achieved_at asc,id asc
  ),
  achievement_latest_valid as (
    select distinct on(achievement_id)
      achievement_id,student_id,student_name,brand_name,achieved_at
    from valid_current
    order by achievement_id,achieved_at desc,id desc
  ),
  achievement_avg as (
    select achievement_id,to_timestamp(avg(extract(epoch from achieved_at))) as average_achieved_at
    from valid_current group by achievement_id
  ),
  season_counts as (
    select v.achievement_id,gs.id as season_id,coalesce(gs.display_name,gs.name) as season_name,
           count(distinct v.student_id)::bigint as achiever_count
    from valid_current v
    join public.guild_seasons gs on gs.classroom_id=p_classroom_id
      and (v.achieved_at at time zone 'Asia/Seoul')::date between coalesce(gs.starts_on,gs.start_date) and coalesce(gs.ends_on,gs.end_date)
    group by v.achievement_id,gs.id,coalesce(gs.display_name,gs.name)
  ),
  transcend_first as (
    select v.student_id,v.student_name,v.brand_name,v.achievement_id,v.achievement_name,v.achieved_at
    from valid_current v where v.grade='초월'
    order by v.achieved_at asc,v.id asc limit 1
  ),
  transcend_by_student as (
    select s.student_id,s.student_name,count(distinct v.achievement_id)::bigint as transcend_count
    from students_scope s left join valid_current v on v.student_id=s.student_id and v.grade='초월'
    group by s.student_id,s.student_name
  ),
  transcend_max as (
    select *,dense_rank() over(order by transcend_count desc) as rank_position
    from transcend_by_student
  ),
  achievement_rows as (
    select c.id as achievement_id,c.achievement_uid,c.name,c.grade::text as grade,c.is_hidden,c.is_active,
      coalesce(ac.total_ever_achievers,0) as total_ever_achievers,
      coalesce(ac.current_achievers,0) as current_achievers,
      case when af.achievement_id is null then null else jsonb_build_object(
        'student_id',af.student_id,'student_name',af.student_name,'brand_name',af.brand_name,'achieved_at',af.achieved_at
      ) end as first_valid_achiever,
      case when al.achievement_id is null then null else jsonb_build_object(
        'student_id',al.student_id,'student_name',al.student_name,'brand_name',al.brand_name,'achieved_at',al.achieved_at
      ) end as latest_valid_achiever,
      aa.average_achieved_at,
      (select coalesce(jsonb_agg(jsonb_build_object('season_id',sc.season_id,'season_name',sc.season_name,'achiever_count',sc.achiever_count) order by sc.season_id),'[]'::jsonb)
       from season_counts sc where sc.achievement_id=c.id) as season_counts
    from catalog c
    left join achievement_counts ac on ac.achievement_id=c.id
    left join achievement_first_valid af on af.achievement_id=c.id
    left join achievement_latest_valid al on al.achievement_id=c.id
    left join achievement_avg aa on aa.achievement_id=c.id
  ),
  student_rows as (
    select s.student_id,s.student_name,s.brand_name,s.is_test_account,s.is_active,
      coalesce(sc.current_count,0)::bigint as current_achievement_count,
      coalesce(se.lifetime_ever_count,0)::bigint as lifetime_ever_achievement_count,
      sc.first_achievement_at,sc.recent_achievement_at,
      case when ac.n>0 then round(coalesce(sc.current_active_catalog_count,0)::numeric*100/ac.n,2) else 0 end as completion_percent,
      coalesce(sc.transcend_count,0)::bigint as transcend_count,
      sc.first_transcend_at,sc.recent_transcend_at,
      coalesce(sc.unique_count,0)::bigint as unique_count,
      coalesce(sc.hidden_count,0)::bigint as hidden_count,
      (select coalesce(jsonb_object_agg(x.grade,x.n),'{}'::jsonb) from (
        select v.grade,count(distinct v.achievement_id)::bigint n
        from valid_current v where v.student_id=s.student_id group by v.grade
      ) x) as grade_counts,
      (select coalesce(jsonb_agg(jsonb_build_object(
        'galaxy_id',g.id,'galaxy_uid',g.galaxy_uid,'galaxy_name',g.name,
        'achieved_count',coalesce(x.achieved_count,0),'catalog_count',x.catalog_count
      ) order by g.display_order,g.id),'[]'::jsonb)
       from public.achievement_galaxies g
       join lateral (
         select count(distinct m.achievement_id)::bigint as catalog_count,
                count(distinct v.achievement_id)::bigint as achieved_count
         from public.achievement_galaxy_memberships m
         join catalog ca on ca.id=m.achievement_id and ca.is_active
         left join valid_current v on v.achievement_id=m.achievement_id and v.student_id=s.student_id
         where m.galaxy_id=g.id
       ) x on true
       where g.classroom_id=p_classroom_id and g.is_active) as category_counts
    from students_scope s
    cross join active_catalog ac
    left join student_current sc on sc.student_id=s.student_id
    left join student_ever se on se.student_id=s.student_id
  )
  select jsonb_build_object(
    'active_catalog_count',(select n from active_catalog),
    'students',(select coalesce(jsonb_agg(to_jsonb(sr) order by sr.student_name,sr.student_id),'[]'::jsonb) from student_rows sr),
    'achievements',(select coalesce(jsonb_agg(to_jsonb(ar) order by ar.is_active desc,ar.grade,ar.name,ar.achievement_id),'[]'::jsonb) from achievement_rows ar),
    'transcendent',jsonb_build_object(
      'first_achiever',(select case when tf.student_id is null then null else jsonb_build_object(
        'student_id',tf.student_id,'student_name',tf.student_name,'brand_name',tf.brand_name,
        'achievement_id',tf.achievement_id,'achievement_name',tf.achievement_name,'achieved_at',tf.achieved_at
      ) end from transcend_first tf),
      'max_owners',(select coalesce(jsonb_agg(jsonb_build_object('student_id',tm.student_id,'student_name',tm.student_name,'count',tm.transcend_count) order by tm.student_name),'[]'::jsonb)
                    from transcend_max tm where tm.rank_position=1 and tm.transcend_count>0),
      'achievements',(select coalesce(jsonb_agg(to_jsonb(ar) order by ar.name),'[]'::jsonb) from achievement_rows ar where ar.grade='초월')
    ),
    'unique_candidates',jsonb_build_object(
      'current_single_holder',(select coalesce(jsonb_agg(to_jsonb(ar) order by ar.name),'[]'::jsonb) from achievement_rows ar where ar.current_achievers=1),
      'lifetime_single_achiever',(select coalesce(jsonb_agg(to_jsonb(ar) order by ar.name),'[]'::jsonb) from achievement_rows ar where ar.total_ever_achievers=1)
    ),
    'data_quality',jsonb_build_object(
      'duplicate_active_grant_pairs',(
        select count(*) from (
          select student_id,achievement_id from valid_current group by student_id,achievement_id having count(*)>1
        ) q
      ),
      'revoked_grant_rows',(select count(*) from grants where is_revoked),
      'catalog_without_galaxy',(select count(*) from catalog c where c.is_active and not exists(select 1 from public.achievement_galaxy_memberships m where m.achievement_id=c.id))
    )
  ) into v_result;

  return coalesce(v_result,'{}'::jsonb);
end;
$function$;

revoke all on function public.teacher_get_statistics_achievements(integer,boolean) from public,anon;
grant execute on function public.teacher_get_statistics_achievements(integer,boolean) to authenticated,service_role;
