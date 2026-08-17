-- =============================================================================
-- B.R.A.N.D 2.0 — Guild 5 Monthly Closure & Conquest
-- 2026-08-16
--
-- LOCKED ownership:
--   * Guild2 remains DRAFT calculator.
--   * Guild5 alone owns monthly FINAL snapshots/rank/conquest/history.
--   * Mission/Peer only may use audited emergency override.
--   * FINAL freezes Guild3/Guild4 correction paths; REOPEN releases the freeze.
-- =============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.ensure_teacher_role()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL
     OR to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.guild2_resolve_season_for_month(integer,text)') IS NULL
     OR to_regprocedure('public.guild2_refresh_monthly_scores(integer,text)') IS NULL
     OR to_regprocedure('public.guild3_mission_month_is_ready(integer,integer,text)') IS NULL
     OR to_regprocedure('public.guild4_peer_month_is_ready(integer,integer,text)') IS NULL
     OR to_regprocedure('public.arcade_monthly_finalization_is_complete(integer,text)') IS NULL
     OR to_regprocedure('public.teacher_create_guild(text,text,text,text,boolean)') IS NULL
     OR to_regprocedure('public.guild3_write_audit_event(bigint,bigint,bigint,integer,text,text,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.teacher_reset_test_classroom_fixture()') IS NULL THEN
    RAISE EXCEPTION '[G5] required Guild1~4/Arcade helpers are missing.';
  END IF;
  IF to_regclass('public.guild2_individual_contributions') IS NULL
     OR to_regclass('public.guild2_monthly_gs_summaries') IS NULL
     OR to_regclass('public.guild2_compensation_configs') IS NULL
     OR to_regclass('public.guild3_missions') IS NULL
     OR to_regclass('public.guild4_peer_review_rounds') IS NULL
     OR to_regclass('public.wallets') IS NULL
     OR to_regclass('public.guild3_mission_instances') IS NULL
     OR to_regclass('public.guild3_mission_participants') IS NULL
     OR to_regclass('public.guild3_mission_submissions') IS NULL
     OR to_regclass('public.guild3_mission_activity_records') IS NULL
     OR to_regclass('public.test_classroom_fixtures') IS NULL
     OR to_regclass('public.hall_of_fame_entries') IS NULL THEN
    RAISE EXCEPTION '[G5] required source tables are missing.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Closure/version snapshots.
-- -----------------------------------------------------------------------------
CREATE TABLE public.guild5_month_closures (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  year_month varchar(7) NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'OPEN',
  current_version_id bigint,
  mission_override_active boolean NOT NULL DEFAULT false,
  mission_override_reason text,
  peer_override_active boolean NOT NULL DEFAULT false,
  peer_override_reason text,
  created_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_closure_month_check CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT guild5_closure_state_check CHECK (lifecycle_state IN ('OPEN','FINALIZED','REOPENED')),
  CONSTRAINT guild5_closure_mission_override_check CHECK (
    (NOT mission_override_active AND mission_override_reason IS NULL)
    OR (mission_override_active AND char_length(btrim(coalesce(mission_override_reason,''))) BETWEEN 2 AND 500)
  ),
  CONSTRAINT guild5_closure_peer_override_check CHECK (
    (NOT peer_override_active AND peer_override_reason IS NULL)
    OR (peer_override_active AND char_length(btrim(coalesce(peer_override_reason,''))) BETWEEN 2 AND 500)
  ),
  CONSTRAINT guild5_closure_scope_unique UNIQUE (classroom_id,season_id,year_month)
);

CREATE TABLE public.guild5_closure_versions (
  id bigserial PRIMARY KEY,
  closure_id bigint NOT NULL REFERENCES public.guild5_month_closures(id) ON DELETE CASCADE,
  version_no integer NOT NULL,
  previous_version_id bigint REFERENCES public.guild5_closure_versions(id),
  finalized_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  finalized_at timestamptz NOT NULL DEFAULT now(),
  readiness_snapshot jsonb NOT NULL,
  override_snapshot jsonb NOT NULL,
  tie_seed text NOT NULL,
  rank_changed_from_previous boolean NOT NULL DEFAULT false,
  conquest_status text NOT NULL DEFAULT 'ACTIVE',
  closure_formula_version text NOT NULL DEFAULT 'GUILD5_MONTHLY_CLOSE_V1_2026',
  CONSTRAINT guild5_version_no_check CHECK (version_no >= 1),
  CONSTRAINT guild5_version_conquest_status_check CHECK (conquest_status IN ('ACTIVE','COMPLETE','RECONQUEST_REQUIRED')),
  CONSTRAINT guild5_version_unique UNIQUE (closure_id,version_no),
  CONSTRAINT guild5_version_readiness_object CHECK (jsonb_typeof(readiness_snapshot)='object'),
  CONSTRAINT guild5_version_override_object CHECK (jsonb_typeof(override_snapshot)='object')
);

ALTER TABLE public.guild5_month_closures
  ADD CONSTRAINT guild5_closure_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES public.guild5_closure_versions(id);

CREATE TABLE public.guild5_student_snapshots (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  student_id integer NOT NULL REFERENCES public.students(id),
  student_name_at_close text NOT NULL,
  brand_name_at_close text,
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  guild_name_at_close text NOT NULL,
  role_at_close text NOT NULL,
  bv_at_close bigint NOT NULL DEFAULT 0,
  peer_points numeric(10,2) NOT NULL,
  mission_points numeric(10,2) NOT NULL,
  session_points numeric(10,2) NOT NULL,
  observation_points numeric(10,2) NOT NULL,
  basic_total numeric(10,2) NOT NULL,
  arcade_raw_total numeric(10,2) NOT NULL,
  arcade_applied numeric(10,2) NOT NULL,
  final_contribution numeric(10,2) NOT NULL,
  peer_status text NOT NULL,
  mission_status text NOT NULL,
  session_status text NOT NULL,
  observation_status text NOT NULL,
  arcade_status text NOT NULL,
  source_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_student_version_unique UNIQUE (version_id,student_id),
  CONSTRAINT guild5_student_bv_check CHECK (bv_at_close >= 0),
  CONSTRAINT guild5_student_status_check CHECK (
    peer_status IN ('READY','OVERRIDDEN')
    AND mission_status IN ('READY','OVERRIDDEN')
    AND session_status='READY'
    AND observation_status='READY'
    AND arcade_status='READY'
  )
);

CREATE TABLE public.guild5_guild_snapshots (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  guild_name_at_close text NOT NULL,
  roster_count integer NOT NULL,
  roster_bv_sum bigint NOT NULL DEFAULT 0,
  individual_subtotal numeric(12,2) NOT NULL,
  official_mission_gs numeric(12,2) NOT NULL,
  compensation_amount numeric(12,2) NOT NULL,
  manual_adjustment_total numeric(12,2) NOT NULL,
  total_gs numeric(12,2) NOT NULL,
  deterministic_tie_value text NOT NULL,
  rank_position integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_guild_version_unique UNIQUE (version_id,guild_id),
  CONSTRAINT guild5_guild_roster_check CHECK (roster_count >= 0 AND roster_bv_sum >= 0),
  CONSTRAINT guild5_guild_rank_check CHECK (rank_position IS NULL OR rank_position >= 1)
);

CREATE INDEX ix_guild5_versions_closure_time ON public.guild5_closure_versions(closure_id,version_no DESC);
CREATE INDEX ix_guild5_student_history ON public.guild5_student_snapshots(student_id,version_id DESC);
CREATE INDEX ix_guild5_guild_rank ON public.guild5_guild_snapshots(version_id,rank_position);

-- -----------------------------------------------------------------------------
-- 2. Conquest config/sequence and audit.
-- -----------------------------------------------------------------------------
CREATE TABLE public.guild5_territories (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  slot_no smallint NOT NULL,
  territory_name text NOT NULL,
  description text,
  updated_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_territory_slot_check CHECK (slot_no BETWEEN 1 AND 3),
  CONSTRAINT guild5_territory_name_check CHECK (char_length(btrim(territory_name)) BETWEEN 1 AND 100),
  CONSTRAINT guild5_territory_unique UNIQUE (season_id,slot_no)
);

