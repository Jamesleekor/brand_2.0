REVOKE EXECUTE ON FUNCTION public.transfer_p2p_with_log(
  integer, integer, bigint, character varying, text, integer, integer
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.transfer_p2p_with_log(
  integer, integer, bigint, character varying, text, integer, integer
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_my_p2p_transfer_quote(bigint)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_my_p2p_transfer_quote(bigint)
TO service_role;

COMMENT ON FUNCTION public.transfer_p2p_with_log(
  integer, integer, bigint, character varying, text, integer, integer
) IS 'Direct student-to-student transfer disabled. Secondary-job service payments must use the service market escrow/settlement flow.';

COMMENT ON FUNCTION public.get_my_p2p_transfer_quote(bigint)
IS 'Direct P2P transfer quote disabled for student clients together with direct transfers.';
