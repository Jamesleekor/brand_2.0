-- 3. INTERNAL GUARDS / HELPERS
-- ============================================================================

CREATE FUNCTION public.raid_teacher_require_classroom(p_classroom_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.ensure_teacher_role();

  IF p_classroom_id IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM public.classrooms c
       WHERE c.id = p_classroom_id
         AND c.is_active = TRUE
     )
     OR NOT public.is_classroom_member(p_classroom_id)
  THEN
    RAISE EXCEPTION 'Raid classroom access denied'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE FUNCTION public.raid_teacher_require_raid(p_raid_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
BEGIN
  SELECT r.classroom_id
    INTO v_classroom_id
  FROM public.raids r
  WHERE r.id = p_raid_id;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_classroom(v_classroom_id);
  RETURN v_classroom_id;
END;
$$;

CREATE FUNCTION public.raid_current_student_for_raid(p_raid_id BIGINT)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id INTEGER;
  v_raid_classroom_id INTEGER;
BEGIN
  v_student_id := public.current_student_id();

  IF v_student_id IS NULL THEN
    RAISE EXCEPTION 'Student context not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT r.classroom_id
    INTO v_raid_classroom_id
  FROM public.raids r
  WHERE r.id = p_raid_id;

  IF v_raid_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.students s
    WHERE s.id = v_student_id
      AND s.classroom_id = v_raid_classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text = 'STUDENT'
  ) THEN
    RAISE EXCEPTION 'Raid student access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_student_id;
END;
$$;

CREATE FUNCTION public.raid_element_power_snapshot(p_student_id INTEGER)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH owned AS (
    SELECT
      c.raid_power::numeric AS raid_power,
      ep.element_budget::numeric AS element_budget,
      ep.primary_element,
      ep.primary_points::numeric AS primary_points,
      ep.secondary_element,
      ep.secondary_points::numeric AS secondary_points
    FROM public.student_characters sc
    JOIN public.characters c
      ON c.id = sc.character_id
    JOIN public.character_element_profiles ep
      ON ep.character_id = c.id
    WHERE sc.student_id = p_student_id
      AND sc.is_owned = TRUE
      AND c.is_active = TRUE
  ),
  parts AS (
    SELECT
      primary_element AS element_code,
      raid_power * primary_points / NULLIF(element_budget, 0) AS power_value
    FROM owned

    UNION ALL

    SELECT
      secondary_element AS element_code,
      raid_power * secondary_points / NULLIF(element_budget, 0) AS power_value
    FROM owned
    WHERE secondary_element IS NOT NULL
      AND secondary_points > 0
  )
  SELECT jsonb_build_object(
    'FIRE',  COALESCE(ROUND(SUM(power_value) FILTER (WHERE element_code='FIRE'), 4), 0),
    'WATER', COALESCE(ROUND(SUM(power_value) FILTER (WHERE element_code='WATER'), 4), 0),
    'WIND',  COALESCE(ROUND(SUM(power_value) FILTER (WHERE element_code='WIND'), 4), 0),
    'EARTH', COALESCE(ROUND(SUM(power_value) FILTER (WHERE element_code='EARTH'), 4), 0),
    'LIGHT', COALESCE(ROUND(SUM(power_value) FILTER (WHERE element_code='LIGHT'), 4), 0),
    'DARK',  COALESCE(ROUND(SUM(power_value) FILTER (WHERE element_code='DARK'), 4), 0)
  )
  FROM parts;
$$;

