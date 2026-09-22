-- =====================================================================
-- B.R.A.N.D 2.0 — F4A mail sender identity
-- 2026-09-22
-- Adds in-world sender names for teacher mail without breaking legacy RPCs.
-- =====================================================================
BEGIN;

ALTER TABLE public.mail_messages
  ADD COLUMN IF NOT EXISTS sender_name varchar(60);

-- Existing teacher mail should no longer surface as TEACHER/선생님 in-world.
UPDATE public.mail_messages
SET sender_name = 'B.R.A.N.D 운영국'
WHERE sender_type = 'TEACHER'
  AND coalesce(btrim(sender_name), '') = '';

CREATE OR REPLACE FUNCTION public.normalize_mail_sender_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.sender_type = 'TEACHER'
     AND coalesce(btrim(NEW.sender_name), '') = '' THEN
    NEW.sender_name := 'B.R.A.N.D 운영국';
  ELSIF NEW.sender_name IS NOT NULL THEN
    NEW.sender_name := btrim(NEW.sender_name);
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.mail_messages'::regclass
      AND tgname = 'trg_mail_sender_name_default'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_mail_sender_name_default
    BEFORE INSERT OR UPDATE OF sender_type, sender_name
    ON public.mail_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.normalize_mail_sender_name();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_send_mail_with_sender(
  p_classroom_id integer,
  p_recipient_ids integer[],
  p_sender_name text,
  p_title text,
  p_body text,
  p_message_type public.mail_message_type DEFAULT 'TEACHER_MESSAGE'::public.mail_message_type
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id integer;
  v_count integer := 0;
  v_sender_name text;
  v_title text;
  v_body text;
  v_dispatch_uid varchar(96);
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[F4A] teacher classroom denied' USING ERRCODE='P4A20';
  END IF;
  IF p_recipient_ids IS NULL OR cardinality(p_recipient_ids)=0 OR cardinality(p_recipient_ids)>100 THEN
    RAISE EXCEPTION '[F4A] select 1-100 recipients' USING ERRCODE='P4A21';
  END IF;
  IF cardinality(p_recipient_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_recipient_ids) AS x) THEN
    RAISE EXCEPTION '[F4A] duplicate recipients are not allowed' USING ERRCODE='P4A27';
  END IF;

  v_sender_name := btrim(coalesce(p_sender_name, ''));
  v_title := btrim(coalesce(p_title, ''));
  v_body := btrim(coalesce(p_body, ''));

  IF char_length(v_sender_name)<1 OR char_length(v_sender_name)>60 THEN
    RAISE EXCEPTION '[F4A] sender name must be 1-60 chars' USING ERRCODE='P4A31';
  END IF;
  IF char_length(v_title)<1 OR char_length(v_title)>200 THEN
    RAISE EXCEPTION '[F4A] title must be 1-200 chars' USING ERRCODE='P4A22';
  END IF;
  IF char_length(v_body)<1 OR char_length(v_body)>5000 THEN
    RAISE EXCEPTION '[F4A] body must be 1-5000 chars' USING ERRCODE='P4A23';
  END IF;

  v_dispatch_uid := 'F4DISP_' || extract(epoch from clock_timestamp())::bigint || '_' || substr(md5(random()::text),1,10);

  FOREACH v_id IN ARRAY p_recipient_ids LOOP
    IF NOT EXISTS(
      SELECT 1 FROM public.students
      WHERE id=v_id
        AND classroom_id=p_classroom_id
        AND transferred_at IS NULL
        AND role IN ('STUDENT','STUDENT_LEADER','GUARD')
    ) THEN
      RAISE EXCEPTION '[F4A] invalid recipient student_id=%',v_id USING ERRCODE='P4A24';
    END IF;

    INSERT INTO public.mail_messages(
      message_uid,dispatch_uid,classroom_id,recipient_id,sender_type,sender_user_id,
      sender_name,title,body,message_type
    ) VALUES (
      'F4MAIL_'||extract(epoch from clock_timestamp())::bigint||'_'||v_id||'_'||substr(md5(random()::text),1,5),
      v_dispatch_uid,p_classroom_id,v_id,'TEACHER',auth.uid(),
      v_sender_name,v_title,v_body,p_message_type
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_list_mail_dispatches_v2(
  p_classroom_id integer,
  p_limit integer DEFAULT 100
)
RETURNS TABLE(
  dispatch_uid text,
  sender_name text,
  title text,
  body text,
  message_type public.mail_message_type,
  created_at timestamptz,
  recalled_at timestamptz,
  recipient_count integer,
  read_count integer,
  recipients jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[F4A] teacher classroom denied' USING ERRCODE='P4A20';
  END IF;
  IF p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION '[F4A] p_limit must be 1-500' USING ERRCODE='P4A30';
  END IF;

  RETURN QUERY
  WITH dispatch_base AS (
    SELECT
      m.dispatch_uid::text AS dispatch_uid,
      coalesce(max(nullif(btrim(m.sender_name), '')), 'B.R.A.N.D 운영국')::text AS sender_name,
      max(m.title)::text AS title,
      max(m.body)::text AS body,
      'TEACHER_MESSAGE'::public.mail_message_type AS message_type,
      min(m.created_at) AS created_at,
      max(m.recalled_at) AS recalled_at,
      count(*)::integer AS recipient_count,
      count(*) FILTER(WHERE m.is_read)::integer AS read_count
    FROM public.mail_messages m
    WHERE m.classroom_id=p_classroom_id
      AND m.sender_type='TEACHER'
      AND m.message_type='TEACHER_MESSAGE'
      AND m.dispatch_uid IS NOT NULL
    GROUP BY m.dispatch_uid
    ORDER BY min(m.created_at) DESC
    LIMIT p_limit
  )
  SELECT
    d.dispatch_uid,
    d.sender_name,
    d.title,
    d.body,
    d.message_type,
    d.created_at,
    d.recalled_at,
    d.recipient_count,
    d.read_count,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'message_id',m2.id,
          'student_id',m2.recipient_id,
          'student_name',s.name,
          'brand_name',s.brand_name,
          'is_read',m2.is_read,
          'read_at',m2.read_at
        )
        ORDER BY s.name,m2.recipient_id
      )
      FROM public.mail_messages m2
      LEFT JOIN public.students s ON s.id=m2.recipient_id
      WHERE m2.classroom_id=p_classroom_id
        AND m2.dispatch_uid=d.dispatch_uid
        AND m2.sender_type='TEACHER'
        AND m2.message_type='TEACHER_MESSAGE'
    ) AS recipients
  FROM dispatch_base d
  ORDER BY d.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION public.teacher_send_mail_with_sender(integer,integer[],text,text,text,public.mail_message_type) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_send_mail_with_sender(integer,integer[],text,text,text,public.mail_message_type) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.teacher_list_mail_dispatches_v2(integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_list_mail_dispatches_v2(integer,integer) TO authenticated,service_role;

COMMIT;
