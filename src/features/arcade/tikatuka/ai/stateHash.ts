import { TIKATUKA_ROW_IDS } from '../engine/config';
import type { Die, GameState, Side } from '../engine/types';

function dieToken(die: Die | null): string {
  if (die === null) return '-';
  return `${die.kind[0]}${die.value}${die.owner[0]}`;
}

function boardToken(state: GameState, side: Side): string {
  return TIKATUKA_ROW_IDS.map((rowId) => {
    const dice = state.sides[side].board.rows[rowId].dice;
    return `${rowId}:${dice.map((die) => dieToken(die)).join(',')}`;
  }).join('|');
}

/**
 * Canonical rule/search hash.
 * Intentionally ignores gameId, die ids, runtime stats, animations and turnNumber
 * so semantically identical search positions share one identity.
 */
export function createAIStateHash(state: GameState): string {
  const sideToken = (side: Side) => {
    const sideState = state.sides[side];
    return [
      boardToken(state, side),
      `t${sideState.skills.tazzaRemaining}`,
      `h${sideState.skills.holdRemaining}`,
      `p${sideState.pendingShieldValue ?? '-'}`,
      `d${dieToken(sideState.heldDie)}`,
    ].join(';');
  };

  return [
    `phase:${state.phase}`,
    `current:${state.currentSide}`,
    `die:${dieToken(state.turn.currentDie)}`,
    `src:${state.turn.source ?? '-'}`,
    `tz:${state.turn.tazzaUsedThisTurn ? 1 : 0}`,
    `fp:${state.turn.forcedPass ? 1 : 0}`,
    `player{${sideToken('player')}}`,
    `ai{${sideToken('ai')}}`,
    `winner:${state.winner ?? '-'}`,
  ].join('||');
}
