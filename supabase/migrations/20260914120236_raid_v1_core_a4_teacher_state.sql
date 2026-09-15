-- 5. TEACHER STATE CONTROL RPC
-- ============================================================================

CREATE FUNCTION public.teacher_open_raid_lobby(p_raid_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raid public.raids%ROWTYPE;
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

  IF v_raid.status = 'LOBBY_OPEN' THEN
    RETURN;
  END IF;

  IF v_raid.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only a draft Raid can open its lobby'
      USING ERRCODE = 'P0215';
  END IF;

  UPDATE public.raids
     SET status = 'LOBBY_OPEN',
         lobby_open_at = COALESCE(lobby_open_at, now()),
         updated_at = now()
   WHERE id = p_raid_id;
END;
$$;

CREATE FUNCTION public.teacher_start_raid(p_raid_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_phase_count INTEGER;
  v_phase_chain_ok BOOLEAN;
  v_media_ok BOOLEAN;
  v_student RECORD;
  v_participant_count INTEGER := 0;
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

  IF v_raid.status <> 'LOBBY_OPEN' THEN
    RAISE EXCEPTION 'Raid lobby must be open before battle starts'
      USING ERRCODE = 'P0215';
  END IF;

  IF v_raid.ends_at IS NOT NULL AND v_raid.ends_at <= now() THEN
    RAISE EXCEPTION 'Raid end time must be in the future'
      USING ERRCODE = 'P0213';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.raid_participants rp
    WHERE rp.raid_id = p_raid_id
  ) THEN
    RAISE EXCEPTION 'Raid participant snapshot already exists'
      USING ERRCODE = 'P0215';
  END IF;

  WITH ordered AS (
    SELECT
      rp.*,
      LAG(rp.hp_to_ratio) OVER (ORDER BY rp.phase_no) AS previous_to
    FROM public.raid_phases rp
    WHERE rp.raid_id = p_raid_id
  )
  SELECT
    COUNT(*)::integer,
    COALESCE(
      BOOL_AND(
        CASE
          WHEN phase_no = 1
            THEN hp_from_ratio = 1
          ELSE hp_from_ratio = previous_to
        END
      )
      AND MIN(phase_no) = 1
      AND MAX(phase_no) = COUNT(*)
      AND MIN(hp_to_ratio) = 0,
      FALSE
    ),
    COALESCE(
      BOOL_AND(image_url IS NOT NULL OR loop_video_url IS NOT NULL),
      FALSE
    )
  INTO
    v_phase_count,
    v_phase_chain_ok,
    v_media_ok
  FROM ordered;

  IF v_phase_count = 0 OR NOT v_phase_chain_ok THEN
    RAISE EXCEPTION 'Raid phase ranges must continuously cover 100%% to 0%%'
      USING ERRCODE = 'P0213';
  END IF;

  IF NOT v_media_ok THEN
    RAISE EXCEPTION 'Every Raid phase needs an image or loop video'
      USING ERRCODE = 'P0213';
  END IF;

  FOR v_student IN
    SELECT s.id
    FROM public.students s
    WHERE s.classroom_id = v_raid.classroom_id
      AND s.transferred_at IS NULL
      AND s.role::text = 'STUDENT'
      AND (v_raid.include_test_accounts OR NOT s.is_test_account)
    ORDER BY s.id
  LOOP
    PERFORM public.raid_snapshot_student(p_raid_id, v_student.id);
    v_participant_count := v_participant_count + 1;
  END LOOP;

  IF v_participant_count = 0 THEN
    RAISE EXCEPTION 'No eligible students for this Raid'
      USING ERRCODE = 'P0213';
  END IF;

  UPDATE public.raids
     SET status = 'ACTIVE',
         current_hp = max_hp,
         starts_at = now(),
         completed_at = NULL,
         updated_at = now()
   WHERE id = p_raid_id;

  RETURN jsonb_build_object(
    'raid_id', p_raid_id,
    'status', 'ACTIVE',
    'participant_count', v_participant_count,
    'max_hp', v_raid.max_hp
  );
END;
$$;

CREATE FUNCTION public.teacher_pause_raid(p_raid_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
  v_status TEXT;
BEGIN
  SELECT classroom_id, status
    INTO v_classroom_id, v_status
  FROM public.raids
  WHERE id = p_raid_id
  FOR UPDATE;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_classroom(v_classroom_id);

  IF v_status = 'PAUSED' THEN
    RETURN;
  END IF;

  IF v_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Only an active Raid can be paused'
      USING ERRCODE = 'P0215';
  END IF;

  UPDATE public.raids
     SET status = 'PAUSED',
         updated_at = now()
   WHERE id = p_raid_id;
END;
$$;

CREATE FUNCTION public.teacher_resume_raid(p_raid_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_classroom_id INTEGER;
  v_status TEXT;
BEGIN
  SELECT classroom_id, status
    INTO v_classroom_id, v_status
  FROM public.raids
  WHERE id = p_raid_id
  FOR UPDATE;

  IF v_classroom_id IS NULL THEN
    RAISE EXCEPTION 'Raid not found'
      USING ERRCODE = 'P0202';
  END IF;

  PERFORM public.raid_teacher_require_classroom(v_classroom_id);

  IF v_status = 'ACTIVE' THEN
    RETURN;
  END IF;

  IF v_status <> 'PAUSED' THEN
    RAISE EXCEPTION 'Only a paused Raid can resume'
      USING ERRCODE = 'P0215';
  END IF;

  UPDATE public.raids
     SET status = 'ACTIVE',
         updated_at = now()
   WHERE id = p_raid_id;
END;
$$;

CREATE FUNCTION public.teacher_end_raid(
  p_raid_id BIGINT,
  p_reason TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_raid public.raids%ROWTYPE;
  v_final_status TEXT;
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

  IF v_raid.status IN ('COMPLETED','FAILED') THEN
    RETURN v_raid.status;
  END IF;

  IF v_raid.status NOT IN ('ACTIVE','PAUSED') THEN
    RAISE EXCEPTION 'Only an active or paused Raid can end'
      USING ERRCODE = 'P0215';
  END IF;

  v_final_status :=
    CASE WHEN v_raid.current_hp = 0 THEN 'COMPLETED' ELSE 'FAILED' END;

  UPDATE public.raids
     SET status = v_final_status,
         completed_at = now(),
         metadata = metadata || jsonb_build_object(
           'end_reason', NULLIF(btrim(COALESCE(p_reason,'')), ''),
           'ended_by', auth.uid()
         ),
         updated_at = now()
   WHERE id = p_raid_id;

  PERFORM public.raid_finalize_results(p_raid_id);

  RETURN v_final_status;
END;
$$;

-- ============================================================================