CREATE TABLE public.guild5_conquest_turns (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  rank_position smallint NOT NULL,
  guild_id integer NOT NULL REFERENCES public.guilds(id),
  turn_status text NOT NULL,
  territory_id bigint REFERENCES public.guild5_territories(id),
  territory_name_snapshot text,
  assignment_method text,
  activated_at timestamptz,
  deadline_at timestamptz,
  chosen_at timestamptz,
  source_turn_id bigint REFERENCES public.guild5_conquest_turns(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_turn_rank_check CHECK (rank_position BETWEEN 1 AND 3),
  CONSTRAINT guild5_turn_status_check CHECK (turn_status IN ('WAITING','ACTIVE','ASSIGNED','AUTO_ASSIGNED')),
  CONSTRAINT guild5_turn_method_check CHECK (assignment_method IS NULL OR assignment_method IN ('MANUAL','AUTO')),
  CONSTRAINT guild5_turn_version_rank_unique UNIQUE (version_id,rank_position),
  CONSTRAINT guild5_turn_version_guild_unique UNIQUE (version_id,guild_id),
  CONSTRAINT guild5_turn_shape_check CHECK (
    (turn_status='WAITING' AND territory_id IS NULL AND assignment_method IS NULL AND chosen_at IS NULL)
    OR (turn_status='ACTIVE' AND territory_id IS NULL AND assignment_method IS NULL AND activated_at IS NOT NULL AND deadline_at IS NOT NULL AND chosen_at IS NULL)
    OR (turn_status IN ('ASSIGNED','AUTO_ASSIGNED') AND territory_id IS NOT NULL AND territory_name_snapshot IS NOT NULL AND assignment_method IS NOT NULL AND chosen_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_guild5_turn_territory_per_version
  ON public.guild5_conquest_turns(version_id,territory_id)
  WHERE territory_id IS NOT NULL;

CREATE TABLE public.guild5_audit_events (
  id bigserial PRIMARY KEY,
  closure_id bigint REFERENCES public.guild5_month_closures(id) ON DELETE CASCADE,
  version_id bigint REFERENCES public.guild5_closure_versions(id) ON DELETE CASCADE,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  event_kind text NOT NULL,
  reason text,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_user_id uuid DEFAULT auth.uid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_audit_kind_check CHECK (char_length(btrim(event_kind)) BETWEEN 2 AND 100),
  CONSTRAINT guild5_audit_reason_check CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 2 AND 500)
);
CREATE INDEX ix_guild5_audit_closure_time ON public.guild5_audit_events(closure_id,occurred_at DESC,id DESC);

CREATE TABLE public.guild5_season_locks (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  season_id integer NOT NULL REFERENCES public.guild_seasons(id),
  lock_reason text NOT NULL,
  locked_by_user_id uuid NOT NULL DEFAULT auth.uid(),
  locked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guild5_season_lock_reason_check CHECK (char_length(btrim(lock_reason)) BETWEEN 2 AND 500),
  CONSTRAINT guild5_season_lock_unique UNIQUE (season_id)
);

-- -----------------------------------------------------------------------------
-- 3. Security boundary.
-- -----------------------------------------------------------------------------
ALTER TABLE public.guild5_month_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_closure_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_student_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_guild_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_territories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_conquest_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guild5_season_locks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.guild5_month_closures,public.guild5_closure_versions,
  public.guild5_student_snapshots,public.guild5_guild_snapshots,public.guild5_territories,
  public.guild5_conquest_turns,public.guild5_audit_events,public.guild5_season_locks
FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.guild5_month_closures,public.guild5_closure_versions,
  public.guild5_student_snapshots,public.guild5_guild_snapshots,public.guild5_territories,
  public.guild5_conquest_turns,public.guild5_audit_events,public.guild5_season_locks
TO service_role;

-- -----------------------------------------------------------------------------
-- 4. Internal helpers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_write_audit(
  p_closure_id bigint,p_version_id bigint,p_classroom_id integer,p_event_kind text,
  p_reason text,p_before jsonb DEFAULT '{}'::jsonb,p_after jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  INSERT INTO public.guild5_audit_events(closure_id,version_id,classroom_id,event_kind,reason,before_data,after_data,actor_user_id)
  VALUES(p_closure_id,p_version_id,p_classroom_id,btrim(p_event_kind),nullif(btrim(coalesce(p_reason,'')),''),coalesce(p_before,'{}'::jsonb),coalesce(p_after,'{}'::jsonb),auth.uid());
END $$;

CREATE OR REPLACE FUNCTION public.guild5_get_or_create_closure(
  p_classroom_id integer,p_season_id integer,p_year_month text
) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO public.guild5_month_closures(classroom_id,season_id,year_month)
  VALUES(p_classroom_id,p_season_id,p_year_month)
  ON CONFLICT (classroom_id,season_id,year_month) DO NOTHING;
  SELECT id INTO v_id FROM public.guild5_month_closures
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id AND year_month=p_year_month;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.guild5_month_is_frozen(
  p_classroom_id integer,p_season_id integer,p_year_month text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.guild5_season_locks sl
    WHERE sl.classroom_id=p_classroom_id AND sl.season_id=p_season_id
  ) OR EXISTS(
    SELECT 1 FROM public.guild5_month_closures c
    WHERE c.classroom_id=p_classroom_id AND c.season_id=p_season_id
      AND c.year_month=p_year_month AND c.lifecycle_state='FINALIZED'
  );
$$;

CREATE OR REPLACE FUNCTION public.guild5_build_close_preview(
  p_classroom_id integer,p_season_id integer,p_year_month text
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_closure public.guild5_month_closures%ROWTYPE;
  v_guild_count integer;
  v_summary_count integer;
  v_contribution_count integer;
  v_unresolved integer;
  v_session_bad integer;
  v_obs_bad integer;
  v_four_missing integer;
  v_territory_count integer;
  v_mission_ready boolean;
  v_peer_ready boolean;
  v_arcade_ready boolean;
  v_mission_status text;
  v_peer_status text;
  v_official_status text;
  v_all_ready boolean;
  v_guilds jsonb;
  v_students jsonb;
  v_season_locked boolean;
BEGIN
  IF coalesce(p_year_month,'') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION '[G5] year_month must be YYYY-MM.' USING ERRCODE='P0501';
  END IF;

  SELECT * INTO v_closure FROM public.guild5_month_closures
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id AND year_month=p_year_month;

  SELECT count(*) INTO v_guild_count FROM public.guilds g
  WHERE g.classroom_id=p_classroom_id AND g.season_id=p_season_id AND coalesce(g.is_active,true);
  SELECT count(*) INTO v_summary_count FROM public.guild2_monthly_gs_summaries s
  JOIN public.guilds g ON g.id=s.guild_id
  WHERE s.classroom_id=p_classroom_id AND s.season_id=p_season_id AND s.year_month=p_year_month
    AND g.classroom_id=p_classroom_id AND g.season_id=p_season_id AND coalesce(g.is_active,true);
  SELECT count(*),count(*) FILTER(WHERE guild_context_status<>'RESOLVED'),
         count(*) FILTER(WHERE session_status<>'READY'),
         count(*) FILTER(WHERE teacher_observation_status<>'READY')
  INTO v_contribution_count,v_unresolved,v_session_bad,v_obs_bad
  FROM public.guild2_individual_contributions
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id AND year_month=p_year_month;

  SELECT count(*) INTO v_four_missing
  FROM public.guild2_monthly_gs_summaries s
  WHERE s.classroom_id=p_classroom_id AND s.season_id=p_season_id AND s.year_month=p_year_month
    AND s.scoring_roster_count=4
    AND NOT EXISTS(
      SELECT 1 FROM public.guild2_compensation_configs cc
      WHERE cc.classroom_id=p_classroom_id AND cc.season_id=p_season_id AND cc.guild_id=s.guild_id
    );

  SELECT count(*) INTO v_territory_count FROM public.guild5_territories
  WHERE classroom_id=p_classroom_id AND season_id=p_season_id;

  v_mission_ready:=public.guild3_mission_month_is_ready(p_classroom_id,p_season_id,p_year_month);
  v_peer_ready:=public.guild4_peer_month_is_ready(p_classroom_id,p_season_id,p_year_month);
  v_arcade_ready:=public.arcade_monthly_finalization_is_complete(p_classroom_id,p_year_month);
  v_season_locked:=EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE classroom_id=p_classroom_id AND season_id=p_season_id);

  v_mission_status:=CASE WHEN v_mission_ready THEN 'READY' WHEN coalesce(v_closure.mission_override_active,false) THEN 'OVERRIDDEN' ELSE 'NOT_READY' END;
  v_peer_status:=CASE WHEN v_peer_ready THEN 'READY' WHEN coalesce(v_closure.peer_override_active,false) THEN 'OVERRIDDEN' ELSE 'NOT_READY' END;
  v_official_status:=CASE WHEN v_mission_ready THEN 'READY' WHEN coalesce(v_closure.mission_override_active,false) THEN 'OVERRIDDEN' ELSE 'NOT_READY' END;

  v_all_ready :=
    v_guild_count>=3
    AND v_summary_count=v_guild_count
    AND v_contribution_count>0
    AND v_unresolved=0
    AND v_session_bad=0
    AND v_obs_bad=0
    AND v_mission_status IN ('READY','OVERRIDDEN')
    AND v_peer_status IN ('READY','OVERRIDDEN')
    AND v_arcade_ready
    AND v_official_status IN ('READY','OVERRIDDEN')
    AND v_four_missing=0
    AND v_territory_count=3
    AND NOT v_season_locked;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'guild_id',s.guild_id,'guild_name',g.name,'roster_count',s.scoring_roster_count,
    'individual_subtotal',s.individual_subtotal,'official_mission_gs',s.mission_gs_subtotal,
    'compensation_amount',s.compensation_amount,'manual_adjustment_total',s.manual_adjustment_total,
    'draft_gs_total',s.draft_gs_total,'draft_rank',s.draft_rank,'compensation_enabled',s.compensation_enabled
  ) ORDER BY s.draft_gs_total DESC,s.guild_id),'[]'::jsonb)
  INTO v_guilds
  FROM public.guild2_monthly_gs_summaries s JOIN public.guilds g ON g.id=s.guild_id
  WHERE s.classroom_id=p_classroom_id AND s.season_id=p_season_id AND s.year_month=p_year_month
    AND g.classroom_id=p_classroom_id AND g.season_id=p_season_id AND coalesce(g.is_active,true);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'student_id',c.student_id,'student_name',s.name,'brand_name',s.brand_name,
    'guild_id',c.scoring_guild_id,'guild_context_status',c.guild_context_status,
    'peer_points',c.peer_points,'mission_points',c.mission_points,'session_points',c.session_points,
    'observation_points',c.teacher_observation_points,'basic_total',c.basic_total,
    'arcade_raw_total',c.arcade_raw_total,'arcade_applied',c.arcade_applied,'final_total',c.final_total,
    'peer_status',c.peer_status,'mission_status',c.mission_status,'session_status',c.session_status,
    'observation_status',c.teacher_observation_status,'arcade_status',c.arcade_status
  ) ORDER BY coalesce(c.scoring_guild_id,2147483647),c.student_id),'[]'::jsonb)
  INTO v_students
  FROM public.guild2_individual_contributions c JOIN public.students s ON s.id=c.student_id
  WHERE c.classroom_id=p_classroom_id AND c.season_id=p_season_id AND c.year_month=p_year_month;

  RETURN jsonb_build_object(
    'classroom_id',p_classroom_id,'season_id',p_season_id,'year_month',p_year_month,
    'closure_id',v_closure.id,'closure_state',coalesce(v_closure.lifecycle_state,'OPEN'),
    'current_version_id',v_closure.current_version_id,'can_finalize',v_all_ready,
    'season_locked',v_season_locked,
    'readiness',jsonb_build_object(
      'guild_count',jsonb_build_object('status',CASE WHEN v_guild_count>=3 THEN 'READY' ELSE 'NOT_READY' END,'count',v_guild_count,'recommended',5),
      'roster_context',jsonb_build_object('status',CASE WHEN v_contribution_count>0 AND v_unresolved=0 THEN 'READY' ELSE 'NOT_READY' END,'contribution_count',v_contribution_count,'unresolved_count',v_unresolved),
      'session',jsonb_build_object('status',CASE WHEN v_contribution_count>0 AND v_session_bad=0 THEN 'READY' ELSE 'NOT_READY' END,'not_ready_count',v_session_bad),
      'teacher_observation',jsonb_build_object('status',CASE WHEN v_contribution_count>0 AND v_obs_bad=0 THEN 'READY' ELSE 'NOT_READY' END,'not_ready_count',v_obs_bad),
      'mission',jsonb_build_object('status',v_mission_status,'raw_ready',v_mission_ready,'override_reason',v_closure.mission_override_reason),
      'peer',jsonb_build_object('status',v_peer_status,'raw_ready',v_peer_ready,'override_reason',v_closure.peer_override_reason),
      'arcade',jsonb_build_object('status',CASE WHEN v_arcade_ready THEN 'READY' ELSE 'NOT_READY' END),
      'official_mission_gs',jsonb_build_object('status',v_official_status,'summary_count',v_summary_count,'guild_count',v_guild_count),
      'compensation_config',jsonb_build_object('status',CASE WHEN v_four_missing=0 THEN 'READY' ELSE 'NOT_READY' END,'four_member_guilds_missing_explicit_config',v_four_missing),
      'territories',jsonb_build_object('status',CASE WHEN v_territory_count=3 THEN 'READY' ELSE 'NOT_READY' END,'configured_count',v_territory_count,'required_count',3)
    ),
    'overrides',jsonb_build_object(
      'mission',jsonb_build_object('active',coalesce(v_closure.mission_override_active,false),'reason',v_closure.mission_override_reason),
      'peer',jsonb_build_object('active',coalesce(v_closure.peer_override_active,false),'reason',v_closure.peer_override_reason)
    ),
    'guilds',v_guilds,'students',v_students
  );
