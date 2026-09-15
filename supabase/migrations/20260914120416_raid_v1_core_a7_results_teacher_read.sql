-- 8. RESULT RPC
-- ============================================================================

CREATE FUNCTION public.get_raid_result(p_raid_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id INTEGER;
  v_status TEXT;
  v_result JSONB;
BEGIN
  v_student_id := public.raid_current_student_for_raid(p_raid_id);

  SELECT r.status
    INTO v_status
  FROM public.raids r
  WHERE r.id = p_raid_id;

  IF v_status NOT IN ('COMPLETED','FAILED','ARCHIVED') THEN
    RAISE EXCEPTION 'Raid result is not available yet'
      USING ERRCODE = 'P0215';
  END IF;

  SELECT jsonb_build_object(
    'raid', jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'boss_name', r.boss_name,
      'boss_element', r.boss_element,
      'status', r.status,
      'max_hp', r.max_hp,
      'current_hp', r.current_hp,
      'starts_at', r.starts_at,
      'completed_at', r.completed_at
    ),
    'ranking', COALESCE((
      SELECT jsonb_agg(rank_row ORDER BY rank_row.final_rank)
      FROM (
        SELECT
          rp.final_rank,
          rp.student_id,
          rp.snapshot_student_name AS name,
          rp.snapshot_brand_name AS brand_name,
          rp.snapshot_equipped_character_id AS equipped_character_id,
          rp.snapshot_equipped_character_name AS equipped_character_name,
          rp.snapshot_equipped_character_image_url AS equipped_character_image_url,
          rp.total_damage,
          rp.snapshot_owned_shard_count AS owned_shard_count,
          rp.snapshot_raid_power AS raid_power,
          rp.reward_snapshot
        FROM public.raid_participants rp
        WHERE rp.raid_id = p_raid_id
          AND rp.final_rank IS NOT NULL
      ) rank_row
    ), '[]'::jsonb),
    'me', (
      SELECT jsonb_build_object(
        'total_damage', rp.total_damage,
        'average_damage', rp.average_damage,
        'crit_count', rp.crit_count,
        'actual_crit_rate',
          CASE
            WHEN rp.accepted_tap_count > 0
              THEN ROUND(
                rp.crit_count::numeric
                / rp.accepted_tap_count::numeric
                * 100,
                2
              )
            ELSE 0
          END,
        'final_rank', rp.final_rank,
        'reward_snapshot', rp.reward_snapshot
      )
      FROM public.raid_participants rp
      WHERE rp.raid_id = p_raid_id
        AND rp.student_id = v_student_id
    )
  )
  INTO v_result
  FROM public.raids r
  WHERE r.id = p_raid_id;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 9. TEACHER READ / LIVE CONTROL RPC
-- ============================================================================

CREATE FUNCTION public.teacher_get_raid_control_board(p_classroom_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  PERFORM public.raid_teacher_require_classroom(p_classroom_id);

  RETURN jsonb_build_object(
    'raids', COALESCE((
      SELECT jsonb_agg(raid_row ORDER BY raid_row.created_at DESC)
      FROM (
        SELECT
          r.id,
          r.title,
          r.boss_name,
          r.boss_element,
          r.status,
          r.max_hp,
          r.current_hp,
          r.lobby_open_at,
          r.starts_at,
          r.ends_at,
          r.completed_at,
          r.created_at,
          (
            SELECT COUNT(*)::integer
            FROM public.raid_phases rp
            WHERE rp.raid_id = r.id
          ) AS phase_count,
          (
            SELECT COUNT(*)::integer
            FROM public.raid_participants part
            WHERE part.raid_id = r.id
          ) AS participant_count
        FROM public.raids r
        WHERE r.classroom_id = p_classroom_id
      ) raid_row
    ), '[]'::jsonb)
  );
END;
$$;

CREATE FUNCTION public.teacher_get_raid_live_dashboard(p_raid_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
  v_result JSONB;
BEGIN
  v_classroom_id := public.raid_teacher_require_raid(p_raid_id);

  SELECT jsonb_build_object(
    'raid', jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'boss_name', r.boss_name,
      'status', r.status,
      'max_hp', r.max_hp,
      'current_hp', r.current_hp,
      'hp_ratio', CASE WHEN r.max_hp > 0 THEN r.current_hp::numeric / r.max_hp::numeric ELSE 0 END,
      'starts_at', r.starts_at,
      'ends_at', r.ends_at,
      'completed_at', r.completed_at
    ),
    'summary', jsonb_build_object(
      'participant_count', COUNT(part.id),
      'attack_participant_count', COUNT(part.id) FILTER (WHERE part.accepted_tap_count > 0),
      'total_damage', COALESCE(SUM(part.total_damage),0),
      'accepted_taps', COALESCE(SUM(part.accepted_tap_count),0),
      'rejected_taps', COALESCE(SUM(part.rejected_tap_count),0),
      'crit_count', COALESCE(SUM(part.crit_count),0)
    ),
    'students', COALESCE(jsonb_agg(
      jsonb_build_object(
        'student_id', part.student_id,
        'name', part.snapshot_student_name,
        'brand_name', part.snapshot_brand_name,
        'guild_name', part.snapshot_guild_name,
        'raid_power', part.snapshot_raid_power,
        'final_crit_bp', part.snapshot_final_crit_bp,
        'total_damage', part.total_damage,
        'accepted_taps', part.accepted_tap_count,
        'crit_count', part.crit_count,
        'attack_blocked', part.attack_blocked,
        'last_attack_at', part.last_attack_at
      )
      ORDER BY part.total_damage DESC, part.student_id
    ) FILTER (WHERE part.id IS NOT NULL), '[]'::jsonb)
  )
  INTO v_result
  FROM public.raids r
  LEFT JOIN public.raid_participants part
    ON part.raid_id = r.id
  WHERE r.id = p_raid_id
  GROUP BY r.id;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.teacher_set_raid_chat_enabled(
  p_raid_id BIGINT,
  p_enabled BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
BEGIN
  v_classroom_id := public.raid_teacher_require_raid(p_raid_id);

  UPDATE public.raids
     SET chat_enabled = COALESCE(p_enabled,FALSE),
         updated_at = now()
   WHERE id = p_raid_id;
END;
$$;

CREATE FUNCTION public.teacher_delete_raid_lobby_message(
  p_message_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
BEGIN
  SELECT r.classroom_id
    INTO v_classroom_id
  FROM public.raid_lobby_messages m
  JOIN public.raids r
    ON r.id = m.raid_id
  WHERE m.id = p_message_id;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Raid lobby message not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_classroom(v_classroom_id);

  UPDATE public.raid_lobby_messages
     SET is_deleted = TRUE,
         deleted_by = auth.uid(),
         deleted_at = now()
   WHERE id = p_message_id;
END;
$$;

-- ============================================================================
