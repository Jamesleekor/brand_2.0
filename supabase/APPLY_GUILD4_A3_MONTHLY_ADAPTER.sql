-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 4-A3 Monthly Peer /300 Adapter + Correction Flow
-- 2026-08-16
--
-- User-confirmed monthly aggregation:
--   Guild3 mission weight weighted average across peer-review-required missions.
--
-- Monthly denominator semantics mirror Guild3 Mission normalization:
--   * peer_review_required=true only
--   * CANCELLED / VOIDED excluded
--   * DRAFT/ACTIVE/CLOSED valid missions remain in the denominator, so draft
--     Peer points are provisional until every valid source round is FINALIZED
--   * a month with no valid peer-review-required mission is READY with Peer=0
--
-- Also completes the locked FINALIZED correction contract with append-only
-- review/exception evidence. Guild5 FINAL/REOPEN freeze is intentionally added
-- by Guild5, because that ownership table does not exist yet.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.guild4_peer_review_rounds') IS NULL
     OR to_regclass('public.guild4_peer_review_score_rollups') IS NULL
     OR to_regprocedure('public.guild4_calculate_peer_review_round_scores(bigint)') IS NULL
     OR to_regprocedure('public.guild4_evaluate_peer_review_penalties(bigint)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL THEN
    RAISE EXCEPTION '[G4-A3] Guild4-A1/A2 and Guild2 refresh must exist first.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Monthly readiness / weighted component source.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild4_peer_month_is_ready(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.guild3_missions m
    LEFT JOIN public.guild3_peer_review_openings o
      ON o.mission_id=m.id
     AND o.mission_instance_id IS NOT NULL
     AND o.opening_status='OPENABLE'
    LEFT JOIN public.guild4_peer_review_rounds r
      ON r.source_opening_id=o.id
     AND r.monthly_eligible=true
    WHERE m.classroom_id=p_classroom_id
      AND m.season_id=p_season_id
      AND m.contribution_year_month=p_year_month
      AND m.peer_review_required=true
      AND m.lifecycle_state NOT IN ('CANCELLED','VOIDED')
      AND (
        m.lifecycle_state<>'FINALIZED'
        OR o.id IS NULL
        OR r.id IS NULL
        OR r.lifecycle_state<>'FINALIZED'
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.guild4_peer_component_rollup(
  p_classroom_id integer,
  p_season_id integer,
  p_year_month text
)
RETURNS TABLE(
  student_id integer,
  peer_points numeric,
  peer_status text,
  guild_ids integer[]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_ready boolean;
BEGIN
  v_ready:=public.guild4_peer_month_is_ready(p_classroom_id,p_season_id,p_year_month);

  RETURN QUERY
  WITH valid_missions AS (
    SELECT m.id,
           m.weight,
           m.lifecycle_state,
           sum(m.weight) OVER () AS monthly_weight_sum
    FROM public.guild3_missions m
    WHERE m.classroom_id=p_classroom_id
      AND m.season_id=p_season_id
      AND m.contribution_year_month=p_year_month
      AND m.peer_review_required=true
      AND m.lifecycle_state NOT IN ('CANCELLED','VOIDED')
  ), participant_scope AS (
    SELECT p.student_id,
           p.guild_id,
           vm.id AS mission_id,
           vm.weight,
           vm.monthly_weight_sum,
           vm.lifecycle_state,
           p.mission_instance_id
    FROM valid_missions vm
    JOIN public.guild3_mission_participants p ON p.mission_id=vm.id
  ), scored AS (
    SELECT ps.*,
           r.id AS round_id,
           r.lifecycle_state AS round_state,
           r.monthly_eligible,
           sr.peer_points AS round_peer_points
    FROM participant_scope ps
    LEFT JOIN public.guild3_peer_review_openings o
      ON o.mission_id=ps.mission_id
     AND o.mission_instance_id=ps.mission_instance_id
     AND o.opening_status='OPENABLE'
    LEFT JOIN public.guild4_peer_review_rounds r
      ON r.source_opening_id=o.id
    LEFT JOIN public.guild4_peer_review_score_rollups sr
      ON sr.round_id=r.id
     AND sr.student_id=ps.student_id
     AND sr.rollup_status='CALCULATED'
  )
  SELECT s.student_id,
         least(
           coalesce(sum(
             CASE
               WHEN s.lifecycle_state='FINALIZED'
                AND s.round_state='FINALIZED'
                AND coalesce(s.monthly_eligible,false)
                AND s.round_peer_points IS NOT NULL
               THEN s.round_peer_points*s.weight/nullif(s.monthly_weight_sum,0)
               ELSE 0::numeric
             END
           ),0::numeric),
           300::numeric
         )::numeric(18,8) AS peer_points,
         CASE WHEN v_ready THEN 'READY' ELSE 'NOT_READY' END AS peer_status,
         array_agg(DISTINCT s.guild_id ORDER BY s.guild_id) AS guild_ids
  FROM scored s
  GROUP BY s.student_id;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Penalty reconciliation enhancement for audited FINALIZED exceptions.
--    If a correction removes the last missing REQUIRED obligation, reverse an
--    already-posted penalty instead of leaving a stale deduction behind.
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
  v_reversed integer:=0;
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
      ELSIF v_penalty.penalty_status IN ('PENDING_FUNDS','NOT_EVALUATED','NO_PENALTY') THEN
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='WAIVED',missing_required_count=v_missing,
            waiver_reason='Guild3 원본 미션 VOID',waived_at=now(),waived_by_user_id=auth.uid(),last_failure_reason=NULL
        WHERE id=v_penalty.id;
      END IF;
      v_waived:=v_waived+1;
      CONTINUE;
    END IF;

    IF v_missing=0 THEN
      IF v_penalty.penalty_status='POSTED' AND v_penalty.transaction_id IS NOT NULL AND v_penalty.reversal_transaction_id IS NULL THEN
        v_tx:=public.reverse_transaction(v_penalty.transaction_id,'Guild4 FINALIZED 예외 정정으로 미제출 벌금 자동 취소');
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='NO_PENALTY',missing_required_count=0,evaluated_at=now(),
            reversal_transaction_id=v_tx,last_failure_reason=NULL
        WHERE id=v_penalty.id;
        v_reversed:=v_reversed+1;
      ELSIF v_penalty.penalty_status IN ('NOT_EVALUATED','PENDING_FUNDS') THEN
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='NO_PENALTY',missing_required_count=0,evaluated_at=now(),last_failure_reason=NULL
        WHERE id=v_penalty.id;
      END IF;
      v_none:=v_none+1;
      CONTINUE;
    END IF;

    IF v_penalty.penalty_status='WAIVED' THEN
      UPDATE public.guild4_peer_review_penalties
      SET missing_required_count=v_missing,evaluated_at=coalesce(evaluated_at,now())
      WHERE id=v_penalty.id;
      v_waived:=v_waived+1;
      CONTINUE;
    END IF;

    IF v_penalty.penalty_status='POSTED' THEN
      UPDATE public.guild4_peer_review_penalties
      SET missing_required_count=v_missing,evaluated_at=coalesce(evaluated_at,now())
      WHERE id=v_penalty.id;
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
      SET penalty_status='POSTED',missing_required_count=v_missing,transaction_id=v_tx,reversal_transaction_id=NULL,
          evaluated_at=now(),last_failure_reason=NULL
      WHERE id=v_penalty.id;
      v_posted:=v_posted+1;
    EXCEPTION
      WHEN SQLSTATE 'P0002' OR SQLSTATE 'P0003' OR SQLSTATE 'P0004' OR SQLSTATE 'P0733' THEN
        UPDATE public.guild4_peer_review_penalties
        SET penalty_status='PENDING_FUNDS',missing_required_count=v_missing,evaluated_at=now(),last_failure_reason=SQLERRM
        WHERE id=v_penalty.id;
        v_pending:=v_pending+1;
    END;
  END LOOP;

  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_round.classroom_id,'ROUND_PENALTIES_EVALUATED',NULL,'{}'::jsonb,
    jsonb_build_object('posted',v_posted,'pending_funds',v_pending,'no_penalty',v_none,'waived',v_waived,'reversed',v_reversed,'amount_per_penalized_reviewer',2000),auth.uid()
  );

  RETURN jsonb_build_object('round_id',v_round.id,'posted',v_posted,'pending_funds',v_pending,'no_penalty',v_none,'waived',v_waived,'reversed',v_reversed);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. FINALIZED append-only correction RPCs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_correct_guild4_peer_review(
  p_obligation_id bigint,
  p_score integer,
  p_comment text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_ob public.guild4_peer_review_obligations%ROWTYPE;
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_old public.guild4_peer_review_revisions%ROWTYPE;
  v_revision integer;
  v_revision_id bigint;
  v_reason text;
  v_month text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=btrim(coalesce(p_reason,''));
  IF p_score NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION '[G4] score must be 1-10.' USING ERRCODE='P0463'; END IF;
  IF char_length(btrim(coalesce(p_comment,'')))<20 THEN RAISE EXCEPTION '[G4] comment must be at least 20 characters.' USING ERRCODE='P0464'; END IF;
  IF char_length(v_reason)<2 OR char_length(v_reason)>500 THEN RAISE EXCEPTION '[G4] correction reason must be 2-500 characters.' USING ERRCODE='P0465'; END IF;

  SELECT * INTO v_ob FROM public.guild4_peer_review_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[G4] obligation not found.' USING ERRCODE='P0466'; END IF;
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=v_ob.round_id FOR UPDATE;
  IF v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[G4] obligation not found in teacher classroom.' USING ERRCODE='P0467'; END IF;
  IF v_round.lifecycle_state<>'FINALIZED' OR NOT v_round.monthly_eligible THEN
    RAISE EXCEPTION '[G4] review correction requires an eligible FINALIZED round.' USING ERRCODE='P0468';
  END IF;
  IF v_ob.latest_review_revision_id IS NULL THEN
    RAISE EXCEPTION '[G4] correction cannot invent a previously missing student review; use EXCUSED correction when appropriate.' USING ERRCODE='P0469';
  END IF;

  SELECT * INTO v_old FROM public.guild4_peer_review_revisions WHERE id=v_ob.latest_review_revision_id;
  SELECT coalesce(max(revision_number),0)+1 INTO v_revision FROM public.guild4_peer_review_revisions WHERE obligation_id=v_ob.id;

  INSERT INTO public.guild4_peer_review_revisions(
    round_id,obligation_id,reviewer_student_id,target_student_id,revision_number,score,comment,submitted_by_user_id
  ) VALUES(
    v_round.id,v_ob.id,v_ob.reviewer_student_id,v_ob.target_student_id,v_revision,p_score,btrim(p_comment),auth.uid()
  ) RETURNING id INTO v_revision_id;

  UPDATE public.guild4_peer_review_obligations
  SET latest_review_revision_id=v_revision_id,latest_review_revision_number=v_revision,latest_submitted_at=now()
  WHERE id=v_ob.id;

  PERFORM public.guild4_write_audit_event(
    v_round.id,v_ob.id,v_classroom_id,'FINALIZED_REVIEW_CORRECTED',v_reason,
    jsonb_build_object('revision_id',v_old.id,'revision_number',v_old.revision_number,'score',v_old.score,'comment',v_old.comment),
    jsonb_build_object('revision_id',v_revision_id,'revision_number',v_revision,'score',p_score,'comment',btrim(p_comment)),auth.uid()
  );

  PERFORM public.guild4_calculate_peer_review_round_scores(v_round.id);
  SELECT contribution_year_month INTO v_month FROM public.guild3_missions WHERE id=v_round.mission_id;
  PERFORM public.guild2_refresh_monthly_scores(v_classroom_id,v_month);

  RETURN jsonb_build_object('obligation_id',v_ob.id,'revision_id',v_revision_id,'revision_number',v_revision,'corrected',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_correct_guild4_peer_review_exception(
  p_obligation_id bigint,
  p_excused boolean,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_classroom_id integer;
  v_ob public.guild4_peer_review_obligations%ROWTYPE;
  v_round public.guild4_peer_review_rounds%ROWTYPE;
  v_reason text;
  v_before text;
  v_after text;
  v_month text;
  v_penalties jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=btrim(coalesce(p_reason,''));
  IF char_length(v_reason)<2 OR char_length(v_reason)>500 THEN RAISE EXCEPTION '[G4] correction reason must be 2-500 characters.' USING ERRCODE='P0470'; END IF;

  SELECT * INTO v_ob FROM public.guild4_peer_review_obligations WHERE id=p_obligation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[G4] obligation not found.' USING ERRCODE='P0471'; END IF;
  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=v_ob.round_id FOR UPDATE;
  IF v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[G4] obligation not found in teacher classroom.' USING ERRCODE='P0472'; END IF;
  IF v_round.lifecycle_state<>'FINALIZED' OR NOT v_round.monthly_eligible THEN
    RAISE EXCEPTION '[G4] exception correction requires an eligible FINALIZED round.' USING ERRCODE='P0473';
  END IF;

  v_before:=v_ob.obligation_status;
  v_after:=CASE WHEN p_excused THEN 'EXCUSED' ELSE 'REQUIRED' END;
  IF v_before=v_after THEN RETURN jsonb_build_object('obligation_id',v_ob.id,'obligation_status',v_before,'changed',false); END IF;

  IF p_excused THEN
    UPDATE public.guild4_peer_review_obligations
    SET obligation_status='EXCUSED',current_exception_reason=v_reason,current_exception_at=now(),current_exception_by_user_id=auth.uid()
    WHERE id=v_ob.id;
  ELSE
    UPDATE public.guild4_peer_review_obligations
    SET obligation_status='REQUIRED',current_exception_reason=NULL,current_exception_at=NULL,current_exception_by_user_id=NULL
    WHERE id=v_ob.id;
  END IF;

  INSERT INTO public.guild4_peer_review_exception_events(round_id,obligation_id,event_kind,reason)
  VALUES(v_round.id,v_ob.id,CASE WHEN p_excused THEN 'EXCUSED' ELSE 'RESTORED' END,left('FINALIZED correction: '||v_reason,500));

  PERFORM public.guild4_write_audit_event(
    v_round.id,v_ob.id,v_classroom_id,'FINALIZED_EXCEPTION_CORRECTED',v_reason,
    jsonb_build_object('obligation_status',v_before),jsonb_build_object('obligation_status',v_after),auth.uid()
  );

  PERFORM public.guild4_calculate_peer_review_round_scores(v_round.id);
  v_penalties:=public.guild4_evaluate_peer_review_penalties(v_round.id);
  SELECT contribution_year_month INTO v_month FROM public.guild3_missions WHERE id=v_round.mission_id;
  PERFORM public.guild2_refresh_monthly_scores(v_classroom_id,v_month);

  RETURN jsonb_build_object('obligation_id',v_ob.id,'obligation_status',v_after,'changed',true,'penalties',v_penalties);
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Finalize now refreshes Guild2 Peer component immediately.
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
  v_month text;
  v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_classroom_id:=public.current_classroom_id();
  v_reason:=nullif(btrim(coalesce(p_reason,'')),'');
  IF v_reason IS NOT NULL AND char_length(v_reason)>500 THEN RAISE EXCEPTION '[G4] finalize reason must be <=500 characters.' USING ERRCODE='P0452'; END IF;

  SELECT * INTO v_round FROM public.guild4_peer_review_rounds WHERE id=p_round_id FOR UPDATE;
  IF NOT FOUND OR v_round.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[G4] round not found in teacher classroom.' USING ERRCODE='P0453'; END IF;
  IF v_round.lifecycle_state<>'CLOSED' THEN RAISE EXCEPTION '[G4] only CLOSED round can be finalized.' USING ERRCODE='P0454'; END IF;
  IF NOT v_round.monthly_eligible THEN RAISE EXCEPTION '[G4] source Guild3 mission is VOIDED; this round is historical only.' USING ERRCODE='P0455'; END IF;

  v_scores:=public.guild4_calculate_peer_review_round_scores(v_round.id);
  v_penalties:=public.guild4_evaluate_peer_review_penalties(v_round.id);

  UPDATE public.guild4_peer_review_rounds SET lifecycle_state='FINALIZED',finalized_at=now() WHERE id=v_round.id;
  PERFORM public.guild4_write_audit_event(
    v_round.id,NULL,v_classroom_id,'ROUND_FINALIZED',v_reason,
    jsonb_build_object('lifecycle_state','CLOSED'),
    jsonb_build_object('lifecycle_state','FINALIZED','finalized_at',now(),'scores',v_scores,'penalties',v_penalties),auth.uid()
  );

  SELECT contribution_year_month INTO v_month FROM public.guild3_missions WHERE id=v_round.mission_id;
  v_refresh:=public.guild2_refresh_monthly_scores(v_classroom_id,v_month);

  RETURN jsonb_build_object('round_id',v_round.id,'lifecycle_state','FINALIZED','scores',v_scores,'penalties',v_penalties,'guild2_draft_refresh',v_refresh);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Guild2 refresh replacement follows below.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_scores(
  p_classroom_id integer,
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_season_id integer;
  v_month_start date;
  v_month_end date;
  v_count integer := 0;
  v_arcade_ready boolean;
  v_mission_ready boolean;
  v_peer_ready boolean;
BEGIN
  IF coalesce(p_year_month, '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G2A] year_month must be YYYY-MM.' USING ERRCODE = 'P0164';
  END IF;

  PERFORM pg_advisory_xact_lock(p_classroom_id, replace(p_year_month, '-', '')::integer);
  v_month_start := (p_year_month || '-01')::date;
  v_month_end := (v_month_start + interval '1 month - 1 day')::date;
  v_season_id := public.guild2_resolve_season_for_month(p_classroom_id, p_year_month);
  v_arcade_ready := public.arcade_monthly_finalization_is_complete(p_classroom_id, p_year_month);
  v_mission_ready := public.guild3_mission_month_is_ready(p_classroom_id, v_season_id, p_year_month);
  v_peer_ready := public.guild4_peer_month_is_ready(p_classroom_id, v_season_id, p_year_month);

  WITH active_roster AS (
    SELECT s.id AS student_id, gm.guild_id
    FROM public.students s
    JOIN public.guild_members gm
      ON gm.student_id = s.id
     AND gm.season_id = v_season_id
     AND gm.joined_at::date <= v_month_end
     AND gm.left_at IS NULL
    JOIN public.guilds g ON g.id = gm.guild_id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
      AND g.classroom_id = p_classroom_id
      AND g.season_id = v_season_id
  ), session_rollup AS (
    SELECT participant.student_id,
           array_agg(DISTINCT participant.guild_id_at_session) AS guild_ids,
           count(*) AS session_count,
           count(*) FILTER (WHERE participant.attendance_status = 'ABSENT') AS absent_count,
           count(*) FILTER (WHERE participant.attendance_status = 'UNMARKED') AS unmarked_count
    FROM public.guild_session_participants participant
    JOIN public.guild_sessions session ON session.id = participant.session_id
    WHERE session.classroom_id = p_classroom_id
      AND session.season_id = v_season_id
      AND session.session_date BETWEEN v_month_start AND v_month_end
    GROUP BY participant.student_id
  ), observation_rollup AS (
    SELECT event.student_id,
           array_agg(DISTINCT event.guild_id) AS guild_ids,
           count(*) AS recognition_count,
           jsonb_object_agg(event.category, event.category_count) AS category_counts
    FROM (
      SELECT observation.student_id, observation.guild_id, observation.category,
             count(*) AS category_count
      FROM public.guild2_observation_events observation
      WHERE observation.classroom_id = p_classroom_id
        AND observation.season_id = v_season_id
        AND observation.year_month = p_year_month
        AND observation.event_kind = 'RECOGNITION'
        AND NOT EXISTS (
          SELECT 1 FROM public.guild2_observation_events reversal
          WHERE reversal.reversal_of = observation.id AND reversal.event_kind = 'REVERSAL'
        )
      GROUP BY observation.student_id, observation.guild_id, observation.category
    ) event
    GROUP BY event.student_id
  ), mission_rollup AS (
    SELECT mission.student_id,
           mission.mission_points,
           mission.guild_ids
    FROM public.guild3_mission_component_rollup(p_classroom_id, v_season_id, p_year_month) mission
  ), peer_rollup AS (
    SELECT peer.student_id,
           peer.peer_points,
           peer.guild_ids
    FROM public.guild4_peer_component_rollup(p_classroom_id, v_season_id, p_year_month) peer
  ), previous_contribution_context AS (
    SELECT contribution.student_id, previous_context.guild_id_text::integer AS guild_id
    FROM public.guild2_individual_contributions contribution
    CROSS JOIN LATERAL jsonb_array_elements_text(contribution.guild_context_ids) AS previous_context(guild_id_text)
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), arcade_rollup AS (
    SELECT entry.student_id, sum(entry.raw_bonus)::numeric(18,8) AS arcade_raw_total
    FROM public.arcade_monthly_finalizations finalization
    JOIN public.arcade_monthly_snapshots snapshot ON snapshot.finalization_id = finalization.id
    JOIN public.arcade_monthly_snapshot_entries entry ON entry.snapshot_id = snapshot.id
    WHERE v_arcade_ready
      AND finalization.classroom_id = p_classroom_id
      AND finalization.contribution_year_month = p_year_month
    GROUP BY entry.student_id
  ), previous_scored_students AS (
    SELECT contribution.student_id
    FROM public.guild2_individual_contributions contribution
    WHERE contribution.classroom_id = p_classroom_id
      AND contribution.season_id = v_season_id
      AND contribution.year_month = p_year_month
  ), student_scope AS (
    SELECT student_id FROM active_roster
    UNION SELECT student_id FROM session_rollup
    UNION SELECT student_id FROM observation_rollup
    UNION SELECT student_id FROM mission_rollup
    UNION SELECT student_id FROM peer_rollup
    UNION SELECT student_id FROM previous_contribution_context
    UNION SELECT student_id FROM arcade_rollup
    UNION SELECT student_id FROM previous_scored_students
  ), all_contexts AS (
    SELECT context_row.student_id,
           array_agg(DISTINCT context_row.guild_id ORDER BY context_row.guild_id) AS guild_ids
    FROM (
      SELECT student_id, guild_id FROM active_roster
      UNION SELECT student_id, unnest(guild_ids) FROM session_rollup
      UNION SELECT student_id, unnest(guild_ids) FROM observation_rollup
      UNION SELECT student_id, unnest(guild_ids) FROM mission_rollup
      UNION SELECT student_id, unnest(guild_ids) FROM peer_rollup
      UNION SELECT student_id, guild_id FROM previous_contribution_context
    ) context_row
    GROUP BY context_row.student_id
  ), calculated AS (
    SELECT scope.student_id,
           CASE WHEN roster.guild_id IS NOT NULL
                     AND cardinality(contexts.guild_ids) = 1
                     AND contexts.guild_ids[1] = roster.guild_id
                THEN roster.guild_id ELSE NULL END AS scoring_guild_id,
           CASE WHEN roster.guild_id IS NOT NULL
                     AND cardinality(contexts.guild_ids) = 1
                     AND contexts.guild_ids[1] = roster.guild_id
                THEN 'RESOLVED' ELSE 'NEEDS_ROSTER_RESOLUTION' END AS guild_context_status,
           contexts.guild_ids,
           least(coalesce(peer.peer_points, 0::numeric), 300::numeric)::numeric(18,8) AS peer_points,
           least(coalesce(mission.mission_points, 0::numeric), 300::numeric)::numeric(18,8) AS mission_points,
           coalesce(session.session_count, 0)::integer AS session_count,
           coalesce(session.absent_count, 0)::integer AS session_absent_count,
           coalesce(session.unmarked_count, 0)::integer AS session_unmarked_count,
           CASE WHEN coalesce(session.session_count, 0) = 0 THEN 0::numeric(18,8)
                ELSE greatest(0, 150 - 30 * coalesce(session.absent_count, 0))::numeric(18,8) END AS session_points,
           CASE WHEN coalesce(session.session_count, 0) = 0 THEN 'NOT_READY'
                WHEN coalesce(session.unmarked_count, 0) > 0 THEN 'PENDING'
                ELSE 'READY' END AS session_status,
           coalesce(observation.recognition_count, 0)::integer AS observation_count,
           least(coalesce(observation.recognition_count, 0) * 10, 150)::numeric(18,8) AS teacher_observation_points,
           coalesce(observation.category_counts, '{}'::jsonb) AS category_counts,
           coalesce(arcade.arcade_raw_total, 0)::numeric(18,8) AS arcade_raw_total
    FROM student_scope scope
    JOIN all_contexts contexts ON contexts.student_id = scope.student_id
    LEFT JOIN active_roster roster ON roster.student_id = scope.student_id
    LEFT JOIN session_rollup session ON session.student_id = scope.student_id
    LEFT JOIN observation_rollup observation ON observation.student_id = scope.student_id
    LEFT JOIN mission_rollup mission ON mission.student_id = scope.student_id
    LEFT JOIN peer_rollup peer ON peer.student_id = scope.student_id
    LEFT JOIN arcade_rollup arcade ON arcade.student_id = scope.student_id
  )
  INSERT INTO public.guild2_individual_contributions (
    classroom_id, season_id, year_month, student_id,
    scoring_guild_id, guild_context_status, guild_context_ids,
    peer_points, mission_points, session_points, teacher_observation_points,
    basic_total, arcade_raw_total, arcade_applied, final_total,
    peer_status, mission_status, session_status, teacher_observation_status, arcade_status,
    session_absent_count, session_unmarked_count, observation_count,
    calculation_metadata, formula_version, calculated_by_user_id, calculated_at, updated_at
  )
  SELECT p_classroom_id, v_season_id, p_year_month, calculated.student_id,
         calculated.scoring_guild_id, calculated.guild_context_status, to_jsonb(calculated.guild_ids),
         calculated.peer_points, calculated.mission_points, calculated.session_points, calculated.teacher_observation_points,
         calculated.peer_points + calculated.mission_points + calculated.session_points + calculated.teacher_observation_points,
         calculated.arcade_raw_total, least(calculated.arcade_raw_total, 90),
         calculated.peer_points + calculated.mission_points + calculated.session_points + calculated.teacher_observation_points
           + least(calculated.arcade_raw_total, 90),
         CASE WHEN v_peer_ready THEN 'READY' ELSE 'NOT_READY' END, CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
         calculated.session_status, 'READY',
         CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
         calculated.session_absent_count, calculated.session_unmarked_count, calculated.observation_count,
         jsonb_build_object(
           'peer_points', calculated.peer_points,
           'peer_status', CASE WHEN v_peer_ready THEN 'READY' ELSE 'NOT_READY' END,
           'peer_aggregation', 'GUILD3_MISSION_WEIGHTED_AVERAGE',
           'mission_points', calculated.mission_points,
           'mission_status', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
           'mission_rounding', 'RAW_NORMALIZED_NUMERIC; DISPLAY_ROUNDED_IN_GUILD2_SUMMARY',
           'session_count', calculated.session_count,
           'observation_category_counts', calculated.category_counts,
           'arcade_raw_total', calculated.arcade_raw_total,
           'arcade_applied', least(calculated.arcade_raw_total, 90),
           'arcade_status', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
           'allocation_note', CASE WHEN calculated.guild_context_status = 'RESOLVED'
             THEN 'CURRENT_DRAFT_CONTEXT'
             ELSE 'MID_MONTH_OR_HISTORICAL_GUILD_CONTEXT_REQUIRES_GUILD5_ROSTER_RESOLUTION' END
         ),
         'GUILD_CONTRIBUTION_V2_2026', auth.uid(), now(), now()
  FROM calculated
  ON CONFLICT (classroom_id, season_id, year_month, student_id) DO UPDATE SET
    scoring_guild_id = EXCLUDED.scoring_guild_id,
    guild_context_status = EXCLUDED.guild_context_status,
    guild_context_ids = EXCLUDED.guild_context_ids,
    peer_points = EXCLUDED.peer_points,
    mission_points = EXCLUDED.mission_points,
    session_points = EXCLUDED.session_points,
    teacher_observation_points = EXCLUDED.teacher_observation_points,
    basic_total = EXCLUDED.basic_total,
    arcade_raw_total = EXCLUDED.arcade_raw_total,
    arcade_applied = EXCLUDED.arcade_applied,
    final_total = EXCLUDED.final_total,
    peer_status = EXCLUDED.peer_status,
    mission_status = EXCLUDED.mission_status,
    session_status = EXCLUDED.session_status,
    teacher_observation_status = EXCLUDED.teacher_observation_status,
    arcade_status = EXCLUDED.arcade_status,
    session_absent_count = EXCLUDED.session_absent_count,
    session_unmarked_count = EXCLUDED.session_unmarked_count,
    observation_count = EXCLUDED.observation_count,
    calculation_metadata = EXCLUDED.calculation_metadata,
    formula_version = EXCLUDED.formula_version,
    calculated_by_user_id = EXCLUDED.calculated_by_user_id,
    calculated_at = EXCLUDED.calculated_at,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  PERFORM public.guild2_refresh_monthly_gs_summary(p_classroom_id, p_year_month, v_season_id);

  RETURN jsonb_build_object(
    'classroom_id', p_classroom_id,
    'season_id', v_season_id,
    'year_month', p_year_month,
    'contributions_recalculated', v_count,
    'peer_status', CASE WHEN v_peer_ready THEN 'READY' ELSE 'NOT_READY' END,
    'mission_status', CASE WHEN v_mission_ready THEN 'READY' ELSE 'NOT_READY' END,
    'arcade_status', CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END,
    'formula_version', 'GUILD_CONTRIBUTION_V2_2026'
  );
END;
$$;
-- -----------------------------------------------------------------------------
-- 6. Student privacy reads: round progress + monthly final Peer only.
--    Received-review raw scores/comments/reviewer identities are never exposed.
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
    WHERE p.student_id=v_student_id AND r.classroom_id=v_classroom_id
  ) q;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.student_get_guild4_peer_monthly_summary()
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
    RAISE EXCEPTION '[G4] student context is missing.' USING ERRCODE='P0474';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'year_month',c.year_month,
    'status',c.peer_status,
    'peer_points',CASE WHEN c.peer_status='READY' THEN c.peer_points ELSE NULL END,
    'max_points',300,
    'explanation',CASE WHEN c.peer_status='READY' THEN '길드원들의 평가를 종합·보정하고 미션 가중치로 월간 반영한 점수입니다.' ELSE NULL END
  ) ORDER BY c.year_month DESC),'[]'::jsonb)
  INTO v_result
  FROM public.guild2_individual_contributions c
  WHERE c.classroom_id=v_classroom_id AND c.student_id=v_student_id;

  RETURN v_result;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Privileges.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guild4_peer_month_is_ready(integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild4_peer_component_rollup(integer,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild4_peer_month_is_ready(integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.guild4_peer_component_rollup(integer,integer,text) TO service_role;

REVOKE ALL ON FUNCTION public.teacher_correct_guild4_peer_review(bigint,integer,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.teacher_correct_guild4_peer_review_exception(bigint,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_correct_guild4_peer_review(bigint,integer,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_correct_guild4_peer_review_exception(bigint,boolean,text) TO authenticated;

REVOKE ALL ON FUNCTION public.student_get_guild4_peer_monthly_summary() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild4_peer_monthly_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild4_peer_review_rounds() TO authenticated;

-- Replaced functions keep explicit grants.
GRANT EXECUTE ON FUNCTION public.teacher_finalize_guild4_peer_review_round(bigint,text) TO authenticated;
REVOKE ALL ON FUNCTION public.guild4_evaluate_peer_review_penalties(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild4_evaluate_peer_review_penalties(bigint) TO service_role;

COMMIT;
