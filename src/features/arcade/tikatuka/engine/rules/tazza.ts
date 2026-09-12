import type { Die, EngineDependencies, GameState, Side } from '../types';
import { rollNormalDie } from './dice';

export function canUseTazza(state: GameState, side: Side): boolean {
  const die = state.turn.currentDie;
  return state.currentSide === side
    && die !== null
    && die.kind === 'normal'
    && state.sides[side].skills.tazzaRemaining > 0
    && state.turn.tazzaUsedThisTurn === false;
}

export function rollTazzaReplacement(currentDie: Die, side: Side, deps: EngineDependencies): Die {
  if (currentDie.kind !== 'normal') {
    throw new Error('실드 주사위에는 타짜의 손놀림을 사용할 수 없습니다.');
  }
  return rollNormalDie(side, deps);
}
