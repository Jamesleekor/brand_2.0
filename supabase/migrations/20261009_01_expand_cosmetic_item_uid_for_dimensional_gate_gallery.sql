-- Dimensional Gate story-gallery home backgrounds use deterministic item UIDs
-- such as DG_BG_CHAR_081_E01_C0103. The legacy varchar(20) limit is too short
-- for those IDs and causes teacher_save_dimensional_gate_story_package() to fail
-- when home_background_allowed=true.
--
-- Widening the identifier column is non-destructive and preserves the existing
-- unique/index semantics while allowing current and future DG-generated UIDs.

alter table public.cosmetic_items
  alter column item_uid type varchar(64);
