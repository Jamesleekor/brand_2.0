-- B.R.A.N.D 2.0 Fragment Expedition
-- Return the full active expedition character catalog to the fragment wallet.
-- Non-restorable and already-owned characters remain visible for complete 80-character browsing.

create or replace function public.student_get_expedition_fragment_wallet()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_student public.students%rowtype;
  v_balance integer := 0;
  v_discount integer := 0;
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

  select balance into v_balance
  from public.expedition_fragment_balances
  where student_id=v_student.id;
  v_balance := coalesce(v_balance,0);

  v_discount := public._expedition_current_restore_discount_percent(
    v_student.classroom_id,clock_timestamp()
  );

  return jsonb_build_object(
    'student_id',v_student.id,
    'classroom_id',v_student.classroom_id,
    'balance',v_balance,
    'restore_discount_percent',v_discount,
    'restorable_characters',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'character_id',c.id,
          'character_uid',c.character_uid,
          'name',c.name,
          'base_cost',xp.fragment_restore_cost,
          'effective_cost',case
            when xp.fragment_restore_cost is null then null
            else public._expedition_effective_restore_cost(xp.fragment_restore_cost,v_discount)
          end,
          'restore_eligible',xp.fragment_restore_cost is not null,
          'is_owned',coalesce(sc.is_owned,false)
        )
        order by c.sort_order,c.character_uid
      )
      from public.character_expedition_profiles xp
      join public.characters c
        on c.id=xp.character_id
       and c.is_active=true
      left join public.student_characters sc
        on sc.student_id=v_student.id
       and sc.character_id=c.id
      where xp.profile_status='ACTIVE'
    ),'[]'::jsonb)
  );
end;
$$;
