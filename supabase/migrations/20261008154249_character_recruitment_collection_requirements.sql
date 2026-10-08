-- Character recruitment: selected shards, owned count/value, completed collections.
-- Based on live production signatures and ACLs inspected 2026-10-08 UTC.
-- This migration does not configure any policy or modify ownership/assets/history.
-- Prerequisite IDs use existing metadata; no new public API.

CREATE OR REPLACE FUNCTION public.character_requirement_met(p_student_id integer, p_requirement_id bigint)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_req public.character_requirements%ROWTYPE;
  v_count bigint := 0;
  v_bv bigint := 0;
  v_tier_level integer := 0;
  v_classroom_id integer;
  v_required_ids jsonb;
  v_required_id bigint;
  v_item jsonb;
BEGIN
  SELECT * INTO v_req FROM public.character_requirements r
  WHERE r.id=p_requirement_id AND r.is_active=TRUE
    AND EXISTS (
      SELECT 1 FROM public.character_requirement_groups g
      JOIN public.character_recruitment_policies p ON p.id=g.policy_id
      JOIN public.students s ON s.id=p_student_id AND s.classroom_id=p.classroom_id
      WHERE g.id=r.group_id
    );
  IF v_req.id IS NULL OR v_req.required_numeric IS NULL OR v_req.required_numeric<1 THEN RETURN FALSE; END IF;
  SELECT s.classroom_id INTO v_classroom_id FROM public.students s WHERE s.id=p_student_id;

  IF v_req.requirement_type='OWNED_CHARACTERS' THEN
    v_required_ids := v_req.metadata->'required_character_ids';
    IF jsonb_typeof(v_required_ids) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    IF jsonb_array_length(v_required_ids)=0 THEN RETURN FALSE; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_required_ids)
    LOOP
      IF jsonb_typeof(v_item)<>'number' OR (v_item #>> '{}') !~ '^[1-9][0-9]*$' THEN RETURN FALSE; END IF;
      BEGIN
        v_required_id := (v_item #>> '{}')::bigint;
      EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN FALSE;
      END;
      IF NOT EXISTS (
        SELECT 1 FROM public.student_characters sc
        WHERE sc.student_id=p_student_id AND sc.classroom_id=v_classroom_id
          AND sc.character_id=v_required_id AND sc.is_owned=TRUE
      ) THEN RETURN FALSE; END IF;
    END LOOP;
    RETURN TRUE;
  ELSIF v_req.requirement_type='OWNED_CHARACTER_COUNT' THEN
    SELECT count(*) INTO v_count FROM public.student_characters sc
    WHERE sc.student_id=p_student_id AND sc.classroom_id=v_classroom_id AND sc.is_owned=TRUE;
    RETURN v_count >= v_req.required_numeric;
  ELSIF v_req.requirement_type='OWNED_CHARACTER_VALUE' THEN
    -- Same valuation as collection ranking: base prices, not discounted/paid prices.
    SELECT COALESCE(sum(CASE WHEN o.acquisition_mode='CRYSTAL'
      THEN COALESCE(o.base_price_crystal,0) ELSE 0 END),0) INTO v_count
    FROM public.student_characters sc
    LEFT JOIN public.character_recruitment_offers o ON o.classroom_id=v_classroom_id AND o.character_id=sc.character_id
    WHERE sc.student_id=p_student_id AND sc.classroom_id=v_classroom_id AND sc.is_owned=TRUE;
    RETURN v_count >= v_req.required_numeric;
  ELSIF v_req.requirement_type='COMPLETED_COLLECTION_COUNT' THEN
    SELECT count(*) INTO v_count FROM public.character_collections cc
    WHERE cc.classroom_id=v_classroom_id AND cc.is_active=TRUE AND cc.is_visible=TRUE
      AND public.character_collection_is_complete(p_student_id,cc.id);
    RETURN v_count >= v_req.required_numeric;
  ELSIF v_req.requirement_type='ACHIEVEMENT_COUNT' THEN
    SELECT count(*) INTO v_count FROM public.student_achievements sa
    WHERE sa.student_id=p_student_id AND sa.is_revoked=FALSE;
    RETURN v_count >= COALESCE(v_req.required_numeric,0);
  ELSIF v_req.requirement_type='ACHIEVEMENT_GRADE_COUNT' THEN
    SELECT count(*) INTO v_count FROM public.student_achievements sa
    JOIN public.achievements a ON a.id=sa.achievement_id
    WHERE sa.student_id=p_student_id AND sa.is_revoked=FALSE AND a.grade::text=v_req.achievement_grade;
    RETURN v_count >= COALESCE(v_req.required_numeric,0);
  ELSIF v_req.requirement_type='TIER_AT_LEAST' THEN
    SELECT COALESCE(w.bv,0) INTO v_bv FROM public.wallets w WHERE w.student_id=p_student_id;
    v_tier_level := public.character_tier_level_from_name(public.calculate_tier_from_bv(COALESCE(v_bv,0)));
    RETURN v_tier_level >= COALESCE(v_req.required_numeric,0);
  END IF;
  RETURN FALSE;
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_set_character_recruitment_policy(p_classroom_id integer, p_character_id bigint, p_status text, p_is_recruitable boolean, p_requirement_mode text, p_source_condition_text text DEFAULT NULL::text, p_groups jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_policy_id bigint;
  v_status text := upper(btrim(coalesce(p_status,'DRAFT')));
  v_mode text := upper(btrim(coalesce(p_requirement_mode,'NONE')));
  v_group jsonb;
  v_req jsonb;
  v_group_no integer;
  v_group_id bigint;
  v_req_type text;
  v_grade text;
  v_numeric bigint;
  v_req_order integer;
  v_required_ids jsonb;
  v_required_id bigint;
  v_selected_ids bigint[];
  v_item jsonb;
BEGIN
  PERFORM public.character_teacher_require_classroom(p_classroom_id);

  IF NOT EXISTS (SELECT 1 FROM public.characters c WHERE c.id=p_character_id) THEN
    RAISE EXCEPTION 'Character not found' USING ERRCODE='P0202';
  END IF;
  IF v_status NOT IN ('DRAFT','ACTIVE','INACTIVE') THEN
    RAISE EXCEPTION 'Invalid policy status' USING ERRCODE='P0216';
  END IF;
  IF v_mode NOT IN ('NONE','GROUPS') THEN
    RAISE EXCEPTION 'Invalid requirement mode' USING ERRCODE='P0217';
  END IF;
  IF v_status='ACTIVE' AND COALESCE(p_is_recruitable,false)=false THEN
    RAISE EXCEPTION 'ACTIVE policy must be recruitable' USING ERRCODE='P0218';
  END IF;
  IF p_groups IS NULL OR jsonb_typeof(p_groups)<>'array' THEN
    RAISE EXCEPTION 'p_groups must be a JSON array' USING ERRCODE='P0219';
  END IF;
  IF v_mode='NONE' AND jsonb_array_length(p_groups)>0 THEN
    RAISE EXCEPTION 'NONE policy cannot contain requirement groups' USING ERRCODE='P0220';
  END IF;
  IF v_mode='GROUPS' AND jsonb_array_length(p_groups)=0 THEN
    RAISE EXCEPTION 'GROUPS policy requires at least one group' USING ERRCODE='P0221';
  END IF;

  INSERT INTO public.character_recruitment_policies(
    classroom_id,character_id,status,is_recruitable,requirement_mode,
    source_condition_text,is_source_baseline,notes
  ) VALUES (
    p_classroom_id,p_character_id,v_status,COALESCE(p_is_recruitable,false),v_mode,
    NULLIF(btrim(p_source_condition_text),''),false,NULLIF(btrim(p_notes),'')
  )
  ON CONFLICT(classroom_id,character_id) DO UPDATE
  SET status=EXCLUDED.status,
      is_recruitable=EXCLUDED.is_recruitable,
      requirement_mode=EXCLUDED.requirement_mode,
      source_condition_text=EXCLUDED.source_condition_text,
      is_source_baseline=false,
      notes=EXCLUDED.notes,
      updated_at=now()
  RETURNING id INTO v_policy_id;

  -- Preserve old configuration as inactive history.
  UPDATE public.character_requirements r
  SET is_active=false,updated_at=now()
  FROM public.character_requirement_groups g
  WHERE r.group_id=g.id AND g.policy_id=v_policy_id AND r.is_active=true;

  UPDATE public.character_requirement_groups
  SET is_active=false,updated_at=now()
  WHERE policy_id=v_policy_id AND is_active=true;

  IF v_mode='GROUPS' THEN
    v_group_no := 0;
    FOR v_group IN SELECT value FROM jsonb_array_elements(p_groups)
    LOOP
      v_group_no := v_group_no + 1;
      IF jsonb_typeof(coalesce(v_group->'requirements','[]'::jsonb)) <> 'array'
         OR jsonb_array_length(coalesce(v_group->'requirements','[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Every group requires at least one condition' USING ERRCODE='P0222';
      END IF;

      INSERT INTO public.character_requirement_groups(policy_id,group_no,label,is_active)
      VALUES(v_policy_id,v_group_no,NULLIF(btrim(v_group->>'label'),''),true)
      ON CONFLICT(policy_id,group_no) DO UPDATE
      SET label=EXCLUDED.label,is_active=true,updated_at=now()
      RETURNING id INTO v_group_id;

      v_req_order := 0;
      FOR v_req IN SELECT value FROM jsonb_array_elements(v_group->'requirements')
      LOOP
        v_req_order := v_req_order + 1;
        v_req_type := upper(btrim(coalesce(v_req->>'type','')));
        v_grade := NULLIF(btrim(v_req->>'grade'),'');
        BEGIN
          v_numeric := NULLIF(v_req->>'required_numeric','')::bigint;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
          RAISE EXCEPTION 'required_numeric must be an integer' USING ERRCODE='P0223';
        END;

        IF v_req_type NOT IN ('ACHIEVEMENT_COUNT','ACHIEVEMENT_GRADE_COUNT','TIER_AT_LEAST',
          'OWNED_CHARACTERS','OWNED_CHARACTER_COUNT','OWNED_CHARACTER_VALUE','COMPLETED_COLLECTION_COUNT') THEN
          RAISE EXCEPTION 'Unsupported requirement type: %',v_req_type USING ERRCODE='P0224';
        END IF;
        IF v_numeric IS NULL OR v_numeric < 1 OR v_numeric > 9007199254740991 THEN
          RAISE EXCEPTION 'Requirement value must be at least 1' USING ERRCODE='P0225';
        END IF;
        IF v_req_type='ACHIEVEMENT_GRADE_COUNT'
           AND coalesce(v_grade,'') NOT IN ('희귀','유니크','에픽','히든','유일','초월') THEN
          RAISE EXCEPTION 'Achievement grade is required' USING ERRCODE='P0226';
        END IF;
        IF v_req_type<>'ACHIEVEMENT_GRADE_COUNT' THEN
          v_grade := NULL;
        END IF;
        IF v_req_type='TIER_AT_LEAST' AND (v_numeric < 1 OR v_numeric > 22) THEN
          RAISE EXCEPTION 'Tier level must be between 1 and 22' USING ERRCODE='P0227';
        END IF;

        v_required_ids := '[]'::jsonb;
        IF v_req_type='OWNED_CHARACTERS' THEN
          v_required_ids := v_req->'required_character_ids';
          IF jsonb_typeof(v_required_ids) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION '필요한 편린을 하나 이상 선택해주세요.' USING ERRCODE='P0228';
          END IF;
          IF jsonb_array_length(v_required_ids) NOT BETWEEN 1 AND 200 THEN
            RAISE EXCEPTION '보유 조건 편린은 1~200개 선택할 수 있습니다.' USING ERRCODE='P0228';
          END IF;
          IF v_numeric<>1 THEN
            RAISE EXCEPTION '선택한 편린은 모두 보유해야 합니다.' USING ERRCODE='P0228';
          END IF;
          v_selected_ids := ARRAY[]::bigint[];
          FOR v_item IN SELECT value FROM jsonb_array_elements(v_required_ids)
          LOOP
            IF jsonb_typeof(v_item)<>'number' OR (v_item #>> '{}') !~ '^[1-9][0-9]*$' THEN
              RAISE EXCEPTION '편린 선택값이 올바르지 않습니다.' USING ERRCODE='P0229';
            END IF;
            BEGIN
              v_required_id := (v_item #>> '{}')::bigint;
            EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
              RAISE EXCEPTION '편린 선택값이 올바르지 않습니다.' USING ERRCODE='P0229';
            END;
            IF v_required_id > 9007199254740991 OR v_required_id=ANY(v_selected_ids) THEN
              RAISE EXCEPTION '편린 선택값이 잘못되었거나 중복되었습니다.' USING ERRCODE='P0229';
            END IF;
            IF v_required_id=p_character_id THEN
              RAISE EXCEPTION '영입할 편린 자신을 보유 조건으로 지정할 수 없습니다.' USING ERRCODE='P0230';
            END IF;
            -- Retain already-configured inactive references, but forbid new inactive selections.
            IF NOT EXISTS (
              SELECT 1 FROM public.characters c WHERE c.id=v_required_id
                AND (c.is_active OR EXISTS (
                  SELECT 1 FROM public.character_requirements old_r
                  JOIN public.character_requirement_groups old_g ON old_g.id=old_r.group_id
                  WHERE old_g.policy_id=v_policy_id AND old_r.requirement_type='OWNED_CHARACTERS'
                    AND old_r.metadata->'required_character_ids' @> jsonb_build_array(v_required_id)
                ))
            ) THEN
              RAISE EXCEPTION '선택한 편린을 찾을 수 없거나 비활성 상태입니다.' USING ERRCODE='P0231';
            END IF;
            v_selected_ids := array_append(v_selected_ids,v_required_id);
          END LOOP;
          v_required_ids := to_jsonb(v_selected_ids);
        END IF;

        INSERT INTO public.character_requirements(
          group_id,requirement_type,achievement_grade,required_numeric,
          required_text,sort_order,is_active,metadata
        ) VALUES(
          v_group_id,v_req_type,v_grade,v_numeric,NULL,v_req_order,true,
          jsonb_build_object('configured_via','C3_TEACHER_UI','configured_by',auth.uid(),
            'required_character_ids',v_required_ids)
        );
      END LOOP;
    END LOOP;
  END IF;

  RETURN v_policy_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.teacher_get_character_admin_board(p_classroom_id integer, p_event_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_limit integer := greatest(1,least(coalesce(p_event_limit,100),300));
BEGIN
  PERFORM public.character_teacher_require_classroom(p_classroom_id);

  RETURN jsonb_build_object(
    'characters', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',c.id,
          'character_uid',c.character_uid,
          'name',c.name,
          'epithet',c.epithet,
          'description',c.description,
          'resource_kind',c.resource_kind,
          'resource_url',c.resource_url,
          'emoji',c.emoji,
          'full_image_url',c.full_image_url,
          'card_image_url',c.card_image_url,
          'avatar_image_url',c.avatar_image_url,
          'is_active',c.is_active,
          'sort_order',c.sort_order,
          'policy', CASE WHEN p.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id',p.id,
            'status',p.status,
            'is_recruitable',p.is_recruitable,
            'requirement_mode',p.requirement_mode,
            'source_condition_text',p.source_condition_text,
            'is_source_baseline',p.is_source_baseline,
            'notes',p.notes,
            'groups',COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id',g.id,
                  'group_no',g.group_no,
                  'label',g.label,
                  'requirements',COALESCE((
                    SELECT jsonb_agg(
                      jsonb_build_object(
                        'id',r.id,
                        'requirement_type',r.requirement_type,
                        'achievement_grade',r.achievement_grade,
                        'required_numeric',r.required_numeric,
                        'required_character_ids',COALESCE(r.metadata->'required_character_ids','[]'::jsonb),
                        'sort_order',r.sort_order
                      ) ORDER BY r.sort_order,r.id
                    )
                    FROM public.character_requirements r
                    WHERE r.group_id=g.id AND r.is_active=true
                  ),'[]'::jsonb)
                ) ORDER BY g.group_no
              )
              FROM public.character_requirement_groups g
              WHERE g.policy_id=p.id AND g.is_active=true
            ),'[]'::jsonb)
          ) END,
          'eligible_students', CASE WHEN p.id IS NULL THEN 0 ELSE (
            SELECT count(*)
            FROM public.students s
            WHERE s.classroom_id=p_classroom_id
              AND s.transferred_at IS NULL
              AND s.role::text='STUDENT'
              AND public.character_policy_requirements_met(s.id,p.id)
          ) END,
          'total_students',(
            SELECT count(*) FROM public.students s
            WHERE s.classroom_id=p_classroom_id
              AND s.transferred_at IS NULL
              AND s.role::text='STUDENT'
          ),
          'owned_students',(
            SELECT count(*)
            FROM public.student_characters sc
            JOIN public.students s ON s.id=sc.student_id
            WHERE sc.character_id=c.id AND sc.is_owned=true
              AND s.classroom_id=p_classroom_id AND s.transferred_at IS NULL
          ),
          'equipped_students',(
            SELECT count(*)
            FROM public.student_character_profiles sp
            JOIN public.students s ON s.id=sp.student_id
            WHERE sp.equipped_character_id=c.id
              AND s.classroom_id=p_classroom_id AND s.transferred_at IS NULL
          )
        ) ORDER BY c.sort_order,c.character_uid
      )
      FROM public.characters c
      LEFT JOIN public.character_recruitment_policies p
        ON p.character_id=c.id AND p.classroom_id=p_classroom_id
    ),'[]'::jsonb),

    'students', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',s.id,
          'name',s.name,
          'brand_name',s.brand_name,
          'equipped_character_id',sp.equipped_character_id,
          'owned_character_ids',COALESCE((
            SELECT jsonb_agg(sc.character_id ORDER BY sc.character_id)
            FROM public.student_characters sc
            WHERE sc.student_id=s.id AND sc.is_owned=true
          ),'[]'::jsonb),
          'owned_count',(
            SELECT count(*) FROM public.student_characters sc
            WHERE sc.student_id=s.id AND sc.is_owned=true
          )
        ) ORDER BY s.name
      )
      FROM public.students s
      LEFT JOIN public.student_character_profiles sp ON sp.student_id=s.id
      WHERE s.classroom_id=p_classroom_id
        AND s.transferred_at IS NULL
        AND s.role::text='STUDENT'
    ),'[]'::jsonb),

    'events', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC,e.id DESC)
      FROM (
        SELECT
          cae.id,cae.event_type,cae.reason,cae.metadata,cae.created_at,
          cae.student_id,s.name AS student_name,s.brand_name,
          cae.character_id,c.character_uid,c.name AS character_name,c.epithet
        FROM public.character_acquisition_events cae
        JOIN public.students s ON s.id=cae.student_id
        JOIN public.characters c ON c.id=cae.character_id
        WHERE cae.classroom_id=p_classroom_id
        ORDER BY cae.created_at DESC,cae.id DESC
        LIMIT v_limit
      ) e
    ),'[]'::jsonb)
  );
END;
$function$;


REVOKE ALL ON FUNCTION public.character_requirement_met(integer,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.character_requirement_met(integer,bigint) TO service_role;
REVOKE ALL ON FUNCTION public.teacher_set_character_recruitment_policy(integer,bigint,text,boolean,text,text,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_set_character_recruitment_policy(integer,bigint,text,boolean,text,text,jsonb,text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.teacher_get_character_admin_board(integer,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_get_character_admin_board(integer,integer) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
