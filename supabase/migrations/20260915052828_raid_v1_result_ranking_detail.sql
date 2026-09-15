-- B.R.A.N.D 2.0 RAID V1 — richer result ranking
-- Production migration version: 20260915052828 (already applied).

CREATE OR REPLACE FUNCTION public.get_raid_result(p_raid_id BIGINT)
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
          rp.snapshot_guild_id AS guild_id,
          rp.snapshot_guild_name AS guild_name,
          rp.snapshot_guild_logo_url AS guild_logo_url,
          rp.snapshot_equipped_character_id AS equipped_character_id,
          rp.snapshot_equipped_character_name AS equipped_character_name,
          rp.snapshot_equipped_character_image_url AS equipped_character_image_url,
          rp.total_damage,
          rp.snapshot_owned_shard_count AS owned_shard_count,
          rp.snapshot_raid_power AS raid_power,
          ROUND(rp.snapshot_final_crit_bp::numeric / 100, 2) AS crit_rate,
          ROUND(
            CASE
              WHEN SUM(rp.total_damage) OVER () > 0
                THEN rp.total_damage::numeric / SUM(rp.total_damage) OVER ()::numeric * 100
              ELSE 0
            END,
            2
          ) AS damage_share_percent,
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
        'damage_share_percent',
          ROUND(
            CASE
              WHEN totals.total_damage > 0
                THEN rp.total_damage::numeric / totals.total_damage::numeric * 100
              ELSE 0
            END,
            2
          ),
        'final_rank', rp.final_rank,
        'reward_snapshot', rp.reward_snapshot
      )
      FROM public.raid_participants rp
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(all_rp.total_damage), 0)::bigint AS total_damage
        FROM public.raid_participants all_rp
        WHERE all_rp.raid_id = p_raid_id
      ) totals
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

REVOKE ALL ON FUNCTION public.get_raid_result(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_raid_result(BIGINT)
  TO authenticated, service_role;
