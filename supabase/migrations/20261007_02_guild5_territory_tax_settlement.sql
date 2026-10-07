-- =============================================================================
-- B.R.A.N.D 2.0 — Guild5 territory occupancy + auction territory-tax settlement
-- 2026-10-07 incremental migration
--
-- Core behavior
--   * Territory assignment is the authoritative point that fixes owner guild + tax rate.
--   * If the linked auction already happened, tax is assessed retroactively once.
--   * If an auction happens after territory assignment, tax is assessed immediately when
--     the auction item becomes SOLD.
--   * Insufficient GOLD becomes student_asset_arrears and follows existing auto repayment.
--   * Each auction_result can receive territory tax only once.
--   * Tax assessment is attributed to the occupying guild, but this migration does NOT
--     create a spendable guild treasury or distribute collected tax to guild members.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.guild5_territory_tax_assessments (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  closure_id bigint NOT NULL REFERENCES public.guild5_month_closures(id) ON DELETE CASCADE,
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  conquest_turn_id bigint NOT NULL REFERENCES public.guild5_conquest_turns(id) ON DELETE CASCADE,
  owner_guild_id integer NOT NULL REFERENCES public.guilds(id),
  territory_id bigint NOT NULL REFERENCES public.guild5_territories(id),
  territory_slot_no smallint NOT NULL CHECK (territory_slot_no BETWEEN 1 AND 3),
  territory_name_snapshot text NOT NULL,
  auction_id integer NOT NULL REFERENCES public.auctions(id),
  auction_result_id integer NOT NULL REFERENCES public.auction_results(id),
  auction_item_id integer NOT NULL REFERENCES public.auction_items(id),
  auction_category text NOT NULL CHECK (auction_category IN ('자리','1인1역','급식순서')),
  student_id integer NOT NULL REFERENCES public.students(id),
  final_price bigint NOT NULL CHECK (final_price >= 0),
  territory_tax_rate_percent numeric(5,2) NOT NULL CHECK (territory_tax_rate_percent BETWEEN 0 AND 100),
  tax_reduction_pp numeric(5,2) NOT NULL DEFAULT 0 CHECK (tax_reduction_pp >= 0),
  effective_tax_rate_percent numeric(5,2) NOT NULL CHECK (effective_tax_rate_percent BETWEEN 0 AND 100),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0),
  collected_amount_at_assessment bigint NOT NULL DEFAULT 0 CHECK (collected_amount_at_assessment >= 0),
  transaction_id bigint REFERENCES public.transactions(id),
  arrear_id bigint REFERENCES public.student_asset_arrears(id),
  assessment_mode text NOT NULL CHECK (assessment_mode IN ('IMMEDIATE','RETROACTIVE')),
  status_at_assessment text NOT NULL CHECK (status_at_assessment IN ('PAID','PARTIAL','UNPAID')),
  assessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(auction_result_id)
);

ALTER TABLE public.guild5_territory_tax_assessments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.guild5_territory_tax_assessments FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS ix_guild5_territory_tax_version_slot
  ON public.guild5_territory_tax_assessments(version_id,territory_slot_no);
CREATE INDEX IF NOT EXISTS ix_guild5_territory_tax_student
  ON public.guild5_territory_tax_assessments(student_id,assessed_at DESC);

CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_arrear
  ON public.guild5_territory_tax_assessments(arrear_id) WHERE arrear_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_auction
  ON public.guild5_territory_tax_assessments(auction_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_item
  ON public.guild5_territory_tax_assessments(auction_item_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_classroom
  ON public.guild5_territory_tax_assessments(classroom_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_closure
  ON public.guild5_territory_tax_assessments(closure_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_turn
  ON public.guild5_territory_tax_assessments(conquest_turn_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_owner_guild
  ON public.guild5_territory_tax_assessments(owner_guild_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_territory
  ON public.guild5_territory_tax_assessments(territory_id);
CREATE INDEX IF NOT EXISTS ix_g5_tax_assessment_transaction
  ON public.guild5_territory_tax_assessments(transaction_id) WHERE transaction_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guild5_assess_auction_result_territory_tax(
  p_auction_result_id integer,
  p_conquest_turn_id bigint,
  p_mode text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_version public.guild5_closure_versions%ROWTYPE;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_result public.auction_results%ROWTYPE;
  v_item public.auction_items%ROWTYPE;
  v_auction public.auctions%ROWTYPE;
  v_existing public.guild5_territory_tax_assessments%ROWTYPE;
  v_expected_category text;
  v_rate numeric:=0;
  v_reduction numeric:=0;
  v_effective numeric:=0;
  v_tax bigint:=0;
  v_deduct jsonb;
  v_collected bigint:=0;
  v_outstanding bigint:=0;
  v_tx_id bigint:=null;
  v_arrear_id bigint:=null;
  v_status text:='PAID';
BEGIN
  IF p_mode NOT IN ('IMMEDIATE','RETROACTIVE') THEN
    RAISE EXCEPTION '[G5 TAX] invalid assessment mode.' USING ERRCODE='P0550';
  END IF;

  SELECT * INTO v_existing
  FROM public.guild5_territory_tax_assessments
  WHERE auction_result_id=p_auction_result_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'status','ALREADY_ASSESSED',
      'assessment_id',v_existing.id,
      'tax_amount',v_existing.tax_amount,
      'collected_amount',v_existing.collected_amount_at_assessment,
      'arrear_id',v_existing.arrear_id
    );
  END IF;

  SELECT * INTO v_turn
  FROM public.guild5_conquest_turns
  WHERE id=p_conquest_turn_id
    AND turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
    AND territory_id IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] assigned conquest turn not found.' USING ERRCODE='P0551';
  END IF;

  SELECT * INTO v_version FROM public.guild5_closure_versions WHERE id=v_turn.version_id;
  SELECT * INTO v_closure FROM public.guild5_month_closures WHERE id=v_version.closure_id;
  IF v_closure.id IS NULL OR v_closure.current_version_id IS DISTINCT FROM v_version.id OR v_closure.lifecycle_state<>'FINALIZED' THEN
    RAISE EXCEPTION '[G5 TAX] only current FINALIZED conquest may assess tax.' USING ERRCODE='P0552';
  END IF;

  SELECT * INTO v_result FROM public.auction_results WHERE id=p_auction_result_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] auction result not found.' USING ERRCODE='P0553';
  END IF;
  SELECT * INTO v_item FROM public.auction_items WHERE id=v_result.auction_item_id;
  SELECT * INTO v_auction FROM public.auctions WHERE id=v_item.auction_id;

  IF v_auction.classroom_id IS DISTINCT FROM v_closure.classroom_id THEN
    RAISE EXCEPTION '[G5 TAX] classroom mismatch.' USING ERRCODE='P0554';
  END IF;

  v_expected_category:=CASE v_turn.territory_slot_no_snapshot
    WHEN 1 THEN '1인1역'
    WHEN 2 THEN '자리'
    WHEN 3 THEN '급식순서'
    ELSE NULL
  END;

  IF v_expected_category IS NULL OR v_item.category IS DISTINCT FROM v_expected_category THEN
    RETURN jsonb_build_object(
      'status','CATEGORY_MISMATCH',
      'auction_result_id',p_auction_result_id,
      'item_category',v_item.category,
      'expected_category',v_expected_category
    );
  END IF;

  IF EXISTS(
    SELECT 1 FROM public.transactions tx
    WHERE tx.id=v_result.transaction_id AND tx.is_reversed
  ) THEN
    RETURN jsonb_build_object('status','SKIPPED_REVERSED','auction_result_id',p_auction_result_id);
  END IF;

  v_rate:=coalesce(v_turn.territory_tax_rate_snapshot,0);
  v_reduction:=greatest(0,public.collection_buff_value(v_result.winner_student_id,'TAX_RATE_REDUCTION_PP'));
  v_effective:=greatest(0,least(100,v_rate-v_reduction));
  v_tax:=floor(v_result.final_price::numeric*v_effective/100)::bigint;

  IF v_tax>0 THEN
    v_deduct:=public._teacher_apply_asset_deduction(
      v_result.winner_student_id,
      'GOLD'::public.value_token_type,
      v_tax,
      format(
        '[Guild5 영토세] %s · 경매 %s회차 %s · 낙찰가 %s GOLD × 실효세율 %s%%',
        coalesce(v_turn.territory_name_snapshot,'영토'),
        v_auction.round_number,
        v_expected_category,
        v_result.final_price,
        trim(to_char(v_effective,'FM999990.00'))
      )
    );
    v_collected:=coalesce((v_deduct->>'collected_amount')::bigint,0);
    v_outstanding:=coalesce((v_deduct->>'outstanding_amount')::bigint,0);
    v_tx_id:=nullif(v_deduct->>'transaction_id','')::bigint;
    v_arrear_id:=nullif(v_deduct->>'arrear_id','')::bigint;
    v_status:=CASE
      WHEN v_outstanding<=0 THEN 'PAID'
      WHEN v_collected>0 THEN 'PARTIAL'
      ELSE 'UNPAID'
    END;

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
    transaction_id,arrear_id,assessment_mode,status_at_assessment
  ) VALUES (
    v_closure.classroom_id,v_closure.id,v_version.id,v_turn.id,v_turn.guild_id,
    v_turn.territory_id,v_turn.territory_slot_no_snapshot,coalesce(v_turn.territory_name_snapshot,'영토'),
    v_auction.id,v_result.id,v_item.id,v_expected_category,
    v_result.winner_student_id,v_result.final_price,v_rate,v_reduction,
    v_effective,v_tax,v_collected,v_tx_id,v_arrear_id,p_mode,v_status
  )
  RETURNING id INTO v_existing.id;

  RETURN jsonb_build_object(
    'status','ASSESSED',
    'assessment_id',v_existing.id,
    'student_id',v_result.winner_student_id,
    'tax_amount',v_tax,
    'collected_amount',v_collected,
    'outstanding_amount',v_outstanding,
    'arrear_id',v_arrear_id,
    'effective_tax_rate_percent',v_effective
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guild5_assess_auction_result_territory_tax(integer,bigint,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guild5_assess_assigned_territory_tax(
  p_turn_id bigint,
  p_mode text DEFAULT 'RETROACTIVE'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_econ public.guild5_territory_economy_snapshots%ROWTYPE;
  v_category text;
  v_row record;
  v_one jsonb;
  v_processed integer:=0;
  v_assessed bigint:=0;
BEGIN
  SELECT * INTO v_turn
  FROM public.guild5_conquest_turns
  WHERE id=p_turn_id
    AND turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
    AND territory_id IS NOT NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TAX] assigned turn not found.' USING ERRCODE='P0551';
  END IF;

  v_category:=CASE v_turn.territory_slot_no_snapshot
    WHEN 1 THEN '1인1역'
    WHEN 2 THEN '자리'
    WHEN 3 THEN '급식순서'
    ELSE NULL
  END;

  SELECT * INTO v_econ
  FROM public.guild5_territory_economy_snapshots
  WHERE version_id=v_turn.version_id
    AND slot_no=v_turn.territory_slot_no_snapshot;

  IF v_econ.id IS NULL OR v_econ.auction_id IS NULL THEN
    RETURN jsonb_build_object(
      'status','NO_RETROACTIVE_AUCTION',
      'turn_id',p_turn_id,
      'category',v_category,
      'processed',0
    );
  END IF;

  FOR v_row IN
    SELECT r.id
    FROM public.auction_results r
    JOIN public.auction_items i ON i.id=r.auction_item_id
    JOIN public.transactions tx ON tx.id=r.transaction_id
    WHERE i.auction_id=v_econ.auction_id
      AND i.category=v_category
      AND tx.value_token='GOLD'
      AND tx.amount<0
      AND NOT tx.is_reversed
    ORDER BY r.id
  LOOP
    v_one:=public.guild5_assess_auction_result_territory_tax(v_row.id,p_turn_id,p_mode);
    IF v_one->>'status'='ASSESSED' THEN
      v_processed:=v_processed+1;
      v_assessed:=v_assessed+coalesce((v_one->>'tax_amount')::bigint,0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status','OK',
    'turn_id',p_turn_id,
    'auction_id',v_econ.auction_id,
    'auction_round_number',v_econ.auction_round_number,
    'category',v_category,
    'processed',v_processed,
    'tax_assessed',v_assessed
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.guild5_assess_assigned_territory_tax(bigint,text) FROM PUBLIC,anon,authenticated;

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

REVOKE ALL ON FUNCTION public.guild5_get_territory_tax_summary(bigint) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.guild5_assess_sold_auction_item_tax_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_slot smallint;
  v_turn_id bigint;
  v_result_id integer;
  v_classroom_id integer;
  v_latest_closure public.guild5_month_closures%ROWTYPE;
BEGIN
  IF NEW.final_status::text<>'SOLD' OR coalesce(OLD.final_status::text,'')='SOLD' THEN
    RETURN NEW;
  END IF;

  v_slot:=CASE NEW.category
    WHEN '1인1역' THEN 1
    WHEN '자리' THEN 2
    WHEN '급식순서' THEN 3
    ELSE NULL
  END;
  IF v_slot IS NULL THEN RETURN NEW; END IF;

  SELECT a.classroom_id INTO v_classroom_id
  FROM public.auctions a
  WHERE a.id=NEW.auction_id;
  IF v_classroom_id IS NULL THEN RETURN NEW; END IF;

  -- Only the newest Guild5 month may tax a new auction. If the newest month is
  -- OPEN/REOPENED, do not fall back to an older finalized month's territory.
  SELECT c.* INTO v_latest_closure
  FROM public.guild5_month_closures c
  WHERE c.classroom_id=v_classroom_id
  ORDER BY c.year_month DESC,c.id DESC
  LIMIT 1;

  IF v_latest_closure.id IS NULL
     OR v_latest_closure.lifecycle_state<>'FINALIZED'
     OR v_latest_closure.current_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.id INTO v_result_id
  FROM public.auction_results r
  WHERE r.auction_item_id=NEW.id
  ORDER BY r.confirmed_at DESC,r.id DESC
  LIMIT 1;
  IF v_result_id IS NULL THEN RETURN NEW; END IF;

  SELECT ct.id INTO v_turn_id
  FROM public.guild5_conquest_turns ct
  WHERE ct.version_id=v_latest_closure.current_version_id
    AND ct.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
    AND ct.territory_slot_no_snapshot=v_slot
  ORDER BY ct.id DESC
  LIMIT 1;

  IF v_turn_id IS NOT NULL THEN
    PERFORM public.guild5_assess_auction_result_territory_tax(v_result_id,v_turn_id,'IMMEDIATE');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guild5_assess_sold_auction_item_tax_trigger() FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS trg_guild5_assess_sold_auction_item_tax ON public.auction_items;
CREATE TRIGGER trg_guild5_assess_sold_auction_item_tax
AFTER UPDATE OF final_status ON public.auction_items
FOR EACH ROW
EXECUTE FUNCTION public.guild5_assess_sold_auction_item_tax_trigger();

CREATE OR REPLACE FUNCTION public.guild5_build_territory_auction_economy(p_classroom_id integer,p_season_id integer)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_auction public.auctions%ROWTYPE;
  v_result jsonb;
BEGIN
  SELECT a.* INTO v_auction
  FROM public.auctions a
  WHERE a.classroom_id=p_classroom_id
    AND a.status='COMPLETED'
    AND NOT EXISTS(
      SELECT 1 FROM public.guild5_territory_economy_snapshots es
      WHERE es.classroom_id=p_classroom_id AND es.auction_id=a.id
    )
    AND 3=(
      SELECT count(DISTINCT i.category)::integer
      FROM public.auction_items i
      JOIN public.auction_results r ON r.auction_item_id=i.id
      JOIN public.transactions tx ON tx.id=r.transaction_id
      WHERE i.auction_id=a.id
        AND i.category IN ('자리','1인1역','급식순서')
        AND tx.value_token='GOLD'
        AND tx.amount<0
        AND NOT tx.is_reversed
    )
  ORDER BY coalesce(a.ended_at,a.started_at,a.created_at) DESC,a.id DESC
  LIMIT 1;

  WITH slots(slot_no,auction_category) AS (
    VALUES (1::smallint,'1인1역'::text),(2::smallint,'자리'::text),(3::smallint,'급식순서'::text)
  ), totals AS (
    SELECT i.category::text AS auction_category,
           count(r.id)::integer AS settled_item_count,
           coalesce(sum(r.final_price),0)::bigint AS gross_spend
    FROM public.auction_items i
    JOIN public.auction_results r ON r.auction_item_id=i.id
    JOIN public.transactions tx ON tx.id=r.transaction_id
    WHERE v_auction.id IS NOT NULL
      AND i.auction_id=v_auction.id
      AND i.category IN ('자리','1인1역','급식순서')
      AND tx.value_token='GOLD'
      AND tx.amount<0
      AND NOT tx.is_reversed
    GROUP BY i.category
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'slot_no',s.slot_no,
    'territory_id',t.id,
    'territory_name',t.territory_name,
    'territory_description',t.description,
    'tax_rate_percent',t.tax_rate_percent,
    'auction_category',s.auction_category,
    'auction_id',v_auction.id,
    'auction_round_number',v_auction.round_number,
    'auction_school_year',v_auction.school_year,
    'auction_ended_at',v_auction.ended_at,
    'settled_item_count',coalesce(x.settled_item_count,0),
    'gross_spend',coalesce(x.gross_spend,0),
    'projected_revenue',round(coalesce(x.gross_spend,0)::numeric*coalesce(t.tax_rate_percent,0)::numeric/100,2)
  ) ORDER BY s.slot_no),'[]'::jsonb)
  INTO v_result
  FROM slots s
  LEFT JOIN public.guild5_territories t
    ON t.classroom_id=p_classroom_id AND t.season_id=p_season_id AND t.slot_no=s.slot_no
  LEFT JOIN totals x ON x.auction_category=s.auction_category;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild5_territory_v2(
  p_season_id integer,
  p_slot_no integer,
  p_territory_name text,
  p_description text DEFAULT NULL,
  p_tax_rate_percent numeric DEFAULT 5.00
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','pg_temp'
AS $function$
DECLARE
  v_class integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  IF p_slot_no NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION '[G5] territory slot must be 1..3.' USING ERRCODE='P0506'; END IF;
  IF char_length(btrim(coalesce(p_territory_name,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '[G5] territory name is required.' USING ERRCODE='P0507'; END IF;
  IF p_tax_rate_percent IS NULL OR p_tax_rate_percent<0 OR p_tax_rate_percent>100 THEN RAISE EXCEPTION '[G5] territory tax rate must be between 0 and 100.' USING ERRCODE='P0509'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.guild_seasons s WHERE s.id=p_season_id AND s.classroom_id=v_class) THEN RAISE EXCEPTION '[G5] season mismatch.' USING ERRCODE='P0508'; END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=p_season_id) THEN RAISE EXCEPTION '[G5] season is locked.' USING ERRCODE='P0504'; END IF;
  IF EXISTS(
    SELECT 1
    FROM public.guild5_month_closures c
    JOIN public.guild5_closure_versions v ON v.id=c.current_version_id
    WHERE c.classroom_id=v_class
      AND c.season_id=p_season_id
      AND c.lifecycle_state='FINALIZED'
      AND v.conquest_status IN ('ACTIVE','RECONQUEST_REQUIRED')
  ) THEN
    RAISE EXCEPTION '[G5] conquest is active. Reopen the month before changing territory or tax settings.' USING ERRCODE='P0510';
  END IF;

  INSERT INTO public.guild5_territories(
    classroom_id,season_id,slot_no,territory_name,description,tax_rate_percent,updated_by_user_id,updated_at
  ) VALUES (
    v_class,p_season_id,p_slot_no,btrim(p_territory_name),
    nullif(btrim(coalesce(p_description,'')),''),
    p_tax_rate_percent,auth.uid(),now()
  )
  ON CONFLICT(season_id,slot_no) DO UPDATE
  SET territory_name=EXCLUDED.territory_name,
      description=EXCLUDED.description,
      tax_rate_percent=EXCLUDED.tax_rate_percent,
      updated_by_user_id=auth.uid(),
      updated_at=now();

  RETURN (
    SELECT jsonb_agg(jsonb_build_object(
      'id',id,'slot_no',slot_no,'territory_name',territory_name,'description',description,'tax_rate_percent',tax_rate_percent
    ) ORDER BY slot_no)
    FROM public.guild5_territories
    WHERE classroom_id=v_class AND season_id=p_season_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_choose_guild5_territory(p_turn_id bigint,p_territory_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
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
  WHERE t.id=p_turn_id AND c.classroom_id=v_class AND c.current_version_id=v.id AND c.lifecycle_state='FINALIZED'
  FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION '[G5] conquest turn not found.' USING ERRCODE='P0522'; END IF;

  SELECT v.closure_id INTO v_closure_id FROM public.guild5_closure_versions v WHERE v.id=v_turn.version_id;
  PERFORM public.guild5_process_due_conquest_internal(v_turn.version_id);

  SELECT * INTO v_turn FROM public.guild5_conquest_turns WHERE id=p_turn_id FOR UPDATE;
  IF v_turn.turn_status<>'ACTIVE' THEN RAISE EXCEPTION '[G5] only current ACTIVE rank may choose.' USING ERRCODE='P0523'; END IF;

  SELECT t.* INTO v_territory
  FROM public.guild5_territories t
  JOIN public.guild5_closure_versions v ON v.id=v_turn.version_id
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE t.id=p_territory_id AND t.classroom_id=c.classroom_id AND t.season_id=c.season_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.guild5_conquest_turns WHERE version_id=v_turn.version_id AND territory_id=p_territory_id) THEN
    RAISE EXCEPTION '[G5] territory is unavailable.' USING ERRCODE='P0524';
  END IF;

  UPDATE public.guild5_conquest_turns
  SET turn_status='ASSIGNED',territory_id=v_territory.id,territory_name_snapshot=v_territory.territory_name,assignment_method='MANUAL',chosen_at=now()
  WHERE id=v_turn.id;

  v_tax:=public.guild5_assess_assigned_territory_tax(v_turn.id,'RETROACTIVE');

  PERFORM public.guild5_write_audit(
    v_closure_id,v_turn.version_id,v_class,'CONQUEST_MANUAL_ASSIGNED',NULL,
    jsonb_build_object('turn_id',v_turn.id,'rank',v_turn.rank_position),
    jsonb_build_object('territory_id',v_territory.id,'territory_name',v_territory.territory_name,'tax_settlement',v_tax)
  );

  PERFORM public.guild5_activate_next_turn(v_turn.version_id);

  RETURN jsonb_build_object(
    'turn_id',v_turn.id,'territory_id',v_territory.id,'territory_name',v_territory.territory_name,
    'tax_settlement',v_tax,
    'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=v_turn.version_id)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.guild5_process_due_conquest_internal(p_version_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_turn public.guild5_conquest_turns%ROWTYPE;
  v_territory public.guild5_territories%ROWTYPE;
  v_processed integer:=0;
  v_closure_id bigint;
  v_class integer;
  v_tax jsonb;
BEGIN
  SELECT v.closure_id,c.classroom_id INTO v_closure_id,v_class
  FROM public.guild5_closure_versions v
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE v.id=p_version_id AND c.current_version_id=v.id AND c.lifecycle_state='FINALIZED';

  IF v_closure_id IS NULL THEN RETURN jsonb_build_object('processed',0,'skipped','NOT_CURRENT_FINALIZED'); END IF;

  LOOP
    SELECT * INTO v_turn
    FROM public.guild5_conquest_turns
    WHERE version_id=p_version_id AND turn_status='ACTIVE' AND deadline_at<=now()
    ORDER BY rank_position LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;

    SELECT t.* INTO v_territory
    FROM public.guild5_territories t
    JOIN public.guild5_month_closures c ON c.season_id=t.season_id
    JOIN public.guild5_closure_versions v ON v.closure_id=c.id AND v.id=p_version_id
    WHERE NOT EXISTS(
      SELECT 1 FROM public.guild5_conquest_turns used
      WHERE used.version_id=p_version_id AND used.territory_id=t.id
    )
    ORDER BY md5(p_version_id::text||'|'||v_turn.rank_position::text||'|'||t.id::text)
    LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION '[G5] no territory remains for auto assignment.' USING ERRCODE='P0520'; END IF;

    UPDATE public.guild5_conquest_turns
    SET turn_status='AUTO_ASSIGNED',territory_id=v_territory.id,territory_name_snapshot=v_territory.territory_name,assignment_method='AUTO',chosen_at=now()
    WHERE id=v_turn.id;

    v_tax:=public.guild5_assess_assigned_territory_tax(v_turn.id,'RETROACTIVE');

    PERFORM public.guild5_write_audit(
      v_closure_id,p_version_id,v_class,'CONQUEST_AUTO_ASSIGNED','선택 기한 만료',
      jsonb_build_object('turn_id',v_turn.id,'rank',v_turn.rank_position),
      jsonb_build_object('territory_id',v_territory.id,'territory_name',v_territory.territory_name,'tax_settlement',v_tax)
    );

    v_processed:=v_processed+1;
    PERFORM public.guild5_activate_next_turn(p_version_id);
  END LOOP;

  RETURN jsonb_build_object('processed',v_processed,'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=p_version_id));
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_get_guild5_dashboard(p_year_month text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_class integer;
  v_season integer;
  v_preview jsonb;
  v_closure public.guild5_month_closures%ROWTYPE;
  v_current bigint;
  v_result jsonb;
  v_territory_economy jsonb;
  v_tax_summary jsonb:='[]'::jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  PERFORM public.guild2_refresh_monthly_scores(v_class,p_year_month);
  v_preview:=public.guild5_build_close_preview(v_class,v_season,p_year_month);

  SELECT * INTO v_closure
  FROM public.guild5_month_closures
  WHERE classroom_id=v_class AND season_id=v_season AND year_month=p_year_month;

  v_current:=v_closure.current_version_id;
  IF v_current IS NOT NULL AND v_closure.lifecycle_state='FINALIZED' THEN
    PERFORM public.guild5_process_due_conquest_internal(v_current);
  END IF;

  IF v_current IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'slot_no',e.slot_no,'territory_id',e.territory_id,'territory_name',e.territory_name_snapshot,
      'territory_description',e.territory_description_snapshot,'tax_rate_percent',e.tax_rate_percent_snapshot,
      'auction_category',e.auction_category,'auction_id',e.auction_id,'auction_round_number',e.auction_round_number,
      'auction_school_year',e.auction_school_year,'auction_ended_at',e.auction_ended_at,
      'settled_item_count',e.settled_item_count,'gross_spend',e.gross_spend,'projected_revenue',e.projected_revenue,
      'snapshot',true
    ) ORDER BY e.slot_no),'[]'::jsonb)
    INTO v_territory_economy
    FROM public.guild5_territory_economy_snapshots e
    WHERE e.version_id=v_current;

    v_tax_summary:=public.guild5_get_territory_tax_summary(v_current);
  END IF;

  IF v_territory_economy IS NULL OR jsonb_array_length(v_territory_economy)=0 THEN
    v_territory_economy:=public.guild5_build_territory_auction_economy(v_class,v_season);
  END IF;

  SELECT jsonb_build_object(
    'preview',v_preview,
    'season',(SELECT to_jsonb(s) FROM (SELECT id,display_name,school_year,starts_on,ends_on,lifecycle_status FROM public.guild_seasons WHERE id=v_season) s),
    'season_lock',(SELECT to_jsonb(sl) FROM public.guild5_season_locks sl WHERE sl.season_id=v_season),
    'is_test_fixture',EXISTS(SELECT 1 FROM public.test_classroom_fixtures f WHERE f.classroom_id=v_class AND f.fixture_code='BRAND_TEST_V1'),
    'territories',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY slot_no) FROM public.guild5_territories t WHERE t.classroom_id=v_class AND t.season_id=v_season),'[]'::jsonb),
    'territory_economy',coalesce(v_territory_economy,'[]'::jsonb),
    'territory_tax_summary',coalesce(v_tax_summary,'[]'::jsonb),
    'closure',CASE WHEN v_closure.id IS NULL THEN NULL ELSE to_jsonb(v_closure) END,
    'versions',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no DESC) FROM public.guild5_closure_versions v WHERE v.closure_id=v_closure.id),'[]'::jsonb),
    'guild_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(gs) ORDER BY rank_position) FROM public.guild5_guild_snapshots gs WHERE gs.version_id=v_current),'[]'::jsonb),
    'student_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(ss) ORDER BY guild_id,student_id) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_current),'[]'::jsonb),
    'conquest_turns',coalesce((SELECT jsonb_agg(to_jsonb(ct) ORDER BY rank_position) FROM public.guild5_conquest_turns ct WHERE ct.version_id=v_current),'[]'::jsonb),
    'audit',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY occurred_at DESC,id DESC) FROM public.guild5_audit_events a WHERE a.closure_id=v_closure.id),'[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.student_get_guild5_monthly_history()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_student integer;
  v_class integer;
  v_result jsonb;
