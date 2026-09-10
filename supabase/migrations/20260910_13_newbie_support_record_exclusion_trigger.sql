-- B.R.A.N.D. 2.0 — inherit record exclusions onto reversals without modifying reverse_transaction()
CREATE OR REPLACE FUNCTION private.newbie_support_inherit_reversal_exclusions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $fn$
BEGIN
  IF NEW.source_type='REVERSAL'::public.transaction_source_type AND NEW.source_id IS NOT NULL THEN
    INSERT INTO private.transaction_record_exclusions(
      transaction_id,record_scope,reason_code,source_entity_type,source_entity_id
    )
    SELECT NEW.id,x.record_scope,x.reason_code,'REVERSAL',NEW.source_id
    FROM private.transaction_record_exclusions x
    WHERE x.transaction_id=NEW.source_id
    ON CONFLICT(transaction_id,record_scope) DO NOTHING;
  END IF;
  RETURN NEW;
END
$fn$;
REVOKE ALL ON FUNCTION private.newbie_support_inherit_reversal_exclusions() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_newbie_support_inherit_reversal_exclusions ON public.transactions;
CREATE TRIGGER trg_newbie_support_inherit_reversal_exclusions
AFTER INSERT ON public.transactions
FOR EACH ROW
WHEN (NEW.source_type='REVERSAL'::public.transaction_source_type AND NEW.source_id IS NOT NULL)
EXECUTE FUNCTION private.newbie_support_inherit_reversal_exclusions();
