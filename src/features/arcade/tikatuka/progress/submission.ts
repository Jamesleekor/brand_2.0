import type {
  StudentSubmitTikatukaResultInput,
  TikatukaFinalRow,
  TikatukaProgress,
} from '@/lib/zod_schemas/tikatuka_schemas';
import type { Difficulty, GameState, RowState } from '../engine';

function serializeFinalRow(row: RowState): TikatukaFinalRow {
  if (row.dice.length !== 3) {
    throw new Error('완료된 타카투카 Row는 정확히 3개의 주사위를 가져야 합니다.');
  }

  const serialized = row.dice.map((die) => ({ value: die.value, kind: die.kind }));
  return [serialized[0], serialized[1], serialized[2]];
}

export function createTikatukaSubmissionInput(state: GameState): StudentSubmitTikatukaResultInput {
  if (state.phase !== 'game_over' || state.result === null) {
    throw new Error('종료되지 않은 타카투카 게임은 서버에 제출할 수 없습니다.');
  }

  const result = state.result;
  if (result.gameId !== state.gameId) {
    throw new Error('타카투카 결과 gameId가 현재 게임과 일치하지 않습니다.');
  }

  return {
    p_game_id: state.gameId,
    p_engine_version: state.version,
    p_winner: result.winner,
    p_difficulty: result.difficulty,
    p_player_row_wins: result.playerRowWins,
    p_ai_row_wins: result.aiRowWins,
    p_tied_rows: result.tiedRows,
    p_player_score: result.playerScore,
    p_ai_score: result.aiScore,
    p_player_raw_pips: result.playerRawPips,
    p_ai_raw_pips: result.aiRawPips,
    p_player_knock_count: result.playerKnockCount,
    p_ai_knock_count: result.aiKnockCount,
    p_player_dice_removed: result.playerDiceRemoved,
    p_ai_dice_removed: result.aiDiceRemoved,
    p_player_shields_earned: result.playerShieldsEarned,
    p_ai_shields_earned: result.aiShieldsEarned,
    p_player_tazza_used: result.playerTazzaUsed,
    p_ai_tazza_used: result.aiTazzaUsed,
    p_player_hold_used: result.playerHoldUsed,
    p_ai_hold_used: result.aiHoldUsed,
    p_total_turns: result.totalTurns,
    p_final_boards: {
      player: {
        top: serializeFinalRow(state.sides.player.board.rows.top),
        middle: serializeFinalRow(state.sides.player.board.rows.middle),
        bottom: serializeFinalRow(state.sides.player.board.rows.bottom),
      },
      ai: {
        top: serializeFinalRow(state.sides.ai.board.rows.top),
        middle: serializeFinalRow(state.sides.ai.board.rows.middle),
        bottom: serializeFinalRow(state.sides.ai.board.rows.bottom),
      },
    },
  };
}

export function isTikatukaDifficultyUnlocked(progress: TikatukaProgress, difficulty: Difficulty): boolean {
  return difficulty <= progress.highest_unlocked_difficulty;
}

export function isTikatukaDifficultyCleared(progress: TikatukaProgress, difficulty: Difficulty): boolean {
  return progress.cleared_difficulties.includes(difficulty);
}

export function getTikatukaDefaultDifficulty(progress: TikatukaProgress): Difficulty {
  return progress.highest_unlocked_difficulty;
}
