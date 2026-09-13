-- Security hardening for the internal Rakaruka monthly official-ranking resolver.
-- It is called by SECURITY DEFINER monthly-finalization code and is not a client RPC.

BEGIN;

REVOKE ALL ON FUNCTION public.tikatuka_resolve_period_official_ranks(integer,bigint)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.tikatuka_resolve_period_official_ranks(integer,bigint) IS
  'Internal-only Rakaruka official ranking resolver for monthly finalization. Direct client execution is revoked.';

COMMIT;
