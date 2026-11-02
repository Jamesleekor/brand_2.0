-- =============================================================================
-- ACTIVATE Starlink #04 for students — run ONLY after the user's explicit
-- approval, after 20261030_10..13 are applied, POSTCHECK is all OK and the
-- pre-release test on real Chromebooks/Android has passed.
--
-- One gate: available_from (KST date). From that date the game is listed for
-- students, standard runs are ranked, and any monthly period that overlaps it
-- will include Starlink when frozen (verification config is already enabled).
-- Recommended: the first day of the next Arcade month (e.g. 2026-11-01), and
-- only after the October period has been finalized.
-- =============================================================================
BEGIN;
UPDATE public.arcade_games
SET available_from = DATE '2026-11-01'          -- ← change to the approved KST date
WHERE code = 'starlink_04' AND available_from = DATE '2099-12-31';
SELECT code, is_active, available_from FROM public.arcade_games WHERE code='starlink_04';
COMMIT;

-- Emergency hide (before that month is frozen):
-- UPDATE public.arcade_games SET available_from = DATE '2099-12-31' WHERE code='starlink_04';