CREATE FUNCTION public.raid_snapshot_student(
  p_raid_id BIGINT,
  p_student_id INTEGER
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
  v_student_name TEXT;
  v_brand_name TEXT;

  v_owned_count INTEGER := 0;
  v_power BIGINT := 0;
  v_shard_crit BIGINT := 0;
  v_collection_crit INTEGER := 0;
  v_final_crit INTEGER := 0;

  v_equipped_id BIGINT;
  v_equipped_name TEXT;
  v_equipped_image TEXT;

  v_guild_id INTEGER;
  v_guild_name TEXT;
  v_guild_logo TEXT;

  v_participant_id BIGINT;
BEGIN
  SELECT r.classroom_id
    INTO v_classroom_id
  FROM public.raids r
  WHERE r.id = p_raid_id;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  SELECT s.name::text, s.brand_name::text
    INTO v_student_name, v_brand_name
  FROM public.students s
  WHERE s.id = p_student_id
    AND s.classroom_id = v_classroom_id
    AND s.transferred_at IS NULL
    AND s.role::text = 'STUDENT';

  IF v_student_name IS NULL THEN
    RAISE EXCEPTION 'Student is not eligible for this Raid'
      USING ERRCODE = 'P0202';
  END IF;

  SELECT
    COUNT(*)::integer,
    COALESCE(SUM(c.raid_power), 0)::bigint,
    COALESCE(SUM(c.raid_crit_bonus_bp), 0)::bigint
  INTO
    v_owned_count,
    v_power,
    v_shard_crit
  FROM public.student_characters sc
  JOIN public.characters c
    ON c.id = sc.character_id
  WHERE sc.student_id = p_student_id
    AND sc.is_owned = TRUE
    AND c.is_active = TRUE;

  v_collection_crit :=
    ROUND(
      public.collection_buff_value(
        p_student_id,
        'RAID_CRIT_RATE_BONUS_PP'
      ) * 100
    )::integer;

  v_final_crit :=
    LEAST(
      10000::bigint,
      500::bigint + v_shard_crit + v_collection_crit::bigint
    )::integer;

  SELECT
    c.id,
    c.name::text,
    COALESCE(
      c.full_image_url,
      c.resource_url,
      c.card_image_url,
      c.avatar_image_url
    )
  INTO
    v_equipped_id,
    v_equipped_name,
    v_equipped_image
  FROM public.student_character_profiles sp
  JOIN public.characters c
    ON c.id = sp.equipped_character_id
  WHERE sp.student_id = p_student_id
  LIMIT 1;

  SELECT
    g.id,
    g.name::text,
    g.logo_url
  INTO
    v_guild_id,
    v_guild_name,
    v_guild_logo
  FROM public.guild_members gm
  JOIN public.guilds g
    ON g.id = gm.guild_id
  WHERE gm.student_id = p_student_id
    AND gm.left_at IS NULL
    AND g.classroom_id = v_classroom_id
  LIMIT 1;

  INSERT INTO public.raid_participants (
    raid_id,
    student_id,
    snapshot_student_name,
    snapshot_brand_name,
    snapshot_equipped_character_id,
    snapshot_equipped_character_name,
    snapshot_equipped_character_image_url,
    snapshot_guild_id,
    snapshot_guild_name,
    snapshot_guild_logo_url,
    snapshot_owned_shard_count,
    snapshot_raid_power,
    snapshot_base_crit_bp,
    snapshot_shard_crit_bp,
    snapshot_collection_crit_bp,
    snapshot_final_crit_bp,
    snapshot_element_power
  )
  VALUES (
    p_raid_id,
    p_student_id,
    v_student_name,
    v_brand_name,
    v_equipped_id,
    v_equipped_name,
    v_equipped_image,
    v_guild_id,
    v_guild_name,
    v_guild_logo,
    v_owned_count,
    v_power,
    500,
    v_shard_crit,
    v_collection_crit,
    v_final_crit,
    public.raid_element_power_snapshot(p_student_id)
  )
  RETURNING id INTO v_participant_id;

  RETURN v_participant_id;
END;
$$;

CREATE FUNCTION public.raid_finalize_results(p_raid_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  WITH ranked AS (
    SELECT
      rp.id,
      ROW_NUMBER() OVER (
        ORDER BY
          rp.total_damage DESC,
          rp.last_attack_at ASC NULLS LAST,
          rp.student_id ASC
      )::integer AS rank_no
    FROM public.raid_participants rp
    WHERE rp.raid_id = p_raid_id
      AND rp.accepted_tap_count > 0
  )
  UPDATE public.raid_participants rp
     SET final_rank = ranked.rank_no,
         updated_at = now()
    FROM ranked
   WHERE rp.id = ranked.id;

  UPDATE public.raid_participants
     SET final_rank = NULL,
         updated_at = now()
   WHERE raid_id = p_raid_id
     AND accepted_tap_count = 0;
END;
$$;

-- ============================================================================
