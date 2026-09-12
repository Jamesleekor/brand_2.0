import { TIKATUKA_ROW_IDS } from '../config';
import type { BoardState, DieValue, RowId, RowState } from '../types';

export function calculateRowScore(row: RowState): number {
  const counts = new Map<DieValue, number>();
  for (const die of row.dice) counts.set(die.value, (counts.get(die.value) ?? 0) + 1);

  let total = 0;
  for (const [value, count] of counts) {
    if (count === 1) total += value;
    else if (count === 2) total += value * 3;
    else if (count === 3) total += value * 5;
    else throw new Error('타카투카 Row에는 같은 눈이 3개를 초과할 수 없습니다.');
  }
  return total;
}

export function calculateBoardScores(board: BoardState): Record<RowId, number> {
  return {
    top: calculateRowScore(board.rows.top),
    middle: calculateRowScore(board.rows.middle),
    bottom: calculateRowScore(board.rows.bottom),
  };
}

export function calculateBoardScore(board: BoardState): number {
  const scores = calculateBoardScores(board);
  return TIKATUKA_ROW_IDS.reduce((total, row) => total + scores[row], 0);
}

export function calculateRawPipSum(board: BoardState): number {
  return TIKATUKA_ROW_IDS.reduce(
    (total, row) => total + board.rows[row].dice.reduce((rowTotal, die) => rowTotal + die.value, 0),
    0,
  );
}
