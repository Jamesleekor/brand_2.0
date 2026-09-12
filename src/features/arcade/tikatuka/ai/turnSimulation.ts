import { canHold } from '../engine/rules/hold';
import { getLegalPlacements } from '../engine/rules/placement';
import { otherSide } from '../engine/rules/board';
import type { Die, DieValue, GameState, Side, TurnDieSource } from '../engine/types';

export interface WeightedSearchState {
  state: GameState;
  probability: number;
}

function emptyTurn() {
  return {
    currentDie: null,
    source: null,
    tazzaUsedThisTurn: false,
    forcedPass: false,
  } as const;
}

function syntheticDie(state: GameState, side: Side, kind: 'normal' | 'shield', value: DieValue): Die {
  return {
    id: `sim-${state.turnNumber + 1}-${side}-${kind}-${value}`,
    value,
    kind,
    owner: side,
  };
}

export function createHypotheticalHoldState(state: GameState, side: Side): GameState {
  if (!canHold(state, side) || state.turn.currentDie === null) {
    throw new Error('타카투카 AI search에서 HOLD를 시뮬레이션할 수 없는 상태입니다.');
  }
  if (state.sides[side].heldDie !== null) {
    throw new Error('타카투카 AI search HOLD 대상 Side에 이미 heldDie가 있습니다.');
  }

  const die = state.turn.currentDie;
  return {
    ...state,
    phase: 'turn_end',
    sides: {
      ...state.sides,
      [side]: {
        ...state.sides[side],
        heldDie: die,
        skills: {
          ...state.sides[side].skills,
          holdRemaining: state.sides[side].skills.holdRemaining - 1,
        },
      },
    },
    stats: {
      ...state.stats,
      [side]: {
        ...state.stats[side],
        holdUsed: state.stats[side].holdUsed + 1,
      },
    },
    turn: emptyTurn(),
  };
}

function actionableState(
  state: GameState,
  side: Side,
  die: Die,
  source: TurnDieSource,
  nextSideState: GameState['sides'][Side],
): GameState {
  return {
    ...state,
    phase: 'awaiting_action',
    currentSide: side,
    sides: {
      ...state.sides,
      [side]: nextSideState,
    },
    turn: {
      currentDie: die,
      source,
      tazzaUsedThisTurn: false,
      forcedPass: false,
    },
    turnNumber: state.turnNumber + 1,
  };
}

/**
 * Enumerates the next side's turn-start die without consuming gameRng.
 * heldDie and pending shield are deterministic; a fresh normal roll branches 1..6 uniformly.
 */
export function enumerateNextTurnStates(state: GameState): WeightedSearchState[] {
  if (state.phase !== 'turn_end' || state.turn.currentDie !== null) {
    throw new Error('다음 턴 search 분기는 turn_end/currentDie=null 상태에서만 만들 수 있습니다.');
  }

  const side = otherSide(state.currentSide);
  const sideState = state.sides[side];

  if (sideState.heldDie !== null) {
    const die = sideState.heldDie;
    return [{
      probability: 1,
      state: actionableState(state, side, die, 'held', { ...sideState, heldDie: null }),
    }];
  }

  if (sideState.pendingShieldValue !== null) {
    const value = sideState.pendingShieldValue;
    const die = syntheticDie(state, side, 'shield', value);
    return [{
      probability: 1,
      state: actionableState(state, side, die, 'shield', { ...sideState, pendingShieldValue: null }),
    }];
  }

  const values: readonly DieValue[] = [1, 2, 3, 4, 5, 6];
  return values.map((value) => ({
    probability: 1 / 6,
    state: actionableState(state, side, syntheticDie(state, side, 'normal', value), 'rolled', sideState),
  }));
}

/** Forced Pass is a turn transition, not a HOLD action: no HOLD charge/stat is consumed. */
export function createHypotheticalForcedPassState(state: GameState): GameState {
  const side = state.currentSide;
  const die = state.turn.currentDie;
  if (state.phase !== 'awaiting_action' || die === null || getLegalPlacements(state, side, die).length !== 0) {
    throw new Error('타카투카 AI search에서 Forced Pass를 적용할 수 없는 상태입니다.');
  }
  if (state.sides[side].heldDie !== null) {
    throw new Error('타카투카 AI search Forced Pass 대상 Side에 이미 heldDie가 있습니다.');
  }

  return {
    ...state,
    phase: 'turn_end',
    sides: {
      ...state.sides,
      [side]: {
        ...state.sides[side],
        heldDie: die,
      },
    },
    turn: {
      currentDie: null,
      source: null,
      tazzaUsedThisTurn: false,
      forcedPass: true,
    },
  };
}
