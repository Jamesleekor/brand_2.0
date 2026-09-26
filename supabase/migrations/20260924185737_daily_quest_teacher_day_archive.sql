-- B.R.A.N.D 2.0
-- Daily Quest teacher date ledger + legacy read-only archive
-- Production migration version: 20260924185737
-- Applied to production on 2026-09-25 KST.
--
-- Safety contract:
-- 1) Existing reports/checks/completions/transactions are never rewritten.
-- 2) Teacher-created reward-bearing reports may be created for KST TODAY only.
-- 3) A missing Daily Quest Manager does not block teacher creation.
-- 4) Legacy (< 2026-08-29) Daily Quest data is READ ONLY and never enters settlement.
-- 5) Legacy archive RPC never calls wallet / transaction / settlement functions.

ALTER TABLE public.daily_quest_reports
  ALTER COLUMN manager_student_id DROP NOT NULL;

COMMENT ON COLUMN public.daily_quest_reports.manager_student_id IS
  'Daily Quest manager snapshot. NULL is allowed only for teacher-created emergency reports when no manager is assigned.';

CREATE OR REPLACE FUNCTION public.teacher_get_daily_quest_day_state(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer := public.current_classroom_id();
  v_date date := coalesce(p_date, (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date);
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_cutover date := date '2026-08-29';
  v_report public.daily_quest_reports%ROWTYPE;
  v_legacy_entry_count integer := 0;
  v_create_block_reason text := NULL;
BEGIN
  PERFORM public.ensure_teacher_role();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[DQT1] 학급 정보를 찾을 수 없습니다.' USING ERRCODE='DQ401';
  END IF;

  SELECT *
    INTO v_report
  FROM public.daily_quest_reports
  WHERE classroom_id = v_classroom_id
    AND quest_date = v_date
  LIMIT 1;

  IF v_date < v_cutover THEN
    SELECT count(*)::integer
      INTO v_legacy_entry_count
    FROM public.legacy_asset_history lah
    WHERE lah.classroom_id = v_classroom_id
      AND lah.event_date = v_date
      AND regexp_replace(coalesce(lah.memo,''),'[[:space:]]+','','g') ILIKE '일일퀘스트%';
  END IF;

  IF v_report.id IS NULL THEN
    IF v_date < v_cutover THEN
      v_create_block_reason :=
        '구버전 일일퀘스트 기록은 이미 지급된 보상 이력이며 조회 전용입니다. 새 정산표를 만들거나 다시 보상하지 않습니다.';
    ELSIF v_date <> v_today THEN
      v_create_block_reason :=
        '과거 날짜는 당시 1인1역 역할·일급 스냅샷을 안전하게 복원할 수 없어 새 지급용 정산표를 생성하지 않습니다.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'quest_date', v_date,
    'today', v_today,
    'cutover_date', v_cutover,
    'report_exists', v_report.id IS NOT NULL,
    'report_id', v_report.id,
    'report_status', v_report.status,
    'manager_student_id', v_report.manager_student_id,
    'can_create', v_report.id IS NULL AND v_date = v_today,
    'is_legacy_archive', v_date < v_cutover,
    'has_legacy_archive', v_legacy_entry_count > 0,
    'legacy_entry_count', v_legacy_entry_count,
    'create_block_reason', v_create_block_reason,
    'read_only_legacy', v_date < v_cutover,
    'legacy_rewards_already_applied', v_date < v_cutover
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_create_daily_quest_report(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer := public.current_classroom_id();
  v_date date := coalesce(p_date, (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date);
  v_today date := (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_report_id bigint;
  v_existing public.daily_quest_reports%ROWTYPE;
  v_manager_id integer;
  v_manager_count integer;
  v_student_count integer;
  v_missing_jobs integer;
  v_multi_jobs integer;
  v_bad_wages integer;
  v_quest_count integer;
  r record;
  v_attendance_result text;
BEGIN
  PERFORM public.ensure_teacher_role();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[DQT1] 학급 정보를 찾을 수 없습니다.' USING ERRCODE='DQ401';
  END IF;

  IF v_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION '[DQT1] 새 지급용 일일퀘스트 정산표는 KST 오늘 날짜에만 생성할 수 있습니다.' USING ERRCODE='DQ402';
  END IF;

  PERFORM pg_advisory_xact_lock(
    v_classroom_id,
    (v_date - date '2000-01-01')::integer
  );

  SELECT *
    INTO v_existing
  FROM public.daily_quest_reports
  WHERE classroom_id = v_classroom_id
    AND quest_date = v_date
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_exists', true,
      'report_id', v_existing.id,
      'status', v_existing.status,
      'quest_date', v_existing.quest_date,
      'manager_student_id', v_existing.manager_student_id,
      'teacher_created', coalesce((v_existing.metadata->>'created_by_teacher')::boolean, false),
      'manager_missing', v_existing.manager_student_id IS NULL
    );
  END IF;

  SELECT count(*)::integer
    INTO v_quest_count
  FROM public.daily_quests q
  WHERE q.is_active = true
    AND q.quest_uid IN (
      'S3-DQ-ATTENDANCE',
      'S3-DQ-PRIMARY-JOB',
      'S3-DQ-LEARNING-MATERIALS',
      'S3-DQ-CLEANING'
    );

  IF v_quest_count <> 4 THEN
    RAISE EXCEPTION '[DQT1] 활성 canonical 일일퀘스트가 4종이 아닙니다. 현재=%', v_quest_count USING ERRCODE='DQ403';
  END IF;

  SELECT count(*)::integer
    INTO v_student_count
  FROM public.students s
  WHERE s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND public.is_official_participant(s.id)
    AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD');

  IF v_student_count < 1 THEN
    RAISE EXCEPTION '[DQT1] 활성 학생이 없습니다.' USING ERRCODE='DQ404';
  END IF;

  SELECT count(*)::integer
    INTO v_missing_jobs
  FROM public.students s
  WHERE s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND public.is_official_participant(s.id)
    AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND NOT EXISTS (
      SELECT 1
      FROM public.primary_jobs pj
      WHERE pj.student_id = s.id
        AND pj.classroom_id = v_classroom_id
        AND pj.is_active = true
        AND pj.released_at IS NULL
    );

  SELECT count(*)::integer
    INTO v_multi_jobs
  FROM (
    SELECT s.id
    FROM public.students s
    JOIN public.primary_jobs pj
      ON pj.student_id = s.id
     AND pj.classroom_id = v_classroom_id
     AND pj.is_active = true
     AND pj.released_at IS NULL
    WHERE s.classroom_id = v_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id)
      AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD')
    GROUP BY s.id
    HAVING count(*) <> 1
  ) x;

  SELECT count(*)::integer
    INTO v_bad_wages
  FROM public.students s
  JOIN public.primary_jobs pj
    ON pj.student_id = s.id
   AND pj.classroom_id = v_classroom_id
   AND pj.is_active = true
   AND pj.released_at IS NULL
  WHERE s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND public.is_official_participant(s.id)
    AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND pj.daily_wage <= 0;

  IF v_missing_jobs > 0 OR v_multi_jobs > 0 OR v_bad_wages > 0 THEN
    RAISE EXCEPTION '[DQT1] 1인1역 준비가 완료되지 않았습니다. 미배정=% 다중배정=% 비정상일급=%',
      v_missing_jobs, v_multi_jobs, v_bad_wages USING ERRCODE='DQ405';
  END IF;

  SELECT count(*)::integer, min(pj.student_id)
    INTO v_manager_count, v_manager_id
  FROM public.primary_jobs pj
  JOIN public.students s ON s.id = pj.student_id
  WHERE pj.classroom_id = v_classroom_id
    AND pj.is_active = true
    AND pj.released_at IS NULL
    AND pj.daily_wage > 0
    AND s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND public.is_official_participant(s.id)
    AND public._daily_quest_normalize_job_name(pj.job_name)
        IN ('일일퀘스트관리자','일퀘관리자');

  IF v_manager_count > 1 THEN
    RAISE EXCEPTION '[DQT1] 일일퀘스트 관리자 배정이 2명 이상입니다. 현재=%', v_manager_count USING ERRCODE='DQ406';
  END IF;

  IF v_manager_count = 0 THEN
    v_manager_id := NULL;
  END IF;

  INSERT INTO public.daily_quest_reports(
    classroom_id,
    quest_date,
    manager_student_id,
    status,
    metadata
  ) VALUES (
    v_classroom_id,
    v_date,
    v_manager_id,
    'DRAFT',
    jsonb_build_object(
      'version','S3_TEACHER_DAY_V1',
      'created_by_teacher',true,
      'manager_missing',v_manager_id IS NULL,
      'student_count',v_student_count,
      'reward_contract','X => same BV and gross GOLD; PRIMARY_JOB X=daily_wage snapshot'
    )
  )
  RETURNING id INTO v_report_id;

  FOR r IN
    SELECT
      s.id AS student_id,
      pj.id AS primary_job_id,
      pj.job_name,
      pj.daily_wage,
      pj.assigned_area,
      pj.assigned_at,
      a.status AS attendance_status
    FROM public.students s
    JOIN public.primary_jobs pj
      ON pj.student_id = s.id
     AND pj.classroom_id = v_classroom_id
     AND pj.is_active = true
     AND pj.released_at IS NULL
    LEFT JOIN public.attendances a
      ON a.student_id = s.id
     AND a.classroom_id = v_classroom_id
     AND a.attendance_date = v_date
    WHERE s.classroom_id = v_classroom_id
      AND s.transferred_at IS NULL
      AND public.is_official_participant(s.id)
      AND s.role IN ('STUDENT','STUDENT_LEADER','GUARD')
    ORDER BY s.name, s.id
  LOOP
    v_attendance_result := CASE
      WHEN r.attendance_status = 'PRESENT'::public.attendance_status THEN 'PASS'
      WHEN r.attendance_status IN (
        'LATE'::public.attendance_status,
        'ABSENT'::public.attendance_status,
        'EXCUSED'::public.attendance_status
      ) THEN 'FAIL'
      ELSE 'UNCHECKED'
    END;

    INSERT INTO public.daily_quest_checks(
      report_id, student_id, quest_code, result, check_source,
      reward_bv_snapshot, reward_gold_gross_snapshot, checked_at
    ) VALUES (
      v_report_id, r.student_id, 'ATTENDANCE', v_attendance_result, 'AUTO_ATTENDANCE',
      100, 100,
      CASE WHEN v_attendance_result='UNCHECKED' THEN NULL ELSE now() END
    );

    INSERT INTO public.daily_quest_checks(
      report_id, student_id, quest_code, result, check_source,
      reward_bv_snapshot, reward_gold_gross_snapshot,
      primary_job_id_snapshot, job_name_snapshot, job_wage_snapshot,
      assigned_area_snapshot, assigned_at_snapshot
    ) VALUES (
      v_report_id, r.student_id, 'PRIMARY_JOB', 'UNCHECKED', 'DAILY_QUEST_MANAGER',
      r.daily_wage, r.daily_wage,
      r.primary_job_id, r.job_name, r.daily_wage,
      r.assigned_area, r.assigned_at
    );

    INSERT INTO public.daily_quest_checks(
      report_id, student_id, quest_code, result, check_source,
      reward_bv_snapshot, reward_gold_gross_snapshot
    ) VALUES
      (v_report_id, r.student_id, 'LEARNING_MATERIALS', 'UNCHECKED', 'DAILY_QUEST_MANAGER', 100, 100),
      (v_report_id, r.student_id, 'CLEANING', 'UNCHECKED', 'DAILY_QUEST_MANAGER', 100, 100);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'already_exists', false,
    'report_id', v_report_id,
    'status', 'DRAFT',
    'quest_date', v_date,
    'manager_student_id', v_manager_id,
    'teacher_created', true,
    'manager_missing', v_manager_id IS NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_get_legacy_daily_quest_archive(
  p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_classroom_id integer := public.current_classroom_id();
  v_date date := coalesce(p_date, (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date);
  v_cutover date := date '2026-08-29';
  v_students jsonb := '[]'::jsonb;
  v_summary jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[DQT1] 학급 정보를 찾을 수 없습니다.' USING ERRCODE='DQ401';
  END IF;

  IF v_date >= v_cutover THEN
    RETURN jsonb_build_object(
      'mode','NOT_LEGACY',
      'quest_date',v_date,
      'cutover_date',v_cutover,
      'read_only',true,
      'rewards_already_applied',false,
      'summary',jsonb_build_object(
        'entry_count',0,'student_count',0,'total_bv',0,'total_gold',0,'parsed_tax_total',0
      ),
      'students','[]'::jsonb
    );
  END IF;

  WITH base AS (
    SELECT
      lah.id,
      lah.source_row,
      lah.student_id,
      lah.event_date,
      lah.source_timestamp_local,
      lah.occurred_at,
      lah.brand_name_snapshot,
      coalesce(lah.bv_delta,0)::bigint AS bv_delta,
      coalesce(lah.gold_delta,0)::bigint AS gold_delta,
      lah.memo,
      coalesce((substring(coalesce(lah.memo,'') from '세금[[:space:]]*([0-9]+)'))::integer,0) AS parsed_tax
    FROM public.legacy_asset_history lah
    WHERE lah.classroom_id = v_classroom_id
      AND lah.event_date = v_date
      AND regexp_replace(coalesce(lah.memo,''),'[[:space:]]+','','g') ILIKE '일일퀘스트%'
  ),
  per_student AS (
    SELECT
      b.student_id,
      count(*)::integer AS entry_count,
      sum(b.bv_delta)::bigint AS total_bv,
      sum(b.gold_delta)::bigint AS total_gold,
      sum(b.parsed_tax)::bigint AS parsed_tax_total,
      max(b.brand_name_snapshot) FILTER (WHERE b.brand_name_snapshot IS NOT NULL) AS brand_name_snapshot,
      jsonb_agg(
        jsonb_build_object(
          'legacy_id',b.id,
          'source_row',b.source_row,
          'source_timestamp_local',b.source_timestamp_local,
          'occurred_at',b.occurred_at,
          'bv_delta',b.bv_delta,
          'gold_delta',b.gold_delta,
          'parsed_tax',b.parsed_tax,
          'memo',b.memo
        )
        ORDER BY coalesce(b.occurred_at, b.event_date::timestamp), b.id
      ) AS entries
    FROM base b
    GROUP BY b.student_id
  )
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'student_id',ps.student_id,
      'student_name',coalesce(s.name,'학생 #' || ps.student_id::text),
      'brand_name',coalesce(s.brand_name,ps.brand_name_snapshot),
      'entry_count',ps.entry_count,
      'total_bv',ps.total_bv,
      'total_gold',ps.total_gold,
      'parsed_tax_total',ps.parsed_tax_total,
      'entries',ps.entries
    )
    ORDER BY coalesce(s.name,'학생 #' || ps.student_id::text), ps.student_id
  ),'[]'::jsonb)
  INTO v_students
  FROM per_student ps
  LEFT JOIN public.students s ON s.id = ps.student_id;

  WITH base AS (
    SELECT
      lah.student_id,
      coalesce(lah.bv_delta,0)::bigint AS bv_delta,
      coalesce(lah.gold_delta,0)::bigint AS gold_delta,
      coalesce((substring(coalesce(lah.memo,'') from '세금[[:space:]]*([0-9]+)'))::integer,0) AS parsed_tax
    FROM public.legacy_asset_history lah
    WHERE lah.classroom_id = v_classroom_id
      AND lah.event_date = v_date
      AND regexp_replace(coalesce(lah.memo,''),'[[:space:]]+','','g') ILIKE '일일퀘스트%'
  )
  SELECT jsonb_build_object(
    'entry_count',count(*)::integer,
    'student_count',count(DISTINCT student_id)::integer,
    'total_bv',coalesce(sum(bv_delta),0),
    'total_gold',coalesce(sum(gold_delta),0),
    'parsed_tax_total',coalesce(sum(parsed_tax),0)
  )
  INTO v_summary
  FROM base;

  RETURN jsonb_build_object(
    'mode','LEGACY_ARCHIVE',
    'quest_date',v_date,
    'cutover_date',v_cutover,
    'read_only',true,
    'rewards_already_applied',true,
    'source','legacy_asset_history',
    'detail_level','DAILY_SETTLEMENT_LEDGER_ONLY',
    'summary',v_summary,
    'students',v_students
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.teacher_get_daily_quest_day_state(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_create_daily_quest_report(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_get_legacy_daily_quest_archive(date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_get_daily_quest_day_state(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_create_daily_quest_report(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_legacy_daily_quest_archive(date) TO authenticated;

COMMENT ON FUNCTION public.teacher_get_daily_quest_day_state(date) IS
  'Teacher-only Daily Quest date state. Does not create reports and does not mutate rewards.';
COMMENT ON FUNCTION public.teacher_create_daily_quest_report(date) IS
  'Teacher-only emergency Daily Quest report creation. KST today only. Allows no manager; does not itself pay rewards.';
COMMENT ON FUNCTION public.teacher_get_legacy_daily_quest_archive(date) IS
  'Teacher-only read-only legacy Daily Quest archive for dates before 2026-08-29. Never pays rewards.';
