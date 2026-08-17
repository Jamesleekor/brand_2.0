-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 4-A2 Peer Review Round Finalization
-- 2026-08-16
--
-- Depends on: 20260816_03_guild4_peer_review_foundation.sql
--
-- Implements the LOCKED per-round rules that do not require a monthly
-- multi-round aggregation decision:
--   * reviewer tendency correction cap ±1.5
--   * target-median influence cap ±2
--   * round result /300
--   * one 2,000 GOLD missing-review penalty per reviewer per round
--   * insufficient funds never abort round finalization
--   * penalty POSTED / PENDING_FUNDS / WAIVED with reversal audit
--   * Guild3 VOID preserves review history, excludes the source, and clears
--     any posted/pending missing-review penalty through audited reconciliation
--
-- Intentionally NOT implemented here:
--   * aggregation of multiple finalized peer rounds in one month into the
--     single Guild2 Peer /300 component. Existing project documents do not
--     specify whether that monthly aggregation is equal-weight, mission-weight,
--     or another normalization. That adapter must not guess.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild4_peer_review_rounds') IS NULL
     OR to_regclass('public.guild4_peer_review_obligations') IS NULL
     OR to_regclass('public.guild4_peer_review_revisions') IS NULL
     OR to_regclass('public.guild4_peer_review_penalties') IS NULL
     OR to_regclass('public.guild4_peer_review_score_rollups') IS NULL THEN
    RAISE EXCEPTION '[G4-A2] Guild4-A1 foundation must be applied first.';
  END IF;

  IF to_regprocedure('public.create_transaction(integer,public.value_token_type,bigint,public.transaction_source_type,bigint,bigint,text)') IS NULL
     OR to_regprocedure('public.reverse_transaction(bigint,text)') IS NULL THEN
    RAISE EXCEPTION '[G4-A2] economy ledger helpers are missing.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Extend current projections for finalized scoring / source VOID / penalty.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild4_peer_review_rounds
  ADD COLUMN IF NOT EXISTS monthly_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_void_reason text;

ALTER TABLE public.guild4_peer_review_rounds
  DROP CONSTRAINT IF EXISTS guild4_rounds_source_void_shape_check;
ALTER TABLE public.guild4_peer_review_rounds
  ADD CONSTRAINT guild4_rounds_source_void_shape_check CHECK (
    (monthly_eligible = true AND source_voided_at IS NULL AND source_void_reason IS NULL)
    OR
    (monthly_eligible = false
      AND source_voided_at IS NOT NULL
      AND char_length(btrim(coalesce(source_void_reason,''))) BETWEEN 2 AND 500)
  );

ALTER TABLE public.guild4_peer_review_penalties
  ADD COLUMN IF NOT EXISTS reversal_transaction_id bigint REFERENCES public.transactions(id),
  ADD COLUMN IF NOT EXISTS last_failure_reason text;

ALTER TABLE public.guild4_peer_review_score_rollups
  ADD COLUMN IF NOT EXISTS target_median numeric(8,4),
  ADD COLUMN IF NOT EXISTS final_rating numeric(8,4),
  ADD COLUMN IF NOT EXISTS peer_points numeric(8,2);

ALTER TABLE public.guild4_peer_review_score_rollups
  DROP CONSTRAINT IF EXISTS guild4_score_rollups_rating_range_check;
ALTER TABLE public.guild4_peer_review_score_rollups
  ADD CONSTRAINT guild4_score_rollups_rating_range_check CHECK (
    final_rating IS NULL OR final_rating BETWEEN 1 AND 10
  );
ALTER TABLE public.guild4_peer_review_score_rollups
  DROP CONSTRAINT IF EXISTS guild4_score_rollups_points_range_check;
ALTER TABLE public.guild4_peer_review_score_rollups
  ADD CONSTRAINT guild4_score_rollups_points_range_check CHECK (
    peer_points IS NULL OR peer_points BETWEEN 0 AND 300
  );

CREATE INDEX IF NOT EXISTS ix_guild4_rounds_monthly_eligible
  ON public.guild4_peer_review_rounds(classroom_id,season_id,monthly_eligible,lifecycle_state,id);

