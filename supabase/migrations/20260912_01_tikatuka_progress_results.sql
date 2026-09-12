-- =============================================================================
-- B.R.A.N.D 2.0 — Tikatuka progress + idempotent result persistence
-- 2026-09-12
--
-- Security model
--   * The client never supplies student_id/classroom_id.
--   * Server context comes from current_student_id()/current_classroom_id().
--   * Direct table access is denied; authenticated clients use narrow RPCs only.
--   * The server issues each game UUID after checking unlocked difficulty.
--   * Completion is idempotent by game UUID.
--   * Final 3x3 boards are validated and all score/row/winner fields are
--     recomputed server-side before progression can advance.
--   * This migration intentionally does NOT add Arcade ranking/Guild2 rewards.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.students') IS NULL
     OR to_regclass('public.classrooms') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] required identity tables are missing.';
  END IF;

  IF to_regprocedure('public.current_student_id()') IS NULL
     OR to_regprocedure('public.current_classroom_id()') IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] required identity helpers are missing.';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 1. Server-owned progress and issued games
-- -----------------------------------------------------------------------------
CREATE TABLE public.tikatuka_progress (
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  highest_unlocked_difficulty smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, student_id),
  CONSTRAINT tikatuka_progress_difficulty_check
    CHECK (highest_unlocked_difficulty BETWEEN 1 AND 10)
);

COMMENT ON TABLE public.tikatuka_progress IS
  'Server-owned Tikatuka progression. Clients cannot directly write unlock state.';

CREATE TABLE public.tikatuka_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id integer NOT NULL REFERENCES public.classrooms(id),
  student_id integer NOT NULL REFERENCES public.students(id),
  engine_version smallint NOT NULL DEFAULT 1,
  difficulty smallint NOT NULL,
  status text NOT NULL DEFAULT 'READY',
  client_submission jsonb,
  final_boards jsonb,
  server_result jsonb,
  server_winner text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT tikatuka_games_engine_version_check CHECK (engine_version = 1),
  CONSTRAINT tikatuka_games_difficulty_check CHECK (difficulty BETWEEN 1 AND 10),
  CONSTRAINT tikatuka_games_status_check CHECK (status IN ('READY', 'COMPLETED')),
  CONSTRAINT tikatuka_games_server_winner_check
    CHECK (server_winner IS NULL OR server_winner IN ('player', 'ai', 'draw')),
  CONSTRAINT tikatuka_games_json_shape_check CHECK (
    (client_submission IS NULL OR jsonb_typeof(client_submission) = 'object')
    AND (final_boards IS NULL OR jsonb_typeof(final_boards) = 'object')
    AND (server_result IS NULL OR jsonb_typeof(server_result) = 'object')
  ),
  CONSTRAINT tikatuka_games_completed_shape_check CHECK (
    (status = 'READY'
      AND client_submission IS NULL
      AND final_boards IS NULL
      AND server_result IS NULL
      AND server_winner IS NULL
      AND completed_at IS NULL)
    OR
    (status = 'COMPLETED'
      AND client_submission IS NOT NULL
      AND final_boards IS NOT NULL
      AND server_result IS NOT NULL
      AND server_winner IS NOT NULL
      AND completed_at IS NOT NULL)
  )
);

CREATE INDEX ix_tikatuka_games_student_completed
  ON public.tikatuka_games(classroom_id, student_id, completed_at DESC)
  WHERE status = 'COMPLETED';

COMMENT ON TABLE public.tikatuka_games IS
  'Server-issued Tikatuka games. A UUID may complete only once; completed rows are immutable audit evidence.';

-- -----------------------------------------------------------------------------
-- 2. Defensive mutation guards
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tikatuka_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER tikatuka_progress_set_updated_at
  BEFORE UPDATE ON public.tikatuka_progress
  FOR EACH ROW EXECUTE FUNCTION public.tikatuka_set_updated_at();

