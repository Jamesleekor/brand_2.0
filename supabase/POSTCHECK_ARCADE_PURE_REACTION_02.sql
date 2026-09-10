-- B.R.A.N.D 2.0 Game #02 — SQL Editor-safe postcheck
SELECT g.id,g.code,g.internal_name,g.is_active,g.available_from,
       rv.id AS rule_version_id,rv.version_code,rv.is_active AS rule_active,rv.config
FROM public.arcade_games g
JOIN public.arcade_game_rule_versions rv ON rv.game_id=g.id
WHERE g.code='pure_reaction_02'
ORDER BY rv.id DESC;

SELECT c.game_id,g.code,c.is_enabled,c.target_rank_count,c.threshold_percent,c.max_attempts
FROM public.arcade_verification_game_configs c JOIN public.arcade_games g ON g.id=c.game_id
WHERE g.code='pure_reaction_02';

SELECT to_regprocedure('public.arcade_pure_reaction_02_waits(bigint,jsonb)') AS wait_helper,
       to_regprocedure('public.arcade_validate_pure_reaction_02_submission(bigint,jsonb,jsonb,integer)') AS validator,
       to_regprocedure('public.student_submit_pure_reaction_02_run(bigint,jsonb,integer)') AS submit_rpc;

-- Deterministic wait fixture. Expected: 3694,2874,3388,2894,2366.
WITH cfg AS (
  SELECT rv.config FROM public.arcade_game_rule_versions rv
  JOIN public.arcade_games g ON g.id=rv.game_id
  WHERE g.code='pure_reaction_02' AND rv.version_code='v0.1'
  ORDER BY rv.id DESC LIMIT 1
)
SELECT array_agg(w.wait_ms ORDER BY w.trial_index) AS waits
FROM cfg CROSS JOIN LATERAL public.arcade_pure_reaction_02_waits(123456789,cfg.config) w;

-- Locked valid fixture: reactions [211,224,196,218,205], sum 1054, avg 210.8, SCORE 22503.
WITH cfg AS (
  SELECT rv.config FROM public.arcade_game_rule_versions rv
  JOIN public.arcade_games g ON g.id=rv.game_id
  WHERE g.code='pure_reaction_02' AND rv.version_code='v0.1'
  ORDER BY rv.id DESC LIMIT 1
)
SELECT public.arcade_validate_pure_reaction_02_submission(
  123456789,cfg.config,
  '[{"elapsed_ms":3905,"source":"SPACE"},{"elapsed_ms":7703,"source":"POINTER"},{"elapsed_ms":11987,"source":"SPACE"},{"elapsed_ms":15799,"source":"POINTER"},{"elapsed_ms":19070,"source":"SPACE"}]'::jsonb,
  19070
) AS valid_fixture
FROM cfg;

-- 119ms must be anticipatory false start.
WITH cfg AS (
  SELECT rv.config FROM public.arcade_game_rule_versions rv
  JOIN public.arcade_games g ON g.id=rv.game_id
  WHERE g.code='pure_reaction_02' AND rv.version_code='v0.1'
  ORDER BY rv.id DESC LIMIT 1
)
SELECT public.arcade_validate_pure_reaction_02_submission(
  123456789,cfg.config,'[{"elapsed_ms":3813,"source":"SPACE"}]'::jsonb,3813
) AS under_120_fixture
FROM cfg;

-- First-trial timeout. Expected REACTION_TIMEOUT, official_duration_ms 6694.
WITH cfg AS (
  SELECT rv.config FROM public.arcade_game_rule_versions rv
  JOIN public.arcade_games g ON g.id=rv.game_id
  WHERE g.code='pure_reaction_02' AND rv.version_code='v0.1'
  ORDER BY rv.id DESC LIMIT 1
)
SELECT public.arcade_validate_pure_reaction_02_submission(123456789,cfg.config,'[]'::jsonb,6694) AS timeout_fixture
FROM cfg;

SELECT grantee,privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema='public' AND routine_name IN('arcade_pure_reaction_02_waits','arcade_validate_pure_reaction_02_submission','student_submit_pure_reaction_02_run')
ORDER BY routine_name,grantee,privilege_type;
