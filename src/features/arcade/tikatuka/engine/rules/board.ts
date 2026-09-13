import { TIKATUKA_MAX_DICE_PER_BOARD, TIKATUKA_MAX_DICE_PER_ROW, TIKATUKA_ROW_IDS } from '../config';
import type { BoardState, RowId, Side, SideRuntimeStats } from '../types';

export function otherSide(side: Side): Side {
  return side === 'player' ? 'ai' : 'player';
}

export function createEmptyBoard(): BoardState {
  return {
    rows: {
      top: { dice: [] },
      middle: { dice: [] },
      bottom: { dice: [] },
    },
  };
}

export function createEmptyRuntimeStats(): SideRuntimeStats {
  return {
    knockCount: 0,
    diceRemoved: 0,
    shieldsEarned: 0,
    tazzaUsed: 0,
    holdUsed: 0,
  };
}

export function countBoardDice(board: BoardState): number {
  return TIKATUKA_ROW_IDS.reduce((total, row) => total + board.rows[row].dice.length, 0);
}

export function isRowFull(board: BoardState, row: RowId): boolean {
  return board.rows[row].dice.length >= TIKATUKA_MAX_DICE_PER_ROW;
}

export function isBoardFull(board: BoardState): boolean {
  return countBoardDice(board) === TIKATUKA_MAX_DICE_PER_BOARD;
}
