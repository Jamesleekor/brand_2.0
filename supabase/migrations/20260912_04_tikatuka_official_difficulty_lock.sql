-- Rakaruka official challenge: while a five-match challenge is ACTIVE,
-- every newly issued Rakaruka game must use that session's fixed difficulty.

CREATE OR REPLACE FUNCTION public.tikatuka_guard_active_official_difficulty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_period date := date_trunc('month', timezone('Asia/Seoul', now()))::date;
  v_difficulty integer;
BEGIN
  SELECT difficulty
  INTO v_difficulty
  FROM public.tikatuka_official_sessions
  WHERE classroom_id = NEW.classroom_id
    AND student_id = NEW.student_id
    AND period_key = v_period
    AND status = 'ACTIVE'
  ORDER BY started_at DESC, id DESC
  LIMIT 1;

  IF v_difficulty IS NOT NULL AND NEW.difficulty <> v_difficulty THEN
    RAISE EXCEPTION '[TIKATUKA] active official challenge is locked to difficulty %.', v_difficulty
      USING ERRCODE = 'PTK43';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tikatuka_guard_active_official_difficulty
  BEFORE INSERT ON public.tikatuka_games
  FOR EACH ROW
  EXECUTE FUNCTION public.tikatuka_guard_active_official_difficulty();

REVOKE ALL ON FUNCTION public.tikatuka_guard_active_official_difficulty() FROM PUBLIC, anon, authenticated;
