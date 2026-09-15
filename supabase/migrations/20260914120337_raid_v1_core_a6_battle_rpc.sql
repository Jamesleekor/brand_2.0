-- 7. BATTLE STATE / BATCHED ATTACK RPC
-- ============================================================================

CREATE FUNCTION public.get_raid_battle_state(p_raid_id BIGINT)
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
    AND r.status IN ('ACTIVE','PAUSED','COMPLETED','FAILED');

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Raid battle state is not available'
      USING ERRCODE = 'P0215';
  END IF;

  RETURN v_result;
END;
$$;

CREATE FUNCTION public.submit_raid_tap_batch(
  p_raid_id BIGINT,
  p_batch_id UUID,
  p_taps JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_student_id INTEGER;
  v_participant public.raid_participants%ROWTYPE;
  v_existing JSONB;
  v_raid public.raids%ROWTYPE;
  v_phase public.raid_phases%ROWTYPE;

  v_requested INTEGER;
  v_recent_accepted INTEGER := 0;
  v_rate_available INTEGER := 0;

  v_tap JSONB;
  v_x NUMERIC;
  v_y NUMERIC;

  v_zone_key TEXT;
  v_zone_multiplier NUMERIC := 1;

  v_roll NUMERIC;
  v_damage BIGINT;
  v_effective_damage BIGINT;
  v_is_crit BOOLEAN;

  v_accepted INTEGER := 0;
  v_rejected INTEGER := 0;
  v_crit_count INTEGER := 0;
  v_batch_damage BIGINT := 0;

  v_min_damage BIGINT;
  v_max_damage BIGINT := 0;

  v_hp_before BIGINT;
  v_hp_working BIGINT;

  v_results JSONB := '[]'::jsonb;
  v_result JSONB;

  v_my_total BIGINT;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Batch id is required'
      USING ERRCODE = 'P0213';
  END IF;

  IF jsonb_typeof(p_taps) <> 'array' THEN
    RAISE EXCEPTION 'Tap payload must be an array'
      USING ERRCODE = 'P0213';
  END IF;

  v_requested := jsonb_array_length(p_taps);

  IF v_requested < 1 OR v_requested > 25 THEN
    RAISE EXCEPTION 'Tap batch size must be between 1 and 25'
      USING ERRCODE = 'P0213';
  END IF;

  v_student_id := public.raid_current_student_for_raid(p_raid_id);

  SELECT *
    INTO v_participant
  FROM public.raid_participants rp
  WHERE rp.raid_id = p_raid_id
    AND rp.student_id = v_student_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raid participant snapshot not found'
      USING ERRCODE = 'P0202';
  END IF;

  SELECT rab.result_payload
    INTO v_existing
  FROM public.raid_attack_batches rab
  WHERE rab.participant_id = v_participant.id
    AND rab.client_batch_id = p_batch_id;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT *
    INTO v_raid
  FROM public.raids r
  WHERE r.id = p_raid_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  -- Re-check idempotency after obtaining the raid lock.
  SELECT rab.result_payload
    INTO v_existing
  FROM public.raid_attack_batches rab
  WHERE rab.participant_id = v_participant.id
    AND rab.client_batch_id = p_batch_id;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF v_raid.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Raid is not accepting attacks'
      USING ERRCODE = 'P0215';
  END IF;

  SELECT *
    INTO v_participant
  FROM public.raid_participants rp
  WHERE rp.id = v_participant.id
  FOR UPDATE;

  v_now := clock_timestamp();

  IF v_participant.attack_blocked THEN
    RAISE EXCEPTION 'Raid attacks are blocked for this participant'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(SUM(rab.accepted_taps), 0)::integer
    INTO v_recent_accepted
  FROM public.raid_attack_batches rab
  WHERE rab.participant_id = v_participant.id
    AND rab.created_at > v_now - interval '1 second';

  v_rate_available :=
    GREATEST(0, v_raid.tap_rate_limit_per_second - v_recent_accepted);

  v_hp_before := v_raid.current_hp;
  v_hp_working := v_raid.current_hp;

  SELECT rp.*
    INTO v_phase
  FROM public.raid_phases rp
  WHERE rp.raid_id = p_raid_id
    AND (
      v_raid.current_hp::numeric / v_raid.max_hp::numeric
    ) <= rp.hp_from_ratio
    AND (
      (
        v_raid.current_hp::numeric / v_raid.max_hp::numeric
      ) > rp.hp_to_ratio
      OR (
        v_raid.current_hp = 0
        AND rp.hp_to_ratio = 0
      )
    )
  ORDER BY rp.phase_no
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current Raid phase could not be resolved'
      USING ERRCODE = 'P0215';
  END IF;

  FOR v_tap IN
    SELECT value
    FROM jsonb_array_elements(p_taps)
  LOOP
    IF v_hp_working <= 0 THEN
      v_rejected := v_rejected + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'accepted', FALSE,
          'reason', 'RAID_COMPLETED'
        )
      );
      CONTINUE;
    END IF;

    IF v_accepted >= v_rate_available THEN
      v_rejected := v_rejected + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'accepted', FALSE,
          'reason', 'RATE_LIMIT'
        )
      );
      CONTINUE;
    END IF;

    BEGIN
      IF jsonb_typeof(v_tap) <> 'object' THEN
        RAISE EXCEPTION 'invalid tap';
      END IF;

      v_x := (v_tap->>'x')::numeric;
      v_y := (v_tap->>'y')::numeric;
    EXCEPTION WHEN OTHERS THEN
      v_rejected := v_rejected + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'accepted', FALSE,
          'reason', 'INVALID_COORDINATE'
        )
      );
      CONTINUE;
    END;

    IF v_x IS NULL OR v_y IS NULL
       OR v_x < 0 OR v_x > 1
       OR v_y < 0 OR v_y > 1
    THEN
      v_rejected := v_rejected + 1;
      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'accepted', FALSE,
          'reason', 'INVALID_COORDINATE'
        )
      );
      CONTINUE;
    END IF;

    v_zone_key := 'BODY';
    v_zone_multiplier := 1.0000;

    SELECT
      hz.zone_key,
      hz.damage_multiplier
    INTO
      v_zone_key,
      v_zone_multiplier
    FROM public.raid_hit_zones hz
    WHERE hz.raid_phase_id = v_phase.id
      AND hz.is_active = TRUE
      AND v_x >= hz.x
      AND v_x <= hz.x + hz.width
      AND v_y >= hz.y
      AND v_y <= hz.y + hz.height
    ORDER BY hz.priority DESC, hz.id
    LIMIT 1;

    IF v_zone_key IS NULL THEN
      v_zone_key := 'BODY';
      v_zone_multiplier := 1.0000;
    END IF;

    v_roll :=
      v_raid.variance_min
      + random() * (v_raid.variance_max - v_raid.variance_min);

    v_is_crit :=
      floor(random() * 10000)::integer
      < v_participant.snapshot_final_crit_bp;

    v_damage :=
      GREATEST(
        1::bigint,
        ROUND(
          v_participant.snapshot_raid_power::numeric
          * v_raid.damage_coefficient
          * v_roll
          * v_zone_multiplier
          * CASE WHEN v_is_crit THEN v_raid.crit_multiplier ELSE 1 END
        )::bigint
      );

    v_effective_damage := LEAST(v_damage, v_hp_working);

    v_hp_working := v_hp_working - v_effective_damage;
    v_batch_damage := v_batch_damage + v_effective_damage;
    v_accepted := v_accepted + 1;

    IF v_is_crit THEN
      v_crit_count := v_crit_count + 1;
    END IF;

    IF v_min_damage IS NULL OR v_effective_damage < v_min_damage THEN
      v_min_damage := v_effective_damage;
    END IF;

    IF v_effective_damage > v_max_damage THEN
      v_max_damage := v_effective_damage;
    END IF;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'accepted', TRUE,
        'damage', v_effective_damage,
        'crit', v_is_crit,
        'x', v_x,
        'y', v_y,
        'zone_key', v_zone_key
      )
    );
  END LOOP;

  -- All requested taps must be accounted for.
  IF v_accepted + v_rejected < v_requested THEN
    v_rejected := v_requested - v_accepted;
  END IF;

  v_my_total := v_participant.total_damage + v_batch_damage;

  UPDATE public.raid_participants
     SET accepted_tap_count = accepted_tap_count + v_accepted,
         rejected_tap_count = rejected_tap_count + v_rejected,
         crit_count = crit_count + v_crit_count,
         total_damage = total_damage + v_batch_damage,
         first_attack_at = CASE
           WHEN v_accepted > 0 THEN COALESCE(first_attack_at, v_now)
           ELSE first_attack_at
         END,
         last_attack_at = CASE
           WHEN v_accepted > 0 THEN v_now
           ELSE last_attack_at
         END,
         updated_at = now()
   WHERE id = v_participant.id;

  UPDATE public.raids
     SET current_hp = v_hp_working,
         status = CASE
           WHEN v_hp_working = 0 THEN 'COMPLETED'
           ELSE status
         END,
         completed_at = CASE
           WHEN v_hp_working = 0 THEN COALESCE(completed_at, now())
           ELSE completed_at
         END,
         updated_at = now()
   WHERE id = p_raid_id;

  v_result := jsonb_build_object(
    'raid_id', p_raid_id,
    'batch_id', p_batch_id,
    'requested', v_requested,
    'accepted', v_accepted,
    'rejected', v_rejected,
    'results', v_results,
    'raid_hp', v_hp_working,
    'raid_hp_ratio',
      CASE
        WHEN v_raid.max_hp > 0
          THEN v_hp_working::numeric / v_raid.max_hp::numeric
        ELSE 0
      END,
    'my_total_damage', v_my_total,
    'raid_status', CASE
      WHEN v_hp_working = 0 THEN 'COMPLETED'
      ELSE 'ACTIVE'
    END
  );

  INSERT INTO public.raid_attack_batches (
    raid_id,
    participant_id,
    client_batch_id,
    requested_taps,
    accepted_taps,
    rejected_taps,
    total_damage,
    crit_count,
    zone_summary,
    damage_summary,
    result_payload,
    raid_hp_before,
    raid_hp_after,
    created_at
  )
  VALUES (
    p_raid_id,
    v_participant.id,
    p_batch_id,
    v_requested,
    v_accepted,
    v_rejected,
    v_batch_damage,
    v_crit_count,
    jsonb_build_object(
      'phase_no', v_phase.phase_no,
      'default_zone', 'BODY'
    ),
    jsonb_build_object(
      'min', COALESCE(v_min_damage,0),
      'max', COALESCE(v_max_damage,0),
      'avg', CASE
        WHEN v_accepted > 0
          THEN ROUND(v_batch_damage::numeric / v_accepted::numeric, 4)
        ELSE 0
      END
    ),
    v_result,
    v_hp_before,
    v_hp_working,
    v_now
  );

  IF v_hp_working = 0 THEN
    PERFORM public.raid_finalize_results(p_raid_id);
  END IF;

  RETURN v_result;
END;
$$;

-- ============================================================================