CREATE OR REPLACE FUNCTION public.tikatuka_guard_game_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[TIKATUKA] game history is immutable.' USING ERRCODE = 'PTK20';
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION '[TIKATUKA] completed game history is immutable.' USING ERRCODE = 'PTK20';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.classroom_id IS DISTINCT FROM OLD.classroom_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
     OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
     OR NEW.difficulty IS DISTINCT FROM OLD.difficulty
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    RAISE EXCEPTION '[TIKATUKA] issued game identity is immutable.' USING ERRCODE = 'PTK20';
  END IF;

  IF NEW.status <> 'COMPLETED' THEN
    RAISE EXCEPTION '[TIKATUKA] READY games may only transition to COMPLETED.' USING ERRCODE = 'PTK20';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER tikatuka_games_guard_history
  BEFORE UPDATE OR DELETE ON public.tikatuka_games
  FOR EACH ROW EXECUTE FUNCTION public.tikatuka_guard_game_history();

-- -----------------------------------------------------------------------------
-- 3. Pure server-side final-board validation / scoring helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tikatuka_validate_final_boards(p_boards jsonb)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_side text;
  v_row text;
  v_board jsonb;
  v_row_data jsonb;
  v_die jsonb;
BEGIN
  IF p_boards IS NULL OR jsonb_typeof(p_boards) <> 'object' THEN
    RAISE EXCEPTION '[TIKATUKA] final boards must be an object.' USING ERRCODE = 'PTK10';
  END IF;

  FOREACH v_side IN ARRAY ARRAY['player', 'ai'] LOOP
    v_board := p_boards -> v_side;
    IF v_board IS NULL OR jsonb_typeof(v_board) <> 'object' THEN
      RAISE EXCEPTION '[TIKATUKA] final board is missing side %.', v_side USING ERRCODE = 'PTK10';
    END IF;

    FOREACH v_row IN ARRAY ARRAY['top', 'middle', 'bottom'] LOOP
      v_row_data := v_board -> v_row;
      IF v_row_data IS NULL
         OR jsonb_typeof(v_row_data) <> 'array'
         OR jsonb_array_length(v_row_data) <> 3 THEN
        RAISE EXCEPTION '[TIKATUKA] final row %.% must contain exactly 3 dice.', v_side, v_row USING ERRCODE = 'PTK10';
      END IF;

      FOR v_die IN SELECT value FROM jsonb_array_elements(v_row_data) LOOP
        IF jsonb_typeof(v_die) <> 'object'
           OR coalesce(v_die ->> 'value', '') !~ '^[1-6]$'
           OR coalesce(v_die ->> 'kind', '') NOT IN ('normal', 'shield') THEN
          RAISE EXCEPTION '[TIKATUKA] final board contains an invalid die.' USING ERRCODE = 'PTK10';
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.tikatuka_row_score(p_row jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum(face_value * CASE face_count WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 5 ELSE 0 END), 0)::integer
  FROM (
    SELECT (die ->> 'value')::integer AS face_value, count(*)::integer AS face_count
    FROM jsonb_array_elements(p_row) AS die
    GROUP BY (die ->> 'value')::integer
  ) grouped_faces;
$$;

