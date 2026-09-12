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
  attackingDie: Die,
): { nextState: GameState; result: KnockResult } {
  const targetSide = placement.targetSide;
  const emptyResult: KnockResult = {
    triggered: false,
    attackingSide: attacker,
    targetSide,
    row: placement.row,
    value: attackingDie.value,
    removedDice: [],
    shieldEarned: false,
  };

  if (attackingDie.kind !== 'normal' || targetSide !== otherSide(attacker)) {
    return { nextState: state, result: emptyResult };
  }

  const targetRow = state.sides[targetSide].board.rows[placement.row];
  const removedDice = targetRow.dice.filter(
    (die) => die.kind === 'normal' && die.value === attackingDie.value,
  );

  if (removedDice.length === 0) {
    return { nextState: state, result: emptyResult };
  }

  const survivingDice = targetRow.dice.filter(
    (die) => die.kind !== 'normal' || die.value !== attackingDie.value,
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
