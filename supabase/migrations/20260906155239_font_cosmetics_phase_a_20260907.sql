-- B.R.A.N.D. 2.0 — Font cosmetics phase A
-- Mirrors the migration already applied to production.
-- Adds self-scoped cosmetic RPCs + 27 staged font catalog rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.student_purchase_cosmetic(
  p_item_id integer,
  p_pricing_id integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_item public.cosmetic_items%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PFC01';
  END IF;

  v_student_id := public.current_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION '학생 계정을 확인할 수 없습니다.' USING ERRCODE = 'PFC02';
  END IF;

  SELECT s.classroom_id
  INTO v_classroom_id
  FROM public.students s
  WHERE s.id = v_student_id
    AND s.user_id = auth.uid()
    AND s.transferred_at IS NULL;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '현재 재학 중인 학생 계정을 확인할 수 없습니다.' USING ERRCODE = 'PFC05';
  END IF;

  SELECT *
  INTO v_item
  FROM public.cosmetic_items ci
  WHERE ci.id = p_item_id
    AND ci.is_active = true;

  IF v_item.id IS NULL THEN
    RAISE EXCEPTION '활성 꾸미기 아이템이 아닙니다.' USING ERRCODE = 'PFC03';
  END IF;

  IF v_item.classroom_id IS NOT NULL AND v_item.classroom_id <> v_classroom_id THEN
    RAISE EXCEPTION '다른 학급 아이템은 구매할 수 없습니다.' USING ERRCODE = 'PFC04';
  END IF;

  RETURN public.purchase_cosmetic_item(v_student_id, p_item_id, p_pricing_id);
END;
$$;

REVOKE ALL ON FUNCTION public.student_purchase_cosmetic(integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_purchase_cosmetic(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_purchase_cosmetic(integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.student_set_cosmetic_selection(
  p_category text,
  p_ownership_id bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_actual_category text;
  v_item_classroom_id integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PFC11';
  END IF;

  v_student_id := public.current_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION '학생 계정을 확인할 수 없습니다.' USING ERRCODE = 'PFC12';
  END IF;

  SELECT s.classroom_id
  INTO v_classroom_id
  FROM public.students s
  WHERE s.id = v_student_id
    AND s.user_id = auth.uid()
    AND s.transferred_at IS NULL;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '현재 재학 중인 학생 계정을 확인할 수 없습니다.' USING ERRCODE = 'PFC17';
  END IF;

  p_category := lower(btrim(coalesce(p_category, '')));
  IF p_category = '' OR length(p_category) > 50 THEN
    RAISE EXCEPTION '유효한 카테고리가 필요합니다.' USING ERRCODE = 'PFC13';
  END IF;

  PERFORM pg_advisory_xact_lock(v_student_id, hashtext(p_category));

  IF p_ownership_id IS NOT NULL THEN
    SELECT lower(ci.category), ci.classroom_id
    INTO v_actual_category, v_item_classroom_id
    FROM public.student_cosmetic_ownerships sco
    JOIN public.cosmetic_items ci ON ci.id = sco.item_id
    WHERE sco.id = p_ownership_id
      AND sco.student_id = v_student_id
      AND ci.is_active = true;

    IF v_actual_category IS NULL THEN
      RAISE EXCEPTION '보유하지 않은 꾸미기 아이템입니다.' USING ERRCODE = 'PFC14';
    END IF;
    IF v_actual_category <> p_category THEN
      RAISE EXCEPTION '카테고리가 일치하지 않습니다.' USING ERRCODE = 'PFC15';
    END IF;
    IF v_item_classroom_id IS NOT NULL AND v_item_classroom_id <> v_classroom_id THEN
      RAISE EXCEPTION '현재 학급에서 사용할 수 없는 꾸미기 아이템입니다.' USING ERRCODE = 'PFC16';
    END IF;
  END IF;

  UPDATE public.student_cosmetic_ownerships sco
  SET is_equipped = false
  FROM public.cosmetic_items ci
  WHERE sco.item_id = ci.id
    AND sco.student_id = v_student_id
    AND lower(ci.category) = p_category
    AND sco.is_equipped = true;

  IF p_ownership_id IS NOT NULL THEN
    UPDATE public.student_cosmetic_ownerships
    SET is_equipped = true
    WHERE id = p_ownership_id
      AND student_id = v_student_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.student_set_cosmetic_selection(text, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_set_cosmetic_selection(text, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.student_set_cosmetic_selection(text, bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.student_get_my_fonts()
RETURNS TABLE (
  ownership_id bigint,
  item_id integer,
  item_uid varchar,
  name varchar,
  is_equipped boolean
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'PFC21';
  END IF;

  v_student_id := public.current_student_id();
  IF v_student_id IS NULL THEN
    RAISE EXCEPTION '학생 계정을 확인할 수 없습니다.' USING ERRCODE = 'PFC22';
  END IF;

  RETURN QUERY
  SELECT
    sco.id,
    ci.id,
    ci.item_uid,
    ci.name,
    sco.is_equipped
  FROM public.student_cosmetic_ownerships sco
  JOIN public.cosmetic_items ci ON ci.id = sco.item_id
  WHERE sco.student_id = v_student_id
    AND lower(ci.category) = 'font'
    AND ci.is_active = true
  ORDER BY sco.purchased_at DESC, sco.id DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.student_get_my_fonts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_get_my_fonts() FROM anon;
GRANT EXECUTE ON FUNCTION public.student_get_my_fonts() TO authenticated;

INSERT INTO public.cosmetic_items
  (item_uid, classroom_id, category, name, description, resource_url, is_active)
VALUES
  ('FONT_CHOSUN100', NULL, 'font', '조선100년체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:chosun-centennial', false),
  ('FONT_CHOSUNKM', NULL, 'font', '조선굵은명조', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:chosun-km', false),
  ('FONT_CHOSUNLO', NULL, 'font', '조선로고체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:chosun-lo', false),
  ('FONT_CHOSUNNM', NULL, 'font', '조선일보명조', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:chosun-nm', false),
  ('FONT_DALSEO_D', NULL, 'font', '달서달링체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:dalseo-darling', false),
  ('FONT_DALSEO_H', NULL, 'font', '달서힐링체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:dalseo-healing', false),
  ('FONT_DANJO', NULL, 'font', '단조 Bold', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:danjo-bold', false),
  ('FONT_DNF_BITBIT', NULL, 'font', '던파 비트비트체 v2', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:dnf-bitbit-v2', false),
  ('FONT_FUNFLOW', NULL, 'font', '펀플로 생존자', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:funflow-survivor', false),
  ('FONT_GHANA', NULL, 'font', '가나초콜릿', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:ghana-chocolate', false),
  ('FONT_MONGTORI', NULL, 'font', '그리운 몽토리체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:griun-mongtori', false),
  ('FONT_HEIRLIGHT', NULL, 'font', '빛의 계승자', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:heir-of-light', false),
  ('FONT_KOPUB_B', NULL, 'font', 'KoPub 바탕체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:kopub-batang', false),
  ('FONT_KOPUB_D', NULL, 'font', 'KoPub 돋움체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:kopub-dotum', false),
  ('FONT_LAUNDRY', NULL, 'font', '런드리고딕', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:laundry-gothic', false),
  ('FONT_MAPLE', NULL, 'font', '메이플스토리', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:maplestory', false),
  ('FONT_NXFOOTBALL', NULL, 'font', '넥슨 풋볼고딕', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:nexon-football', false),
  ('FONT_NXLV1', NULL, 'font', '넥슨 Lv1 고딕', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:nexon-lv1', false),
  ('FONT_ONE_MOBILE', NULL, 'font', 'ONE 모바일고딕', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:one-mobile', false),
  ('FONT_PINKFONG', NULL, 'font', '핑크퐁 아기상어', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:pinkfong-babyshark', false),
  ('FONT_RIDI', NULL, 'font', '리디바탕', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:ridi-batang', false),
  ('FONT_SHILLA', NULL, 'font', '신라문화체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:shilla-culture', false),
  ('FONT_TWAY_FLY', NULL, 'font', '티웨이 날다', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:tway-fly', false),
  ('FONT_TWAY_SKY', NULL, 'font', '티웨이 하늘', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:tway-sky', false),
  ('FONT_WARHAVEN', NULL, 'font', '워헤이븐', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:warhaven', false),
  ('FONT_YPAIRING', NULL, 'font', 'Y페어링체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:y-pairing', false),
  ('FONT_YES24', NULL, 'font', '예스체', '폰트 꾸미기 아이템 — 라이선스/가격 검토 후 활성화', 'font:yes24', false)
ON CONFLICT (item_uid) DO UPDATE
SET category = EXCLUDED.category,
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    resource_url = EXCLUDED.resource_url,
    is_active = false,
    updated_at = now();

COMMIT;
