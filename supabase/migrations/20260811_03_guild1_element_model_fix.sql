-- ==========================================================================
-- B.R.A.N.D 2.0 — Guild 1.1 Element Model Correction + Guild Create Hardening
-- 2026-08-11
--
-- Correct model:
--   - Guild itself has NO element.
--   - Each active guild membership (student) has one assigned element.
--   - Supported elements: EARTH/WATER/FIRE/WIND/LIGHT/DARK
--   - Past membership/session snapshots preserve the element that applied then.
-- ==========================================================================

-- 1) Allow DARK in the legacy guild_members.element storage type.
DO $$
DECLARE
  v_type_oid oid;
  v_typtype "char";
  v_typname text;
  v_nspname text;
  v_has_english boolean := false;
  v_has_korean boolean := false;
BEGIN
  SELECT a.atttypid, t.typtype, t.typname, n.nspname
    INTO v_type_oid, v_typtype, v_typname, v_nspname
  FROM pg_attribute a
  JOIN pg_type t ON t.oid=a.atttypid
  JOIN pg_namespace n ON n.oid=t.typnamespace
  WHERE a.attrelid='public.guild_members'::regclass
    AND a.attname='element'
    AND NOT a.attisdropped;

  IF v_type_oid IS NULL THEN
    RAISE EXCEPTION '[G1.1] guild_members.element column not found';
  END IF;

  IF v_typtype='e' THEN
    SELECT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid=v_type_oid AND enumlabel IN ('EARTH','WATER','FIRE','WIND','LIGHT')),
           EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid=v_type_oid AND enumlabel IN ('땅','물','불','바람','빛'))
      INTO v_has_english, v_has_korean;

    IF v_has_english OR NOT v_has_korean THEN
      EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', v_nspname, v_typname, 'DARK');
    END IF;
    IF v_has_korean THEN
      EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L', v_nspname, v_typname, '어둠');
    END IF;
  ELSE
    -- Text-like legacy schemas sometimes have a single-column CHECK limiting element.
    -- Replace only CHECK constraints whose dependency is exactly the element column.
    DECLARE
      r record;
      v_attnum smallint;
    BEGIN
      SELECT attnum INTO v_attnum
      FROM pg_attribute
      WHERE attrelid='public.guild_members'::regclass AND attname='element' AND NOT attisdropped;

      FOR r IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid='public.guild_members'::regclass
          AND contype='c'
          AND conkey IS NOT NULL
          AND array_length(conkey,1)=1
          AND conkey[1]=v_attnum
      LOOP
        EXECUTE format('ALTER TABLE public.guild_members DROP CONSTRAINT %I', r.conname);
      END LOOP;

      ALTER TABLE public.guild_members
        DROP CONSTRAINT IF EXISTS guild_members_g11_element_check;
      ALTER TABLE public.guild_members
        ADD CONSTRAINT guild_members_g11_element_check
        CHECK (
          element IS NULL OR
          upper(btrim(element::text)) IN ('EARTH','WATER','FIRE','WIND','LIGHT','DARK') OR
          btrim(element::text) IN ('땅','물','불','바람','빛','어둠')
        ) NOT VALID;
    END;
  END IF;
END $$;

