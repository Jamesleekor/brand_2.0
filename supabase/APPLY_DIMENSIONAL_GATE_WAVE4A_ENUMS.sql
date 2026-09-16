-- =====================================================================
-- B.R.A.N.D 2.0 — Dimensional Gate Wave 4A enum extension
-- IMPORTANT: Run/commit this file before Wave 4B.
-- PostgreSQL enum values cannot safely be consumed in the same transaction
-- in which they are first added.
-- =====================================================================

alter type public.cosmetic_obtained_via add value if not exists 'STORY_REWARD';
alter type public.transaction_source_type add value if not exists 'DIMENSIONAL_GATE_REWARD';
