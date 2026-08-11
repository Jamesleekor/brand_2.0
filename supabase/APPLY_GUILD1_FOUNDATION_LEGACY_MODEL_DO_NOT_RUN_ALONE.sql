-- ============================================================================
-- B.R.A.N.D 2.0 — Guild 1 Foundation
-- 2026-08-11
-- 목적
--   1) 길드 소속을 '현재값'이 아니라 시간 구간 + 감사 이벤트로 보존
--   2) 한 학생이 동시에 둘 이상의 활성 길드에 속하지 못하도록 DB에서 보장
--   3) 시즌 운영 메타데이터 보강
--   4) 학교 출석과 분리된 '길드 세션' 및 세션 당시 구성원 snapshot 구축
--   5) 교사 전용 변경 RPC + 학생/교사 읽기 RPC + Realtime 기반 마련
--
-- 중요
--   - 기존 guild_session_attendances 는 1.0/초기 2.0 호환 데이터를 위해 건드리지 않는다.
--   - 새 길드 세션 런타임은 guild_sessions / guild_session_participants 를 사용한다.
--   - Guild 2의 GS 산식, Guild 3 미션, Guild 4 동료평가, Guild 5 점령 규칙은 여기서 구현하지 않는다.
-- ============================================================================

BEGIN;

-- --------------------------------------------------------------------------
-- 0. Preflight
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.guilds') IS NULL THEN
    RAISE EXCEPTION '[G1] required table missing: public.guilds';
  END IF;
  IF to_regclass('public.guild_members') IS NULL THEN
    RAISE EXCEPTION '[G1] required table missing: public.guild_members';
  END IF;
  IF to_regclass('public.guild_seasons') IS NULL THEN
    RAISE EXCEPTION '[G1] required table missing: public.guild_seasons';
  END IF;
  IF to_regclass('public.students') IS NULL THEN
    RAISE EXCEPTION '[G1] required table missing: public.students';
  END IF;
  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.is_teacher_or_admin()') IS NULL THEN
    RAISE EXCEPTION '[G1] identity helper functions are missing';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 1. 기존 길드 테이블을 파괴 없이 보강
-- --------------------------------------------------------------------------
ALTER TABLE public.guilds
  ADD COLUMN IF NOT EXISTS classroom_id integer,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS element_code text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 기존 데이터에서 길드의 학급을 추론한다. 서로 다른 학급의 학생이 같은 guild_id를
-- 공유하는 경우에는 임의 보정하지 않고 NULL로 남겨 운영자가 확인할 수 있게 한다.
WITH inferred AS (
  SELECT gm.guild_id,
         CASE WHEN count(DISTINCT s.classroom_id) = 1 THEN min(s.classroom_id) ELSE NULL END AS classroom_id
  FROM public.guild_members gm
  JOIN public.students s ON s.id = gm.student_id
  GROUP BY gm.guild_id
)
UPDATE public.guilds g
SET classroom_id = i.classroom_id
FROM inferred i
WHERE g.id = i.guild_id
  AND g.classroom_id IS NULL
  AND i.classroom_id IS NOT NULL;

-- 초기 2.0은 길드 속성을 guild_members.element에 보관했다. 현재 활성 멤버들이
-- 하나의 속성으로 일치하는 길드는 그 값을 길드 마스터 컬럼(element_code)으로 승격한다.
WITH normalized AS (
  SELECT gm.guild_id,
         CASE
           WHEN upper(gm.element::text)='EARTH' OR gm.element::text='땅' THEN 'EARTH'
           WHEN upper(gm.element::text)='WATER' OR gm.element::text='물' THEN 'WATER'
           WHEN upper(gm.element::text)='LIGHT' OR gm.element::text='빛' THEN 'LIGHT'
           WHEN upper(gm.element::text)='WIND'  OR gm.element::text='바람' THEN 'WIND'
           WHEN upper(gm.element::text)='FIRE'  OR gm.element::text='불' THEN 'FIRE'
           ELSE NULL
         END AS element_code
  FROM public.guild_members gm
  WHERE gm.element IS NOT NULL
), one_value AS (
  SELECT guild_id, min(element_code) AS element_code
  FROM normalized
  WHERE element_code IS NOT NULL
  GROUP BY guild_id
  HAVING count(DISTINCT element_code)=1
)
UPDATE public.guilds g
SET element_code=o.element_code
FROM one_value o
WHERE g.id=o.guild_id AND g.element_code IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname='guilds_g1_element_code_check'
      AND conrelid='public.guilds'::regclass
  ) THEN
    ALTER TABLE public.guilds
      ADD CONSTRAINT guilds_g1_element_code_check
      CHECK (element_code IS NULL OR element_code IN ('EARTH','WATER','LIGHT','WIND','FIRE')) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.guild_members
  ADD COLUMN IF NOT EXISTS joined_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS left_at timestamptz,
  ADD COLUMN IF NOT EXISTS leave_reason text,
  ADD COLUMN IF NOT EXISTS changed_by_user_id uuid;

-- 과거 2.0 스키마가 student_id 자체를 UNIQUE로 묶어 두었다면 동일 학생의 과거 행을
-- 보존할 수 없다. 'student_id 단독 UNIQUE'만 정확히 찾아 해제하고, 아래의
-- '활성 행(left_at IS NULL) 1개' partial unique index로 대체한다. PK/복합 UNIQUE는 건드리지 않는다.
DO $$
DECLARE
  r record;
  v_student_attnum smallint;
