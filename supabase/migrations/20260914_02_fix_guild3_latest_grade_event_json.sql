-- Fix Guild3 grade restoration after reload/re-entry.
--
-- Root cause:
-- The previous lateral query used `grade` as the table alias while the table
-- also has a `grade` column. In `to_jsonb(grade)`, PostgreSQL resolved `grade`
-- to the scalar grade column, so teacher_get_guild3_mission_detail returned:
--   latest_grade_event: "S"
-- instead of an event object. The frontend correctly expected:
--   latest_grade_event.grade
-- Therefore grades looked selected immediately from local React state, but
-- disappeared after a fresh RPC load.
--
-- Use an unambiguous row alias (`grade_event`) and also expose explicit
-- current_grade/current_grade_event_id fields for diagnostics and future UI.

create or replace function public.teacher_get_guild3_mission_detail(p_mission_id bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_classroom_id integer;
  v_mission public.guild3_missions%rowtype;
  v_result jsonb;
begin
  perform public.ensure_teacher_role();
  v_classroom_id := public.current_classroom_id();
  select * into v_mission from public.guild3_missions where id = p_mission_id;
  if not found or v_mission.classroom_id is distinct from v_classroom_id then
    raise exception '[G3] mission was not found in this classroom.' using errcode = 'P0316';
  end if;

  select jsonb_build_object(
    'mission', to_jsonb(v_mission),
    'instances', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'instance', to_jsonb(instance),
          'participants', coalesce((
            select jsonb_agg(jsonb_build_object(
              'participant', to_jsonb(participant),
              'latest_activity_record', latest_activity.record,
              'latest_grade_event', latest_grade.event,
              'current_grade', latest_grade.current_grade,
              'current_grade_event_id', latest_grade.current_grade_event_id
            ) order by participant.student_name_at_snapshot, participant.id)
            from public.guild3_mission_participants participant
            left join lateral (
              select to_jsonb(activity) as record
              from public.guild3_mission_activity_records activity
              where activity.mission_id = participant.mission_id
                and activity.student_id = participant.student_id
              order by activity.revision_number desc, activity.id desc
              limit 1
            ) latest_activity on true
            left join lateral (
              select to_jsonb(grade_event) as event,
                     grade_event.grade::text as current_grade,
                     grade_event.id as current_grade_event_id
              from public.guild3_mission_grade_events grade_event
              where grade_event.participant_id = participant.id
              order by grade_event.id desc
              limit 1
            ) latest_grade on true
            where participant.mission_instance_id = instance.id
          ), '[]'::jsonb),
          'submissions', coalesce((
            select jsonb_agg(to_jsonb(submission) order by submission.submission_scope, submission.revision_number desc, submission.id desc)
            from public.guild3_mission_submissions submission
            where submission.mission_instance_id = instance.id
          ), '[]'::jsonb)
        ) order by instance.guild_id
      )
      from public.guild3_mission_instances instance
      where instance.mission_id = v_mission.id
    ), '[]'::jsonb),
    'audit_history', coalesce((
      select jsonb_agg(to_jsonb(audit) order by audit.occurred_at desc, audit.id desc)
      from public.guild3_mission_audit_events audit
      where audit.mission_id = v_mission.id
    ), '[]'::jsonb),
    'guild4_openings', coalesce((
      select jsonb_agg(to_jsonb(opening) order by opening.guild_id, opening.id)
      from public.guild3_peer_review_openings opening
      where opening.mission_id = v_mission.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
