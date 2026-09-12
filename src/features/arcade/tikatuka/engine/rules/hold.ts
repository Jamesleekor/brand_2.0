import type { GameState, Side } from '../types';

export function canHold(state: GameState, side: Side): boolean {
  return state.currentSide === side
    && state.turn.currentDie !== null
    && state.sides[side].skills.holdRemaining > 0;
}
