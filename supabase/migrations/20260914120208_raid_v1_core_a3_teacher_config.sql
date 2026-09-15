-- 4. TEACHER CONFIGURATION RPC
-- ============================================================================

CREATE FUNCTION public.teacher_create_raid(
  p_classroom_id INTEGER,
  p_payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_title TEXT := btrim(COALESCE(p_payload->>'title',''));
  v_boss_name TEXT := btrim(COALESCE(p_payload->>'boss_name',''));
  v_boss_element TEXT := upper(btrim(COALESCE(p_payload->>'boss_element','')));
  v_max_hp BIGINT := COALESCE(NULLIF(p_payload->>'max_hp','')::bigint, 1000000);
  v_raid_id BIGINT;
  v_phase_id BIGINT;
BEGIN
  PERFORM public.raid_teacher_require_classroom(p_classroom_id);

  IF v_title = '' THEN
    RAISE EXCEPTION 'Raid title is required'
      USING ERRCODE = 'P0212';
  END IF;

  IF v_boss_name = '' THEN
    RAISE EXCEPTION 'Boss name is required'
      USING ERRCODE = 'P0212';
  END IF;

  IF v_boss_element NOT IN ('WATER','FIRE','WIND','EARTH','LIGHT','DARK') THEN
    RAISE EXCEPTION 'Unsupported boss element'
      USING ERRCODE = 'P0213';
  END IF;

  IF v_max_hp <= 0 THEN
    RAISE EXCEPTION 'Boss HP must be positive'
      USING ERRCODE = 'P0213';
  END IF;

  INSERT INTO public.raids (
    classroom_id,
    title,
    boss_name,
    boss_description,
    boss_element,
    status,
    max_hp,
    current_hp,
    ends_at,
    damage_coefficient,
    variance_min,
    variance_max,
    crit_multiplier,
    tap_rate_limit_per_second,
    chat_enabled,
    chat_slow_mode_seconds,
    include_test_accounts,
    reward_config,
    metadata,
    created_by
  )
  VALUES (
    p_classroom_id,
    v_title,
    v_boss_name,
    NULLIF(btrim(COALESCE(p_payload->>'boss_description','')), ''),
    v_boss_element,
    'DRAFT',
    v_max_hp,
    v_max_hp,
    NULLIF(p_payload->>'ends_at','')::timestamptz,
    COALESCE(NULLIF(p_payload->>'damage_coefficient','')::numeric, 0.020000),
    COALESCE(NULLIF(p_payload->>'variance_min','')::numeric, 0.90000),
    COALESCE(NULLIF(p_payload->>'variance_max','')::numeric, 1.10000),
    COALESCE(NULLIF(p_payload->>'crit_multiplier','')::numeric, 2.0000),
    COALESCE(NULLIF(p_payload->>'tap_rate_limit_per_second','')::smallint, 10),
    COALESCE((p_payload->>'chat_enabled')::boolean, TRUE),
    COALESCE(NULLIF(p_payload->>'chat_slow_mode_seconds','')::smallint, 2),
    COALESCE((p_payload->>'include_test_accounts')::boolean, FALSE),
    COALESCE(p_payload->'reward_config', '{}'::jsonb),
    COALESCE(p_payload->'metadata', '{}'::jsonb),
    auth.uid()
  )
  RETURNING id INTO v_raid_id;

  INSERT INTO public.raid_phases (
    raid_id,
    phase_no,
    hp_from_ratio,
    hp_to_ratio,
    boss_element,
    image_url,
    loop_video_url
  )
  VALUES (
    v_raid_id,
    1,
    1.000000,
    0.000000,
    v_boss_element,
    NULLIF(btrim(COALESCE(p_payload->>'image_url','')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'loop_video_url','')), '')
  )
  RETURNING id INTO v_phase_id;

  INSERT INTO public.raid_hit_zones (
    raid_phase_id,
    zone_key,
    name,
    shape,
    x,
    y,
    width,
    height,
    damage_multiplier,
    element_multiplier,
    is_active,
    is_visible_to_student,
    priority
  )
  VALUES (
    v_phase_id,
    'BODY',
    '전체',
    'RECT',
    0,
    0,
    1,
    1,
    1.0000,
    1.0000,
    TRUE,
    FALSE,
    -100
  );

  RETURN v_raid_id;
