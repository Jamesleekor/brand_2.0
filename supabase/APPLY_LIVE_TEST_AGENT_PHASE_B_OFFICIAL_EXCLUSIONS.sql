-- Manual Supabase SQL Editor wrapper: restore owner role first.
SET ROLE postgres;
-- ============================================================================
-- B.R.A.N.D 2.0 — Live Test Agent Phase B
-- Official aggregation exclusions
-- 2026-09-03
-- Requires 20260903_01_live_test_agent_foundation.sql
-- ============================================================================
BEGIN;

DELETE FROM public.rankings r
USING public.students s
WHERE r.student_id=s.id AND s.is_test_account=true;


-- --------------------------------------------------------------------------
-- 1. Rankings
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_rankings(p_classroom_id integer, p_as_of_date date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_count INTEGER := 0;
BEGIN
    DELETE FROM public.rankings r
    USING public.students s
    WHERE r.student_id = s.id
      AND r.classroom_id = p_classroom_id
      AND r.as_of_date = p_as_of_date
      AND NOT public.is_official_participant(s.id);

    -- BV 순위
    INSERT INTO rankings (classroom_id, student_id, as_of_date, ranking_type, rank_position, value)
    SELECT 
        s.classroom_id,
        s.id,
        p_as_of_date,
        'BRAND_VALUE'::ranking_type,
        RANK() OVER (ORDER BY w.bv DESC),
        w.bv
    FROM students s
    JOIN wallets w ON w.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id)
    ON CONFLICT (classroom_id, student_id, as_of_date, ranking_type) DO UPDATE SET
        rank_position = EXCLUDED.rank_position,
        value = EXCLUDED.value;
    
    -- 골드 자산 순위
    INSERT INTO rankings (classroom_id, student_id, as_of_date, ranking_type, rank_position, value)
    SELECT 
        s.classroom_id,
        s.id,
        p_as_of_date,
        'GOLD_ASSET'::ranking_type,
        RANK() OVER (ORDER BY w.gold DESC),
        w.gold
    FROM students s
    JOIN wallets w ON w.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id)
    ON CONFLICT (classroom_id, student_id, as_of_date, ranking_type) DO UPDATE SET
        rank_position = EXCLUDED.rank_position,
        value = EXCLUDED.value;
    
    -- 크리스탈 자산 순위
    INSERT INTO rankings (classroom_id, student_id, as_of_date, ranking_type, rank_position, value)
    SELECT 
        s.classroom_id,
        s.id,
        p_as_of_date,
        'CRYSTAL_ASSET'::ranking_type,
        RANK() OVER (ORDER BY w.crystal DESC),
        w.crystal
    FROM students s
    JOIN wallets w ON w.student_id = s.id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id)
    ON CONFLICT (classroom_id, student_id, as_of_date, ranking_type) DO UPDATE SET
        rank_position = EXCLUDED.rank_position,
        value = EXCLUDED.value;
    
    -- 업적 수 순위
    INSERT INTO rankings (classroom_id, student_id, as_of_date, ranking_type, rank_position, value)
    SELECT 
        s.classroom_id,
        s.id,
        p_as_of_date,
        'ACHIEVEMENT_COUNT'::ranking_type,
        RANK() OVER (ORDER BY COUNT(sa.id) DESC),
        COUNT(sa.id)
    FROM students s
    LEFT JOIN student_achievements sa ON sa.student_id = s.id AND sa.is_revoked = FALSE
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id)
    GROUP BY s.id, s.classroom_id
    ON CONFLICT (classroom_id, student_id, as_of_date, ranking_type) DO UPDATE SET
        rank_position = EXCLUDED.rank_position,
        value = EXCLUDED.value;
    
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$function$