BEGIN
  SELECT attnum INTO v_student_attnum
  FROM pg_attribute
  WHERE attrelid='public.guild_members'::regclass AND attname='student_id' AND NOT attisdropped;

  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid='public.guild_members'::regclass
      AND c.contype='u'
      AND array_length(c.conkey,1)=1
      AND c.conkey[1]=v_student_attnum
  LOOP
    EXECUTE format('ALTER TABLE public.guild_members DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT ci.relname AS index_name
    FROM pg_index i
    JOIN pg_class ci ON ci.oid=i.indexrelid
    LEFT JOIN pg_constraint c ON c.conindid=i.indexrelid
    WHERE i.indrelid='public.guild_members'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND c.oid IS NULL
      AND i.indexprs IS NULL
      AND i.indpred IS NULL
      AND i.indnkeyatts=1
      AND i.indkey[0]=v_student_attnum
  LOOP
    EXECUTE format('DROP INDEX public.%I', r.index_name);
  END LOOP;
END $$;

-- 핵심 안전장치: 현재 활성 소속이 2개 이상이면 먼저 사람이 확인해야 한다.
DO $$
DECLARE
  v_dup text;
BEGIN
  SELECT string_agg(student_id::text, ', ' ORDER BY student_id)
  INTO v_dup
  FROM (
    SELECT student_id
    FROM public.guild_members
    WHERE left_at IS NULL
    GROUP BY student_id
    HAVING count(*) > 1
  ) d;

  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION '[G1] duplicate active guild membership found for student_id(s): %. Resolve before applying migration.', v_dup;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guild_members_one_active_per_student
  ON public.guild_members(student_id)
  WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_guild_members_history_student
  ON public.guild_members(student_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS ix_guild_members_active_guild
  ON public.guild_members(guild_id, student_id)
  WHERE left_at IS NULL;

-- 신규 생성/이동 RPC가 예측하지 못하는 legacy NOT NULL 컬럼을 만났을 때
-- 운영 중 런타임 실패로 드러나지 않도록 설치 단계에서 먼저 중단한다.
DO $$
DECLARE
  v_required text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
    INTO v_required
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='guilds'
    AND is_nullable='NO'
    AND column_default IS NULL
    AND coalesce(is_identity,'NO')='NO'
    AND column_name NOT IN (
      'id','classroom_id','name','slogan','logo_url','description','element_code',
      'is_active','created_at','updated_at',
      -- 초기 Stage 9 스키마 호환: season_id/guild_uid는 아래 생성 RPC에서 명시적으로 채운다.
      'season_id','guild_uid'
    );
  IF v_required IS NOT NULL THEN
    RAISE EXCEPTION '[G1] unsupported required guilds legacy column(s): %. Add a mapping before applying.', v_required;
  END IF;

  SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
    INTO v_required
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='guild_members'
    AND is_nullable='NO'
    AND column_default IS NULL
    AND coalesce(is_identity,'NO')='NO'
    AND column_name NOT IN (
      'id','guild_id','student_id','element','joined_at','left_at','leave_reason',
      'changed_by_user_id','created_at','updated_at',
      -- 초기 Stage 9 스키마 호환: 길드 소속도 season_id를 필수 보관한다.
      'season_id'
    );
  IF v_required IS NOT NULL THEN
    RAISE EXCEPTION '[G1] unsupported required guild_members legacy column(s): %. Add a mapping before applying.', v_required;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- 2. 기존 guild_seasons를 Guild 1 운영에 필요한 공통 컬럼으로 보강
--    기존 컬럼은 삭제/변경하지 않는다.
-- --------------------------------------------------------------------------
ALTER TABLE public.guild_seasons
  ADD COLUMN IF NOT EXISTS classroom_id integer,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS school_year integer,
  ADD COLUMN IF NOT EXISTS starts_on date,
  ADD COLUMN IF NOT EXISTS ends_on date,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'PLANNED',
  ADD COLUMN IF NOT EXISTS created_by_user_id uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 기존 2.0 배포본의 legacy 컬럼명이 다를 수 있으므로, 알려진 alias는 공통 컬럼으로
-- 한 번만 역채움한다. 학급은 DB 전체에 실제 학급이 하나뿐일 때만 안전하게 추론한다.
DO $$
DECLARE
  v_only_classroom integer;
BEGIN
  SELECT min(classroom_id)
    INTO v_only_classroom
  FROM public.students
  WHERE classroom_id IS NOT NULL
  HAVING count(DISTINCT classroom_id)=1;

  IF v_only_classroom IS NOT NULL THEN
    UPDATE public.guild_seasons SET classroom_id=v_only_classroom WHERE classroom_id IS NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='season_name') THEN
    EXECUTE 'UPDATE public.guild_seasons SET display_name=season_name WHERE display_name IS NULL AND season_name IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='name') THEN
    EXECUTE 'UPDATE public.guild_seasons SET display_name=name WHERE display_name IS NULL AND name IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='start_date') THEN
    EXECUTE 'UPDATE public.guild_seasons SET starts_on=start_date::date WHERE starts_on IS NULL AND start_date IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='end_date') THEN
    EXECUTE 'UPDATE public.guild_seasons SET ends_on=end_date::date WHERE ends_on IS NULL AND end_date IS NOT NULL';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='is_active') THEN
    EXECUTE 'UPDATE public.guild_seasons SET lifecycle_status=CASE WHEN is_active THEN ''ACTIVE'' ELSE lifecycle_status END WHERE is_active IS NOT NULL';
  END IF;

  UPDATE public.guild_seasons
  SET school_year=extract(year from starts_on)::integer
  WHERE school_year IS NULL AND starts_on IS NOT NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guild_seasons_g1_lifecycle_status_check'
      AND conrelid = 'public.guild_seasons'::regclass
  ) THEN
    ALTER TABLE public.guild_seasons
      ADD CONSTRAINT guild_seasons_g1_lifecycle_status_check
      CHECK (lifecycle_status IN ('PLANNED','ACTIVE','CLOSED')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'guild_seasons_g1_dates_check'
      AND conrelid = 'public.guild_seasons'::regclass
  ) THEN
    ALTER TABLE public.guild_seasons
      ADD CONSTRAINT guild_seasons_g1_dates_check
      CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on) NOT VALID;
  END IF;
END $$;

-- 활성 시즌 역시 임의 정리하지 않는다. 과거 데이터가 두 개 이상 ACTIVE라면 운영자가
-- 어느 시즌이 진짜인지 확인해야 하므로 migration을 중단한다.
DO $$
DECLARE
  v_dup text;
BEGIN
  SELECT string_agg(classroom_id::text, ', ' ORDER BY classroom_id)
    INTO v_dup
  FROM (
    SELECT classroom_id
    FROM public.guild_seasons
    WHERE classroom_id IS NOT NULL AND lifecycle_status='ACTIVE'
    GROUP BY classroom_id
    HAVING count(*) > 1
  ) d;
  IF v_dup IS NOT NULL THEN
    RAISE EXCEPTION '[G1] multiple ACTIVE guild seasons found for classroom_id(s): %. Resolve before applying migration.', v_dup;
  END IF;