-- 2) Correct helper: normalize a STUDENT'S assigned element.
CREATE OR REPLACE FUNCTION public.guild1_normalize_element_code(p_element text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v text := upper(btrim(coalesce(p_element,'')));
BEGIN
  IF v='' THEN RETURN NULL; END IF;
  IF v IN ('EARTH','땅') THEN RETURN 'EARTH'; END IF;
  IF v IN ('WATER','물') THEN RETURN 'WATER'; END IF;
  IF v IN ('FIRE','불') THEN RETURN 'FIRE'; END IF;
  IF v IN ('WIND','바람') THEN RETURN 'WIND'; END IF;
  IF v IN ('LIGHT','빛') THEN RETURN 'LIGHT'; END IF;
  IF v IN ('DARK','어둠') THEN RETURN 'DARK'; END IF;
  RAISE EXCEPTION '[G1.1] invalid member element: %', p_element USING ERRCODE='PG201';
END;
$$;

CREATE OR REPLACE FUNCTION public.guild1_storage_member_element(p_element_code text)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_code text := public.guild1_normalize_element_code(p_element_code);
  v_type_oid oid;
  v_typtype "char";
  v_candidate text;
  v_existing_style text;
BEGIN
  IF v_code IS NULL THEN RETURN NULL; END IF;

  SELECT a.atttypid, t.typtype INTO v_type_oid, v_typtype
  FROM pg_attribute a
  JOIN pg_type t ON t.oid=a.atttypid
  WHERE a.attrelid='public.guild_members'::regclass
    AND a.attname='element' AND NOT a.attisdropped;

  IF v_typtype='e' THEN
    SELECT e.enumlabel INTO v_candidate
    FROM pg_enum e
    WHERE e.enumtypid=v_type_oid
      AND e.enumlabel IN (
        v_code,
        CASE v_code
          WHEN 'EARTH' THEN '땅' WHEN 'WATER' THEN '물' WHEN 'FIRE' THEN '불'
          WHEN 'WIND' THEN '바람' WHEN 'LIGHT' THEN '빛' WHEN 'DARK' THEN '어둠'
        END
      )
    ORDER BY CASE WHEN e.enumlabel=v_code THEN 0 ELSE 1 END
    LIMIT 1;
    IF v_candidate IS NULL THEN
      RAISE EXCEPTION '[G1.1] guild_members.element enum does not support %', v_code USING ERRCODE='PG202';
    END IF;
    RETURN v_candidate;
  END IF;

  -- For text-like schemas, preserve the existing storage language when possible.
  SELECT gm.element::text INTO v_existing_style
  FROM public.guild_members gm
  WHERE gm.element IS NOT NULL
  ORDER BY gm.id DESC
  LIMIT 1;

  IF v_existing_style IN ('땅','물','불','바람','빛','어둠') THEN
    RETURN CASE v_code
      WHEN 'EARTH' THEN '땅' WHEN 'WATER' THEN '물' WHEN 'FIRE' THEN '불'
      WHEN 'WIND' THEN '바람' WHEN 'LIGHT' THEN '빛' WHEN 'DARK' THEN '어둠'
    END;
  END IF;
  RETURN v_code;
END;
$$;

REVOKE ALL ON FUNCTION public.guild1_normalize_element_code(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guild1_storage_member_element(text) FROM PUBLIC, anon, authenticated;

-- 3) Membership event ledger can also record element-only changes.
ALTER TABLE public.guild_membership_events
  DROP CONSTRAINT IF EXISTS guild_membership_events_event_type_check;
ALTER TABLE public.guild_membership_events
  ADD CONSTRAINT guild_membership_events_event_type_check
  CHECK (event_type IN ('ASSIGN','MOVE','REMOVE','ELEMENT_CHANGE')) NOT VALID;

-- 4) Remove the wrong Guild-level element API signatures first to avoid PostgREST overload ambiguity.
DROP FUNCTION IF EXISTS public.teacher_create_guild(text,text,text,text,text,boolean);
DROP FUNCTION IF EXISTS public.teacher_update_guild_profile(bigint,text,text,text,text,text,boolean);

