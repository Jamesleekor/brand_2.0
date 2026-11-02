-- Production game catalog rows for GAME 1/2 (ids, rule ids and configs copied
-- read-only from production on 2026-10-30). Starlink is added later by the
-- 20261030_12 migration exactly as it would be in production.
INSERT INTO public.arcade_games(id,code,internal_name,is_active,available_from) VALUES
 (1,'focus_reaction_01','Focus + Reaction + Combo',true,'2026-08-24'),
 (7,'pure_reaction_02','Pure Reaction Speed',true,'2026-09-10');
SELECT setval('public.arcade_games_id_seq', 7);
INSERT INTO public.arcade_game_rule_versions(id,game_id,version_code,config,is_active) VALUES
 (1,1,'v0.1','{"lives":3,"game_code":"focus_reaction_01","countdown_ms":5000,"max_input_events":20000,"damage_recovery_ms":600,"max_client_elapsed_ms":3600000,"client_end_tolerance_ms":2000,"server_elapsed_tolerance_ms":10000}'::jsonb,true),
 (2,7,'v0.1','{"game_code":"pure_reaction_02","waitMaxMs":4500,"waitMinMs":1500,"trialCount":5,"visualTheme":"MAGIC_CORE_IGNITION","countdown_ms":5000,"max_input_events":5,"responseTimeoutMs":3000,"minValidReactionMs":120,"interTrialFeedbackMs":700,"max_client_elapsed_ms":60000,"client_end_tolerance_ms":2000,"server_elapsed_tolerance_ms":10000}'::jsonb,true);
SELECT setval('public.arcade_game_rule_versions_id_seq', 2);
INSERT INTO public.arcade_verification_game_configs(game_id,is_enabled,target_rank_count,threshold_percent,max_attempts) VALUES (1,true,10,80,3),(7,true,10,80,3);
INSERT INTO public.arcade_analytics_game_semantics(game_id,comparison_mode) VALUES (1,'HIGHER_SCORE_BETTER'),(7,'HIGHER_SCORE_BETTER');
