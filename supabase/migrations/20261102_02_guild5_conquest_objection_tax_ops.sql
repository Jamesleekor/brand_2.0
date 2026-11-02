-- =============================================================================
-- B.R.A.N.D 2.0 — Guild5 점령 운영: 세율 선언 · 이의 제기 · 확정 징수 · 세수 분배 · 이력
-- 2026-11-02 incremental migration
--
-- 운영 규칙 (2026-11-02 사용자 확정)
--   1) 점령 확정(영토 배정) 순간에는 세금을 걷지 않는다.
--      점령 길드가 세율(10~50%)을 선언 → (선택) 4·5위 길드의 이의 제기 → 투표 결과 입력
--      → '세율 최종 확정' 시점에 그 달 과세 대상 경매(영토 자금 snapshot의 경매)에 일괄 과세한다.
--   2) 이의 제기는 영토당 1건. 찬성 14표 이상이면 통과(제기 길드가 요구한 세율로 확정),
--      미만이면 부결(점령 길드 세율 유지 + 제기 길드 길드원은 그 영토에 +10%p 가산).
--   3) 월간 점령은 '경매 대기열'의 경매 1개에 과세한다 (영토 자금 snapshot과 같은 경매).
--      → 다음 달 경매에 이전 달 점령 길드가 경매 도중 즉시 과세하던 IMMEDIATE 트리거는 중지한다.
--      (8회차 경매는 10월 점령 길드 몫. 9월 기준으로 걷힌 8회차 세금은 교사 패널에서 환급 후 재과세)
--   4) 걷은 세금은 점령 길드원에게 균등 분배. 나누는 수 = max(길드 인원, 5)
--      → 4인 길드는 5등분 값만 개인에게 지급하고 남는 1/5은 운영국 회수.
--
-- 안전 원칙
--   * 기존 이력 삭제 없음. 환급은 REVERSAL 거래 + assessment.voided_at 표시로만 처리한다.
--   * 기존 UNIQUE(auction_result_id)는 '살아있는(voided 아님) 과세 1건'으로 범위를 좁힌 partial unique index로 교체.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. 슬롯 ↔ 경매 카테고리 helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_slot_auction_category(p_slot_no integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $function$
  SELECT CASE p_slot_no WHEN 1 THEN '1인1역' WHEN 2 THEN '자리' WHEN 3 THEN '급식순서' ELSE NULL END;
$function$;
REVOKE ALL ON FUNCTION public.guild5_slot_auction_category(integer) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. 과세 기록(assessments) 확장: 환급(void) 표시 · 이의 제기 가산 · 세율 확정 연결
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild5_territory_tax_assessments
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS void_reason text,
  ADD COLUMN IF NOT EXISTS voided_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS void_refund_amount bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS objection_surcharge_pp numeric(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rate_settlement_id bigint;

COMMENT ON COLUMN public.guild5_territory_tax_assessments.voided_at IS
  '환급 처리되어 무효가 된 과세. 원본 행은 보존하고 REVERSAL 거래로 GOLD를 돌려준다.';
COMMENT ON COLUMN public.guild5_territory_tax_assessments.objection_surcharge_pp IS
  '이의 제기 부결 시 제기 길드 길드원에게 붙는 가산 세율(%p). 일반 납세자는 0.';

CREATE UNIQUE INDEX IF NOT EXISTS ux_g5_tax_assessment_live_result
  ON public.guild5_territory_tax_assessments(auction_result_id)
  WHERE voided_at IS NULL;

ALTER TABLE public.guild5_territory_tax_assessments
  DROP CONSTRAINT IF EXISTS guild5_territory_tax_assessments_auction_result_id_key;

CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_rate_settlement
  ON public.guild5_territory_tax_assessments(rate_settlement_id) WHERE rate_settlement_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. 세율 확정(settlement) — 점령 확정된 영토 1곳당 1행
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guild5_territory_rate_settlements (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  closure_id bigint NOT NULL REFERENCES public.guild5_month_closures(id) ON DELETE CASCADE,
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  conquest_turn_id bigint NOT NULL UNIQUE REFERENCES public.guild5_conquest_turns(id) ON DELETE CASCADE,
  owner_guild_id integer NOT NULL REFERENCES public.guilds(id),
  owner_rank_position integer NOT NULL,
  owner_guild_name_snapshot text NOT NULL,
  territory_id bigint NOT NULL REFERENCES public.guild5_territories(id),
  territory_slot_no smallint NOT NULL CHECK (territory_slot_no BETWEEN 1 AND 3),
  territory_name_snapshot text NOT NULL,
  auction_category text NOT NULL CHECK (auction_category IN ('자리','1인1역','급식순서')),
  status text NOT NULL DEFAULT 'RATE_DECLARED' CHECK (status IN ('RATE_DECLARED','FINALIZED')),
  declared_rate_percent numeric(5,2) NOT NULL CHECK (declared_rate_percent BETWEEN 10 AND 50),
  declared_at timestamptz NOT NULL DEFAULT now(),
  declared_by_user_id uuid,
  final_rate_percent numeric(5,2) CHECK (final_rate_percent IS NULL OR final_rate_percent BETWEEN 10 AND 50),
  finalized_at timestamptz,
  finalized_by_user_id uuid,
  settlement_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'FINALIZED' OR (final_rate_percent IS NOT NULL AND finalized_at IS NOT NULL))
);

ALTER TABLE public.guild5_territory_rate_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guild5_territory_rate_settlements FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS ix_g5_rate_settlement_version ON public.guild5_territory_rate_settlements(version_id, territory_slot_no);
CREATE INDEX IF NOT EXISTS ix_g5_rate_settlement_classroom ON public.guild5_territory_rate_settlements(classroom_id);

-- -----------------------------------------------------------------------------
-- 3. 이의 제기 — 영토당 살아있는 1건 (WITHDRAWN 제외)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guild5_territory_objections (
  id bigserial PRIMARY KEY,
  settlement_id bigint NOT NULL REFERENCES public.guild5_territory_rate_settlements(id) ON DELETE CASCADE,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  objector_guild_id integer NOT NULL REFERENCES public.guilds(id),
  objector_rank_position integer NOT NULL,
  objector_guild_name_snapshot text NOT NULL,
  declared_rate_snapshot numeric(5,2) NOT NULL,
  proposed_rate_percent numeric(5,2) NOT NULL CHECK (proposed_rate_percent BETWEEN 10 AND 50),
  status text NOT NULL DEFAULT 'FILED' CHECK (status IN ('FILED','PASSED','REJECTED','WITHDRAWN')),
  vote_threshold integer NOT NULL DEFAULT 14 CHECK (vote_threshold > 0),
  yes_votes integer CHECK (yes_votes IS NULL OR yes_votes >= 0),
  no_votes integer CHECK (no_votes IS NULL OR no_votes >= 0),
  note text,
  filed_at timestamptz NOT NULL DEFAULT now(),
  filed_by_user_id uuid,
  decided_at timestamptz,
  decided_by_user_id uuid,
  withdrawn_at timestamptz,
  withdraw_reason text
);

ALTER TABLE public.guild5_territory_objections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guild5_territory_objections FROM anon, authenticated;
CREATE UNIQUE INDEX IF NOT EXISTS ux_g5_objection_one_live_per_territory
  ON public.guild5_territory_objections(settlement_id) WHERE status <> 'WITHDRAWN';
CREATE INDEX IF NOT EXISTS ix_g5_objection_version ON public.guild5_territory_objections(version_id);

-- -----------------------------------------------------------------------------
-- 4. 세수 분배 기록 (헤더 + 학생별 지급 줄)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guild5_territory_tax_distributions (
  id bigserial PRIMARY KEY,
  settlement_id bigint NOT NULL REFERENCES public.guild5_territory_rate_settlements(id) ON DELETE CASCADE,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  owner_guild_id integer NOT NULL REFERENCES public.guilds(id),
  basis_amount bigint NOT NULL CHECK (basis_amount > 0),
  roster_count integer NOT NULL CHECK (roster_count > 0),
  divisor integer NOT NULL CHECK (divisor >= 5),
  per_member_amount bigint NOT NULL CHECK (per_member_amount > 0),
  paid_member_count integer NOT NULL DEFAULT 0,
  distributed_amount bigint NOT NULL DEFAULT 0 CHECK (distributed_amount >= 0),
  retained_amount bigint NOT NULL DEFAULT 0 CHECK (retained_amount >= 0),
  note text,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.guild5_territory_tax_distributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guild5_territory_tax_distributions FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS ix_g5_tax_distribution_settlement ON public.guild5_territory_tax_distributions(settlement_id);

CREATE TABLE IF NOT EXISTS public.guild5_territory_tax_distribution_lines (
  id bigserial PRIMARY KEY,
  distribution_id bigint NOT NULL REFERENCES public.guild5_territory_tax_distributions(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES public.students(id),
  student_name_snapshot text,
  amount bigint NOT NULL DEFAULT 0 CHECK (amount >= 0),
  transaction_id bigint REFERENCES public.transactions(id),
  line_status text NOT NULL CHECK (line_status IN ('PAID','SKIPPED_TRANSFERRED'))
);

ALTER TABLE public.guild5_territory_tax_distribution_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guild5_territory_tax_distribution_lines FROM anon, authenticated;
CREATE INDEX IF NOT EXISTS ix_g5_tax_distribution_line_dist ON public.guild5_territory_tax_distribution_lines(distribution_id);

ALTER TABLE public.guild5_territory_tax_assessments
  DROP CONSTRAINT IF EXISTS guild5_territory_tax_assessments_rate_settlement_id_fkey;
ALTER TABLE public.guild5_territory_tax_assessments
  ADD CONSTRAINT guild5_territory_tax_assessments_rate_settlement_id_fkey
  FOREIGN KEY (rate_settlement_id) REFERENCES public.guild5_territory_rate_settlements(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- 5. 점령 확정 시 즉시 과세 중지 (세율 확정 후 징수로 전환)
--    production 본문을 그대로 두고 guild5_assess_assigned_territory_tax 호출만 DEFERRED 표시로 교체
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_choose_guild5_territory(p_turn_id bigint, p_territory_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_territory public.guild5_territories%ROWTYPE;
  v_closure_id bigint;
  v_tax jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  SELECT t.* INTO v_turn
  FROM public.guild5_conquest_turns t
  JOIN public.guild5_closure_versions v ON v.id=t.version_id
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE t.id=p_turn_id
    AND c.classroom_id=v_class
    AND c.current_version_id=v.id
    AND c.lifecycle_state='FINALIZED'
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5] conquest turn not found.' USING ERRCODE='P0522';
  END IF;

  SELECT v.closure_id INTO v_closure_id
  FROM public.guild5_closure_versions v
  WHERE v.id=v_turn.version_id;

  PERFORM public.guild5_process_due_conquest_internal(v_turn.version_id);

  SELECT * INTO v_turn
  FROM public.guild5_conquest_turns
  WHERE id=p_turn_id
  FOR UPDATE;

  IF v_turn.turn_status<>'ACTIVE' THEN
    RAISE EXCEPTION '[G5] only current ACTIVE rank may choose.' USING ERRCODE='P0523';
  END IF;

  SELECT t.* INTO v_territory
  FROM public.guild5_territories t
  JOIN public.guild5_closure_versions v ON v.id=v_turn.version_id
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE t.id=p_territory_id
    AND t.classroom_id=c.classroom_id
    AND t.season_id=c.season_id;

  IF NOT FOUND OR EXISTS(
    SELECT 1
    FROM public.guild5_conquest_turns
    WHERE version_id=v_turn.version_id
      AND territory_id=p_territory_id
  ) THEN
    RAISE EXCEPTION '[G5] territory is unavailable.' USING ERRCODE='P0524';
  END IF;

  UPDATE public.guild5_conquest_turns
  SET turn_status='ASSIGNED',
      territory_id=v_territory.id,
      territory_name_snapshot=v_territory.territory_name,
      assignment_method='MANUAL',
      chosen_at=now()
  WHERE id=v_turn.id;

  -- 2026-11-02: 점령 확정 시점에는 과세하지 않는다. 세율 선언·이의 제기·최종 확정 후 징수.
  v_tax:=jsonb_build_object('status','DEFERRED_UNTIL_RATE_FINALIZED','turn_id',v_turn.id);

  PERFORM public.guild5_write_audit(
    v_closure_id,v_turn.version_id,v_class,'CONQUEST_MANUAL_ASSIGNED',NULL,
    jsonb_build_object('turn_id',v_turn.id,'rank',v_turn.rank_position),
    jsonb_build_object(
      'territory_id',v_territory.id,
      'territory_name',v_territory.territory_name,
      'tax_settlement',v_tax
    )
  );

  PERFORM public.guild5_activate_next_turn(v_turn.version_id);

  RETURN jsonb_build_object(
    'turn_id',v_turn.id,
    'territory_id',v_territory.id,
    'territory_name',v_territory.territory_name,
    'tax_settlement',v_tax,
    'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=v_turn.version_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guild5_process_due_conquest_internal(p_version_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_territory public.guild5_territories%ROWTYPE;
  v_processed integer:=0;
  v_closure_id bigint;
  v_class integer;
  v_tax jsonb;
BEGIN
  SELECT v.closure_id,c.classroom_id
  INTO v_closure_id,v_class
  FROM public.guild5_closure_versions v
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE v.id=p_version_id
    AND c.current_version_id=v.id
    AND c.lifecycle_state='FINALIZED';

  IF v_closure_id IS NULL THEN
    RETURN jsonb_build_object('processed',0,'skipped','NOT_CURRENT_FINALIZED');
  END IF;

  LOOP
    SELECT * INTO v_turn
    FROM public.guild5_conquest_turns
    WHERE version_id=p_version_id
      AND turn_status='ACTIVE'
      AND deadline_at<=now()
    ORDER BY rank_position
    LIMIT 1
    FOR UPDATE;

    EXIT WHEN NOT FOUND;

    SELECT t.* INTO v_territory
    FROM public.guild5_territories t
    JOIN public.guild5_month_closures c ON c.season_id=t.season_id
    JOIN public.guild5_closure_versions v ON v.closure_id=c.id AND v.id=p_version_id
    WHERE NOT EXISTS(
      SELECT 1
      FROM public.guild5_conquest_turns used
      WHERE used.version_id=p_version_id
        AND used.territory_id=t.id
    )
    ORDER BY md5(p_version_id::text||'|'||v_turn.rank_position::text||'|'||t.id::text)
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION '[G5] no territory remains for auto assignment.' USING ERRCODE='P0520';
    END IF;

    UPDATE public.guild5_conquest_turns
    SET turn_status='AUTO_ASSIGNED',
        territory_id=v_territory.id,
        territory_name_snapshot=v_territory.territory_name,
        assignment_method='AUTO',
        chosen_at=now()
    WHERE id=v_turn.id;

    -- 2026-11-02: 자동 배정도 즉시 과세하지 않는다.
    v_tax:=jsonb_build_object('status','DEFERRED_UNTIL_RATE_FINALIZED','turn_id',v_turn.id);

    PERFORM public.guild5_write_audit(
      v_closure_id,p_version_id,v_class,'CONQUEST_AUTO_ASSIGNED','선택 기한 만료',
      jsonb_build_object('turn_id',v_turn.id,'rank',v_turn.rank_position),
      jsonb_build_object(
        'territory_id',v_territory.id,
        'territory_name',v_territory.territory_name,
        'tax_settlement',v_tax
      )
    );

    v_processed:=v_processed+1;
    PERFORM public.guild5_activate_next_turn(p_version_id);
  END LOOP;

  RETURN jsonb_build_object(
    'processed',v_processed,
    'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=p_version_id)
  );
END;
$function$;

-- 경매 도중 '가장 최근 FINAL 월의 점령 길드'가 즉시 과세하던 동작 중지.
-- 트리거 자체는 남겨 두고(의존성 보존) 함수는 아무것도 하지 않도록 교체한다.
CREATE OR REPLACE FUNCTION public.guild5_assess_sold_auction_item_tax_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 2026-11-02: 월간 점령은 '경매 대기열'의 경매 1개(영토 자금 snapshot 경매)에만 과세한다.
  -- 과세는 teacher_finalize_guild5_territory_rate 에서 일괄 처리하므로 낙찰 즉시 과세는 하지 않는다.
  RETURN NEW;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 6. 세수 요약: 환급(void)된 과세 제외
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_get_territory_tax_summary(p_version_id bigint)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
  WITH econ AS (
    SELECT * FROM public.guild5_territory_economy_snapshots WHERE version_id=p_version_id
  ),
  assigned AS (
    SELECT ct.*
    FROM public.guild5_conquest_turns ct
    WHERE ct.version_id=p_version_id
      AND ct.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
      AND ct.territory_id IS NOT NULL
  ),
  agg AS (
    SELECT
      a.territory_slot_no,
      count(a.id)::integer AS assessment_count,
      count(DISTINCT a.student_id)::integer AS taxpayer_count,
      coalesce(sum(a.tax_amount),0)::bigint AS assessed_amount,
      coalesce(sum(CASE WHEN a.arrear_id IS NOT NULL THEN ar.paid_amount ELSE a.collected_amount_at_assessment END),0)::bigint AS collected_amount
    FROM public.guild5_territory_tax_assessments a
    LEFT JOIN public.student_asset_arrears ar ON ar.id=a.arrear_id
    WHERE a.version_id=p_version_id
      AND a.voided_at IS NULL
    GROUP BY a.territory_slot_no
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'slot_no',e.slot_no,
      'territory_id',coalesce(ct.territory_id,e.territory_id),
      'territory_name',coalesce(ct.territory_name_snapshot,e.territory_name_snapshot),
      'auction_category',e.auction_category,
      'auction_id',e.auction_id,
      'auction_round_number',e.auction_round_number,
      'tax_rate_percent',coalesce(ct.territory_tax_rate_snapshot,e.tax_rate_percent_snapshot),
      'owner_guild_id',ct.guild_id,
      'turn_id',ct.id,
      'turn_status',ct.turn_status,
      'assessment_count',coalesce(a.assessment_count,0),
      'taxpayer_count',coalesce(a.taxpayer_count,0),
      'assessed_amount',coalesce(a.assessed_amount,0),
      'collected_amount',coalesce(a.collected_amount,0),
      'outstanding_amount',greatest(coalesce(a.assessed_amount,0)-coalesce(a.collected_amount,0),0)
    )
    ORDER BY e.slot_no
  ),'[]'::jsonb)
  FROM econ e
  LEFT JOIN assigned ct ON ct.territory_slot_no_snapshot=e.slot_no
  LEFT JOIN agg a ON a.territory_slot_no=e.slot_no;
$function$;

-- -----------------------------------------------------------------------------
-- 7. 내부 helper: 과세 1건 환급(void)
--    ① 미납 자동/수동 상환분 취소 → ② 최초 차감 거래 취소 → ③ 남은 미납 면제 → ④ void 표시
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_refund_territory_tax_assessment_internal(
  p_assessment_id bigint,
  p_reason text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_a public.guild5_territory_tax_assessments%ROWTYPE;
  v_tx public.transactions%ROWTYPE;
  v_col record;
  v_refund bigint:=0;
BEGIN
  SELECT * INTO v_a
  FROM public.guild5_territory_tax_assessments
  WHERE id=p_assessment_id AND voided_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;

  IF v_a.arrear_id IS NOT NULL THEN
    FOR v_col IN
      SELECT c.id,c.amount
      FROM public.student_asset_arrear_collections c
      WHERE c.arrear_id=v_a.arrear_id AND c.reversed_at IS NULL
      ORDER BY c.id DESC
    LOOP
      PERFORM public._reverse_asset_arrear_collection(v_col.id,p_reason);
      v_refund:=v_refund+v_col.amount;
    END LOOP;
  END IF;

  IF v_a.transaction_id IS NOT NULL THEN
    SELECT * INTO v_tx FROM public.transactions WHERE id=v_a.transaction_id FOR UPDATE;
    IF FOUND AND NOT v_tx.is_reversed THEN
      PERFORM public.reverse_transaction(v_a.transaction_id,p_reason);
      v_refund:=v_refund+abs(v_tx.amount);
    END IF;
  END IF;

  IF v_a.arrear_id IS NOT NULL THEN
    UPDATE public.student_asset_arrears
    SET status='WAIVED',waived_at=now(),settled_at=now(),updated_at=now()
    WHERE id=v_a.arrear_id AND status IN ('UNPAID','PARTIAL');
  END IF;

  UPDATE public.guild5_territory_tax_assessments
  SET voided_at=now(),
      void_reason=p_reason,
      voided_by_user_id=auth.uid(),
      void_refund_amount=v_refund
  WHERE id=v_a.id;

  RETURN v_refund;
END;
$function$;
REVOKE ALL ON FUNCTION public.guild5_refund_territory_tax_assessment_internal(bigint,text) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. 내부 helper: 확정 세율로 낙찰 1건 과세
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_assess_result_with_rate_internal(
  p_auction_result_id integer,
  p_settlement_id bigint,
  p_rate_percent numeric,
  p_surcharge_pp numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_result public.auction_results%ROWTYPE;
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_year_month text;
  v_reduction numeric:=0;
  v_effective numeric:=0;
  v_tax bigint:=0;
  v_deduct jsonb;
  v_collected bigint:=0;
  v_outstanding bigint:=0;
  v_tx_id bigint:=null;
  v_arrear_id bigint:=null;
  v_status text:='PAID';
  v_new_id bigint;
BEGIN
  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] settlement not found.' USING ERRCODE='P0560';
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.guild5_territory_tax_assessments
    WHERE auction_result_id=p_auction_result_id AND voided_at IS NULL
  ) THEN
    RETURN jsonb_build_object('status','ALREADY_ASSESSED','auction_result_id',p_auction_result_id);
  END IF;

  SELECT * INTO v_result FROM public.auction_results WHERE id=p_auction_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] auction result not found.' USING ERRCODE='P0553';
  END IF;
  SELECT * INTO v_item FROM public.auction_items WHERE id=v_result.auction_item_id;
  SELECT * INTO v_auction FROM public.auctions WHERE id=v_item.auction_id;

  IF v_auction.classroom_id IS DISTINCT FROM v_s.classroom_id THEN
    RAISE EXCEPTION '[G5 TAX] classroom mismatch.' USING ERRCODE='P0554';
  END IF;
  IF v_item.category IS DISTINCT FROM v_s.auction_category THEN
    RETURN jsonb_build_object('status','CATEGORY_MISMATCH','auction_result_id',p_auction_result_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.transactions tx WHERE tx.id=v_result.transaction_id AND tx.is_reversed) THEN
    RETURN jsonb_build_object('status','SKIPPED_REVERSED','auction_result_id',p_auction_result_id);
  END IF;
  IF EXISTS(SELECT 1 FROM public.students st WHERE st.id=v_result.winner_student_id AND st.transferred_at IS NOT NULL) THEN
    RETURN jsonb_build_object('status','SKIPPED_TRANSFERRED','auction_result_id',p_auction_result_id);
  END IF;

  SELECT c.year_month INTO v_year_month FROM public.guild5_month_closures c WHERE c.id=v_s.closure_id;

  v_reduction:=greatest(0,public.collection_buff_value(v_result.winner_student_id,'TAX_RATE_REDUCTION_PP'));
  v_effective:=greatest(0,least(100,coalesce(p_rate_percent,0)+coalesce(p_surcharge_pp,0)-v_reduction));
  v_tax:=floor(v_result.final_price::numeric*v_effective/100)::bigint;

  IF v_tax>0 THEN
    v_deduct:=public._teacher_apply_asset_deduction(
      v_result.winner_student_id,
      'GOLD'::public.value_token_type,
      v_tax,
      format(
        '[Guild5 영토세] %s · %s 점령 %s · 경매 %s회차 %s · 낙찰가 %s GOLD × 실효세율 %s%%%s',
        v_s.territory_name_snapshot,
        coalesce(v_year_month,''),
        v_s.owner_guild_name_snapshot,
        v_auction.round_number,
        v_s.auction_category,
        v_result.final_price,
        trim(to_char(v_effective,'FM999990.00')),
        CASE WHEN coalesce(p_surcharge_pp,0)>0
          THEN format(' (이의 제기 부결 가산 +%s%%p 포함)',trim(to_char(p_surcharge_pp,'FM999990.##')))
          ELSE '' END
      )
    );
    v_collected:=coalesce((v_deduct->>'collected_amount')::bigint,0);
    v_outstanding:=coalesce((v_deduct->>'outstanding_amount')::bigint,0);
    v_tx_id:=nullif(v_deduct->>'transaction_id','')::bigint;
    v_arrear_id:=nullif(v_deduct->>'arrear_id','')::bigint;
    v_status:=CASE WHEN v_outstanding<=0 THEN 'PAID' WHEN v_collected>0 THEN 'PARTIAL' ELSE 'UNPAID' END;

    IF v_tx_id IS NOT NULL THEN
      UPDATE public.transactions SET tax_amount=v_collected WHERE id=v_tx_id;
    END IF;
  END IF;

  INSERT INTO public.guild5_territory_tax_assessments(
    classroom_id,closure_id,version_id,conquest_turn_id,owner_guild_id,
    territory_id,territory_slot_no,territory_name_snapshot,
    auction_id,auction_result_id,auction_item_id,auction_category,
    student_id,final_price,territory_tax_rate_percent,tax_reduction_pp,
    effective_tax_rate_percent,tax_amount,collected_amount_at_assessment,
    transaction_id,arrear_id,assessment_mode,status_at_assessment,
    objection_surcharge_pp,rate_settlement_id
  ) VALUES (
    v_s.classroom_id,v_s.closure_id,v_s.version_id,v_s.conquest_turn_id,v_s.owner_guild_id,
    v_s.territory_id,v_s.territory_slot_no,v_s.territory_name_snapshot,
    v_auction.id,v_result.id,v_item.id,v_s.auction_category,
    v_result.winner_student_id,v_result.final_price,p_rate_percent,v_reduction,
    v_effective,v_tax,v_collected,v_tx_id,v_arrear_id,'RETROACTIVE',v_status,
    coalesce(p_surcharge_pp,0),v_s.id
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'status','ASSESSED',
    'assessment_id',v_new_id,
    'student_id',v_result.winner_student_id,
    'tax_amount',v_tax,
    'collected_amount',v_collected,
    'outstanding_amount',v_outstanding,
    'surcharge_pp',coalesce(p_surcharge_pp,0),
    'effective_tax_rate_percent',v_effective
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.guild5_assess_result_with_rate_internal(integer,bigint,numeric,numeric) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. 내부 helper: 교사 학급의 '현재 FINAL version'인지 확인하고 closure 반환
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_require_current_final_version(p_version_id bigint, p_classroom_id integer)
RETURNS public.guild5_month_closures
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_c public.guild5_month_closures%ROWTYPE;
BEGIN
  SELECT c.* INTO v_c
  FROM public.guild5_month_closures c
  JOIN public.guild5_closure_versions v ON v.closure_id=c.id
  WHERE v.id=p_version_id
    AND c.classroom_id=p_classroom_id
    AND c.current_version_id=v.id
    AND c.lifecycle_state='FINALIZED';
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION '현재 FINAL 상태인 월간 마감에서만 처리할 수 있습니다.' USING ERRCODE='P0561';
  END IF;
  RETURN v_c;
END;
$function$;
REVOKE ALL ON FUNCTION public.guild5_require_current_final_version(bigint,integer) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. 교사 RPC: 세율 선언 (10~50%)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_declare_guild5_territory_rate(
  p_turn_id bigint,
  p_rate_percent numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_guild_name text;
  v_before numeric;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  IF p_rate_percent IS NULL OR p_rate_percent<10 OR p_rate_percent>50 THEN
    RAISE EXCEPTION '세율은 10%%~50%% 사이로 입력해주세요.' USING ERRCODE='P0562';
  END IF;

  SELECT * INTO v_turn FROM public.guild5_conquest_turns WHERE id=p_turn_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '정복 차례를 찾을 수 없습니다.' USING ERRCODE='P0563';
  END IF;
  v_closure:=public.guild5_require_current_final_version(v_turn.version_id,v_class);

  IF v_turn.turn_status NOT IN ('ASSIGNED','AUTO_ASSIGNED') OR v_turn.territory_id IS NULL THEN
    RAISE EXCEPTION '점령이 확정된 영토만 세율을 선언할 수 있습니다.' USING ERRCODE='P0564';
  END IF;

  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE conquest_turn_id=v_turn.id FOR UPDATE;

  IF FOUND THEN
    IF v_s.status='FINALIZED' THEN
      RAISE EXCEPTION '이미 세율이 최종 확정된 영토입니다.' USING ERRCODE='P0565';
    END IF;
    IF EXISTS(SELECT 1 FROM public.guild5_territory_objections o WHERE o.settlement_id=v_s.id AND o.status<>'WITHDRAWN') THEN
      RAISE EXCEPTION '이의 제기가 접수된 뒤에는 선언 세율을 바꿀 수 없습니다. 이의 제기를 취소한 뒤 수정하세요.' USING ERRCODE='P0566';
    END IF;
    v_before:=v_s.declared_rate_percent;
    UPDATE public.guild5_territory_rate_settlements
    SET declared_rate_percent=p_rate_percent,
        declared_at=now(),
        declared_by_user_id=auth.uid(),
        updated_at=now()
    WHERE id=v_s.id
    RETURNING * INTO v_s;
  ELSE
    SELECT gs.guild_name_at_close INTO v_guild_name
    FROM public.guild5_guild_snapshots gs
    WHERE gs.version_id=v_turn.version_id AND gs.guild_id=v_turn.guild_id;

    INSERT INTO public.guild5_territory_rate_settlements(
      classroom_id,closure_id,version_id,conquest_turn_id,owner_guild_id,owner_rank_position,
      owner_guild_name_snapshot,territory_id,territory_slot_no,territory_name_snapshot,auction_category,
      status,declared_rate_percent,declared_at,declared_by_user_id
    ) VALUES (
      v_class,v_closure.id,v_turn.version_id,v_turn.id,v_turn.guild_id,v_turn.rank_position,
      coalesce(v_guild_name,'Guild #'||v_turn.guild_id),v_turn.territory_id,v_turn.territory_slot_no_snapshot,
      coalesce(v_turn.territory_name_snapshot,'영토'),
      public.guild5_slot_auction_category(v_turn.territory_slot_no_snapshot),
      'RATE_DECLARED',p_rate_percent,now(),auth.uid()
    )
    RETURNING * INTO v_s;
  END IF;

  -- 학생 화면의 '지역 세율'이 선언 세율을 보여주도록 차례 snapshot 갱신 (최종 확정 때 다시 갱신)
  UPDATE public.guild5_conquest_turns SET territory_tax_rate_snapshot=p_rate_percent WHERE id=v_turn.id;

  PERFORM public.guild5_write_audit(
    v_closure.id,v_turn.version_id,v_class,'TERRITORY_RATE_DECLARED',NULL,
    jsonb_build_object('settlement_id',v_s.id,'declared_rate_percent',v_before),
    jsonb_build_object('settlement_id',v_s.id,'turn_id',v_turn.id,'territory',v_s.territory_name_snapshot,
      'owner_guild_id',v_s.owner_guild_id,'declared_rate_percent',p_rate_percent)
  );

  RETURN to_jsonb(v_s);
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_declare_guild5_territory_rate(bigint,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_declare_guild5_territory_rate(bigint,numeric) TO authenticated;

-- -----------------------------------------------------------------------------
-- 11. 교사 RPC: 이의 제기 접수 (4·5위 길드, 영토당 1건, 요구 세율 < 선언 세율)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_file_guild5_territory_objection(
  p_settlement_id bigint,
  p_objector_guild_id integer,
  p_proposed_rate_percent numeric,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_gs public.guild5_guild_snapshots%ROWTYPE;
  v_o public.guild5_territory_objections%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=p_settlement_id AND classroom_id=v_class FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '세율 선언 기록을 찾을 수 없습니다.' USING ERRCODE='P0567';
  END IF;
  v_closure:=public.guild5_require_current_final_version(v_s.version_id,v_class);

  IF v_s.status='FINALIZED' THEN
    RAISE EXCEPTION '세율이 이미 최종 확정되어 이의 제기를 받을 수 없습니다.' USING ERRCODE='P0565';
  END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_territory_objections o WHERE o.settlement_id=v_s.id AND o.status<>'WITHDRAWN') THEN
    RAISE EXCEPTION '이 영토에는 이미 이의 제기가 접수되어 있습니다. (영토당 1건)' USING ERRCODE='P0568';
  END IF;

  SELECT * INTO v_gs FROM public.guild5_guild_snapshots
  WHERE version_id=v_s.version_id AND guild_id=p_objector_guild_id;
  IF NOT FOUND OR v_gs.rank_position NOT BETWEEN 4 AND 5 THEN
    RAISE EXCEPTION '이의 제기는 이번 달 4위·5위 길드만 할 수 있습니다.' USING ERRCODE='P0569';
  END IF;

  IF p_proposed_rate_percent IS NULL OR p_proposed_rate_percent<10 OR p_proposed_rate_percent>50 THEN
    RAISE EXCEPTION '요구 세율은 10%%~50%% 사이로 입력해주세요.' USING ERRCODE='P0562';
  END IF;
  IF p_proposed_rate_percent>=v_s.declared_rate_percent THEN
    RAISE EXCEPTION '요구 세율은 점령 길드가 선언한 세율(%)보다 낮아야 합니다.', trim(to_char(v_s.declared_rate_percent,'FM990.##'))||'%' USING ERRCODE='P0570';
  END IF;

  INSERT INTO public.guild5_territory_objections(
    settlement_id,classroom_id,version_id,objector_guild_id,objector_rank_position,objector_guild_name_snapshot,
    declared_rate_snapshot,proposed_rate_percent,status,note,filed_by_user_id
  ) VALUES (
    v_s.id,v_class,v_s.version_id,v_gs.guild_id,v_gs.rank_position,coalesce(v_gs.guild_name_at_close,'Guild #'||v_gs.guild_id),
    v_s.declared_rate_percent,p_proposed_rate_percent,'FILED',nullif(btrim(coalesce(p_note,'')),''),auth.uid()
  )
  RETURNING * INTO v_o;

  PERFORM public.guild5_write_audit(
    v_closure.id,v_s.version_id,v_class,'TERRITORY_OBJECTION_FILED',v_o.note,
    '{}'::jsonb,
    jsonb_build_object('objection_id',v_o.id,'settlement_id',v_s.id,'territory',v_s.territory_name_snapshot,
      'objector_guild_id',v_o.objector_guild_id,'declared_rate_percent',v_s.declared_rate_percent,
      'proposed_rate_percent',v_o.proposed_rate_percent)
  );

  RETURN to_jsonb(v_o);
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_file_guild5_territory_objection(bigint,integer,numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_file_guild5_territory_objection(bigint,integer,numeric,text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 12. 교사 RPC: 이의 제기 취소 (세율 최종 확정 전까지)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_withdraw_guild5_territory_objection(
  p_objection_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_o public.guild5_territory_objections%ROWTYPE;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_reason text:=btrim(coalesce(p_reason,''));
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  IF char_length(v_reason)<2 OR char_length(v_reason)>200 THEN
    RAISE EXCEPTION '취소 사유를 2자 이상 입력해주세요.' USING ERRCODE='P0571';
  END IF;

  SELECT * INTO v_o FROM public.guild5_territory_objections WHERE id=p_objection_id AND classroom_id=v_class FOR UPDATE;
  IF NOT FOUND OR v_o.status='WITHDRAWN' THEN
    RAISE EXCEPTION '취소할 수 있는 이의 제기가 없습니다.' USING ERRCODE='P0572';
  END IF;
  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=v_o.settlement_id FOR UPDATE;
  v_closure:=public.guild5_require_current_final_version(v_s.version_id,v_class);
  IF v_s.status='FINALIZED' THEN
    RAISE EXCEPTION '세율이 최종 확정된 뒤에는 이의 제기를 취소할 수 없습니다.' USING ERRCODE='P0565';
  END IF;

  UPDATE public.guild5_territory_objections
  SET status='WITHDRAWN',withdrawn_at=now(),withdraw_reason=v_reason
  WHERE id=v_o.id
  RETURNING * INTO v_o;

  PERFORM public.guild5_write_audit(
    v_closure.id,v_s.version_id,v_class,'TERRITORY_OBJECTION_WITHDRAWN',v_reason,
    '{}'::jsonb,jsonb_build_object('objection_id',v_o.id,'settlement_id',v_s.id)
  );

  RETURN to_jsonb(v_o);
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_withdraw_guild5_territory_objection(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_withdraw_guild5_territory_objection(bigint,text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 13. 교사 RPC: 익명 투표 결과 입력 (찬성 14표 이상 → 통과)
--     세율 최종 확정 전까지는 잘못 입력한 값을 다시 입력할 수 있다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_record_guild5_objection_vote(
  p_objection_id bigint,
  p_yes_votes integer,
  p_no_votes integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_o public.guild5_territory_objections%ROWTYPE;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_roster integer;
  v_before jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  SELECT * INTO v_o FROM public.guild5_territory_objections WHERE id=p_objection_id AND classroom_id=v_class FOR UPDATE;
  IF NOT FOUND OR v_o.status='WITHDRAWN' THEN
    RAISE EXCEPTION '투표 결과를 입력할 이의 제기를 찾을 수 없습니다.' USING ERRCODE='P0572';
  END IF;
  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=v_o.settlement_id FOR UPDATE;
  v_closure:=public.guild5_require_current_final_version(v_s.version_id,v_class);
  IF v_s.status='FINALIZED' THEN
    RAISE EXCEPTION '세율이 최종 확정된 뒤에는 투표 결과를 바꿀 수 없습니다.' USING ERRCODE='P0565';
  END IF;

  SELECT count(*)::integer INTO v_roster FROM public.guild5_student_snapshots WHERE version_id=v_s.version_id;
  IF p_yes_votes IS NULL OR p_no_votes IS NULL OR p_yes_votes<0 OR p_no_votes<0 OR p_yes_votes+p_no_votes<1 THEN
    RAISE EXCEPTION '찬성·반대 표 수를 0 이상으로 입력해주세요.' USING ERRCODE='P0573';
  END IF;
  IF v_roster>0 AND p_yes_votes+p_no_votes>v_roster THEN
    RAISE EXCEPTION '찬성+반대(%표)가 이번 달 전체 인원(%명)보다 많습니다.', p_yes_votes+p_no_votes, v_roster USING ERRCODE='P0574';
  END IF;

  v_before:=jsonb_build_object('status',v_o.status,'yes_votes',v_o.yes_votes,'no_votes',v_o.no_votes);

  UPDATE public.guild5_territory_objections
  SET yes_votes=p_yes_votes,
      no_votes=p_no_votes,
      status=CASE WHEN p_yes_votes>=vote_threshold THEN 'PASSED' ELSE 'REJECTED' END,
      decided_at=now(),
      decided_by_user_id=auth.uid()
  WHERE id=v_o.id
  RETURNING * INTO v_o;

  PERFORM public.guild5_write_audit(
    v_closure.id,v_s.version_id,v_class,'TERRITORY_OBJECTION_VOTE_RECORDED',NULL,
    v_before,
    jsonb_build_object('objection_id',v_o.id,'status',v_o.status,'yes_votes',v_o.yes_votes,'no_votes',v_o.no_votes,
      'threshold',v_o.vote_threshold)
  );

  RETURN to_jsonb(v_o);
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_record_guild5_objection_vote(bigint,integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_record_guild5_objection_vote(bigint,integer,integer) TO authenticated;

-- -----------------------------------------------------------------------------
-- 14. 교사 RPC: 이전 점령 기준으로 이번 달 과세 경매에 걸린 세금 환급
--     (예: 8회차 경매에 9월 점령 세율로 즉시 과세된 금액)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_refund_guild5_prior_territory_tax(
  p_version_id bigint,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_row record;
  v_one bigint;
  v_count integer:=0;
  v_assessed bigint:=0;
  v_refund bigint:=0;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();
  v_closure:=public.guild5_require_current_final_version(p_version_id,v_class);

  IF char_length(v_reason)<2 OR char_length(v_reason)>150 THEN
    RAISE EXCEPTION '환급 사유를 2자 이상 150자 이하로 입력해주세요.' USING ERRCODE='P0575';
  END IF;

  IF EXISTS(
    SELECT 1
    FROM public.guild5_territory_tax_assessments a
    JOIN public.guild5_territory_rate_settlements s ON s.conquest_turn_id=a.conquest_turn_id
    JOIN public.guild5_territory_tax_distributions d ON d.settlement_id=s.id
    WHERE a.voided_at IS NULL
      AND a.version_id<>p_version_id
      AND a.auction_id IN (SELECT e.auction_id FROM public.guild5_territory_economy_snapshots e WHERE e.version_id=p_version_id AND e.auction_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION '이미 길드원에게 분배된 세금이 포함되어 있어 자동 환급할 수 없습니다.' USING ERRCODE='P0576';
  END IF;

  FOR v_row IN
    SELECT a.id,a.tax_amount
    FROM public.guild5_territory_tax_assessments a
    WHERE a.voided_at IS NULL
      AND a.classroom_id=v_class
      AND a.version_id<>p_version_id
      AND a.auction_id IN (SELECT e.auction_id FROM public.guild5_territory_economy_snapshots e WHERE e.version_id=p_version_id AND e.auction_id IS NOT NULL)
    ORDER BY a.id
  LOOP
    v_one:=public.guild5_refund_territory_tax_assessment_internal(v_row.id,'[Guild5 영토세 환급] '||v_reason);
    v_count:=v_count+1;
    v_assessed:=v_assessed+v_row.tax_amount;
    v_refund:=v_refund+v_one;
  END LOOP;

  IF v_count=0 THEN
    RAISE EXCEPTION '환급할 이전 점령 세금이 없습니다.' USING ERRCODE='P0577';
  END IF;

  PERFORM public.guild5_write_audit(
    v_closure.id,p_version_id,v_class,'TERRITORY_TAX_PRIOR_REFUND',v_reason,
    '{}'::jsonb,
    jsonb_build_object('voided_assessments',v_count,'assessed_amount',v_assessed,'refunded_amount',v_refund)
  );

  RETURN jsonb_build_object('voided_assessments',v_count,'assessed_amount',v_assessed,'refunded_amount',v_refund);
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_refund_guild5_prior_territory_tax(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_refund_guild5_prior_territory_tax(bigint,text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 15. 교사 RPC: 세율 최종 확정 + 일괄 징수
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_finalize_guild5_territory_rate(p_settlement_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_o public.guild5_territory_objections%ROWTYPE;
  v_final_rate numeric;
  v_surcharge_guild integer:=NULL;
  v_auction_id integer;
  v_auction_round integer;
  v_row record;
  v_one jsonb;
  v_surcharge numeric;
  v_processed integer:=0;
  v_surcharge_count integer:=0;
  v_assessed bigint:=0;
  v_collected bigint:=0;
  v_surcharge_amount bigint:=0;
  v_skipped integer:=0;
  v_summary jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=p_settlement_id AND classroom_id=v_class FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '세율 선언 기록을 찾을 수 없습니다.' USING ERRCODE='P0567';
  END IF;
  v_closure:=public.guild5_require_current_final_version(v_s.version_id,v_class);
  IF v_s.status='FINALIZED' THEN
    RAISE EXCEPTION '이미 세율이 최종 확정된 영토입니다.' USING ERRCODE='P0565';
  END IF;

  SELECT * INTO v_o FROM public.guild5_territory_objections
  WHERE settlement_id=v_s.id AND status<>'WITHDRAWN'
  ORDER BY id DESC LIMIT 1;

  IF v_o.id IS NOT NULL AND v_o.status='FILED' THEN
    RAISE EXCEPTION '이의 제기 투표 결과를 먼저 입력해주세요.' USING ERRCODE='P0578';
  END IF;

  v_final_rate:=CASE WHEN v_o.status='PASSED' THEN v_o.proposed_rate_percent ELSE v_s.declared_rate_percent END;
  IF v_o.status='REJECTED' THEN v_surcharge_guild:=v_o.objector_guild_id; END IF;

  SELECT e.auction_id,e.auction_round_number INTO v_auction_id,v_auction_round
  FROM public.guild5_territory_economy_snapshots e
  WHERE e.version_id=v_s.version_id AND e.slot_no=v_s.territory_slot_no;

  IF v_auction_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.guild5_territory_tax_assessments a
    WHERE a.voided_at IS NULL
      AND a.auction_id=v_auction_id
      AND a.auction_category=v_s.auction_category
      AND a.version_id<>v_s.version_id
  ) THEN
    RAISE EXCEPTION '이 경매(%회차 %)에는 이전 점령 기준으로 걷힌 세금이 남아 있습니다. 먼저 「이전 점령 세금 환급」을 실행해주세요.',
      v_auction_round, v_s.auction_category USING ERRCODE='P0579';
  END IF;

  IF v_auction_id IS NOT NULL THEN
    FOR v_row IN
      SELECT r.id,r.winner_student_id
      FROM public.auction_results r
      JOIN public.auction_items i ON i.id=r.auction_item_id
      JOIN public.transactions tx ON tx.id=r.transaction_id
      WHERE i.auction_id=v_auction_id
        AND i.category=v_s.auction_category
        AND tx.value_token='GOLD'
        AND tx.amount<0
        AND NOT tx.is_reversed
        AND NOT EXISTS(
          SELECT 1 FROM public.guild5_territory_tax_assessments a
          WHERE a.auction_result_id=r.id AND a.voided_at IS NULL
        )
      ORDER BY r.id
    LOOP
      v_surcharge:=CASE WHEN v_surcharge_guild IS NOT NULL AND EXISTS(
        SELECT 1 FROM public.guild5_student_snapshots ss
        WHERE ss.version_id=v_s.version_id AND ss.guild_id=v_surcharge_guild AND ss.student_id=v_row.winner_student_id
      ) THEN 10 ELSE 0 END;

      v_one:=public.guild5_assess_result_with_rate_internal(v_row.id,v_s.id,v_final_rate,v_surcharge);

      IF v_one->>'status'='ASSESSED' THEN
        v_processed:=v_processed+1;
        v_assessed:=v_assessed+coalesce((v_one->>'tax_amount')::bigint,0);
        v_collected:=v_collected+coalesce((v_one->>'collected_amount')::bigint,0);
        IF v_surcharge>0 THEN
          v_surcharge_count:=v_surcharge_count+1;
          v_surcharge_amount:=v_surcharge_amount+coalesce((v_one->>'tax_amount')::bigint,0);
        END IF;
      ELSE
        v_skipped:=v_skipped+1;
      END IF;
    END LOOP;
  END IF;

  UPDATE public.guild5_conquest_turns SET territory_tax_rate_snapshot=v_final_rate WHERE id=v_s.conquest_turn_id;

  v_summary:=jsonb_build_object(
    'auction_id',v_auction_id,
    'auction_round_number',v_auction_round,
    'final_rate_percent',v_final_rate,
    'objection_id',v_o.id,
    'objection_status',v_o.status,
    'surcharge_guild_id',v_surcharge_guild,
    'processed',v_processed,
    'skipped',v_skipped,
    'assessed_amount',v_assessed,
    'collected_at_assessment',v_collected,
    'surcharge_assessment_count',v_surcharge_count,
    'surcharge_assessment_amount',v_surcharge_amount
  );

  UPDATE public.guild5_territory_rate_settlements
  SET status='FINALIZED',
      final_rate_percent=v_final_rate,
      finalized_at=now(),
      finalized_by_user_id=auth.uid(),
      settlement_summary=v_summary,
      updated_at=now()
  WHERE id=v_s.id;

  PERFORM public.guild5_write_audit(
    v_closure.id,v_s.version_id,v_class,'TERRITORY_RATE_FINALIZED',NULL,
    jsonb_build_object('declared_rate_percent',v_s.declared_rate_percent),
    v_summary || jsonb_build_object('settlement_id',v_s.id,'territory',v_s.territory_name_snapshot)
  );

  RETURN v_summary || jsonb_build_object('settlement_id',v_s.id);
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_finalize_guild5_territory_rate(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_guild5_territory_rate(bigint) TO authenticated;

-- -----------------------------------------------------------------------------
-- 16. 교사 RPC: 세수 분배 (나누는 수 = max(길드 인원,5), 나머지는 운영국 회수)
--     미납 상환으로 징수액이 늘면 '새로 걷힌 만큼'만 다시 분배할 수 있다.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_distribute_guild5_territory_tax(
  p_settlement_id bigint,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_year_month text;
  v_collected bigint:=0;
  v_prior bigint:=0;
  v_basis bigint:=0;
  v_roster integer:=0;
  v_divisor integer:=5;
  v_per bigint:=0;
  v_dist_id bigint;
  v_member record;
  v_tx_id bigint;
  v_paid integer:=0;
  v_distributed bigint:=0;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE id=p_settlement_id AND classroom_id=v_class FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '세율 확정 기록을 찾을 수 없습니다.' USING ERRCODE='P0567';
  END IF;
  IF v_s.status<>'FINALIZED' THEN
    RAISE EXCEPTION '세율을 최종 확정해 세금을 걷은 뒤에 분배할 수 있습니다.' USING ERRCODE='P0580';
  END IF;

  SELECT coalesce(sum(CASE WHEN a.arrear_id IS NOT NULL THEN ar.paid_amount ELSE a.collected_amount_at_assessment END),0)::bigint
  INTO v_collected
  FROM public.guild5_territory_tax_assessments a
  LEFT JOIN public.student_asset_arrears ar ON ar.id=a.arrear_id
  WHERE a.conquest_turn_id=v_s.conquest_turn_id AND a.voided_at IS NULL;

  SELECT coalesce(sum(d.basis_amount),0)::bigint INTO v_prior
  FROM public.guild5_territory_tax_distributions d WHERE d.settlement_id=v_s.id;

  v_basis:=v_collected-v_prior;

  SELECT count(*)::integer INTO v_roster
  FROM public.guild5_student_snapshots ss
  WHERE ss.version_id=v_s.version_id AND ss.guild_id=v_s.owner_guild_id;
  IF v_roster<1 THEN
    RAISE EXCEPTION '점령 길드의 마감 당시 길드원 기록이 없습니다.' USING ERRCODE='P0581';
  END IF;
  v_divisor:=greatest(v_roster,5);

  IF v_basis<=0 THEN
    RAISE EXCEPTION '새로 분배할 세수가 없습니다. (징수 %G · 이미 분배 기준 %G)', v_collected, v_prior USING ERRCODE='P0582';
  END IF;
  v_per:=floor(v_basis::numeric/v_divisor)::bigint;
  IF v_per<1 THEN
    RAISE EXCEPTION '분배할 세수(%G)가 너무 적어 1인당 1G 미만입니다.', v_basis USING ERRCODE='P0583';
  END IF;

  SELECT c.year_month INTO v_year_month FROM public.guild5_month_closures c WHERE c.id=v_s.closure_id;

  INSERT INTO public.guild5_territory_tax_distributions(
    settlement_id,classroom_id,version_id,owner_guild_id,basis_amount,roster_count,divisor,per_member_amount,
    note,created_by_user_id
  ) VALUES (
    v_s.id,v_class,v_s.version_id,v_s.owner_guild_id,v_basis,v_roster,v_divisor,v_per,
    nullif(btrim(coalesce(p_note,'')),''),auth.uid()
  )
  RETURNING id INTO v_dist_id;

  FOR v_member IN
    SELECT ss.student_id,ss.student_name_at_close,st.transferred_at
    FROM public.guild5_student_snapshots ss
    JOIN public.students st ON st.id=ss.student_id
    WHERE ss.version_id=v_s.version_id AND ss.guild_id=v_s.owner_guild_id
    ORDER BY ss.student_id
  LOOP
    IF v_member.transferred_at IS NOT NULL THEN
      INSERT INTO public.guild5_territory_tax_distribution_lines(distribution_id,student_id,student_name_snapshot,amount,line_status)
      VALUES (v_dist_id,v_member.student_id,v_member.student_name_at_close,0,'SKIPPED_TRANSFERRED');
      CONTINUE;
    END IF;

    v_tx_id:=public.create_transaction(
      v_member.student_id,
      'GOLD'::public.value_token_type,
      v_per,
      'TEACHER_GRANT'::public.transaction_source_type,
      v_dist_id,
      0,
      format('[Guild5 영토세 분배] %s · %s 점령 %s · 세수 %sG ÷ %s = %sG',
        v_s.territory_name_snapshot,coalesce(v_year_month,''),v_s.owner_guild_name_snapshot,v_basis,v_divisor,v_per)
    );

    INSERT INTO public.guild5_territory_tax_distribution_lines(distribution_id,student_id,student_name_snapshot,amount,transaction_id,line_status)
    VALUES (v_dist_id,v_member.student_id,v_member.student_name_at_close,v_per,v_tx_id,'PAID');

    v_paid:=v_paid+1;
    v_distributed:=v_distributed+v_per;
  END LOOP;

  UPDATE public.guild5_territory_tax_distributions
  SET paid_member_count=v_paid,
      distributed_amount=v_distributed,
      retained_amount=v_basis-v_distributed
  WHERE id=v_dist_id;

  PERFORM public.guild5_write_audit(
    v_s.closure_id,v_s.version_id,v_class,'TERRITORY_TAX_DISTRIBUTED',NULL,
    '{}'::jsonb,
    jsonb_build_object('distribution_id',v_dist_id,'settlement_id',v_s.id,'basis_amount',v_basis,
      'roster_count',v_roster,'divisor',v_divisor,'per_member_amount',v_per,
      'paid_member_count',v_paid,'distributed_amount',v_distributed,'retained_amount',v_basis-v_distributed)
  );

  RETURN jsonb_build_object(
    'distribution_id',v_dist_id,'basis_amount',v_basis,'roster_count',v_roster,'divisor',v_divisor,
    'per_member_amount',v_per,'paid_member_count',v_paid,'distributed_amount',v_distributed,
    'retained_amount',v_basis-v_distributed
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_distribute_guild5_territory_tax(bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_distribute_guild5_territory_tax(bigint,text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 17. 내부 helper: 영토(점령 차례) 1곳의 운영 현황 JSON
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_build_conquest_turn_ops(p_turn_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_s public.guild5_territory_rate_settlements%ROWTYPE;
  v_tax jsonb;
  v_dist jsonb;
  v_objections jsonb;
  v_collected bigint:=0;
  v_distributed_basis bigint:=0;
  v_roster integer:=0;
BEGIN
  SELECT * INTO v_turn FROM public.guild5_conquest_turns WHERE id=p_turn_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_s FROM public.guild5_territory_rate_settlements WHERE conquest_turn_id=v_turn.id;

  SELECT jsonb_build_object(
    'assessment_count',count(a.id) FILTER (WHERE a.voided_at IS NULL),
    'taxpayer_count',count(DISTINCT a.student_id) FILTER (WHERE a.voided_at IS NULL),
    'assessed_amount',coalesce(sum(a.tax_amount) FILTER (WHERE a.voided_at IS NULL),0),
    'collected_amount',coalesce(sum(CASE WHEN a.arrear_id IS NOT NULL THEN ar.paid_amount ELSE a.collected_amount_at_assessment END) FILTER (WHERE a.voided_at IS NULL),0),
    'surcharge_count',count(a.id) FILTER (WHERE a.voided_at IS NULL AND a.objection_surcharge_pp>0),
    'surcharge_assessed_amount',coalesce(sum(a.tax_amount) FILTER (WHERE a.voided_at IS NULL AND a.objection_surcharge_pp>0),0),
    'voided_count',count(a.id) FILTER (WHERE a.voided_at IS NOT NULL),
    'voided_assessed_amount',coalesce(sum(a.tax_amount) FILTER (WHERE a.voided_at IS NOT NULL),0),
    'refunded_amount',coalesce(sum(a.void_refund_amount) FILTER (WHERE a.voided_at IS NOT NULL),0),
    'auction_rounds',coalesce((
      SELECT jsonb_agg(DISTINCT au.round_number ORDER BY au.round_number)
      FROM public.guild5_territory_tax_assessments a2
      JOIN public.auctions au ON au.id=a2.auction_id
      WHERE a2.conquest_turn_id=v_turn.id AND a2.voided_at IS NULL
    ),'[]'::jsonb)
  ) INTO v_tax
  FROM public.guild5_territory_tax_assessments a
  LEFT JOIN public.student_asset_arrears ar ON ar.id=a.arrear_id
  WHERE a.conquest_turn_id=v_turn.id;

  v_collected:=coalesce((v_tax->>'collected_amount')::bigint,0);
  v_tax:=v_tax || jsonb_build_object('outstanding_amount',greatest(coalesce((v_tax->>'assessed_amount')::bigint,0)-v_collected,0));

  SELECT count(*)::integer INTO v_roster
  FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_turn.version_id AND ss.guild_id=v_turn.guild_id;

  IF v_s.id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.id DESC),'[]'::jsonb) INTO v_objections
    FROM public.guild5_territory_objections o WHERE o.settlement_id=v_s.id;

    SELECT coalesce(sum(d.basis_amount),0)::bigint INTO v_distributed_basis
    FROM public.guild5_territory_tax_distributions d WHERE d.settlement_id=v_s.id;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',d.id,'basis_amount',d.basis_amount,'roster_count',d.roster_count,'divisor',d.divisor,
      'per_member_amount',d.per_member_amount,'paid_member_count',d.paid_member_count,
      'distributed_amount',d.distributed_amount,'retained_amount',d.retained_amount,
      'note',d.note,'created_at',d.created_at,
      'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('student_id',l.student_id,'student_name',l.student_name_snapshot,'amount',l.amount,'line_status',l.line_status) ORDER BY l.student_id),'[]'::jsonb)
               FROM public.guild5_territory_tax_distribution_lines l WHERE l.distribution_id=d.id)
    ) ORDER BY d.id),'[]'::jsonb) INTO v_dist
    FROM public.guild5_territory_tax_distributions d WHERE d.settlement_id=v_s.id;
  END IF;

  RETURN jsonb_build_object(
    'turn_id',v_turn.id,
    'version_id',v_turn.version_id,
    'rank_position',v_turn.rank_position,
    'guild_id',v_turn.guild_id,
    'guild_name',(SELECT gs.guild_name_at_close FROM public.guild5_guild_snapshots gs WHERE gs.version_id=v_turn.version_id AND gs.guild_id=v_turn.guild_id),
    'roster_count',v_roster,
    'distribution_divisor',greatest(v_roster,5),
    'turn_status',v_turn.turn_status,
    'assignment_method',v_turn.assignment_method,
    'chosen_at',v_turn.chosen_at,
    'territory_id',v_turn.territory_id,
    'territory_name',v_turn.territory_name_snapshot,
    'slot_no',v_turn.territory_slot_no_snapshot,
    'auction_category',public.guild5_slot_auction_category(v_turn.territory_slot_no_snapshot),
    'rate_snapshot',v_turn.territory_tax_rate_snapshot,
    'settlement',CASE WHEN v_s.id IS NULL THEN NULL ELSE to_jsonb(v_s) END,
    'objections',coalesce(v_objections,'[]'::jsonb),
    'tax',v_tax,
    'distributions',coalesce(v_dist,'[]'::jsonb),
    'distributed_basis',v_distributed_basis,
    'distributable_amount',greatest(v_collected-v_distributed_basis,0)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.guild5_build_conquest_turn_ops(bigint) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 18. 교사 RPC: 이번 달 점령 운영 화면 데이터
--     · 영토별 세율/이의 제기/징수/분배 현황
--     · 길드별 거점 자금(과세 대상 경매에서 길드원이 쓴 GOLD + SUPER PASS)
--     · 이전 점령 기준으로 걸린 세금(환급 필요 여부)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_guild5_conquest_ops(p_year_month text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_season integer;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_version bigint;
  v_finalized boolean:=false;
  v_economy jsonb;
  v_auction_id integer;
  v_guilds jsonb;
  v_spend jsonb;
  v_turns jsonb;
  v_conflicts jsonb;
  v_student_count integer:=0;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);

  SELECT * INTO v_closure FROM public.guild5_month_closures
  WHERE classroom_id=v_class AND season_id=v_season AND year_month=p_year_month;

  v_finalized:=v_closure.id IS NOT NULL AND v_closure.lifecycle_state='FINALIZED' AND v_closure.current_version_id IS NOT NULL;
  v_version:=CASE WHEN v_finalized THEN v_closure.current_version_id ELSE NULL END;

  IF v_version IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'slot_no',e.slot_no,'auction_category',e.auction_category,'auction_id',e.auction_id,
      'auction_round_number',e.auction_round_number,'auction_ended_at',e.auction_ended_at,
      'settled_item_count',e.settled_item_count,'auction_gold_spend',e.auction_gold_spend,
      'super_pass_consumed_count',e.super_pass_consumed_count,'super_pass_equivalent_value',e.super_pass_equivalent_value,
      'gross_spend',e.gross_spend,'territory_name',e.territory_name_snapshot
    ) ORDER BY e.slot_no),'[]'::jsonb) INTO v_economy
    FROM public.guild5_territory_economy_snapshots e WHERE e.version_id=v_version;
  END IF;
  IF v_economy IS NULL OR jsonb_array_length(v_economy)=0 THEN
    v_economy:=public.guild5_build_territory_auction_economy(v_class,v_season);
  END IF;

  SELECT max(nullif(x->>'auction_id','')::integer) INTO v_auction_id
  FROM jsonb_array_elements(v_economy) x;

  -- 길드 명단: FINAL이면 마감 snapshot, 아니면 현재 활성 길드원
  IF v_version IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'guild_id',gs.guild_id,'guild_name',gs.guild_name_at_close,'rank_position',gs.rank_position,
      'roster_count',(SELECT count(*) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_version AND ss.guild_id=gs.guild_id)
    ) ORDER BY gs.rank_position),'[]'::jsonb) INTO v_guilds
    FROM public.guild5_guild_snapshots gs
    WHERE gs.version_id=v_version
      AND EXISTS(SELECT 1 FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_version AND ss.guild_id=gs.guild_id);
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'guild_id',g.id,'guild_name',g.name,'rank_position',NULL,
      'roster_count',(SELECT count(*) FROM public.guild_members m WHERE m.guild_id=g.id AND m.left_at IS NULL)
    ) ORDER BY g.id),'[]'::jsonb) INTO v_guilds
    FROM public.guilds g
    WHERE g.classroom_id=v_class AND g.is_active
      AND EXISTS(SELECT 1 FROM public.guild_members m WHERE m.guild_id=g.id AND m.left_at IS NULL);
  END IF;

  -- 길드별 · 카테고리별 과세 대상 경매 지출 (GOLD 낙찰금 + 실제 소모 SUPER PASS)
  WITH members AS (
    SELECT ss.student_id,ss.guild_id
    FROM public.guild5_student_snapshots ss
    WHERE v_version IS NOT NULL AND ss.version_id=v_version
    UNION ALL
    SELECT m.student_id,m.guild_id
    FROM public.guild_members m
    JOIN public.guilds g ON g.id=m.guild_id
    WHERE v_version IS NULL AND g.classroom_id=v_class AND g.is_active AND m.left_at IS NULL
  ),
  cats(category) AS (VALUES ('1인1역'::text),('자리'::text),('급식순서'::text)),
  res AS (
    SELECT i.category::text AS category,r.winner_student_id,r.final_price::bigint AS final_price
    FROM public.auction_results r
    JOIN public.auction_items i ON i.id=r.auction_item_id
    JOIN public.transactions tx ON tx.id=r.transaction_id
    WHERE i.auction_id=v_auction_id
      AND i.category IN ('1인1역','자리','급식순서')
      AND tx.value_token='GOLD' AND tx.amount<0 AND NOT tx.is_reversed
  ),
  passes AS (
    SELECT i.category::text AS category,e.student_id
    FROM public.auction_super_pass_entries e
    JOIN public.auction_items i ON i.id=e.auction_item_id
    WHERE i.auction_id=v_auction_id
      AND i.category IN ('1인1역','자리','급식순서')
      AND e.status='WINNER_CONSUMED'
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'guild_id',gm.guild_id,
      'auction_category',c.category,
      'gold_spend',coalesce(x.gold_spend,0),
      'item_count',coalesce(x.item_count,0),
      'super_pass_count',coalesce(p.super_pass_count,0),
      'super_pass_unit_value',public.guild5_super_pass_unit_value(c.category)
    ) ORDER BY gm.guild_id,c.category),'[]'::jsonb),
    (SELECT count(*)::integer FROM members)
  INTO v_spend,v_student_count
  FROM (SELECT DISTINCT guild_id FROM members) gm
  CROSS JOIN cats c
  LEFT JOIN LATERAL (
    SELECT sum(res.final_price)::bigint AS gold_spend,count(*)::integer AS item_count
    FROM res JOIN members m ON m.student_id=res.winner_student_id
    WHERE m.guild_id=gm.guild_id AND res.category=c.category
  ) x ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS super_pass_count
    FROM passes JOIN members m ON m.student_id=passes.student_id
    WHERE m.guild_id=gm.guild_id AND passes.category=c.category
  ) p ON true
  WHERE v_auction_id IS NOT NULL;

  IF v_version IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(public.guild5_build_conquest_turn_ops(ct.id) ORDER BY ct.rank_position),'[]'::jsonb) INTO v_turns
    FROM public.guild5_conquest_turns ct WHERE ct.version_id=v_version;

    SELECT coalesce(jsonb_agg(row_to_json(z)::jsonb),'[]'::jsonb) INTO v_conflicts
    FROM (
      SELECT a.version_id AS prior_version_id,
             pc.year_month AS prior_year_month,
             a.territory_slot_no AS slot_no,
             a.territory_name_snapshot AS territory_name,
             a.auction_category,
             au.round_number AS auction_round_number,
             (SELECT gs.guild_name_at_close FROM public.guild5_guild_snapshots gs WHERE gs.version_id=a.version_id AND gs.guild_id=a.owner_guild_id) AS owner_guild_name,
             count(*)::integer AS assessment_count,
             sum(a.tax_amount)::bigint AS assessed_amount,
             sum(CASE WHEN a.arrear_id IS NOT NULL THEN ar.paid_amount ELSE a.collected_amount_at_assessment END)::bigint AS collected_amount
      FROM public.guild5_territory_tax_assessments a
      LEFT JOIN public.student_asset_arrears ar ON ar.id=a.arrear_id
      JOIN public.auctions au ON au.id=a.auction_id
      JOIN public.guild5_month_closures pc ON pc.id=a.closure_id
      WHERE a.voided_at IS NULL
        AND a.version_id<>v_version
        AND a.auction_id IN (SELECT e.auction_id FROM public.guild5_territory_economy_snapshots e WHERE e.version_id=v_version AND e.auction_id IS NOT NULL)
      GROUP BY a.version_id,pc.year_month,a.territory_slot_no,a.territory_name_snapshot,a.auction_category,au.round_number,a.owner_guild_id
      ORDER BY a.territory_slot_no
    ) z;
  END IF;

  RETURN jsonb_build_object(
    'year_month',p_year_month,
    'finalized',v_finalized,
    'closure_id',v_closure.id,
    'version_id',v_version,
    'vote_threshold',14,
    'economy',coalesce(v_economy,'[]'::jsonb),
    'auction_id',v_auction_id,
    'guilds',coalesce(v_guilds,'[]'::jsonb),
    'guild_spend',coalesce(v_spend,'[]'::jsonb),
    'turns',coalesce(v_turns,'[]'::jsonb),
    'prior_tax_conflicts',coalesce(v_conflicts,'[]'::jsonb),
    'student_count',coalesce(v_student_count,0)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_get_guild5_conquest_ops(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_guild5_conquest_ops(text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 19. 교사 RPC: 점령 이력 (FINAL 된 모든 달)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_guild5_conquest_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'year_month' DESC),'[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'year_month',c.year_month,
      'closure_id',c.id,
      'version_id',v.id,
      'version_no',v.version_no,
      'finalized_at',v.finalized_at,
      'conquest_status',v.conquest_status,
      'rankings',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'guild_id',gs.guild_id,'guild_name',gs.guild_name_at_close,'rank_position',gs.rank_position,
          'total_gs',gs.total_gs,'roster_count',gs.roster_count
        ) ORDER BY gs.rank_position),'[]'::jsonb)
        FROM public.guild5_guild_snapshots gs
        WHERE gs.version_id=v.id
          AND EXISTS(SELECT 1 FROM public.guild5_student_snapshots ss WHERE ss.version_id=v.id AND ss.guild_id=gs.guild_id)
      ),
      'economy',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'slot_no',e.slot_no,'auction_category',e.auction_category,'auction_round_number',e.auction_round_number,
          'auction_gold_spend',e.auction_gold_spend,'gross_spend',e.gross_spend
        ) ORDER BY e.slot_no),'[]'::jsonb)
        FROM public.guild5_territory_economy_snapshots e WHERE e.version_id=v.id
      ),
      'territories',(
        SELECT coalesce(jsonb_agg(public.guild5_build_conquest_turn_ops(ct.id) ORDER BY ct.rank_position),'[]'::jsonb)
        FROM public.guild5_conquest_turns ct WHERE ct.version_id=v.id
      )
    ) AS item
    FROM public.guild5_month_closures c
    JOIN public.guild5_closure_versions v ON v.id=c.current_version_id
    WHERE c.classroom_id=v_class
      AND c.lifecycle_state='FINALIZED'
  ) q;

  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public.teacher_get_guild5_conquest_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_guild5_conquest_history() TO authenticated;

COMMIT;
