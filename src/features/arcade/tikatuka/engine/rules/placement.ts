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