-- --------------------------------------------------------------------------
-- 2. Daily statistics
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_daily_statistics(p_classroom_id integer, p_stat_date date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_total_gold        BIGINT;
    v_total_bv          BIGINT;
    v_total_crystal     BIGINT;
    v_gold_amounts      BIGINT[];
    v_bv_amounts        BIGINT[];
    v_gini_gold         NUMERIC;
    v_gini_bv           NUMERIC;
    v_active_students   INTEGER;
    v_tx_count          INTEGER;
    v_ach_count         INTEGER;
    v_collected         BIGINT;
    v_distributed       BIGINT;
    v_stat_id           INTEGER;
BEGIN
    -- 1. 화폐 총량 + 배열 (지니용)
    SELECT 
        SUM(w.gold), 
        SUM(w.bv), 
        SUM(w.crystal),
        ARRAY_AGG(w.gold ORDER BY w.gold),
        ARRAY_AGG(w.bv ORDER BY w.bv)
    INTO v_total_gold, v_total_bv, v_total_crystal, v_gold_amounts, v_bv_amounts
    FROM wallets w
    JOIN students s ON s.id = w.student_id
    WHERE s.classroom_id = p_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id);
    
    -- 2. 지니계수
    v_gini_gold := calculate_gini(v_gold_amounts);
    v_gini_bv := calculate_gini(v_bv_amounts);
    
    -- 3. 활동 학생 수 (오늘 거래 발생)
    SELECT COUNT(DISTINCT t.student_id) INTO v_active_students
    FROM public.transactions t
    JOIN public.students s ON s.id=t.student_id
    WHERE t.classroom_id = p_classroom_id
      AND t.created_at::DATE = p_stat_date
      AND public.is_official_participant(s.id);
    
    -- 4. 거래 건수
    SELECT COUNT(*) INTO v_tx_count
    FROM public.transactions t
    JOIN public.students s ON s.id=t.student_id
    WHERE t.classroom_id = p_classroom_id
      AND t.created_at::DATE = p_stat_date
      AND t.is_reversed = FALSE
      AND public.is_official_participant(s.id);
    
    -- 5. 업적 달성 수
    SELECT COUNT(*) INTO v_ach_count
    FROM public.student_achievements sa
    JOIN public.students s ON s.id=sa.student_id
    WHERE sa.classroom_id = p_classroom_id
      AND sa.achieved_at::DATE = p_stat_date
      AND sa.is_revoked = FALSE
      AND public.is_official_participant(s.id);
    
    -- 6. 복지기금 수입/지출
    SELECT 
        COALESCE(SUM(amount) FILTER (WHERE movement_type = 'COLLECT'), 0),
        COALESCE(SUM(amount) FILTER (WHERE movement_type = 'DISTRIBUTE'), 0)
    INTO v_collected, v_distributed
    FROM welfare_fund_movements wfm
    JOIN welfare_funds wf ON wf.id = wfm.fund_id
    WHERE wf.classroom_id = p_classroom_id
      AND wfm.created_at::DATE = p_stat_date;
    
    -- 7. UPSERT
    INSERT INTO daily_statistics (
        classroom_id, stat_date,
        total_gold, total_bv, total_crystal,
        gini_gold, gini_bv,
        active_students, transactions_count, achievements_count,
        welfare_collected_today, welfare_distributed_today
    ) VALUES (
        p_classroom_id, p_stat_date,
        COALESCE(v_total_gold, 0), COALESCE(v_total_bv, 0), COALESCE(v_total_crystal, 0),
        v_gini_gold, v_gini_bv,
        COALESCE(v_active_students, 0), v_tx_count, v_ach_count,
        v_collected, v_distributed
    )
    ON CONFLICT (classroom_id, stat_date) DO UPDATE SET
        total_gold = EXCLUDED.total_gold,
        total_bv = EXCLUDED.total_bv,
        total_crystal = EXCLUDED.total_crystal,
        gini_gold = EXCLUDED.gini_gold,
        gini_bv = EXCLUDED.gini_bv,
        active_students = EXCLUDED.active_students,
        transactions_count = EXCLUDED.transactions_count,
        achievements_count = EXCLUDED.achievements_count,
        welfare_collected_today = EXCLUDED.welfare_collected_today,
        welfare_distributed_today = EXCLUDED.welfare_distributed_today,
        calculated_at = NOW()
    RETURNING id INTO v_stat_id;
    
    RETURN v_stat_id;
END;
$function$


