-- B.R.A.N.D 2.0
-- Dimensional Gate teacher progress matrix + lightweight student story progress persistence.

create or replace function public.teacher_get_dimensional_gate_progress_board(p_classroom_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_students jsonb;
  v_characters jsonb;
  v_progress jsonb;
begin
  if not public.is_teacher_or_admin() then
    raise exception 'Teacher/admin only' using errcode='42501';
  end if;

  if p_classroom_id is null
     or public.current_classroom_id() is null
     or p_classroom_id <> public.current_classroom_id() then
    raise exception 'Classroom scope mismatch' using errcode='42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'brand_name', s.brand_name,
        'is_test_account', coalesce(s.is_test_account, false)
      )
      order by coalesce(s.is_test_account, false), s.name
    ),
    '[]'::jsonb
  )
  into v_students
  from public.students s
  where s.classroom_id = p_classroom_id
    and s.role::text = 'STUDENT'
    and s.transferred_at is null;

  select coalesce(jsonb_agg(item order by sort_order, character_id), '[]'::jsonb)
  into v_characters
  from (
    select
      c.id as character_id,
      c.sort_order,
      jsonb_build_object(
        'character_id', c.id,
        'character_uid', c.character_uid,
        'name', c.name,
        'epithet', c.epithet,
        'emoji', c.emoji,
        'avatar_image_url', c.avatar_image_url,
        'start_affinity', p.start_affinity,
        'episodes', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'episode_id', e.id,
              'episode_no', e.episode_no,
              'title', e.title,
              'required_affinity', e.required_affinity,
              'cut_count', (
                select count(*) from public.dimensional_gate_story_cuts sc
                where sc.episode_id = e.id
              )
            )
            order by e.sort_order, e.episode_no
          )
          from public.dimensional_gate_story_episodes e
          where e.character_id = c.id
            and e.is_active = true
        ), '[]'::jsonb)
      ) as item
    from public.characters c
    join public.dimensional_gate_character_profiles p
      on p.character_id = c.id
     and p.is_active = true
    where c.is_active = true
      and exists (
        select 1
        from public.dimensional_gate_story_episodes e
        where e.character_id = c.id
          and e.is_active = true
      )
  ) q;

  select coalesce(jsonb_agg(item order by student_name, character_name), '[]'::jsonb)
  into v_progress
  from (
    select
      s.name as student_name,
      c.name as character_name,
      jsonb_build_object(
        'student_id', s.id,
        'character_id', c.id,
        'owned_at', sc.acquired_at,
        'affinity', coalesce(r.affinity, p.start_affinity, 0),
        'relation_stage', public.dimensional_gate_relation_stage(coalesce(r.affinity, p.start_affinity, 0)),
        'status', coalesce(r.status, 'NORMAL'),
        'last_interacted_at', r.last_interacted_at,
        'episodes', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'episode_id', e.id,
              'episode_no', e.episode_no,
              'title', e.title,
              'required_affinity', e.required_affinity,
              'cut_count', (
                select count(*) from public.dimensional_gate_story_cuts cut
                where cut.episode_id = e.id
              ),
              'opened_at', sp.opened_at,
              'completed_at', sp.completed_at,
              'last_cut_order', sp.last_cut_order,
              'updated_at', sp.updated_at
            )
            order by e.sort_order, e.episode_no
          )
          from public.dimensional_gate_story_episodes e
          left join public.dimensional_gate_story_progress sp
            on sp.student_id = s.id
           and sp.episode_id = e.id
          where e.character_id = c.id
            and e.is_active = true
        ), '[]'::jsonb)
      ) as item
    from public.students s
    join public.student_characters sc
      on sc.student_id = s.id
     and sc.is_owned = true
    join public.characters c
      on c.id = sc.character_id
     and c.is_active = true
    join public.dimensional_gate_character_profiles p
      on p.character_id = c.id
     and p.is_active = true
    left join public.dimensional_gate_relationships r
      on r.student_id = s.id
     and r.character_id = c.id
    where s.classroom_id = p_classroom_id
      and s.role::text = 'STUDENT'
      and s.transferred_at is null
      and exists (
        select 1
        from public.dimensional_gate_story_episodes e
        where e.character_id = c.id
          and e.is_active = true
      )
  ) q;

  return jsonb_build_object(
    'students', v_students,
    'characters', v_characters,
    'progress', v_progress
  );
end;
$function$;

revoke all on function public.teacher_get_dimensional_gate_progress_board(integer) from public;
grant execute on function public.teacher_get_dimensional_gate_progress_board(integer) to authenticated;

create or replace function public.student_save_dimensional_gate_story_progress(
  p_episode_id bigint,
  p_last_cut_order integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_student_id integer;
  v_character_id bigint;
  v_required_affinity integer;
  v_start_affinity integer;
  v_affinity integer;
begin
  v_student_id := public.current_student_id();
  if v_student_id is null then
    raise exception 'Student context not found' using errcode='PDG20';
  end if;

  if p_last_cut_order is null or p_last_cut_order < 1 then
    raise exception 'Invalid cut order' using errcode='22023';
  end if;

  select e.character_id, e.required_affinity
  into v_character_id, v_required_affinity
  from public.dimensional_gate_story_episodes e
  where e.id = p_episode_id
    and e.is_active = true;

  if not found then
    raise exception 'Story episode not found' using errcode='PDG40';
  end if;

  if not exists (
    select 1
    from public.student_characters sc
    where sc.student_id = v_student_id
      and sc.character_id = v_character_id
      and sc.is_owned = true
  ) then
    raise exception 'Character not owned' using errcode='PDG22';
  end if;

  select p.start_affinity
  into v_start_affinity
  from public.dimensional_gate_character_profiles p
  where p.character_id = v_character_id
    and p.is_active = true;

  if not found then
    raise exception 'Dimensional Gate content is not enabled' using errcode='PDG23';
  end if;

  select coalesce(r.affinity, v_start_affinity, 0)
  into v_affinity
  from (select 1) seed
  left join public.dimensional_gate_relationships r
    on r.student_id = v_student_id
   and r.character_id = v_character_id;

  if v_affinity < v_required_affinity then
    raise exception 'Story is locked' using errcode='PDG41';
  end if;

  if not exists (
    select 1
    from public.dimensional_gate_story_cuts c
    where c.episode_id = p_episode_id
      and c.cut_order = p_last_cut_order
  ) then
    raise exception 'Story cut not found' using errcode='PDG42';
  end if;

  insert into public.dimensional_gate_story_progress(
    student_id, episode_id, opened_at, last_cut_order, updated_at
  )
  values(
    v_student_id, p_episode_id, now(), p_last_cut_order, now()
  )
  on conflict(student_id, episode_id) do update
  set opened_at = coalesce(public.dimensional_gate_story_progress.opened_at, excluded.opened_at),
      last_cut_order = greatest(
        coalesce(public.dimensional_gate_story_progress.last_cut_order, 0),
        excluded.last_cut_order
      ),
      updated_at = now();
end;
$function$;

revoke all on function public.student_save_dimensional_gate_story_progress(bigint, integer) from public;
grant execute on function public.student_save_dimensional_gate_story_progress(bigint, integer) to authenticated;