-- -----------------------------------------------------------------------------
-- 2. Round score calculation — exact LOCKED two-stage correction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild4_calculate_peer_review_round_scores(p_round_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_calculated integer:=0;
  v_excluded integer:=0;
BEGIN
  SELECT * INTO v_round
  FROM public.guild4_peer_review_rounds
  WHERE id=p_round_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '[G4] round not found.' USING ERRCODE='P0450';
  END IF;

  IF NOT v_round.monthly_eligible THEN
    UPDATE public.guild4_peer_review_score_rollups
    SET rollup_status='EXCLUDED',eligible_review_count=0,target_median=NULL,final_rating=NULL,peer_points=NULL,
        raw_payload=jsonb_build_object('excluded_reason','SOURCE_GUILD3_VOIDED','source_voided_at',v_round.source_voided_at,'source_void_reason',v_round.source_void_reason),
        calculated_at=now(),calculation_version=1
    WHERE round_id=v_round.id;
    GET DIAGNOSTICS v_excluded=ROW_COUNT;
    RETURN jsonb_build_object('round_id',v_round.id,'calculated',0,'excluded',v_excluded,'monthly_eligible',false);
  END IF;

  WITH valid_reviews AS (
    SELECT
      o.id AS obligation_id,
      o.reviewer_student_id,
      o.target_student_id,
      rv.id AS revision_id,
      rv.revision_number,
      rv.score::numeric AS raw_score,
      rv.comment,
      rv.submitted_at
    FROM public.guild4_peer_review_obligations o
    JOIN public.guild4_peer_review_revisions rv ON rv.id=o.latest_review_revision_id
    WHERE o.round_id=v_round.id
      AND o.obligation_status='REQUIRED'
  ), reviewer_stats AS (
    SELECT reviewer_student_id,avg(raw_score)::numeric(12,6) AS reviewer_mean
    FROM valid_reviews
    GROUP BY reviewer_student_id
  ), reviewer_center AS (
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY reviewer_mean::double precision)::numeric(12,6) AS center
    FROM reviewer_stats
  ), stage_a AS (
    SELECT
      vr.*,
      rs.reviewer_mean,
      rc.center,
      greatest(-1.5::numeric,least(1.5::numeric,rs.reviewer_mean-rc.center))::numeric(12,6) AS reviewer_bias,
      greatest(1::numeric,least(10::numeric,
        vr.raw_score-greatest(-1.5::numeric,least(1.5::numeric,rs.reviewer_mean-rc.center))
      ))::numeric(12,6) AS stage_a_score
    FROM valid_reviews vr
    JOIN reviewer_stats rs USING(reviewer_student_id)
    CROSS JOIN reviewer_center rc
  ), target_stats AS (
    SELECT target_student_id,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY stage_a_score::double precision)::numeric(12,6) AS target_median
    FROM stage_a
    GROUP BY target_student_id
  ), stage_b AS (
    SELECT
      a.*,
      ts.target_median,
      greatest(1::numeric,least(10::numeric,
        greatest(ts.target_median-2::numeric,least(ts.target_median+2::numeric,a.stage_a_score))
      ))::numeric(12,6) AS final_corrected_score
    FROM stage_a a
    JOIN target_stats ts USING(target_student_id)
  ), target_summary AS (
    SELECT
      target_student_id,
      count(*)::integer AS eligible_review_count,
      max(target_median)::numeric(8,4) AS target_median,
      avg(final_corrected_score)::numeric(8,4) AS final_rating,
      round((avg(final_corrected_score)/10::numeric)*300::numeric,2)::numeric(8,2) AS peer_points,
      jsonb_build_object(
        'formula_version','GUILD4_PEER_V1_2026',
        'reviewer_center',max(center),
        'target_median',max(target_median),
        'reviews',jsonb_agg(jsonb_build_object(
          'obligation_id',obligation_id,
          'revision_id',revision_id,
          'revision_number',revision_number,
          'reviewer_student_id',reviewer_student_id,
          'raw_score',raw_score,
          'reviewer_mean',reviewer_mean,
          'reviewer_bias',reviewer_bias,
          'stage_a_score',stage_a_score,
          'target_median',target_median,
          'final_corrected_score',final_corrected_score,
          'submitted_at',submitted_at,
          'comment',comment
        ) ORDER BY reviewer_student_id)
      ) AS raw_payload
    FROM stage_b
    GROUP BY target_student_id
  )
  UPDATE public.guild4_peer_review_score_rollups sr
  SET rollup_status='CALCULATED',
      eligible_review_count=s.eligible_review_count,
      target_median=s.target_median,
      final_rating=s.final_rating,
      peer_points=s.peer_points,
      raw_payload=s.raw_payload,
      calculated_at=now(),
      calculation_version=1
  FROM target_summary s
  WHERE sr.round_id=v_round.id
    AND sr.student_id=s.target_student_id;

  GET DIAGNOSTICS v_calculated=ROW_COUNT;

  UPDATE public.guild4_peer_review_score_rollups sr
  SET rollup_status='EXCLUDED',eligible_review_count=0,target_median=NULL,final_rating=NULL,peer_points=NULL,
      raw_payload=jsonb_build_object('excluded_reason','NO_ELIGIBLE_RECEIVED_REVIEWS','formula_version','GUILD4_PEER_V1_2026'),
      calculated_at=now(),calculation_version=1
  WHERE sr.round_id=v_round.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.guild4_peer_review_obligations o
      WHERE o.round_id=v_round.id
        AND o.target_student_id=sr.student_id
        AND o.obligation_status='REQUIRED'
        AND o.latest_review_revision_id IS NOT NULL
    );
  GET DIAGNOSTICS v_excluded=ROW_COUNT;

  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_round.classroom_id,'ROUND_SCORES_CALCULATED',NULL,'{}'::jsonb,
    jsonb_build_object('calculated_targets',v_calculated,'excluded_targets',v_excluded,'formula_version','GUILD4_PEER_V1_2026'),auth.uid()
  );

  RETURN jsonb_build_object('round_id',v_round.id,'calculated',v_calculated,'excluded',v_excluded,'formula_version','GUILD4_PEER_V1_2026');
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Missing-review penalty decision / posting helper.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild4_evaluate_peer_review_penalties(p_round_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_penalty public.guild4_peer_review_penalties%ROWTYPE;
  v_missing integer;
  v_tx bigint;
  v_posted integer:=0;
  v_pending integer:=0;
  v_none integer:=0;
  v_waived integer:=0;
BEGIN
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[G4] round not found.' USING ERRCODE='P0451'; END IF;

  FOR v_penalty IN
    SELECT * FROM public.guild4_peer_review_penalties
    WHERE round_id=v_round.id
    ORDER BY student_id
    FOR UPDATE
  LOOP
    SELECT count(*)::integer INTO v_missing
    FROM public.guild4_peer_review_obligations o
    WHERE o.round_id=v_round.id
      AND o.reviewer_student_id=v_penalty.student_id
      AND o.obligation_status='REQUIRED'
      AND o.latest_review_revision_id IS NULL;

    IF NOT v_round.monthly_eligible THEN
      IF v_penalty.penalty_status='POSTED' AND v_penalty.transaction_id IS NOT NULL AND v_penalty.reversal_transaction_id IS NULL THEN
        v_tx:=public.reverse_transaction(v_penalty.transaction_id,'Guild3 원본 미션 VOID로 인한 Guild4 미제출 벌금 자동 취소');
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='WAIVED',missing_required_count=v_missing,
            waiver_reason='Guild3 원본 미션 VOID',waived_at=now(),waived_by_user_id=auth.uid(),
            reversal_transaction_id=v_tx,last_failure_reason=NULL
        WHERE id=v_penalty.id;
      ELSIF v_penalty.penalty_status IN ('PENDING_FUNDS','NOT_EVALUATED') THEN
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='WAIVED',missing_required_count=v_missing,
            waiver_reason='Guild3 원본 미션 VOID',waived_at=now(),waived_by_user_id=auth.uid(),last_failure_reason=NULL
        WHERE id=v_penalty.id;
      END IF;
      v_waived:=v_waived+1;
      CONTINUE;
    END IF;

    IF v_missing=0 THEN
      IF v_penalty.penalty_status IN ('NOT_EVALUATED','PENDING_FUNDS') THEN
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='NO_PENALTY',missing_required_count=0,evaluated_at=now(),last_failure_reason=NULL
        WHERE id=v_penalty.id;
      END IF;
      v_none:=v_none+1;
      CONTINUE;
    END IF;

    IF v_penalty.penalty_status='WAIVED' THEN
      UPDATE public.guild4_peer_review_penalties SET missing_required_count=v_missing,evaluated_at=coalesce(evaluated_at,now()) WHERE id=v_penalty.id;
      v_waived:=v_waived+1;
      CONTINUE;
    END IF;

    IF v_penalty.penalty_status='POSTED' THEN
      UPDATE public.guild4_peer_review_penalties SET missing_required_count=v_missing,evaluated_at=coalesce(evaluated_at,now()) WHERE id=v_penalty.id;
      v_posted:=v_posted+1;
      CONTINUE;
    END IF;

    BEGIN
      v_tx:=public.create_transaction(
        v_penalty.student_id,
        'GOLD'::public.value_token_type,
        -2000,
        'TEACHER_DEDUCT'::public.transaction_source_type,
        v_penalty.id,
        0,
        format('[Guild4 동료평가 미제출 벌금] round #%s · 미완료 의무 %s건 · round당 1회 2,000 GOLD',v_round.id,v_missing)
      );

      UPDATE public.guild4_peer_review_penalties
      SET penalty_status='POSTED',missing_required_count=v_missing,transaction_id=v_tx,
          evaluated_at=now(),last_failure_reason=NULL
      WHERE id=v_penalty.id;
      v_posted:=v_posted+1;
    EXCEPTION
      WHEN SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0004' OR SQLSTATE 'P0733' THEN
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='PENDING_FUNDS',missing_required_count=v_missing,evaluated_at=now(),
            last_failure_reason=SQLERRM
        WHERE id=v_penalty.id;
        v_pending:=v_pending+1;
    END;
  END LOOP;

  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_round.classroom_id,'ROUND_PENALTIES_EVALUATED',NULL,'{}'::jsonb,
    jsonb_build_object('posted',v_posted,'pending_funds',v_pending,'no_penalty',v_none,'waived',v_waived,'amount_per_penalized_reviewer',2000),auth.uid()
  );

  RETURN jsonb_build_object('round_id',v_round.id,'posted',v_posted,'pending_funds',v_pending,'no_penalty',v_none,'waived',v_waived);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Teacher finalize / penalty retry / waiver.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_finalize_guild4_peer_review_round(p_round_id bigint,p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_scores jsonb;
  v_penalties jsonb;
  v_reason text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
  IF v_reason IS NOT NULL AND char_length(v_reason)>500 THEN
    RAISE EXCEPTION '[G4] finalize reason must be <=500 characters.' USING ERRCODE='P0452';
  END IF;

  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] round not found in teacher classroom.' USING ERRCODE='P0453';
  END IF;
  IF v_round.lifecycle_state<>'CLOSED' THEN
    RAISE EXCEPTION '[G4] only CLOSED round can be finalized.' USING ERRCODE='P0454';
  END IF;
  IF NOT v_round.monthly_eligible THEN
    RAISE EXCEPTION '[G4] source Guild3 mission is VOIDED; this round is historical only.' USING ERRCODE='P0455';
  END IF;

  v_scores:=public.guild4_calculate_peer_review_round_scores(v_round.id);
  v_penalties:=public.guild4_evaluate_peer_review_penalties(v_round.id);

  UPDATE public.guild4_peer_review_rounds
  SET lifecycle_state='FINALIZED',finalized_at=now()
  WHERE id=v_round.id;

  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_classroom_id,'ROUND_FINALIZED',v_reason,
    jsonb_build_object('lifecycle_state','CLOSED'),
    jsonb_build_object('lifecycle_state','FINALIZED','finalized_at',now(),'scores',v_scores,'penalties',v_penalties),auth.uid()
  );

  RETURN jsonb_build_object('round_id',v_round.id,'lifecycle_state','FINALIZED','scores',v_scores,'penalties',v_penalties);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_retry_guild4_peer_review_penalty(p_penalty_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_penalty public.guild4_peer_review_penalties%ROWTYPE;
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_penalty FROM public.guild4_peer_review_penalties WHERE id=p_penalty_id;
  IF NOT FOUND THEN RAISE EXCEPTION '[G4] penalty not found.' USING ERRCODE='P0456'; END IF;
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=v_penalty.round_id;
  IF v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] penalty not found in teacher classroom.' USING ERRCODE='P0457';
  END IF;
  IF v_penalty.penalty_status<>'PENDING_FUNDS' THEN
    RAISE EXCEPTION '[G4] only PENDING_FUNDS penalty can be retried.' USING ERRCODE='P0458';
  END IF;
  v_result:=public.guild4_evaluate_peer_review_penalties(v_round.id);
  RETURN jsonb_build_object('penalty_id',p_penalty_id,'round_result',v_result,
    'penalty',(SELECT to_jsonb(p) FROM public.guild4_peer_review_penalties p WHERE p.id=p_penalty_id));
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_waive_guild4_peer_review_penalty(p_penalty_id bigint,p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_penalty public.guild4_peer_review_penalties%ROWTYPE;
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_reason text;
  v_reversal bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=btrim(coalesce(p_reason,''));
  IF char_length(v_reason)<2 OR char_length(v_reason)>500 THEN
    RAISE EXCEPTION '[G4] waiver reason must be 2-500 characters.' USING ERRCODE='P0459';
  END IF;

  SELECT * INTO v_penalty FROM public.guild4_peer_review_penalties WHERE id=p_penalty_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[G4] penalty not found.' USING ERRCODE='P0460'; END IF;
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=v_penalty.round_id FOR UPDATE;
  IF v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] penalty not found in teacher classroom.' USING ERRCODE='P0461';
  END IF;
  IF v_penalty.penalty_status NOT IN ('POSTED','PENDING_FUNDS') THEN
    RAISE EXCEPTION '[G4] only POSTED/PENDING_FUNDS penalty can be waived.' USING ERRCODE='P0462';
  END IF;

  IF v_penalty.penalty_status='POSTED' AND v_penalty.transaction_id IS NOT NULL THEN
    v_reversal:=public.reverse_transaction(v_penalty.transaction_id,'Guild4 벌금 면제: '||v_reason);
  END IF;

  UPDATE public.guild4_peer_review_penalties
  SET penalty_status='WAIVED',waiver_reason=v_reason,waived_at=now(),waived_by_user_id=auth.uid(),
      reversal_transaction_id=coalesce(v_reversal,reversal_transaction_id),last_failure_reason=NULL
  WHERE id=v_penalty.id;

  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_classroom_id,'PENALTY_WAIVED',v_reason,
    jsonb_build_object('penalty_id',v_penalty.id,'previous_status',v_penalty.penalty_status,'transaction_id',v_penalty.transaction_id),
    jsonb_build_object('penalty_id',v_penalty.id,'penalty_status','WAIVED','reversal_transaction_id',v_reversal),auth.uid()
  );

  RETURN jsonb_build_object('penalty_id',v_penalty.id,'penalty_status','WAIVED','reversal_transaction_id',v_reversal);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Guild3 VOID reconciliation via opening-status trigger.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild4_on_source_opening_voided()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_penalty public.guild4_peer_review_penalties%ROWTYPE;
  v_reversal bigint;
  v_reason text;