END $$;

-- teacher_create_guild_season()가 채우지 못하는 legacy NOT NULL 컬럼이 있으면
-- 런타임에서 애매하게 실패시키지 않고 설치 단계에서 정확한 컬럼명을 알려준다.
DO $$
DECLARE
  v_required text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY ordinal_position)
    INTO v_required
  FROM information_schema.columns
  WHERE table_schema='public'
    AND table_name='guild_seasons'
    AND is_nullable='NO'
    AND column_default IS NULL
    AND coalesce(is_identity,'NO')='NO'
    AND column_name NOT IN (
      'id','classroom_id','display_name','school_year','starts_on','ends_on',
      'lifecycle_status','created_by_user_id','updated_at','season_name','name',
      'start_date','end_date','is_active','season_number','created_at'
    );
  IF v_required IS NOT NULL THEN
    RAISE EXCEPTION '[G1] unsupported required guild_seasons legacy column(s): %. Add an alias mapping before applying.', v_required;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guild_seasons_one_active_per_classroom
  ON public.guild_seasons(classroom_id)
  WHERE lifecycle_status = 'ACTIVE' AND classroom_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_guild_seasons_classroom_dates
  ON public.guild_seasons(classroom_id, starts_on, ends_on);

-- --------------------------------------------------------------------------
-- 3. 소속 변경 감사 원장
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guild_membership_events (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL,
  student_id integer NOT NULL REFERENCES public.students(id),
  from_guild_id integer REFERENCES public.guilds(id),
  to_guild_id integer REFERENCES public.guilds(id),
  from_membership_id bigint,
  to_membership_id bigint,
  from_guild_name text,
  to_guild_name text,
  event_type text NOT NULL CHECK (event_type IN ('ASSIGN','MOVE','REMOVE')),
  element_before text,
  element_after text,
  reason text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_guild_membership_events_student_time
  ON public.guild_membership_events(student_id, effective_at DESC);
CREATE INDEX IF NOT EXISTS ix_guild_membership_events_class_time
  ON public.guild_membership_events(classroom_id, effective_at DESC);

-- --------------------------------------------------------------------------
-- 4. 길드 세션: 학교 출석과 독립된 별도 기록 + 당시 구성원 snapshot
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guild_sessions (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL,
  season_id bigint,
  title text NOT NULL,
  session_date date NOT NULL,
  note text,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_guild_sessions_class_date
  ON public.guild_sessions(classroom_id, session_date DESC, id DESC);

CREATE TABLE IF NOT EXISTS public.guild_session_participants (
  id bigserial PRIMARY KEY,
  session_id bigint NOT NULL REFERENCES public.guild_sessions(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES public.students(id),
  guild_id_at_session integer NOT NULL REFERENCES public.guilds(id),
  student_name_at_session text,
  brand_name_at_session text,
  guild_name_at_session text,
  element_at_session text,
  attendance_status text NOT NULL DEFAULT 'UNMARKED'
    CHECK (attendance_status IN ('UNMARKED','PRESENT','ABSENT','EXCUSED')),
  note text,
  recorded_by_user_id uuid,
  recorded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id, student_id)
);
ALTER TABLE public.guild_session_participants
  ADD COLUMN IF NOT EXISTS student_name_at_session text,
  ADD COLUMN IF NOT EXISTS brand_name_at_session text,
  ADD COLUMN IF NOT EXISTS guild_name_at_session text,
  ADD COLUMN IF NOT EXISTS element_at_session text;
ALTER TABLE public.guild_membership_events
  ADD COLUMN IF NOT EXISTS from_membership_id bigint,
  ADD COLUMN IF NOT EXISTS to_membership_id bigint,
  ADD COLUMN IF NOT EXISTS from_guild_name text,
  ADD COLUMN IF NOT EXISTS to_guild_name text;

CREATE INDEX IF NOT EXISTS ix_guild_session_participants_student
  ON public.guild_session_participants(student_id, session_id DESC);
CREATE INDEX IF NOT EXISTS ix_guild_session_participants_session_guild
  ON public.guild_session_participants(session_id, guild_id_at_session);

COMMENT ON TABLE public.guild_session_participants IS
  'Guild 1 snapshot. 세션 생성 당시 길드 소속을 고정 보존한다. 이후 길드 이동/전입/전출로 과거 행을 재계산하지 않는다.';
COMMENT ON TABLE public.guild_membership_events IS
  '길드 배정/이동/해제 감사 원장. 과거 결과 재현을 위해 UPDATE로 덮어쓰지 않는다.';

-- --------------------------------------------------------------------------
-- 5. RLS — 읽기는 최소 공개, 쓰기는 RPC만
-- --------------------------------------------------------------------------
ALTER TABLE public.guild_membership_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild_session_participants ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guild_membership_events' AND policyname='g1_membership_events_select') THEN
    CREATE POLICY g1_membership_events_select ON public.guild_membership_events
      FOR SELECT TO authenticated
      USING (
        student_id = public.current_student_id()
        OR (public.is_teacher_or_admin() AND classroom_id = public.current_classroom_id())
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guild_sessions' AND policyname='g1_sessions_select') THEN
    CREATE POLICY g1_sessions_select ON public.guild_sessions
      FOR SELECT TO authenticated
      USING (
        classroom_id = public.current_classroom_id()
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='guild_session_participants' AND policyname='g1_session_participants_select') THEN
    CREATE POLICY g1_session_participants_select ON public.guild_session_participants
      FOR SELECT TO authenticated
      USING (
        student_id = public.current_student_id()
        OR (
          public.is_teacher_or_admin()
          AND EXISTS (
            SELECT 1 FROM public.guild_sessions gs
            WHERE gs.id = guild_session_participants.session_id
              AND gs.classroom_id = public.current_classroom_id()
          )
        )
      );
  END IF;
END $$;

-- 직접 쓰기는 모두 차단한다. SECURITY DEFINER 교사 RPC만 변경 가능.
REVOKE INSERT, UPDATE, DELETE ON public.guild_membership_events FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.guild_sessions FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.guild_session_participants FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guild_membership_events, public.guild_sessions, public.guild_session_participants TO authenticated;

-- --------------------------------------------------------------------------
-- 6. 공통 검증 helper (내부 전용)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild1_normalize_element_code(p_element text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v text := upper(btrim(coalesce(p_element,'')));
BEGIN
  IF v='' THEN RETURN NULL; END IF;
  IF v IN ('EARTH','땅') THEN RETURN 'EARTH'; END IF;
  IF v IN ('WATER','물') THEN RETURN 'WATER'; END IF;
  IF v IN ('LIGHT','빛') THEN RETURN 'LIGHT'; END IF;
  IF v IN ('WIND','바람') THEN RETURN 'WIND'; END IF;
  IF v IN ('FIRE','불') THEN RETURN 'FIRE'; END IF;
  RAISE EXCEPTION '[G1] invalid guild element: %', p_element USING ERRCODE='PG101';
END;
$$;

-- guild_members.element가 text인지 enum인지 배포본마다 달라도 안전하게 쓸 수 있도록
-- 실제 저장 문자열을 결정한다. 같은 길드의 기존 표현을 우선 보존한다.
CREATE OR REPLACE FUNCTION public.guild1_storage_element(p_guild_id bigint, p_element_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := public.guild1_normalize_element_code(p_element_code);
  v_existing text;
  v_type_oid oid;
  v_typtype "char";
  v_candidate text;
BEGIN
  IF v_code IS NULL THEN RETURN NULL; END IF;

  SELECT gm.element::text INTO v_existing
  FROM public.guild_members gm
  WHERE gm.guild_id=p_guild_id
    AND gm.element IS NOT NULL
    AND CASE
      WHEN upper(btrim(gm.element::text))='EARTH' OR btrim(gm.element::text)='땅' THEN 'EARTH'
      WHEN upper(btrim(gm.element::text))='WATER' OR btrim(gm.element::text)='물' THEN 'WATER'
      WHEN upper(btrim(gm.element::text))='LIGHT' OR btrim(gm.element::text)='빛' THEN 'LIGHT'
      WHEN upper(btrim(gm.element::text))='WIND'  OR btrim(gm.element::text)='바람' THEN 'WIND'
      WHEN upper(btrim(gm.element::text))='FIRE'  OR btrim(gm.element::text)='불' THEN 'FIRE'
      ELSE NULL
    END = v_code
  ORDER BY (gm.left_at IS NULL) DESC, gm.id DESC
  LIMIT 1;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT a.atttypid, t.typtype INTO v_type_oid, v_typtype
  FROM pg_attribute a
  JOIN pg_type t ON t.oid=a.atttypid
  WHERE a.attrelid='public.guild_members'::regclass
    AND a.attname='element'
    AND NOT a.attisdropped;

  IF v_typtype='e' THEN
    SELECT e.enumlabel INTO v_candidate
    FROM pg_enum e
    WHERE e.enumtypid=v_type_oid
      AND e.enumlabel IN (
        v_code,
        CASE v_code WHEN 'EARTH' THEN '땅' WHEN 'WATER' THEN '물' WHEN 'LIGHT' THEN '빛' WHEN 'WIND' THEN '바람' WHEN 'FIRE' THEN '불' END
      )
    ORDER BY CASE WHEN e.enumlabel=v_code THEN 0 ELSE 1 END
    LIMIT 1;
    IF v_candidate IS NULL THEN
      RAISE EXCEPTION '[G1] guild_members.element enum does not support %', v_code USING ERRCODE='PG102';
    END IF;
    RETURN v_candidate;
  END IF;

  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.guild1_normalize_element_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild1_storage_element(bigint,text) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- 7. 교사 길드 생성 / 프로필 수정
-- 길드 속성은 guilds.element_code를 source of truth로 두고, 초기 2.0 호환을 위해
-- 현재 guild_members.element에도 같은 의미의 값을 동기화한다.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_create_guild(
  p_name text,
  p_element_code text,
  p_slogan text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_code text;
  v_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '[G1] teacher classroom not found' USING ERRCODE='PG110'; END IF;
  IF btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION '[G1] guild name required' USING ERRCODE='PG111'; END IF;
  v_code := public.guild1_normalize_element_code(p_element_code);
  IF v_code IS NULL THEN RAISE EXCEPTION '[G1] guild element required' USING ERRCODE='PG112'; END IF;

  IF EXISTS (SELECT 1 FROM public.guilds WHERE classroom_id=v_class AND lower(name)=lower(btrim(p_name))) THEN
    RAISE EXCEPTION '[G1] duplicate guild name in classroom' USING ERRCODE='PG113';
  END IF;

  -- 기존 Stage 9 guilds에는 배포본에 따라 season_id / guild_uid가
  -- NOT NULL legacy 컬럼으로 남아 있다. 존재할 경우 동적으로 함께 채운다.
  -- season_id는 현재 활성 Guild 1 시즌을 사용하고, guild_uid는 기존 PK와 별개의
  -- 안정 식별자로 새 값을 생성한다.
  DECLARE
    v_cols text := 'classroom_id,name,slogan,logo_url,description,element_code,is_active,updated_at';
    v_vals text := format('%s,%L,%L,%L,%L,%L,%L,now()',
      v_class,btrim(p_name),nullif(btrim(coalesce(p_slogan,'')),''),
      nullif(btrim(coalesce(p_logo_url,'')),''),nullif(btrim(coalesce(p_description,'')),''),
      v_code,p_is_active);
    v_season_id bigint;
    v_uid text;
    v_uid_type text;
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='guilds' AND column_name='season_id'
    ) THEN
      SELECT gs.id INTO v_season_id
      FROM public.guild_seasons gs
      WHERE gs.classroom_id=v_class AND gs.lifecycle_status='ACTIVE'
      ORDER BY gs.starts_on DESC NULLS LAST, gs.id DESC
      LIMIT 1;

      -- 아주 오래된 배포본에서 lifecycle_status 역채움이 불완전한 경우에도
      -- legacy is_active=true 시즌을 한 번 더 찾는다.
      IF v_season_id IS NULL AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='is_active'
      ) THEN
        EXECUTE 'SELECT id FROM public.guild_seasons WHERE classroom_id=$1 AND is_active=true ORDER BY id DESC LIMIT 1'
          INTO v_season_id USING v_class;
      END IF;

      IF v_season_id IS NULL THEN
        RAISE EXCEPTION '[G1] active guild season required before creating a guild' USING ERRCODE='PG119';
      END IF;
      v_cols := v_cols || ',season_id';
      v_vals := v_vals || format(',%s',v_season_id);
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='guilds' AND column_name='guild_uid'
    ) THEN
      SELECT data_type INTO v_uid_type
      FROM information_schema.columns
      WHERE table_schema='public' AND table_name='guilds' AND column_name='guild_uid';

      IF v_uid_type='uuid' THEN
        v_uid := gen_random_uuid()::text;
      ELSE
        v_uid := 'GUILD_' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
      END IF;
      v_cols := v_cols || ',guild_uid';
      v_vals := v_vals || format(',%L',v_uid);
    END IF;

    EXECUTE 'INSERT INTO public.guilds('||v_cols||') VALUES ('||v_vals||') RETURNING id' INTO v_id;
  END;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_update_guild_profile(
  p_guild_id bigint,
  p_name text,
  p_element_code text,
  p_slogan text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_code text;
  v_storage text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '[G1] teacher classroom not found' USING ERRCODE='PG114'; END IF;
  IF btrim(coalesce(p_name,'')) = '' THEN RAISE EXCEPTION '[G1] guild name required' USING ERRCODE='PG115'; END IF;
  v_code := public.guild1_normalize_element_code(p_element_code);
  IF v_code IS NULL THEN RAISE EXCEPTION '[G1] guild element required' USING ERRCODE='PG116'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.guilds g
    WHERE g.id = p_guild_id
      AND (g.classroom_id = v_class OR g.classroom_id IS NULL)
  ) THEN
    RAISE EXCEPTION '[G1] guild not found in teacher classroom' USING ERRCODE='PG117';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.guilds g
    WHERE g.id<>p_guild_id AND g.classroom_id=v_class AND lower(g.name)=lower(btrim(p_name))
  ) THEN
    RAISE EXCEPTION '[G1] duplicate guild name in classroom' USING ERRCODE='PG118';
  END IF;

  IF NOT p_is_active AND EXISTS (
    SELECT 1 FROM public.guild_members gm
    WHERE gm.guild_id=p_guild_id AND gm.left_at IS NULL
  ) THEN
    RAISE EXCEPTION '[G1] active members remain in guild; move or remove them before deactivation' USING ERRCODE='PG119';
  END IF;

  v_storage := public.guild1_storage_element(p_guild_id,v_code);

  UPDATE public.guilds
  SET classroom_id = coalesce(classroom_id, v_class),
      name = btrim(p_name),
      slogan = nullif(btrim(coalesce(p_slogan,'')),''),
      description = nullif(btrim(coalesce(p_description,'')),''),
      logo_url = nullif(btrim(coalesce(p_logo_url,'')),''),
      element_code = v_code,
      is_active = p_is_active,
      updated_at = now()
  WHERE id = p_guild_id;

  -- 초기 2.0 화면과 호환되도록 '현재 활성 소속'의 중복 element 컬럼만 동기화한다.
  -- left_at이 있는 과거 membership은 절대로 덮어쓰지 않는다.
  EXECUTE format(
    'UPDATE public.guild_members SET element=%L, changed_by_user_id=auth.uid() WHERE guild_id=%s AND left_at IS NULL',
    v_storage,p_guild_id
  );

  RETURN p_guild_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 8. 길드 배정/이동 — 현재 row는 닫고 새 row를 INSERT한다.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_assign_guild_member(
  p_student_id integer,
  p_guild_id bigint,
  p_element text DEFAULT NULL,
  p_reason text DEFAULT '교사 배정',
  p_effective_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_old public.guild_members%ROWTYPE;
  v_new_id bigint;
  v_event text;
  v_element text;
  v_code text;
  v_requested_code text;
  v_old_guild_name text;
  v_new_guild_name text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '[G1] teacher classroom not found' USING ERRCODE='PG120'; END IF;
  IF btrim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION '[G1] membership change reason required' USING ERRCODE='PG121'; END IF;
  v_requested_code := public.guild1_normalize_element_code(p_element);

  IF NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = p_student_id
      AND s.classroom_id = v_class
      AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
  ) THEN
    RAISE EXCEPTION '[G1] active student not found in teacher classroom' USING ERRCODE='PG122';
  END IF;

  SELECT g.name, g.element_code INTO v_new_guild_name, v_code
  FROM public.guilds g
  WHERE g.id = p_guild_id
    AND coalesce(g.is_active,true)
    AND (g.classroom_id = v_class OR g.classroom_id IS NULL);
  IF v_new_guild_name IS NULL THEN
    RAISE EXCEPTION '[G1] active guild not found in teacher classroom' USING ERRCODE='PG123';
  END IF;
  v_code := public.guild1_normalize_element_code(v_code);
  IF v_code IS NULL THEN
    IF v_requested_code IS NULL THEN
      RAISE EXCEPTION '[G1] target guild element is not configured' USING ERRCODE='PG124';
    END IF;
    v_code := v_requested_code;
    UPDATE public.guilds SET element_code=v_code,classroom_id=coalesce(classroom_id,v_class),updated_at=now() WHERE id=p_guild_id;
  ELSIF v_requested_code IS NOT NULL AND v_requested_code<>v_code THEN
    RAISE EXCEPTION '[G1] requested element does not match target guild element' USING ERRCODE='PG125';
  END IF;
  v_element := public.guild1_storage_element(p_guild_id,v_code);

  SELECT * INTO v_old
  FROM public.guild_members
  WHERE student_id = p_student_id AND left_at IS NULL
  FOR UPDATE;

  IF FOUND AND v_old.guild_id = p_guild_id THEN
    -- 같은 길드 재적용도 guild master의 현재 속성으로 동기화한다.
    -- element 컬럼이 text/varchar/enum 어느 타입이어도 target column이 literal을 안전하게 캐스팅하도록 한다.
    EXECUTE format('UPDATE public.guild_members SET element=%L, changed_by_user_id=auth.uid() WHERE id=%s', v_element, v_old.id);
    RETURN jsonb_build_object('status','UNCHANGED','membership_id',v_old.id,'guild_id',p_guild_id,'element',v_element);
  END IF;

  v_event := CASE WHEN FOUND THEN 'MOVE' ELSE 'ASSIGN' END;
  IF FOUND THEN SELECT name INTO v_old_guild_name FROM public.guilds WHERE id=v_old.guild_id; END IF;

  IF FOUND THEN
    UPDATE public.guild_members
    SET left_at = p_effective_at,
        leave_reason = btrim(p_reason),
        changed_by_user_id = auth.uid()
    WHERE id = v_old.id;
  END IF;

  UPDATE public.guilds
  SET classroom_id = coalesce(classroom_id, v_class), updated_at = now()
  WHERE id = p_guild_id;

  -- 초기 Stage 9 guild_members에는 season_id NOT NULL이 존재한다.
  -- 대상 길드가 가진 season_id를 그대로 상속하여, 현재 소속과 시즌 이력이
  -- 분리되지 않도록 한다. 배포본에 season_id가 없으면 기존 INSERT 형식을 사용한다.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guild_members' AND column_name='season_id'
  ) THEN
    DECLARE
      v_member_season_id bigint;
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='guilds' AND column_name='season_id'
      ) THEN
        EXECUTE 'SELECT season_id FROM public.guilds WHERE id=$1'
          INTO v_member_season_id USING p_guild_id;
      END IF;

      IF v_member_season_id IS NULL THEN
        SELECT gs.id INTO v_member_season_id
        FROM public.guild_seasons gs
        WHERE gs.classroom_id=v_class AND gs.lifecycle_status='ACTIVE'
        ORDER BY gs.starts_on DESC NULLS LAST, gs.id DESC
        LIMIT 1;
      END IF;

      IF v_member_season_id IS NULL THEN
        RAISE EXCEPTION '[G1] active guild season required before assigning a guild member' USING ERRCODE='PG126';
      END IF;

      EXECUTE format(
        'INSERT INTO public.guild_members(guild_id,student_id,season_id,element,joined_at,left_at,changed_by_user_id) VALUES (%s,%s,%s,%L,%L,NULL,%L) RETURNING id',
        p_guild_id,p_student_id,v_member_season_id,v_element,p_effective_at,auth.uid()
      ) INTO v_new_id;
    END;
  ELSE
    EXECUTE format(
      'INSERT INTO public.guild_members(guild_id,student_id,element,joined_at,left_at,changed_by_user_id) VALUES (%s,%s,%L,%L,NULL,%L) RETURNING id',
      p_guild_id,p_student_id,v_element,p_effective_at,auth.uid()
    ) INTO v_new_id;
  END IF;

  INSERT INTO public.guild_membership_events(
    classroom_id, student_id, from_guild_id, to_guild_id,
    from_membership_id, to_membership_id, from_guild_name, to_guild_name, event_type,
    element_before, element_after, reason, effective_at, actor_user_id
  ) VALUES (
    v_class, p_student_id,
    CASE WHEN v_event='MOVE' THEN v_old.guild_id ELSE NULL END,
    p_guild_id,
    CASE WHEN v_event='MOVE' THEN v_old.id ELSE NULL END,
    v_new_id,
    CASE WHEN v_event='MOVE' THEN v_old_guild_name ELSE NULL END,
    v_new_guild_name,
    v_event,
    CASE WHEN v_event='MOVE' THEN v_old.element::text ELSE NULL END,
    v_code, btrim(p_reason), p_effective_at, auth.uid()
  );

  RETURN jsonb_build_object('status',v_event,'membership_id',v_new_id,'guild_id',p_guild_id,'element',v_element);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_remove_guild_member(
  p_student_id integer,
  p_reason text,
  p_effective_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_old public.guild_members%ROWTYPE;
  v_old_guild_name text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF btrim(coalesce(p_reason,'')) = '' THEN RAISE EXCEPTION '[G1] membership removal reason required' USING ERRCODE='PG130'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.students WHERE id=p_student_id AND classroom_id=v_class) THEN
    RAISE EXCEPTION '[G1] student not found in teacher classroom' USING ERRCODE='PG131';
  END IF;

  SELECT * INTO v_old FROM public.guild_members
  WHERE student_id=p_student_id AND left_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[G1] student has no active guild membership' USING ERRCODE='PG132'; END IF;
  SELECT name INTO v_old_guild_name FROM public.guilds WHERE id=v_old.guild_id;

  UPDATE public.guild_members
  SET left_at=p_effective_at, leave_reason=btrim(p_reason), changed_by_user_id=auth.uid()
  WHERE id=v_old.id;

  INSERT INTO public.guild_membership_events(
    classroom_id,student_id,from_guild_id,to_guild_id,
    from_membership_id,to_membership_id,from_guild_name,to_guild_name,event_type,
    element_before,element_after,reason,effective_at,actor_user_id
  ) VALUES (
    v_class,p_student_id,v_old.guild_id,NULL,
    v_old.id,NULL,v_old_guild_name,NULL,'REMOVE',v_old.element::text,NULL,
    btrim(p_reason),p_effective_at,auth.uid()
  );

  RETURN jsonb_build_object('status','REMOVE','membership_id',v_old.id,'from_guild_id',v_old.guild_id);