-- 5) Guild create: no element parameter. Legacy season_id/guild_uid remain supported.
CREATE OR REPLACE FUNCTION public.teacher_create_guild(
  p_name text,
  p_slogan text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_id bigint;
  v_cols text := 'classroom_id,name,slogan,logo_url,description,is_active,updated_at';
  v_vals text;
  v_season_id bigint;
  v_uid text;
  v_uid_type text;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '[G1.1] teacher classroom not found' USING ERRCODE='PG210'; END IF;
  IF btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION '[G1.1] guild name required' USING ERRCODE='PG211'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.guilds
    WHERE (classroom_id=v_class OR classroom_id IS NULL)
      AND lower(name)=lower(btrim(p_name))
  ) THEN
    RAISE EXCEPTION '[G1.1] duplicate guild name in classroom' USING ERRCODE='PG212';
  END IF;

  v_vals := format('%s,%L,%L,%L,%L,%L,now()',
    v_class,btrim(p_name),nullif(btrim(coalesce(p_slogan,'')),''),
    nullif(btrim(coalesce(p_logo_url,'')),''),nullif(btrim(coalesce(p_description,'')),''),
    p_is_active);

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guilds' AND column_name='season_id'
  ) THEN
    SELECT gs.id INTO v_season_id
    FROM public.guild_seasons gs
    WHERE gs.classroom_id=v_class AND gs.lifecycle_status='ACTIVE'
    ORDER BY gs.starts_on DESC NULLS LAST, gs.id DESC LIMIT 1;

    IF v_season_id IS NULL AND EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='guild_seasons' AND column_name='is_active'
    ) THEN
      EXECUTE 'SELECT id FROM public.guild_seasons WHERE classroom_id=$1 AND is_active=true ORDER BY id DESC LIMIT 1'
        INTO v_season_id USING v_class;
    END IF;

    -- Legacy fallback: if existing active guilds in this classroom unanimously use one season_id,
    -- use that exact season instead of making the create button silently fail.
    IF v_season_id IS NULL THEN
      EXECUTE $q$
        SELECT min(season_id)::bigint
        FROM public.guilds
        WHERE coalesce(is_active,true)
          AND (classroom_id=$1 OR classroom_id IS NULL)
          AND season_id IS NOT NULL
        HAVING count(DISTINCT season_id)=1
      $q$ INTO v_season_id USING v_class;
    END IF;

    IF v_season_id IS NULL THEN
      RAISE EXCEPTION '[G1.1] active/current guild season could not be resolved. Activate a season first.' USING ERRCODE='PG213';
    END IF;
    v_cols := v_cols || ',season_id';
    v_vals := v_vals || format(',%s',v_season_id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guilds' AND column_name='guild_uid'
  ) THEN
    SELECT data_type INTO v_uid_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guilds' AND column_name='guild_uid';

    IF v_uid_type='uuid' THEN v_uid := gen_random_uuid()::text;
    ELSE v_uid := 'GUILD_' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,14));
    END IF;
    v_cols := v_cols || ',guild_uid';
    v_vals := v_vals || format(',%L',v_uid);
  END IF;

  EXECUTE 'INSERT INTO public.guilds('||v_cols||') VALUES ('||v_vals||') RETURNING id' INTO v_id;
  RETURN v_id;
END;
$$;

-- 6) Guild profile edit: only guild profile fields. It never rewrites member elements.
CREATE OR REPLACE FUNCTION public.teacher_update_guild_profile(
  p_guild_id bigint,
  p_name text,
  p_slogan text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_logo_url text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '[G1.1] teacher classroom not found' USING ERRCODE='PG214'; END IF;
  IF btrim(coalesce(p_name,''))='' THEN RAISE EXCEPTION '[G1.1] guild name required' USING ERRCODE='PG215'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.guilds g
    WHERE g.id=p_guild_id AND (g.classroom_id=v_class OR g.classroom_id IS NULL)
  ) THEN RAISE EXCEPTION '[G1.1] guild not found in teacher classroom' USING ERRCODE='PG216'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.guilds g
    WHERE g.id<>p_guild_id AND (g.classroom_id=v_class OR g.classroom_id IS NULL)
      AND lower(g.name)=lower(btrim(p_name))
  ) THEN RAISE EXCEPTION '[G1.1] duplicate guild name in classroom' USING ERRCODE='PG217'; END IF;

  IF NOT p_is_active AND EXISTS (
    SELECT 1 FROM public.guild_members gm WHERE gm.guild_id=p_guild_id AND gm.left_at IS NULL
  ) THEN RAISE EXCEPTION '[G1.1] active members remain in guild; move or remove them before deactivation' USING ERRCODE='PG218'; END IF;

  UPDATE public.guilds
  SET classroom_id=coalesce(classroom_id,v_class),
      name=btrim(p_name),
      slogan=nullif(btrim(coalesce(p_slogan,'')),''),
      description=nullif(btrim(coalesce(p_description,'')),''),
      logo_url=nullif(btrim(coalesce(p_logo_url,'')),''),
      is_active=p_is_active,
      updated_at=now()
  WHERE id=p_guild_id;
  RETURN p_guild_id;
