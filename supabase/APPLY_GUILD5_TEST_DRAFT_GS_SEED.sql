-- =============================================================================
-- B.R.A.N.D 2.0 — Guild5 TEST fixture synthetic Draft GS seed
-- 2026-08-16
--
-- TEST-only helper. The real TEST GUILD keeps its actual Guild2 Draft GS.
-- Empty simulation guilds TEST GUILD 2~5 receive deterministic manual-adjustment
-- Draft GS so Guild5 ranking / Top3 conquest can be exercised end-to-end.
-- Synthetic values: 900 / 750 / 600 / 450 GS.
--
-- The events are append-only MANUAL_ADJUSTMENT entries marked with metadata,
-- and repeated preparation is idempotent for the selected month.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.teacher_prepare_guild5_test_guilds_for_month(
  p_year_month text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=public,pg_temp
AS $$
DECLARE
  v_class integer;
  v_fixture public.test_classroom_fixtures%ROWTYPE;
  v_name text;
  v_created integer:=0;
  v_guild_id integer;
  v_points numeric(10,2);
  v_existing public.guild2_gs_events%ROWTYPE;
  v_reversal_id bigint;
  v_seeded jsonb:='[]'::jsonb;
  v_refresh jsonb;
  i integer;
BEGIN
  PERFORM public.ensure_teacher_role();
  v_class:=public.current_classroom_id();

  IF p_year_month IS NULL OR p_year_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G5 TEST] year_month must be YYYY-MM.' USING ERRCODE='P0591';
  END IF;

  SELECT * INTO v_fixture
  FROM public.test_classroom_fixtures
  WHERE fixture_code='BRAND_TEST_V1' AND classroom_id=v_class;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[G5 TEST] current classroom is not BRAND_TEST_V1.' USING ERRCODE='P0590';
  END IF;

  IF public.guild2_resolve_season_for_month(v_class,p_year_month) IS DISTINCT FROM v_fixture.season_id THEN
    RAISE EXCEPTION '[G5 TEST] selected month is outside the TEST fixture season.' USING ERRCODE='P0592';
  END IF;

  IF public.guild5_month_is_frozen(v_class,v_fixture.season_id,p_year_month) THEN
    RAISE EXCEPTION '[G5 TEST] selected month is already FINAL/frozen. REOPEN it before changing TEST Draft GS.' USING ERRCODE='P0593';
  END IF;

  FOR i IN 2..5 LOOP
    v_name:=format('TEST GUILD %s',i);
    IF NOT EXISTS(
      SELECT 1 FROM public.guilds
      WHERE classroom_id=v_class
        AND season_id=v_fixture.season_id
        AND lower(name)=lower(v_name)
    ) THEN
      PERFORM public.teacher_create_guild(v_name,'Guild5 ranking/conquest simulation',NULL,NULL,true);
      v_created:=v_created+1;
    END IF;

    SELECT id INTO v_guild_id
    FROM public.guilds
    WHERE classroom_id=v_class
      AND season_id=v_fixture.season_id
      AND lower(name)=lower(v_name)
    ORDER BY id
    LIMIT 1;

    v_points:=CASE i
      WHEN 2 THEN 900::numeric
      WHEN 3 THEN 750::numeric
      WHEN 4 THEN 600::numeric
      ELSE 450::numeric
    END;

    v_existing:=NULL;
    SELECT e.* INTO v_existing
    FROM public.guild2_gs_events e
    WHERE e.classroom_id=v_class
      AND e.season_id=v_fixture.season_id
      AND e.year_month=p_year_month
      AND e.guild_id=v_guild_id
      AND e.source_type='MANUAL_ADJUSTMENT'
      AND e.event_kind='POST'
      AND coalesce((e.metadata->>'g5_test_seed')::boolean,false)=true
      AND NOT EXISTS(
        SELECT 1 FROM public.guild2_gs_events r
        WHERE r.reversal_of=e.id AND r.event_kind='REVERSAL'
      )
    ORDER BY e.id DESC
    LIMIT 1;

    IF v_existing.id IS NULL THEN
      INSERT INTO public.guild2_gs_events(
        classroom_id,season_id,year_month,guild_id,source_type,source_id,event_kind,
        points,reason,metadata
      ) VALUES (
        v_class,v_fixture.season_id,p_year_month,v_guild_id,'MANUAL_ADJUSTMENT',v_guild_id,
        'POST',v_points,'Guild5 TEST ranking/conquest synthetic Draft GS',
        jsonb_build_object(
          'g5_test_seed',true,
          'fixture_code','BRAND_TEST_V1',
          'guild_name',v_name,
          'seed_version','G5_TEST_DRAFT_GS_V1'
        )
      );
    ELSIF v_existing.points IS DISTINCT FROM v_points THEN
      INSERT INTO public.guild2_gs_events(
        classroom_id,season_id,year_month,guild_id,source_type,source_id,event_kind,
        points,reason,metadata,reversal_of
      ) VALUES (
        v_existing.classroom_id,v_existing.season_id,v_existing.year_month,v_existing.guild_id,
        'REVERSAL',v_existing.source_id,'REVERSAL',-v_existing.points,
        'Guild5 TEST synthetic Draft GS reseed reversal',
        jsonb_build_object('g5_test_seed',true,'reversal_reason','G5_TEST_RESEED'),v_existing.id
      ) RETURNING id INTO v_reversal_id;

      INSERT INTO public.guild2_gs_events(
        classroom_id,season_id,year_month,guild_id,source_type,source_id,event_kind,
        points,reason,metadata
      ) VALUES (
        v_class,v_fixture.season_id,p_year_month,v_guild_id,'MANUAL_ADJUSTMENT',v_guild_id,
        'POST',v_points,'Guild5 TEST ranking/conquest synthetic Draft GS reseed',
        jsonb_build_object(
          'g5_test_seed',true,
          'fixture_code','BRAND_TEST_V1',
          'guild_name',v_name,
          'seed_version','G5_TEST_DRAFT_GS_V1',
          'reversal_event_id',v_reversal_id
        )
      );
    END IF;

    v_seeded:=v_seeded || jsonb_build_array(jsonb_build_object(
      'guild_id',v_guild_id,
      'guild_name',v_name,
      'draft_gs_seed',v_points
    ));
  END LOOP;

  v_refresh:=public.guild2_refresh_monthly_scores(v_class,p_year_month);

  RETURN jsonb_build_object(
    'year_month',p_year_month,
    'created',v_created,
    'active_guild_count',(
      SELECT count(*) FROM public.guilds
      WHERE classroom_id=v_class
        AND season_id=v_fixture.season_id
        AND coalesce(is_active,true)
    ),
    'synthetic_draft_gs',v_seeded,
    'guild2_refresh',v_refresh
  );
END
$$;

REVOKE ALL ON FUNCTION public.teacher_prepare_guild5_test_guilds_for_month(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_prepare_guild5_test_guilds_for_month(text) TO authenticated;

COMMIT;
