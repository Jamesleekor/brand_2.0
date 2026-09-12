-- B.R.A.N.D 2.0 — E1-A shared character element profile foundation
-- Generic master data for Fragment Expedition and future Boss Raid damage calculations.

CREATE TABLE public.character_element_profiles (
  character_id bigint PRIMARY KEY REFERENCES public.characters(id) ON DELETE RESTRICT,
  element_budget smallint NOT NULL,
  primary_element text NOT NULL,
  primary_points smallint NOT NULL,
  secondary_element text NULL,
  secondary_points smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT character_element_profiles_budget_chk
    CHECK (element_budget IN (8, 9, 10)),
  CONSTRAINT character_element_profiles_primary_element_chk
    CHECK (primary_element IN ('WATER','FIRE','WIND','EARTH','LIGHT','DARK')),
  CONSTRAINT character_element_profiles_secondary_element_chk
    CHECK (secondary_element IS NULL OR secondary_element IN ('WATER','FIRE','WIND','EARTH','LIGHT','DARK')),
  CONSTRAINT character_element_profiles_primary_points_chk
    CHECK (primary_points BETWEEN 1 AND 10),
  CONSTRAINT character_element_profiles_secondary_points_chk
    CHECK (secondary_points BETWEEN 0 AND 10),
  CONSTRAINT character_element_profiles_secondary_pair_chk
    CHECK (
      (secondary_points = 0 AND secondary_element IS NULL)
      OR (secondary_points > 0 AND secondary_element IS NOT NULL)
    ),
  CONSTRAINT character_element_profiles_distinct_elements_chk
    CHECK (secondary_element IS NULL OR primary_element <> secondary_element),
  CONSTRAINT character_element_profiles_budget_sum_chk
    CHECK (primary_points + secondary_points = element_budget)
);

COMMENT ON TABLE public.character_element_profiles IS
  'Shared character element master profile. Used by Fragment Expedition and future Boss Raid calculations; not expedition-specific.';
COMMENT ON COLUMN public.character_element_profiles.element_budget IS
  'Explicit master budget (8/9/10). Never derive dynamically from current recruitment price.';
COMMENT ON COLUMN public.character_element_profiles.secondary_element IS
  'NULL for pure single-element characters. Do not store a fake 0-point secondary element.';

CREATE TRIGGER trg_character_element_profiles_updated_at
BEFORE UPDATE ON public.character_element_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.character_element_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.character_element_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.character_element_profiles TO authenticated;
GRANT ALL ON TABLE public.character_element_profiles TO service_role;

CREATE POLICY character_element_profiles_select
ON public.character_element_profiles
FOR SELECT
TO authenticated
USING (true);
