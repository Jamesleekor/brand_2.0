import { TIKATUKA_DIE_MAX, TIKATUKA_DIE_MIN } from '../config';
import type { Die, DieValue, EngineDependencies, Side } from '../types';

export function isDieValue(value: unknown): value is DieValue {
  return Number.isInteger(value) && Number(value) >= TIKATUKA_DIE_MIN && Number(value) <= TIKATUKA_DIE_MAX;
}

export function rollNormalDie(side: Side, deps: EngineDependencies): Die {
  const value = deps.gameRng.nextInt(TIKATUKA_DIE_MIN, TIKATUKA_DIE_MAX);
  if (!isDieValue(value)) throw new Error('gameRng가 유효하지 않은 타카투카 주사위 눈을 반환했습니다.');
  return {
    id: deps.createId(),
    value,
    kind: 'normal',
    owner: side,
  };
}

export function createShieldDie(value: DieValue, owner: Side, deps: Pick<EngineDependencies, 'createId'>): Die {
  return {
    id: deps.createId(),
    value,
    kind: 'shield',
    owner,
  };
}
