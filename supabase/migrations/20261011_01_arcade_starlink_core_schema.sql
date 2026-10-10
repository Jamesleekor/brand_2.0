-- =============================================================================
-- B.R.A.N.D 2.0 — Arcade / Starlink STEP 2-A core schema foundation
-- 2026-10-11
--
-- Scope only:
--   * run execution nonce
--   * verification attempt consumption timestamp
--   * period/game rule-version pinning
--   * verification seed strategy metadata
--   * period seed-pack slots
--   * per-student immutable seed assignments
--   * RLS / ACL / integrity guards
--
-- This migration intentionally DOES NOT change verification lifecycle RPCs yet.
-- Existing games remain RANDOM_PER_ATTEMPT until STEP 2-B changes the RPC flow.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.arcade_games') IS NULL
     OR to_regclass('public.arcade_game_rule_versions') IS NULL
     OR to_regclass('public.arcade_ranking_periods') IS NULL
     OR to_regclass('public.arcade_runs') IS NULL
     OR to_regclass('public.arcade_verification_game_configs') IS NULL
     OR to_regclass('public.arcade_verification_period_games') IS NULL
     OR to_regclass('public.arcade_verification_attempts') IS NULL
     OR to_regclass('public.students') IS NULL
  THEN
    RAISE EXCEPTION '[ARCADE STARLINK 2A] required Arcade baseline tables are missing.';
  END IF;

  IF to_regprocedure('extensions.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION '[ARCADE STARLINK 2A] extensions.gen_random_uuid() is unavailable.';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 1. Every execution gets a nonce independent from the deterministic gameplay seed.
-- -----------------------------------------------------------------------------

ALTER TABLE public.arcade_runs
  ADD COLUMN IF NOT EXISTS run_nonce uuid;

UPDATE public.arcade_runs
SET run_nonce = extensions.gen_random_uuid()
WHERE run_nonce IS NULL;

ALTER TABLE public.arcade_runs
  ALTER COLUMN run_nonce SET DEFAULT extensions.gen_random_uuid(),
  ALTER COLUMN run_nonce SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_arcade_runs_run_nonce
  ON public.arcade_runs(run_nonce);

COMMENT ON COLUMN public.arcade_runs.run_nonce IS
  'Per-execution UUID used to bind submissions. Independent from schedule_seed/gameplay seed; retries receive a new run_nonce.';

-- -----------------------------------------------------------------------------
-- 2. Record when an attempt first crossed into PLAYING.
-- Historical rows remain NULL because their exact PLAYING-consumption instant
-- cannot be reconstructed honestly.
-- -----------------------------------------------------------------------------

ALTER TABLE public.arcade_verification_attempts
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz;

COMMENT ON COLUMN public.arcade_verification_attempts.consumed_at IS
  'Server timestamp of the first PLAYING transition that consumed this opportunity. Historical rows may be NULL.';

-- -----------------------------------------------------------------------------
-- 3. Verification seed strategy.
-- Existing games/default rows preserve RANDOM_PER_ATTEMPT behavior.
-- -----------------------------------------------------------------------------

ALTER TABLE public.arcade_verification_game_configs
  ADD COLUMN IF NOT EXISTS seed_strategy text NOT NULL DEFAULT 'RANDOM_PER_ATTEMPT';

ALTER TABLE public.arcade_verification_game_configs
  DROP CONSTRAINT IF EXISTS arcade_verification_config_seed_strategy_check;
ALTER TABLE public.arcade_verification_game_configs
  ADD CONSTRAINT arcade_verification_config_seed_strategy_check
  CHECK (seed_strategy IN ('RANDOM_PER_ATTEMPT','PERIOD_PACK_PERMUTED'));

ALTER TABLE public.arcade_verification_game_configs
  DROP CONSTRAINT IF EXISTS arcade_verification_config_pack_attempt_check;
ALTER TABLE public.arcade_verification_game_configs
  ADD CONSTRAINT arcade_verification_config_pack_attempt_check
  CHECK (seed_strategy <> 'PERIOD_PACK_PERMUTED' OR max_attempts = 3);

COMMENT ON COLUMN public.arcade_verification_game_configs.seed_strategy IS
  'RANDOM_PER_ATTEMPT for legacy/common games; PERIOD_PACK_PERMUTED for fixed A/B/C period packs such as Starlink.';

ALTER TABLE public.arcade_verification_period_games
  ADD COLUMN IF NOT EXISTS rule_version_id bigint REFERENCES public.arcade_game_rule_versions(id),
  ADD COLUMN IF NOT EXISTS seed_strategy text NOT NULL DEFAULT 'RANDOM_PER_ATTEMPT',
  ADD COLUMN IF NOT EXISTS seed_pack_status text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS seed_pack_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS seed_pack_locked_by_run_id bigint REFERENCES public.arcade_runs(id);

ALTER TABLE public.arcade_verification_period_games
  DROP CONSTRAINT IF EXISTS arcade_verification_period_game_seed_strategy_check;
ALTER TABLE public.arcade_verification_period_games
  ADD CONSTRAINT arcade_verification_period_game_seed_strategy_check
  CHECK (seed_strategy IN ('RANDOM_PER_ATTEMPT','PERIOD_PACK_PERMUTED'));

ALTER TABLE public.arcade_verification_period_games
  DROP CONSTRAINT IF EXISTS arcade_verification_period_game_seed_pack_status_check;
ALTER TABLE public.arcade_verification_period_games
  ADD CONSTRAINT arcade_verification_period_game_seed_pack_status_check
  CHECK (seed_pack_status IN ('NONE','DRAFT','LOCKED'));

ALTER TABLE public.arcade_verification_period_games
  DROP CONSTRAINT IF EXISTS arcade_verification_period_game_pack_attempt_check;
ALTER TABLE public.arcade_verification_period_games
  ADD CONSTRAINT arcade_verification_period_game_pack_attempt_check
  CHECK (seed_strategy <> 'PERIOD_PACK_PERMUTED' OR max_attempts = 3);

ALTER TABLE public.arcade_verification_period_games
  DROP CONSTRAINT IF EXISTS arcade_verification_period_game_pack_shape_check;
ALTER TABLE public.arcade_verification_period_games
  ADD CONSTRAINT arcade_verification_period_game_pack_shape_check
  CHECK (
    (
      seed_strategy = 'RANDOM_PER_ATTEMPT'
      AND seed_pack_status = 'NONE'
      AND seed_pack_locked_at IS NULL
      AND seed_pack_locked_by_run_id IS NULL
    )
    OR
    (
      seed_strategy = 'PERIOD_PACK_PERMUTED'
      AND (
        (
          seed_pack_status = 'DRAFT'
          AND seed_pack_locked_at IS NULL
          AND seed_pack_locked_by_run_id IS NULL
        )
        OR
        (
          seed_pack_status = 'LOCKED'
          AND seed_pack_locked_at IS NOT NULL
          AND seed_pack_locked_by_run_id IS NOT NULL
        )
      )
    )
  );

COMMENT ON COLUMN public.arcade_verification_period_games.rule_version_id IS
  'Rule version frozen for this game/period verification scope. STEP 2-B/2-D RPCs must populate it.';
COMMENT ON COLUMN public.arcade_verification_period_games.seed_strategy IS
  'Frozen copy of the game verification seed strategy for this ranking period.';
COMMENT ON COLUMN public.arcade_verification_period_games.seed_pack_status IS
  'NONE for random-per-attempt games; DRAFT/LOCKED for fixed period seed packs.';

-- -----------------------------------------------------------------------------
-- 4. Ranking-period / game rule-version pin.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.arcade_period_game_rule_pins (
  id bigserial PRIMARY KEY,
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  period_id bigint NOT NULL REFERENCES public.arcade_ranking_periods(id),
  game_id bigint NOT NULL REFERENCES public.arcade_games(id),
  rule_version_id bigint NOT NULL REFERENCES public.arcade_game_rule_versions(id),
  pinned_at timestamptz NOT NULL DEFAULT now(),
  pinned_by_user_id uuid,
  CONSTRAINT arcade_period_game_rule_pin_unique UNIQUE(period_id, game_id)
);

CREATE INDEX IF NOT EXISTS ix_arcade_period_game_rule_pins_classroom
  ON public.arcade_period_game_rule_pins(classroom_id, period_id);
CREATE INDEX IF NOT EXISTS ix_arcade_period_game_rule_pins_rule
  ON public.arcade_period_game_rule_pins(rule_version_id);

COMMENT ON TABLE public.arcade_period_game_rule_pins IS
  'Authoritative score-affecting rule version pinned to a ranking period/game. Prevents mixed rule versions inside one period.';

CREATE OR REPLACE FUNCTION public.arcade_validate_period_game_rule_pin()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_classroom integer;
  v_rule_game bigint;
BEGIN
  SELECT p.classroom_id
  INTO v_period_classroom
  FROM public.arcade_ranking_periods p
  WHERE p.id = NEW.period_id;

  IF v_period_classroom IS NULL
     OR v_period_classroom IS DISTINCT FROM NEW.classroom_id THEN
    RAISE EXCEPTION '[ARCADE RULE PIN] period/classroom mismatch.'
      USING ERRCODE = '23514';
  END IF;

  SELECT rv.game_id
  INTO v_rule_game
  FROM public.arcade_game_rule_versions rv
  WHERE rv.id = NEW.rule_version_id;

  IF v_rule_game IS NULL
     OR v_rule_game IS DISTINCT FROM NEW.game_id THEN
    RAISE EXCEPTION '[ARCADE RULE PIN] rule version/game mismatch.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_arcade_validate_period_game_rule_pin
  ON public.arcade_period_game_rule_pins;
CREATE TRIGGER trg_arcade_validate_period_game_rule_pin
BEFORE INSERT OR UPDATE
ON public.arcade_period_game_rule_pins
FOR EACH ROW
EXECUTE FUNCTION public.arcade_validate_period_game_rule_pin();

-- -----------------------------------------------------------------------------
-- 5. Fixed verification seed-pack slots.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.arcade_verification_seed_pack_slots (
  id bigserial PRIMARY KEY,
  period_game_id bigint NOT NULL
    REFERENCES public.arcade_verification_period_games(id) ON DELETE RESTRICT,
  slot_code text NOT NULL,
  slot_number smallint NOT NULL,
  gameplay_seed bigint NOT NULL,
  preflight_status text NOT NULL DEFAULT 'READY',
  initial_board_hash text,
  preflight_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_seed_slot_code_check
    CHECK (slot_code IN ('A','B','C')),
  CONSTRAINT arcade_verification_seed_slot_number_check
    CHECK (slot_number BETWEEN 1 AND 3),
  CONSTRAINT arcade_verification_seed_slot_seed_check
    CHECK (gameplay_seed BETWEEN 1 AND 4294967295),
  CONSTRAINT arcade_verification_seed_slot_preflight_check
    CHECK (preflight_status IN ('READY','REJECTED')),
  CONSTRAINT arcade_verification_seed_slot_metrics_check
    CHECK (jsonb_typeof(preflight_metrics) = 'object'),
  CONSTRAINT arcade_verification_seed_slot_code_unique
    UNIQUE(period_game_id, slot_code),
  CONSTRAINT arcade_verification_seed_slot_number_unique
    UNIQUE(period_game_id, slot_number),
  CONSTRAINT arcade_verification_seed_slot_seed_unique
    UNIQUE(period_game_id, gameplay_seed),
  CONSTRAINT arcade_verification_seed_slot_id_period_unique
    UNIQUE(id, period_game_id)
);

CREATE INDEX IF NOT EXISTS ix_arcade_verification_seed_slots_period_game
  ON public.arcade_verification_seed_pack_slots(period_game_id, slot_number);

COMMENT ON TABLE public.arcade_verification_seed_pack_slots IS
  'Server-only A/B/C fixed gameplay seeds for PERIOD_PACK_PERMUTED verification. Never expose future slot seeds to students.';

CREATE OR REPLACE FUNCTION public.arcade_guard_verification_seed_slot_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period_game_id bigint;
  v_strategy text;
  v_pack_status text;
BEGIN
  v_period_game_id := CASE
    WHEN TG_OP = 'DELETE' THEN OLD.period_game_id
    ELSE NEW.period_game_id
  END;

  SELECT pg.seed_strategy, pg.seed_pack_status
  INTO v_strategy, v_pack_status
  FROM public.arcade_verification_period_games pg
  WHERE pg.id = v_period_game_id;

  IF v_strategy IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] period-game scope is missing.'
      USING ERRCODE = '23503';
  END IF;

  IF v_strategy <> 'PERIOD_PACK_PERMUTED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] fixed seed slots require PERIOD_PACK_PERMUTED.'
      USING ERRCODE = '23514';
  END IF;

  IF v_pack_status = 'LOCKED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] locked seed pack is immutable.'
      USING ERRCODE = 'P0280';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.period_game_id IS DISTINCT FROM NEW.period_game_id THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] seed slot cannot move between period-game scopes.'
      USING ERRCODE = '23514';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_arcade_guard_verification_seed_slot_write
  ON public.arcade_verification_seed_pack_slots;
