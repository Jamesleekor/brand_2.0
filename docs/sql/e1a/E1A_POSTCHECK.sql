-- E1-A read-only postcheck
SELECT count(*) AS profile_count, sum(element_budget) AS total_points
FROM public.character_element_profiles;

WITH points AS (
  SELECT primary_element AS element, primary_points AS points FROM public.character_element_profiles
  UNION ALL
  SELECT secondary_element, secondary_points FROM public.character_element_profiles WHERE secondary_element IS NOT NULL
)
SELECT element, sum(points) AS points, round(100.0 * sum(points) / sum(sum(points)) OVER (), 2) AS pct
FROM points GROUP BY element ORDER BY points DESC;

SELECT c.character_uid, c.name, cep.*
FROM public.character_element_profiles cep
JOIN public.characters c ON c.id=cep.character_id
WHERE c.character_uid IN ('CHAR-022','CHAR-041','CHAR-042','CHAR-047','CHAR-052','CHAR-058','CHAR-060','CHAR-064','CHAR-074','CHAR-076','CHAR-079','CHAR-080')
ORDER BY c.character_uid;
