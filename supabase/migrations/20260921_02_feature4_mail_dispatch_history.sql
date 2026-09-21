-- B.R.A.N.D 2.0 Feature4A mail dispatch history v2
-- Production DB already applied on 2026-09-21 through Supabase MCP.

WITH grouped AS (
  SELECT classroom_id, coalesce(sender_user_id::text, 'NO_USER') AS sender_key, title, body,
         date_trunc('second', created_at) AS sent_second,
         'LEGACY_BATCH_' || substr(md5(classroom_id::text || '|' || coalesce(sender_user_id::text, 'NO_USER') || '|' || coalesce(title, '') || '|' || coalesce(body, '') || '|' || date_trunc('second', created_at)::text), 1, 32) AS recovered_dispatch_uid,
         count(*) AS member_count
  FROM public.mail_messages
  WHERE sender_type='TEACHER' AND message_type='TEACHER_MESSAGE'
  GROUP BY classroom_id, sender_user_id, title, body, date_trunc('second', created_at)
)
UPDATE public.mail_messages m
SET dispatch_uid=g.recovered_dispatch_uid
FROM grouped g
WHERE g.member_count > 1
  AND m.classroom_id=g.classroom_id
  AND coalesce(m.sender_user_id::text, 'NO_USER')=g.sender_key
  AND m.title=g.title AND m.body=g.body
  AND date_trunc('second',m.created_at)=g.sent_second
  AND m.sender_type='TEACHER' AND m.message_type='TEACHER_MESSAGE';

CREATE OR REPLACE FUNCTION public.teacher_list_mail_dispatches(p_classroom_id integer, p_limit integer DEFAULT 100)
RETURNS TABLE(dispatch_uid text,title text,body text,message_type public.mail_message_type,created_at timestamptz,recalled_at timestamptz,recipient_count integer,read_count integer,recipients jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4A] teacher classroom denied' USING ERRCODE='P4A20'; END IF;
  IF p_limit < 1 OR p_limit > 500 THEN RAISE EXCEPTION '[F4A] p_limit must be 1-500' USING ERRCODE='P4A30'; END IF;
  RETURN QUERY
  WITH dispatch_base AS (
    SELECT m.dispatch_uid::text AS dispatch_uid,max(m.title)::text AS title,max(m.body)::text AS body,'TEACHER_MESSAGE'::public.mail_message_type AS message_type,
           min(m.created_at) AS created_at,max(m.recalled_at) AS recalled_at,count(*)::integer AS recipient_count,count(*) FILTER(WHERE m.is_read)::integer AS read_count
    FROM public.mail_messages m
    WHERE m.classroom_id=p_classroom_id AND m.sender_type='TEACHER' AND m.message_type='TEACHER_MESSAGE' AND m.dispatch_uid IS NOT NULL
    GROUP BY m.dispatch_uid ORDER BY min(m.created_at) DESC LIMIT p_limit
  )
  SELECT d.dispatch_uid,d.title,d.body,d.message_type,d.created_at,d.recalled_at,d.recipient_count,d.read_count,
    (SELECT jsonb_agg(jsonb_build_object('message_id',m2.id,'student_id',m2.recipient_id,'student_name',s.name,'brand_name',s.brand_name,'is_read',m2.is_read,'read_at',m2.read_at) ORDER BY s.name,m2.recipient_id)
     FROM public.mail_messages m2 LEFT JOIN public.students s ON s.id=m2.recipient_id
     WHERE m2.classroom_id=p_classroom_id AND m2.dispatch_uid=d.dispatch_uid AND m2.sender_type='TEACHER' AND m2.message_type='TEACHER_MESSAGE') AS recipients
  FROM dispatch_base d ORDER BY d.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.teacher_list_mail_dispatches(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_list_mail_dispatches(integer,integer) TO authenticated,service_role;
