-- Verbatim production DDL for arcade_* / tikatuka_* tables (2026-10-30, read-only introspection).
CREATE TABLE public.arcade_analytics_game_semantics (
  game_id bigint NOT NULL,
  comparison_mode text NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_analytics_game_semantics ADD CONSTRAINT arcade_analytics_game_semantics_pkey PRIMARY KEY (game_id);
ALTER TABLE public.arcade_analytics_game_semantics ADD CONSTRAINT arcade_analytics_game_semantics_comparison_mode_check CHECK ((comparison_mode = ANY (ARRAY['HIGHER_SCORE_BETTER'::text, 'LOWER_SCORE_BETTER'::text, 'CUSTOM'::text])));
CREATE TABLE public.arcade_game_rule_versions (
  id bigint DEFAULT nextval('arcade_game_rule_versions_id_seq'::regclass) NOT NULL,
  game_id bigint NOT NULL,
  version_code text NOT NULL,
  config jsonb NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_by_user_id uuid DEFAULT auth.uid(),
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_game_rule_versions ADD CONSTRAINT arcade_game_rule_version_unique UNIQUE (game_id, version_code);
ALTER TABLE public.arcade_game_rule_versions ADD CONSTRAINT arcade_game_rule_versions_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_game_rule_versions ADD CONSTRAINT arcade_game_rule_versions_config_object_check CHECK ((jsonb_typeof(config) = 'object'::text));
ALTER TABLE public.arcade_game_rule_versions ADD CONSTRAINT arcade_game_rule_versions_version_code_check CHECK ((version_code ~ '^[A-Za-z0-9._-]{1,80}$'::text));
CREATE UNIQUE INDEX arcade_game_rule_versions_one_active_per_game ON public.arcade_game_rule_versions USING btree (game_id) WHERE is_active;
CREATE TABLE public.arcade_games (
  id bigint DEFAULT nextval('arcade_games_id_seq'::regclass) NOT NULL,
  code text NOT NULL,
  internal_name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  available_from date NOT NULL,
  available_until date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_games ADD CONSTRAINT arcade_games_code_unique UNIQUE (code);
ALTER TABLE public.arcade_games ADD CONSTRAINT arcade_games_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_games ADD CONSTRAINT arcade_games_availability_check CHECK (((available_until IS NULL) OR (available_until >= available_from)));
ALTER TABLE public.arcade_games ADD CONSTRAINT arcade_games_code_format_check CHECK ((code ~ '^[a-z][a-z0-9_]{2,63}$'::text));
CREATE TABLE public.arcade_monthly_finalizations (
  id bigint DEFAULT nextval('arcade_monthly_finalizations_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  contribution_year_month character varying(7) NOT NULL,
  eligible_game_count integer NOT NULL,
  finalized_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  finalized_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_monthly_finalizations ADD CONSTRAINT arcade_monthly_finalizations_period_unique UNIQUE (period_id);
ALTER TABLE public.arcade_monthly_finalizations ADD CONSTRAINT arcade_monthly_finalizations_scope_unique UNIQUE (classroom_id, contribution_year_month);
ALTER TABLE public.arcade_monthly_finalizations ADD CONSTRAINT arcade_monthly_finalizations_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_monthly_finalizations ADD CONSTRAINT arcade_monthly_finalizations_game_count_check CHECK ((eligible_game_count >= 0));
ALTER TABLE public.arcade_monthly_finalizations ADD CONSTRAINT arcade_monthly_finalizations_month_check CHECK (((contribution_year_month)::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text));
CREATE TABLE public.arcade_monthly_snapshot_entries (
  id bigint DEFAULT nextval('arcade_monthly_snapshot_entries_id_seq'::regclass) NOT NULL,
  snapshot_id bigint NOT NULL,
  student_id integer NOT NULL,
  source_run_id bigint NOT NULL,
  rank integer NOT NULL,
  official_score bigint NOT NULL,
  achieved_at timestamp with time zone NOT NULL,
  raw_bonus numeric(8,2) NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  student_name_at_close text,
  brand_name_at_close text
);
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_rank_unique UNIQUE (snapshot_id, rank);
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_source_run_unique UNIQUE (snapshot_id, source_run_id);
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_student_unique UNIQUE (snapshot_id, student_id);
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_bonus_check CHECK ((((rank = 1) AND (raw_bonus = (30)::numeric)) OR ((rank = 2) AND (raw_bonus = (27)::numeric)) OR ((rank = 3) AND (raw_bonus = (24)::numeric)) OR (((rank >= 4) AND (rank <= 6)) AND (raw_bonus = (18)::numeric)) OR (((rank >= 7) AND (rank <= 10)) AND (raw_bonus = (15)::numeric))));
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_rank_check CHECK (((rank >= 1) AND (rank <= 10)));
ALTER TABLE public.arcade_monthly_snapshot_entries ADD CONSTRAINT arcade_monthly_snapshot_entries_score_check CHECK ((official_score >= 0));
CREATE INDEX ix_arcade_monthly_snapshot_entries_student ON public.arcade_monthly_snapshot_entries USING btree (student_id, achieved_at DESC);
CREATE TABLE public.arcade_monthly_snapshot_student_ranks (
  id bigint DEFAULT nextval('arcade_monthly_snapshot_student_ranks_id_seq'::regclass) NOT NULL,
  snapshot_id bigint NOT NULL,
  student_id integer NOT NULL,
  source_run_id bigint NOT NULL,
  rank integer NOT NULL,
  official_score bigint NOT NULL,
  achieved_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  student_name_at_close text,
  brand_name_at_close text
);
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ADD CONSTRAINT arcade_monthly_snapshot_student_ranks_rank_unique UNIQUE (snapshot_id, rank);
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ADD CONSTRAINT arcade_monthly_snapshot_student_ranks_source_run_unique UNIQUE (snapshot_id, source_run_id);
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ADD CONSTRAINT arcade_monthly_snapshot_student_ranks_student_unique UNIQUE (snapshot_id, student_id);
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ADD CONSTRAINT arcade_monthly_snapshot_student_ranks_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ADD CONSTRAINT arcade_monthly_snapshot_student_ranks_rank_check CHECK ((rank >= 1));
ALTER TABLE public.arcade_monthly_snapshot_student_ranks ADD CONSTRAINT arcade_monthly_snapshot_student_ranks_score_check CHECK ((official_score >= 0));
CREATE INDEX ix_arcade_monthly_snapshot_student_ranks_student ON public.arcade_monthly_snapshot_student_ranks USING btree (student_id, achieved_at DESC);
CREATE TABLE public.arcade_monthly_snapshots (
  id bigint DEFAULT nextval('arcade_monthly_snapshots_id_seq'::regclass) NOT NULL,
  finalization_id bigint NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint NOT NULL,
  contribution_year_month character varying(7) NOT NULL,
  created_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  game_code_at_close text,
  game_name_at_close text
);
ALTER TABLE public.arcade_monthly_snapshots ADD CONSTRAINT arcade_monthly_snapshots_finalization_game_unique UNIQUE (finalization_id, game_id);
ALTER TABLE public.arcade_monthly_snapshots ADD CONSTRAINT arcade_monthly_snapshots_period_game_unique UNIQUE (period_id, game_id);
ALTER TABLE public.arcade_monthly_snapshots ADD CONSTRAINT arcade_monthly_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_monthly_snapshots ADD CONSTRAINT arcade_monthly_snapshots_month_check CHECK (((contribution_year_month)::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text));
CREATE INDEX ix_arcade_monthly_snapshots_classroom_month ON public.arcade_monthly_snapshots USING btree (classroom_id, contribution_year_month, game_id);
CREATE TABLE public.arcade_prerelease_test_access (
  id bigint DEFAULT nextval('arcade_prerelease_test_access_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  student_id integer NOT NULL,
  game_id bigint NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  created_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  updated_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_prerelease_test_access ADD CONSTRAINT arcade_prerelease_test_access_student_game_unique UNIQUE (student_id, game_id);
ALTER TABLE public.arcade_prerelease_test_access ADD CONSTRAINT arcade_prerelease_test_access_pkey PRIMARY KEY (id);
CREATE INDEX ix_arcade_prerelease_test_access_classroom_game ON public.arcade_prerelease_test_access USING btree (classroom_id, game_id) WHERE is_enabled;
CREATE TABLE public.arcade_ranking_periods (
  id bigint DEFAULT nextval('arcade_ranking_periods_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_kind text NOT NULL,
  display_name text NOT NULL,
  guild_season_id integer,
  contribution_year_month character varying(7),
  starts_at timestamp with time zone NOT NULL,
  ends_at_exclusive timestamp with time zone NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  created_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_no_overlap EXCLUDE USING gist (classroom_id WITH =, period_kind WITH =, tstzrange(starts_at, ends_at_exclusive, '[)'::text) WITH &&);
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_periods_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_display_name_check CHECK (((char_length(btrim(display_name)) >= 1) AND (char_length(btrim(display_name)) <= 120)));
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_kind_check CHECK ((period_kind = ANY (ARRAY['MONTHLY'::text, 'SEASON'::text])));
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_month_format_check CHECK (((contribution_year_month IS NULL) OR ((contribution_year_month)::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text)));
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_range_check CHECK ((ends_at_exclusive > starts_at));
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_shape_check CHECK ((((period_kind = 'MONTHLY'::text) AND (contribution_year_month IS NOT NULL)) OR ((period_kind = 'SEASON'::text) AND (contribution_year_month IS NULL))));
ALTER TABLE public.arcade_ranking_periods ADD CONSTRAINT arcade_ranking_period_status_check CHECK ((status = ANY (ARRAY['DRAFT'::text, 'ACTIVE'::text, 'VERIFICATION'::text, 'READY_TO_FINALIZE'::text, 'FINALIZED'::text])));
CREATE INDEX ix_arcade_ranking_period_class_kind_range ON public.arcade_ranking_periods USING btree (classroom_id, period_kind, starts_at, ends_at_exclusive);
CREATE UNIQUE INDEX arcade_ranking_period_month_unique ON public.arcade_ranking_periods USING btree (classroom_id, contribution_year_month) WHERE (period_kind = 'MONTHLY'::text);
CREATE TABLE public.arcade_run_moderation_events (
  id bigint DEFAULT nextval('arcade_run_moderation_events_id_seq'::regclass) NOT NULL,
  run_id bigint NOT NULL,
  classroom_id integer NOT NULL,
  event_kind text DEFAULT 'INVALIDATE'::text NOT NULL,
  reason text NOT NULL,
  idempotency_key uuid DEFAULT gen_random_uuid() NOT NULL,
  created_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_run_moderation_events ADD CONSTRAINT arcade_run_moderation_events_idempotency_unique UNIQUE (idempotency_key);
ALTER TABLE public.arcade_run_moderation_events ADD CONSTRAINT arcade_run_moderation_events_run_unique UNIQUE (run_id);
ALTER TABLE public.arcade_run_moderation_events ADD CONSTRAINT arcade_run_moderation_events_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_run_moderation_events ADD CONSTRAINT arcade_run_moderation_events_kind_check CHECK ((event_kind = 'INVALIDATE'::text));
ALTER TABLE public.arcade_run_moderation_events ADD CONSTRAINT arcade_run_moderation_events_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 300)));
CREATE TABLE public.arcade_run_submissions (
  id bigint DEFAULT nextval('arcade_run_submissions_id_seq'::regclass) NOT NULL,
  run_id bigint NOT NULL,
  input_events jsonb NOT NULL,
  input_event_count integer NOT NULL,
  client_game_over_elapsed_ms integer NOT NULL,
  payload_hash text NOT NULL,
  validation_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_run_unique UNIQUE (run_id);
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_elapsed_check CHECK (((client_game_over_elapsed_ms >= 0) AND (client_game_over_elapsed_ms <= 3600000)));
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_event_count_check CHECK (((input_event_count >= 0) AND (input_event_count <= 20000)));
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_events_array_check CHECK ((jsonb_typeof(input_events) = 'array'::text));
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_hash_check CHECK ((payload_hash ~ '^[a-f0-9]{64}$'::text));
ALTER TABLE public.arcade_run_submissions ADD CONSTRAINT arcade_run_submissions_metadata_object_check CHECK ((jsonb_typeof(validation_metadata) = 'object'::text));
CREATE TABLE public.arcade_runs (
  id bigint DEFAULT nextval('arcade_runs_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  student_id integer NOT NULL,
  game_id bigint NOT NULL,
  rule_version_id bigint NOT NULL,
  status text DEFAULT 'READY'::text NOT NULL,
  schedule_seed bigint NOT NULL,
  countdown_started_at timestamp with time zone,
  play_started_at timestamp with time zone,
  game_over_at timestamp with time zone,
  submitted_at timestamp with time zone,
  verified_at timestamp with time zone,
  official_score bigint,
  official_duration_ms integer,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  rejection_code text,
  rejection_reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  is_prerelease_test boolean DEFAULT false NOT NULL,
  run_context text DEFAULT 'STANDARD'::text NOT NULL,
  verification_session_id bigint
);
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_context_check CHECK ((run_context = ANY (ARRAY['STANDARD'::text, 'VERIFICATION'::text])));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_duration_check CHECK (((official_duration_ms IS NULL) OR (official_duration_ms >= 0)));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_rejected_shape_check CHECK (((status <> 'REJECTED'::text) OR (rejection_code IS NOT NULL)));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_score_check CHECK (((official_score IS NULL) OR (official_score >= 0)));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_seed_check CHECK (((schedule_seed >= 1) AND (schedule_seed <= '4294967295'::bigint)));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_stats_object_check CHECK ((jsonb_typeof(stats) = 'object'::text));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'COUNTDOWN'::text, 'PLAYING'::text, 'GAME_OVER'::text, 'SUBMITTING'::text, 'VERIFIED'::text, 'REJECTED'::text, 'EXPIRED'::text])));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_verification_context_shape_check CHECK ((((run_context = 'STANDARD'::text) AND (verification_session_id IS NULL)) OR ((run_context = 'VERIFICATION'::text) AND (verification_session_id IS NOT NULL))));
ALTER TABLE public.arcade_runs ADD CONSTRAINT arcade_runs_verified_shape_check CHECK (((status <> 'VERIFIED'::text) OR ((play_started_at IS NOT NULL) AND (game_over_at IS NOT NULL) AND (submitted_at IS NOT NULL) AND (verified_at IS NOT NULL) AND (official_score IS NOT NULL) AND (official_duration_ms IS NOT NULL))));
CREATE INDEX ix_arcade_runs_verification_session ON public.arcade_runs USING btree (verification_session_id, status, created_at DESC) WHERE (verification_session_id IS NOT NULL);
CREATE INDEX ix_arcade_runs_official_game_classroom_finished ON public.arcade_runs USING btree (game_id, classroom_id, game_over_at, id) WHERE ((status = 'VERIFIED'::text) AND (NOT is_prerelease_test));
CREATE INDEX ix_arcade_runs_game_classroom_finished ON public.arcade_runs USING btree (game_id, classroom_id, game_over_at, id) WHERE (status = 'VERIFIED'::text);
CREATE INDEX ix_arcade_runs_classroom_status_created ON public.arcade_runs USING btree (classroom_id, status, created_at DESC);
CREATE INDEX ix_arcade_runs_student_game_created_standard ON public.arcade_runs USING btree (student_id, game_id, created_at DESC) WHERE (run_context = 'STANDARD'::text);
CREATE INDEX ix_arcade_runs_student_game_finished ON public.arcade_runs USING btree (student_id, game_id, game_over_at DESC, id DESC) WHERE (status = 'VERIFIED'::text);
CREATE INDEX ix_arcade_runs_context_class_game ON public.arcade_runs USING btree (run_context, classroom_id, game_id, created_at DESC);
CREATE TABLE public.arcade_verification_attempts (
  id bigint DEFAULT nextval('arcade_verification_attempts_id_seq'::regclass) NOT NULL,
  session_id bigint NOT NULL,
  issue_number integer NOT NULL,
  opportunity_number integer NOT NULL,
  run_id bigint NOT NULL,
  idempotency_key uuid NOT NULL,
  status text DEFAULT 'ISSUED'::text NOT NULL,
  consumed boolean DEFAULT false NOT NULL,
  valid_run boolean DEFAULT false NOT NULL,
  terminal_outcome text,
  official_score bigint,
  official_duration_ms integer,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  issued_at timestamp with time zone DEFAULT now() NOT NULL,
  terminal_at timestamp with time zone,
  restored_at timestamp with time zone,
  restored_by_user_id uuid,
  restore_reason text
);
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_idempotency_unique UNIQUE (idempotency_key);
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_issue_unique UNIQUE (session_id, issue_number);
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_run_unique UNIQUE (run_id);
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_duration_check CHECK (((official_duration_ms IS NULL) OR (official_duration_ms >= 0)));
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_number_check CHECK (((issue_number >= 1) AND ((opportunity_number >= 1) AND (opportunity_number <= 10))));
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_score_check CHECK (((official_score IS NULL) OR (official_score >= 0)));
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_stats_check CHECK ((jsonb_typeof(stats) = 'object'::text));
ALTER TABLE public.arcade_verification_attempts ADD CONSTRAINT arcade_verification_attempt_status_check CHECK ((status = ANY (ARRAY['ISSUED'::text, 'TERMINAL'::text, 'TECHNICAL_CANCELLED'::text, 'RESTORED'::text])));
CREATE INDEX ix_arcade_verification_attempts_session ON public.arcade_verification_attempts USING btree (session_id, issue_number);
CREATE UNIQUE INDEX ux_arcade_verification_consumed_opportunity ON public.arcade_verification_attempts USING btree (session_id, opportunity_number) WHERE consumed;
CREATE TABLE public.arcade_verification_audit_events (
  id bigint DEFAULT nextval('arcade_verification_audit_events_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint,
  student_id integer,
  session_id bigint,
  attempt_id bigint,
  event_kind text NOT NULL,
  reason text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  actor_user_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_verification_audit_events ADD CONSTRAINT arcade_verification_audit_events_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_audit_events ADD CONSTRAINT arcade_verification_audit_metadata_check CHECK ((jsonb_typeof(metadata) = 'object'::text));
CREATE INDEX ix_arcade_verification_audit_period ON public.arcade_verification_audit_events USING btree (period_id, created_at DESC, id DESC);
CREATE TABLE public.arcade_verification_corrections (
  id bigint DEFAULT nextval('arcade_verification_corrections_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint NOT NULL,
  student_id integer NOT NULL,
  action_kind text NOT NULL,
  source_run_id bigint,
  reason text NOT NULL,
  actor_user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_verification_corrections ADD CONSTRAINT arcade_verification_corrections_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_corrections ADD CONSTRAINT arcade_verification_correction_kind_check CHECK ((action_kind = ANY (ARRAY['SET_SOURCE'::text, 'NO_RECORD'::text])));
ALTER TABLE public.arcade_verification_corrections ADD CONSTRAINT arcade_verification_correction_reason_check CHECK (((char_length(btrim(reason)) >= 2) AND (char_length(btrim(reason)) <= 500)));
ALTER TABLE public.arcade_verification_corrections ADD CONSTRAINT arcade_verification_correction_shape_check CHECK ((((action_kind = 'SET_SOURCE'::text) AND (source_run_id IS NOT NULL)) OR ((action_kind = 'NO_RECORD'::text) AND (source_run_id IS NULL))));
CREATE INDEX ix_arcade_verification_corrections_subject ON public.arcade_verification_corrections USING btree (period_id, game_id, student_id, created_at DESC);
CREATE TABLE public.arcade_verification_game_configs (
  game_id bigint NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  target_rank_count integer DEFAULT 10 NOT NULL,
  threshold_percent integer DEFAULT 80 NOT NULL,
  max_attempts integer DEFAULT 3 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_verification_game_configs ADD CONSTRAINT arcade_verification_game_configs_pkey PRIMARY KEY (game_id);
ALTER TABLE public.arcade_verification_game_configs ADD CONSTRAINT arcade_verification_config_attempt_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10)));
ALTER TABLE public.arcade_verification_game_configs ADD CONSTRAINT arcade_verification_config_target_check CHECK (((target_rank_count >= 1) AND (target_rank_count <= 10)));
ALTER TABLE public.arcade_verification_game_configs ADD CONSTRAINT arcade_verification_config_threshold_check CHECK (((threshold_percent >= 1) AND (threshold_percent <= 100)));
CREATE TABLE public.arcade_verification_official_results (
  id bigint DEFAULT nextval('arcade_verification_official_results_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint NOT NULL,
  student_id integer NOT NULL,
  session_id bigint,
  decision_kind text NOT NULL,
  source_run_id bigint,
  official_score bigint,
  official_duration_ms integer,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  achieved_at timestamp with time zone,
  ranking_eligible boolean NOT NULL,
  decided_by_user_id uuid,
  decided_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_unique UNIQUE (period_id, game_id, student_id);
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_results_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_duration_check CHECK (((official_duration_ms IS NULL) OR (official_duration_ms >= 0)));
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_kind_check CHECK ((decision_kind = ANY (ARRAY['SESSION_SUCCESS_PROVISIONAL'::text, 'SESSION_SUCCESS_VERIFICATION'::text, 'SESSION_FAILURE_VERIFICATION'::text, 'SESSION_FAILURE_NO_VALID'::text, 'MANUAL_SOURCE'::text, 'MANUAL_NONE'::text])));
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_score_check CHECK (((official_score IS NULL) OR (official_score >= 0)));
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_shape_check CHECK (((ranking_eligible AND (source_run_id IS NOT NULL) AND (official_score IS NOT NULL) AND (achieved_at IS NOT NULL)) OR ((NOT ranking_eligible) AND (source_run_id IS NULL) AND (official_score IS NULL) AND (achieved_at IS NULL))));
ALTER TABLE public.arcade_verification_official_results ADD CONSTRAINT arcade_verification_official_stats_check CHECK ((jsonb_typeof(stats) = 'object'::text));
CREATE INDEX ix_arcade_verification_official_period_game ON public.arcade_verification_official_results USING btree (period_id, game_id, ranking_eligible, official_score DESC, achieved_at);
CREATE TABLE public.arcade_verification_period_games (
  id bigint DEFAULT nextval('arcade_verification_period_games_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint NOT NULL,
  target_rank_count integer NOT NULL,
  threshold_percent integer NOT NULL,
  max_attempts integer NOT NULL,
  frozen_at timestamp with time zone DEFAULT now() NOT NULL,
  verification_closed_at timestamp with time zone,
  verification_closed_by_user_id uuid,
  verification_close_reason text
);
ALTER TABLE public.arcade_verification_period_games ADD CONSTRAINT arcade_verification_period_game_unique UNIQUE (period_id, game_id);
ALTER TABLE public.arcade_verification_period_games ADD CONSTRAINT arcade_verification_period_games_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_period_games ADD CONSTRAINT arcade_verification_period_game_attempt_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10)));
ALTER TABLE public.arcade_verification_period_games ADD CONSTRAINT arcade_verification_period_game_target_check CHECK (((target_rank_count >= 1) AND (target_rank_count <= 10)));
ALTER TABLE public.arcade_verification_period_games ADD CONSTRAINT arcade_verification_period_game_threshold_check CHECK (((threshold_percent >= 1) AND (threshold_percent <= 100)));
CREATE INDEX ix_arcade_verification_period_games_period ON public.arcade_verification_period_games USING btree (period_id, game_id);
CREATE TABLE public.arcade_verification_provisional_entries (
  id bigint DEFAULT nextval('arcade_verification_provisional_entries_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint NOT NULL,
  student_id integer NOT NULL,
  source_run_id bigint NOT NULL,
  rule_version_id bigint NOT NULL,
  official_score bigint NOT NULL,
  official_duration_ms integer NOT NULL,
  stats jsonb NOT NULL,
  achieved_at timestamp with time zone NOT NULL,
  frozen_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_verification_provisional_entries ADD CONSTRAINT arcade_verification_provisional_unique UNIQUE (period_id, game_id, student_id);
ALTER TABLE public.arcade_verification_provisional_entries ADD CONSTRAINT arcade_verification_provisional_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_provisional_entries ADD CONSTRAINT arcade_verification_provisional_duration_check CHECK ((official_duration_ms >= 0));
ALTER TABLE public.arcade_verification_provisional_entries ADD CONSTRAINT arcade_verification_provisional_score_check CHECK ((official_score >= 0));
ALTER TABLE public.arcade_verification_provisional_entries ADD CONSTRAINT arcade_verification_provisional_stats_check CHECK ((jsonb_typeof(stats) = 'object'::text));
CREATE INDEX ix_arcade_verification_provisional_period_game ON public.arcade_verification_provisional_entries USING btree (period_id, game_id, official_score DESC, achieved_at, source_run_id);
CREATE TABLE public.arcade_verification_sessions (
  id bigint DEFAULT nextval('arcade_verification_sessions_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  game_id bigint NOT NULL,
  student_id integer NOT NULL,
  provisional_entry_id bigint,
  provisional_source_run_id bigint,
  rule_version_id bigint NOT NULL,
  provisional_score bigint,
  verification_threshold bigint,
  threshold_percent integer NOT NULL,
  max_attempts integer NOT NULL,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  success_achieved boolean DEFAULT false NOT NULL,
  result_status text,
  activated_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  activated_at timestamp with time zone DEFAULT now() NOT NULL,
  ended_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.arcade_verification_sessions ADD CONSTRAINT arcade_verification_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.arcade_verification_sessions ADD CONSTRAINT arcade_verification_session_attempt_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10)));
ALTER TABLE public.arcade_verification_sessions ADD CONSTRAINT arcade_verification_session_result_check CHECK (((result_status IS NULL) OR (result_status = ANY (ARRAY['SUCCESS'::text, 'FAILURE_VALID'::text, 'FAILURE_NO_VALID'::text]))));
ALTER TABLE public.arcade_verification_sessions ADD CONSTRAINT arcade_verification_session_score_check CHECK ((((provisional_score IS NULL) OR (provisional_score >= 0)) AND ((verification_threshold IS NULL) OR (verification_threshold >= 0))));
ALTER TABLE public.arcade_verification_sessions ADD CONSTRAINT arcade_verification_session_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'COMPLETED'::text, 'RESET'::text, 'OVERRIDDEN'::text])));
ALTER TABLE public.arcade_verification_sessions ADD CONSTRAINT arcade_verification_session_threshold_check CHECK (((threshold_percent >= 1) AND (threshold_percent <= 100)));
CREATE INDEX ix_arcade_verification_sessions_period_game ON public.arcade_verification_sessions USING btree (period_id, game_id, student_id, activated_at DESC);
CREATE UNIQUE INDEX ux_arcade_verification_one_active_session ON public.arcade_verification_sessions USING btree (period_id, game_id, student_id) WHERE (status = 'ACTIVE'::text);
CREATE TABLE public.tikatuka_games (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  classroom_id integer NOT NULL,
  student_id integer NOT NULL,
  engine_version smallint DEFAULT 1 NOT NULL,
  difficulty smallint NOT NULL,
  status text DEFAULT 'READY'::text NOT NULL,
  client_submission jsonb,
  final_boards jsonb,
  server_result jsonb,
  server_winner text,
  issued_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  official_session_id bigint,
  official_match_number smallint
);
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_pkey PRIMARY KEY (id);
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_completed_shape_check CHECK ((((status = 'READY'::text) AND (client_submission IS NULL) AND (final_boards IS NULL) AND (server_result IS NULL) AND (server_winner IS NULL) AND (completed_at IS NULL)) OR ((status = 'COMPLETED'::text) AND (client_submission IS NOT NULL) AND (final_boards IS NOT NULL) AND (server_result IS NOT NULL) AND (server_winner IS NOT NULL) AND (completed_at IS NOT NULL))));
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 10)));
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_engine_version_check CHECK ((engine_version = 1));
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_json_shape_check CHECK ((((client_submission IS NULL) OR (jsonb_typeof(client_submission) = 'object'::text)) AND ((final_boards IS NULL) OR (jsonb_typeof(final_boards) = 'object'::text)) AND ((server_result IS NULL) OR (jsonb_typeof(server_result) = 'object'::text))));
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_official_match_number_check CHECK (((official_match_number >= 1) AND (official_match_number <= 5)));
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_server_winner_check CHECK (((server_winner IS NULL) OR (server_winner = ANY (ARRAY['player'::text, 'ai'::text, 'draw'::text]))));
ALTER TABLE public.tikatuka_games ADD CONSTRAINT tikatuka_games_status_check CHECK ((status = ANY (ARRAY['READY'::text, 'COMPLETED'::text])));
CREATE INDEX ix_tikatuka_games_official_session ON public.tikatuka_games USING btree (official_session_id, official_match_number) WHERE (official_session_id IS NOT NULL);
CREATE TABLE public.tikatuka_monthly_official_snapshot_entries (
  id bigint DEFAULT nextval('tikatuka_monthly_official_snapshot_entries_id_seq'::regclass) NOT NULL,
  snapshot_id bigint NOT NULL,
  student_id integer NOT NULL,
  source_session_id bigint NOT NULL,
  rank integer NOT NULL,
  difficulty smallint NOT NULL,
  wins smallint NOT NULL,
  draws smallint NOT NULL,
  losses smallint NOT NULL,
  points smallint NOT NULL,
  ranking_score integer NOT NULL,
  completed_at timestamp with time zone NOT NULL,
  raw_bonus numeric NOT NULL,
  student_name_at_close text,
  brand_name_at_close text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_session_unique UNIQUE (snapshot_id, source_session_id);
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_student_unique UNIQUE (snapshot_id, student_id);
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_snapshot_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_bonus_check CHECK ((((rank = 1) AND (raw_bonus = (30)::numeric)) OR ((rank = 2) AND (raw_bonus = (27)::numeric)) OR ((rank = 3) AND (raw_bonus = (24)::numeric)) OR (((rank >= 4) AND (rank <= 6)) AND (raw_bonus = (18)::numeric)) OR (((rank >= 7) AND (rank <= 10)) AND (raw_bonus = (15)::numeric))));
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 10)));
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_points_check CHECK ((points >= 3));
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_rank_check CHECK (((rank >= 1) AND (rank <= 10)));
ALTER TABLE public.tikatuka_monthly_official_snapshot_entries ADD CONSTRAINT tikatuka_monthly_official_entries_score_check CHECK ((ranking_score = ((difficulty * 16) + points)));
CREATE TABLE public.tikatuka_monthly_official_snapshots (
  id bigint DEFAULT nextval('tikatuka_monthly_official_snapshots_id_seq'::regclass) NOT NULL,
  finalization_id bigint NOT NULL,
  classroom_id integer NOT NULL,
  period_id bigint NOT NULL,
  contribution_year_month character varying(7) NOT NULL,
  created_by_user_id uuid DEFAULT auth.uid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.tikatuka_monthly_official_snapshots ADD CONSTRAINT tikatuka_monthly_official_snapshots_finalization_unique UNIQUE (finalization_id);
ALTER TABLE public.tikatuka_monthly_official_snapshots ADD CONSTRAINT tikatuka_monthly_official_snapshots_period_unique UNIQUE (period_id);
ALTER TABLE public.tikatuka_monthly_official_snapshots ADD CONSTRAINT tikatuka_monthly_official_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.tikatuka_monthly_official_snapshots ADD CONSTRAINT tikatuka_monthly_official_snapshots_month_check CHECK (((contribution_year_month)::text ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::text));
CREATE TABLE public.tikatuka_official_sessions (
  id bigint DEFAULT nextval('tikatuka_official_sessions_id_seq'::regclass) NOT NULL,
  classroom_id integer NOT NULL,
  student_id integer NOT NULL,
  period_key date NOT NULL,
  difficulty smallint NOT NULL,
  status text DEFAULT 'ACTIVE'::text NOT NULL,
  games_played smallint DEFAULT 0 NOT NULL,
  wins smallint DEFAULT 0 NOT NULL,
  draws smallint DEFAULT 0 NOT NULL,
  losses smallint DEFAULT 0 NOT NULL,
  points smallint DEFAULT 0 NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  arcade_period_id bigint NOT NULL
);
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_pkey PRIMARY KEY (id);
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_session_score_check CHECK (((games_played = ((wins + draws) + losses)) AND (points = ((wins * 3) + draws))));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_session_status_check CHECK ((((status = 'ACTIVE'::text) AND (games_played < 5) AND (completed_at IS NULL)) OR ((status = 'COMPLETED'::text) AND (games_played = 5) AND (completed_at IS NOT NULL)) OR ((status = 'CANCELLED'::text) AND (games_played < 5) AND (completed_at IS NOT NULL))));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_difficulty_check CHECK (((difficulty >= 1) AND (difficulty <= 10)));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_draws_check CHECK (((draws >= 0) AND (draws <= 5)));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_games_played_check CHECK (((games_played >= 0) AND (games_played <= 5)));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_losses_check CHECK (((losses >= 0) AND (losses <= 5)));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_points_check CHECK (((points >= 0) AND (points <= 15)));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_status_check CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'COMPLETED'::text, 'CANCELLED'::text])));
ALTER TABLE public.tikatuka_official_sessions ADD CONSTRAINT tikatuka_official_sessions_wins_check CHECK (((wins >= 0) AND (wins <= 5)));
CREATE UNIQUE INDEX ux_tikatuka_official_active_student_arcade_period ON public.tikatuka_official_sessions USING btree (classroom_id, student_id, arcade_period_id) WHERE (status = 'ACTIVE'::text);
CREATE UNIQUE INDEX ux_tikatuka_official_one_attempt_student_arcade_period ON public.tikatuka_official_sessions USING btree (classroom_id, student_id, arcade_period_id);
CREATE TABLE public.tikatuka_official_windows (
  classroom_id integer NOT NULL,
  period_key date NOT NULL,
  is_open boolean DEFAULT false NOT NULL,
  opened_at timestamp with time zone,
  closed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  arcade_period_id bigint NOT NULL
);
ALTER TABLE public.tikatuka_official_windows ADD CONSTRAINT tikatuka_official_windows_pkey PRIMARY KEY (classroom_id, arcade_period_id);
CREATE TABLE public.tikatuka_progress (
  classroom_id integer NOT NULL,
  student_id integer NOT NULL,
  highest_unlocked_difficulty smallint DEFAULT 1 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE public.tikatuka_progress ADD CONSTRAINT tikatuka_progress_pkey PRIMARY KEY (classroom_id, student_id);