-- --------------------------------------------------------------------------
-- 3. Achievement statistics
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_achievement_statistics(p_classroom_id integer, p_start_date date DEFAULT NULL::date, p_end_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_today date := (timezone('Asia/Seoul',now()))::date;
  v_start_date date;
  v_end_date date;
  v_start_ts timestamptz;
  v_end_exclusive_ts timestamptz;
  v_students jsonb;
  v_period_summary jsonb;
  v_total_summary jsonb;
  v_active_student_count integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF NOT public.is_classroom_member(p_classroom_id) THEN
    RAISE EXCEPTION 'Classroom access denied' USING ERRCODE='PA510';
  END IF;

  v_end_date:=COALESCE(p_end_date,v_today);
  v_start_date:=COALESCE(p_start_date,date_trunc('month',v_end_date::timestamp)::date);

  IF v_start_date>v_end_date THEN
    RAISE EXCEPTION 'start_date must be on or before end_date' USING ERRCODE='PA511';
  END IF;

  v_start_ts:=v_start_date::timestamp AT TIME ZONE 'Asia/Seoul';
  v_end_exclusive_ts:=(v_end_date+1)::timestamp AT TIME ZONE 'Asia/Seoul';

  SELECT count(*)::integer INTO v_active_student_count
  FROM public.students s
  WHERE s.classroom_id=p_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND public.is_official_participant(s.id);

  WITH active_students AS (
    SELECT
      s.id AS student_id,
      s.name AS student_name,
      s.brand_name,
      COALESCE(NULLIF(s.brand_name,''),s.name,'학생') AS display_name
    FROM public.students s
    WHERE s.classroom_id=p_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
      AND public.is_official_participant(s.id)
  ), active_grants AS (
    SELECT
      sa.student_id,
      sa.achieved_at,
      a.grade::text AS grade,
      COALESCE(a.achievement_score,0)::bigint AS achievement_score
    FROM public.student_achievements sa
    JOIN public.achievements a ON a.id=sa.achievement_id
    WHERE sa.classroom_id=p_classroom_id
      AND sa.is_revoked=false
  ), aggregated AS (
    SELECT
      s.student_id,
      s.student_name,
      s.brand_name,
      s.display_name,
      count(g.student_id) FILTER (
        WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts
      )::integer AS period_count,
      COALESCE(sum(g.achievement_score) FILTER (
        WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts
      ),0)::bigint AS period_score,
      count(g.student_id)::integer AS total_count,
      COALESCE(sum(g.achievement_score),0)::bigint AS total_score,

      count(g.student_id) FILTER (WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts AND g.grade='희귀')::integer AS period_rare,
      count(g.student_id) FILTER (WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts AND g.grade='유니크')::integer AS period_unique,
      count(g.student_id) FILTER (WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts AND g.grade='에픽')::integer AS period_epic,
      count(g.student_id) FILTER (WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts AND g.grade='히든')::integer AS period_hidden,
      count(g.student_id) FILTER (WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts AND g.grade='유일')::integer AS period_singular,
      count(g.student_id) FILTER (WHERE g.achieved_at>=v_start_ts AND g.achieved_at<v_end_exclusive_ts AND g.grade='초월')::integer AS period_transcendent,

      count(g.student_id) FILTER (WHERE g.grade='희귀')::integer AS total_rare,
      count(g.student_id) FILTER (WHERE g.grade='유니크')::integer AS total_unique,
      count(g.student_id) FILTER (WHERE g.grade='에픽')::integer AS total_epic,
      count(g.student_id) FILTER (WHERE g.grade='히든')::integer AS total_hidden,
      count(g.student_id) FILTER (WHERE g.grade='유일')::integer AS total_singular,
      count(g.student_id) FILTER (WHERE g.grade='초월')::integer AS total_transcendent
    FROM active_students s
    LEFT JOIN active_grants g ON g.student_id=s.student_id
    GROUP BY s.student_id,s.student_name,s.brand_name,s.display_name
  ), ranked AS (
    SELECT
      a.*,
      dense_rank() OVER (ORDER BY a.period_score DESC)::integer AS period_score_rank,
      dense_rank() OVER (ORDER BY a.period_count DESC)::integer AS period_count_rank,
      dense_rank() OVER (ORDER BY a.total_score DESC)::integer AS total_score_rank,
      dense_rank() OVER (ORDER BY a.total_count DESC)::integer AS total_count_rank
    FROM aggregated a
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'student_id',r.student_id,
      'student_name',r.student_name,
      'brand_name',r.brand_name,
      'display_name',r.display_name,
      'period_count',r.period_count,
      'period_score',r.period_score,
      'total_count',r.total_count,
      'total_score',r.total_score,
      'period_score_rank',r.period_score_rank,
      'period_count_rank',r.period_count_rank,
      'total_score_rank',r.total_score_rank,
      'total_count_rank',r.total_count_rank,
      'period_grade_breakdown',jsonb_build_object(
        '희귀',r.period_rare,'유니크',r.period_unique,'에픽',r.period_epic,
        '히든',r.period_hidden,'유일',r.period_singular,'초월',r.period_transcendent
      ),
      'total_grade_breakdown',jsonb_build_object(
        '희귀',r.total_rare,'유니크',r.total_unique,'에픽',r.total_epic,
        '히든',r.total_hidden,'유일',r.total_singular,'초월',r.total_transcendent
      )
    ) ORDER BY r.period_score DESC,r.period_count DESC,r.total_score DESC,r.display_name,r.student_id
  ),'[]'::jsonb)
  INTO v_students
  FROM ranked r;

  SELECT jsonb_build_object(
    'achievement_count',count(*)::integer,
    'achievement_score',COALESCE(sum(a.achievement_score),0)::bigint,
    'students_with_achievement',count(DISTINCT sa.student_id)::integer,
    'grade_breakdown',jsonb_build_object(
      '희귀',count(*) FILTER (WHERE a.grade::text='희귀')::integer,
      '유니크',count(*) FILTER (WHERE a.grade::text='유니크')::integer,
      '에픽',count(*) FILTER (WHERE a.grade::text='에픽')::integer,
      '히든',count(*) FILTER (WHERE a.grade::text='히든')::integer,
      '유일',count(*) FILTER (WHERE a.grade::text='유일')::integer,
      '초월',count(*) FILTER (WHERE a.grade::text='초월')::integer
    )
  ) INTO v_period_summary
  FROM public.student_achievements sa
  JOIN public.achievements a ON a.id=sa.achievement_id
  JOIN public.students s ON s.id=sa.student_id
  WHERE sa.classroom_id=p_classroom_id
    AND sa.is_revoked=false
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND public.is_official_participant(s.id)
    AND sa.achieved_at>=v_start_ts
    AND sa.achieved_at<v_end_exclusive_ts;

  SELECT jsonb_build_object(
    'achievement_count',count(*)::integer,
    'achievement_score',COALESCE(sum(a.achievement_score),0)::bigint,
    'students_with_achievement',count(DISTINCT sa.student_id)::integer,
    'grade_breakdown',jsonb_build_object(
      '희귀',count(*) FILTER (WHERE a.grade::text='희귀')::integer,
      '유니크',count(*) FILTER (WHERE a.grade::text='유니크')::integer,
      '에픽',count(*) FILTER (WHERE a.grade::text='에픽')::integer,
      '히든',count(*) FILTER (WHERE a.grade::text='히든')::integer,
      '유일',count(*) FILTER (WHERE a.grade::text='유일')::integer,
      '초월',count(*) FILTER (WHERE a.grade::text='초월')::integer
    )
  ) INTO v_total_summary
  FROM public.student_achievements sa
  JOIN public.achievements a ON a.id=sa.achievement_id
  JOIN public.students s ON s.id=sa.student_id
  WHERE sa.classroom_id=p_classroom_id
    AND sa.is_revoked=false
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND public.is_official_participant(s.id);

  RETURN jsonb_build_object(
    'classroom_id',p_classroom_id,
    'timezone','Asia/Seoul',
    'generated_at',now(),
    'period',jsonb_build_object(
      'start_date',v_start_date,
      'end_date',v_end_date,
      'start_at',v_start_ts,
      'end_exclusive_at',v_end_exclusive_ts
    ),
    'active_student_count',v_active_student_count,
    'period_summary',v_period_summary,
    'total_summary',v_total_summary,
    'students',v_students
  );