END;
$$;

-- 7) Membership assignment/move/element-change. Element belongs to the student membership.
CREATE OR REPLACE FUNCTION public.teacher_assign_guild_member(
  p_student_id integer,
  p_guild_id bigint,
  p_element text DEFAULT NULL,
  p_reason text DEFAULT '교사 배정',
  p_effective_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_class integer;
  v_old public.guild_members%ROWTYPE;
  v_new_id bigint;
  v_event text;
  v_code text;
  v_storage text;
  v_old_code text;
  v_old_guild_name text;
  v_new_guild_name text;
  v_member_season_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class := public.current_classroom_id();
  IF v_class IS NULL THEN RAISE EXCEPTION '[G1.1] teacher classroom not found' USING ERRCODE='PG220'; END IF;
  IF btrim(coalesce(p_reason,''))='' THEN RAISE EXCEPTION '[G1.1] membership change reason required' USING ERRCODE='PG221'; END IF;

  v_code := public.guild1_normalize_element_code(p_element);
  IF v_code IS NULL THEN RAISE EXCEPTION '[G1.1] member element required' USING ERRCODE='PG222'; END IF;
  v_storage := public.guild1_storage_member_element(v_code);

  IF NOT EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id=p_student_id AND s.classroom_id=v_class AND s.transferred_at IS NULL
      AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
  ) THEN RAISE EXCEPTION '[G1.1] active student not found in teacher classroom' USING ERRCODE='PG223'; END IF;

  SELECT g.name INTO v_new_guild_name
  FROM public.guilds g
  WHERE g.id=p_guild_id AND coalesce(g.is_active,true)
    AND (g.classroom_id=v_class OR g.classroom_id IS NULL);
  IF v_new_guild_name IS NULL THEN RAISE EXCEPTION '[G1.1] active guild not found in teacher classroom' USING ERRCODE='PG224'; END IF;

  SELECT * INTO v_old
  FROM public.guild_members
  WHERE student_id=p_student_id AND left_at IS NULL
  FOR UPDATE;

  IF FOUND AND v_old.guild_id=p_guild_id THEN
    BEGIN
      v_old_code := public.guild1_normalize_element_code(v_old.element::text);
    EXCEPTION WHEN OTHERS THEN
      v_old_code := NULL;
    END;

    IF v_old_code IS NOT DISTINCT FROM v_code THEN
      RETURN jsonb_build_object('status','UNCHANGED','membership_id',v_old.id,'guild_id',p_guild_id,'element',v_storage);
    END IF;

    EXECUTE format('UPDATE public.guild_members SET element=%L, changed_by_user_id=auth.uid() WHERE id=%s',v_storage,v_old.id);
    INSERT INTO public.guild_membership_events(
      classroom_id,student_id,from_guild_id,to_guild_id,from_membership_id,to_membership_id,
      from_guild_name,to_guild_name,event_type,element_before,element_after,reason,effective_at,actor_user_id
    ) VALUES (
      v_class,p_student_id,p_guild_id,p_guild_id,v_old.id,v_old.id,
      v_new_guild_name,v_new_guild_name,'ELEMENT_CHANGE',v_old.element::text,v_code,btrim(p_reason),p_effective_at,auth.uid()
    );
    RETURN jsonb_build_object('status','ELEMENT_CHANGE','membership_id',v_old.id,'guild_id',p_guild_id,'element',v_storage);
  END IF;

  v_event := CASE WHEN FOUND THEN 'MOVE' ELSE 'ASSIGN' END;
  IF FOUND THEN
    SELECT name INTO v_old_guild_name FROM public.guilds WHERE id=v_old.guild_id;
    UPDATE public.guild_members
    SET left_at=p_effective_at,leave_reason=btrim(p_reason),changed_by_user_id=auth.uid()
    WHERE id=v_old.id;
  END IF;

  UPDATE public.guilds SET classroom_id=coalesce(classroom_id,v_class),updated_at=now() WHERE id=p_guild_id;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='guild_members' AND column_name='season_id'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='guilds' AND column_name='season_id'
    ) THEN
      EXECUTE 'SELECT season_id FROM public.guilds WHERE id=$1' INTO v_member_season_id USING p_guild_id;
    END IF;

    IF v_member_season_id IS NULL THEN
      SELECT gs.id INTO v_member_season_id
      FROM public.guild_seasons gs
      WHERE gs.classroom_id=v_class AND gs.lifecycle_status='ACTIVE'
      ORDER BY gs.starts_on DESC NULLS LAST,gs.id DESC LIMIT 1;
    END IF;

    IF v_member_season_id IS NULL THEN
      RAISE EXCEPTION '[G1.1] current guild season could not be resolved for membership' USING ERRCODE='PG225';
    END IF;

    EXECUTE format(
      'INSERT INTO public.guild_members(guild_id,student_id,season_id,element,joined_at,left_at,changed_by_user_id) VALUES (%s,%s,%s,%L,%L,NULL,%L) RETURNING id',
      p_guild_id,p_student_id,v_member_season_id,v_storage,p_effective_at,auth.uid()
    ) INTO v_new_id;
  ELSE
    EXECUTE format(
      'INSERT INTO public.guild_members(guild_id,student_id,element,joined_at,left_at,changed_by_user_id) VALUES (%s,%s,%L,%L,NULL,%L) RETURNING id',
      p_guild_id,p_student_id,v_storage,p_effective_at,auth.uid()
    ) INTO v_new_id;
  END IF;

  INSERT INTO public.guild_membership_events(
    classroom_id,student_id,from_guild_id,to_guild_id,from_membership_id,to_membership_id,
    from_guild_name,to_guild_name,event_type,element_before,element_after,reason,effective_at,actor_user_id
  ) VALUES (
    v_class,p_student_id,
    CASE WHEN v_event='MOVE' THEN v_old.guild_id ELSE NULL END,p_guild_id,
    CASE WHEN v_event='MOVE' THEN v_old.id ELSE NULL END,v_new_id,
    CASE WHEN v_event='MOVE' THEN v_old_guild_name ELSE NULL END,v_new_guild_name,
    v_event,CASE WHEN v_event='MOVE' THEN v_old.element::text ELSE NULL END,v_code,
    btrim(p_reason),p_effective_at,auth.uid()
  );

  RETURN jsonb_build_object('status',v_event,'membership_id',v_new_id,'guild_id',p_guild_id,'element',v_storage);