END;
$$;

-- --------------------------------------------------------------------------
-- 9. 시즌 RPC
-- 기존 guild_seasons의 초기 설계 컬럼은 그대로 두고 Guild1 추가 컬럼을 사용한다.
-- 알려진 legacy alias 컬럼(season_name/start_date/end_date/is_active/season_number)이 있으면 함께 동기화한다.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_create_guild_season(
  p_classroom_id integer,
  p_display_name text,
  p_school_year integer,
  p_starts_on date,
  p_ends_on date,
  p_activate_now boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[G1] teacher classroom denied' USING ERRCODE='PG140';
  END IF;
  IF btrim(coalesce(p_display_name,''))='' THEN RAISE EXCEPTION '[G1] season name required' USING ERRCODE='PG141'; END IF;
  IF p_school_year < 2020 OR p_school_year > 2100 THEN RAISE EXCEPTION '[G1] invalid school year' USING ERRCODE='PG142'; END IF;
  IF p_ends_on < p_starts_on THEN RAISE EXCEPTION '[G1] season end must be after start' USING ERRCODE='PG143'; END IF;

  IF p_activate_now THEN
    UPDATE public.guild_seasons
    SET lifecycle_status='CLOSED', updated_at=now()
    WHERE classroom_id=p_classroom_id AND lifecycle_status='ACTIVE';
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='is_active') THEN
      EXECUTE format('UPDATE public.guild_seasons SET is_active=false WHERE classroom_id=%s AND lifecycle_status=''CLOSED''',p_classroom_id);
    END IF;
  END IF;

  -- guild_seasons는 초기 2.0 스키마에 이미 존재한다. 배포본마다 초기 컬럼명이
  -- 다를 가능성에 대비해, Guild1 공통 컬럼 + 알려진 legacy alias를 동적으로 함께 채운다.
  DECLARE
    v_cols text := 'classroom_id,display_name,school_year,starts_on,ends_on,lifecycle_status,created_by_user_id,updated_at';
    v_vals text := format('%s,%L,%s,%L,%L,%L,%L,now()',
      p_classroom_id,btrim(p_display_name),p_school_year,p_starts_on,p_ends_on,
      CASE WHEN p_activate_now THEN 'ACTIVE' ELSE 'PLANNED' END,auth.uid());
    v_next_no integer;
  BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='season_name') THEN
      v_cols := v_cols || ',season_name'; v_vals := v_vals || format(',%L',btrim(p_display_name));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='name') THEN
      v_cols := v_cols || ',name'; v_vals := v_vals || format(',%L',btrim(p_display_name));
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='start_date') THEN
      v_cols := v_cols || ',start_date'; v_vals := v_vals || format(',%L',p_starts_on);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='end_date') THEN
      v_cols := v_cols || ',end_date'; v_vals := v_vals || format(',%L',p_ends_on);
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='is_active') THEN
      v_cols := v_cols || ',is_active'; v_vals := v_vals || CASE WHEN p_activate_now THEN ',true' ELSE ',false' END;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='season_number') THEN
      EXECUTE format('SELECT coalesce(max(season_number),0)+1 FROM public.guild_seasons WHERE classroom_id=%s',p_classroom_id) INTO v_next_no;
      v_cols := v_cols || ',season_number'; v_vals := v_vals || format(',%s',v_next_no);
    END IF;
    EXECUTE 'INSERT INTO public.guild_seasons('||v_cols||') VALUES ('||v_vals||') RETURNING id' INTO v_id;
  END;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild_season_status(
  p_season_id bigint,
  p_status text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_status text := upper(btrim(coalesce(p_status,'')));
BEGIN
  PERFORM public.ensure_teacher_role();
  IF v_status NOT IN ('PLANNED','ACTIVE','CLOSED') THEN RAISE EXCEPTION '[G1] invalid season status' USING ERRCODE='PG150'; END IF;

  SELECT classroom_id INTO v_class FROM public.guild_seasons WHERE id=p_season_id FOR UPDATE;
  IF v_class IS NULL OR v_class IS DISTINCT FROM public.current_classroom_id() THEN
    RAISE EXCEPTION '[G1] season not found in teacher classroom' USING ERRCODE='PG151';
  END IF;

  IF v_status='ACTIVE' THEN
    UPDATE public.guild_seasons
    SET lifecycle_status='CLOSED',updated_at=now()
    WHERE classroom_id=v_class AND lifecycle_status='ACTIVE' AND id<>p_season_id;
  END IF;

  UPDATE public.guild_seasons SET lifecycle_status=v_status,updated_at=now() WHERE id=p_season_id;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='is_active') THEN
    EXECUTE format('UPDATE public.guild_seasons SET is_active=%L WHERE id=%s',v_status='ACTIVE',p_season_id);
  END IF;
  RETURN p_season_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 10. 길드 세션 생성 / 출석 저장 / 종료
