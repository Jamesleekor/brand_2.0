-- Guild2 refresh is outside arcade scope: it is called unchanged by
-- teacher_finalize_arcade_monthly_snapshot. Replica records the call instead.
CREATE TABLE IF NOT EXISTS public._replica_guild2_refresh_calls(classroom_id int, year_month text, called_at timestamptz DEFAULT clock_timestamp());
CREATE OR REPLACE FUNCTION public.guild2_refresh_monthly_scores(p_classroom_id integer, p_year_month text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public._replica_guild2_refresh_calls(classroom_id,year_month) VALUES (p_classroom_id,p_year_month);
  RETURN jsonb_build_object('replica_stub',true,'year_month',p_year_month);
END $$;

CREATE TRIGGER arcade_prerelease_test_access_set_updated_at BEFORE UPDATE ON public.arcade_prerelease_test_access FOR EACH ROW EXECUTE FUNCTION arcade_set_updated_at();
CREATE TRIGGER arcade_ranking_periods_block_finalized_mutation BEFORE DELETE OR UPDATE ON public.arcade_ranking_periods FOR EACH ROW EXECUTE FUNCTION arcade_block_finalized_period_mutation();
CREATE TRIGGER arcade_ranking_periods_set_updated_at BEFORE UPDATE ON public.arcade_ranking_periods FOR EACH ROW EXECUTE FUNCTION arcade_set_updated_at();
CREATE TRIGGER arcade_monthly_finalizations_immutable BEFORE DELETE OR UPDATE ON public.arcade_monthly_finalizations FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER arcade_run_moderation_events_immutable BEFORE DELETE OR UPDATE ON public.arcade_run_moderation_events FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER arcade_games_set_updated_at BEFORE UPDATE ON public.arcade_games FOR EACH ROW EXECUTE FUNCTION arcade_set_updated_at();
CREATE TRIGGER arcade_verification_game_configs_set_updated_at BEFORE UPDATE ON public.arcade_verification_game_configs FOR EACH ROW EXECUTE FUNCTION arcade_set_updated_at();
CREATE TRIGGER arcade_verification_official_results_set_updated_at BEFORE UPDATE ON public.arcade_verification_official_results FOR EACH ROW EXECUTE FUNCTION arcade_set_updated_at();
CREATE TRIGGER trg_arcade_guard_closed_verification_official_result BEFORE INSERT OR DELETE OR UPDATE ON public.arcade_verification_official_results FOR EACH ROW EXECUTE FUNCTION arcade_guard_closed_verification_official_result();
CREATE TRIGGER arcade_monthly_snapshots_immutable BEFORE DELETE OR UPDATE ON public.arcade_monthly_snapshots FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER records_arcade_snapshot_game_identity_bi BEFORE INSERT ON public.arcade_monthly_snapshots FOR EACH ROW EXECUTE FUNCTION records_arcade_snapshot_game_identity();
CREATE TRIGGER arcade_monthly_snapshot_entries_immutable BEFORE DELETE OR UPDATE ON public.arcade_monthly_snapshot_entries FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER records_arcade_snapshot_entry_identity_bi BEFORE INSERT ON public.arcade_monthly_snapshot_entries FOR EACH ROW EXECUTE FUNCTION records_arcade_snapshot_student_identity();
CREATE TRIGGER arcade_monthly_snapshot_student_ranks_immutable BEFORE DELETE OR UPDATE ON public.arcade_monthly_snapshot_student_ranks FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER records_arcade_snapshot_rank_identity_bi BEFORE INSERT ON public.arcade_monthly_snapshot_student_ranks FOR EACH ROW EXECUTE FUNCTION records_arcade_snapshot_student_identity();
CREATE TRIGGER a_tikatuka_capture_official_completion BEFORE UPDATE ON public.tikatuka_games FOR EACH ROW EXECUTE FUNCTION a_tikatuka_capture_official_completion();
CREATE TRIGGER tikatuka_games_guard_history BEFORE DELETE OR UPDATE ON public.tikatuka_games FOR EACH ROW EXECUTE FUNCTION tikatuka_guard_game_history();
CREATE TRIGGER tikatuka_guard_active_official_difficulty BEFORE INSERT ON public.tikatuka_games FOR EACH ROW EXECUTE FUNCTION tikatuka_guard_active_official_difficulty();
CREATE TRIGGER z_tikatuka_advance_official_session AFTER UPDATE ON public.tikatuka_games FOR EACH ROW EXECUTE FUNCTION z_tikatuka_advance_official_session();
CREATE TRIGGER tikatuka_progress_enforce_win_gate BEFORE UPDATE OF highest_unlocked_difficulty ON public.tikatuka_progress FOR EACH ROW EXECUTE FUNCTION tikatuka_enforce_win_gate_progression();
CREATE TRIGGER tikatuka_progress_set_updated_at BEFORE UPDATE ON public.tikatuka_progress FOR EACH ROW EXECUTE FUNCTION tikatuka_set_updated_at();
CREATE TRIGGER records_tikatuka_monthly_official_entry_identity_bi BEFORE INSERT ON public.tikatuka_monthly_official_snapshot_entries FOR EACH ROW EXECUTE FUNCTION records_arcade_snapshot_student_identity();
CREATE TRIGGER tikatuka_monthly_official_entries_immutable BEFORE DELETE OR UPDATE ON public.tikatuka_monthly_official_snapshot_entries FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER tikatuka_monthly_official_snapshots_immutable BEFORE DELETE OR UPDATE ON public.tikatuka_monthly_official_snapshots FOR EACH ROW EXECUTE FUNCTION arcade_block_immutable_history_mutation();
CREATE TRIGGER arcade_verification_sessions_set_updated_at BEFORE UPDATE ON public.arcade_verification_sessions FOR EACH ROW EXECUTE FUNCTION arcade_set_updated_at();
CREATE TRIGGER trg_arcade_guard_closed_verification_session BEFORE INSERT OR UPDATE OF status ON public.arcade_verification_sessions FOR EACH ROW EXECUTE FUNCTION arcade_guard_closed_verification_session();

-- RLS / grants exactly as production for arcade_* and tikatuka_* tables.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'arcade%' OR tablename LIKE 'tikatuka%') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated, PUBLIC', t);
  END LOOP;
END $$;
GRANT SELECT ON public.arcade_games, public.arcade_ranking_periods TO authenticated;
CREATE POLICY arcade_ranking_periods_classroom_select ON public.arcade_ranking_periods AS PERMISSIVE FOR SELECT TO authenticated USING ((classroom_id = current_classroom_id()));
CREATE POLICY arcade_games_authenticated_select ON public.arcade_games AS PERMISSIVE FOR SELECT TO authenticated USING (true);