BEGIN
  IF NOT (OLD.opening_status IS DISTINCT FROM NEW.opening_status AND NEW.opening_status='VOIDED') THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_round
  FROM public.guild4_peer_review_rounds
  WHERE source_opening_id=NEW.id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_reason:=coalesce(nullif(btrim(NEW.void_reason),''),'Guild3 원본 미션 VOID');

  UPDATE public.guild4_peer_review_rounds
  SET monthly_eligible=false,source_voided_at=coalesce(NEW.voided_at,now()),source_void_reason=left(v_reason,500)
  WHERE id=v_round.id;

  FOR v_penalty IN
    SELECT * FROM public.guild4_peer_review_penalties WHERE round_id=v_round.id FOR UPDATE
  LOOP
    v_reversal:=NULL;
    IF v_penalty.penalty_status='POSTED' AND v_penalty.transaction_id IS NOT NULL AND v_penalty.reversal_transaction_id IS NULL THEN
      v_reversal:=public.reverse_transaction(v_penalty.transaction_id,'Guild3 원본 미션 VOID: '||left(v_reason,150));
    END IF;

    IF v_penalty.penalty_status IN ('POSTED','PENDING_FUNDS','NOT_EVALUATED') THEN
      UPDATE public.guild4_peer_review_penalties
      SET penalty_status='WAIVED',waiver_reason=left('Guild3 원본 미션 VOID: '||v_reason,500),
          waived_at=now(),waived_by_user_id=auth.uid(),reversal_transaction_id=coalesce(v_reversal,reversal_transaction_id),
          last_failure_reason=NULL
      WHERE id=v_penalty.id;
    END IF;
  END LOOP;

  UPDATE public.guild4_peer_review_score_rollups
  SET rollup_status='EXCLUDED',peer_points=NULL,final_rating=NULL,target_median=NULL,
      raw_payload=raw_payload||jsonb_build_object('excluded_reason','SOURCE_GUILD3_VOIDED','source_voided_at',NEW.voided_at,'source_void_reason',v_reason),
      calculated_at=now()
  WHERE round_id=v_round.id;

  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_round.classroom_id,'SOURCE_GUILD3_VOIDED',v_reason,
    jsonb_build_object('monthly_eligible',true),
    jsonb_build_object('monthly_eligible',false,'source_voided_at',NEW.voided_at),auth.uid()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guild4_reconcile_source_void_on_opening ON public.guild3_peer_review_openings;
