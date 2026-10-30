-- =============================================================================
-- B.R.A.N.D 2.0 — GAME 4 Starlink — hidden pre-registration. 2026-10-30.
--
-- Why not "is_active=false + verification disabled" (old 20261011_04)?
--   teacher_freeze_arcade_monthly_period() refuses to freeze a month when any
--   game whose available_from..available_until overlaps the month lacks an
--   ENABLED verification config (P0260), regardless of is_active. A disabled
--   config would therefore block the next monthly freeze.
--
-- Hidden state used here:
--   * arcade_games.is_active = true, available_from = 2099-12-31
--       -> no student can start it (student_create_arcade_run P0197),
--       -> it is outside every real monthly period (freeze ignores it),
--       -> students with arcade_prerelease_test_access may run PRERELEASE
--          tests (is_prerelease_test=true, never ranked).
--   * verification config enabled (80%, 3 attempts, Top 10) so that the day
--     available_from is moved into a month, freeze includes Starlink normally.
--
-- Activation (separate, user-approved step):
--   UPDATE public.arcade_games SET available_from = DATE '<KST first day>'
--   WHERE code = 'starlink_04';
-- Emergency hide:
--   UPDATE public.arcade_games SET available_from = DATE '2099-12-31'
--   WHERE code = 'starlink_04';   -- only before that month is frozen.
--
-- Re-running this file is safe: it never changes an existing game row, so it
-- cannot silently turn an activated Starlink off.
-- =============================================================================

BEGIN;

INSERT INTO public.arcade_games(code, internal_name, is_active, available_from, available_until)
VALUES ('starlink_04', '스타링크', true, DATE '2099-12-31', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.arcade_game_rule_versions(game_id, version_code, config, is_active)
SELECT g.id, 'v0.3', jsonb_build_object(
  'game_code', 'starlink_04',
  'ruleVersion', 'starlink_04_v0.3',
  'countdown_ms', 5000,
  'server_elapsed_tolerance_ms', 20000,
  'rows', 7, 'cols', 7, 'starTypeCount', 6,
  'minLinkCount', 3, 'loopMinUniqueCount', 5, 'loopMinTwiceArea', 2,
  'allowDiagonal', true, 'allowImmediateBacktrack', true,
  'activeDurationMs', 60000, 'comboWindowMs', 2000,
  'comboStepPercent', 5, 'comboMaxPercent', 150,
  'baseScoreFactor', 25, 'loopBonusPercent', 125,
  'settleMs', 200, 'reshufflePauseMs', 350,
  'initialMaxComponentSoft', 8, 'initialGenerationAttempts', 64, 'reshuffleAttempts', 64,
  'submissionEarlyToleranceMs', 100,
  'rngInitialDomain', '0xA341316C', 'rngRefillDomain', '0xC8013EA4',
  'rngReshuffleDomain', '0xAD90777D', 'rngZeroFallback', '0x6D2B79F5',
  'fallbackTargetCells', jsonb_build_array(23,24,25),
  'maxInputEvents', 5000,
  'visualTheme', 'CELESTIAL_CONSTELLATION_BOARD'
), true
FROM public.arcade_games g
WHERE g.code='starlink_04'
  AND NOT EXISTS (SELECT 1 FROM public.arcade_game_rule_versions rv WHERE rv.game_id=g.id);

INSERT INTO public.arcade_verification_game_configs(game_id, is_enabled, target_rank_count, threshold_percent, max_attempts)
SELECT g.id, true, 10, 80, 3 FROM public.arcade_games g WHERE g.code='starlink_04'
ON CONFLICT (game_id) DO NOTHING;

INSERT INTO public.arcade_analytics_game_semantics(game_id, comparison_mode, notes)
SELECT g.id, 'HIGHER_SCORE_BETTER', 'Starlink #04: official_score higher is better (server replay).'
FROM public.arcade_games g WHERE g.code='starlink_04'
ON CONFLICT (game_id) DO NOTHING;

DO $postcheck$
DECLARE v record;
BEGIN
  SELECT g.is_active, g.available_from, rv.version_code, (rv.config->>'countdown_ms')::int AS cd,
         vc.is_enabled, vc.max_attempts, vc.threshold_percent, vc.target_rank_count
  INTO v
  FROM public.arcade_games g
  JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id AND rv.is_active
  JOIN public.arcade_verification_game_configs vc ON vc.game_id=g.id
  WHERE g.code='starlink_04';
  IF NOT FOUND OR v.cd<>5000 OR NOT v.is_enabled OR v.max_attempts<>3 OR v.threshold_percent<>80 OR v.target_rank_count<>10 THEN
    RAISE EXCEPTION '[STARLINK 04] pre-registration postcheck failed: %', row_to_json(v);
  END IF;
  RAISE NOTICE '[STARLINK 04] registered. available_from=% (hidden until changed).', v.available_from;
END;
$postcheck$;

COMMIT;
NOTIFY pgrst, 'reload schema';
