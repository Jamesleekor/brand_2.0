-- Starlink Arcade Core SQL E2E: ephemeral PostgreSQL 15 fixture only.
-- This file must never be executed against a production Supabase project.
BEGIN;
CREATE TABLE public.arcade_runs(
  id bigint PRIMARY KEY, classroom_id integer NOT NULL, student_id integer NOT NULL,
  game_id bigint NOT NULL, rule_version_id bigint NOT NULL,
  status text NOT NULL, schedule_seed bigint NOT NULL, run_nonce uuid NOT NULL,
  play_started_at timestamptz, run_context text NOT NULL DEFAULT 'STANDARD',
  verification_session_id bigint, submitted_at timestamptz, game_over_at timestamptz,
  verified_at timestamptz, official_score bigint, official_duration_ms integer,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb, rejection_code text, rejection_reason text
);
CREATE TABLE public.arcade_run_submissions(
  id bigserial PRIMARY KEY, run_id bigint NOT NULL UNIQUE,
  input_events jsonb NOT NULL, input_event_count integer NOT NULL,
  client_game_over_elapsed_ms integer NOT NULL, payload_hash text NOT NULL,
  validation_metadata jsonb NOT NULL, submitted_at timestamptz NOT NULL
);
CREATE TABLE public.arcade_verification_sessions(
  id bigint PRIMARY KEY, status text NOT NULL, period_id bigint NOT NULL,
  game_id bigint NOT NULL, student_id integer NOT NULL, rule_version_id bigint NOT NULL
);
CREATE TABLE public.arcade_verification_attempts(
  id bigint PRIMARY KEY, run_id bigint NOT NULL, session_id bigint NOT NULL,
  opportunity_number integer NOT NULL, status text NOT NULL, consumed boolean NOT NULL
);
CREATE TABLE public.arcade_ranking_periods(id bigint PRIMARY KEY,status text NOT NULL);
CREATE TABLE public.arcade_verification_period_games(
  id bigint PRIMARY KEY,period_id bigint NOT NULL,game_id bigint NOT NULL,
  rule_version_id bigint,max_attempts integer NOT NULL,
  seed_strategy text NOT NULL,seed_pack_status text NOT NULL,
  verification_closed_at timestamptz
);
CREATE TABLE public.arcade_verification_seed_pack_slots(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  period_game_id bigint NOT NULL,slot_code text NOT NULL,slot_number integer NOT NULL,
  gameplay_seed bigint NOT NULL,preflight_status text NOT NULL,
  initial_board_hash text NOT NULL,preflight_metrics jsonb NOT NULL,
  UNIQUE(period_game_id,slot_number),UNIQUE(period_game_id,gameplay_seed),
  UNIQUE(period_game_id,initial_board_hash)
);
CREATE TABLE public.arcade_verification_seed_assignments(
  period_game_id bigint NOT NULL,student_id integer NOT NULL,
  opportunity_number integer NOT NULL,seed_slot_id bigint NOT NULL,
  UNIQUE(period_game_id,student_id,opportunity_number)
);
CREATE FUNCTION public.current_student_id() RETURNS integer LANGUAGE sql STABLE AS $student_identity$
  SELECT coalesce(nullif(current_setting('app.starlink_student_id',true),'')::integer,1)
$student_identity$;
CREATE FUNCTION public.current_classroom_id() RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 1 $$;
CREATE FUNCTION public.arcade_sha256_hex(p_text text) RETURNS text LANGUAGE sql IMMUTABLE STRICT
AS $$ SELECT md5(p_text) $$; -- Fixture stub only: production uses real sha256 helper.
CREATE FUNCTION public.arcade_generate_run_seed() RETURNS bigint LANGUAGE sql VOLATILE
AS $$ SELECT (floor(random()*4000000000)+1)::bigint $$;
CREATE FUNCTION public.arcade_capture_verification_attempt(p_run_id bigint)
RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.arcade_verification_attempts SET status='TERMINAL' WHERE run_id=p_run_id;
  RETURN jsonb_build_object('captured',true,'run_id',p_run_id);
END;
$$;

-- The prior ephemeral baseline created only code/config columns.
UPDATE public.arcade_game_rule_versions rv
SET config=jsonb_build_object(
  'game_code','starlink_04',
  'server_elapsed_tolerance_ms',10000,
  'client_end_tolerance_ms',2000
)
WHERE rv.version_code='starlink_04_v0.3';

INSERT INTO public.arcade_runs(
  id,classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,run_nonce,
  play_started_at,run_context
)
SELECT
  10,1,1,g.id,rv.id,'PLAYING',6059,
  'ff3d58b7-9260-4b58-b394-c9e37e454dea'::uuid,
  clock_timestamp()-interval '60 seconds','STANDARD'
FROM public.arcade_games g JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';

INSERT INTO public.arcade_ranking_periods VALUES(100,'VERIFICATION');
INSERT INTO public.arcade_verification_period_games(
 id,period_id,game_id,rule_version_id,max_attempts,seed_strategy,seed_pack_status
)
SELECT 101,100,g.id,rv.id,3,'PERIOD_PACK_PERMUTED','LOCKED'
FROM public.arcade_games g JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';

INSERT INTO public.arcade_verification_sessions(id,status,period_id,game_id,student_id,rule_version_id)
SELECT 201,'ACTIVE',100,g.id,1,rv.id
FROM public.arcade_games g JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';

INSERT INTO public.arcade_verification_seed_pack_slots(
 period_game_id,slot_code,slot_number,gameplay_seed,preflight_status,initial_board_hash,preflight_metrics
)
VALUES(101,'A',1,6059,'READY','fixture-board-a','{}'::jsonb);
INSERT INTO public.arcade_verification_seed_assignments(period_game_id,student_id,opportunity_number,seed_slot_id)
SELECT 101,1,1,id FROM public.arcade_verification_seed_pack_slots WHERE period_game_id=101 AND slot_code='A';

INSERT INTO public.arcade_runs(
  id,classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,run_nonce,
  play_started_at,run_context,verification_session_id
)
SELECT 20,1,1,g.id,rv.id,'PLAYING',6059,
  '43c9ce64-4fb8-46bd-aa6b-41c311c4df7c'::uuid,
  clock_timestamp()-interval '60 seconds','VERIFICATION',201
FROM public.arcade_games g JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';
INSERT INTO public.arcade_verification_attempts(
  id,run_id,session_id,opportunity_number,status,consumed
) VALUES (301,20,201,1,'ISSUED',true);

INSERT INTO public.arcade_runs(
  id,classroom_id,student_id,game_id,rule_version_id,status,schedule_seed,run_nonce,
  play_started_at,run_context
)
SELECT 30,1,1,g.id,rv.id,'PLAYING',6059,
  'f6b909fb-bbad-4e76-a51b-d3f737e5e06b'::uuid,
  clock_timestamp()-interval '60 seconds','STANDARD'
FROM public.arcade_games g JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='starlink_04';
COMMIT;
