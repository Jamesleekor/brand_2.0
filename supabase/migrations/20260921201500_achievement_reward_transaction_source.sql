-- Source-control mirror only.
-- Production Supabase enum was already updated on 2026-09-21.
alter type public.transaction_source_type
  add value if not exists 'ACHIEVEMENT_REWARD';
