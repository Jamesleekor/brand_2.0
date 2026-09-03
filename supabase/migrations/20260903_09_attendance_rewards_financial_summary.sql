SET ROLE postgres;

-- ============================================================================
-- B.R.A.N.D 2.0 — Attendance Reward Settings + Lifetime Financial Summary
-- 2026-09-03
--
-- Includes
--   1) Teacher-editable 3/7/14/28 attendance milestone rewards
--   2) Season 1 -> Season 2 tax/donation migration baselines (24 official students)
--   3) Student self financial summary RPC (baseline + new Season 2 transactions)
--
-- Source baseline:
--   BRAND_시즌2_최종_세금_기부_마이그레이션(1).tsv
--   tax total already includes the user's legacy 균형발전 분담금 amounts.
--
-- Future 균형발전 분담금 integration seam:
--   Record future levy payment as a transaction with tax_amount > 0 so this
--   summary automatically includes it. If a dedicated levy ledger is adopted,
--   extend student_get_financial_lifetime_summary() at that phase.
-- ============================================================================

BEGIN;

DO $pre$
DECLARE
  v_count integer;
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.transactions') IS NULL
     OR to_regclass('public.classroom_settings') IS NULL THEN
    RAISE EXCEPTION '[FIN-ATT] required relation missing';
  END IF;
  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.is_classroom_member(integer)') IS NULL
     OR to_regprocedure('public.is_official_participant(integer)') IS NULL THEN
    RAISE EXCEPTION '[FIN-ATT] required auth/official helper missing';
  END IF;

  SELECT count(*) INTO v_count
  FROM public.classroom_settings
  WHERE classroom_id=1 AND setting_key='attendance_streak_rewards';
  IF v_count <> 1 THEN
    RAISE EXCEPTION '[FIN-ATT] classroom 1 attendance_streak_rewards row missing or duplicated';
  END IF;
END;
$pre$;

