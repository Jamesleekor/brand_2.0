-- B.R.A.N.D 2.0 RAID V1 — recreate/clone an existing Raid as a fresh DRAFT
-- Production migration version: 20260915043710 (already applied).

CREATE OR REPLACE FUNCTION public.teacher_clone_raid(
  p_source_raid_id BIGINT,
  p_new_title TEXT DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_source public.raids%ROWTYPE;
  v_new_raid_id BIGINT;
  v_new_title TEXT;
  v_phase public.raid_phases%ROWTYPE;
  v_new_phase_id BIGINT;
BEGIN
  SELECT *
    INTO v_source
  FROM public.raids
  WHERE id = p_source_raid_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_raid(p_source_raid_id);

  v_new_title := NULLIF(btrim(COALESCE(p_new_title, '')), '');
  IF v_new_title IS NULL THEN
    v_new_title := v_source.title || ' · 재도전';
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
    lobby_open_at,
    starts_at,
    ends_at,
    completed_at,
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
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_source.classroom_id,
    v_new_title,
    v_source.boss_name,
    v_source.boss_description,
    v_source.boss_element,
    'DRAFT',
    v_source.max_hp,
    v_source.max_hp,
    NULL,
    NULL,
    NULL,
    NULL,
    v_source.damage_coefficient,
    v_source.variance_min,
    v_source.variance_max,
    v_source.crit_multiplier,
    v_source.tap_rate_limit_per_second,
    v_source.chat_enabled,
    v_source.chat_slow_mode_seconds,
    v_source.include_test_accounts,
    COALESCE(v_source.reward_config, '{}'::jsonb),
    (COALESCE(v_source.metadata, '{}'::jsonb) - 'end_reason' - 'ended_by')
      || jsonb_build_object(
        'cloned_from_raid_id', v_source.id,
        'cloned_at', now()
      ),
    auth.uid(),
    now(),
    now()
  )
  RETURNING id INTO v_new_raid_id;

  FOR v_phase IN
    SELECT *
    FROM public.raid_phases
    WHERE raid_id = p_source_raid_id
    ORDER BY phase_no
  LOOP
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
      created_at,
      updated_at
    ) VALUES (
      v_new_raid_id,
      v_phase.phase_no,
      v_phase.hp_from_ratio,
      v_phase.hp_to_ratio,
      v_phase.boss_element,
      v_phase.image_url,
      v_phase.loop_video_url,
      COALESCE(v_phase.damage_config, '{}'::jsonb),
      COALESCE(v_phase.metadata, '{}'::jsonb),
      now(),
      now()
    )
    RETURNING id INTO v_new_phase_id;

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
      weak_element,
      element_multiplier,
      is_active,
      is_visible_to_student,
      priority,
      metadata,
      created_at,
      updated_at
    )
    SELECT
      v_new_phase_id,
      hz.zone_key,
      hz.name,
      hz.shape,
      hz.x,
      hz.y,
      hz.width,
      hz.height,
      hz.damage_multiplier,
      hz.weak_element,
      hz.element_multiplier,
      hz.is_active,
      hz.is_visible_to_student,
      hz.priority,
      COALESCE(hz.metadata, '{}'::jsonb),
      now(),
      now()
    FROM public.raid_hit_zones hz
    WHERE hz.raid_phase_id = v_phase.id
    ORDER BY hz.priority DESC, hz.id;
  END LOOP;

  RETURN v_new_raid_id;
END;
$$;

REVOKE ALL ON FUNCTION public.teacher_clone_raid(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_clone_raid(BIGINT, TEXT)
  TO authenticated, service_role;
