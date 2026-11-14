-- B.R.A.N.D. 2.0 / 2026-11-14
-- Keeps teacher_get_economy_history's existing RPC signature and defaults.
-- p_kind accepts e.g. ALL:BV or PURCHASE:GOLD; filter runs before LIMIT/OFFSET.
-- The EXPE-006 application INSERT guard continues to require a live Lv.3 effect.
-- Approved linked applications rely on their trusted, immutable-at-insert snapshot.
-- This migration does not approve or grant any application.

CREATE OR REPLACE FUNCTION public.teacher_get_economy_history(p_classroom_id integer, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_student_id integer DEFAULT NULL::integer, p_kind text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 250));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_kind_input text := upper(coalesce(nullif(btrim(p_kind), ''), 'ALL'));
  v_kind text := split_part(v_kind_input, ':', 1);
  v_value_token text := nullif(split_part(v_kind_input, ':', 2), '');
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
  v_rows jsonb;
  v_total bigint;
  v_students jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '담당 학급의 히스토리만 조회할 수 있습니다.' USING ERRCODE = 'P0902';
  END IF;
  IF v_kind_input !~ '^(ALL|ASSET|PURCHASE|SALE|USE|INVENTORY)(:(BV|GOLD|CRYSTAL))?$' THEN
    RAISE EXCEPTION '지원하지 않는 히스토리 필터입니다: %', v_kind USING ERRCODE = 'P0903';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'brand_name', s.brand_name
  ) ORDER BY s.name), '[]'::jsonb)
    INTO v_students
    FROM public.students s
   WHERE s.classroom_id = p_classroom_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD');

  WITH unified AS (
    -- Every asset transaction. If it originated from PURCHASE/SALE, attach the
    -- matching inventory event so teacher sees item + quantity without a duplicate row.
    SELECT
      'TX:' || t.id::text AS event_key,
      t.created_at AS occurred_at, coalesce(t.recorded_at,t.created_at) AS recorded_at,
      t.student_id,
      s.name AS student_name,
      s.brand_name,
      CASE
        WHEN ie.event_type = 'PURCHASE' THEN 'PURCHASE'
        WHEN ie.event_type = 'SALE' THEN 'SALE'
        ELSE 'ASSET'
      END AS kind,
      coalesce(ie.event_type, 'ASSET') AS raw_event_type,
      t.value_token::text AS value_token,
      t.amount::bigint AS asset_delta,
      t.balance_after::bigint AS balance_after,
      t.tax_amount::bigint AS tax_amount,
      t.source_type::text AS source_type,
      t.memo,
      t.is_reversed,
      t.id::bigint AS transaction_id,
      ie.id::bigint AS inventory_event_id,
      ie.item_id::bigint AS item_id,
      mi.name AS item_name,
      coalesce(abs(ie.quantity_delta), 0)::integer AS quantity,
      coalesce(ie.quantity_delta, 0)::integer AS quantity_delta,
      ie.metadata AS metadata
    FROM public.transactions t
    JOIN public.students s ON s.id = t.student_id
    LEFT JOIN LATERAL (
      SELECT e.*
        FROM public.inventory_events e
       WHERE e.wallet_transaction_id = t.id
       ORDER BY e.id
       LIMIT 1
    ) ie ON true
    LEFT JOIN public.market_items mi ON mi.id = ie.item_id
    WHERE t.classroom_id = p_classroom_id

    UNION ALL

    -- Final inventory movements that do not have a wallet transaction.
    -- RESERVE/RELEASE are deliberately excluded: they are temporary locks, not
    -- a final ownership change. CONSUME_RESERVED is a real use (e.g. SUPER PASS).
    SELECT
      'INV:' || e.id::text AS event_key,
      e.created_at AS occurred_at, e.created_at AS recorded_at,
      e.student_id,
      s.name AS student_name,
      s.brand_name,
      CASE
        WHEN e.event_type IN ('USE','CONSUME_RESERVED') THEN 'USE'
        ELSE 'INVENTORY'
      END AS kind,
      e.event_type AS raw_event_type,
      NULL::text AS value_token,
      0::bigint AS asset_delta,
      NULL::bigint AS balance_after,
      0::bigint AS tax_amount,
      'INVENTORY_' || e.event_type AS source_type,
      CASE
        WHEN e.event_type = 'USE' THEN '[아이템 사용] ' || mi.name || ' ×' || abs(e.quantity_delta)::text
        WHEN e.event_type = 'CONSUME_RESERVED' THEN '[예약 아이템 사용] ' || mi.name || ' ×' || abs(e.quantity_delta)::text
        WHEN e.event_type = 'TEACHER_GRANT' THEN '[아이템 지급] ' || mi.name || ' ×' || abs(e.quantity_delta)::text
        WHEN e.event_type = 'TEACHER_REVOKE' THEN '[아이템 회수] ' || mi.name || ' ×' || abs(e.quantity_delta)::text
        ELSE '[' || e.event_type || '] ' || mi.name || ' ×' || abs(e.quantity_delta)::text
      END AS memo,
      false AS is_reversed,
      NULL::bigint AS transaction_id,
      e.id::bigint AS inventory_event_id,
      e.item_id::bigint AS item_id,
      mi.name AS item_name,
      abs(e.quantity_delta)::integer AS quantity,
      e.quantity_delta::integer AS quantity_delta,
      e.metadata
    FROM public.inventory_events e
    JOIN public.students s ON s.id = e.student_id
    JOIN public.market_items mi ON mi.id = e.item_id
    WHERE e.classroom_id = p_classroom_id
      AND e.wallet_transaction_id IS NULL
      AND e.event_type IN (
        'USE','CONSUME_RESERVED','TEACHER_GRANT','TEACHER_REVOKE',
        'EXPIRE','CORRECTION','MIGRATION'
      )
  ), filtered AS (
    SELECT u.*
      FROM unified u
     WHERE (p_student_id IS NULL OR u.student_id = p_student_id)
       AND (v_kind = 'ALL' OR u.kind = v_kind)
       AND (v_value_token IS NULL OR u.value_token = v_value_token)
       AND (p_date_from IS NULL OR (u.occurred_at AT TIME ZONE 'Asia/Seoul')::date >= p_date_from)
       AND (p_date_to IS NULL OR (u.occurred_at AT TIME ZONE 'Asia/Seoul')::date <= p_date_to)
       AND (
         v_search IS NULL
         OR lower(coalesce(u.student_name,'')) LIKE '%' || v_search || '%'
         OR lower(coalesce(u.brand_name,'')) LIKE '%' || v_search || '%'
         OR lower(coalesce(u.item_name,'')) LIKE '%' || v_search || '%'
         OR lower(coalesce(u.memo,'')) LIKE '%' || v_search || '%'
         OR lower(coalesce(u.source_type,'')) LIKE '%' || v_search || '%'
       )
  ), page AS (
    SELECT f.*, count(*) OVER() AS total_count
      FROM filtered f
     ORDER BY f.occurred_at DESC, f.event_key DESC
     LIMIT v_limit OFFSET v_offset
  )
  SELECT
    coalesce(jsonb_agg(to_jsonb(page) - 'total_count' ORDER BY occurred_at DESC, event_key DESC), '[]'::jsonb),
    coalesce(max(total_count), 0)
    INTO v_rows, v_total
    FROM page;

  RETURN jsonb_build_object(
    'classroom_id', p_classroom_id,
    'rows', v_rows,
    'total_count', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'students', v_students
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION brand_achievement_adventure.grant_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid text;
  v_snapshot_valid boolean := false;
BEGIN
  SELECT achievement_uid INTO v_uid
  FROM public.achievements
  WHERE id = NEW.achievement_id;

  IF v_uid = 'EXPE-006' THEN
    IF NEW.application_id IS NOT NULL THEN
      -- The application INSERT trigger saved a trusted PASS while Lv.3 was active.
      -- The teacher can approve after expiry; only the original, linked snapshot counts.
      SELECT EXISTS (
        SELECT 1
        FROM public.achievement_applications aa
        WHERE aa.id = NEW.application_id
          AND aa.student_id = NEW.student_id
          AND aa.achievement_id = NEW.achievement_id
          AND aa.classroom_id = NEW.classroom_id
          AND aa.application_kind = 'NORMAL'
          AND aa.status = 'APPROVED'
          AND aa.evidence_data->>'source' = 'ADVENTURE_V1'
          AND aa.evidence_data->>'metric_code' = 'EXPE-006'
          AND aa.evidence_data->>'result' = 'PASS'
          AND aa.evidence_data->>'available' = 'true'
          AND NULLIF(aa.evidence_data->>'snapshot_at','')::timestamptz
              BETWEEN aa.created_at - interval '2 minutes'
                  AND aa.created_at + interval '2 minutes'
      ) INTO v_snapshot_valid;

      IF NOT v_snapshot_valid THEN
        RAISE EXCEPTION '신청 당시의 EXPE-006 서버 검증 기록이 유효하지 않습니다.'
          USING ERRCODE = 'PAE07';
      END IF;
    ELSIF brand_achievement_adventure.evidence(NEW.student_id, v_uid)->>'result' <> 'PASS' THEN
      -- A direct grant without an application retains the live-effect restriction.
      RAISE EXCEPTION 'Lv.3 월드효과 활성 기간이 아니므로 지금은 달성 처리할 수 없습니다.'
        USING ERRCODE = 'PAE07';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION brand_achievement_adventure.evidence_from_data(p_uid text, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  v_summary jsonb:=p_data->'summary';
  v_value numeric;
  v_target numeric:=1;
  v_op text:='>=';
  v_label text;
  v_note text:=p_data->>'note';
  v_details jsonb;
BEGIN
  CASE p_uid
    WHEN 'RAID-001' THEN v_label:='토벌 보스 종류'; v_value:=(v_summary->>'boss_count')::numeric; v_target:=5;
    WHEN 'RAID-002' THEN v_label:='토벌 보스 종류'; v_value:=(v_summary->>'boss_count')::numeric; v_target:=10;
    WHEN 'RAID-003' THEN v_label:='토벌 보스 종류'; v_value:=(v_summary->>'boss_count')::numeric; v_target:=20;
    WHEN 'RAID-004' THEN v_label:='토벌 기여도 TOP3 횟수'; v_value:=(v_summary->>'top3_count')::numeric; v_target:=5;
    WHEN 'RAID-005' THEN v_label:='한 번의 성공한 토벌에서 가한 최고 대미지'; v_value:=(v_summary->>'max_clear_damage')::numeric; v_target:=2000000; v_op:='>';
    WHEN 'RAID-006' THEN v_label:='한 번의 성공한 토벌에서 가한 최고 대미지'; v_value:=(v_summary->>'max_clear_damage')::numeric; v_target:=5000000; v_op:='>';
    WHEN 'RAID-007' THEN v_label:='한 번의 성공한 토벌에서 가한 최고 대미지'; v_value:=(v_summary->>'max_clear_damage')::numeric; v_target:=10000000; v_op:='>';
    WHEN 'RAID-008' THEN v_label:='마지막 공격으로 토벌'; v_value:=(v_summary->>'last_hit_count')::numeric;
    WHEN 'RAID-009' THEN
      RETURN jsonb_build_object('available',true,'source','ADVENTURE_V1','metric_code',p_uid,
        'measured_value',NULL,'target_value',1,'op','>=','result','BORDERLINE','snapshot_at',now(),
        'details',jsonb_build_array(jsonb_build_object('label','전리품 당첨 기록','value','운영국 확인 필요')),
        'note',p_data->>'loot_note');
    WHEN 'EXPE-001' THEN v_label:='보상 수령 원정'; v_value:=(v_summary->>'claimed_count')::numeric;
    WHEN 'EXPE-002' THEN v_label:='보상 수령 탐사지 종류'; v_value:=(v_summary->>'success_site_count')::numeric; v_target:=5;
    WHEN 'EXPE-003' THEN v_label:='전체 탐사지 중 파견 완료'; v_value:=(v_summary->>'active_dispatch_site_count')::numeric; v_target:=(v_summary->>'all_site_count')::numeric;
    WHEN 'EXPE-004' THEN v_label:='강인 탐사대 보상 수령'; v_value:=(v_summary->>'strong_count')::numeric;
    WHEN 'EXPE-005' THEN v_label:='지정 최상위 보상 획득'; v_value:=(v_summary->>'top_reward_count')::numeric; v_note:='희귀 원정상자 / 600골드 / 범용 편린 조각 10개 이상 중 하나를 실제 수령해야 합니다.';
    WHEN 'EXPE-006' THEN v_label:='기여한 탐사지의 활성 Lv.3 효과'; v_value:=(v_summary->>'active_lv3_count')::numeric; v_note:='본인이 해당 주차·탐사지에 기여한 Lv.3 월드효과가 활성 중일 때 신청해야 합니다. 교사 승인은 신청 당시의 서버 검증 기록으로 판단하며, 효과 종료 후에도 가능합니다.';
    WHEN 'EXPE-007' THEN v_label:='편린 복원 성공'; v_value:=(v_summary->>'restoration_count')::numeric;
    WHEN 'EXPE-008' THEN
      v_value:=CASE WHEN coalesce((v_summary->>'discovery_count')::integer,0)>0 THEN 1 ELSE 0 END;
      RETURN jsonb_build_object('available',true,'source','ADVENTURE_V1','metric_code',p_uid,
        'measured_value',v_value,'target_value',1,'op','>=',
        'result',CASE WHEN v_value=1 THEN 'PASS' ELSE 'FAIL' END,'snapshot_at',now(),
        'details',jsonb_build_array(jsonb_build_object('label','숨겨진 비밀 발견 여부',
          'value',CASE WHEN v_value=1 THEN '발견' ELSE '미발견' END)));
    WHEN 'EXPE-009' THEN v_label:='명품관 직접 구매'; v_value:=(v_summary->>'luxury_purchase_count')::numeric;
    ELSE RETURN NULL;
  END CASE;
  IF p_uid IN ('RAID-005','RAID-006','RAID-007') THEN
    v_note:='성공한 실전 토벌 한 회의 개인 대미지만 비교합니다.';
  END IF;
  v_value:=coalesce(v_value,0);
  v_details:=jsonb_build_array(jsonb_build_object('label',v_label,'value',v_value));
  IF v_op='>' THEN
    v_details:=v_details||jsonb_build_array(jsonb_build_object('label','한 번의 토벌에서 추가로 필요한 대미지','value',greatest(0,v_target+1-v_value)));
  END IF;
  IF p_uid='EXPE-003' THEN
    v_details:=v_details||jsonb_build_array(jsonb_build_object('label','미파견 탐사지','value',
      coalesce((SELECT string_agg(x->>'site_name',', ') FROM jsonb_array_elements(p_data->'sites') x WHERE NOT (x->>'dispatched')::boolean),'없음')));
  ELSIF p_uid='EXPE-006' THEN
    v_details:=v_details||coalesce((SELECT jsonb_agg(jsonb_build_object('label',(x->>'site_name')||' 효과 종료','value',x->>'ends_at'))
      FROM jsonb_array_elements(p_data->'effects') x WHERE (x->>'active')::boolean),'[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('available',true,'source','ADVENTURE_V1','metric_code',p_uid,
    'measured_value',v_value,'target_value',v_target,'op',v_op,
    'result',CASE WHEN v_target>0 AND (CASE WHEN v_op='>' THEN v_value>v_target ELSE v_value>=v_target END) THEN 'PASS' ELSE 'FAIL' END,
    'snapshot_at',now(),'details',v_details,'note',v_note);
END;
$function$
;

-- Update the displayed rule so approval after an effect expires is not misleading.
UPDATE public.achievements
SET condition_text = '자신이 기여한 주차·탐사지의 Lv.3 월드효과가 활성화된 기간에 업적을 신청함. 교사 승인은 신청 당시의 유효한 기록을 기준으로 처리함.',
    updated_at = now()
WHERE achievement_uid = 'EXPE-006'
  AND condition_text = '자신이 기여한 주차·탐사지의 Lv.3 월드효과가 활성화된 기간에 업적을 신청하고 달성함.';