END $$;

-- -----------------------------------------------------------------------------
-- 5. Teacher close/config RPCs.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_guild5_close_preview(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer; v_season integer; v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  v_refresh:=public.guild2_refresh_monthly_scores(v_class,p_year_month);
  RETURN public.guild5_build_close_preview(v_class,v_season,p_year_month) || jsonb_build_object('guild2_refresh',v_refresh);
END $$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild5_override(
  p_year_month text,p_component text,p_enabled boolean,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_season integer;v_closure_id bigint;v_before jsonb;v_component text:=upper(btrim(coalesce(p_component,'')));
BEGIN
  PERFORM public.ensure_teacher_role(); v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  IF v_component NOT IN ('MISSION','PEER') THEN RAISE EXCEPTION '[G5] only MISSION/PEER override is allowed.' USING ERRCODE='P0502'; END IF;
  IF char_length(btrim(coalesce(p_reason,'')))<2 THEN RAISE EXCEPTION '[G5] override change reason is required.' USING ERRCODE='P0503'; END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=v_season) THEN RAISE EXCEPTION '[G5] season is locked.' USING ERRCODE='P0504'; END IF;
  v_closure_id:=public.guild5_get_or_create_closure(v_class,v_season,p_year_month);
  IF EXISTS(SELECT 1 FROM public.guild5_month_closures WHERE id=v_closure_id AND lifecycle_state='FINALIZED') THEN RAISE EXCEPTION '[G5] reopen the finalized month before changing override.' USING ERRCODE='P0505'; END IF;
  SELECT to_jsonb(c) INTO v_before FROM public.guild5_month_closures c WHERE id=v_closure_id;
  IF v_component='MISSION' THEN
    UPDATE public.guild5_month_closures SET mission_override_active=p_enabled,
      mission_override_reason=CASE WHEN p_enabled THEN btrim(p_reason) ELSE NULL END,updated_at=now() WHERE id=v_closure_id;
  ELSE
    UPDATE public.guild5_month_closures SET peer_override_active=p_enabled,
      peer_override_reason=CASE WHEN p_enabled THEN btrim(p_reason) ELSE NULL END,updated_at=now() WHERE id=v_closure_id;
  END IF;
  PERFORM public.guild5_write_audit(v_closure_id,NULL,v_class,'OVERRIDE_CHANGED',p_reason,v_before,
    jsonb_build_object('component',v_component,'enabled',p_enabled));
  RETURN public.guild5_build_close_preview(v_class,v_season,p_year_month);
END $$;

CREATE OR REPLACE FUNCTION public.teacher_set_guild5_territory(
  p_season_id integer,p_slot_no integer,p_territory_name text,p_description text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  IF p_slot_no NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION '[G5] territory slot must be 1..3.' USING ERRCODE='P0506'; END IF;
  IF char_length(btrim(coalesce(p_territory_name,''))) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION '[G5] territory name is required.' USING ERRCODE='P0507'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.guild_seasons s WHERE s.id=p_season_id AND s.classroom_id=v_class) THEN RAISE EXCEPTION '[G5] season mismatch.' USING ERRCODE='P0508'; END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=p_season_id) THEN RAISE EXCEPTION '[G5] season is locked.' USING ERRCODE='P0504'; END IF;
  INSERT INTO public.guild5_territories(classroom_id,season_id,slot_no,territory_name,description,updated_by_user_id,updated_at)
  VALUES(v_class,p_season_id,p_slot_no,btrim(p_territory_name),nullif(btrim(coalesce(p_description,'')),''),auth.uid(),now())
  ON CONFLICT(season_id,slot_no) DO UPDATE SET territory_name=EXCLUDED.territory_name,description=EXCLUDED.description,updated_by_user_id=auth.uid(),updated_at=now();
  RETURN (SELECT jsonb_agg(jsonb_build_object('id',id,'slot_no',slot_no,'territory_name',territory_name,'description',description) ORDER BY slot_no)
          FROM public.guild5_territories WHERE classroom_id=v_class AND season_id=p_season_id);
END $$;

