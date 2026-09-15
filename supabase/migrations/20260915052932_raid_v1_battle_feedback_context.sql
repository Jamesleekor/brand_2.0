-- B.R.A.N.D 2.0 RAID V1 — battle feedback context
-- Production migration version: 20260915052932 (already applied).

CREATE OR REPLACE FUNCTION public.get_raid_battle_state(p_raid_id BIGINT)
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
      'boss_element', COALESCE(phase.boss_element, r.boss_element),
      'status', r.status,
      'max_hp', r.max_hp,
      'current_hp', r.current_hp,
      'hp_ratio', CASE WHEN r.max_hp > 0 THEN r.current_hp::numeric / r.max_hp::numeric ELSE 0 END,
      'damage_coefficient', r.damage_coefficient,
      'crit_multiplier', r.crit_multiplier,
      'phase', CASE
        WHEN phase.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', phase.id,
          'phase_no', phase.phase_no,
          'image_url', phase.image_url,
          'loop_video_url', phase.loop_video_url
        )
      END
    ),
    'me', jsonb_build_object(
      'participant_id', part.id,
      'raid_power', part.snapshot_raid_power,
      'base_crit_bp', part.snapshot_base_crit_bp,
      'shard_crit_bp', part.snapshot_shard_crit_bp,
      'collection_crit_bp', part.snapshot_collection_crit_bp,
      'final_crit_bp', part.snapshot_final_crit_bp,
      'total_damage', part.total_damage,
      'accepted_tap_count', part.accepted_tap_count,
      'crit_count', part.crit_count,
      'attack_blocked', part.attack_blocked
    )
  )
  INTO v_result
  FROM public.raids r
  JOIN public.raid_participants part
    ON part.raid_id = r.id
   AND part.student_id = v_student_id
  LEFT JOIN LATERAL (
    SELECT rp.*
    FROM public.raid_phases rp
    WHERE rp.raid_id = r.id
      AND (
        CASE WHEN r.max_hp > 0
          THEN r.current_hp::numeric / r.max_hp::numeric
          ELSE 0
        END
      ) <= rp.hp_from_ratio
      AND (
        (
          CASE WHEN r.max_hp > 0
            THEN r.current_hp::numeric / r.max_hp::numeric
            ELSE 0
          END
        ) > rp.hp_to_ratio
        OR (
          r.current_hp = 0
          AND rp.hp_to_ratio = 0
        )
      )
    ORDER BY rp.phase_no
    LIMIT 1
  ) phase ON TRUE
  WHERE r.id = p_raid_id
    AND r.status IN ('ACTIVE','PAUSED','COMPLETED','FAILED','ARCHIVED');

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Raid battle state is not available'
      USING ERRCODE = 'P0215';
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_raid_battle_state(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raid_battle_state(BIGINT)
  TO authenticated, service_role;
