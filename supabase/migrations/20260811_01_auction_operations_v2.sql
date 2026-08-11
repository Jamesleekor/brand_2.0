-- ============================================================================
-- B.R.A.N.D 2.0 — Auction Operations v2
-- 2026-08-11
-- * completed round reset/recreate with GOLD reversal
-- * round history RPCs
-- * persistent item presets + bulk add
-- ============================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.auction_item_presets (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL,
  category text NOT NULL,
  item_name text NOT NULL,
  description text,
  emoji varchar(16) NOT NULL DEFAULT '🎁',
  image_url text,
  default_starting_price integer NOT NULL DEFAULT 100 CHECK (default_starting_price > 0),
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auction_item_presets_category_check CHECK (category IN ('자리','1인1역','급식순서','특별경매','기타')),
  CONSTRAINT auction_item_presets_unique_name UNIQUE (classroom_id, category, item_name)
);

ALTER TABLE public.auction_item_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auction_item_presets_same_class_read ON public.auction_item_presets;
CREATE POLICY auction_item_presets_same_class_read ON public.auction_item_presets
FOR SELECT TO authenticated
USING (classroom_id = public.current_classroom_id());

REVOKE ALL ON TABLE public.auction_item_presets FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.auction_item_presets TO authenticated, service_role;
GRANT ALL ON TABLE public.auction_item_presets TO service_role;