END;
$$;

-- 8) Session snapshot uses the student's membership element, never a guild-level element.
CREATE OR REPLACE FUNCTION public.teacher_create_guild_session(
  p_classroom_id integer,
  p_title text,
  p_session_date date,
  p_note text DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id bigint;
  v_season_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[G1.1] teacher classroom denied' USING ERRCODE='PG230'; END IF;
  IF btrim(coalesce(p_title,''))='' THEN RAISE EXCEPTION '[G1.1] guild session title required' USING ERRCODE='PG231'; END IF;

  SELECT id INTO v_season_id
  FROM public.guild_seasons
  WHERE classroom_id=p_classroom_id AND lifecycle_status='ACTIVE'
    AND (starts_on IS NULL OR starts_on<=p_session_date)
    AND (ends_on IS NULL OR ends_on>=p_session_date)
  ORDER BY starts_on DESC NULLS LAST,id DESC LIMIT 1;

  INSERT INTO public.guild_sessions(classroom_id,season_id,title,session_date,note,created_by_user_id)
  VALUES(p_classroom_id,v_season_id,btrim(p_title),p_session_date,nullif(btrim(coalesce(p_note,'')),''),auth.uid())
  RETURNING id INTO v_session_id;

  INSERT INTO public.guild_session_participants(
    session_id,student_id,guild_id_at_session,
    student_name_at_session,brand_name_at_session,guild_name_at_session,element_at_session
  )
  SELECT v_session_id,s.id,gm.guild_id,s.name,s.brand_name,g.name,gm.element::text
  FROM public.students s
  JOIN public.guild_members gm ON gm.student_id=s.id AND gm.left_at IS NULL
  JOIN public.guilds g ON g.id=gm.guild_id
  WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND coalesce(g.is_active,true)
  ON CONFLICT(session_id,student_id) DO NOTHING;

  RETURN v_session_id;
END;
$$;

-- 9) Health check: member element completeness, not guild element completeness.
CREATE OR REPLACE FUNCTION public.teacher_guild1_health_check(p_classroom_id integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_duplicate integer;
  v_unassigned integer;
  v_members_without_element integer;
  v_transferred_active_memberships integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  IF p_classroom_id IS DISTINCT FROM public.current_classroom_id() THEN RAISE EXCEPTION '[G1.1] teacher classroom denied' USING ERRCODE='PG240'; END IF;

  SELECT count(*) INTO v_duplicate FROM (
    SELECT gm.student_id FROM public.guild_members gm
    JOIN public.students s ON s.id=gm.student_id
    WHERE s.classroom_id=p_classroom_id AND gm.left_at IS NULL
    GROUP BY gm.student_id HAVING count(*)>1
  ) q;

  SELECT count(*) INTO v_members_without_element
  FROM public.guild_members gm
  JOIN public.students s ON s.id=gm.student_id
  WHERE s.classroom_id=p_classroom_id AND gm.left_at IS NULL AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND (
      gm.element IS NULL OR
      NOT (
        upper(btrim(gm.element::text)) IN ('EARTH','WATER','FIRE','WIND','LIGHT','DARK') OR
        btrim(gm.element::text) IN ('땅','물','불','바람','빛','어둠')
      )
    );

  SELECT count(*) INTO v_unassigned
  FROM public.students s
  WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NULL
    AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    AND NOT EXISTS(SELECT 1 FROM public.guild_members gm WHERE gm.student_id=s.id AND gm.left_at IS NULL);

  SELECT count(*) INTO v_transferred_active_memberships
  FROM public.students s
  JOIN public.guild_members gm ON gm.student_id=s.id AND gm.left_at IS NULL
  WHERE s.classroom_id=p_classroom_id AND s.transferred_at IS NOT NULL;

  RETURN jsonb_build_object(
    'version','GUILD1.1',
    'element_model','MEMBER_ASSIGNED',
    'supported_elements',jsonb_build_array('EARTH','WATER','FIRE','WIND','LIGHT','DARK'),
    'duplicate_active_memberships',v_duplicate,
    'active_members_without_element',v_members_without_element,
    'unassigned_active_students',v_unassigned,
    'transferred_students_with_active_membership',v_transferred_active_memberships,
    'checked_at',now()
  );
END;
$$;

-- 10) Remove the mistakenly-added guild-level element column after all replacement RPCs are installed.
ALTER TABLE public.guilds DROP CONSTRAINT IF EXISTS guilds_g1_element_code_check;
ALTER TABLE public.guilds DROP COLUMN IF EXISTS element_code;

-- Retire the old helper that encoded the wrong guild-level concept.
DROP FUNCTION IF EXISTS public.guild1_storage_element(bigint,text);

-- 11) ACL for corrected RPC signatures.
REVOKE ALL ON FUNCTION public.teacher_create_guild(text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_update_guild_profile(bigint,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_assign_guild_member(integer,bigint,text,text,timestamp with time zone) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_create_guild_session(integer,text,date,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.teacher_guild1_health_check(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teacher_create_guild(text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_update_guild_profile(bigint,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_assign_guild_member(integer,bigint,text,text,timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_create_guild_session(integer,text,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_guild1_health_check(integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
