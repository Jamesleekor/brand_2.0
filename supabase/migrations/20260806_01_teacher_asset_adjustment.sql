-- ============================================================================
-- B.R.A.N.D 2.0
-- 교사 BV/GOLD 단일·다중 지급/차감 RPC + BV 티어 동기화 + Realtime 보강
-- 생성일: 2026-08-06
--
-- 적용 방법: Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행
-- 안전성:
--   * create_transaction은 authenticated에 다시 공개하지 않음
--   * 외부 공개 RPC teacher_adjust_student_assets만 authenticated에 허용
--   * 함수 내부에서 교사 권한 + 동일 학급 + 활성 학생 검증
--   * 다중 학생 작업은 하나의 DB 트랜잭션으로 전부 성공하거나 전부 롤백
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 1. BV → 티어 계산 함수
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_tier_from_bv(p_bv bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_bv >= 100000 THEN '그랜드마스터'
    WHEN p_bv >=  85000 THEN '천상의 마스터'
    WHEN p_bv >=  75000 THEN '마스터'
    WHEN p_bv >=  65000 THEN '영원의 결정'
    WHEN p_bv >=  60000 THEN '무결 다이아'
    WHEN p_bv >=  55000 THEN '세공된 다이아'
    WHEN p_bv >=  50000 THEN '다이아 원석'
    WHEN p_bv >=  45000 THEN '홍염의 정점'
    WHEN p_bv >=  40000 THEN '각성한 루비'
    WHEN p_bv >=  35000 THEN '연마된 루비'
    WHEN p_bv >=  30000 THEN '루비 원석'
    WHEN p_bv >=  27500 THEN '태양의 황금'
    WHEN p_bv >=  25000 THEN '정련된 골드'
    WHEN p_bv >=  22500 THEN '제련된 골드'
    WHEN p_bv >=  20000 THEN '금 광석'
    WHEN p_bv >=  17500 THEN '은빛 극점'
    WHEN p_bv >=  15000 THEN '진화한 실버'
    WHEN p_bv >=  12500 THEN '성장한 실버'
    WHEN p_bv >=  10000 THEN '거친 실버'
    WHEN p_bv >=   7500 THEN '빛나는 브론즈'
    WHEN p_bv >=   5000 THEN '브론즈'
    ELSE '새싹'
  END;
$$;

COMMENT ON FUNCTION public.calculate_tier_from_bv(bigint)
IS 'BV 잔액을 B.R.A.N.D 2.0 22단계 티어명으로 변환하는 내부 함수';

REVOKE ALL ON FUNCTION public.calculate_tier_from_bv(bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.calculate_tier_from_bv(bigint) FROM anon;
REVOKE ALL ON FUNCTION public.calculate_tier_from_bv(bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_tier_from_bv(bigint) TO service_role;

-- --------------------------------------------------------------------------
-- 2. wallets.bv 변경 시 students.cached_tier 자동 동기화
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_student_cached_tier_from_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.students
       SET cached_tier = public.calculate_tier_from_bv(NEW.bv),
           updated_at = now()
     WHERE id = NEW.student_id;
  ELSIF NEW.bv IS DISTINCT FROM OLD.bv THEN
    UPDATE public.students
       SET cached_tier = public.calculate_tier_from_bv(NEW.bv),
           updated_at = now()
     WHERE id = NEW.student_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_student_cached_tier_from_wallet()
IS 'wallets.bv 변경 시 students.cached_tier를 자동 동기화하는 내부 트리거 함수';

REVOKE ALL ON FUNCTION public.sync_student_cached_tier_from_wallet() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_student_cached_tier_from_wallet() FROM anon;
REVOKE ALL ON FUNCTION public.sync_student_cached_tier_from_wallet() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_student_cached_tier_from_wallet() TO service_role;

DROP TRIGGER IF EXISTS trg_wallet_sync_cached_tier ON public.wallets;
CREATE TRIGGER trg_wallet_sync_cached_tier
AFTER INSERT OR UPDATE OF bv ON public.wallets
FOR EACH ROW
EXECUTE FUNCTION public.sync_student_cached_tier_from_wallet();

-- 기존 데이터도 한 번 정합화
UPDATE public.students AS s
   SET cached_tier = public.calculate_tier_from_bv(w.bv),
       updated_at = now()
  FROM public.wallets AS w
 WHERE w.student_id = s.id
   AND s.cached_tier IS DISTINCT FROM public.calculate_tier_from_bv(w.bv);

-- --------------------------------------------------------------------------
-- 3. 교사 전용 단일·다중 BV/GOLD 지급·차감 RPC
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_adjust_student_assets(
  p_student_ids integer[],
  p_value_token public.value_token_type,
  p_amount bigint,
  p_reason text
)
RETURNS TABLE(
  student_id integer,
  transaction_id bigint,
  new_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_teacher_classroom_id integer;
  v_requested_count integer;
  v_unique_count integer;
  v_valid_count integer;
  v_student_id integer;
  v_tx_id bigint;
  v_new_balance bigint;
  v_source_type public.transaction_source_type;
  v_memo text;
BEGIN
  -- 인증 및 교사 권한
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0600';
  END IF;

  PERFORM public.ensure_teacher_role();

  -- 입력 검증
  v_requested_count := cardinality(p_student_ids);
  IF p_student_ids IS NULL OR v_requested_count IS NULL OR v_requested_count < 1 THEN
    RAISE EXCEPTION '대상 학생을 한 명 이상 선택해주세요.' USING ERRCODE = 'P0601';
  END IF;

  IF v_requested_count > 100 THEN
    RAISE EXCEPTION '한 번에 처리할 수 있는 학생은 최대 100명입니다.' USING ERRCODE = 'P0602';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_student_ids) AS x(id) WHERE x.id IS NULL) THEN
    RAISE EXCEPTION '학생 목록에 잘못된 값이 포함되어 있습니다.' USING ERRCODE = 'P0603';
  END IF;

  SELECT count(DISTINCT x.id)
    INTO v_unique_count
    FROM unnest(p_student_ids) AS x(id);

  IF v_unique_count <> v_requested_count THEN
    RAISE EXCEPTION '같은 학생이 중복 선택되어 있습니다.' USING ERRCODE = 'P0603';
  END IF;

  IF p_value_token IS NULL
     OR p_value_token NOT IN ('BV'::public.value_token_type, 'GOLD'::public.value_token_type) THEN
    RAISE EXCEPTION '교사 조정은 BV 또는 GOLD만 가능합니다.' USING ERRCODE = 'P0604';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 OR abs(p_amount) > 10000000 THEN
    RAISE EXCEPTION '금액은 1 이상 10,000,000 이하이어야 합니다.' USING ERRCODE = 'P0605';
  END IF;

  p_reason := btrim(coalesce(p_reason, ''));
  IF char_length(p_reason) < 2 OR char_length(p_reason) > 200 THEN
    RAISE EXCEPTION '사유는 2자 이상 200자 이하로 입력해주세요.' USING ERRCODE = 'P0606';
  END IF;

  -- 현재 교사가 담당하는 활성 학급 확인
  SELECT s.classroom_id
    INTO v_teacher_classroom_id
    FROM public.students AS s
   WHERE s.user_id = auth.uid()
     AND s.transferred_at IS NULL
     AND s.role IN ('TEACHER', 'ADMIN')
   ORDER BY CASE WHEN s.role = 'TEACHER' THEN 0 ELSE 1 END, s.id
   LIMIT 1;

  IF v_teacher_classroom_id IS NULL THEN
    SELECT c.id
      INTO v_teacher_classroom_id
      FROM public.classrooms AS c
     WHERE c.teacher_user_id = auth.uid()
       AND c.is_active = true
     ORDER BY c.id
     LIMIT 1;
  END IF;

  IF v_teacher_classroom_id IS NULL THEN
    RAISE EXCEPTION '담당 학급을 확인할 수 없습니다.' USING ERRCODE = 'P0607';
  END IF;

  -- 대상 전원이 현재 교사의 같은 학급에 속한 활성 학생인지 검증
  SELECT count(*)
    INTO v_valid_count
    FROM public.students AS s
   WHERE s.id = ANY(p_student_ids)
     AND s.classroom_id = v_teacher_classroom_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');

  IF v_valid_count <> v_requested_count THEN
    RAISE EXCEPTION '선택한 학생 중 담당 학급의 활성 학생이 아닌 대상이 있습니다.'
      USING ERRCODE = 'P0608';
  END IF;

  -- 거래 출처와 학생에게 보일 메모
  IF p_amount > 0 THEN
    v_source_type := 'TEACHER_GRANT'::public.transaction_source_type;
    v_memo := '[교사 지급] ' || p_reason;
  ELSIF p_value_token = 'BV'::public.value_token_type THEN
    v_source_type := 'BV_REVOKE'::public.transaction_source_type;
    v_memo := '[교사 BV 차감] ' || p_reason;
  ELSE
    v_source_type := 'TEACHER_DEDUCT'::public.transaction_source_type;
    v_memo := '[교사 골드 차감] ' || p_reason;
  END IF;

  -- 학생 ID 순서대로 처리하여 동시 실행 시 잠금 순서를 안정화
  FOR v_student_id IN
    SELECT x.id
      FROM unnest(p_student_ids) AS x(id)
     ORDER BY x.id
  LOOP
    v_tx_id := public.create_transaction(
      v_student_id,
      p_value_token,
      p_amount,
      v_source_type,
      NULL,
      0,
      v_memo
    );

    SELECT CASE p_value_token
             WHEN 'BV'::public.value_token_type THEN w.bv
             WHEN 'GOLD'::public.value_token_type THEN w.gold
           END
      INTO v_new_balance
      FROM public.wallets AS w
     WHERE w.student_id = v_student_id;

    student_id := v_student_id;
    transaction_id := v_tx_id;
    new_balance := v_new_balance;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.teacher_adjust_student_assets(integer[], public.value_token_type, bigint, text)
IS '교사 전용 BV/GOLD 단일·다중 지급·차감. 동일 학급 검증 후 create_transaction을 내부 호출하며 전체 작업은 원자적이다.';

REVOKE ALL ON FUNCTION public.teacher_adjust_student_assets(integer[], public.value_token_type, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_adjust_student_assets(integer[], public.value_token_type, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.teacher_adjust_student_assets(integer[], public.value_token_type, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_adjust_student_assets(integer[], public.value_token_type, bigint, text) TO service_role;

-- create_transaction의 P0 차단 상태를 그대로 유지한다.
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

-- --------------------------------------------------------------------------
-- 4. 학생 화면 즉시 반영용 Realtime publication 보강 (이미 있으면 건너뜀)
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'wallets'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.wallets;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'transactions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
    END IF;
  END IF;
END;
$$;

COMMIT;

-- ============================================================================
-- 적용 후 검증용 조회 (결과만 확인, 데이터 변경 없음)
-- ============================================================================
SELECT
  p.oid::regprocedure AS function_signature,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings
FROM pg_proc AS p
JOIN pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'teacher_adjust_student_assets',
    'calculate_tier_from_bv',
    'sync_student_cached_tier_from_wallet'
  )
ORDER BY p.proname;

SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name = 'teacher_adjust_student_assets'
ORDER BY grantee, privilege_type;

SELECT pubname, schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN ('wallets', 'transactions')
ORDER BY tablename;
