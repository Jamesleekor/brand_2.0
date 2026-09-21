-- B.R.A.N.D 2.0 — F4A mail management postcheck
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mail_messages' AND column_name='dispatch_uid'
  ) AS has_dispatch_uid,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mail_messages' AND column_name='recalled_at'
  ) AS has_recalled_at,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mail_messages' AND column_name='recalled_by'
  ) AS has_recalled_by,
  to_regprocedure('public.teacher_recall_mail_dispatch(integer,text)') IS NOT NULL AS has_recall_rpc,
  to_regprocedure('public.teacher_send_mail(integer,integer[],text,text,public.mail_message_type)') IS NOT NULL AS has_send_rpc;
