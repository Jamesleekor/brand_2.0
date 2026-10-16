-- B.R.A.N.D 2.0 Raid Element Damage V1
-- IMPORTANT: review and deploy using Supabase SQL Editor ONLY AFTER source patch prepared.
-- Existing raids remain OFF; no student data, results, reward data are rewritten.
-- Migration designed for inspected production definitions (2026-10-17).
BEGIN;

ALTER TABLE public.raids
  ADD COLUMN IF NOT EXISTS element_damage_rules_version text NOT NULL DEFAULT 'OFF';
ALTER TABLE public.raid_participants
  ADD COLUMN IF NOT EXISTS snapshot_element_rules_version text NOT NULL DEFAULT 'OFF',
  ADD COLUMN IF NOT EXISTS snapshot_element_multiplier_bp integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS snapshot_element_effect jsonb;

DO $checks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raids'::regclass AND conname='raid_element_v1_version_chk') THEN
    ALTER TABLE public.raids ADD CONSTRAINT raid_element_v1_version_chk
      CHECK (element_damage_rules_version IN ('OFF','V1'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raid_participants'::regclass AND conname='raid_element_v1_snapshot_version_chk') THEN
    ALTER TABLE public.raid_participants ADD CONSTRAINT raid_element_v1_snapshot_version_chk
      CHECK (snapshot_element_rules_version IN ('OFF','V1'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.raid_participants'::regclass AND conname='raid_element_v1_multiplier_chk') THEN
    ALTER TABLE public.raid_participants ADD CONSTRAINT raid_element_v1_multiplier_chk
      CHECK (snapshot_element_multiplier_bp BETWEEN 8000 AND 13000);
  END IF;
END;
$checks$;

-- Deterministic, table-independent arithmetic; explicitly accepts both element points.
CREATE OR REPLACE FUNCTION public.raid_element_v1_math(
  p_budget integer,
  p_primary text,
  p_primary_points integer,
  p_secondary text,
  p_secondary_points integer,
  p_boss text
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_core text[] := ARRAY['EARTH','WATER','FIRE','WIND'];
  v_elements text[] := ARRAY['EARTH','WATER','FIRE','WIND','LIGHT','DARK'];
  v_i integer;
  v_b integer;
  v_rel_p integer := 0;
  v_rel_s integer := 0;
  v_grade integer;
  v_focus integer := 0;
  v_match integer := 0;
  v_base integer := 0;
  v_type text;
  v_pcore boolean;
  v_score boolean;
BEGIN
  IF p_budget NOT IN (8,9,10)
    OR NOT (p_primary = ANY(v_elements)) OR NOT (p_boss = ANY(v_elements))
    OR p_primary_points IS NULL OR p_secondary_points IS NULL
    OR p_primary_points < 1 OR p_secondary_points < 0
    OR p_primary_points < p_secondary_points
    OR p_primary_points + p_secondary_points <> p_budget
    OR ((p_secondary IS NULL) <> (p_secondary_points=0))
    OR (p_secondary IS NOT NULL AND (NOT (p_secondary = ANY(v_elements)) OR p_secondary=p_primary))
  THEN
    RAISE EXCEPTION 'Invalid raid elemental profile or boss element' USING ERRCODE='P0213';
  END IF;

  v_grade := CASE p_budget WHEN 8 THEN 0 WHEN 9 THEN 200 ELSE 500 END;
  IF p_primary = ANY(v_core) AND p_boss = ANY(v_core) THEN
    v_i := array_position(v_core,p_primary);
    v_b := array_position(v_core,p_boss);
    v_rel_p := CASE WHEN (v_i % 4)+1=v_b THEN 1 WHEN (v_b % 4)+1=v_i THEN -1 ELSE 0 END;
  ELSIF p_primary IN ('LIGHT','DARK') AND p_boss IN ('LIGHT','DARK') AND p_primary <> p_boss THEN
    v_rel_p := 1;
  END IF;
  IF p_secondary IS NOT NULL THEN
    IF p_secondary = ANY(v_core) AND p_boss = ANY(v_core) THEN
      v_i := array_position(v_core,p_secondary);
      v_b := array_position(v_core,p_boss);
      v_rel_s := CASE WHEN (v_i % 4)+1=v_b THEN 1 WHEN (v_b % 4)+1=v_i THEN -1 ELSE 0 END;
    ELSIF p_secondary IN ('LIGHT','DARK') AND p_boss IN ('LIGHT','DARK') AND p_secondary <> p_boss THEN
      v_rel_s := 1;
    END IF;
  END IF;

  IF p_secondary IS NULL THEN
    v_type := 'PURE';
    v_match := v_rel_p*1000;
  ELSE
    v_focus := round(50::numeric*(p_primary_points-p_secondary_points)/p_budget)::integer;
    v_pcore := p_primary=ANY(v_core);
    v_score := p_secondary=ANY(v_core);
    IF v_pcore AND v_score THEN
      v_type := CASE WHEN abs(array_position(v_core,p_primary)-array_position(v_core,p_secondary))=2 THEN 'CROSS' ELSE 'ADJACENT' END;
      v_base := CASE WHEN v_type='CROSS' THEN 400 ELSE 600 END;
    ELSIF NOT v_pcore AND NOT v_score THEN
      v_type := 'POLAR_DUAL';
      v_base := 400;
    ELSE
      v_type := 'POLAR_MIXED';
      v_base := 600;
    END IF;

    IF v_rel_p=1 THEN
      v_match := v_base+v_focus;
    ELSIF v_rel_s=1 THEN
      v_match := v_base-v_focus;
    ELSIF v_type IN ('CROSS','POLAR_DUAL') THEN
      v_match := 0;
    ELSIF v_rel_p=-1 THEN
      v_match := -v_base-v_focus;
    ELSIF v_rel_s=-1 THEN
      v_match := -v_base+v_focus;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'version','V1','type',v_type,'boss_element',p_boss,
    'element_budget',p_budget,'primary_element',p_primary,'primary_points',p_primary_points,
    'secondary_element',p_secondary,'secondary_points',p_secondary_points,
    'grade_bonus_bp',v_grade,'matchup_bonus_bp',v_match,'focus_bp',v_focus,
    'total_multiplier_bp',10000+v_grade+v_match
  );
END;
$function$;

-- Restrict arithmetic RPC to callers reached via controlled functions and triggers.
REVOKE ALL ON FUNCTION public.raid_element_v1_math(integer,text,integer,text,integer,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.raid_element_v1_from_character(p_character_id bigint, p_boss text)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_profile public.character_element_profiles%ROWTYPE; v_effect jsonb;
BEGIN
  SELECT ep.* INTO v_profile FROM public.character_element_profiles ep
    WHERE ep.character_id=p_character_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Equipped character elemental profile missing: %',p_character_id USING ERRCODE='P0213';
  END IF;
  v_effect := public.raid_element_v1_math(v_profile.element_budget,v_profile.primary_element,
    v_profile.primary_points,v_profile.secondary_element,v_profile.secondary_points,p_boss);
  RETURN v_effect || jsonb_build_object('equipped_character_id',p_character_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.raid_element_v1_from_character(bigint,text) FROM PUBLIC,anon,authenticated;

-- Synchronize public column from existing raid metadata, without rewriting existing raids.
CREATE OR REPLACE FUNCTION public.raid_element_v1_version_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_requested text;
BEGIN
  IF TG_OP='INSERT' THEN
    v_requested := COALESCE(NEW.metadata->>'element_damage_rules_version','OFF');
    IF v_requested NOT IN ('OFF','V1') THEN RAISE EXCEPTION 'Invalid raid elemental rule version' USING ERRCODE='P0213'; END IF;
    NEW.element_damage_rules_version := v_requested;
  ELSE
    IF NEW.metadata IS DISTINCT FROM OLD.metadata
       AND NEW.metadata ? 'element_damage_rules_version' THEN
      v_requested := NEW.metadata->>'element_damage_rules_version';
      IF v_requested NOT IN ('OFF','V1') THEN RAISE EXCEPTION 'Invalid raid elemental rule version' USING ERRCODE='P0213'; END IF;
      NEW.element_damage_rules_version := v_requested;
    END IF;
    IF NEW.element_damage_rules_version IS DISTINCT FROM OLD.element_damage_rules_version
       AND OLD.status NOT IN ('DRAFT','LOBBY_OPEN') THEN
       RAISE EXCEPTION 'Cannot change elemental rules for started or finished raid' USING ERRCODE='P0215';
    END IF;
    IF NEW.status='ACTIVE' AND OLD.status IS DISTINCT FROM NEW.status
       AND NEW.element_damage_rules_version='V1'
       AND EXISTS (
        SELECT 1 FROM public.raid_phases ph WHERE ph.raid_id=NEW.id
          AND ph.boss_element IS NOT NULL AND ph.boss_element<>NEW.boss_element
       ) THEN
       RAISE EXCEPTION 'Element V1 requires the same boss element in all phases' USING ERRCODE='P0213';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS raid_element_v1_version_guard_trg ON public.raids;
CREATE TRIGGER raid_element_v1_version_guard_trg
  BEFORE INSERT OR UPDATE OF metadata,element_damage_rules_version,status ON public.raids
  FOR EACH ROW EXECUTE FUNCTION public.raid_element_v1_version_guard();

-- Prevent saving a phase with a different elemental boss when V1 is enabled.
CREATE OR REPLACE FUNCTION public.raid_element_v1_phase_guard()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE v_boss text; v_version text;
BEGIN
  SELECT boss_element,element_damage_rules_version INTO v_boss,v_version
    FROM public.raids WHERE id=NEW.raid_id;
  IF v_version='V1' AND NEW.boss_element IS NOT NULL AND NEW.boss_element<>v_boss THEN
    RAISE EXCEPTION 'Element V1 phase boss element must match raid boss element' USING ERRCODE='P0213';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS raid_element_v1_phase_guard_trg ON public.raid_phases;
CREATE TRIGGER raid_element_v1_phase_guard_trg
  BEFORE INSERT OR UPDATE OF boss_element,raid_id ON public.raid_phases
  FOR EACH ROW EXECUTE FUNCTION public.raid_element_v1_phase_guard();

-- Participant snapshot is written at teacher_start_raid, not at lobby entry.
CREATE OR REPLACE FUNCTION public.raid_element_v1_participant_snapshot()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_owned boolean;
  v_active boolean;
  v_effect jsonb;
  v_locked_equipped bigint;
  v_equipped_name text;
  v_equipped_image text;
BEGIN
  SELECT * INTO v_raid FROM public.raids WHERE id=NEW.raid_id;
  IF v_raid.element_damage_rules_version IS DISTINCT FROM 'V1' THEN
    NEW.snapshot_element_rules_version := 'OFF';
    NEW.snapshot_element_multiplier_bp := 10000;
    NEW.snapshot_element_effect := jsonb_build_object('version','OFF','total_multiplier_bp',10000);
    RETURN NEW;
  END IF;
  NEW.snapshot_element_rules_version := 'V1';
  -- Synchronize the locked, latest equipped character at the exact raid start.
  -- The equip_character UPDATE must wait on this row; the snapshot is immutable afterward.
  SELECT sp.equipped_character_id INTO v_locked_equipped
    FROM public.student_character_profiles sp WHERE sp.student_id=NEW.student_id FOR SHARE;
  NEW.snapshot_equipped_character_id := v_locked_equipped;
  IF v_locked_equipped IS NOT NULL THEN
    SELECT c.name::text,COALESCE(c.full_image_url,c.resource_url,c.card_image_url,c.avatar_image_url)
      INTO v_equipped_name,v_equipped_image FROM public.characters c WHERE c.id=v_locked_equipped;
    NEW.snapshot_equipped_character_name := v_equipped_name;
    NEW.snapshot_equipped_character_image_url := v_equipped_image;
  ELSE
    NEW.snapshot_equipped_character_name := NULL;
    NEW.snapshot_equipped_character_image_url := NULL;
  END IF;
  IF NEW.snapshot_equipped_character_id IS NULL THEN
    NEW.snapshot_element_multiplier_bp := 9000;
    NEW.snapshot_element_effect := jsonb_build_object('version','V1','type','UNEQUIPPED',
       'boss_element',v_raid.boss_element,'total_multiplier_bp',9000,'reason','NO_EQUIPPED_CHARACTER');
    RETURN NEW;
  END IF;
  SELECT COALESCE(sc.is_owned,false),COALESCE(c.is_active,false)
    INTO v_owned,v_active
    FROM public.characters c
    LEFT JOIN public.student_characters sc ON sc.character_id=c.id AND sc.student_id=NEW.student_id
    WHERE c.id=NEW.snapshot_equipped_character_id;
  IF NOT FOUND OR NOT COALESCE(v_owned,false) OR NOT COALESCE(v_active,false) THEN
    NEW.snapshot_element_multiplier_bp := 9000;
    NEW.snapshot_element_effect := jsonb_build_object('version','V1','type','UNEQUIPPED',
      'boss_element',v_raid.boss_element,'total_multiplier_bp',9000,'reason','INVALID_EQUIPPED_CHARACTER');
    RETURN NEW;
  END IF;
  v_effect := public.raid_element_v1_from_character(NEW.snapshot_equipped_character_id,v_raid.boss_element);
  NEW.snapshot_element_effect := v_effect;
  NEW.snapshot_element_multiplier_bp := (v_effect->>'total_multiplier_bp')::integer;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS raid_element_v1_participant_snapshot_trg ON public.raid_participants;
CREATE TRIGGER raid_element_v1_participant_snapshot_trg
  BEFORE INSERT ON public.raid_participants
  FOR EACH ROW EXECUTE FUNCTION public.raid_element_v1_participant_snapshot();

-- Single authorized student's list for lobby item switching; never disclose classmates' inventory.
CREATE OR REPLACE FUNCTION public.get_my_raid_element_options(p_raid_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_student integer;
  v_raid public.raids%ROWTYPE;
  v_equipped bigint;
  v_options jsonb;
  v_preview jsonb;
  v_locked jsonb;
BEGIN
  v_student := public.raid_current_student_for_raid(p_raid_id);
  SELECT * INTO v_raid FROM public.raids WHERE id=p_raid_id;
  IF NOT FOUND OR v_raid.status NOT IN ('LOBBY_OPEN','ACTIVE','PAUSED','COMPLETED','FAILED') THEN
    RAISE EXCEPTION 'Raid lobby not available' USING ERRCODE='P0215';
  END IF;
  SELECT equipped_character_id INTO v_equipped
    FROM public.student_character_profiles WHERE student_id=v_student;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'character_id',c.id,'name',c.name,
    'image_url',COALESCE(c.full_image_url,c.resource_url,c.card_image_url,c.avatar_image_url),
    'is_equipped',c.id=v_equipped,
    'primary_element',ep.primary_element,'primary_points',ep.primary_points,
    'secondary_element',ep.secondary_element,'secondary_points',ep.secondary_points,
    'element_budget',ep.element_budget,
    'effect',CASE WHEN v_raid.element_damage_rules_version='V1'
      THEN public.raid_element_v1_from_character(c.id,v_raid.boss_element)
      ELSE jsonb_build_object('version','OFF','total_multiplier_bp',10000) END
  ) ORDER BY c.name,c.id),'[]'::jsonb)
    INTO v_options
    FROM public.student_characters sc
    JOIN public.characters c ON c.id=sc.character_id AND c.is_active=true
    LEFT JOIN public.character_element_profiles ep ON ep.character_id=c.id
    WHERE sc.student_id=v_student AND sc.is_owned=true;

  v_preview := CASE WHEN v_raid.element_damage_rules_version<>'V1'
    THEN jsonb_build_object('version','OFF','total_multiplier_bp',10000)
    ELSE jsonb_build_object('version','V1','type','UNEQUIPPED','total_multiplier_bp',9000,
      'boss_element',v_raid.boss_element,'reason','NO_VALID_EQUIPPED_CHARACTER') END;
  IF v_equipped IS NOT NULL AND v_raid.element_damage_rules_version='V1'
    AND EXISTS(SELECT 1 FROM public.student_characters sc JOIN public.characters c ON c.id=sc.character_id
      WHERE sc.student_id=v_student AND sc.character_id=v_equipped AND sc.is_owned=true AND c.is_active=true) THEN
    v_preview := public.raid_element_v1_from_character(v_equipped,v_raid.boss_element);
  END IF;
  IF v_raid.status <> 'LOBBY_OPEN' THEN
    SELECT jsonb_build_object('version',rp.snapshot_element_rules_version,
      'total_multiplier_bp',rp.snapshot_element_multiplier_bp,'type',rp.snapshot_element_effect->>'type',
      'grade_bonus_bp',rp.snapshot_element_effect->'grade_bonus_bp',
      'matchup_bonus_bp',rp.snapshot_element_effect->'matchup_bonus_bp',
      'equipped_character_id',rp.snapshot_equipped_character_id,
      'equipped_character_name',rp.snapshot_equipped_character_name,
      'equipped_character_image_url',rp.snapshot_equipped_character_image_url)
      INTO v_locked FROM public.raid_participants rp
      WHERE rp.raid_id=p_raid_id AND rp.student_id=v_student;
  END IF;
  RETURN jsonb_build_object('rules_version',v_raid.element_damage_rules_version,
    'raid_status',v_raid.status,'boss_element',v_raid.boss_element,
    'equipped_character_id',v_equipped,
    'locked_equipped_character_id',v_locked->'equipped_character_id',
    'locked_equipped_character_name',v_locked->'equipped_character_name',
    'locked_equipped_character_image_url',v_locked->'equipped_character_image_url',
    'preview',COALESCE(v_locked,v_preview),'options',v_options);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_my_raid_element_options(bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_my_raid_element_options(bigint) TO authenticated;

-- Preserve the current 600+ line production attack function; patch only one inspected term.
DO $patch_attack$
DECLARE v_name regprocedure := to_regprocedure('public.submit_raid_tap_batch(bigint,uuid,jsonb)');
  v_ddl text; v_needle text := 'v_participant.snapshot_raid_power::numeric*v_raid.damage_coefficient*v_roll*';
  v_insert text := 'v_participant.snapshot_raid_power::numeric*(v_participant.snapshot_element_multiplier_bp::numeric/10000.0)*v_raid.damage_coefficient*v_roll*';
BEGIN
  IF v_name IS NULL THEN RAISE EXCEPTION 'Raid attack function not found'; END IF;
  SELECT pg_get_functiondef(v_name) INTO v_ddl;
  IF strpos(v_ddl,v_insert)>0 THEN RETURN; END IF;
  IF strpos(v_ddl,v_needle)=0 OR strpos(substr(v_ddl,strpos(v_ddl,v_needle)+length(v_needle)),v_needle)>0 THEN
    RAISE EXCEPTION 'Attack function source mismatch. Aborting entire migration.';
  END IF;
  EXECUTE replace(v_ddl,v_needle,v_insert);
END;
$patch_attack$;

-- Append locked multiplier to get_raid_battle_state.me (does not expose others' values).
DO $patch_battle_state$
DECLARE v_name regprocedure := to_regprocedure('public.get_raid_battle_state(bigint)');
  v_ddl text; v_needle text := '''raid_power'',part.snapshot_raid_power,''base_crit_bp''';
  v_insert text := '''raid_power'',part.snapshot_raid_power,''element_multiplier_bp'',part.snapshot_element_multiplier_bp,''element_effect'',part.snapshot_element_effect,''base_crit_bp''';
BEGIN
  IF v_name IS NULL THEN RAISE EXCEPTION 'Raid battle state function not found'; END IF;
  SELECT pg_get_functiondef(v_name) INTO v_ddl;
  IF strpos(v_ddl,v_insert)>0 THEN RETURN; END IF;
  IF strpos(v_ddl,v_needle)=0 OR strpos(substr(v_ddl,strpos(v_ddl,v_needle)+length(v_needle)),v_needle)>0 THEN
    RAISE EXCEPTION 'Battle state function source mismatch. Aborting entire migration.';
  END IF;
  EXECUTE replace(v_ddl,v_needle,v_insert);
END;
$patch_battle_state$;

-- Sanity: no retroactive activation, no old participant multiplier change.
DO $sanity$
BEGIN
  IF EXISTS (SELECT 1 FROM public.raids WHERE element_damage_rules_version <> 'OFF'
    AND metadata->>'element_damage_rules_version' IS DISTINCT FROM 'V1') THEN
    RAISE EXCEPTION 'Unexpected element V1 activation without metadata';
  END IF;
END;
$sanity$;

COMMIT;

-- READ-ONLY POSTCHECK, run after migration:
-- SELECT count(*) FILTER(WHERE element_damage_rules_version='V1') AS enabled,
--        count(*) AS total FROM public.raids;
-- SELECT count(*) FILTER(WHERE snapshot_element_multiplier_bp<>10000) AS unexpected,
--        count(*) AS total FROM public.raid_participants;
-- SELECT public.raid_element_v1_math(10,'EARTH',5,'FIRE',5,'WATER');