END;
$$;

CREATE FUNCTION public.teacher_update_raid(
  p_raid_id BIGINT,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_title TEXT;
  v_boss_name TEXT;
  v_boss_element TEXT;
  v_max_hp BIGINT;
BEGIN
  SELECT *
    INTO v_raid
  FROM public.raids
  WHERE id = p_raid_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  IF v_raid.status NOT IN ('DRAFT','LOBBY_OPEN') THEN
    RAISE EXCEPTION 'Active or completed Raid configuration is immutable'
      USING ERRCODE = 'P0215';
  END IF;

  v_title := CASE
    WHEN p_payload ? 'title'
      THEN btrim(COALESCE(p_payload->>'title',''))
    ELSE v_raid.title
  END;

  v_boss_name := CASE
    WHEN p_payload ? 'boss_name'
      THEN btrim(COALESCE(p_payload->>'boss_name',''))
    ELSE v_raid.boss_name
  END;

  v_boss_element := CASE
    WHEN p_payload ? 'boss_element'
      THEN upper(btrim(COALESCE(p_payload->>'boss_element','')))
    ELSE v_raid.boss_element
  END;

  v_max_hp := CASE
    WHEN p_payload ? 'max_hp'
      THEN NULLIF(p_payload->>'max_hp','')::bigint
    ELSE v_raid.max_hp
  END;

  IF v_title = '' OR v_boss_name = '' THEN
    RAISE EXCEPTION 'Raid title and boss name are required'
      USING ERRCODE = 'P0212';
  END IF;

  IF v_boss_element NOT IN ('WATER','FIRE','WIND','EARTH','LIGHT','DARK') THEN
    RAISE EXCEPTION 'Unsupported boss element'
      USING ERRCODE = 'P0213';
  END IF;

  IF v_max_hp IS NULL OR v_max_hp <= 0 THEN
    RAISE EXCEPTION 'Boss HP must be positive'
      USING ERRCODE = 'P0213';
  END IF;

  UPDATE public.raids
     SET title = v_title,
         boss_name = v_boss_name,
         boss_description = CASE
           WHEN p_payload ? 'boss_description'
             THEN NULLIF(btrim(COALESCE(p_payload->>'boss_description','')), '')
           ELSE boss_description
         END,
         boss_element = v_boss_element,
         max_hp = v_max_hp,
         current_hp = v_max_hp,
         ends_at = CASE
           WHEN p_payload ? 'ends_at'
             THEN NULLIF(p_payload->>'ends_at','')::timestamptz
           ELSE ends_at
         END,
         damage_coefficient = CASE
           WHEN p_payload ? 'damage_coefficient'
             THEN NULLIF(p_payload->>'damage_coefficient','')::numeric
           ELSE damage_coefficient
         END,
         variance_min = CASE
           WHEN p_payload ? 'variance_min'
             THEN NULLIF(p_payload->>'variance_min','')::numeric
           ELSE variance_min
         END,
         variance_max = CASE
           WHEN p_payload ? 'variance_max'
             THEN NULLIF(p_payload->>'variance_max','')::numeric
           ELSE variance_max
         END,
         crit_multiplier = CASE
           WHEN p_payload ? 'crit_multiplier'
             THEN NULLIF(p_payload->>'crit_multiplier','')::numeric
           ELSE crit_multiplier
         END,
         tap_rate_limit_per_second = CASE
           WHEN p_payload ? 'tap_rate_limit_per_second'
             THEN NULLIF(p_payload->>'tap_rate_limit_per_second','')::smallint
           ELSE tap_rate_limit_per_second
         END,
         chat_enabled = CASE
           WHEN p_payload ? 'chat_enabled'
             THEN (p_payload->>'chat_enabled')::boolean
           ELSE chat_enabled
         END,
         chat_slow_mode_seconds = CASE
           WHEN p_payload ? 'chat_slow_mode_seconds'
             THEN NULLIF(p_payload->>'chat_slow_mode_seconds','')::smallint
           ELSE chat_slow_mode_seconds
         END,
         include_test_accounts = CASE
           WHEN p_payload ? 'include_test_accounts'
             THEN (p_payload->>'include_test_accounts')::boolean
           ELSE include_test_accounts
         END,
         reward_config = CASE
           WHEN p_payload ? 'reward_config'
             THEN COALESCE(p_payload->'reward_config','{}'::jsonb)
           ELSE reward_config
         END,
         metadata = CASE
           WHEN p_payload ? 'metadata'
             THEN COALESCE(p_payload->'metadata','{}'::jsonb)
           ELSE metadata
         END,
         updated_at = now()
   WHERE id = p_raid_id;

  -- Keep the default phase aligned when it has not been explicitly changed
  -- away from the previous Raid-level element.
  UPDATE public.raid_phases
     SET boss_element = v_boss_element,
         updated_at = now()
   WHERE raid_id = p_raid_id
     AND phase_no = 1
     AND (boss_element IS NULL OR boss_element = v_raid.boss_element);
END;
$$;

CREATE FUNCTION public.teacher_save_raid_phase(
  p_raid_id BIGINT,
  p_phase_no SMALLINT,
  p_payload JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_phase_id BIGINT;
  v_from NUMERIC;
  v_to NUMERIC;
  v_element TEXT;
BEGIN
  SELECT *
    INTO v_raid
  FROM public.raids
  WHERE id = p_raid_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_classroom(v_raid.classroom_id);

  IF v_raid.status NOT IN ('DRAFT','LOBBY_OPEN') THEN
    RAISE EXCEPTION 'Raid phases cannot be changed after battle starts'
      USING ERRCODE = 'P0215';
  END IF;

  IF p_phase_no IS NULL OR p_phase_no < 1 THEN
    RAISE EXCEPTION 'Invalid phase number'
      USING ERRCODE = 'P0213';
  END IF;

  v_from := NULLIF(p_payload->>'hp_from_ratio','')::numeric;
  v_to := NULLIF(p_payload->>'hp_to_ratio','')::numeric;
  v_element := NULLIF(upper(btrim(COALESCE(p_payload->>'boss_element',''))), '');

  IF v_from IS NULL OR v_to IS NULL OR v_from <= v_to
     OR v_from > 1 OR v_to < 0
  THEN
    RAISE EXCEPTION 'Invalid phase HP range'
      USING ERRCODE = 'P0213';
  END IF;

  IF v_element IS NOT NULL
     AND v_element NOT IN ('WATER','FIRE','WIND','EARTH','LIGHT','DARK')
  THEN
    RAISE EXCEPTION 'Unsupported phase boss element'
      USING ERRCODE = 'P0213';
  END IF;

  INSERT INTO public.raid_phases (
    raid_id,
    phase_no,
    hp_from_ratio,
    hp_to_ratio,
    boss_element,
    image_url,
    loop_video_url,
    damage_config,
    metadata,
    updated_at
  )
  VALUES (
    p_raid_id,
    p_phase_no,
    v_from,
    v_to,
    COALESCE(v_element, v_raid.boss_element),
    NULLIF(btrim(COALESCE(p_payload->>'image_url','')), ''),
    NULLIF(btrim(COALESCE(p_payload->>'loop_video_url','')), ''),
    COALESCE(p_payload->'damage_config','{}'::jsonb),
    COALESCE(p_payload->'metadata','{}'::jsonb),
    now()
  )
  ON CONFLICT (raid_id, phase_no)
  DO UPDATE SET
    hp_from_ratio = EXCLUDED.hp_from_ratio,
    hp_to_ratio = EXCLUDED.hp_to_ratio,
    boss_element = EXCLUDED.boss_element,
    image_url = EXCLUDED.image_url,
    loop_video_url = EXCLUDED.loop_video_url,
    damage_config = EXCLUDED.damage_config,
    metadata = EXCLUDED.metadata,
    updated_at = now()
  RETURNING id INTO v_phase_id;

  INSERT INTO public.raid_hit_zones (
    raid_phase_id,
    zone_key,
    name,
    shape,
    x,
    y,
    width,
    height,
    damage_multiplier,
    element_multiplier,
    is_active,
    is_visible_to_student,
    priority
  )
  VALUES (
    v_phase_id,
    'BODY',
    '전체',
    'RECT',
    0,
    0,
    1,
    1,
    1.0000,
    1.0000,
    TRUE,
    FALSE,
    -100
  )
  ON CONFLICT (raid_phase_id, zone_key) DO NOTHING;

  RETURN v_phase_id;
END;
$$;

-- ============================================================================
