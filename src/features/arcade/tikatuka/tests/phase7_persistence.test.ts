import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StudentSubmitTikatukaResultSchema, type TikatukaProgress } from '../../../../lib/zod_schemas/tikatuka_schemas';
import type { Die, GameState, RowState, Side } from '../engine';
import {
  createTikatukaSubmissionInput,
  getTikatukaDefaultDifficulty,
  isTikatukaDifficultyCleared,
  isTikatukaDifficultyUnlocked,
} from '../progress/submission';
import { assert, assertDeepEqual, assertEqual, assertThrows, test } from './testHarness';

const GAME_ID = '11111111-1111-4111-8111-111111111111';

function die(id: string, value: Die['value'], owner: Side, kind: Die['kind'] = 'normal'): Die {
  return { id, value, owner, kind };
}

function row(prefix: string, values: readonly [Die['value'], Die['value'], Die['value']], owner: Side): RowState {
  return {
    dice: values.map((value, index) => die(`${prefix}-${index}`, value, owner, index === 2 && prefix.includes('shield') ? 'shield' : 'normal')),
  };
}

function completedState(): GameState {
  return {
    version: 1,
    gameId: GAME_ID,
    difficulty: 3,
    phase: 'game_over',
    currentSide: 'ai',
    sides: {
      player: {
        board: {
          rows: {
            top: row('p-top', [6, 6, 6], 'player'),
            middle: row('p-shield-mid', [5, 4, 3], 'player'),
            bottom: row('p-bottom', [2, 2, 1], 'player'),
          },
        },
        skills: { tazzaRemaining: 3, holdRemaining: 1 },
        pendingShieldValue: null,
        heldDie: null,
      },
      ai: {
        board: {
          rows: {
            top: row('a-top', [5, 5, 5], 'ai'),
            middle: row('a-mid', [6, 2, 1], 'ai'),
            bottom: row('a-bottom', [4, 3, 2], 'ai'),
          },
        },
        skills: { tazzaRemaining: 0, holdRemaining: 0 },
        pendingShieldValue: null,
        heldDie: null,
      },
    },
    stats: {
      player: { knockCount: 1, diceRemoved: 2, shieldsEarned: 1, tazzaUsed: 1, holdUsed: 1 },
      ai: { knockCount: 0, diceRemoved: 0, shieldsEarned: 0, tazzaUsed: 0, holdUsed: 0 },
    },
    turn: { currentDie: null, source: null, tazzaUsedThisTurn: false, forcedPass: false },
    turnNumber: 22,
    winner: 'player',
    result: {
      gameId: GAME_ID,
      winner: 'player',
      difficulty: 3,
      playerRowWins: 2,
      aiRowWins: 1,
      tiedRows: 0,
      playerScore: 44,
      aiScore: 39,
      playerRawPips: 35,
      aiRawPips: 33,
      playerKnockCount: 1,
      aiKnockCount: 0,
      playerDiceRemoved: 2,
      aiDiceRemoved: 0,
      playerShieldsEarned: 1,
      aiShieldsEarned: 0,
      playerTazzaUsed: 1,
      aiTazzaUsed: 0,
      playerHoldUsed: 1,
      aiHoldUsed: 0,
      totalTurns: 22,
    },
  };
}

test('phase7 progress: only highest unlocked difficulty and below are playable', () => {
  const progress: TikatukaProgress = {
    highest_unlocked_difficulty: 4,
    cleared_difficulties: [1, 2, 3],
    games_played: 6,
    wins: 3,
    losses: 2,
    draws: 1,
    last_played_at: null,
  };

  assertEqual(isTikatukaDifficultyUnlocked(progress, 1), true);
  assertEqual(isTikatukaDifficultyUnlocked(progress, 4), true);
  assertEqual(isTikatukaDifficultyUnlocked(progress, 5), false);
  assertEqual(isTikatukaDifficultyCleared(progress, 3), true);
  assertEqual(isTikatukaDifficultyCleared(progress, 4), false);
  assertEqual(getTikatukaDefaultDifficulty(progress), 4);
});

test('phase7 submission: completed engine state serializes exact result and strips die ids/owner', () => {
  const state = completedState();
  const input = createTikatukaSubmissionInput(state);

  assertEqual(input.p_game_id, GAME_ID);
  assertEqual(input.p_engine_version, 1);
  assertEqual(input.p_total_turns, 22);
  assertDeepEqual(input.p_final_boards.player.top[0], { value: 6, kind: 'normal' });
  assertDeepEqual(input.p_final_boards.player.middle[2], { value: 3, kind: 'shield' });
  assert(!('id' in input.p_final_boards.player.top[0]), 'final board payload must not expose die id');
  assert(!('owner' in input.p_final_boards.player.top[0]), 'final board payload must not expose provenance owner');
  assert(StudentSubmitTikatukaResultSchema.safeParse(input).success, 'serialized result must satisfy RPC schema');
});

test('phase7 submission: unfinished games and incomplete final rows are rejected before RPC', () => {
  const unfinished = completedState();
  unfinished.phase = 'awaiting_action';
  assertThrows(() => createTikatukaSubmissionInput(unfinished), '종료되지 않은');

  const incomplete = completedState();
  incomplete.sides.player.board.rows.top.dice.pop();
  assertThrows(() => createTikatukaSubmissionInput(incomplete), '정확히 3개');
});

test('phase7 schema: row summary mismatch is rejected on the client boundary', () => {
  const input = createTikatukaSubmissionInput(completedState());
  const invalid = { ...input, p_tied_rows: 2 };
  assertEqual(StudentSubmitTikatukaResultSchema.safeParse(invalid).success, false);
});

test('phase7 migration contract: persistence is RPC-only, idempotent, and server-recomputes final board outcome', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260912_01_tikatuka_progress_results.sql'),
    'utf8',
  );

  assert(sql.includes('REVOKE ALL ON TABLE public.tikatuka_progress FROM PUBLIC, anon, authenticated;'));
  assert(sql.includes('REVOKE ALL ON TABLE public.tikatuka_games FROM PUBLIC, anon, authenticated;'));
  assert(sql.includes('public.current_student_id()'));
  assert(sql.includes('public.current_classroom_id()'));
  assert(sql.includes('student_create_tikatuka_game(p_difficulty integer)'));
  assert(sql.includes("IF v_game.status = 'COMPLETED' THEN"), 'submission must be idempotent');
  assert(sql.includes('client_submission IS DISTINCT FROM v_submission'), 'conflicting duplicate payload must be rejected');
  assert(sql.includes('tikatuka_validate_final_boards'));
  assert(sql.includes('tikatuka_row_score'));
  assert(sql.includes('tikatuka_board_raw_pips'));
  assert(sql.includes('submitted result does not match server-recomputed final board result'));
  assert(sql.includes("IF v_server_winner = 'player' THEN"), 'only a verified player win may advance progress');
  assert(!sql.includes('arcade_monthly_snapshot_entries'), 'Phase 7 must not silently connect Tikatuka to Arcade ranking rewards');
});
