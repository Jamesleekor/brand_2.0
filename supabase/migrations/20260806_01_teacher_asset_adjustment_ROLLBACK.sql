-- ============================================================================
-- B.R.A.N.D 2.0
-- 교사 자산 지급·차감 기능 보수적 비활성화용 rollback
--
-- 주의:
--   * 이미 생성된 지갑 변동과 거래 기록은 되돌리지 않습니다.
--   * Realtime publication에서 wallets/transactions를 제거하지 않습니다.
--     다른 기능도 해당 publication을 사용할 수 있기 때문입니다.
--   * 긴급히 새 교사용 RPC 사용만 차단할 때 사용합니다.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.teacher_adjust_student_assets(
  integer[],
  public.value_token_type,
  bigint,
  text
) FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.teacher_adjust_student_assets(
  integer[],
  public.value_token_type,
  bigint,
  text
);

DROP TRIGGER IF EXISTS trg_wallet_sync_cached_tier ON public.wallets;
DROP FUNCTION IF EXISTS public.sync_student_cached_tier_from_wallet();

-- calculate_tier_from_bv는 다른 기능이 사용하기 시작했을 수 있으므로
-- 기본 rollback에서는 보존합니다.

-- P0 상태 재확인
REVOKE ALL ON FUNCTION public.create_transaction(
  integer,
  public.value_token_type,
  bigint,
  public.transaction_source_type,
  bigint,
  bigint,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_transaction(
  integer,
  public.value_token_type,
  bigint,
  public.transaction_source_type,
  bigint,
  bigint,
  text
) TO service_role;

COMMIT;