CREATE TRIGGER trg_arcade_guard_verification_seed_slot_write
BEFORE INSERT OR UPDATE OR DELETE
ON public.arcade_verification_seed_pack_slots
FOR EACH ROW
EXECUTE FUNCTION public.arcade_guard_verification_seed_slot_write();

CREATE OR REPLACE FUNCTION public.arcade_guard_locked_verification_pack_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.seed_pack_status = 'LOCKED'
     AND (
       NEW.seed_strategy IS DISTINCT FROM OLD.seed_strategy
       OR NEW.seed_pack_status IS DISTINCT FROM OLD.seed_pack_status
       OR NEW.seed_pack_locked_at IS DISTINCT FROM OLD.seed_pack_locked_at
       OR NEW.seed_pack_locked_by_run_id IS DISTINCT FROM OLD.seed_pack_locked_by_run_id
       OR NEW.rule_version_id IS DISTINCT FROM OLD.rule_version_id
     ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] locked seed pack header is immutable.'
      USING ERRCODE = 'P0280';
  END IF;

  IF OLD.seed_pack_status <> 'LOCKED'
     AND NEW.seed_pack_status = 'LOCKED'
     AND (
       NEW.seed_pack_locked_at IS NULL
       OR NEW.seed_pack_locked_by_run_id IS NULL
     ) THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] lock metadata is required.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_arcade_guard_locked_verification_pack_header
  ON public.arcade_verification_period_games;