CREATE OR REPLACE FUNCTION public.guild5_activate_next_turn(p_version_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_next bigint;
BEGIN
  SELECT id INTO v_next FROM public.guild5_conquest_turns
  WHERE version_id=p_version_id AND turn_status='WAITING' ORDER BY rank_position LIMIT 1 FOR UPDATE;
  IF v_next IS NULL THEN
    UPDATE public.guild5_closure_versions SET conquest_status='COMPLETE' WHERE id=p_version_id;
  ELSE
    UPDATE public.guild5_conquest_turns SET turn_status='ACTIVE',activated_at=now(),deadline_at=now()+interval '48 hours' WHERE id=v_next;
    UPDATE public.guild5_closure_versions SET conquest_status='ACTIVE' WHERE id=p_version_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guild5_create_fresh_conquest(p_version_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  DELETE FROM public.guild5_conquest_turns WHERE version_id=p_version_id;
  INSERT INTO public.guild5_conquest_turns(version_id,rank_position,guild_id,turn_status,activated_at,deadline_at)
  SELECT p_version_id,s.rank_position,s.guild_id,
         CASE WHEN s.rank_position=1 THEN 'ACTIVE' ELSE 'WAITING' END,
         CASE WHEN s.rank_position=1 THEN now() ELSE NULL END,
         CASE WHEN s.rank_position=1 THEN now()+interval '48 hours' ELSE NULL END
  FROM public.guild5_guild_snapshots s WHERE s.version_id=p_version_id AND s.rank_position BETWEEN 1 AND 3 ORDER BY s.rank_position;
  UPDATE public.guild5_closure_versions SET conquest_status='ACTIVE' WHERE id=p_version_id;
END $$;

CREATE OR REPLACE FUNCTION public.guild5_prepare_conquest(
  p_version_id bigint,p_previous_version_id bigint,p_rank_changed boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_has_assignment boolean;
BEGIN
  v_has_assignment:=p_previous_version_id IS NOT NULL AND EXISTS(
    SELECT 1 FROM public.guild5_conquest_turns WHERE version_id=p_previous_version_id AND turn_status IN ('ASSIGNED','AUTO_ASSIGNED')
  );
  IF p_previous_version_id IS NOT NULL AND p_rank_changed AND v_has_assignment THEN
    UPDATE public.guild5_closure_versions SET conquest_status='RECONQUEST_REQUIRED' WHERE id=p_version_id;
    RETURN;
  END IF;
  IF p_previous_version_id IS NOT NULL AND NOT p_rank_changed AND v_has_assignment THEN
    INSERT INTO public.guild5_conquest_turns(
      version_id,rank_position,guild_id,turn_status,territory_id,territory_name_snapshot,assignment_method,
      activated_at,deadline_at,chosen_at,source_turn_id
    )
    SELECT p_version_id,n.rank_position,n.guild_id,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.turn_status ELSE 'WAITING' END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.territory_id ELSE NULL END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.territory_name_snapshot ELSE NULL END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.assignment_method ELSE NULL END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.activated_at ELSE NULL END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.deadline_at ELSE NULL END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.chosen_at ELSE NULL END,
           CASE WHEN o.turn_status IN ('ASSIGNED','AUTO_ASSIGNED') THEN o.id ELSE NULL END
    FROM public.guild5_guild_snapshots n
    LEFT JOIN public.guild5_conquest_turns o ON o.version_id=p_previous_version_id AND o.rank_position=n.rank_position
    WHERE n.version_id=p_version_id AND n.rank_position BETWEEN 1 AND 3 ORDER BY n.rank_position;
    PERFORM public.guild5_activate_next_turn(p_version_id);
  ELSE
    PERFORM public.guild5_create_fresh_conquest(p_version_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.teacher_finalize_guild5_month(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  v_class integer;v_season integer;v_closure public.guild5_month_closures%ROWTYPE;
  v_closure_id bigint;v_previous_version_id bigint;v_version_id bigint;v_version_no integer;v_preview jsonb;
  v_tie_seed text;v_rank_changed boolean:=false;v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  PERFORM pg_advisory_xact_lock(v_class,replace(p_year_month,'-','')::integer+50000000);
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=v_season) THEN RAISE EXCEPTION '[G5] season is locked.' USING ERRCODE='P0504'; END IF;
  v_closure_id:=public.guild5_get_or_create_closure(v_class,v_season,p_year_month);
  SELECT * INTO v_closure FROM public.guild5_month_closures WHERE id=v_closure_id FOR UPDATE;
  IF v_closure.lifecycle_state='FINALIZED' THEN RAISE EXCEPTION '[G5] month is already FINALIZED. Reopen first.' USING ERRCODE='P0510'; END IF;
  v_refresh:=public.guild2_refresh_monthly_scores(v_class,p_year_month);
  v_preview:=public.guild5_build_close_preview(v_class,v_season,p_year_month);
  IF NOT coalesce((v_preview->>'can_finalize')::boolean,false) THEN
    RAISE EXCEPTION '[G5] close preview has NOT_READY blockers: %',v_preview->'readiness' USING ERRCODE='P0511';
  END IF;
  v_previous_version_id:=v_closure.current_version_id;
  SELECT coalesce(max(version_no),0)+1 INTO v_version_no FROM public.guild5_closure_versions WHERE closure_id=v_closure_id;
  v_tie_seed:=format('G5|%s|%s|%s',v_class,v_season,p_year_month);
  INSERT INTO public.guild5_closure_versions(
    closure_id,version_no,previous_version_id,readiness_snapshot,override_snapshot,tie_seed,conquest_status
  ) VALUES(v_closure_id,v_version_no,v_previous_version_id,v_preview->'readiness',v_preview->'overrides',v_tie_seed,'ACTIVE') RETURNING id INTO v_version_id;

  INSERT INTO public.guild5_student_snapshots(
    version_id,student_id,student_name_at_close,brand_name_at_close,guild_id,guild_name_at_close,role_at_close,bv_at_close,
    peer_points,mission_points,session_points,observation_points,basic_total,arcade_raw_total,arcade_applied,final_contribution,
    peer_status,mission_status,session_status,observation_status,arcade_status,source_flags
  )
  SELECT v_version_id,c.student_id,s.name::text,s.brand_name::text,c.scoring_guild_id,g.name::text,s.role::text,coalesce(w.bv,0),
         c.peer_points,c.mission_points,c.session_points,c.teacher_observation_points,c.basic_total,c.arcade_raw_total,c.arcade_applied,c.final_total,
         CASE WHEN c.peer_status='READY' THEN 'READY' ELSE 'OVERRIDDEN' END,
         CASE WHEN c.mission_status='READY' THEN 'READY' ELSE 'OVERRIDDEN' END,
         'READY','READY','READY',
         jsonb_build_object('original_peer_status',c.peer_status,'original_mission_status',c.mission_status,'formula_version',c.formula_version)
  FROM public.guild2_individual_contributions c
  JOIN public.students s ON s.id=c.student_id
  JOIN public.guilds g ON g.id=c.scoring_guild_id
  LEFT JOIN public.wallets w ON w.student_id=c.student_id
  WHERE c.classroom_id=v_class AND c.season_id=v_season AND c.year_month=p_year_month AND c.guild_context_status='RESOLVED';

  INSERT INTO public.guild5_guild_snapshots(
    version_id,guild_id,guild_name_at_close,roster_count,roster_bv_sum,individual_subtotal,official_mission_gs,
    compensation_amount,manual_adjustment_total,total_gs,deterministic_tie_value
  )
  SELECT v_version_id,ms.guild_id,g.name::text,ms.scoring_roster_count,
         coalesce((SELECT sum(ss.bv_at_close) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_version_id AND ss.guild_id=ms.guild_id),0),
         ms.individual_subtotal,ms.mission_gs_subtotal,ms.compensation_amount,ms.manual_adjustment_total,ms.draft_gs_total,
         md5(v_tie_seed||'|'||ms.guild_id::text)
  FROM public.guild2_monthly_gs_summaries ms JOIN public.guilds g ON g.id=ms.guild_id
  WHERE ms.classroom_id=v_class AND ms.season_id=v_season AND ms.year_month=p_year_month
    AND g.classroom_id=v_class AND g.season_id=v_season AND coalesce(g.is_active,true);

  WITH ranked AS (
    SELECT id,row_number() OVER(ORDER BY total_gs DESC,roster_bv_sum DESC,official_mission_gs DESC,deterministic_tie_value ASC)::integer AS rn
    FROM public.guild5_guild_snapshots WHERE version_id=v_version_id
  ) UPDATE public.guild5_guild_snapshots s SET rank_position=r.rn FROM ranked r WHERE s.id=r.id;

  IF v_previous_version_id IS NOT NULL THEN
    SELECT EXISTS(
      (SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_version_id
       EXCEPT SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_previous_version_id)
      UNION ALL
      (SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_previous_version_id
       EXCEPT SELECT guild_id,rank_position FROM public.guild5_guild_snapshots WHERE version_id=v_version_id)
    ) INTO v_rank_changed;
  END IF;
  UPDATE public.guild5_closure_versions SET rank_changed_from_previous=v_rank_changed WHERE id=v_version_id;
  PERFORM public.guild5_prepare_conquest(v_version_id,v_previous_version_id,v_rank_changed);

  UPDATE public.guild5_month_closures SET lifecycle_state='FINALIZED',current_version_id=v_version_id,updated_at=now() WHERE id=v_closure_id;

  IF to_regclass('public.hall_of_fame_entries') IS NOT NULL THEN
    UPDATE public.hall_of_fame_entries SET status='ARCHIVED'
    WHERE classroom_id=v_class AND category='GUILD_MONTHLY_WINNER' AND period_label=p_year_month AND status='ACTIVE';
    INSERT INTO public.hall_of_fame_entries(classroom_id,category,period_label,title,subtitle,guild_id,rank_position,metadata,status,created_by)
    SELECT v_class,'GUILD_MONTHLY_WINNER',p_year_month,guild_name_at_close,
           format('%s월 길드 1위 · %s GS',p_year_month,total_gs),guild_id,1,
           jsonb_build_object('source','GUILD5','closure_id',v_closure_id,'version_id',v_version_id,'version_no',v_version_no,'total_gs',total_gs),
           'ACTIVE',auth.uid()
    FROM public.guild5_guild_snapshots WHERE version_id=v_version_id AND rank_position=1;
  END IF;

  PERFORM public.guild5_write_audit(v_closure_id,v_version_id,v_class,'MONTH_FINALIZED',NULL,
    jsonb_build_object('previous_version_id',v_previous_version_id),
    jsonb_build_object('version_no',v_version_no,'rank_changed',v_rank_changed,'guild2_refresh',v_refresh));

  RETURN jsonb_build_object('closure_id',v_closure_id,'version_id',v_version_id,'version_no',v_version_no,
    'rank_changed_from_previous',v_rank_changed,'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=v_version_id));
END $$;

CREATE OR REPLACE FUNCTION public.teacher_reopen_guild5_month(p_year_month text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_season integer;v_closure public.guild5_month_closures%ROWTYPE;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  IF char_length(btrim(coalesce(p_reason,'')))<2 THEN RAISE EXCEPTION '[G5] reopen reason is required.' USING ERRCODE='P0512'; END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_season_locks WHERE season_id=v_season) THEN RAISE EXCEPTION '[G5] season lock blocks month reopen.' USING ERRCODE='P0513'; END IF;
  SELECT * INTO v_closure FROM public.guild5_month_closures
  WHERE classroom_id=v_class AND season_id=v_season AND year_month=p_year_month FOR UPDATE;
  IF NOT FOUND OR v_closure.lifecycle_state<>'FINALIZED' THEN RAISE EXCEPTION '[G5] only FINALIZED month can be reopened.' USING ERRCODE='P0514'; END IF;
  UPDATE public.guild5_month_closures SET lifecycle_state='REOPENED',updated_at=now() WHERE id=v_closure.id;
  IF to_regclass('public.hall_of_fame_entries') IS NOT NULL THEN
    UPDATE public.hall_of_fame_entries SET status='ARCHIVED'
    WHERE classroom_id=v_class AND category='GUILD_MONTHLY_WINNER' AND period_label=p_year_month AND status='ACTIVE';
  END IF;
  PERFORM public.guild5_write_audit(v_closure.id,v_closure.current_version_id,v_class,'MONTH_REOPENED',p_reason,
    jsonb_build_object('lifecycle_state','FINALIZED'),jsonb_build_object('lifecycle_state','REOPENED'));
  RETURN jsonb_build_object('closure_id',v_closure.id,'state','REOPENED','current_version_id',v_closure.current_version_id);
END $$;

-- -----------------------------------------------------------------------------
-- 6. Conquest operation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_process_due_conquest_internal(p_version_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_turn public.guild5_conquest_turns%ROWTYPE;v_territory public.guild5_territories%ROWTYPE;v_processed integer:=0;v_closure_id bigint;v_class integer;
BEGIN
  SELECT v.closure_id,c.classroom_id INTO v_closure_id,v_class
  FROM public.guild5_closure_versions v JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE v.id=p_version_id AND c.current_version_id=v.id AND c.lifecycle_state='FINALIZED';
  IF v_closure_id IS NULL THEN RETURN jsonb_build_object('processed',0,'skipped','NOT_CURRENT_FINALIZED'); END IF;
  LOOP
    SELECT * INTO v_turn FROM public.guild5_conquest_turns
    WHERE version_id=p_version_id AND turn_status='ACTIVE' AND deadline_at<=now()
    ORDER BY rank_position LIMIT 1 FOR UPDATE;
    EXIT WHEN NOT FOUND;
    SELECT t.* INTO v_territory FROM public.guild5_territories t
    JOIN public.guild5_month_closures c ON c.season_id=t.season_id
    JOIN public.guild5_closure_versions v ON v.closure_id=c.id AND v.id=p_version_id
    WHERE NOT EXISTS(SELECT 1 FROM public.guild5_conquest_turns used WHERE used.version_id=p_version_id AND used.territory_id=t.id)
    ORDER BY md5(p_version_id::text||'|'||v_turn.rank_position::text||'|'||t.id::text) LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION '[G5] no territory remains for auto assignment.' USING ERRCODE='P0520'; END IF;
    UPDATE public.guild5_conquest_turns SET turn_status='AUTO_ASSIGNED',territory_id=v_territory.id,
      territory_name_snapshot=v_territory.territory_name,assignment_method='AUTO',chosen_at=now() WHERE id=v_turn.id;
    PERFORM public.guild5_write_audit(v_closure_id,p_version_id,v_class,'CONQUEST_AUTO_ASSIGNED','선택 기한 만료',
      jsonb_build_object('turn_id',v_turn.id,'rank',v_turn.rank_position),jsonb_build_object('territory_id',v_territory.id,'territory_name',v_territory.territory_name));
    v_processed:=v_processed+1;
    PERFORM public.guild5_activate_next_turn(p_version_id);
  END LOOP;
  RETURN jsonb_build_object('processed',v_processed,'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=p_version_id));
END $$;

CREATE OR REPLACE FUNCTION public.teacher_process_guild5_due_conquest(p_version_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  IF NOT EXISTS(SELECT 1 FROM public.guild5_closure_versions v JOIN public.guild5_month_closures c ON c.id=v.closure_id WHERE v.id=p_version_id AND c.classroom_id=v_class) THEN
    RAISE EXCEPTION '[G5] version not found in classroom.' USING ERRCODE='P0521';
  END IF;
  RETURN public.guild5_process_due_conquest_internal(p_version_id);
END $$;

CREATE OR REPLACE FUNCTION public.teacher_choose_guild5_territory(p_turn_id bigint,p_territory_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_turn public.guild5_conquest_turns%ROWTYPE;v_territory public.guild5_territories%ROWTYPE;v_closure_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  SELECT t.* INTO v_turn
  FROM public.guild5_conquest_turns t JOIN public.guild5_closure_versions v ON v.id=t.version_id
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE t.id=p_turn_id AND c.classroom_id=v_class
    AND c.current_version_id=v.id AND c.lifecycle_state='FINALIZED'
  FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION '[G5] conquest turn not found.' USING ERRCODE='P0522'; END IF;
  SELECT v.closure_id INTO v_closure_id FROM public.guild5_closure_versions v WHERE v.id=v_turn.version_id;
  PERFORM public.guild5_process_due_conquest_internal(v_turn.version_id);
  SELECT * INTO v_turn FROM public.guild5_conquest_turns WHERE id=p_turn_id FOR UPDATE;
  IF v_turn.turn_status<>'ACTIVE' THEN RAISE EXCEPTION '[G5] only current ACTIVE rank may choose.' USING ERRCODE='P0523'; END IF;
  SELECT t.* INTO v_territory
  FROM public.guild5_territories t
  JOIN public.guild5_closure_versions v ON v.id=v_turn.version_id
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE t.id=p_territory_id AND t.classroom_id=c.classroom_id AND t.season_id=c.season_id;
  IF NOT FOUND OR EXISTS(SELECT 1 FROM public.guild5_conquest_turns WHERE version_id=v_turn.version_id AND territory_id=p_territory_id) THEN
    RAISE EXCEPTION '[G5] territory is unavailable.' USING ERRCODE='P0524';
  END IF;
  UPDATE public.guild5_conquest_turns SET turn_status='ASSIGNED',territory_id=v_territory.id,
    territory_name_snapshot=v_territory.territory_name,assignment_method='MANUAL',chosen_at=now() WHERE id=v_turn.id;
  PERFORM public.guild5_write_audit(v_closure_id,v_turn.version_id,v_class,'CONQUEST_MANUAL_ASSIGNED',NULL,
    jsonb_build_object('turn_id',v_turn.id,'rank',v_turn.rank_position),jsonb_build_object('territory_id',v_territory.id,'territory_name',v_territory.territory_name));
  PERFORM public.guild5_activate_next_turn(v_turn.version_id);
  RETURN jsonb_build_object('turn_id',v_turn.id,'territory_id',v_territory.id,'territory_name',v_territory.territory_name,
    'conquest_status',(SELECT conquest_status FROM public.guild5_closure_versions WHERE id=v_turn.version_id));
END $$;

CREATE OR REPLACE FUNCTION public.teacher_start_guild5_reconquest(p_version_id bigint,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_closure_id bigint;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  IF char_length(btrim(coalesce(p_reason,'')))<2 THEN RAISE EXCEPTION '[G5] reconquest reason is required.' USING ERRCODE='P0525'; END IF;
  SELECT v.closure_id INTO v_closure_id FROM public.guild5_closure_versions v JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE v.id=p_version_id AND c.classroom_id=v_class AND c.current_version_id=v.id AND c.lifecycle_state='FINALIZED'
    AND v.conquest_status='RECONQUEST_REQUIRED';
  IF v_closure_id IS NULL THEN RAISE EXCEPTION '[G5] current version does not require reconquest.' USING ERRCODE='P0526'; END IF;
  PERFORM public.guild5_create_fresh_conquest(p_version_id);
  PERFORM public.guild5_write_audit(v_closure_id,p_version_id,v_class,'RECONQUEST_STARTED',p_reason,'{}'::jsonb,jsonb_build_object('status','ACTIVE'));
  RETURN jsonb_build_object('version_id',p_version_id,'conquest_status','ACTIVE');
END $$;

CREATE OR REPLACE FUNCTION public.teacher_lock_guild5_season(p_season_id integer,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_status text;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  IF char_length(btrim(coalesce(p_reason,'')))<2 THEN RAISE EXCEPTION '[G5] season lock reason is required.' USING ERRCODE='P0530'; END IF;
  SELECT lifecycle_status INTO v_status FROM public.guild_seasons WHERE id=p_season_id AND classroom_id=v_class FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION '[G5] season not found.' USING ERRCODE='P0531'; END IF;
  IF v_status<>'CLOSED' THEN RAISE EXCEPTION '[G5] close the Guild season before season lock.' USING ERRCODE='P0532'; END IF;
  IF EXISTS(SELECT 1 FROM public.guild5_month_closures WHERE classroom_id=v_class AND season_id=p_season_id AND lifecycle_state='REOPENED') THEN
    RAISE EXCEPTION '[G5] a reopened month must be finalized before season lock.' USING ERRCODE='P0533';
  END IF;
  INSERT INTO public.guild5_season_locks(classroom_id,season_id,lock_reason) VALUES(v_class,p_season_id,btrim(p_reason))
  ON CONFLICT(season_id) DO NOTHING;
  RETURN jsonb_build_object('season_id',p_season_id,'locked',true);
END $$;

-- -----------------------------------------------------------------------------
-- 7. Dashboard/student reads.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_get_guild5_dashboard(p_year_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_season integer;v_preview jsonb;v_closure public.guild5_month_closures%ROWTYPE;v_current bigint;v_result jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();v_season:=public.guild2_resolve_season_for_month(v_class,p_year_month);
  PERFORM public.guild2_refresh_monthly_scores(v_class,p_year_month);
  v_preview:=public.guild5_build_close_preview(v_class,v_season,p_year_month);
  SELECT * INTO v_closure FROM public.guild5_month_closures WHERE classroom_id=v_class AND season_id=v_season AND year_month=p_year_month;
  v_current:=v_closure.current_version_id;
  IF v_current IS NOT NULL AND v_closure.lifecycle_state='FINALIZED' THEN PERFORM public.guild5_process_due_conquest_internal(v_current); END IF;
  SELECT jsonb_build_object(
    'preview',v_preview,
    'season',(SELECT to_jsonb(s) FROM (SELECT id,display_name,school_year,starts_on,ends_on,lifecycle_status FROM public.guild_seasons WHERE id=v_season) s),
    'season_lock',(SELECT to_jsonb(sl) FROM public.guild5_season_locks sl WHERE sl.season_id=v_season),
    'is_test_fixture',EXISTS(SELECT 1 FROM public.test_classroom_fixtures f WHERE f.classroom_id=v_class AND f.fixture_code='BRAND_TEST_V1'),
    'territories',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY slot_no) FROM public.guild5_territories t WHERE t.classroom_id=v_class AND t.season_id=v_season),'[]'::jsonb),
    'closure',CASE WHEN v_closure.id IS NULL THEN NULL ELSE to_jsonb(v_closure) END,
    'versions',coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY version_no DESC) FROM public.guild5_closure_versions v WHERE v.closure_id=v_closure.id),'[]'::jsonb),
    'guild_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(gs) ORDER BY rank_position) FROM public.guild5_guild_snapshots gs WHERE gs.version_id=v_current),'[]'::jsonb),
    'student_snapshots',coalesce((SELECT jsonb_agg(to_jsonb(ss) ORDER BY guild_id,student_id) FROM public.guild5_student_snapshots ss WHERE ss.version_id=v_current),'[]'::jsonb),
    'conquest_turns',coalesce((SELECT jsonb_agg(to_jsonb(ct) ORDER BY rank_position) FROM public.guild5_conquest_turns ct WHERE ct.version_id=v_current),'[]'::jsonb),
    'audit',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY occurred_at DESC,id DESC) FROM public.guild5_audit_events a WHERE a.closure_id=v_closure.id),'[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.student_get_guild5_monthly_history()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_student integer;v_class integer;v_result jsonb;
BEGIN
  v_student:=public.current_student_id();v_class:=public.current_classroom_id();
  IF v_student IS NULL OR v_class IS NULL THEN RAISE EXCEPTION '[G5] student context missing.' USING ERRCODE='P0540'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY item->>'year_month' DESC),'[]'::jsonb) INTO v_result
  FROM (
    SELECT jsonb_build_object(
      'year_month',c.year_month,'version_no',v.version_no,'finalized_at',v.finalized_at,
      'my_contribution',to_jsonb(ss),
      'my_guild',to_jsonb(gs) || jsonb_build_object(
        'cumulative_final_gs',(SELECT coalesce(sum(gs2.total_gs),0) FROM public.guild5_month_closures c2
          JOIN public.guild5_guild_snapshots gs2 ON gs2.version_id=c2.current_version_id
          WHERE c2.classroom_id=v_class AND c2.lifecycle_state='FINALIZED' AND gs2.guild_id=ss.guild_id)
      ),
      'territory',(SELECT to_jsonb(ct) FROM public.guild5_conquest_turns ct WHERE ct.version_id=v.id AND ct.guild_id=ss.guild_id AND ct.turn_status IN ('ASSIGNED','AUTO_ASSIGNED')),
      'rankings',(SELECT coalesce(jsonb_agg(jsonb_build_object('guild_id',r.guild_id,'guild_name_at_close',r.guild_name_at_close,'rank_position',r.rank_position,'total_gs',r.total_gs,'territory',(SELECT ct2.territory_name_snapshot FROM public.guild5_conquest_turns ct2 WHERE ct2.version_id=v.id AND ct2.guild_id=r.guild_id AND ct2.turn_status IN ('ASSIGNED','AUTO_ASSIGNED'))) ORDER BY r.rank_position),'[]'::jsonb) FROM public.guild5_guild_snapshots r WHERE r.version_id=v.id)
    ) AS item
    FROM public.guild5_month_closures c
    JOIN public.guild5_closure_versions v ON v.id=c.current_version_id
    JOIN public.guild5_student_snapshots ss ON ss.version_id=v.id AND ss.student_id=v_student
    JOIN public.guild5_guild_snapshots gs ON gs.version_id=v.id AND gs.guild_id=ss.guild_id
    WHERE c.classroom_id=v_class AND c.lifecycle_state='FINALIZED'
  ) q;
  RETURN v_result;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Guild3 empty-guild hardening required before TEST multi-guild simulation.
--    Only guilds with at least one eligible active member get an instance.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.teacher_publish_guild3_mission(p_mission_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_classroom_id integer;v_mission public.guild3_missions%ROWTYPE;v_instance_count integer;v_participant_count integer;v_refresh jsonb;
BEGIN
  PERFORM public.ensure_teacher_role();v_classroom_id:=public.current_classroom_id();
  SELECT * INTO v_mission FROM public.guild3_missions WHERE id=p_mission_id FOR UPDATE;
  IF NOT FOUND OR v_mission.classroom_id IS DISTINCT FROM v_classroom_id THEN RAISE EXCEPTION '[G3] mission was not found in this classroom.' USING ERRCODE='P0316'; END IF;
  IF v_mission.lifecycle_state<>'DRAFT' THEN RAISE EXCEPTION '[G3] only a DRAFT mission can be published.' USING ERRCODE='P0321'; END IF;
  IF v_mission.season_id IS DISTINCT FROM public.guild2_resolve_season_for_month(v_classroom_id,v_mission.contribution_year_month) THEN RAISE EXCEPTION '[G3] mission season no longer matches its contribution month.' USING ERRCODE='P0322'; END IF;
  INSERT INTO public.guild3_mission_instances(mission_id,classroom_id,season_id,guild_id,special_rule_note)
  SELECT v_mission.id,v_mission.classroom_id,v_mission.season_id,g.id,NULL
  FROM public.guilds g
  WHERE g.classroom_id=v_mission.classroom_id AND g.season_id=v_mission.season_id AND coalesce(g.is_active,true)
    AND EXISTS(
      SELECT 1 FROM public.guild_members gm JOIN public.students s ON s.id=gm.student_id
      WHERE gm.guild_id=g.id AND gm.season_id=v_mission.season_id AND gm.left_at IS NULL
        AND s.classroom_id=v_mission.classroom_id AND s.transferred_at IS NULL AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
    );
  GET DIAGNOSTICS v_instance_count=ROW_COUNT;
  INSERT INTO public.guild3_mission_participants(
    mission_id,mission_instance_id,classroom_id,season_id,guild_id,student_id,membership_id,student_name_at_snapshot,guild_name_at_snapshot,
    assigned_element_at_snapshot,membership_joined_at_at_snapshot,snapshot_at
  )
  SELECT v_mission.id,i.id,v_mission.classroom_id,v_mission.season_id,i.guild_id,s.id,gm.id,s.name::text,g.name::text,gm.element::text,gm.joined_at,now()
  FROM public.guild3_mission_instances i JOIN public.guilds g ON g.id=i.guild_id
  JOIN public.guild_members gm ON gm.guild_id=i.guild_id AND gm.season_id=v_mission.season_id AND gm.left_at IS NULL
  JOIN public.students s ON s.id=gm.student_id AND s.classroom_id=v_mission.classroom_id AND s.transferred_at IS NULL AND s.role::text IN ('STUDENT','STUDENT_LEADER','GUARD')
  WHERE i.mission_id=v_mission.id;
  GET DIAGNOSTICS v_participant_count=ROW_COUNT;
  IF v_instance_count=0 OR v_participant_count=0 THEN RAISE EXCEPTION '[G3] an official mission needs at least one active guild and participant snapshot.' USING ERRCODE='P0323'; END IF;
  UPDATE public.guild3_missions SET lifecycle_state='ACTIVE',published_at=now() WHERE id=v_mission.id RETURNING * INTO v_mission;
  PERFORM public.guild3_write_audit_event(v_mission.id,NULL,NULL,v_classroom_id,'MISSION_PUBLISHED',NULL,jsonb_build_object('lifecycle_state','DRAFT'),jsonb_build_object('lifecycle_state','ACTIVE','instance_count',v_instance_count,'participant_count',v_participant_count));
  v_refresh:=public.guild2_refresh_monthly_scores(v_classroom_id,v_mission.contribution_year_month);
  RETURN jsonb_build_object('mission_id',v_mission.id,'lifecycle_state',v_mission.lifecycle_state,'instance_count',v_instance_count,'participant_count',v_participant_count,'guild2_refresh',v_refresh);
END $$;

-- TEST helper: add four empty simulation guilds. They are deliberately empty;
-- Guild3 hardening above prevents them from becoming fake mission participants.
CREATE OR REPLACE FUNCTION public.teacher_prepare_guild5_test_guilds()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_fixture public.test_classroom_fixtures%ROWTYPE;v_name text;v_created integer:=0;i integer;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  SELECT * INTO v_fixture FROM public.test_classroom_fixtures WHERE fixture_code='BRAND_TEST_V1' AND classroom_id=v_class;
  IF NOT FOUND THEN RAISE EXCEPTION '[G5 TEST] current classroom is not BRAND_TEST_V1.' USING ERRCODE='P0590'; END IF;
  FOR i IN 2..5 LOOP
    v_name:=format('TEST GUILD %s',i);
    IF NOT EXISTS(SELECT 1 FROM public.guilds WHERE classroom_id=v_class AND season_id=v_fixture.season_id AND lower(name)=lower(v_name)) THEN
      PERFORM public.teacher_create_guild(v_name,'Guild5 ranking/conquest simulation',NULL,NULL,true);
      v_created:=v_created+1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('created',v_created,'active_guild_count',(SELECT count(*) FROM public.guilds WHERE classroom_id=v_class AND season_id=v_fixture.season_id AND coalesce(is_active,true)));
END $$;

-- TEST fixture only: expire the current active conquest turn immediately so auto-assignment can be E2E-tested without waiting 48h.
CREATE OR REPLACE FUNCTION public.teacher_force_guild5_test_turn_due(p_turn_id bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_class integer;v_version bigint;
BEGIN
  PERFORM public.ensure_teacher_role();v_class:=public.current_classroom_id();
  IF NOT EXISTS(SELECT 1 FROM public.test_classroom_fixtures f WHERE f.classroom_id=v_class AND f.fixture_code='BRAND_TEST_V1') THEN
    RAISE EXCEPTION '[G5] test-only helper is unavailable outside BRAND_TEST_V1.' USING ERRCODE='P0545';
  END IF;
  SELECT t.version_id INTO v_version
  FROM public.guild5_conquest_turns t
  JOIN public.guild5_closure_versions v ON v.id=t.version_id
  JOIN public.guild5_month_closures c ON c.id=v.closure_id
  WHERE t.id=p_turn_id AND c.classroom_id=v_class AND c.current_version_id=v.id
    AND c.lifecycle_state='FINALIZED' AND t.turn_status='ACTIVE'
  FOR UPDATE OF t;
  IF v_version IS NULL THEN RAISE EXCEPTION '[G5] active current test conquest turn not found.' USING ERRCODE='P0546'; END IF;
  UPDATE public.guild5_conquest_turns SET deadline_at=now()-interval '1 minute' WHERE id=p_turn_id;
  RETURN public.guild5_process_due_conquest_internal(v_version);
END $$;

-- -----------------------------------------------------------------------------
-- 9. FINAL/REOPEN correction freeze guards.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guild5_guard_guild3_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_mission_id bigint;v_class integer;v_season integer;v_month text;v_reset text;v_new jsonb;v_old jsonb;
BEGIN
  v_new:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_old:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  IF TG_TABLE_NAME='guild3_missions' THEN
    -- INSERT cannot look the just-created mission up yet; use NEW directly.
    IF TG_OP='INSERT' THEN
      v_class:=(v_new->>'classroom_id')::integer;
      v_season:=(v_new->>'season_id')::integer;
      v_month:=v_new->>'contribution_year_month';
    ELSE
      v_mission_id:=coalesce((v_new->>'id')::bigint,(v_old->>'id')::bigint);
      SELECT classroom_id,season_id,contribution_year_month INTO v_class,v_season,v_month
      FROM public.guild3_missions WHERE id=v_mission_id;
    END IF;
  ELSE
    v_mission_id:=coalesce((v_new->>'mission_id')::bigint,(v_old->>'mission_id')::bigint);
    SELECT classroom_id,season_id,contribution_year_month INTO v_class,v_season,v_month
    FROM public.guild3_missions WHERE id=v_mission_id;
  END IF;
  v_reset:=current_setting('brand.test_fixture_reset_classroom_id',true);
  IF coalesce(v_reset,'')=coalesce(v_class::text,'') THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF v_class IS NOT NULL AND public.guild5_month_is_frozen(v_class,v_season,v_month) THEN
    RAISE EXCEPTION '[G5] Guild3 source is frozen by monthly FINAL/season lock. Reopen the month first.' USING ERRCODE='P0550';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.guild5_guard_guild4_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_round_id bigint;v_mission_id bigint;v_class integer;v_season integer;v_month text;v_reset text;v_new jsonb;v_old jsonb;
BEGIN
  v_new:=CASE WHEN TG_OP='DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  v_old:=CASE WHEN TG_OP='INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  IF TG_TABLE_NAME='guild4_peer_review_rounds' THEN
    IF TG_OP='INSERT' THEN
      v_class:=(v_new->>'classroom_id')::integer;
      v_season:=(v_new->>'season_id')::integer;
      v_mission_id:=(v_new->>'mission_id')::bigint;
      SELECT contribution_year_month INTO v_month FROM public.guild3_missions WHERE id=v_mission_id;
    ELSE
      v_round_id:=coalesce((v_new->>'id')::bigint,(v_old->>'id')::bigint);
      SELECT r.classroom_id,r.season_id,m.contribution_year_month INTO v_class,v_season,v_month
      FROM public.guild4_peer_review_rounds r JOIN public.guild3_missions m ON m.id=r.mission_id WHERE r.id=v_round_id;
    END IF;
  ELSE
    v_round_id:=coalesce((v_new->>'round_id')::bigint,(v_old->>'round_id')::bigint);
    SELECT r.classroom_id,r.season_id,m.contribution_year_month INTO v_class,v_season,v_month
    FROM public.guild4_peer_review_rounds r JOIN public.guild3_missions m ON m.id=r.mission_id WHERE r.id=v_round_id;
  END IF;
  v_reset:=current_setting('brand.test_fixture_reset_classroom_id',true);
  IF coalesce(v_reset,'')=coalesce(v_class::text,'') THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF v_class IS NOT NULL AND public.guild5_month_is_frozen(v_class,v_season,v_month) THEN
    RAISE EXCEPTION '[G5] Guild4 source is frozen by monthly FINAL/season lock. Reopen the month first.' USING ERRCODE='P0551';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;

DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['guild3_missions','guild3_mission_instances','guild3_mission_participants','guild3_mission_submissions','guild3_mission_activity_records','guild3_mission_grade_events','guild3_mission_judgment_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_g5_freeze_%I ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_g5_freeze_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guild5_guard_guild3_mutation()',t,t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['guild4_peer_review_rounds','guild4_peer_review_obligations','guild4_peer_review_revisions','guild4_peer_review_exception_events','guild4_peer_review_penalties','guild4_peer_review_score_rollups'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_g5_freeze_%I ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_g5_freeze_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guild5_guard_guild4_mutation()',t,t);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 10. TEST reset extension: Guild5 must be cleared before Guild4 -> Guild3 -> Guild2.
--     Preserve the existing proven reset body under an internal name and wrap it.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.teacher_reset_test_classroom_fixture()
  RENAME TO guild5_preexisting_teacher_reset_test_classroom_fixture;
REVOKE ALL ON FUNCTION public.guild5_preexisting_teacher_reset_test_classroom_fixture() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.teacher_reset_test_classroom_fixture()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_fixture public.test_classroom_fixtures%ROWTYPE;v_result jsonb;v_g5 jsonb:='{}'::jsonb;v_count bigint;v_remaining bigint;
BEGIN
  PERFORM public.ensure_teacher_role();
  SELECT * INTO v_fixture FROM public.test_classroom_fixtures WHERE fixture_code='BRAND_TEST_V1' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '[TEST] registered BRAND_TEST_V1 fixture not found.' USING ERRCODE='P0619'; END IF;
  PERFORM set_config('brand.test_fixture_reset_classroom_id',v_fixture.classroom_id::text,true);

  -- HoF is a projection of Guild5 FINAL; remove only Guild5-owned TEST entries.
  DELETE FROM public.hall_of_fame_entries
  WHERE classroom_id=v_fixture.classroom_id AND category='GUILD_MONTHLY_WINNER';
  GET DIAGNOSTICS v_count=ROW_COUNT;v_g5:=v_g5||jsonb_build_object('hall_of_fame_entries',v_count);

  -- Break the closure -> current version pointer first; closure delete then cascades versions/snapshots/turns.
  UPDATE public.guild5_month_closures SET current_version_id=NULL WHERE classroom_id=v_fixture.classroom_id;
  DELETE FROM public.guild5_month_closures WHERE classroom_id=v_fixture.classroom_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;v_g5:=v_g5||jsonb_build_object('month_closures',v_count);
  DELETE FROM public.guild5_audit_events WHERE classroom_id=v_fixture.classroom_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;v_g5:=v_g5||jsonb_build_object('orphan_audit_events',v_count);
  DELETE FROM public.guild5_territories WHERE classroom_id=v_fixture.classroom_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;v_g5:=v_g5||jsonb_build_object('territories',v_count);
  DELETE FROM public.guild5_season_locks WHERE classroom_id=v_fixture.classroom_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;v_g5:=v_g5||jsonb_build_object('season_locks',v_count);

  -- Existing reset now safely handles Guild4(cascade from openings), Guild3, Arcade, Guild2 and Guild1 runtime.
  v_result:=public.guild5_preexisting_teacher_reset_test_classroom_fixture();

  -- Remove only Guild5 simulation guilds; TEST GUILD itself and TEST01~05 stay intact.
  DELETE FROM public.guilds g
  WHERE g.classroom_id=v_fixture.classroom_id AND g.season_id=v_fixture.season_id
    AND g.name IN ('TEST GUILD 2','TEST GUILD 3','TEST GUILD 4','TEST GUILD 5')
    AND NOT EXISTS(SELECT 1 FROM public.guild_members gm WHERE gm.guild_id=g.id);
  GET DIAGNOSTICS v_count=ROW_COUNT;v_g5:=v_g5||jsonb_build_object('simulation_guilds',v_count);

  SELECT (SELECT count(*) FROM public.guild5_month_closures WHERE classroom_id=v_fixture.classroom_id)
       + (SELECT count(*) FROM public.guild5_audit_events WHERE classroom_id=v_fixture.classroom_id)
       + (SELECT count(*) FROM public.guild5_territories WHERE classroom_id=v_fixture.classroom_id)
       + (SELECT count(*) FROM public.guild5_season_locks WHERE classroom_id=v_fixture.classroom_id)
  INTO v_remaining;
  IF v_remaining<>0 THEN RAISE EXCEPTION '[TEST] Guild5 reset verification found % leftover rows.',v_remaining USING ERRCODE='P0622'; END IF;

  RETURN v_result || jsonb_build_object('guild5_deleted_row_counts',v_g5,'guild5_remaining_rows',v_remaining);
END $$;

-- -----------------------------------------------------------------------------
-- 11. Function ACLs.
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.guild5_write_audit(bigint,bigint,integer,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_get_or_create_closure(integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_month_is_frozen(integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_build_close_preview(integer,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_activate_next_turn(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_create_fresh_conquest(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_prepare_conquest(bigint,bigint,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_process_due_conquest_internal(bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_guard_guild3_mutation() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.guild5_guard_guild4_mutation() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guild5_write_audit(bigint,bigint,integer,text,text,jsonb,jsonb),
  public.guild5_get_or_create_closure(integer,integer,text),public.guild5_month_is_frozen(integer,integer,text),
  public.guild5_build_close_preview(integer,integer,text),public.guild5_activate_next_turn(bigint),
  public.guild5_create_fresh_conquest(bigint),public.guild5_prepare_conquest(bigint,bigint,boolean),
  public.guild5_process_due_conquest_internal(bigint),public.guild5_guard_guild3_mutation(),public.guild5_guard_guild4_mutation()
TO service_role;

REVOKE ALL ON FUNCTION public.teacher_get_guild5_close_preview(text),public.teacher_set_guild5_override(text,text,boolean,text),
  public.teacher_set_guild5_territory(integer,integer,text,text),public.teacher_finalize_guild5_month(text),
  public.teacher_reopen_guild5_month(text,text),public.teacher_process_guild5_due_conquest(bigint),
  public.teacher_choose_guild5_territory(bigint,bigint),public.teacher_start_guild5_reconquest(bigint,text),
  public.teacher_lock_guild5_season(integer,text),public.teacher_get_guild5_dashboard(text),public.teacher_prepare_guild5_test_guilds(),
  public.teacher_force_guild5_test_turn_due(bigint)
FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_get_guild5_close_preview(text),public.teacher_set_guild5_override(text,text,boolean,text),
  public.teacher_set_guild5_territory(integer,integer,text,text),public.teacher_finalize_guild5_month(text),
  public.teacher_reopen_guild5_month(text,text),public.teacher_process_guild5_due_conquest(bigint),
  public.teacher_choose_guild5_territory(bigint,bigint),public.teacher_start_guild5_reconquest(bigint,text),
  public.teacher_lock_guild5_season(integer,text),public.teacher_get_guild5_dashboard(text),public.teacher_prepare_guild5_test_guilds(),
  public.teacher_force_guild5_test_turn_due(bigint)
TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.teacher_reset_test_classroom_fixture() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.teacher_reset_test_classroom_fixture() TO authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.guild5_preexisting_teacher_reset_test_classroom_fixture() TO service_role;

REVOKE ALL ON FUNCTION public.student_get_guild5_monthly_history() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.student_get_guild5_monthly_history() TO authenticated,service_role;

-- The hardened Guild3 publish remains teacher-only.
REVOKE ALL ON FUNCTION public.teacher_publish_guild3_mission(bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.teacher_publish_guild3_mission(bigint) TO authenticated,service_role;

COMMIT;
