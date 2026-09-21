-- =====================================================================
-- B.R.A.N.D 2.0 — F4A sent-mail management
-- 2026-09-21
-- Adds dispatch grouping, read-status management support, and teacher recall.
-- =====================================================================
BEGIN;

ALTER TABLE public.mail_messages
  ADD COLUMN IF NOT EXISTS dispatch_uid varchar(96),
  ADD COLUMN IF NOT EXISTS recalled_at timestamptz,
  ADD COLUMN IF NOT EXISTS recalled_by uuid;

-- Existing rows predate dispatch grouping. Preserve them as independent
-- historical dispatches rather than guessing which rows belonged together.
UPDATE public.mail_messages
SET dispatch_uid = 'LEGACY_' || id::text
WHERE dispatch_uid IS NULL OR btrim(dispatch_uid) = '';


CREATE INDEX IF NOT EXISTS idx_mail_messages_dispatch_uid
  ON public.mail_messages(classroom_id, dispatch_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mail_messages_recipient_active
  ON public.mail_messages(recipient_id, created_at DESC)
  WHERE recalled_at IS NULL;

CREATE OR REPLACE FUNCTION public.teacher_send_mail(
  p_classroom_id integer, p_recipient_ids integer[], p_title text, p_body text,
  p_message_type public.mail_message_type DEFAULT 'TEACHER_MESSAGE'::public.mail_message_type
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_id integer;
  v_count integer := 0;
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

  v_title := btrim(coalesce(p_title,''));
  v_body := btrim(coalesce(p_body,''));
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
      title,body,message_type
    ) VALUES (
      'F4MAIL_'||extract(epoch from clock_timestamp())::bigint||'_'||v_id||'_'||substr(md5(random()::text),1,5),
      v_dispatch_uid,p_classroom_id,v_id,'TEACHER',auth.uid(),v_title,v_body,p_message_type
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION public.mark_mail_read(p_message_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_student_id integer;
BEGIN
  v_student_id := public.current_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION '[F4A] student login required' USING ERRCODE='P4A10';
  END IF;

  UPDATE public.mail_messages
  SET is_read=true, read_at=coalesce(read_at, now())
  WHERE id=p_message_id
    AND recipient_id=v_student_id
    AND recalled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[F4A] mail not found, recalled, or not yours' USING ERRCODE='P4A11';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_recall_mail_dispatch(
  p_classroom_id integer,
  p_dispatch_uid text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
  v_dispatch text;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '[F4A] teacher classroom denied' USING ERRCODE='P4A20';
  END IF;

  v_dispatch := btrim(coalesce(p_dispatch_uid,''));
  IF v_dispatch = '' OR char_length(v_dispatch) > 96 THEN
    RAISE EXCEPTION '[F4A] invalid dispatch uid' USING ERRCODE='P4A28';
  END IF;

  UPDATE public.mail_messages
  SET recalled_at = now(), recalled_by = auth.uid()
  WHERE classroom_id = p_classroom_id
    AND dispatch_uid = v_dispatch
    AND sender_type = 'TEACHER'
    AND recalled_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 AND NOT EXISTS (
    SELECT 1 FROM public.mail_messages
    WHERE classroom_id = p_classroom_id
      AND dispatch_uid = v_dispatch
      AND sender_type = 'TEACHER'
  ) THEN
    RAISE EXCEPTION '[F4A] mail dispatch not found' USING ERRCODE='P4A29';
  END IF;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.teacher_recall_mail_dispatch(integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_recall_mail_dispatch(integer,text) TO authenticated,service_role;

-- Keep the existing public RPC grants explicit after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.mark_mail_read(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_mail_read(bigint) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.teacher_send_mail(integer,integer[],text,text,public.mail_message_type) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_send_mail(integer,integer[],text,text,public.mail_message_type) TO authenticated,service_role;

COMMIT;
