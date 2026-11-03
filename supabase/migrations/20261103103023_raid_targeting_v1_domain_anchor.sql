-- RAID_TARGETING_V1_20261103
-- Production project tnsmjyzbjgfepubxvstw already has migration version 20261103103023 applied.
-- Keep this file in Git for reproducibility. The one-click source patcher does NOT execute it.

CREATE OR REPLACE FUNCTION public.raid_targeting_public_config(
  p_phase_id bigint,
  p_phase_metadata jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg jsonb := COALESCE(p_phase_metadata->'targeting_v1','{}'::jsonb);
  v_mode text := upper(COALESCE(NULLIF(p_phase_metadata#>>'{targeting_v1,mode}',''),'BODY'));
  v_zone jsonb := NULL;
  v_hint text;
  v_miss text;
  v_initial_ms integer;
  v_miss_ms integer;
  v_repeat_threshold integer;
BEGIN
  IF v_mode NOT IN ('BODY','DOMAIN','ANCHOR') THEN v_mode := 'BODY'; END IF;

  SELECT jsonb_build_object(
           'x',hz.x,'y',hz.y,'width',hz.width,'height',hz.height,
           'shape',hz.shape,'name',hz.name
         )
    INTO v_zone
    FROM public.raid_hit_zones hz
   WHERE hz.raid_phase_id=p_phase_id
     AND hz.zone_key='PRIMARY_TARGET'
     AND hz.is_active=true
     AND hz.width>0 AND hz.height>0
     AND hz.x>=0 AND hz.y>=0
     AND hz.x+hz.width<=1 AND hz.y+hz.height<=1
   ORDER BY hz.priority DESC,hz.id
   LIMIT 1;

  v_hint := NULLIF(v_cfg->>'hint_text','');
  v_miss := NULLIF(v_cfg->>'miss_text','');

  IF v_hint IS NULL THEN
    v_hint := CASE
      WHEN v_mode='DOMAIN' THEN '보스가 지배하는 영역을 공격하세요!'
      WHEN v_mode='ANCHOR' THEN '보스의 핵심 표적을 공격하세요!'
      ELSE ''
    END;
  END IF;
  IF v_miss IS NULL THEN
    v_miss := CASE
      WHEN v_mode='DOMAIN' THEN '빛나는 공격 영역을 노리세요!'
      WHEN v_mode='ANCHOR' THEN '빛나는 핵심 부위를 노리세요!'
      ELSE ''
    END;
  END IF;

  BEGIN
    v_initial_ms := LEAST(5000,GREATEST(0,COALESCE(NULLIF(v_cfg->>'show_initial_guide_ms','')::integer,1500)));
  EXCEPTION WHEN OTHERS THEN v_initial_ms := 1500;
  END;
  BEGIN
    v_miss_ms := LEAST(3000,GREATEST(0,COALESCE(NULLIF(v_cfg->>'show_miss_guide_ms','')::integer,900)));
  EXCEPTION WHEN OTHERS THEN v_miss_ms := 900;
  END;
  BEGIN
    v_repeat_threshold := LEAST(8,GREATEST(2,COALESCE(NULLIF(v_cfg->>'miss_repeat_threshold','')::integer,3)));
  EXCEPTION WHEN OTHERS THEN v_repeat_threshold := 3;
  END;

  RETURN jsonb_build_object(
    'version',1,'mode',v_mode,'hint_text',v_hint,'miss_text',v_miss,
    'show_initial_guide_ms',v_initial_ms,'show_miss_guide_ms',v_miss_ms,
    'miss_repeat_threshold',v_repeat_threshold,
    'primary_zone',CASE WHEN v_mode='BODY' THEN NULL ELSE v_zone END,
    'valid',CASE WHEN v_mode='BODY' THEN true ELSE v_zone IS NOT NULL END
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.raid_targeting_allows_tap(
  p_phase_id bigint,
  p_phase_metadata jsonb,
  p_pattern_type text,
  p_pattern_state jsonb,
  p_x numeric,
  p_y numeric
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_mode text := upper(COALESCE(NULLIF(p_phase_metadata#>>'{targeting_v1,mode}',''),'BODY'));
  v_state jsonb := COALESCE(p_pattern_state,'{}'::jsonb);
  v_type text := upper(COALESCE(p_pattern_type,''));
  v_targets jsonb;
  v_idx integer := -1;
  v_has_primary boolean := false;
  v_in_primary boolean := false;
  v_tx numeric;
  v_ty numeric;
  v_tw numeric;
  v_th numeric;
BEGIN
  IF v_mode NOT IN ('DOMAIN','ANCHOR') THEN RETURN true; END IF;
  IF p_x IS NULL OR p_y IS NULL OR p_x<0 OR p_x>1 OR p_y<0 OR p_y>1 THEN RETURN false; END IF;

  IF v_type='WEAK_POINT' THEN
    BEGIN
      v_tx := COALESCE(NULLIF(v_state->>'x','')::numeric,0.42);
      v_ty := COALESCE(NULLIF(v_state->>'y','')::numeric,0.30);
      v_tw := COALESCE(NULLIF(v_state->>'width','')::numeric,0.16);
      v_th := COALESCE(NULLIF(v_state->>'height','')::numeric,0.22);
      IF p_x>=v_tx AND p_x<=v_tx+v_tw AND p_y>=v_ty AND p_y<=v_ty+v_th THEN RETURN true; END IF;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  ELSIF v_type='DOT' AND jsonb_typeof(v_state->'interrupt_target')='object' THEN
    v_targets := jsonb_build_array(v_state->'interrupt_target');
    v_idx := public.raid_e3_find_target_index(v_targets,p_x,p_y);
    IF v_idx>=0 AND COALESCE(NULLIF((v_targets->v_idx)->>'current_hp','')::bigint,0)>0 THEN RETURN true; END IF;
  ELSIF v_type='MULTI_CORE' AND jsonb_typeof(v_state->'cores')='array' THEN
    v_targets := v_state->'cores';
    v_idx := public.raid_e3_find_target_index(v_targets,p_x,p_y);
    IF v_idx>=0 AND COALESCE(NULLIF((v_targets->v_idx)->>'current_hp','')::bigint,0)>0 THEN RETURN true; END IF;
  ELSIF v_type='SPLIT_TARGET' AND jsonb_typeof(v_state->'targets')='array' THEN
    v_targets := v_state->'targets';
    v_idx := public.raid_e3_find_target_index(v_targets,p_x,p_y);
    IF v_idx>=0 AND COALESCE(NULLIF((v_targets->v_idx)->>'current_hp','')::bigint,0)>0 THEN RETURN true; END IF;
  ELSIF v_type='REGEN' AND jsonb_typeof(v_state->'core')='object' THEN
    v_targets := jsonb_build_array(v_state->'core');
    v_idx := public.raid_e3_find_target_index(v_targets,p_x,p_y);
    IF v_idx>=0 AND COALESCE(NULLIF((v_targets->v_idx)->>'current_hp','')::bigint,0)>0 THEN RETURN true; END IF;
  ELSIF v_type='SEAL' AND jsonb_typeof(v_state->'seals')='array' THEN
    v_targets := v_state->'seals';
    v_idx := public.raid_e3_find_target_index(v_targets,p_x,p_y);
    IF v_idx>=0 AND COALESCE(NULLIF((v_targets->v_idx)->>'current_hp','')::bigint,0)>0 THEN RETURN true; END IF;
  END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.raid_hit_zones hz
     WHERE hz.raid_phase_id=p_phase_id
       AND hz.zone_key='PRIMARY_TARGET'
       AND hz.is_active=true
       AND hz.width>0 AND hz.height>0
       AND hz.x>=0 AND hz.y>=0
       AND hz.x+hz.width<=1 AND hz.y+hz.height<=1
  ) INTO v_has_primary;

  IF NOT v_has_primary THEN RETURN true; END IF;

  SELECT EXISTS(
    SELECT 1
      FROM public.raid_hit_zones hz
     WHERE hz.raid_phase_id=p_phase_id
       AND hz.zone_key='PRIMARY_TARGET'
       AND hz.is_active=true
       AND p_x>=hz.x AND p_x<=hz.x+hz.width
       AND p_y>=hz.y AND p_y<=hz.y+hz.height
  ) INTO v_in_primary;

  RETURN v_in_primary;
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_save_raid_targeting(
  p_raid_id bigint,
  p_phase_no smallint,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_phase_id bigint;
  v_mode text;
  v_cfg jsonb;
  v_x numeric; v_y numeric; v_w numeric; v_h numeric;
  v_existing_x numeric; v_existing_y numeric; v_existing_w numeric; v_existing_h numeric;
  v_hint text; v_miss text;
  v_initial_ms integer; v_miss_ms integer; v_repeat_threshold integer;
BEGIN
  PERFORM public.raid_teacher_require_raid(p_raid_id);

  SELECT r.status::text,rp.id
    INTO v_status,v_phase_id
    FROM public.raids r
    JOIN public.raid_phases rp ON rp.raid_id=r.id AND rp.phase_no=p_phase_no
   WHERE r.id=p_raid_id
   FOR UPDATE OF rp;

  IF NOT FOUND THEN RAISE EXCEPTION 'Raid phase not found' USING ERRCODE='P0202'; END IF;
  IF v_status NOT IN ('DRAFT','LOBBY_OPEN') THEN
    RAISE EXCEPTION 'Raid targeting cannot be changed after battle starts' USING ERRCODE='P0215';
  END IF;

  v_mode := upper(COALESCE(NULLIF(btrim(COALESCE(p_payload->>'mode','')),''),'BODY'));
  IF v_mode NOT IN ('BODY','DOMAIN','ANCHOR') THEN
    RAISE EXCEPTION 'Unsupported targeting mode' USING ERRCODE='P0213';
  END IF;

  SELECT hz.x,hz.y,hz.width,hz.height
    INTO v_existing_x,v_existing_y,v_existing_w,v_existing_h
    FROM public.raid_hit_zones hz
   WHERE hz.raid_phase_id=v_phase_id AND hz.zone_key='PRIMARY_TARGET'
   ORDER BY hz.id LIMIT 1;

  BEGIN
    v_x := COALESCE(NULLIF(p_payload->>'x','')::numeric,v_existing_x);
    v_y := COALESCE(NULLIF(p_payload->>'y','')::numeric,v_existing_y);
    v_w := COALESCE(NULLIF(p_payload->>'width','')::numeric,v_existing_w);
    v_h := COALESCE(NULLIF(p_payload->>'height','')::numeric,v_existing_h);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid targeting coordinates' USING ERRCODE='P0213';
  END;

  v_hint := NULLIF(btrim(COALESCE(p_payload->>'hint_text','')),'');
  v_miss := NULLIF(btrim(COALESCE(p_payload->>'miss_text','')),'');

  BEGIN
    v_initial_ms := LEAST(5000,GREATEST(0,COALESCE(NULLIF(p_payload->>'show_initial_guide_ms','')::integer,1500)));
    v_miss_ms := LEAST(3000,GREATEST(0,COALESCE(NULLIF(p_payload->>'show_miss_guide_ms','')::integer,900)));
    v_repeat_threshold := LEAST(8,GREATEST(2,COALESCE(NULLIF(p_payload->>'miss_repeat_threshold','')::integer,3)));
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid targeting guide settings' USING ERRCODE='P0213';
  END;

  IF v_mode='BODY' THEN
    UPDATE public.raid_hit_zones
       SET is_active=false,updated_at=now()
     WHERE raid_phase_id=v_phase_id AND zone_key='PRIMARY_TARGET';
  ELSE
    IF v_x IS NULL OR v_y IS NULL OR v_w IS NULL OR v_h IS NULL
       OR v_x<0 OR v_y<0 OR v_w<=0 OR v_h<=0
       OR v_x+v_w>1 OR v_y+v_h>1 THEN
      RAISE EXCEPTION 'DOMAIN/ANCHOR requires a valid PRIMARY_TARGET rectangle' USING ERRCODE='P0213';
    END IF;

    INSERT INTO public.raid_hit_zones(
      raid_phase_id,zone_key,name,shape,x,y,width,height,
      damage_multiplier,weak_element,element_multiplier,
      is_active,is_visible_to_student,priority,metadata,created_at,updated_at
    ) VALUES (
      v_phase_id,'PRIMARY_TARGET',
      CASE WHEN v_mode='DOMAIN' THEN '지배 영역' ELSE '핵심 표적' END,
      'RECT',v_x,v_y,v_w,v_h,1.0000,NULL,1.0000,true,false,100,
      jsonb_build_object('targeting_v1',true,'mode',v_mode),now(),now()
    )
    ON CONFLICT (raid_phase_id,zone_key)
    DO UPDATE SET
      name=excluded.name,shape='RECT',x=excluded.x,y=excluded.y,
      width=excluded.width,height=excluded.height,
      damage_multiplier=1.0000,weak_element=NULL,element_multiplier=1.0000,
      is_active=true,is_visible_to_student=false,priority=100,
      metadata=excluded.metadata,updated_at=now();
  END IF;

  v_cfg := jsonb_build_object(
    'version',1,'mode',v_mode,
    'hint_text',COALESCE(v_hint,CASE
      WHEN v_mode='DOMAIN' THEN '보스가 지배하는 영역을 공격하세요!'
      WHEN v_mode='ANCHOR' THEN '보스의 핵심 표적을 공격하세요!'
      ELSE '' END),
    'miss_text',COALESCE(v_miss,CASE
      WHEN v_mode='DOMAIN' THEN '빛나는 공격 영역을 노리세요!'
      WHEN v_mode='ANCHOR' THEN '빛나는 핵심 부위를 노리세요!'
      ELSE '' END),
    'show_initial_guide_ms',v_initial_ms,
    'show_miss_guide_ms',v_miss_ms,
    'miss_repeat_threshold',v_repeat_threshold
  );

  UPDATE public.raid_phases
     SET metadata=jsonb_set(COALESCE(metadata,'{}'::jsonb),'{targeting_v1}',v_cfg,true),
         updated_at=now()
   WHERE id=v_phase_id;

  RETURN public.raid_targeting_public_config(
    v_phase_id,
    (SELECT metadata FROM public.raid_phases WHERE id=v_phase_id)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.raid_targeting_public_config(bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.raid_targeting_allows_tap(bigint,jsonb,text,jsonb,numeric,numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.teacher_save_raid_targeting(bigint,smallint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.teacher_save_raid_targeting(bigint,smallint,jsonb) TO authenticated;

-- Patch large existing RPCs structurally. This file is designed for the repository
-- state immediately before Targeting V1 and is also safe if those RPCs are already patched.
DO $migration$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='submit_raid_tap_batch'
     AND pg_get_function_identity_arguments(p.oid)='p_raid_id bigint, p_batch_id uuid, p_taps jsonb';

  IF position('raid_targeting_allows_tap(' in v_def)=0 THEN
    v_anchor := E'\n\n    v_zone_key:=''BODY''; v_zone_multiplier:=1.0000;';
    IF (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Targeting V1: submit_raid_tap_batch anchor mismatch';
    END IF;
    v_def := replace(v_def,v_anchor,
      E'\n    IF NOT public.raid_targeting_allows_tap(\n'
      || E'      v_phase.id,v_phase.metadata,v_pattern_type,v_pattern_state,v_x,v_y\n'
      || E'    ) THEN\n'
      || E'      v_rejected:=v_rejected+1;\n'
      || E'      v_results:=v_results||jsonb_build_array(\n'
      || E'        jsonb_build_object(''accepted'',false,''reason'',''OUTSIDE_TARGET_ZONE'',''x'',v_x,''y'',v_y)\n'
      || E'      );\n'
      || E'      CONTINUE;\n'
      || E'    END IF;'
      || v_anchor
    );
    EXECUTE v_def;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='get_raid_battle_state'
     AND pg_get_function_identity_arguments(p.oid)='p_raid_id bigint';

  IF position('''targeting'', public.raid_targeting_public_config' in v_def)=0 THEN
    v_anchor := '''loop_video_url'', phase.loop_video_url, ''visual'', public.raid_normalize_visual_v2(phase.metadata)) end),';
    IF (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Targeting V1: get_raid_battle_state anchor mismatch';
    END IF;
    v_def := replace(v_def,v_anchor,
      '''loop_video_url'', phase.loop_video_url, ''visual'', public.raid_normalize_visual_v2(phase.metadata), '
      || '''targeting'', public.raid_targeting_public_config(phase.id, phase.metadata)) end),'
    );
    EXECUTE v_def;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='teacher_get_raid_broadcast_state'
     AND pg_get_function_identity_arguments(p.oid)='p_raid_id bigint';

  IF position('''targeting'', public.raid_targeting_public_config' in v_def)=0 THEN
    v_anchor := '''loop_video_url'', phase.loop_video_url, ''visual'', public.raid_normalize_visual_v2(phase.metadata)) end';
    IF (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Targeting V1: teacher_get_raid_broadcast_state anchor mismatch';
    END IF;
    v_def := replace(v_def,v_anchor,
      '''loop_video_url'', phase.loop_video_url, ''visual'', public.raid_normalize_visual_v2(phase.metadata), '
      || '''targeting'', public.raid_targeting_public_config(phase.id, phase.metadata)) end'
    );
    EXECUTE v_def;
  END IF;
END;
$migration$;

DO $migration$
DECLARE
  v_def text;
  v_anchor text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='teacher_start_raid'
     AND pg_get_function_identity_arguments(p.oid)='p_raid_id bigint';

  IF position('Raid targeting zone is required for DOMAIN/ANCHOR mode' in v_def)=0 THEN
    v_anchor := E'  IF NOT v_media_ok THEN RAISE EXCEPTION ''Every Raid phase needs an image or loop video'' USING ERRCODE=''P0213''; END IF;\n\n  FOR v_student IN';
    IF (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'Targeting V1: teacher_start_raid anchor mismatch';
    END IF;
    v_def := replace(v_def,v_anchor,
      E'  IF NOT v_media_ok THEN RAISE EXCEPTION ''Every Raid phase needs an image or loop video'' USING ERRCODE=''P0213''; END IF;\n\n'
      || E'  IF EXISTS (\n'
      || E'    SELECT 1 FROM public.raid_phases rp\n'
      || E'    WHERE rp.raid_id=p_raid_id\n'
      || E'      AND COALESCE((public.raid_targeting_public_config(rp.id,rp.metadata)->>''valid'')::boolean,false)=false\n'
      || E'  ) THEN\n'
      || E'    RAISE EXCEPTION ''Raid targeting zone is required for DOMAIN/ANCHOR mode'' USING ERRCODE=''P0213'';\n'
      || E'  END IF;\n\n'
      || E'  FOR v_student IN'
    );
    EXECUTE v_def;
  END IF;
END;
$migration$;

NOTIFY pgrst, 'reload schema';