CREATE TRIGGER trg_arcade_guard_locked_verification_pack_header
BEFORE UPDATE OF rule_version_id, seed_strategy, seed_pack_status, seed_pack_locked_at, seed_pack_locked_by_run_id
ON public.arcade_verification_period_games
FOR EACH ROW
EXECUTE FUNCTION public.arcade_guard_locked_verification_pack_header();

-- -----------------------------------------------------------------------------
-- 6. Per-student immutable opportunity -> seed-slot assignment.
-- Assignment belongs to period/game/student, not to a resettable session.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.arcade_verification_seed_assignments (
  id bigserial PRIMARY KEY,
  period_game_id bigint NOT NULL
    REFERENCES public.arcade_verification_period_games(id) ON DELETE RESTRICT,
  student_id integer NOT NULL REFERENCES public.students(id),
  opportunity_number smallint NOT NULL,
  seed_slot_id bigint NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arcade_verification_seed_assignment_opportunity_check
    CHECK (opportunity_number BETWEEN 1 AND 3),
  CONSTRAINT arcade_verification_seed_assignment_opportunity_unique
    UNIQUE(period_game_id, student_id, opportunity_number),
  CONSTRAINT arcade_verification_seed_assignment_slot_unique
    UNIQUE(period_game_id, student_id, seed_slot_id),
  CONSTRAINT arcade_verification_seed_assignment_slot_scope_fkey
    FOREIGN KEY(seed_slot_id, period_game_id)
    REFERENCES public.arcade_verification_seed_pack_slots(id, period_game_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_arcade_verification_seed_assignments_student
  ON public.arcade_verification_seed_assignments(student_id, period_game_id);

COMMENT ON TABLE public.arcade_verification_seed_assignments IS
  'Immutable server-side permutation mapping each student opportunity to exactly one seed slot. Survives session reset/recreation.';

CREATE OR REPLACE FUNCTION public.arcade_validate_verification_seed_assignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $
DECLARE
  v_strategy text;
  v_max_attempts integer;
  v_student_classroom integer;
  v_period_classroom integer;
  v_slot_ready boolean;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] seed assignments are immutable.'
      USING ERRCODE = 'P0281';
  END IF;

  SELECT pg.seed_strategy, pg.max_attempts, pg.classroom_id
  INTO v_strategy, v_max_attempts, v_period_classroom
  FROM public.arcade_verification_period_games pg
  WHERE pg.id = NEW.period_game_id;

  IF v_strategy IS NULL THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] period-game scope is missing.'
      USING ERRCODE = '23503';
  END IF;

  IF v_strategy <> 'PERIOD_PACK_PERMUTED' THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] assignments require PERIOD_PACK_PERMUTED.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.opportunity_number > v_max_attempts THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] opportunity exceeds frozen max_attempts.'
      USING ERRCODE = '23514';
  END IF;

  SELECT s.classroom_id
  INTO v_student_classroom
  FROM public.students s
  WHERE s.id = NEW.student_id;

  IF v_student_classroom IS NULL
     OR v_student_classroom IS DISTINCT FROM v_period_classroom THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] student/classroom mismatch.'
      USING ERRCODE = '23514';
  END IF;

  SELECT (slot.preflight_status = 'READY')
  INTO v_slot_ready
  FROM public.arcade_verification_seed_pack_slots slot
  WHERE slot.id = NEW.seed_slot_id
    AND slot.period_game_id = NEW.period_game_id;

  IF coalesce(v_slot_ready,false) = false THEN
    RAISE EXCEPTION '[ARCADE VERIFY SEED] only READY seed slots may be assigned.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$;

