-- B.R.A.N.D 2.0
-- Auction runtime single-read-path v3
-- 2026-10-03
--
-- All live auction readers use auction_live_runtime as the canonical live-state cache.
-- p_light_mode is retained only as a compatibility argument and is ignored.
-- legacy_v1 / auction_state_cache remain only as rollback assets.

CREATE INDEX IF NOT EXISTS idx_auction_bids_item_attempt_created
ON public.auction_bids (auction_item_id, attempt_number, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_live_auction_state(
  p_classroom_id integer,
  p_include_scheduled boolean DEFAULT false,
  p_light_mode boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'brand_runtime_internal', 'pg_temp'
AS $function$
DECLARE
  v_is_teacher boolean;
  v_student_id integer;
  v_auction public.auctions%ROWTYPE;
  v_runtime public.auction_live_runtime%ROWTYPE;
  v_current_item public.auction_items%ROWTYPE;
  v_items jsonb := '[]'::jsonb;
  v_recent_bids jsonb := '[]'::jsonb;
  v_super_pass jsonb := null;
  v_previous_sale_price integer := null;
  v_round public.auction_super_pass_rounds%ROWTYPE;
  v_pass_item_id bigint := null;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '소속 학급의 경매만 조회할 수 있습니다.' USING ERRCODE = 'P0702';
  END IF;

  v_is_teacher := public.is_teacher_or_admin();
  v_student_id := public.current_student_id();

  SELECT * INTO v_auction
  FROM public.auctions a
  WHERE a.classroom_id = p_classroom_id
    AND (
      a.status = 'IN_PROGRESS'
      OR (p_include_scheduled AND v_is_teacher AND a.status = 'SCHEDULED')
    )
  ORDER BY CASE a.status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END, a.created_at DESC
  LIMIT 1;

  IF v_auction.id IS NULL THEN
    RETURN jsonb_build_object(
      'server_now', clock_timestamp(),
      'auction', null,
      'items', '[]'::jsonb,
      'recent_bids', '[]'::jsonb,
      'super_pass', null
    );
  END IF;

  SELECT * INTO v_runtime
  FROM public.auction_live_runtime rt
  WHERE rt.auction_id = v_auction.id;

  IF v_runtime.auction_id IS NULL
     OR v_runtime.state_version IS DISTINCT FROM v_auction.state_version
     OR v_runtime.current_item_id IS DISTINCT FROM v_auction.current_item_id
     OR v_runtime.auction_status IS DISTINCT FROM v_auction.status THEN
    PERFORM brand_runtime_internal.refresh_auction_live_runtime(
      v_auction.id,
      v_auction.current_item_id,
      'READ_RECOVERY'
    );

    SELECT * INTO v_runtime
    FROM public.auction_live_runtime rt
    WHERE rt.auction_id = v_auction.id;
  END IF;

  IF v_runtime.auction_id IS NULL THEN
    RAISE EXCEPTION '경매 실시간 상태를 복구하지 못했습니다.'
      USING ERRCODE = 'P0798';
  END IF;

  IF v_auction.current_item_id IS NOT NULL THEN
    SELECT * INTO v_current_item
    FROM public.auction_items i
    WHERE i.id = v_auction.current_item_id
      AND i.auction_id = v_auction.id;

    IF v_current_item.id IS NOT NULL THEN
      SELECT r2.final_price INTO v_previous_sale_price
      FROM public.auction_results r2
      JOIN public.auction_items i2 ON i2.id = r2.auction_item_id
      JOIN public.auctions a2 ON a2.id = i2.auction_id
      WHERE a2.classroom_id = v_auction.classroom_id
        AND a2.id <> v_auction.id
        AND i2.item_name = v_current_item.item_name
        AND i2.category = v_current_item.category
      ORDER BY r2.confirmed_at DESC
      LIMIT 1;
    END IF;
  END IF;

  SELECT coalesce(
    jsonb_agg(
      CASE
        WHEN i.id = v_auction.current_item_id
             AND v_runtime.payload->'item' IS NOT NULL THEN
          jsonb_build_object(
            'id', i.id,
            'auction_id', i.auction_id,
            'item_name', i.item_name,
            'description', i.description,
            'category', i.category,
            'emoji', i.emoji,
            'image_url', i.image_url,
            'starting_price', i.starting_price,
            'current_price', i.current_price,
            'previous_sale_price', v_previous_sale_price,
            'display_order', i.display_order,
            'current_attempt', i.current_attempt,
            'final_status', i.final_status,
            'bidding_started_at', i.bidding_started_at,
            'bidding_ends_at', i.bidding_ends_at,
            'last_bid_at', i.last_bid_at,
            'is_current', true,
            'bid_count', 0,
            'top_bid', null,
            'result', CASE WHEN r.id IS NULL THEN null ELSE jsonb_build_object(
              'winner_student_id', r.winner_student_id,
              'winner_name', ws.name,
              'winner_brand_name', ws.brand_name,
              'final_price', r.final_price,
              'attempt_number', r.attempt_number,
              'confirmed_at', r.confirmed_at
            ) END
          ) || (v_runtime.payload->'item')

        WHEN v_is_teacher AND p_include_scheduled THEN
          jsonb_build_object(
            'id', i.id,
            'auction_id', i.auction_id,
            'item_name', i.item_name,
            'description', i.description,
            'category', i.category,
            'emoji', i.emoji,
            'image_url', i.image_url,
            'starting_price', i.starting_price,
            'current_price', i.current_price,
            'previous_sale_price', null,
            'display_order', i.display_order,
            'current_attempt', i.current_attempt,
            'final_status', i.final_status,
            'bidding_started_at', i.bidding_started_at,
            'bidding_ends_at', i.bidding_ends_at,
            'last_bid_at', i.last_bid_at,
            'is_current', false,
            'bid_count', 0,
            'top_bid', null,
            'result', CASE WHEN r.id IS NULL THEN null ELSE jsonb_build_object(
              'winner_student_id', r.winner_student_id,
              'winner_name', ws.name,
              'winner_brand_name', ws.brand_name,
              'final_price', r.final_price,
              'attempt_number', r.attempt_number,
              'confirmed_at', r.confirmed_at
            ) END
          )

        ELSE
          jsonb_build_object(
            'id', i.id,
            'auction_id', i.auction_id,
            'item_name', i.item_name,
            'description', null,
            'category', i.category,
            'emoji', i.emoji,
            'image_url', null,
            'starting_price', i.starting_price,
            'current_price', i.current_price,
            'previous_sale_price', null,
            'display_order', i.display_order,
            'current_attempt', i.current_attempt,
            'final_status', i.final_status,
            'bidding_started_at', null,
            'bidding_ends_at', i.bidding_ends_at,
            'last_bid_at', null,
            'is_current', false,
            'bid_count', 0,
            'top_bid', null,
            'result', CASE WHEN r.id IS NULL THEN null ELSE jsonb_build_object(
              'winner_student_id', r.winner_student_id,
              'winner_name', ws.name,
              'winner_brand_name', ws.brand_name,
              'final_price', r.final_price,
              'attempt_number', r.attempt_number,
              'confirmed_at', r.confirmed_at
            ) END
          )
      END
      ORDER BY i.display_order, i.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.auction_items i
  LEFT JOIN public.auction_results r ON r.auction_item_id = i.id
  LEFT JOIN public.students ws ON ws.id = r.winner_student_id
  WHERE i.auction_id = v_auction.id;

  IF v_current_item.id IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(x.obj ORDER BY x.created_at DESC), '[]'::jsonb)
      INTO v_recent_bids
    FROM (
      SELECT
        b.created_at,
        jsonb_build_object(
          'id', b.id,
          'auction_item_id', b.auction_item_id,
          'student_id', b.student_id,
          'student_name', s.name,
          'brand_name', s.brand_name,
          'bid_amount', b.bid_amount,
          'attempt_number', b.attempt_number,
          'created_at', b.created_at,
          'is_winning', b.is_winning,
          'invalidated_at', b.invalidated_at
        ) AS obj
      FROM public.auction_bids b
      JOIN public.students s ON s.id = b.student_id
      WHERE b.auction_item_id = v_current_item.id
        AND b.attempt_number = v_current_item.current_attempt
        AND b.invalidated_at IS NULL
      ORDER BY b.created_at DESC
      LIMIT 10
    ) x;

    IF v_is_teacher THEN
      SELECT * INTO v_round
      FROM public.auction_super_pass_rounds spr
      WHERE spr.auction_item_id = v_current_item.id
        AND spr.attempt_number = v_current_item.current_attempt
      LIMIT 1;

      IF v_round.id IS NOT NULL THEN
        v_pass_item_id := public._auction_super_pass_catalog_item(
          v_auction.classroom_id,
          v_current_item.category
        );

        SELECT jsonb_build_object(
          'round_id', v_round.id,
          'status', v_round.status,
          'attempt_number', v_round.attempt_number,
          'minimum_price', v_round.minimum_price,
          'application_started_at', v_round.application_started_at,
          'application_ends_at', v_round.application_ends_at,
          'priority_started_at', v_round.priority_started_at,
          'priority_ends_at', v_round.priority_ends_at,
          'applicant_count', v_round.applicant_count,
          'winner_student_id', v_round.winner_student_id,
          'resolved_at', v_round.resolved_at,
          'pass_item_id', v_pass_item_id,
          'available_quantity', 0,
          'current_student_applied', false,
          'current_student_entry_status', null,
          'current_student_priority_eligible', false,
          'applicants', coalesce((
            SELECT jsonb_agg(
              jsonb_build_object(
                'student_id', e.student_id,
                'student_name', s.name,
                'brand_name', s.brand_name,
                'entry_status', e.status,
                'reservation_status', ir.status,
                'applied_at', e.applied_at
              )
              ORDER BY e.applied_at, e.id
            )
            FROM public.auction_super_pass_entries e
            JOIN public.students s ON s.id = e.student_id
            LEFT JOIN public.inventory_reservations ir ON ir.id = e.reservation_id
            WHERE e.round_id = v_round.id
          ), '[]'::jsonb)
        )
        INTO v_super_pass;
      END IF;
    ELSE
      v_super_pass := public.get_live_auction_student_context(v_current_item.id)->'super_pass';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'server_now', clock_timestamp(),
    'auction', v_runtime.payload->'auction',
    'items', v_items,
    'recent_bids', v_recent_bids,
    'super_pass', v_super_pass
  );
END;
$function$;

COMMENT ON FUNCTION public.get_live_auction_state(integer, boolean, boolean)
IS 'Canonical live-auction read RPC. Uses auction_live_runtime for all callers. p_light_mode is compatibility-only and ignored.';

NOTIFY pgrst, 'reload schema';
