-- =====================================================================
-- B.R.A.N.D 2.0 — Raid CLASH (격돌) V3: 레이드마다 대표 인원 1~12명
-- 2026-11-04
--
-- Requires CLASH V1 + V2 (applied 2026-10-29).
--
-- What changes
-- * raid_clash_configs.player_count (1~12, default 3): the teacher picks the
--   number of representatives per raid, once, before the battle starts
--   (same rule as difficulty: DRAFT / LOBBY_OPEN only).
-- * raid_clash_begin copies that number into the session config, so the
--   draw, ready check, NOT_READY MISS, team thresholds (per-player x drawn)
--   and the end-of-play count all follow it through the V2 code unchanged.
-- * Slot range widened from 0~2 to 0~11.
-- * teacher_get_raid_clash_config returns player_count / max_player_count.
-- * teacher_save_raid_clash_config accepts player_count (1~12). A payload
--   without player_count keeps the saved value (old screens keep working).
--
-- What does not change
-- * Existing configs keep 3 players. Finished sessions keep their results.
-- * The profile (timings, judgment windows, per-player thresholds 8/13/16),
--   effects, penalty, 50% trigger, freeze and pause guard are unchanged.
-- =====================================================================

-- Safety: never change the rules in the middle of a running CLASH.
DO $guard$
BEGIN
  IF to_regclass('public.raid_clash_players') IS NULL THEN
    RAISE EXCEPTION 'CLASH V2 must be applied before V3';
  END IF;
  IF EXISTS (SELECT 1 FROM public.raid_clash_sessions WHERE phase IN ('VOLUNTEERING','SELECTED','PLAYING')) THEN
    RAISE EXCEPTION '격돌이 진행 중인 레이드가 있습니다. 격돌이 끝난 뒤 다시 적용해 주세요.';
  END IF;
END;
$guard$;

-- ---------------------------------------------------------------------
-- 0. Backup of the current CLASH functions
-- ---------------------------------------------------------------------
INSERT INTO brand_backup.function_snapshots(snapshot_label, signature, definition, definition_md5)
SELECT 'PRE_CLASH_V3_20261104', p.oid::regprocedure::text, pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.prokind IN ('f','p') AND p.proname ILIKE '%raid_clash%'
ON CONFLICT (snapshot_label, signature) DO NOTHING;

-- ---------------------------------------------------------------------
-- 1. Schema
-- ---------------------------------------------------------------------
ALTER TABLE public.raid_clash_configs ADD COLUMN IF NOT EXISTS player_count smallint NOT NULL DEFAULT 3;
DO $schema$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.raid_clash_configs'::regclass AND conname = 'raid_clash_configs_player_count_check') THEN
    ALTER TABLE public.raid_clash_configs ADD CONSTRAINT raid_clash_configs_player_count_check CHECK (player_count BETWEEN 1 AND 12);
  END IF;
END;
$schema$;

ALTER TABLE public.raid_clash_players DROP CONSTRAINT IF EXISTS raid_clash_players_slot_check;
ALTER TABLE public.raid_clash_players ADD CONSTRAINT raid_clash_players_slot_check CHECK (slot BETWEEN 0 AND 11);
ALTER TABLE public.raid_clash_inputs DROP CONSTRAINT IF EXISTS raid_clash_inputs_slot_check;
ALTER TABLE public.raid_clash_inputs ADD CONSTRAINT raid_clash_inputs_slot_check CHECK (slot BETWEEN 0 AND 11);

