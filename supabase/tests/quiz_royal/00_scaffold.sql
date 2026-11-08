-- =====================================================================
-- 퀴즈 로얄 로컬 시험용 뼈대 (운영 DB 아님)
-- Supabase 비슷한 역할·auth.uid()·storage·publication 과,
-- 운영 DB에서 읽어 온 기존 표/함수(2026-11-07 introspection)의 필요한 부분만 만든다.
-- =====================================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
END $$;
GRANT anon, authenticated TO postgres;
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;

CREATE PUBLICATION supabase_realtime;

-- storage (Supabase storage 스키마의 최소 형태)
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon, authenticated;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid DEFAULT gen_random_uuid() PRIMARY KEY, bucket_id text, name text, owner uuid);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;

-- 기존 표 (운영 열 이름 그대로, 필요한 열만)
CREATE TYPE public.user_role AS ENUM ('STUDENT','STUDENT_LEADER','GUARD','TEACHER','ADMIN','TEST');
CREATE TABLE public.classrooms (
  id serial PRIMARY KEY, name varchar NOT NULL, teacher_user_id uuid, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.students (
  id serial PRIMARY KEY, user_id uuid, classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  name varchar NOT NULL, brand_name varchar, role public.user_role NOT NULL DEFAULT 'STUDENT',
  transferred_at date, is_test_account boolean NOT NULL DEFAULT false);
CREATE TABLE public.guilds (
  id serial PRIMARY KEY, classroom_id integer NOT NULL, name varchar NOT NULL, logo_url text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE public.guild_members (
  id serial PRIMARY KEY, guild_id integer NOT NULL, student_id integer NOT NULL, left_at timestamptz);

-- 운영 DB의 기존 함수 정의(동일 내용)
CREATE OR REPLACE FUNCTION public.current_classroom_id() RETURNS integer LANGUAGE plpgsql STABLE SET search_path TO 'public','pg_temp' AS $function$
DECLARE v_classroom_id INTEGER;
BEGIN
  SELECT classroom_id INTO v_classroom_id FROM students WHERE user_id = auth.uid() AND transferred_at IS NULL;
  IF v_classroom_id IS NULL THEN
    SELECT id INTO v_classroom_id FROM classrooms WHERE teacher_user_id = auth.uid() AND is_active = TRUE LIMIT 1;
  END IF;
  RETURN v_classroom_id;
END; $function$;
CREATE OR REPLACE FUNCTION public.is_classroom_member(p_classroom_id integer) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM students WHERE user_id = auth.uid() AND classroom_id = p_classroom_id AND transferred_at IS NULL) THEN RETURN TRUE; END IF;
  IF EXISTS (SELECT 1 FROM classrooms WHERE teacher_user_id = auth.uid() AND id = p_classroom_id AND is_active = TRUE) THEN RETURN TRUE; END IF;
  RETURN FALSE;
END; $function$;
CREATE OR REPLACE FUNCTION public.is_teacher_or_admin() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $function$
BEGIN
  RETURN EXISTS (SELECT 1 FROM students WHERE user_id = auth.uid() AND role IN ('TEACHER','ADMIN') AND transferred_at IS NULL)
      OR EXISTS (SELECT 1 FROM classrooms WHERE teacher_user_id = auth.uid() AND is_active = TRUE);
END; $function$;
GRANT EXECUTE ON FUNCTION public.current_classroom_id(), public.is_classroom_member(integer), public.is_teacher_or_admin() TO authenticated;

-- 도구함 신호 함수 자리(호출 기록만 남김)
CREATE SCHEMA brand_toolbox;
CREATE TABLE public._toolbox_bumps (at timestamptz DEFAULT clock_timestamp(), classroom integer, payload jsonb);
CREATE OR REPLACE FUNCTION brand_toolbox.bump(p_classroom integer, p_student_visible boolean, p_payload jsonb default '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$ insert into public._toolbox_bumps (classroom, payload) values (p_classroom, p_payload) $$;

-- 시험 데이터: 학급 1(실제 반 모양), 학급 2(다른 반)
INSERT INTO public.classrooms (id, name, teacher_user_id) VALUES
  (1, '5학년 4반', '00000000-0000-0000-0000-0000000000a1'),
  (2, '다른 반', '00000000-0000-0000-0000-0000000000a2');
-- 길드: 5인 3개, 4인 2개, 테스트요원 1인 길드
INSERT INTO public.guilds (id, classroom_id, name) VALUES
  (12, 1, '슈퍼노바'), (13, 1, '루나 네이비'), (14, 1, '와사비'), (15, 1, 'Phoenix'), (16, 1, '아블루션'), (17, 1, '테스트요원'),
  (20, 2, '다른반 길드');
DO $$
DECLARE gid int; n int; i int; sid int; k int := 0;
BEGIN
  FOR gid, n IN SELECT * FROM (VALUES (12,4),(13,4),(14,5),(15,5),(16,5)) t(g, n) LOOP
    FOR i IN 1..n LOOP
      k := k + 1;
      INSERT INTO public.students (user_id, classroom_id, name, role)
      VALUES (('00000000-0000-0000-0000-' || lpad(k::text, 12, '0'))::uuid, 1, '학생' || k, 'STUDENT') RETURNING id INTO sid;
      INSERT INTO public.guild_members (guild_id, student_id) VALUES (gid, sid);
    END LOOP;
  END LOOP;
  INSERT INTO public.students (user_id, classroom_id, name, role, is_test_account)
  VALUES ('00000000-0000-0000-0000-0000000000f1', 1, '테스트요원', 'TEST', true) RETURNING id INTO sid;
  INSERT INTO public.guild_members (guild_id, student_id) VALUES (17, sid);
  INSERT INTO public.students (user_id, classroom_id, name, role)
  VALUES ('00000000-0000-0000-0000-0000000000b9', 2, '다른반학생', 'STUDENT') RETURNING id INTO sid;
  INSERT INTO public.guild_members (guild_id, student_id) VALUES (20, sid);
END $$;
