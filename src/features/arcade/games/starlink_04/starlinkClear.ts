import { analyzeStarlinkBoard, refillStarlinkBoard, reshuffleStarlinkDeadBoard } from './starlinkBoard';
import type { StarlinkGameplayRules } from './starlinkRules';
import { STARLINK_V03_RULES } from './starlinkRules';
import type { StarlinkBoard } from './starlinkTypes';

export interface StarlinkBoardResolution {
  board: StarlinkBoard;
  refillRngState: number;
  reshuffleRngState: number;
  reshuffled: boolean;
  reshuffleAttempts: number;
  reshufflePauseMs: number;
}

export function resolveStarlinkClearBoard(
  board: StarlinkBoard,
  removedCells: readonly number[],
  refillRngState: number,
  reshuffleRngState: number,
  rules: StarlinkGameplayRules = STARLINK_V03_RULES,
): StarlinkBoardResolution {
  const refill = refillStarlinkBoard(board, removedCells, refillRngState, rules);

  if (refill.metrics.playable) {
    return {
      board: refill.board,
      refillRngState: refill.rngState,
      reshuffleRngState,
      reshuffled: false,
      reshuffleAttempts: 0,
      reshufflePauseMs: 0,
    };
  }

  const reshuffle = reshuffleStarlinkDeadBoard(refill.board, reshuffleRngState, rules);
  const finalMetrics = analyzeStarlinkBoard(reshuffle.board, rules);
  if (!finalMetrics.playable) {
    throw new Error('Starlink board resolution ended on a dead board.');
  }

  return {
    board: reshuffle.board,
    refillRngState: refill.rngState,
    reshuffleRngState: reshuffle.rngState,
    reshuffled: true,
    reshuffleAttempts: reshuffle.attempts,
    reshufflePauseMs: rules.reshufflePauseMs,
  };
}