-- ---------------------------------------------------------------------
-- 2. Planned players: cap 3 → 12 (V1 configs without player_count are still 1)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.raid_clash_planned_players(p_cfg jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $clash$
  SELECT /*CLASH_V3*/ GREATEST(1, LEAST(12, COALESCE(NULLIF(p_cfg->>'player_count','')::integer, 1)));
$clash$;
REVOKE ALL ON FUNCTION public.raid_clash_planned_players(jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Session start: copy the raid's player_count into the session config
-- ---------------------------------------------------------------------
SELECT brand_backup.replace_once('public.raid_clash_begin(bigint)'::regprocedure, '/*CLASH_V3:players*/',
$n$  v_profile := public.raid_clash_profile(v_cfg.difficulty);$n$,
$r$  v_profile := public.raid_clash_profile(v_cfg.difficulty) /*CLASH_V3:players*/
                || jsonb_build_object('player_count', GREATEST(1, LEAST(12, COALESCE(v_cfg.player_count, 3)::integer)));$r$);

-- ---------------------------------------------------------------------
-- 4. Teacher config: read / save player_count
-- ---------------------------------------------------------------------
SELECT brand_backup.replace_once('public.teacher_get_raid_clash_config(bigint)'::regprocedure, '/*CLASH_V3:get*/',
$n$    'enabled', COALESCE(v_cfg.enabled,false), 'difficulty', COALESCE(v_cfg.difficulty,'EASY'),$n$,
$r$    'enabled', COALESCE(v_cfg.enabled,false), 'difficulty', COALESCE(v_cfg.difficulty,'EASY'),
    /*CLASH_V3:get*/ 'player_count', COALESCE(v_cfg.player_count, 3), 'max_player_count', 12,$r$);

SELECT brand_backup.replace_once('public.teacher_save_raid_clash_config(bigint,jsonb)'::regprocedure, '/*CLASH_V3:save_vars*/',
$n$DECLARE v_raid public.raids%ROWTYPE; v_enabled boolean; v_difficulty text; v_barrier boolean;$n$,
$r$DECLARE v_raid public.raids%ROWTYPE; v_enabled boolean; v_difficulty text; v_barrier boolean;
  v_players integer; v_players_text text; /*CLASH_V3:save_vars*/$r$);

SELECT brand_backup.replace_once('public.teacher_save_raid_clash_config(bigint,jsonb)'::regprocedure, '/*CLASH_V3:save_players*/',
$n$  IF v_difficulty NOT IN ('EASY','NORMAL','HARD') THEN RAISE EXCEPTION 'CLASH difficulty must be EASY, NORMAL or HARD' USING ERRCODE = 'P0213'; END IF;$n$,
$r$  IF v_difficulty NOT IN ('EASY','NORMAL','HARD') THEN RAISE EXCEPTION 'CLASH difficulty must be EASY, NORMAL or HARD' USING ERRCODE = 'P0213'; END IF;
  /*CLASH_V3:save_players*/
  v_players_text := NULLIF(btrim(COALESCE(p_payload->>'player_count','')),'');
  IF v_players_text IS NULL THEN
    -- old screens do not send player_count: keep what is saved (3 for a new config)
    SELECT player_count INTO v_players FROM public.raid_clash_configs WHERE raid_id = p_raid_id;
    v_players := COALESCE(v_players, 3);
  ELSIF v_players_text !~ '^[0-9]{1,3}$' THEN
    RAISE EXCEPTION '격돌 인원은 1명부터 12명까지 정할 수 있습니다' USING ERRCODE = 'P0213';
  ELSE
    v_players := v_players_text::integer;
  END IF;
  IF v_players NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION '격돌 인원은 1명부터 12명까지 정할 수 있습니다' USING ERRCODE = 'P0213';
  END IF;$r$);

SELECT brand_backup.replace_once('public.teacher_save_raid_clash_config(bigint,jsonb)'::regprocedure, '/*CLASH_V3:save_upsert*/',
$n$  INSERT INTO public.raid_clash_configs(raid_id, enabled, difficulty, updated_by, updated_at)
  VALUES (p_raid_id, v_enabled, v_difficulty, auth.uid(), now())
  ON CONFLICT (raid_id) DO UPDATE SET enabled = excluded.enabled, difficulty = excluded.difficulty,
                                      updated_by = excluded.updated_by, updated_at = now();$n$,
$r$  INSERT INTO public.raid_clash_configs(raid_id, enabled, difficulty, player_count, updated_by, updated_at) /*CLASH_V3:save_upsert*/
  VALUES (p_raid_id, v_enabled, v_difficulty, v_players, auth.uid(), now())
  ON CONFLICT (raid_id) DO UPDATE SET enabled = excluded.enabled, difficulty = excluded.difficulty,
                                      player_count = excluded.player_count,
                                      updated_by = excluded.updated_by, updated_at = now();$r$);

-- ---------------------------------------------------------------------
-- 5. Sanity
-- ---------------------------------------------------------------------
DO $sanity$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(t.fn || ' ' || t.marker, ', ') INTO v_missing FROM (VALUES
    ('raid_clash_planned_players(jsonb)', '/*CLASH_V3*/'),
    ('raid_clash_begin(bigint)', '/*CLASH_V3:players*/'),
    ('teacher_get_raid_clash_config(bigint)', '/*CLASH_V3:get*/'),
    ('teacher_save_raid_clash_config(bigint,jsonb)', '/*CLASH_V3:save_vars*/'),
    ('teacher_save_raid_clash_config(bigint,jsonb)', '/*CLASH_V3:save_players*/'),
    ('teacher_save_raid_clash_config(bigint,jsonb)', '/*CLASH_V3:save_upsert*/')
  ) AS t(fn, marker)
  WHERE strpos(pg_get_functiondef(('public.' || fn)::regprocedure), marker) = 0;
  IF v_missing IS NOT NULL THEN RAISE EXCEPTION 'CLASH V3 incomplete: %', v_missing; END IF;
  IF public.raid_clash_planned_players('{"player_count":12}'::jsonb) <> 12
     OR public.raid_clash_planned_players('{"player_count":40}'::jsonb) <> 12
     OR public.raid_clash_planned_players('{}'::jsonb) <> 1 THEN
    RAISE EXCEPTION 'CLASH V3 planned players not as expected';
  END IF;
  IF has_table_privilege('authenticated','public.raid_clash_configs','SELECT')
     OR has_function_privilege('authenticated','public.raid_clash_planned_players(jsonb)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.teacher_save_raid_clash_config(bigint,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.teacher_save_raid_clash_config(bigint,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'CLASH V3 privileges are not as expected';
  END IF;
END;
$sanity$;

SELECT 'CLASH V3 applied' AS result;