BEGIN
  v_student:=public.current_student_id();
  v_class:=public.current_classroom_id();
  IF v_student IS NULL OR v_class IS NULL THEN
    RAISE EXCEPTION '[G5] student context missing.' USING ERRCODE='P0540';
  END IF;

  SELECT coalesce(jsonb_agg(item ORDER BY item->>'year_month' DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'year_month',c.year_month,
      'version_no',v.version_no,
      'finalized_at',v.finalized_at,
      'my_contribution',to_jsonb(ss),
      'my_guild',to_jsonb(gs) || jsonb_build_object(
        'cumulative_final_gs',(
          SELECT coalesce(sum(gs2.total_gs),0)
          FROM public.guild5_month_closures c2
          JOIN public.guild5_guild_snapshots gs2 ON gs2.version_id=c2.current_version_id
          WHERE c2.classroom_id=v_class AND c2.lifecycle_state='FINALIZED' AND gs2.guild_id=ss.guild_id
        )
      ),
      'territory',(
        SELECT to_jsonb(ct) || jsonb_build_object(
          'territory_slot_no',ct.territory_slot_no_snapshot,
          'tax_rate_percent',ct.territory_tax_rate_snapshot,
          'territory_description',ct.territory_description_snapshot
        )
        FROM public.guild5_conquest_turns ct
        WHERE ct.version_id=v.id AND ct.guild_id=ss.guild_id AND ct.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
      ),
      'territory_economy',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'slot_no',e.slot_no,'territory_id',e.territory_id,'territory_name',e.territory_name_snapshot,
          'territory_description',e.territory_description_snapshot,'tax_rate_percent',e.tax_rate_percent_snapshot,
          'auction_category',e.auction_category,'auction_id',e.auction_id,'auction_round_number',e.auction_round_number,
          'auction_school_year',e.auction_school_year,'auction_ended_at',e.auction_ended_at,
          'settled_item_count',e.settled_item_count,'gross_spend',e.gross_spend,'projected_revenue',e.projected_revenue,
          'snapshot',true
        ) ORDER BY e.slot_no),'[]'::jsonb)
        FROM public.guild5_territory_economy_snapshots e
        WHERE e.version_id=v.id
      ),
      'territory_tax_summary',public.guild5_get_territory_tax_summary(v.id),
      'rankings',(
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'guild_id',r.guild_id,'guild_name_at_close',r.guild_name_at_close,'guild_logo_url_at_close',r.guild_logo_url_at_close,
          'rank_position',r.rank_position,'total_gs',r.total_gs,'territory',ct2.territory_name_snapshot,
          'territory_id',ct2.territory_id,'territory_slot_no',ct2.territory_slot_no_snapshot,
          'tax_rate_percent',ct2.territory_tax_rate_snapshot,'territory_description',ct2.territory_description_snapshot
        ) ORDER BY r.rank_position),'[]'::jsonb)
        FROM public.guild5_guild_snapshots r
        LEFT JOIN public.guild5_conquest_turns ct2
          ON ct2.version_id=v.id AND ct2.guild_id=r.guild_id AND ct2.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
        WHERE r.version_id=v.id
      )
    ) AS item
    FROM public.guild5_month_closures c
    JOIN public.guild5_closure_versions v ON v.id=c.current_version_id
    JOIN public.guild5_student_snapshots ss ON ss.version_id=v.id AND ss.student_id=v_student
    JOIN public.guild5_guild_snapshots gs ON gs.version_id=v.id AND gs.guild_id=ss.guild_id
    WHERE c.classroom_id=v_class AND c.lifecycle_state='FINALIZED'
  ) q;

  RETURN v_result;
END;
$function$;

COMMIT;