-- ---------------------------------------------------------------------------
-- 1. Migration baseline SSOT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_financial_migration_baselines (
  student_id integer PRIMARY KEY REFERENCES public.students(id) ON DELETE CASCADE,
  classroom_id integer NOT NULL,
  tax_paid_baseline bigint NOT NULL DEFAULT 0 CHECK (tax_paid_baseline >= 0),
  donation_total_baseline bigint NOT NULL DEFAULT 0 CHECK (donation_total_baseline >= 0),
  cutover_transaction_id bigint NOT NULL DEFAULT 0 CHECK (cutover_transaction_id >= 0),
  source_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_financial_migration_baselines_classroom
  ON public.student_financial_migration_baselines(classroom_id,student_id);

ALTER TABLE public.student_financial_migration_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.student_financial_migration_baselines FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.student_financial_migration_baselines TO service_role;

CREATE TEMP TABLE _brand_financial_seed(
  student_name text PRIMARY KEY,
  tax_paid bigint NOT NULL,
  donation_total bigint NOT NULL
) ON COMMIT DROP;

INSERT INTO _brand_financial_seed(student_name,tax_paid,donation_total) VALUES
('김나연',4002,1690),
('김서영',13315,18996),
('김선율',3494,1),
('김윤우',11458,1811),
('김종현',3530,1201),
('류은우',12470,32161),
('민사랑',7544,4700),
('박서은',3885,0),
('박시우',6488,5274),
('박시현',3961,0),
('부희주',8116,4003),
('우서윤',4302,469),
('이아정',11101,3536),
('이예준',4017,3143),
('이태우',3992,28677),
('이하람',3162,5500),
('이한성',6646,5100),
('이현석',3590,900),
('정민준',7795,19700),
('정우림',4762,5754),
('지담',6733,12767),
('한동준',2425,0),
('한서현',12646,10343),
('이준혁',1954,0);

DO $seed_check$
DECLARE
  v_seed integer;
  v_match integer;
  v_tax bigint;
  v_donation bigint;
BEGIN
  SELECT count(*),sum(tax_paid),sum(donation_total)
    INTO v_seed,v_tax,v_donation
  FROM _brand_financial_seed;
  IF v_seed<>24 OR v_tax<>151388 OR v_donation<>165726 THEN
    RAISE EXCEPTION '[FIN-ATT] embedded TSV checksum mismatch rows=% tax=% donation=%',v_seed,v_tax,v_donation;
  END IF;

  SELECT count(*) INTO v_match
  FROM _brand_financial_seed x
  JOIN public.students s ON s.name=x.student_name
  WHERE s.classroom_id=1
    AND s.transferred_at IS NULL
    AND public.is_official_participant(s.id);
  IF v_match<>24 THEN
    RAISE EXCEPTION '[FIN-ATT] expected 24 official student name matches, got %',v_match;
  END IF;
END;
$seed_check$;

INSERT INTO public.student_financial_migration_baselines(
  student_id,classroom_id,tax_paid_baseline,donation_total_baseline,
  cutover_transaction_id,source_note
)
SELECT
  s.id,
  s.classroom_id,
  x.tax_paid,
  x.donation_total,
  COALESCE((SELECT max(t.id) FROM public.transactions t WHERE t.student_id=s.id),0),
  'BRAND_시즌2_최종_세금_기부_마이그레이션(1).tsv · 2026-09-03'
FROM _brand_financial_seed x
JOIN public.students s ON s.name=x.student_name
WHERE s.classroom_id=1
  AND s.transferred_at IS NULL
  AND public.is_official_participant(s.id)
ON CONFLICT (student_id) DO UPDATE
SET classroom_id=EXCLUDED.classroom_id,
    tax_paid_baseline=EXCLUDED.tax_paid_baseline,
    donation_total_baseline=EXCLUDED.donation_total_baseline,
    source_note=EXCLUDED.source_note,
    updated_at=now();
-- IMPORTANT: on rerun, existing cutover_transaction_id is intentionally preserved.

-- ---------------------------------------------------------------------------
-- 2. Student lifetime financial summary
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_financial_lifetime_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_baseline_tax bigint := 0;
  v_baseline_donation bigint := 0;
  v_cutover_tx_id bigint := 0;
  v_new_tax bigint := 0;
  v_new_donation bigint := 0;
BEGIN
  v_student_id := public.current_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION '학생 로그인이 필요합니다.' USING ERRCODE='PFN10';
  END IF;

  SELECT s.classroom_id INTO v_classroom_id
  FROM public.students s
  WHERE s.id=v_student_id AND s.transferred_at IS NULL;
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '활성 학생 정보를 찾을 수 없습니다.' USING ERRCODE='PFN11';
  END IF;

  SELECT b.tax_paid_baseline,b.donation_total_baseline,b.cutover_transaction_id
    INTO v_baseline_tax,v_baseline_donation,v_cutover_tx_id
  FROM public.student_financial_migration_baselines b
  WHERE b.student_id=v_student_id;

  v_baseline_tax := COALESCE(v_baseline_tax,0);
  v_baseline_donation := COALESCE(v_baseline_donation,0);
  v_cutover_tx_id := COALESCE(v_cutover_tx_id,0);

  SELECT COALESCE(sum(t.tax_amount),0)::bigint
    INTO v_new_tax
  FROM public.transactions t
  WHERE t.student_id=v_student_id
    AND t.id>v_cutover_tx_id
    AND COALESCE(t.is_reversed,false)=false
    AND COALESCE(t.tax_amount,0)>0;

  SELECT COALESCE(sum(abs(t.amount)),0)::bigint
    INTO v_new_donation
  FROM public.transactions t
  WHERE t.student_id=v_student_id
    AND t.id>v_cutover_tx_id
    AND COALESCE(t.is_reversed,false)=false
    AND t.source_type::text='DONATION';

  RETURN jsonb_build_object(
    'student_id',v_student_id,
    'classroom_id',v_classroom_id,
    'tax_paid_total',v_baseline_tax+v_new_tax,
    'donation_total',v_baseline_donation+v_new_donation,
    'baseline_tax_paid',v_baseline_tax,
    'baseline_donation_total',v_baseline_donation,
    'season2_tax_paid',v_new_tax,
    'season2_donation_total',v_new_donation,
    'cutover_transaction_id',v_cutover_tx_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.student_get_financial_lifetime_summary() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.student_get_financial_lifetime_summary() TO authenticated,service_role;

-- ---------------------------------------------------------------------------
-- 3. Teacher attendance milestone reward settings
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_attendance_reward_settings(p_classroom_id integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_setting jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '학급 접근 권한이 없습니다.' USING ERRCODE='PFN20';
  END IF;

  SELECT cs.setting_value INTO v_setting
  FROM public.classroom_settings cs
  WHERE cs.classroom_id=p_classroom_id
    AND cs.setting_key='attendance_streak_rewards';

  IF v_setting IS NULL THEN
    RAISE EXCEPTION '출석 마일스톤 설정을 찾을 수 없습니다.' USING ERRCODE='PFN21';
  END IF;

  RETURN jsonb_build_object(
    '3',jsonb_build_object('gold',COALESCE((v_setting->'3'->>'gold')::bigint,0),'bv',COALESCE((v_setting->'3'->>'bv')::bigint,0),'crystal',COALESCE((v_setting->'3'->>'crystal')::bigint,0)),
    '7',jsonb_build_object('gold',COALESCE((v_setting->'7'->>'gold')::bigint,0),'bv',COALESCE((v_setting->'7'->>'bv')::bigint,0),'crystal',COALESCE((v_setting->'7'->>'crystal')::bigint,0)),
    '14',jsonb_build_object('gold',COALESCE((v_setting->'14'->>'gold')::bigint,0),'bv',COALESCE((v_setting->'14'->>'bv')::bigint,0),'crystal',COALESCE((v_setting->'14'->>'crystal')::bigint,0)),
    '28',jsonb_build_object('gold',COALESCE((v_setting->'28'->>'gold')::bigint,0),'bv',COALESCE((v_setting->'28'->>'bv')::bigint,0),'crystal',COALESCE((v_setting->'28'->>'crystal')::bigint,0))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_update_attendance_reward_settings(
  p_classroom_id integer,
  p_rewards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_day text;
  v_token text;
  v_reward jsonb;
  v_value bigint;
  v_normalized jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION '학급 접근 권한이 없습니다.' USING ERRCODE='PFN20';
  END IF;
  IF jsonb_typeof(p_rewards) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '보상 설정 형식이 올바르지 않습니다.' USING ERRCODE='PFN22';
  END IF;

  FOR v_day IN SELECT unnest(ARRAY['3','7','14','28']) LOOP
    v_reward := p_rewards->v_day;
    IF v_reward IS NULL OR jsonb_typeof(v_reward) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION '%일 보상 설정이 없습니다.',v_day USING ERRCODE='PFN22';
    END IF;

    -- unknown token keys are rejected to prevent configuration typos.
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_reward) AS x(key)
      WHERE x.key NOT IN ('gold','bv','crystal')
    ) THEN
      RAISE EXCEPTION '%일 보상에 허용되지 않은 재화 키가 있습니다.',v_day USING ERRCODE='PFN22';
    END IF;

    v_normalized := jsonb_set(v_normalized,ARRAY[v_day],'{}'::jsonb,true);
    FOREACH v_token IN ARRAY ARRAY['gold','bv','crystal'] LOOP
      IF v_reward ? v_token THEN
        IF jsonb_typeof(v_reward->v_token) <> 'number' THEN
          RAISE EXCEPTION '%일 % 보상은 숫자여야 합니다.',v_day,v_token USING ERRCODE='PFN23';
        END IF;
        v_value := (v_reward->>v_token)::bigint;
      ELSE
        v_value := 0;
      END IF;
      IF v_value<0 OR v_value>1000000 THEN
        RAISE EXCEPTION '%일 % 보상은 0~1,000,000 범위여야 합니다.',v_day,v_token USING ERRCODE='PFN24';
      END IF;
      v_normalized := jsonb_set(v_normalized,ARRAY[v_day,v_token],to_jsonb(v_value),true);
    END LOOP;
  END LOOP;

  -- Milestone days stay fixed at 3/7/14/28; only amounts are editable.
  UPDATE public.classroom_settings
  SET setting_value=v_normalized
  WHERE classroom_id=p_classroom_id
    AND setting_key='attendance_streak_rewards';
  IF NOT FOUND THEN
    RAISE EXCEPTION '출석 마일스톤 설정을 찾을 수 없습니다.' USING ERRCODE='PFN21';
  END IF;

  RETURN v_normalized;
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_get_attendance_reward_settings(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_update_attendance_reward_settings(integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_attendance_reward_settings(integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_update_attendance_reward_settings(integer,jsonb) TO authenticated,service_role;

COMMIT;
RESET ROLE;