CREATE TRIGGER guild4_reconcile_source_void_on_opening
AFTER UPDATE OF opening_status,voided_at,void_reason ON public.guild3_peer_review_openings
FOR EACH ROW EXECUTE FUNCTION public.guild4_on_source_opening_voided();

-- -----------------------------------------------------------------------------
-- 6. Replace purpose-specific reads with finalized score/penalty projections.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_guild4_peer_review_rounds()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_student_id integer; v_classroom_id integer; v_result jsonb;
BEGIN
  v_student_id:=public.current_student_id();
  v_classroom_id:=public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[G4] student context is missing.' USING ERRCODE='P0440';
  END IF;

  SELECT coalesce(jsonb_agg(round_row ORDER BY (round_row->>'source_finalized_at')::timestamptz DESC,(round_row->>'round_id')::bigint DESC),'[]'::jsonb)
  INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'round_id',r.id,
      'mission_id',r.mission_id,
      'mission_title',m.title,
      'guild_name',p.guild_name_at_snapshot,
      'lifecycle_state',r.lifecycle_state,
      'deadline_at',r.deadline_at,
      'source_finalized_at',r.source_finalized_at,
      'monthly_eligible',r.monthly_eligible,
      'required_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.reviewer_student_id=v_student_id AND o.obligation_status='REQUIRED'),
      'submitted_required_count',(SELECT count(*) FROM public.guild4_peer_review_obligations o WHERE o.round_id=r.id AND o.reviewer_student_id=v_student_id AND o.obligation_status='REQUIRED' AND o.latest_review_revision_id IS NOT NULL),
      'my_peer_points',CASE WHEN r.lifecycle_state='FINALIZED' AND r.monthly_eligible THEN sr.peer_points ELSE NULL END,
      'peer_result_explanation',CASE WHEN r.lifecycle_state='FINALIZED' AND r.monthly_eligible AND sr.peer_points IS NOT NULL THEN '길드원들의 평가를 종합·보정하여 반영한 점수입니다.' ELSE NULL END,
      'obligations',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'obligation_id',o.id,
          'target_student_id',o.target_student_id,
          'target_name',tp.student_name_at_snapshot,
          'obligation_status',o.obligation_status,
          'latest_review_revision_number',o.latest_review_revision_number,
          'latest_score',rv.score,
          'latest_comment',rv.comment,
          'latest_submitted_at',o.latest_submitted_at
        ) ORDER BY tp.student_id)
        FROM public.guild4_peer_review_obligations o
        JOIN public.guild4_peer_review_participants tp ON tp.id=o.target_participant_id
        LEFT JOIN public.guild4_peer_review_revisions rv ON rv.id=o.latest_review_revision_id
        WHERE o.round_id=r.id AND o.reviewer_student_id=v_student_id
      ),'[]'::jsonb)
    ) AS round_row
    FROM public.guild4_peer_review_participants p
    JOIN public.guild4_peer_review_rounds r ON r.id=p.round_id
    JOIN public.guild3_missions m ON m.id=r.mission_id
    LEFT JOIN public.guild4_peer_review_score_rollups sr ON sr.round_id=r.id AND sr.student_id=v_student_id
    WHERE p.student_id=v_student_id AND r.classroom_id=v_classroom_id
  ) q;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_get_guild4_peer_review_round_detail(p_round_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE v_classroom_id integer; v_round public.guild4_peer_review_rounds%ROWTYPE; v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id;
  IF NOT FOUND OR v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[G4] round not found in teacher classroom.' USING ERRCODE='P0421';
  END IF;

  SELECT jsonb_build_object(
    'round',to_jsonb(v_round),
    'mission',(SELECT jsonb_build_object('id',m.id,'title',m.title,'finalized_at',m.finalized_at,'lifecycle_state',m.lifecycle_state,'contribution_year_month',m.contribution_year_month,'weight',m.weight) FROM public.guild3_missions m WHERE m.id=v_round.mission_id),
    'participants',coalesce((
      SELECT jsonb_agg(jsonb_build_object('participant_id',p.id,'student_id',p.student_id,'student_name',p.student_name_at_snapshot) ORDER BY p.student_id)
      FROM public.guild4_peer_review_participants p WHERE p.round_id=v_round.id
    ),'[]'::jsonb),
    'obligations',coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'obligation_id',o.id,'reviewer_student_id',o.reviewer_student_id,'reviewer_name',rp.student_name_at_snapshot,
        'target_student_id',o.target_student_id,'target_name',tp.student_name_at_snapshot,
        'obligation_status',o.obligation_status,'latest_revision_number',o.latest_review_revision_number,
        'latest_submitted_at',o.latest_submitted_at,'current_exception_reason',o.current_exception_reason,
        'latest_review',CASE WHEN rv.id IS NULL THEN NULL ELSE jsonb_build_object('revision_id',rv.id,'revision_number',rv.revision_number,'score',rv.score,'comment',rv.comment,'submitted_at',rv.submitted_at) END
      ) ORDER BY rp.student_id,tp.student_id)
      FROM public.guild4_peer_review_obligations o
      JOIN public.guild4_peer_review_participants rp ON rp.id=o.reviewer_participant_id
      JOIN public.guild4_peer_review_participants tp ON tp.id=o.target_participant_id
      LEFT JOIN public.guild4_peer_review_revisions rv ON rv.id=o.latest_review_revision_id
      WHERE o.round_id=v_round.id
    ),'[]'::jsonb),
    'review_revision_history',coalesce((
      SELECT jsonb_agg(jsonb_build_object('id',rv.id,'obligation_id',rv.obligation_id,'reviewer_student_id',rv.reviewer_student_id,'target_student_id',rv.target_student_id,'revision_number',rv.revision_number,'score',rv.score,'comment',rv.comment,'submitted_at',rv.submitted_at) ORDER BY rv.submitted_at,rv.id)
      FROM public.guild4_peer_review_revisions rv WHERE rv.round_id=v_round.id
    ),'[]'::jsonb),
    'score_rollups',coalesce((SELECT jsonb_agg(to_jsonb(sr) ORDER BY sr.student_id) FROM public.guild4_peer_review_score_rollups sr WHERE sr.round_id=v_round.id),'[]'::jsonb),
    'penalties',coalesce((SELECT jsonb_agg(to_jsonb(pen) ORDER BY pen.student_id) FROM public.guild4_peer_review_penalties pen WHERE pen.round_id=v_round.id),'[]'::jsonb),
    'audit_history',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.occurred_at,a.id) FROM public.guild4_peer_review_audit_events a WHERE a.round_id=v_round.id),'[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges — internal helpers remain non-browser-callable.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guild4_calculate_peer_review_round_scores(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_evaluate_peer_review_penalties(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_on_source_opening_voided() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild4_calculate_peer_review_round_scores(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.guild4_evaluate_peer_review_penalties(bigint) TO service_role;

REVOKE ALL ON FUNCTION public.teacher_finalize_guild4_peer_review_round(bigint,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_retry_guild4_peer_review_penalty(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_waive_guild4_peer_review_penalty(bigint,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_finalize_guild4_peer_review_round(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_retry_guild4_peer_review_penalty(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_waive_guild4_peer_review_penalty(bigint,text) TO authenticated;

-- Existing read RPC signatures were replaced in place; preserve grants.
GRANT EXECUTE ON FUNCTION public.student_get_guild4_peer_review_rounds() TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_guild4_peer_review_round_detail(bigint) TO authenticated;

COMMIT;
