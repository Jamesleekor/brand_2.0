-- B.R.A.N.D 2.0 — E1-A character element seed v1
-- 79/79 active character profiles. Character IDs are resolved by character_uid.

CREATE TEMP TABLE _e1a_character_element_seed (
  character_uid text PRIMARY KEY,
  element_budget smallint NOT NULL,
  primary_element text NOT NULL,
  primary_points smallint NOT NULL,
  secondary_element text NULL,
  secondary_points smallint NOT NULL
) ON COMMIT DROP;

INSERT INTO _e1a_character_element_seed
  (character_uid, element_budget, primary_element, primary_points, secondary_element, secondary_points)
VALUES
  ('CHAR-001', 8, 'EARTH', 6, 'WATER', 2),
  ('CHAR-002', 8, 'EARTH', 6, 'WATER', 2),
  ('CHAR-003', 8, 'FIRE', 6, 'EARTH', 2),
  ('CHAR-004', 8, 'WATER', 6, 'WIND', 2),
  ('CHAR-005', 8, 'WIND', 8, NULL, 0),
  ('CHAR-006', 8, 'DARK', 8, NULL, 0),
  ('CHAR-007', 8, 'WIND', 6, 'EARTH', 2),
  ('CHAR-008', 8, 'WATER', 6, 'EARTH', 2),
  ('CHAR-009', 8, 'LIGHT', 5, 'WATER', 3),
  ('CHAR-010', 8, 'WATER', 5, 'WIND', 3),
  ('CHAR-011', 8, 'FIRE', 5, 'WIND', 3),
  ('CHAR-012', 8, 'WATER', 7, 'WIND', 1),
  ('CHAR-013', 8, 'WATER', 8, NULL, 0),
  ('CHAR-014', 8, 'WATER', 6, 'EARTH', 2),
  ('CHAR-015', 8, 'EARTH', 5, 'WIND', 3),
  ('CHAR-016', 8, 'WIND', 5, 'EARTH', 3),
  ('CHAR-017', 8, 'EARTH', 5, 'FIRE', 3),
  ('CHAR-018', 8, 'WATER', 7, 'WIND', 1),
  ('CHAR-019', 8, 'FIRE', 5, 'WIND', 3),
  ('CHAR-020', 8, 'FIRE', 8, NULL, 0),
  ('CHAR-021', 8, 'EARTH', 5, 'WIND', 3),
  ('CHAR-022', 10, 'LIGHT', 10, NULL, 0),
  ('CHAR-023', 8, 'WIND', 5, 'FIRE', 3),
  ('CHAR-024', 8, 'EARTH', 6, 'WIND', 2),
  ('CHAR-025', 8, 'EARTH', 5, 'WATER', 3),
  ('CHAR-026', 8, 'EARTH', 6, 'FIRE', 2),
  ('CHAR-027', 8, 'EARTH', 5, 'FIRE', 3),
  ('CHAR-028', 8, 'WATER', 6, 'WIND', 2),
  ('CHAR-029', 8, 'FIRE', 5, 'WIND', 3),
  ('CHAR-031', 8, 'WIND', 5, 'EARTH', 3),
  ('CHAR-032', 8, 'DARK', 4, 'WATER', 4),
  ('CHAR-033', 8, 'FIRE', 5, 'EARTH', 3),
  ('CHAR-034', 8, 'WATER', 6, 'EARTH', 2),
  ('CHAR-035', 8, 'WIND', 5, 'EARTH', 3),
  ('CHAR-036', 8, 'WIND', 7, 'FIRE', 1),
  ('CHAR-037', 8, 'WIND', 5, 'FIRE', 3),
  ('CHAR-038', 8, 'EARTH', 5, 'FIRE', 3),
  ('CHAR-039', 8, 'EARTH', 5, 'WIND', 3),
  ('CHAR-040', 8, 'WATER', 5, 'FIRE', 3),
  ('CHAR-041', 8, 'LIGHT', 4, 'WIND', 4),
  ('CHAR-042', 8, 'WATER', 7, 'EARTH', 1),
  ('CHAR-043', 8, 'EARTH', 6, 'WIND', 2),
  ('CHAR-044', 9, 'WIND', 6, 'FIRE', 3),
  ('CHAR-045', 9, 'FIRE', 7, 'EARTH', 2),
  ('CHAR-046', 10, 'LIGHT', 5, 'WATER', 5),
  ('CHAR-047', 9, 'LIGHT', 8, 'WIND', 1),
  ('CHAR-048', 9, 'FIRE', 5, 'DARK', 4),
  ('CHAR-049', 10, 'WATER', 6, 'LIGHT', 4),
  ('CHAR-050', 10, 'FIRE', 6, 'WATER', 4),
  ('CHAR-051', 10, 'EARTH', 7, 'WATER', 3),
  ('CHAR-052', 10, 'LIGHT', 9, 'DARK', 1),
  ('CHAR-053', 10, 'DARK', 7, 'LIGHT', 3),
  ('CHAR-054', 9, 'EARTH', 5, 'WIND', 4),
  ('CHAR-055', 9, 'WIND', 6, 'EARTH', 3),
  ('CHAR-056', 10, 'EARTH', 6, 'WATER', 4),
  ('CHAR-057', 10, 'FIRE', 6, 'WIND', 4),
  ('CHAR-058', 10, 'FIRE', 9, 'DARK', 1),
  ('CHAR-059', 10, 'WIND', 7, 'EARTH', 3),
  ('CHAR-060', 10, 'DARK', 7, 'EARTH', 3),
  ('CHAR-061', 9, 'WIND', 6, 'LIGHT', 3),
  ('CHAR-062', 10, 'DARK', 7, 'WIND', 3),
  ('CHAR-063', 10, 'DARK', 5, 'WATER', 5),
  ('CHAR-064', 10, 'EARTH', 9, 'LIGHT', 1),
  ('CHAR-065', 9, 'FIRE', 6, 'WIND', 3),
  ('CHAR-066', 9, 'WIND', 5, 'LIGHT', 4),
  ('CHAR-067', 9, 'WATER', 8, 'WIND', 1),
  ('CHAR-068', 10, 'FIRE', 7, 'WIND', 3),
  ('CHAR-069', 10, 'FIRE', 6, 'EARTH', 4),
  ('CHAR-070', 10, 'WATER', 9, 'WIND', 1),
  ('CHAR-071', 10, 'FIRE', 6, 'DARK', 4),
  ('CHAR-072', 9, 'FIRE', 5, 'DARK', 4),
  ('CHAR-073', 9, 'EARTH', 6, 'WATER', 3),
  ('CHAR-074', 10, 'LIGHT', 8, 'WATER', 2),
  ('CHAR-075', 10, 'FIRE', 9, 'WATER', 1),
  ('CHAR-076', 10, 'WIND', 8, 'LIGHT', 2),
  ('CHAR-077', 10, 'DARK', 5, 'LIGHT', 5),
  ('CHAR-078', 10, 'DARK', 9, 'FIRE', 1),
  ('CHAR-079', 10, 'DARK', 10, NULL, 0),
  ('CHAR-080', 9, 'LIGHT', 5, 'FIRE', 4);

