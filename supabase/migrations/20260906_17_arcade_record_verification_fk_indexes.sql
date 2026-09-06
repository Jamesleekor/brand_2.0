-- B.R.A.N.D 2.0 Arcade record verification follow-up
-- Add leading indexes for every FK introduced by 20260906_16.
-- Production equivalent was applied after performance-advisor review.

CREATE INDEX ix_av_pg_classroom ON public.arcade_verification_period_games(classroom_id);
CREATE INDEX ix_av_pg_game ON public.arcade_verification_period_games(game_id);

CREATE INDEX ix_av_prov_classroom ON public.arcade_verification_provisional_entries(classroom_id);
CREATE INDEX ix_av_prov_game ON public.arcade_verification_provisional_entries(game_id);
CREATE INDEX ix_av_prov_student ON public.arcade_verification_provisional_entries(student_id);
CREATE INDEX ix_av_prov_source_run ON public.arcade_verification_provisional_entries(source_run_id);
CREATE INDEX ix_av_prov_rule_version ON public.arcade_verification_provisional_entries(rule_version_id);

CREATE INDEX ix_av_sess_classroom ON public.arcade_verification_sessions(classroom_id);
CREATE INDEX ix_av_sess_game ON public.arcade_verification_sessions(game_id);
CREATE INDEX ix_av_sess_student ON public.arcade_verification_sessions(student_id);
CREATE INDEX ix_av_sess_provisional_entry ON public.arcade_verification_sessions(provisional_entry_id);
CREATE INDEX ix_av_sess_provisional_source_run ON public.arcade_verification_sessions(provisional_source_run_id);
CREATE INDEX ix_av_sess_rule_version ON public.arcade_verification_sessions(rule_version_id);

CREATE INDEX ix_av_off_classroom ON public.arcade_verification_official_results(classroom_id);
CREATE INDEX ix_av_off_game ON public.arcade_verification_official_results(game_id);
CREATE INDEX ix_av_off_student ON public.arcade_verification_official_results(student_id);
CREATE INDEX ix_av_off_session ON public.arcade_verification_official_results(session_id);
CREATE INDEX ix_av_off_source_run ON public.arcade_verification_official_results(source_run_id);

CREATE INDEX ix_av_corr_classroom ON public.arcade_verification_corrections(classroom_id);
CREATE INDEX ix_av_corr_game ON public.arcade_verification_corrections(game_id);
CREATE INDEX ix_av_corr_student ON public.arcade_verification_corrections(student_id);
CREATE INDEX ix_av_corr_source_run ON public.arcade_verification_corrections(source_run_id);

CREATE INDEX ix_av_audit_classroom ON public.arcade_verification_audit_events(classroom_id);
CREATE INDEX ix_av_audit_game ON public.arcade_verification_audit_events(game_id);
CREATE INDEX ix_av_audit_student ON public.arcade_verification_audit_events(student_id);
CREATE INDEX ix_av_audit_session ON public.arcade_verification_audit_events(session_id);
CREATE INDEX ix_av_audit_attempt ON public.arcade_verification_audit_events(attempt_id);
