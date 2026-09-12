-- E1-A smallest DB rollback (only while no later feature depends on this table).
-- Run only after frontend using character_element_profiles has been rolled back/disabled.
DROP TABLE IF EXISTS public.character_element_profiles;
