import { TIKATUKA_ROW_IDS } from '../config';
import type { Die, GameState, Placement, RowId, Side } from '../types';
import { isRowFull, otherSide } from './board';

export function getLegalKnockRows(state: GameState, actor: Side, die: Die): RowId[] {
  if (die.kind !== 'normal') return [];
  const targetSide = otherSide(actor);
  return TIKATUKA_ROW_IDS.filter((row) => state.sides[targetSide].board.rows[row].dice.some(
    (candidate) => candidate.kind === 'normal' && candidate.value === die.value,
  ));
}

export function isKnockPlacement(actor: Side, die: Die, placement: Placement): boolean {
  return die.kind === 'normal' && placement.targetSide === otherSide(actor);
}

export function getLegalPlacements(state: GameState, actor: Side, die: Die): Placement[] {
  const placements: Placement[] = [];

  if (die.kind === 'normal') {
    const ownBoard = state.sides[actor].board;
    for (const row of TIKATUKA_ROW_IDS) {
      if (!isRowFull(ownBoard, row)) placements.push({ targetSide: actor, row });
    }

    const opponent = otherSide(actor);
    for (const row of getLegalKnockRows(state, actor, die)) {
      placements.push({ targetSide: opponent, row });
    }
    return placements;
  }

  for (const targetSide of [actor, otherSide(actor)] as const) {
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
  if (!isLegalPlacement(state, actor, die, placement) || isKnockPlacement(actor, die, placement)) {
    throw new Error('합법적인 라카루카 보드 배치가 아닙니다.');
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