CREATE OR REPLACE FUNCTION public.teacher_create_or_reset_live_auction(
  p_classroom_id integer,
  p_round_number integer,
  p_school_year integer,
  p_scheduled_date date,
  p_initial_duration_seconds integer DEFAULT 30,
  p_extension_seconds integer DEFAULT 15,
  p_reset_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_existing public.auctions%ROWTYPE;
  v_id integer;
  v_result record;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 경매만 만들 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;
  IF p_round_number IS NULL OR p_round_number NOT BETWEEN 1 AND 99 THEN
    RAISE EXCEPTION '경매 회차는 1~99 사이여야 합니다.' USING ERRCODE = 'P0704';
  END IF;
  IF p_school_year IS NULL OR p_school_year NOT BETWEEN 2020 AND 2100 THEN
    RAISE EXCEPTION '학년도가 올바르지 않습니다.' USING ERRCODE = 'P0705';
  END IF;
  IF p_initial_duration_seconds NOT BETWEEN 10 AND 300 OR p_extension_seconds NOT BETWEEN 5 AND 60 THEN
    RAISE EXCEPTION '타이머 설정 범위가 올바르지 않습니다.' USING ERRCODE = 'P0706';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.auctions
    WHERE classroom_id = p_classroom_id AND status IN ('SCHEDULED','IN_PROGRESS')
  ) THEN
    RAISE EXCEPTION '이미 준비 중이거나 진행 중인 경매가 있습니다. 먼저 해당 경매를 종료하거나 삭제해주세요.' USING ERRCODE = 'P0707';
  END IF;

  SELECT * INTO v_existing
  FROM public.auctions
  WHERE classroom_id = p_classroom_id
    AND school_year = p_school_year
    AND round_number = p_round_number
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_existing.id IS NOT NULL AND NOT p_reset_existing THEN
    RETURN jsonb_build_object(
      'status','EXISTS',
      'existing_auction_id',v_existing.id,
      'round_number',v_existing.round_number,
      'school_year',v_existing.school_year,
      'ended_at',v_existing.ended_at
    );
  END IF;

  IF v_existing.id IS NOT NULL AND p_reset_existing THEN
    -- 기존 낙찰 결제를 먼저 정확히 환급한다. 거래 기록은 감사 추적을 위해 삭제하지 않는다.
    FOR v_result IN
      SELECT r.transaction_id
      FROM public.auction_results r
      JOIN public.auction_items i ON i.id = r.auction_item_id
      WHERE i.auction_id = v_existing.id
        AND r.transaction_id IS NOT NULL
    LOOP
      IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = v_result.transaction_id AND NOT t.is_reversed) THEN
        PERFORM public.reverse_transaction(v_result.transaction_id, format('경매 %s회차 초기화', p_round_number));
      END IF;
    END LOOP;

    DELETE FROM public.global_alerts
      WHERE related_source_type = 'AUCTION' AND related_source_id = v_existing.id;
    -- 순환/역참조 FK를 먼저 끊은 뒤 상세 기록을 제거한다.
    UPDATE public.auctions SET current_item_id = NULL WHERE id = v_existing.id;
    UPDATE public.auction_items SET current_bid_id = NULL WHERE auction_id = v_existing.id;
    DELETE FROM public.auction_event_logs WHERE auction_id = v_existing.id;
    DELETE FROM public.auction_failures WHERE auction_item_id IN (SELECT id FROM public.auction_items WHERE auction_id = v_existing.id);
    DELETE FROM public.auction_results WHERE auction_item_id IN (SELECT id FROM public.auction_items WHERE auction_id = v_existing.id);
    DELETE FROM public.auction_bids WHERE auction_item_id IN (SELECT id FROM public.auction_items WHERE auction_id = v_existing.id);
    DELETE FROM public.auction_items WHERE auction_id = v_existing.id;
    DELETE FROM public.auctions WHERE id = v_existing.id;
  END IF;

  INSERT INTO public.auctions(
    classroom_id, round_number, school_year, scheduled_date,
    status, created_by, initial_duration_seconds, extension_seconds
  ) VALUES (
    p_classroom_id, p_round_number, p_school_year, p_scheduled_date,
    'SCHEDULED', auth.uid(), p_initial_duration_seconds, p_extension_seconds
  ) RETURNING id INTO v_id;

  PERFORM public._auction_log_event(
    p_classroom_id, v_id, NULL,
    CASE WHEN v_existing.id IS NULL THEN 'AUCTION_CREATED' ELSE 'AUCTION_RESET_CREATED' END,
    jsonb_build_object('round_number',p_round_number,'school_year',p_school_year,'reset_previous',v_existing.id IS NOT NULL)
  );

  RETURN jsonb_build_object('status', CASE WHEN v_existing.id IS NULL THEN 'CREATED' ELSE 'RESET' END, 'auction_id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_auction_history(p_classroom_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 경매만 조회할 수 있습니다.' USING ERRCODE='P0702';
  END IF;
  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.school_year DESC, x.round_number DESC), '[]'::jsonb)
  INTO v_out
  FROM (
    SELECT a.id, a.round_number, a.school_year, a.scheduled_date, a.started_at, a.ended_at,
      count(i.id)::int AS item_count,
      count(i.id) FILTER (WHERE i.final_status='SOLD')::int AS sold_count,
      count(i.id) FILTER (WHERE i.final_status='FAILED_FINAL')::int AS failed_count,
      coalesce(sum(r.final_price),0)::bigint AS total_sales
    FROM public.auctions a
    LEFT JOIN public.auction_items i ON i.auction_id=a.id
    LEFT JOIN public.auction_results r ON r.auction_item_id=i.id
    WHERE a.classroom_id=p_classroom_id AND a.status='COMPLETED'
    GROUP BY a.id
  ) x;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_auction_history_detail(p_auction_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_a public.auctions%ROWTYPE; v_items jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v_a FROM public.auctions WHERE id=p_auction_id;
  IF v_a.id IS NULL OR v_a.classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 경매만 조회할 수 있습니다.' USING ERRCODE='P0702';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'item_name',i.item_name,'category',i.category,'emoji',i.emoji,
      'final_status',i.final_status,'final_price',r.final_price,
      'winner_student_id',r.winner_student_id,'winner_name',s.name,'winner_brand_name',s.brand_name,
      'confirmed_at',r.confirmed_at
    ) ORDER BY i.display_order, i.id),'[]'::jsonb)
  INTO v_items
  FROM public.auction_items i
  LEFT JOIN public.auction_results r ON r.auction_item_id=i.id
  LEFT JOIN public.students s ON s.id=r.winner_student_id
  WHERE i.auction_id=p_auction_id;
  RETURN jsonb_build_object(
    'auction', jsonb_build_object('id',v_a.id,'round_number',v_a.round_number,'school_year',v_a.school_year,'scheduled_date',v_a.scheduled_date,'started_at',v_a.started_at,'ended_at',v_a.ended_at),
    'items', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_auction_item_presets(p_classroom_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_out jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '담당 학급만 조회할 수 있습니다.' USING ERRCODE='P0702'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'category',category,'item_name',item_name,'description',description,'emoji',emoji,'image_url',image_url,
    'default_starting_price',default_starting_price,'sort_order',sort_order
  ) ORDER BY category,sort_order,item_name),'[]'::jsonb)
  INTO v_out FROM public.auction_item_presets WHERE classroom_id=p_classroom_id AND is_active=true;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_save_auction_item_preset(
  p_classroom_id integer, p_category text, p_item_name text, p_description text DEFAULT NULL,
  p_emoji text DEFAULT '🎁', p_image_url text DEFAULT NULL, p_default_starting_price integer DEFAULT 100
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '담당 학급만 수정할 수 있습니다.' USING ERRCODE='P0702'; END IF;
  p_item_name:=btrim(coalesce(p_item_name,'')); p_category:=btrim(coalesce(p_category,''));
  IF p_category NOT IN ('자리','1인1역','급식순서','특별경매','기타') THEN RAISE EXCEPTION '허용되지 않은 카테고리입니다.'; END IF;
  IF p_item_name='' OR char_length(p_item_name)>100 THEN RAISE EXCEPTION '상품명을 확인해주세요.'; END IF;
  IF p_default_starting_price<1 OR p_default_starting_price>10000000 THEN RAISE EXCEPTION '시작가를 확인해주세요.'; END IF;
  INSERT INTO public.auction_item_presets(classroom_id,category,item_name,description,emoji,image_url,default_starting_price,is_active,updated_at)
  VALUES(p_classroom_id,p_category,p_item_name,nullif(btrim(coalesce(p_description,'')),''),coalesce(nullif(btrim(p_emoji),''),'🎁'),nullif(btrim(coalesce(p_image_url,'')),''),p_default_starting_price,true,now())
  ON CONFLICT(classroom_id,category,item_name) DO UPDATE SET description=excluded.description,emoji=excluded.emoji,image_url=excluded.image_url,default_starting_price=excluded.default_starting_price,is_active=true,updated_at=now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_delete_auction_item_preset(p_preset_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.ensure_teacher_role();
  UPDATE public.auction_item_presets SET is_active=false,updated_at=now()
  WHERE id=p_preset_id AND classroom_id=public.current_classroom_id();
  IF NOT FOUND THEN RAISE EXCEPTION '프리셋을 찾을 수 없습니다.'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_bulk_add_live_auction_items(p_auction_id integer, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE v_a public.auctions%ROWTYPE; v jsonb; v_order integer; v_added integer:=0; v_skipped integer:=0; v_name text; v_cat text; v_price integer;
BEGIN
  v_a:=public._auction_assert_teacher_for_auction(p_auction_id);
  IF v_a.status<>'SCHEDULED' THEN RAISE EXCEPTION '상품 일괄 추가는 경매 시작 전에만 가능합니다.'; END IF;
  IF jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>100 THEN RAISE EXCEPTION '1~100개의 상품을 입력해주세요.'; END IF;
  SELECT coalesce(max(display_order),0) INTO v_order FROM public.auction_items WHERE auction_id=p_auction_id;
  FOR v IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_name:=btrim(coalesce(v->>'item_name','')); v_cat:=btrim(coalesce(v->>'category','기타')); v_price:=coalesce((v->>'starting_price')::integer,100);
    IF v_name='' OR v_cat NOT IN ('자리','1인1역','급식순서','특별경매','기타') OR v_price<1 OR v_price>10000000 THEN RAISE EXCEPTION '잘못된 상품 데이터: %',v; END IF;
    IF EXISTS(SELECT 1 FROM public.auction_items WHERE auction_id=p_auction_id AND category=v_cat AND item_name=v_name) THEN v_skipped:=v_skipped+1; CONTINUE; END IF;
    v_order:=v_order+1;
    INSERT INTO public.auction_items(auction_id,item_name,description,category,emoji,image_url,starting_price,current_price,display_order,current_attempt)
    VALUES(p_auction_id,v_name,nullif(btrim(coalesce(v->>'description','')),''),v_cat,coalesce(nullif(btrim(coalesce(v->>'emoji','')),''),'🎁'),nullif(btrim(coalesce(v->>'image_url','')),''),v_price,v_price,v_order,1);
    v_added:=v_added+1;
  END LOOP;
  UPDATE public.auctions SET state_version=state_version+1 WHERE id=p_auction_id;
  RETURN jsonb_build_object('added',v_added,'skipped',v_skipped);
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_create_or_reset_live_auction(integer,integer,integer,date,integer,integer,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_auction_history(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_auction_history_detail(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_get_auction_item_presets(integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_save_auction_item_preset(integer,text,text,text,text,text,integer) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_delete_auction_item_preset(bigint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.teacher_bulk_add_live_auction_items(integer,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_create_or_reset_live_auction(integer,integer,integer,date,integer,integer,boolean) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_auction_history(integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_auction_history_detail(integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_get_auction_item_presets(integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_save_auction_item_preset(integer,text,text,text,text,text,integer) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_delete_auction_item_preset(bigint) TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.teacher_bulk_add_live_auction_items(integer,jsonb) TO authenticated,service_role;

DO $$ BEGIN PERFORM pg_notify('pgrst','reload schema'); END $$;
COMMIT;
