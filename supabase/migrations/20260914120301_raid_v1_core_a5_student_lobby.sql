-- 6. STUDENT READ / LOBBY RPC
-- ============================================================================

CREATE FUNCTION public.get_active_raid()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
  v_student_id INTEGER;
  v_result JSONB;
BEGIN
  v_student_id := public.current_student_id();
  v_classroom_id := public.current_classroom_id();

  IF v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Student context not found'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'boss_name', r.boss_name,
    'boss_description', r.boss_description,
    'boss_element', r.boss_element,
    'status', r.status,
    'max_hp', r.max_hp,
    'current_hp', r.current_hp,
    'hp_ratio', CASE WHEN r.max_hp > 0 THEN r.current_hp::numeric / r.max_hp::numeric ELSE 0 END,
    'lobby_open_at', r.lobby_open_at,
    'starts_at', r.starts_at,
    'ends_at', r.ends_at,
    'chat_enabled', r.chat_enabled,
    'phase_preview', (
      SELECT jsonb_build_object(
        'phase_no', rp.phase_no,
        'image_url', rp.image_url,
        'loop_video_url', rp.loop_video_url
      )
      FROM public.raid_phases rp
      WHERE rp.raid_id = r.id
      ORDER BY rp.phase_no
      LIMIT 1
    )
  )
  INTO v_result
  FROM public.raids r
  WHERE r.classroom_id = v_classroom_id
    AND r.status IN ('ACTIVE','PAUSED','LOBBY_OPEN')
  ORDER BY
    CASE r.status
      WHEN 'ACTIVE' THEN 1
      WHEN 'PAUSED' THEN 2
      ELSE 3
    END,
    r.created_at DESC
  LIMIT 1;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.get_raid_lobby_snapshot(p_raid_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id INTEGER;
  v_result JSONB;
BEGIN
  v_student_id := public.raid_current_student_for_raid(p_raid_id);

  SELECT jsonb_build_object(
    'raid', jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'boss_name', r.boss_name,
      'boss_description', r.boss_description,
      'boss_element', r.boss_element,
      'status', r.status,
      'max_hp', r.max_hp,
      'current_hp', r.current_hp,
      'chat_enabled', r.chat_enabled,
      'chat_slow_mode_seconds', r.chat_slow_mode_seconds,
      'lobby_open_at', r.lobby_open_at,
      'starts_at', r.starts_at,
      'ends_at', r.ends_at
    ),
    'me', (
      SELECT jsonb_build_object(
        'student_id', s.id,
        'name', s.name,
        'brand_name', s.brand_name,
        'equipped_character_id', sp.equipped_character_id,
        'equipped_character_name', c.name,
        'equipped_character_image_url', COALESCE(
          c.full_image_url,
          c.resource_url,
          c.card_image_url,
          c.avatar_image_url
        ),
        'guild_id', g.id,
        'guild_name', g.name,
        'guild_logo_url', g.logo_url
      )
      FROM public.students s
      LEFT JOIN public.student_character_profiles sp
        ON sp.student_id = s.id
      LEFT JOIN public.characters c
        ON c.id = sp.equipped_character_id
      LEFT JOIN public.guild_members gm
        ON gm.student_id = s.id
       AND gm.left_at IS NULL
      LEFT JOIN public.guilds g
        ON g.id = gm.guild_id
      WHERE s.id = v_student_id
    ),
    'recent_messages', COALESCE((
      SELECT jsonb_agg(msg_row ORDER BY msg_row.created_at)
      FROM (
        SELECT
          m.id,
          m.student_id,
          s.name::text AS student_name,
          s.brand_name::text AS brand_name,
          m.message,
          m.created_at
        FROM public.raid_lobby_messages m
        JOIN public.students s
          ON s.id = m.student_id
        WHERE m.raid_id = p_raid_id
          AND m.is_deleted = FALSE
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT 50
      ) msg_row
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.raids r
  WHERE r.id = p_raid_id
    AND r.status IN ('LOBBY_OPEN','ACTIVE','PAUSED','COMPLETED','FAILED');

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Raid lobby is not available'
      USING ERRCODE = 'P0215';
  END IF;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.send_raid_lobby_message(
  p_raid_id BIGINT,
  p_message TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id INTEGER;
  v_raid public.raids%ROWTYPE;
  v_message TEXT := btrim(COALESCE(p_message,''));
  v_last_message_at TIMESTAMPTZ;
  v_message_id BIGINT;
BEGIN
  v_student_id := public.raid_current_student_for_raid(p_raid_id);

  SELECT *
    INTO v_raid
  FROM public.raids
  WHERE id = p_raid_id;

  IF v_raid.status NOT IN ('LOBBY_OPEN','ACTIVE','PAUSED') THEN
    RAISE EXCEPTION 'Raid chat is closed'
      USING ERRCODE = 'P0215';
  END IF;

  IF NOT v_raid.chat_enabled THEN
    RAISE EXCEPTION 'Raid chat is disabled'
      USING ERRCODE = 'P0215';
  END IF;

  IF char_length(v_message) < 1 OR char_length(v_message) > 60 THEN
    RAISE EXCEPTION 'Raid chat message must be 1 to 60 characters'
      USING ERRCODE = 'P0213';
  END IF;

  SELECT m.created_at
    INTO v_last_message_at
  FROM public.raid_lobby_messages m
  WHERE m.raid_id = p_raid_id
    AND m.student_id = v_student_id
    AND m.is_deleted = FALSE
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  IF v_last_message_at IS NOT NULL
     AND v_raid.chat_slow_mode_seconds > 0
     AND now() < v_last_message_at + make_interval(secs => v_raid.chat_slow_mode_seconds)
  THEN
    RAISE EXCEPTION 'Raid chat slow mode is active'
      USING ERRCODE = 'P0215';
  END IF;

  INSERT INTO public.raid_lobby_messages (
    raid_id,
    student_id,
    message
  )
  VALUES (
    p_raid_id,
    v_student_id,
    v_message
  )
  RETURNING id INTO v_message_id;

  RETURN (
    SELECT jsonb_build_object(
      'id', m.id,
      'student_id', m.student_id,
      'student_name', s.name,
      'brand_name', s.brand_name,
      'message', m.message,
      'created_at', m.created_at
    )
    FROM public.raid_lobby_messages m
    JOIN public.students s
      ON s.id = m.student_id
    WHERE m.id = v_message_id
  );
END;
$$;

-- ============================================================================
