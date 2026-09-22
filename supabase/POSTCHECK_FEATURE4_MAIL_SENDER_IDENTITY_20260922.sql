-- SQL Editor-safe structural postcheck.
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='mail_messages' AND column_name='sender_name'
  ) AS sender_name_column_ok,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='teacher_send_mail_with_sender'
  ) AS send_rpc_ok,
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='teacher_list_mail_dispatches_v2'
  ) AS list_rpc_ok,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid='public.mail_messages'::regclass
      AND tgname='trg_mail_sender_name_default'
      AND NOT tgisinternal
  ) AS sender_trigger_ok,
  NOT EXISTS (
    SELECT 1 FROM public.mail_messages
    WHERE sender_type='TEACHER' AND coalesce(btrim(sender_name),'')=''
  ) AS teacher_sender_backfill_ok;
