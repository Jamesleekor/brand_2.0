import type { Die, DieValue, GameState, Placement, RowId, Side } from '../types';
import { otherSide } from './board';

export interface KnockResult {
  triggered: boolean;
  attackingSide: Side;
  targetSide: Side;
  row: RowId;
  value: DieValue;
  removedDice: Die[];
  shieldEarned: boolean;
}

export function resolveKnockOff(
  state: GameState,
  attacker: Side,
  placement: Placement,
  placedDie: Die,
): { nextState: GameState; result: KnockResult } {
  const targetSide = otherSide(attacker);
  const emptyResult: KnockResult = {
    triggered: false,
    attackingSide: attacker,
    targetSide,
    row: placement.row,
    value: placedDie.value,
    removedDice: [],
    shieldEarned: false,
  };

  if (placedDie.kind !== 'normal' || placement.targetSide !== attacker) {
    return { nextState: state, result: emptyResult };
  }

  const targetRow = state.sides[targetSide].board.rows[placement.row];
  const removedDice = targetRow.dice.filter(
    (die) => die.kind === 'normal' && die.value === placedDie.value,
  );

  if (removedDice.length === 0) {
    return { nextState: state, result: emptyResult };
  }

  const survivingDice = targetRow.dice.filter(
    (die) => die.kind !== 'normal' || die.value !== placedDie.value,
  );

  const nextState: GameState = {
    ...state,
    sides: {
      ...state.sides,
      [targetSide]: {
        ...state.sides[targetSide],
        board: {
          ...state.sides[targetSide].board,
          rows: {
            ...state.sides[targetSide].board.rows,
            [placement.row]: { dice: survivingDice },
          },
        },
      },
    },
  };

  return {
    nextState,
    result: {
      ...emptyResult,
      triggered: true,
      removedDice,
      shieldEarned: true,
    },
  };
}
