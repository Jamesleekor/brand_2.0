-- B.R.A.N.D. 2.0 — Newbie Support source enum
-- MUST remain a standalone migration: the new enum value is used only after commit.
ALTER TYPE public.transaction_source_type ADD VALUE IF NOT EXISTS 'NEWBIE_SETTLEMENT';