DO $$
DECLARE
  v_seed_count integer;
  v_active_count integer;
  v_matched_count integer;
  v_missing_active integer;
BEGIN
  SELECT count(*) INTO v_seed_count FROM _e1a_character_element_seed;
  SELECT count(*) INTO v_active_count FROM public.characters WHERE is_active = true;
  SELECT count(*) INTO v_matched_count
  FROM _e1a_character_element_seed s
  JOIN public.characters c ON c.character_uid = s.character_uid AND c.is_active = true;
  SELECT count(*) INTO v_missing_active
  FROM public.characters c
  LEFT JOIN _e1a_character_element_seed s ON s.character_uid = c.character_uid
  WHERE c.is_active = true AND s.character_uid IS NULL;

  IF v_seed_count <> 79 THEN
    RAISE EXCEPTION 'E1-A seed count mismatch: expected 79, got %', v_seed_count;
  END IF;
  IF v_active_count <> 79 THEN
    RAISE EXCEPTION 'E1-A active character count changed: expected 79, got %', v_active_count;
  END IF;
  IF v_matched_count <> v_seed_count OR v_missing_active <> 0 THEN
    RAISE EXCEPTION 'E1-A character_uid coverage mismatch: matched %, missing active %', v_matched_count, v_missing_active;
  END IF;
END $$;

INSERT INTO public.character_element_profiles
  (character_id, element_budget, primary_element, primary_points, secondary_element, secondary_points)
SELECT
  c.id, s.element_budget, s.primary_element, s.primary_points, s.secondary_element, s.secondary_points
FROM _e1a_character_element_seed s
JOIN public.characters c ON c.character_uid = s.character_uid
ON CONFLICT (character_id) DO UPDATE SET
  element_budget = EXCLUDED.element_budget,
  primary_element = EXCLUDED.primary_element,
  primary_points = EXCLUDED.primary_points,
  secondary_element = EXCLUDED.secondary_element,
  secondary_points = EXCLUDED.secondary_points,
  updated_at = now();

DO $$
DECLARE
  v_profile_count integer;
  v_total_points integer;
BEGIN
  SELECT count(*), sum(element_budget)::integer
    INTO v_profile_count, v_total_points
  FROM public.character_element_profiles cep
  JOIN public.characters c ON c.id = cep.character_id
  WHERE c.is_active = true;

  IF v_profile_count <> 79 OR v_total_points <> 695 THEN
    RAISE EXCEPTION 'E1-A post-seed invariant failed: profiles %, total points %', v_profile_count, v_total_points;
  END IF;
END $$;