DROP TRIGGER IF EXISTS trg_arcade_validate_verification_seed_assignment
  ON public.arcade_verification_seed_assignments;
CREATE TRIGGER trg_arcade_validate_verification_seed_assignment
BEFORE INSERT OR UPDATE OR DELETE
ON public.arcade_verification_seed_assignments
FOR EACH ROW
EXECUTE FUNCTION public.arcade_validate_verification_seed_assignment();

-- -----------------------------------------------------------------------------
-- 7. RLS / ACL: browser clients never access seed internals directly.
-- -----------------------------------------------------------------------------

ALTER TABLE public.arcade_period_game_rule_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_seed_pack_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.arcade_verification_seed_assignments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.arcade_period_game_rule_pins
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_seed_pack_slots
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.arcade_verification_seed_assignments
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON SEQUENCE public.arcade_period_game_rule_pins_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_seed_pack_slots_id_seq
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.arcade_verification_seed_assignments_id_seq
  FROM PUBLIC, anon, authenticated;

-- Internal guard helpers should not be callable from clients.
REVOKE ALL ON FUNCTION public.arcade_validate_period_game_rule_pin()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_guard_verification_seed_slot_write()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_guard_locked_verification_pack_header()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.arcade_validate_verification_seed_assignment()
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Post-migration assertions.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.arcade_runs
    WHERE run_nonce IS NULL
  ) THEN
    RAISE EXCEPTION '[ARCADE STARLINK 2A] run_nonce backfill failed.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_game_configs
    WHERE seed_strategy NOT IN ('RANDOM_PER_ATTEMPT','PERIOD_PACK_PERMUTED')
  ) THEN
    RAISE EXCEPTION '[ARCADE STARLINK 2A] invalid game seed strategy.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.arcade_verification_period_games
    WHERE seed_strategy = 'RANDOM_PER_ATTEMPT'
      AND (
        seed_pack_status <> 'NONE'
        OR seed_pack_locked_at IS NOT NULL
        OR seed_pack_locked_by_run_id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION '[ARCADE STARLINK 2A] legacy/random period-game seed shape changed unexpectedly.';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
