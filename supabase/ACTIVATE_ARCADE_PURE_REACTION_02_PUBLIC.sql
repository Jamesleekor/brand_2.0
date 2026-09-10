-- Game #02를 실제 학생 전체에 공개할 때만 실행하세요.
BEGIN;
UPDATE public.arcade_games
SET available_from=(clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date,
    available_until=NULL,
    is_active=true,
    updated_at=now()
WHERE code='pure_reaction_02';
COMMIT;

SELECT code,internal_name,is_active,available_from,available_until
FROM public.arcade_games WHERE code='pure_reaction_02';
