import { TIKATUKA_ROW_IDS } from '../config';
import type { Die, GameState, Placement, Side } from '../types';
import { isRowFull, otherSide } from './board';

export function getLegalPlacements(state: GameState, actor: Side, die: Die): Placement[] {
  const placements: Placement[] = [];
  const targetSides: readonly Side[] = die.kind === 'normal' ? [actor] : [actor, otherSide(actor)];

  for (const targetSide of targetSides) {
    const board = state.sides[targetSide].board;
    for (const row of TIKATUKA_ROW_IDS) {
      if (!isRowFull(board, row)) placements.push({ targetSide, row });
    }
  }

  return placements;
}

export function isLegalPlacement(state: GameState, actor: Side, die: Die, placement: Placement): boolean {
  return getLegalPlacements(state, actor, die).some(
    (candidate) => candidate.targetSide === placement.targetSide && candidate.row === placement.row,
  );
}

export function shouldForcePass(state: GameState, actor: Side, die: Die): boolean {
  return getLegalPlacements(state, actor, die).length === 0;
}

export function placeDie(state: GameState, actor: Side, die: Die, placement: Placement): GameState {
  if (!isLegalPlacement(state, actor, die, placement)) {
    throw new Error('합법적이지 않은 타카투카 배치입니다.');
  }

  const targetSideState = state.sides[placement.targetSide];
  const targetRow = targetSideState.board.rows[placement.row];

  return {
    ...state,
    sides: {
      ...state.sides,
      [placement.targetSide]: {
        ...targetSideState,
        board: {
          ...targetSideState.board,
          rows: {
            ...targetSideState.board.rows,
            [placement.row]: {
              dice: [...targetRow.dice, die],
            },
          },
        },
      },
    },
  };
}