CREATE OR REPLACE FUNCTION public.tikatuka_board_raw_pips(p_board jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT coalesce(sum((die ->> 'value')::integer), 0)::integer
  FROM (
    SELECT value AS die FROM jsonb_array_elements(p_board -> 'top')
    UNION ALL
    SELECT value AS die FROM jsonb_array_elements(p_board -> 'middle')
    UNION ALL
    SELECT value AS die FROM jsonb_array_elements(p_board -> 'bottom')
  ) dice;
$$;

-- Internal helper: no authenticated EXECUTE grant is provided below.
CREATE OR REPLACE FUNCTION public.tikatuka_progress_payload(
  p_classroom_id integer,
  p_student_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_highest integer;
  v_cleared smallint[];
  v_games integer;
  v_wins integer;
  v_losses integer;
  v_draws integer;
  v_last_played timestamptz;
BEGIN
  SELECT highest_unlocked_difficulty
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = p_classroom_id AND student_id = p_student_id;

  v_highest := coalesce(v_highest, 1);

  SELECT
    coalesce(array_agg(DISTINCT difficulty ORDER BY difficulty)
      FILTER (WHERE server_winner = 'player'), ARRAY[]::smallint[]),
    count(*)::integer,
    count(*) FILTER (WHERE server_winner = 'player')::integer,
    count(*) FILTER (WHERE server_winner = 'ai')::integer,
    count(*) FILTER (WHERE server_winner = 'draw')::integer,
    max(completed_at)
  INTO v_cleared, v_games, v_wins, v_losses, v_draws, v_last_played
  FROM public.tikatuka_games
  WHERE classroom_id = p_classroom_id
    AND student_id = p_student_id
    AND status = 'COMPLETED';

  RETURN jsonb_build_object(
    'highest_unlocked_difficulty', v_highest,
    'cleared_difficulties', to_jsonb(v_cleared),
    'games_played', coalesce(v_games, 0),
    'wins', coalesce(v_wins, 0),
    'losses', coalesce(v_losses, 0),
    'draws', coalesce(v_draws, 0),
    'last_played_at', v_last_played
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Student RPC: read progress
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_get_tikatuka_progress()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  RETURN public.tikatuka_progress_payload(v_classroom_id, v_student_id);
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Student RPC: server-issued game UUID after unlock validation
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_create_tikatuka_game(p_difficulty integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_highest integer;
  v_game public.tikatuka_games;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_difficulty IS NULL OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] difficulty must be 1..10.' USING ERRCODE = 'PTK02';
  END IF;

  INSERT INTO public.tikatuka_progress(classroom_id, student_id, highest_unlocked_difficulty)
  VALUES (v_classroom_id, v_student_id, 1)
  ON CONFLICT (classroom_id, student_id) DO NOTHING;

  SELECT highest_unlocked_difficulty
  INTO v_highest
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id AND student_id = v_student_id
  FOR SHARE;

  IF p_difficulty > v_highest THEN
    RAISE EXCEPTION '[TIKATUKA] difficulty % is locked; highest unlocked is %.', p_difficulty, v_highest
      USING ERRCODE = 'PTK03';
  END IF;

  INSERT INTO public.tikatuka_games(classroom_id, student_id, engine_version, difficulty)
  VALUES (v_classroom_id, v_student_id, 1, p_difficulty)
  RETURNING * INTO v_game;

  RETURN jsonb_build_object(
    'game_id', v_game.id,
    'engine_version', v_game.engine_version,
    'difficulty', v_game.difficulty,
    'issued_at', v_game.issued_at,
    'progress', public.tikatuka_progress_payload(v_classroom_id, v_student_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Student RPC: idempotent completion + server score/winner verification
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_submit_tikatuka_result(
  p_game_id uuid,
  p_engine_version integer,
  p_winner text,
  p_difficulty integer,
  p_player_row_wins integer,
  p_ai_row_wins integer,
  p_tied_rows integer,
  p_player_score integer,
  p_ai_score integer,
  p_player_raw_pips integer,
  p_ai_raw_pips integer,
  p_player_knock_count integer,
  p_ai_knock_count integer,
  p_player_dice_removed integer,
  p_ai_dice_removed integer,
  p_player_shields_earned integer,
  p_ai_shields_earned integer,
  p_player_tazza_used integer,
  p_ai_tazza_used integer,
  p_player_hold_used integer,
  p_ai_hold_used integer,
  p_total_turns integer,
  p_final_boards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student_id integer := public.current_student_id();
  v_classroom_id integer := public.current_classroom_id();
  v_game public.tikatuka_games;
  v_progress public.tikatuka_progress;
  v_submission jsonb;
  v_player_top integer;
  v_player_middle integer;
  v_player_bottom integer;
  v_ai_top integer;
  v_ai_middle integer;
  v_ai_bottom integer;
  v_server_player_row_wins integer := 0;
  v_server_ai_row_wins integer := 0;
  v_server_tied_rows integer := 0;
  v_server_player_score integer;
  v_server_ai_score integer;
  v_server_player_raw integer;
  v_server_ai_raw integer;
  v_server_winner text;
  v_player_tazza_limit integer;
  v_player_hold_limit integer;
  v_ai_tazza_limit integer;
  v_ai_hold_limit integer;
  v_server_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_student_id IS NULL OR v_classroom_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] student login is required.' USING ERRCODE = 'PTK01';
  END IF;

  IF p_game_id IS NULL THEN
    RAISE EXCEPTION '[TIKATUKA] game id is required.' USING ERRCODE = 'PTK04';
  END IF;

  SELECT * INTO v_game
  FROM public.tikatuka_games
  WHERE id = p_game_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_game.student_id IS DISTINCT FROM v_student_id
     OR v_game.classroom_id IS DISTINCT FROM v_classroom_id THEN
    RAISE EXCEPTION '[TIKATUKA] issued game was not found for this student.' USING ERRCODE = 'PTK04';
  END IF;

  v_submission := jsonb_build_object(
    'game_id', p_game_id,
    'engine_version', p_engine_version,
    'winner', p_winner,
    'difficulty', p_difficulty,
    'player_row_wins', p_player_row_wins,
    'ai_row_wins', p_ai_row_wins,
    'tied_rows', p_tied_rows,
    'player_score', p_player_score,
    'ai_score', p_ai_score,
    'player_raw_pips', p_player_raw_pips,
    'ai_raw_pips', p_ai_raw_pips,
    'player_knock_count', p_player_knock_count,
    'ai_knock_count', p_ai_knock_count,
    'player_dice_removed', p_player_dice_removed,
    'ai_dice_removed', p_ai_dice_removed,
    'player_shields_earned', p_player_shields_earned,
    'ai_shields_earned', p_ai_shields_earned,
    'player_tazza_used', p_player_tazza_used,
    'ai_tazza_used', p_ai_tazza_used,
    'player_hold_used', p_player_hold_used,
    'ai_hold_used', p_ai_hold_used,
    'total_turns', p_total_turns,
    'final_boards', p_final_boards
  );

  IF v_game.status = 'COMPLETED' THEN
    IF v_game.client_submission IS DISTINCT FROM v_submission THEN
      RAISE EXCEPTION '[TIKATUKA] duplicate game id was submitted with different result data.' USING ERRCODE = 'PTK05';
    END IF;

    RETURN jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'game_id', v_game.id,
      'server_winner', v_game.server_winner,
      'server_result', v_game.server_result,
      'progress', public.tikatuka_progress_payload(v_classroom_id, v_student_id)
    );
  END IF;

  IF p_engine_version IS DISTINCT FROM v_game.engine_version
     OR p_engine_version <> 1 THEN
    RAISE EXCEPTION '[TIKATUKA] engine version mismatch.' USING ERRCODE = 'PTK06';
  END IF;

  IF p_difficulty IS DISTINCT FROM v_game.difficulty
     OR p_difficulty NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION '[TIKATUKA] difficulty does not match the issued game.' USING ERRCODE = 'PTK07';
  END IF;

  IF p_winner NOT IN ('player', 'ai', 'draw') THEN
    RAISE EXCEPTION '[TIKATUKA] winner value is invalid.' USING ERRCODE = 'PTK08';
  END IF;

  IF p_total_turns IS NULL OR p_total_turns < 18 OR p_total_turns > 5000 THEN
    RAISE EXCEPTION '[TIKATUKA] total turn count is outside the supported range.' USING ERRCODE = 'PTK09';
  END IF;

  PERFORM public.tikatuka_validate_final_boards(p_final_boards);

  v_player_top := public.tikatuka_row_score(p_final_boards -> 'player' -> 'top');
  v_player_middle := public.tikatuka_row_score(p_final_boards -> 'player' -> 'middle');
  v_player_bottom := public.tikatuka_row_score(p_final_boards -> 'player' -> 'bottom');
  v_ai_top := public.tikatuka_row_score(p_final_boards -> 'ai' -> 'top');
  v_ai_middle := public.tikatuka_row_score(p_final_boards -> 'ai' -> 'middle');
  v_ai_bottom := public.tikatuka_row_score(p_final_boards -> 'ai' -> 'bottom');

  IF v_player_top > v_ai_top THEN v_server_player_row_wins := v_server_player_row_wins + 1;
  ELSIF v_ai_top > v_player_top THEN v_server_ai_row_wins := v_server_ai_row_wins + 1;
  ELSE v_server_tied_rows := v_server_tied_rows + 1;
  END IF;

  IF v_player_middle > v_ai_middle THEN v_server_player_row_wins := v_server_player_row_wins + 1;
  ELSIF v_ai_middle > v_player_middle THEN v_server_ai_row_wins := v_server_ai_row_wins + 1;
  ELSE v_server_tied_rows := v_server_tied_rows + 1;
  END IF;

  IF v_player_bottom > v_ai_bottom THEN v_server_player_row_wins := v_server_player_row_wins + 1;
  ELSIF v_ai_bottom > v_player_bottom THEN v_server_ai_row_wins := v_server_ai_row_wins + 1;
  ELSE v_server_tied_rows := v_server_tied_rows + 1;
  END IF;

  v_server_player_score := v_player_top + v_player_middle + v_player_bottom;
  v_server_ai_score := v_ai_top + v_ai_middle + v_ai_bottom;
  v_server_player_raw := public.tikatuka_board_raw_pips(p_final_boards -> 'player');
  v_server_ai_raw := public.tikatuka_board_raw_pips(p_final_boards -> 'ai');

  IF v_server_player_row_wins > v_server_ai_row_wins THEN
    v_server_winner := 'player';
  ELSIF v_server_ai_row_wins > v_server_player_row_wins THEN
    v_server_winner := 'ai';
  ELSIF v_server_player_raw > v_server_ai_raw THEN
    v_server_winner := 'player';
  ELSIF v_server_ai_raw > v_server_player_raw THEN
    v_server_winner := 'ai';
  ELSE
    v_server_winner := 'draw';
  END IF;

  IF p_player_row_wins IS DISTINCT FROM v_server_player_row_wins
     OR p_ai_row_wins IS DISTINCT FROM v_server_ai_row_wins
     OR p_tied_rows IS DISTINCT FROM v_server_tied_rows
     OR p_player_score IS DISTINCT FROM v_server_player_score
     OR p_ai_score IS DISTINCT FROM v_server_ai_score
     OR p_player_raw_pips IS DISTINCT FROM v_server_player_raw
     OR p_ai_raw_pips IS DISTINCT FROM v_server_ai_raw
     OR p_winner IS DISTINCT FROM v_server_winner THEN
    RAISE EXCEPTION '[TIKATUKA] submitted result does not match server-recomputed final board result.' USING ERRCODE = 'PTK11';
  END IF;

  IF p_player_knock_count IS NULL OR p_player_knock_count < 0
     OR p_ai_knock_count IS NULL OR p_ai_knock_count < 0
     OR p_player_dice_removed IS NULL OR p_player_dice_removed < 0
     OR p_ai_dice_removed IS NULL OR p_ai_dice_removed < 0
     OR p_player_shields_earned IS NULL OR p_player_shields_earned < 0
     OR p_ai_shields_earned IS NULL OR p_ai_shields_earned < 0
     OR p_player_tazza_used IS NULL OR p_player_tazza_used < 0
     OR p_ai_tazza_used IS NULL OR p_ai_tazza_used < 0
     OR p_player_hold_used IS NULL OR p_player_hold_used < 0
     OR p_ai_hold_used IS NULL OR p_ai_hold_used < 0 THEN
    RAISE EXCEPTION '[TIKATUKA] result counters cannot be negative.' USING ERRCODE = 'PTK12';
  END IF;

  IF p_player_knock_count > p_total_turns
     OR p_ai_knock_count > p_total_turns
     OR p_player_shields_earned <> p_player_knock_count
     OR p_ai_shields_earned <> p_ai_knock_count
     OR p_player_dice_removed < p_player_knock_count
     OR p_ai_dice_removed < p_ai_knock_count
     OR p_player_dice_removed > p_player_knock_count * 3
     OR p_ai_dice_removed > p_ai_knock_count * 3 THEN
    RAISE EXCEPTION '[TIKATUKA] knock/shield counters are inconsistent.' USING ERRCODE = 'PTK13';
  END IF;

  v_player_tazza_limit := CASE p_difficulty
    WHEN 1 THEN 5 WHEN 2 THEN 5 WHEN 3 THEN 4 WHEN 4 THEN 4 WHEN 5 THEN 3
    WHEN 6 THEN 3 WHEN 7 THEN 2 WHEN 8 THEN 2 WHEN 9 THEN 1 WHEN 10 THEN 0 END;
  v_player_hold_limit := CASE WHEN p_difficulty BETWEEN 1 AND 5 THEN 2 ELSE 1 END;
  v_ai_tazza_limit := CASE p_difficulty
    WHEN 1 THEN 0 WHEN 2 THEN 0 WHEN 3 THEN 0
    WHEN 4 THEN 1 WHEN 5 THEN 1 WHEN 6 THEN 1 WHEN 7 THEN 1
    WHEN 8 THEN 2 WHEN 9 THEN 2 WHEN 10 THEN 2 END;
  v_ai_hold_limit := CASE WHEN p_difficulty BETWEEN 7 AND 10 THEN 1 ELSE 0 END;

  IF p_player_tazza_used > v_player_tazza_limit
     OR p_player_hold_used > v_player_hold_limit
     OR p_ai_tazza_used > v_ai_tazza_limit
     OR p_ai_hold_used > v_ai_hold_limit THEN
    RAISE EXCEPTION '[TIKATUKA] skill usage exceeds the issued difficulty limits.' USING ERRCODE = 'PTK14';
  END IF;

  INSERT INTO public.tikatuka_progress(classroom_id, student_id, highest_unlocked_difficulty)
  VALUES (v_classroom_id, v_student_id, 1)
  ON CONFLICT (classroom_id, student_id) DO NOTHING;

  SELECT * INTO v_progress
  FROM public.tikatuka_progress
  WHERE classroom_id = v_classroom_id AND student_id = v_student_id
  FOR UPDATE;

  IF v_game.difficulty > v_progress.highest_unlocked_difficulty THEN
    RAISE EXCEPTION '[TIKATUKA] issued game difficulty is no longer valid for progression.' USING ERRCODE = 'PTK15';
  END IF;

  v_server_result := jsonb_build_object(
    'winner', v_server_winner,
    'difficulty', v_game.difficulty,
    'player_row_wins', v_server_player_row_wins,
    'ai_row_wins', v_server_ai_row_wins,
    'tied_rows', v_server_tied_rows,
    'player_score', v_server_player_score,
    'ai_score', v_server_ai_score,
    'player_raw_pips', v_server_player_raw,
    'ai_raw_pips', v_server_ai_raw,
    'player_knock_count', p_player_knock_count,
    'ai_knock_count', p_ai_knock_count,
    'player_dice_removed', p_player_dice_removed,
    'ai_dice_removed', p_ai_dice_removed,
    'player_shields_earned', p_player_shields_earned,
    'ai_shields_earned', p_ai_shields_earned,
    'player_tazza_used', p_player_tazza_used,
    'ai_tazza_used', p_ai_tazza_used,
    'player_hold_used', p_player_hold_used,
    'ai_hold_used', p_ai_hold_used,
    'total_turns', p_total_turns
  );

  UPDATE public.tikatuka_games
  SET status = 'COMPLETED',
      client_submission = v_submission,
      final_boards = p_final_boards,
      server_result = v_server_result,
      server_winner = v_server_winner,
      completed_at = now()
  WHERE id = v_game.id;

  IF v_server_winner = 'player' THEN
    UPDATE public.tikatuka_progress
    SET highest_unlocked_difficulty = greatest(
      highest_unlocked_difficulty,
      least(10, v_game.difficulty + 1)
    )
    WHERE classroom_id = v_classroom_id AND student_id = v_student_id;
  END IF;

  RETURN jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'game_id', v_game.id,
    'server_winner', v_server_winner,
    'server_result', v_server_result,
    'progress', public.tikatuka_progress_payload(v_classroom_id, v_student_id)
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. RLS / ACL: no direct authenticated table access
-- -----------------------------------------------------------------------------
ALTER TABLE public.tikatuka_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tikatuka_games ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tikatuka_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tikatuka_games FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.tikatuka_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_guard_game_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_validate_final_boards(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_row_score(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_board_raw_pips(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tikatuka_progress_payload(integer, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.student_get_tikatuka_progress() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_create_tikatuka_game(integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.student_submit_tikatuka_result(
  uuid, integer, text, integer,
  integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, jsonb
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.student_get_tikatuka_progress() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_create_tikatuka_game(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.student_submit_tikatuka_result(
  uuid, integer, text, integer,
  integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, integer,
  integer, integer, integer, jsonb
) TO authenticated, service_role;

COMMIT;

-- =============================================================================
-- SQL Editor-safe structural postcheck (read only)
-- =============================================================================
SELECT c.relname AS relation_name, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('tikatuka_progress', 'tikatuka_games')
ORDER BY c.relname;

SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prosecdef AS security_definer,
       p.proconfig AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'student_get_tikatuka_progress',
    'student_create_tikatuka_game',
    'student_submit_tikatuka_result'
  )
ORDER BY p.proname;