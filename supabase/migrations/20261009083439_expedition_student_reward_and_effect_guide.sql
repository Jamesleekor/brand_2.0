-- B.R.A.N.D 2.0 Fragment Expedition
-- Expose authoritative site reward/world-effect metadata in the student chronicle
-- and a read-only student box reward catalog for UI guidance.
-- Production migration version: 20261009083439

create or replace function public.student_get_expedition_chronicle()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.students%rowtype;
  v_season public.expedition_seasons%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode='42501';
  end if;

  select * into v_student
  from public.students
  where user_id=auth.uid()
    and transferred_at is null
    and role::text='STUDENT';

  if not found then
    raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501';
  end if;

  select * into v_season
  from public.expedition_seasons
  where classroom_id=v_student.classroom_id and status='ACTIVE'
  order by id desc limit 1;

  return jsonb_build_object(
    'student_id',v_student.id,
    'classroom_id',v_student.classroom_id,
    'season',case when v_season.id is null then null else jsonb_build_object(
      'season_id',v_season.id,
      'season_code',v_season.season_code,
      'name',v_season.name_ko
    ) end,
    'active_world_effect',public._expedition_active_world_effect(
      v_student.classroom_id,clock_timestamp()
    ),
    'sites',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'site_code',s.site_code,
          'site_name',s.name_ko,
          'specialty_code',s.specialty_code,
          'core_reward_code',s.core_reward_code,
          'core_reward_label',case s.core_reward_code
            when 'EXPEDITION_BOX' then '원정 상자'
            when 'GOLD' then 'GOLD'
            when 'FRAGMENT' then '편린 조각'
          end,
          'world_effect_code',s.world_effect_code,
          'world_effect_label',case s.world_effect_code
            when 'RESTORE' then '편린 복구 지원'
            when 'SHOP' then '상점 할인'
            when 'SUPPLY' then '골드 보급'
            when 'RECORD' then '고고학자의 발굴 지원'
            when 'COSMETIC' then '상점(명품관) 개방'
          end,
          'cumulative_trace',coalesce(pr.cumulative_trace,0),
          'story_stage',coalesce(pr.highest_story_stage,0),
          'story_stage_label',public._expedition_story_stage_label(coalesce(pr.highest_story_stage,0)),
          'mastery_level',coalesce(ma.mastery_level,0),
          'mastery_label',public._expedition_mastery_label(coalesce(ma.mastery_level,0)),
          'field_record_unlocked',exists(
            select 1
            from public.expedition_runs r
            join public.expedition_week_sites ws on ws.id=r.week_site_id
            where r.student_id=v_student.id and ws.site_id=s.id
          ),
          'discovery_unlocked',(disc.id is not null),
          'discovered_at',disc.discovered_at
        )
        order by s.sort_order,s.site_code
      )
      from public.expedition_sites s
      left join public.expedition_site_progress pr
        on pr.season_id=v_season.id and pr.site_id=s.id
      left join public.expedition_site_mastery ma
        on ma.season_id=v_season.id and ma.site_id=s.id
      left join public.expedition_site_story_content sc
        on sc.site_code_snapshot=s.site_code
      left join public.expedition_student_site_discoveries disc
        on disc.student_id=v_student.id
       and disc.site_id=s.id
       and disc.content_version=sc.content_version
      where s.is_active=true
    ),'[]'::jsonb),
    'recent_runs',coalesce((
      select jsonb_agg(public._expedition_run_result_json(x.id) order by x.submitted_at desc,x.id desc)
      from (
        select r.id,r.submitted_at
        from public.expedition_runs r
        where r.student_id=v_student.id
        order by r.submitted_at desc,r.id desc
        limit 20
      ) x
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.student_get_expedition_chronicle()
  from public, anon;
grant execute on function public.student_get_expedition_chronicle()
  to authenticated, service_role;

create or replace function public.student_get_expedition_box_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.students%rowtype;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.' using errcode='42501';
  end if;

  select * into v_student
  from public.students
  where user_id=auth.uid()
    and transferred_at is null
    and role::text='STUDENT';

  if not found then
    raise exception '학생 계정을 확인할 수 없습니다.' using errcode='42501';
  end if;

  return jsonb_build_object(
    'version','EXPEDITION_BOX_V1',
    'tiers',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'tier',t.box_tier,
          'tier_label',case t.box_tier
            when 'COMMON' then '일반'
            when 'INTERMEDIATE' then '중급'
            when 'RARE' then '희귀'
            else t.box_tier
          end,
          'rewards',(
            select jsonb_agg(
              jsonb_build_object(
                'reward_code',c.reward_code,
                'reward_kind',c.reward_kind,
                'label',c.reward_label_ko,
                'weight_bp',c.weight_bp,
                'probability_percent',c.weight_bp::numeric / 100
              )
              order by c.display_order,c.id
            )
            from public.expedition_box_reward_catalog c
            where c.is_active=true
              and c.box_tier=t.box_tier
          )
        )
        order by case t.box_tier
          when 'COMMON' then 1
          when 'INTERMEDIATE' then 2
          when 'RARE' then 3
          else 9
        end
      )
      from (
        select distinct box_tier
        from public.expedition_box_reward_catalog
        where is_active=true
      ) t
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.student_get_expedition_box_catalog()
  from public, anon;
grant execute on function public.student_get_expedition_box_catalog()
  to authenticated, service_role;
