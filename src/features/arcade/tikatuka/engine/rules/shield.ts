import type { DieValue, GameState, Side } from '../types';

export function queuePendingShield(state: GameState, side: Side, value: DieValue): GameState {
  if (state.sides[side].pendingShieldValue !== null) {
    throw new Error('이미 예약된 실드가 있는 상태에서 새 pending Shield를 덮어쓸 수 없습니다.');
  }

  return {
    ...state,
    sides: {
      ...state.sides,
      [side]: {
        ...state.sides[side],
        pendingShieldValue: value,
      },
    },
  };
}

export function getPendingShieldValue(state: GameState, side: Side): DieValue | null {
  return state.sides[side].pendingShieldValue;
}