-- 세션 생성 즉시 당시 활성 길드원을 participants에 snapshot한다.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_create_guild_session(
  p_classroom_id integer,
  p_title text,
  p_session_date date,
  p_note text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id bigint;
  v_season_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[G1] teacher classroom denied' USING ERRCODE='PG160'; END IF;
  IF btrim(coalesce(p_title,''))='' THEN RAISE EXCEPTION '[G1] guild session title required' USING ERRCODE='PG161'; END IF;

  SELECT id INTO v_season_id
  FROM public.guild_seasons
  WHERE classroom_id=p_classroom_id
    AND lifecycle_status='ACTIVE'
    AND (starts_on IS NULL OR starts_on <= p_session_date)
    AND (ends_on IS NULL OR ends_on >= p_session_date)
  ORDER BY starts_on DESC NULLS LAST, id DESC
  LIMIT 1;

  INSERT INTO public.guild_sessions(classroom_id,season_id,title,session_date,note,created_by_user_id)
  VALUES(p_classroom_id,v_season_id,btrim(p_title),p_session_date,nullif(btrim(coalesce(p_note,'')),''),auth.uid())
  RETURNING id INTO v_session_id;

  INSERT INTO public.guild_session_participants(
    session_id,student_id,guild_id_at_session,
    student_name_at_session,brand_name_at_session,guild_name_at_session,element_at_session
  )
  SELECT v_session_id, s.id, gm.guild_id, s.name, s.brand_name, g.name,
         coalesce(g.element_code,gm.element::text)
  FROM public.students s
  JOIN public.guild_members gm ON gm.student_id=s.id AND gm.left_at IS NULL
  JOIN public.guilds g ON g.id=gm.guild_id
  WHERE s.classroom_id=p_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND coalesce(g.is_active,true)
  ON CONFLICT(session_id,student_id) DO NOTHING;

  RETURN v_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_record_guild_session_attendance(
  p_session_id bigint,
  p_records jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_row jsonb;
  v_student integer;
  v_status text;
  v_note text;
  v_count integer := 0;
BEGIN
  PERFORM public.ensure_teacher_role();
  SELECT classroom_id INTO v_class FROM public.guild_sessions WHERE id=p_session_id FOR UPDATE;
  IF v_class IS NULL OR v_class IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[G1] guild session not found in teacher classroom' USING ERRCODE='PG170'; END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN RAISE EXCEPTION '[G1] attendance records must be an array' USING ERRCODE='PG171'; END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_records)
  LOOP
    v_student := NULLIF(v_row->>'student_id','')::integer;
    v_status := upper(btrim(coalesce(v_row->>'status','')));
    v_note := nullif(btrim(coalesce(v_row->>'note','')),'');
    IF v_status NOT IN ('UNMARKED','PRESENT','ABSENT','EXCUSED') THEN RAISE EXCEPTION '[G1] invalid guild session status: %',v_status USING ERRCODE='PG172'; END IF;

    UPDATE public.guild_session_participants
    SET attendance_status=v_status,
        note=v_note,
        recorded_by_user_id=auth.uid(),
        recorded_at=now(),
        updated_at=now()
    WHERE session_id=p_session_id AND student_id=v_student;
    IF NOT FOUND THEN RAISE EXCEPTION '[G1] student % is not in this session snapshot',v_student USING ERRCODE='PG173'; END IF;
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.guild_sessions SET updated_at=now() WHERE id=p_session_id;
  RETURN jsonb_build_object('session_id',p_session_id,'updated',v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild_session_status(
  p_session_id bigint,
  p_status text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_status text:=upper(btrim(coalesce(p_status,'')));
BEGIN
  PERFORM public.ensure_teacher_role();
  IF v_status NOT IN ('OPEN','CLOSED') THEN RAISE EXCEPTION '[G1] invalid guild session status' USING ERRCODE='PG180'; END IF;
  SELECT classroom_id INTO v_class FROM public.guild_sessions WHERE id=p_session_id FOR UPDATE;
  IF v_class IS NULL OR v_class IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[G1] guild session not found in teacher classroom' USING ERRCODE='PG181'; END IF;
  UPDATE public.guild_sessions SET status=v_status,updated_at=now() WHERE id=p_session_id;
  RETURN p_session_id;
END;
$$;

-- --------------------------------------------------------------------------
-- 11. Guild 1 health check
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_guild1_health_check(p_classroom_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duplicate integer;
  v_unassigned integer;
  v_guilds_without_element integer;
  v_transferred_active_memberships integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[G1] teacher classroom denied' USING ERRCODE='PG190'; END IF;

  SELECT count(*) INTO v_duplicate FROM (
    SELECT gm.student_id FROM public.guild_members gm
    JOIN public.students s ON s.id=gm.student_id
    WHERE s.classroom_id=p_classroom_id AND gm.left_at IS NULL
    GROUP BY gm.student_id HAVING count(*)>1
  ) q;

  SELECT count(*) INTO v_guilds_without_element
  FROM public.guilds g
  WHERE coalesce(g.is_active,true)
    AND (g.classroom_id=p_classroom_id OR g.classroom_id IS NULL)
    AND g.element_code IS NULL;

  SELECT count(*) INTO v_unassigned
  FROM public.students s
  WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND NOT EXISTS (SELECT 1 FROM public.guild_members gm WHERE gm.student_id=s.id AND gm.left_at IS NULL);

  SELECT count(*) INTO v_transferred_active_memberships
  FROM public.students s
  JOIN public.guild_members gm ON gm.student_id=s.id AND gm.left_at IS NULL
  WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NOT NULL;

  RETURN jsonb_build_object(
    'version','GUILD1',
    'tables',jsonb_build_object(
      'guild_membership_events',to_regclass('public.guild_membership_events') IS NOT NULL,
      'guild_sessions',to_regclass('public.guild_sessions') IS NOT NULL,
      'guild_session_participants',to_regclass('public.guild_session_participants') IS NOT NULL
    ),
    'functions',jsonb_build_object(
      'create_guild',to_regprocedure('public.teacher_create_guild(text,text,text,text,text,boolean)') IS NOT NULL,
      'update_guild',to_regprocedure('public.teacher_update_guild_profile(bigint,text,text,text,text,text,boolean)') IS NOT NULL,
      'assign_member',to_regprocedure('public.teacher_assign_guild_member(integer,bigint,text,text,timestamp with time zone)') IS NOT NULL,
      'remove_member',to_regprocedure('public.teacher_remove_guild_member(integer,text,timestamp with time zone)') IS NOT NULL,
      'create_session',to_regprocedure('public.teacher_create_guild_session(integer,text,date,text)') IS NOT NULL
    ),
    'duplicate_active_memberships',v_duplicate,
    'active_guilds_without_element',v_guilds_without_element,
    'unassigned_active_students',v_unassigned,
    'transferred_students_with_active_membership',v_transferred_active_memberships,
    'checked_at',now()
  );
END;
$$;

-- --------------------------------------------------------------------------
-- 12. 함수 ACL — PUBLIC 기본 EXECUTE를 반드시 제거
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.teacher_create_guild(text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_update_guild_profile(bigint,text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_assign_guild_member(integer,bigint,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_remove_guild_member(integer,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_create_guild_season(integer,text,integer,date,date,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_guild_season_status(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_create_guild_session(integer,text,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_record_guild_session_attendance(bigint,jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_set_guild_session_status(bigint,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_guild1_health_check(integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.teacher_create_guild(text,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_update_guild_profile(bigint,text,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_assign_guild_member(integer,bigint,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_remove_guild_member(integer,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_create_guild_season(integer,text,integer,date,date,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild_season_status(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_create_guild_session(integer,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_record_guild_session_attendance(bigint,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_set_guild_session_status(bigint,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_guild1_health_check(integer) TO authenticated;

-- --------------------------------------------------------------------------
-- 13. Realtime — fault isolation을 위해 프론트에서는 테이블별 별도 channel 사용
-- --------------------------------------------------------------------------
DO $$
DECLARE v_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['guilds','guild_members','guild_seasons','guild_membership_events','guild_sessions','guild_session_participants']
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=v_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',v_table);
      END IF;
    END LOOP;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