END;
$function$


-- --------------------------------------------------------------------------
-- 4. Welfare donation guard
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.donate_to_welfare_fund(p_student_id integer, p_amount bigint, p_message text DEFAULT NULL::text)
 RETURNS TABLE(transaction_id bigint, movement_id bigint, new_gold_balance bigint, welfare_balance bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_fund_id integer;
  v_tx_id bigint;
  v_movement_id bigint;
  v_new_gold bigint;
  v_fund_balance bigint;
  v_message text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다.' USING ERRCODE = 'P0610';
  END IF;

  PERFORM public.ensure_self_or_teacher(p_student_id);

  IF NOT public.is_official_participant(p_student_id) THEN
    RAISE EXCEPTION '테스트요원은 공식 복지기금에 기부할 수 없습니다.' USING ERRCODE = 'P0614';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000 THEN
    RAISE EXCEPTION '기부 금액은 1 이상 1,000,000 이하이어야 합니다.' USING ERRCODE = 'P0612';
  END IF;

  v_message := NULLIF(btrim(coalesce(p_message, '')), '');
  IF char_length(coalesce(v_message, '')) > 200 THEN
    RAISE EXCEPTION '기부 메시지는 200자 이하로 입력해주세요.' USING ERRCODE = 'P0612';
  END IF;

  SELECT s.classroom_id
    INTO v_classroom_id
    FROM public.students s
   WHERE s.id = p_student_id
     AND s.transferred_at IS NULL
     AND s.role IN ('STUDENT', 'STUDENT_LEADER', 'GUARD');

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '활성 학생 정보를 찾을 수 없습니다.' USING ERRCODE = 'P0022';
  END IF;

  IF public.is_asset_freeze_active(v_classroom_id) THEN
    RAISE EXCEPTION '자산동결 중에는 기부할 수 없습니다.' USING ERRCODE = 'P0611';
  END IF;

  INSERT INTO public.welfare_funds (classroom_id)
  VALUES (v_classroom_id)
  ON CONFLICT (classroom_id) DO NOTHING;

  SELECT wf.id
    INTO v_fund_id
    FROM public.welfare_funds wf
   WHERE wf.classroom_id = v_classroom_id
   FOR UPDATE;

  v_tx_id := public.create_transaction(
    p_student_id, 'GOLD', -p_amount, 'DONATION', NULL, 0,
    format('[복지기금 기부] %s골드%s', p_amount,
      CASE WHEN v_message IS NULL THEN '' ELSE ' · ' || v_message END)
  );

  INSERT INTO public.welfare_fund_movements (
    fund_id, movement_type, amount, source_type, transaction_id, note
  ) VALUES (
    v_fund_id, 'COLLECT', p_amount, 'DONATION', v_tx_id,
    CASE WHEN v_message IS NULL THEN '학생 복지기금 기부' ELSE v_message END
  ) RETURNING id INTO v_movement_id;

  UPDATE public.welfare_funds
     SET total_collected = total_collected + p_amount,
         current_balance = current_balance + p_amount,
         updated_at = now()
   WHERE id = v_fund_id
   RETURNING current_balance INTO v_fund_balance;

  UPDATE public.transactions
     SET source_id = v_movement_id
   WHERE id = v_tx_id;

  SELECT w.gold INTO v_new_gold
    FROM public.wallets w
   WHERE w.student_id = p_student_id;

  transaction_id := v_tx_id;
  movement_id := v_movement_id;
  new_gold_balance := v_new_gold;
  welfare_balance := v_fund_balance;
  RETURN NEXT;
END;
$function$


-- --------------------------------------------------------------------------
-- 5. Hall of Fame guard
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_add_hall_of_fame_entry(p_classroom_id integer, p_category text, p_period_label text, p_title text, p_subtitle text DEFAULT NULL::text, p_student_id integer DEFAULT NULL::integer, p_rank_position integer DEFAULT NULL::integer)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ DECLARE v_id bigint; BEGIN
 PERFORM public.ensure_teacher_role(); IF NOT public.is_classroom_member(p_classroom_id) THEN RAISE EXCEPTION '[F4D] teacher classroom denied' USING ERRCODE='P4D10'; END IF;
 IF char_length(btrim(coalesce(p_category,''))) NOT BETWEEN 1 AND 40 OR char_length(btrim(coalesce(p_title,''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION '[F4D] record category/title invalid' USING ERRCODE='P4D20'; END IF;
 IF p_student_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.students WHERE id=p_student_id AND classroom_id=p_classroom_id) THEN RAISE EXCEPTION '[F4D] record student mismatch' USING ERRCODE='P4D21'; END IF;
 IF p_student_id IS NOT NULL AND NOT public.is_official_participant(p_student_id) THEN RAISE EXCEPTION '[F4D] test/non-official participant cannot be registered in hall of fame' USING ERRCODE='P4D22'; END IF;
 INSERT INTO public.hall_of_fame_entries(classroom_id,category,period_label,title,subtitle,student_id,rank_position,created_by)
 VALUES(p_classroom_id,btrim(p_category),nullif(btrim(coalesce(p_period_label,'')),''),btrim(p_title),nullif(btrim(coalesce(p_subtitle,'')),''),p_student_id,p_rank_position,auth.uid()) RETURNING id INTO v_id;
 RETURN v_id;
END $function$


-- --------------------------------------------------------------------------
-- 6. Guild monthly scoring
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_scores(p_classroom_id integer, p_year_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      AND public.is_official_participant(s.id)
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
    JOIN public.students scope_student
      ON scope_student.id = scope.student_id
     AND public.is_official_participant(scope_student.id)
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
$function$


-- --------------------------------------------------------------------------
-- 7. Guild5 final snapshot guard
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_finalize_guild5_month(p_year_month text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_class integer;v_season integer;v_closure public.guild5_month_closures%ROWTYPE;
  v_closure_id bigint;v_previous_version_id bigint;v_version_id bigint;v_version_no integer;v_preview jsonb;
  v_tie_seed text;v_rank_changed boolean:=false;v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  PERFORM pg_advisory_xact_lock(v_class,replace(p_year_month,'-','')::integer+50000000);
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=v_season) THEN RAISE EXCEPTION '[G5] season is locked.' USING ERRCODE='P0504'; END IF;
  v_closure_id:=public.guild5_get_or_create_closure(v_class,v_season,p_year_month);
  SELECT * INTO v_closure FROM public.guild5_month_closures WHERE id=v_closure_id FOR UPDATE;
  IF v_closure.lifecycle_state='FINALIZED' THEN RAISE EXCEPTION '[G5] month is already FINALIZED. Reopen first.' USING ERRCODE='P0510'; END IF;
  v_refresh:=public.guild2_refresh_monthly_scores(v_class,p_year_month);
  v_preview:=public.guild5_build_close_preview(v_class,v_season,p_year_month);
  IF NOT coalesce((v_preview->>'can_finalize')::boolean,false) THEN
    RAISE EXCEPTION '[G5] close preview has NOT_READY blockers: %',v_preview->'readiness' USING ERRCODE='P0511';
  END IF;
  v_previous_version_id:=v_closure.current_version_id;
  SELECT coalesce(max(version_no),0)+1 INTO v_version_no FROM public.guild5_closure_versions WHERE closure_id=v_closure_id;
  v_tie_seed:=format('G5|%s|%s|%s',v_class,v_season,p_year_month);
  INSERT INTO public.guild5_closure_versions(
    closure_id,version_no,previous_version_id,readiness_snapshot,override_snapshot,tie_seed,conquest_status
  ) VALUES(v_closure_id,v_version_no,v_previous_version_id,v_preview->'readiness',v_preview->'overrides',v_tie_seed,'ACTIVE') RETURNING id INTO v_version_id;

  INSERT INTO public.guild5_student_snapshots(
    version_id,student_id,student_name_at_close,brand_name_at_close,guild_id,guild_name_at_close,role_at_close,bv_at_close,
    peer_points,mission_points,session_points,observation_points,basic_total,arcade_raw_total,arcade_applied,final_contribution,
    peer_status,mission_status,session_status,observation_status,arcade_status,source_flags
  )
  SELECT v_version_id,c.student_id,s.name::text,s.brand_name::text,c.scoring_guild_id,g.name::text,s.role::text,coalesce(w.bv,0),
         c.peer_points,c.mission_points,c.session_points,c.teacher_observation_points,c.basic_total,c.arcade_raw_total,c.arcade_applied,c.final_total,
         CASE WHEN c.peer_status='READY' THEN 'READY' ELSE 'OVERRIDDEN' END,
         CASE WHEN c.mission_status='READY' THEN 'READY' ELSE 'OVERRIDDEN' END,
         'READY','READY','READY',
         jsonb_build_object('original_peer_status',c.peer_status,'original_mission_status',c.mission_status,'formula_version',c.formula_version)
  FROM public.guild2_individual_contributions c
  JOIN public.students s ON s.id=c.student_id
  JOIN public.guilds g ON g.id=c.scoring_guild_id
  LEFT JOIN public.wallets w ON w.student_id=c.student_id
  WHERE c.classroom_id=v_class AND c.season_id=v_season AND c.year_month=p_year_month
    AND c.guild_context_status='RESOLVED'
    AND public.is_official_participant(c.student_id);

  INSERT INTO public.guild5_guild_snapshots(
    version_id,guild_id,guild_name_at_close,roster_count,roster_bv_sum,individual_subtotal,official_mission_gs,
    compensation_amount,manual_adjustment_total,total_gs,deterministic_tie_value
  )
  SELECT v_version_id,ms.guild_id,g.name::text,ms.scoring_roster_count,
         coalesce((SELECT sum(ss.bv_at_close) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_version_id AND ss.guild_id=ms.guild_id),0),
         ms.individual_subtotal,ms.mission_gs_subtotal,ms.compensation_amount,ms.manual_adjustment_total,ms.draft_gs_total,
         md5(v_tie_seed||'|'||ms.guild_id::text)
  FROM public.guild2_monthly_gs_summaries ms JOIN public.guilds g ON g.id=ms.guild_id
  WHERE ms.classroom_id=v_class AND ms.season_id=v_season AND ms.year_month=p_year_month
    AND g.classroom_id=v_class AND g.season_id=v_season AND coalesce(g.is_active,true);

  WITH ranked AS (
    SELECT id,row_number() OVER(ORDER BY total_gs DESC,roster_bv_sum DESC,official_mission_gs DESC,deterministic_tie_value ASC)::integer AS rn
    FROM public.guild5_guild_snapshots WHERE version_id=v_version_id
  ) UPDATE public.guild5_guild_snapshots s SET rank_position=r.rn FROM ranked r WHERE s.id=r.id;

  IF v_previous_version_id IS NOT NULL THEN
    SELECT EXISTS(
      (SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_version_id
       EXCEPT SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_previous_version_id)
      UNION ALL
      (SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_previous_version_id
       EXCEPT SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_version_id)
    ) INTO v_rank_changed;
  END IF;
  UPDATE public.guild5_closure_versions SET rank_changed_from_previous=v_rank_changed WHERE id=v_version_id;
  PERFORM public.guild5_prepare_conquest(v_version_id,v_previous_version_id,v_rank_changed);

  UPDATE public.guild5_month_closures SET lifecycle_state='FINALIZED',current_version_id=v_version_id,updated_at=now() WHERE id=v_closure_id;

  IF to_regclass('public.hall_of_fame_entries') IS NOT NULL THEN
    UPDATE public.hall_of_fame_entries SET status='ARCHIVED'
    WHERE classroom_id=v_class AND category='GUILD_MONTHLY_WINNER' AND period_label=p_year_month AND status='ACTIVE';
    INSERT INTO public.hall_of_fame_entries(classroom_id,category,period_label,title,subtitle,guild_id,rank_position,metadata,status,created_by)
    SELECT v_class,'GUILD_MONTHLY_WINNER',p_year_month,guild_name_at_close,
           format('%s월 길드 1위 · %s GS',p_year_month,total_gs),guild_id,1,
           jsonb_build_object('source','GUILD5','closure_id',v_closure_id,'version_id',v_version_id,'version_no',v_version_no,'total_gs',total_gs),
           'ACTIVE',auth.uid()
    FROM public.guild5_guild_snapshots WHERE version_id=v_version_id AND rank_position=1;
  END IF;

  PERFORM public.guild5_write_audit(v_closure_id,v_version_id,v_class,'MONTH_FINALIZED',NULL,
    jsonb_build_object('previous_version_id',v_previous_version_id),
    jsonb_build_object('version_no',v_version_no,'rank_changed',v_rank_changed,'guild2_refresh',v_refresh));

  RETURN jsonb_build_object('closure_id',v_closure_id,'version_id',v_version_id,'version_no',v_version_no,
    'rank_changed_from_previous',v_rank_changed,'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=v_version_id));
END $function$


-- --------------------------------------------------------------------------
-- 8. Arcade run auto-test marker
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_create_arcade_run(p_game_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer;
  v_classroom_id integer;
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
  v_run public.arcade_runs%ROWTYPE;
  v_seed bigint;
  v_seoul_today date;
  v_public_available boolean;
  v_is_prerelease_test boolean := false;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();
  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] active student context is required.' USING ERRCODE = 'P0195';
  END IF;
  IF coalesce(p_game_code, '') !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION '[ARCADE] game code is invalid.' USING ERRCODE = 'P0196';
  END IF;
  v_seoul_today := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;

  SELECT * INTO v_game
  FROM public.arcade_games
  WHERE code = p_game_code AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
  END IF;

  v_public_available := v_game.available_from <= v_seoul_today
    AND (v_game.available_until IS NULL OR v_game.available_until >= v_seoul_today);
  IF NOT v_public_available THEN
    IF v_seoul_today >= v_game.available_from THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM public.arcade_prerelease_test_access access_row
      WHERE access_row.classroom_id = v_classroom_id
        AND access_row.student_id = v_student_id
        AND access_row.game_id = v_game.id
        AND access_row.is_enabled
    ) INTO v_is_prerelease_test;

    IF NOT v_is_prerelease_test THEN
      RAISE EXCEPTION '[ARCADE] this game is not currently available.' USING ERRCODE = 'P0197';
    END IF;
  END IF;

  v_is_prerelease_test := v_is_prerelease_test OR public.is_live_test_agent(v_student_id);

  SELECT * INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id = v_game.id AND is_active
  ORDER BY id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[ARCADE] active game rule version is missing.' USING ERRCODE = 'P0198';
  END IF;

  v_seed := public.arcade_generate_run_seed();

  INSERT INTO public.arcade_runs (
    classroom_id, student_id, game_id, rule_version_id, status,
    schedule_seed, countdown_started_at, is_prerelease_test
  ) VALUES (
    v_classroom_id, v_student_id, v_game.id, v_rule.id, 'COUNTDOWN',
    v_seed, now(), v_is_prerelease_test
  )
  RETURNING * INTO v_run;

  RETURN jsonb_build_object(
    'run_id', v_run.id,
    'game_code', v_game.code,
    'rule_version', v_rule.version_code,
    'countdown_started_at', v_run.countdown_started_at,
    'countdown_ends_at', v_run.countdown_started_at + ((v_rule.config ->> 'countdown_ms')::integer * interval '1 millisecond'),
    'schedule_seed', v_run.schedule_seed,
    'config', v_rule.config,
    'is_prerelease_test', v_run.is_prerelease_test
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 9. Arcade monthly top10 resolver
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_top10(
  p_classroom_id integer,
  p_period_id bigint,
  p_game_id bigint
)
RETURNS TABLE(
  source_run_id bigint,
  student_id integer,
  official_score bigint,
  achieved_at timestamptz,
  rank integer,
  raw_bonus numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH period_scope AS (
    SELECT period.id, period.starts_at, period.ends_at_exclusive
    FROM public.arcade_ranking_periods period
    WHERE period.id = p_period_id
      AND period.classroom_id = p_classroom_id
      AND period.period_kind = 'MONTHLY'
  ), candidate_runs AS (
    SELECT run.id AS source_run_id,
           run.student_id,
           run.official_score,
           run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS student_best_row
    FROM public.arcade_runs run
    JOIN period_scope period ON run.game_over_at >= period.starts_at
                           AND run.game_over_at < period.ends_at_exclusive
    WHERE run.classroom_id = p_classroom_id
      AND run.game_id = p_game_id
      AND run.status = 'VERIFIED'
      AND public.is_official_participant(run.student_id)
      AND NOT run.is_prerelease_test
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.source_run_id,
           candidate.student_id,
           candidate.official_score,
           candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.source_run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.student_best_row = 1
  )
  SELECT ranked.source_run_id,
         ranked.student_id,
         ranked.official_score,
         ranked.game_over_at AS achieved_at,
         ranked.rank::integer,
         CASE
           WHEN ranked.rank = 1 THEN 30::numeric
           WHEN ranked.rank = 2 THEN 27::numeric
           WHEN ranked.rank = 3 THEN 24::numeric
           WHEN ranked.rank BETWEEN 4 AND 6 THEN 18::numeric
           WHEN ranked.rank BETWEEN 7 AND 10 THEN 15::numeric
         END AS raw_bonus
  FROM ranked
  WHERE ranked.rank <= 10
  ORDER BY ranked.rank;
$$;

-- --------------------------------------------------------------------------
-- 10. Arcade full-rank resolver
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.arcade_resolve_period_student_ranks(p_classroom_id integer, p_period_id bigint, p_game_id bigint)
 RETURNS TABLE(source_run_id bigint, student_id integer, official_score bigint, achieved_at timestamp with time zone, rank integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH period_scope AS (
    SELECT period.id, period.starts_at, period.ends_at_exclusive
    FROM public.arcade_ranking_periods period
    WHERE period.id = p_period_id
      AND period.classroom_id = p_classroom_id
      AND period.period_kind = 'MONTHLY'
  ), candidate_runs AS (
    SELECT run.id AS source_run_id,
           run.student_id,
           run.official_score,
           run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS student_best_row
    FROM public.arcade_runs run
    JOIN period_scope period ON run.game_over_at >= period.starts_at
                           AND run.game_over_at < period.ends_at_exclusive
    WHERE run.classroom_id = p_classroom_id
      AND run.game_id = p_game_id
      AND run.status = 'VERIFIED'
      AND public.is_official_participant(run.student_id)
      AND NOT run.is_prerelease_test
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id
          AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.source_run_id,
           candidate.student_id,
           candidate.official_score,
           candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.source_run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.student_best_row = 1
  )
  SELECT ranked.source_run_id,
         ranked.student_id,
         ranked.official_score,
         ranked.game_over_at AS achieved_at,
         ranked.rank::integer
  FROM ranked
  ORDER BY ranked.rank;
$function$


-- --------------------------------------------------------------------------
-- 11. Arcade leaderboard
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_arcade_leaderboard(p_game_code text, p_period_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer;
  v_student_id integer;
  v_period public.arcade_ranking_periods%ROWTYPE;
  v_game_id bigint;
  v_snapshot_id bigint;
  v_result jsonb;
BEGIN
  v_classroom_id := public.current_classroom_id();
  v_student_id := public.current_student_id();
  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] classroom context is required.' USING ERRCODE = 'P0204';
  END IF;

  SELECT * INTO v_period
  FROM public.arcade_ranking_periods
  WHERE id = p_period_id AND classroom_id = v_classroom_id;
  IF NOT FOUND OR v_period.status NOT IN ('ACTIVE', 'FINALIZED') THEN
    RAISE EXCEPTION '[ARCADE] active or finalized ranking period was not found.' USING ERRCODE = 'P0205';
  END IF;

  SELECT id INTO v_game_id
  FROM public.arcade_games
  WHERE code = p_game_code;
  IF v_game_id IS NULL THEN
    RAISE EXCEPTION '[ARCADE] game was not found.' USING ERRCODE = 'P0206';
  END IF;

  IF v_period.period_kind = 'MONTHLY' AND v_period.status = 'FINALIZED' THEN
    SELECT snapshot.id INTO v_snapshot_id
    FROM public.arcade_monthly_snapshots snapshot
    WHERE snapshot.period_id = v_period.id
      AND snapshot.game_id = v_game_id;

    IF v_snapshot_id IS NULL THEN
      RAISE EXCEPTION '[ARCADE] finalized monthly snapshot is missing for this period/game; data integrity error.'
        USING ERRCODE = 'P0220';
    END IF;

    SELECT jsonb_build_object(
      'period_id', v_period.id,
      'period_kind', v_period.period_kind,
      'game_code', p_game_code,
      'top10', coalesce((
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank', entry.rank,
            'student_id', entry.student_id,
            'student_name', student.name,
            'official_score', entry.official_score,
            'game_over_at', entry.achieved_at
          ) ORDER BY entry.rank
        )
        FROM public.arcade_monthly_snapshot_entries entry
        JOIN public.students student ON student.id = entry.student_id
        WHERE entry.snapshot_id = v_snapshot_id
          AND public.is_official_participant(entry.student_id)
      ), '[]'::jsonb),
      'my_rank', (
        SELECT rank_row.rank
        FROM public.arcade_monthly_snapshot_student_ranks rank_row
        WHERE rank_row.snapshot_id = v_snapshot_id
          AND rank_row.student_id = v_student_id
          AND public.is_official_participant(rank_row.student_id)
      ),
      'my_score', (
        SELECT rank_row.official_score
        FROM public.arcade_monthly_snapshot_student_ranks rank_row
        WHERE rank_row.snapshot_id = v_snapshot_id
          AND rank_row.student_id = v_student_id
          AND public.is_official_participant(rank_row.student_id)
      )
    ) INTO v_result;

    RETURN v_result;
  END IF;

  WITH candidate_runs AS (
    SELECT run.id AS run_id, run.student_id, run.official_score, run.game_over_at,
           row_number() OVER (
             PARTITION BY run.student_id
             ORDER BY run.official_score DESC, run.game_over_at ASC, run.id ASC
           ) AS best_row
    FROM public.arcade_runs run
    WHERE run.classroom_id = v_classroom_id
      AND run.game_id = v_game_id
      AND run.status = 'VERIFIED'
      AND public.is_official_participant(run.student_id)
      AND NOT run.is_prerelease_test
      AND run.game_over_at >= v_period.starts_at
      AND run.game_over_at < v_period.ends_at_exclusive
      AND NOT EXISTS (
        SELECT 1
        FROM public.arcade_run_moderation_events moderation
        WHERE moderation.run_id = run.id AND moderation.event_kind = 'INVALIDATE'
      )
  ), ranked AS (
    SELECT candidate.run_id, candidate.student_id, candidate.official_score, candidate.game_over_at,
           row_number() OVER (
             ORDER BY candidate.official_score DESC, candidate.game_over_at ASC, candidate.run_id ASC
           ) AS rank
    FROM candidate_runs candidate
    WHERE candidate.best_row = 1
  )
  SELECT jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'rank', ranked.rank,
          'student_id', ranked.student_id,
          'student_name', student.name,
          'official_score', ranked.official_score,
          'game_over_at', ranked.game_over_at
        ) ORDER BY ranked.rank
      ) FILTER (WHERE ranked.rank <= 10),
      '[]'::jsonb
    ),
    'my_rank', max(ranked.rank) FILTER (WHERE ranked.student_id = v_student_id),
    'my_score', max(ranked.official_score) FILTER (WHERE ranked.student_id = v_student_id)
  ) INTO v_result
  FROM ranked
  JOIN public.students student ON student.id = ranked.student_id;

  RETURN coalesce(v_result, jsonb_build_object(
    'period_id', v_period.id,
    'period_kind', v_period.period_kind,
    'game_code', p_game_code,
    'top10', '[]'::jsonb,
    'my_rank', NULL,
    'my_score', NULL
  ));
END;
$function$


COMMIT;

WITH fn AS (
  SELECT p.proname, pg_get_functiondef(p.oid) def
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
)
SELECT jsonb_pretty(jsonb_build_object(
  'phase_b_postcheck',jsonb_build_object(
    'official_participants_classroom_1',(SELECT count(*) FROM public.students s WHERE s.classroom_id=1 AND s.transferred_at IS NULL AND public.is_official_participant(s.id)),
    'live_test_agents_classroom_1',(SELECT count(*) FROM public.students s WHERE s.classroom_id=1 AND s.transferred_at IS NULL AND public.is_live_test_agent(s.id)),
    'test_agent_ranking_rows',(SELECT count(*) FROM public.rankings r JOIN public.students s ON s.id=r.student_id WHERE s.is_test_account=true),
    'function_guards',jsonb_build_object(
      'calculate_rankings',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='calculate_rankings' LIMIT 1),
      'calculate_daily_statistics',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='calculate_daily_statistics' LIMIT 1),
      'achievement_statistics',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='teacher_get_achievement_statistics' LIMIT 1),
      'welfare_donation',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='donate_to_welfare_fund' LIMIT 1),
      'guild_monthly_scores',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='guild2_refresh_monthly_scores' LIMIT 1),
      'guild5_finalize',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='teacher_finalize_guild5_month' LIMIT 1),
      'arcade_run_auto_test',(SELECT def ILIKE '%is_live_test_agent%' FROM fn WHERE proname='student_create_arcade_run' LIMIT 1),
      'arcade_top10',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='arcade_resolve_period_top10' LIMIT 1),
      'arcade_full_rank',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='arcade_resolve_period_student_ranks' LIMIT 1),
      'arcade_leaderboard',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='get_arcade_leaderboard' LIMIT 1),
      'hall_of_fame',(SELECT def ILIKE '%is_official_participant%' FROM fn WHERE proname='teacher_add_hall_of_fame_entry' LIMIT 1)
    )
  )
)) AS live_test_agent_phase_b_postcheck;

RESET ROLE;
