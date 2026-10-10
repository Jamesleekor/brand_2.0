-- =============================================================================
-- B.R.A.N.D 2.0 — Starlink #04 preregistration
-- 2026-10-11
--
-- Safe preregistration only:
--   * game row exists but is_active = false
--   * v0.3 rule config is stored
--   * verification config exists but is_enabled = false
--
-- The game MUST NOT be activated until:
--   1) client game engine exists,
--   2) server replay validator exists,
--   3) arcade_starlink_04_prepare_seed_pack(bigint) exists,
--   4) Golden deterministic fixtures pass.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema='public'
      AND table_name='arcade_verification_game_configs'
      AND column_name='seed_strategy'
  ) THEN
    RAISE EXCEPTION '[STARLINK 04] STEP 2-A seed strategy schema is missing.';
  END IF;
END;
$$;

INSERT INTO public.arcade_games(
  code,
  internal_name,
  is_active,
  available_from,
  available_until
)
VALUES(
  'starlink_04',
  'Starlink',
  false,
  DATE '2026-10-11',
  NULL
)
ON CONFLICT(code) DO UPDATE
SET
  internal_name=EXCLUDED.internal_name,
  -- Safety: preregistration never activates an existing game.
  is_active=false,
  updated_at=now();

WITH game_row AS (
  SELECT id
  FROM public.arcade_games
  WHERE code='starlink_04'
)
INSERT INTO public.arcade_game_rule_versions(
  game_id,
  version_code,
  config,
  is_active
)
SELECT
  game_row.id,
  'starlink_04_v0.3',
  jsonb_build_object(
    'game_code','starlink_04',
    'rule_version','starlink_04_v0.3',

    'rows',7,
    'cols',7,
    'starTypeCount',6,
    'minLinkCount',3,
    'loopMinUniqueCount',5,
    'loopMinAreaTwice',2,
    'allowDiagonal',true,
    'allowImmediateBacktrack',true,

    'activeDurationMs',60000,
    'comboWindowMs',2000,
    'comboStepPercent',5,
    'comboMaxPercent',150,
    'baseScoreFactor',25,
    'loopBonusPercent',125,

    'settleMs',200,
    'reshufflePauseMs',350,
    'initialMaxComponentSoft',8,
    'initialGenerationAttempts',64,
    'reshuffleAttempts',64,
    'fallbackTargetCells',jsonb_build_array(23,24,25),

    'rngInitialDomain',2738958700,
    'rngRefillDomain',3355524772,
    'rngReshuffleDomain',2911926141,
    'rngZeroFallback',1831565813,

    'countdown_ms',5000,
    'max_input_events',5000,
    'max_client_elapsed_ms',180000,
    'server_elapsed_tolerance_ms',10000,
    'client_end_tolerance_ms',2000,
    'verification_countdown_stale_ms',120000,
    'verification_submission_grace_ms',120000,

    'visualTheme','CELESTIAL_CONSTELLATION_BOARD'
  ),
  true
FROM game_row
ON CONFLICT(game_id,version_code) DO UPDATE
SET
  config=EXCLUDED.config,
  is_active=true;

-- Only one Starlink rule version may be active at preregistration.
UPDATE public.arcade_game_rule_versions rv
SET is_active=false
WHERE rv.game_id=(SELECT id FROM public.arcade_games WHERE code='starlink_04')
  AND rv.version_code<>'starlink_04_v0.3'
  AND rv.is_active;

INSERT INTO public.arcade_verification_game_configs(
  game_id,
  is_enabled,
  target_rank_count,
  threshold_percent,
  max_attempts,
  seed_strategy,
  updated_at
)
SELECT
  g.id,
  false,
  10,
  80,
  3,
  'PERIOD_PACK_PERMUTED',
  now()
FROM public.arcade_games g
WHERE g.code='starlink_04'
ON CONFLICT(game_id) DO UPDATE
SET
  -- Safety: validator/seed-pack implementation must explicitly enable later.
  is_enabled=false,
  target_rank_count=10,
  threshold_percent=80,
  max_attempts=3,
  seed_strategy='PERIOD_PACK_PERMUTED',
  updated_at=now();

DO $$
DECLARE
  v_game public.arcade_games%ROWTYPE;
  v_rule public.arcade_game_rule_versions%ROWTYPE;
BEGIN
  SELECT *
  INTO v_game
  FROM public.arcade_games
  WHERE code='starlink_04';

  IF NOT FOUND OR v_game.is_active THEN
    RAISE EXCEPTION '[STARLINK 04] preregistered game must remain inactive.';
  END IF;

  SELECT *
  INTO v_rule
  FROM public.arcade_game_rule_versions
  WHERE game_id=v_game.id
    AND version_code='starlink_04_v0.3';

  IF NOT FOUND OR NOT v_rule.is_active THEN
    RAISE EXCEPTION '[STARLINK 04] v0.3 rule registration failed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.arcade_verification_game_configs c
    WHERE c.game_id=v_game.id
      AND NOT c.is_enabled
      AND c.target_rank_count=10
      AND c.threshold_percent=80
      AND c.max_attempts=3
      AND c.seed_strategy='PERIOD_PACK_PERMUTED'
  ) THEN
    RAISE EXCEPTION '[STARLINK 04] disabled verification preregistration failed.';
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
