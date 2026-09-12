import type { Die, EngineDependencies, GameEvent, Side, SideState, TurnDieSource } from '../types';
import { createShieldDie, rollNormalDie } from './dice';

export interface PreparedTurnDie {
  die: Die;
  source: TurnDieSource;
  nextSideState: SideState;
  events: GameEvent[];
}

export function prepareTurnDieForSide(
  sideState: SideState,
  side: Side,
  deps: EngineDependencies,
): PreparedTurnDie {
  if (sideState.heldDie !== null) {
    return {
      die: sideState.heldDie,
      source: 'held',
      nextSideState: {
        ...sideState,
        heldDie: null,
      },
      events: [],
    };
  }

  if (sideState.pendingShieldValue !== null) {
    const die = createShieldDie(sideState.pendingShieldValue, side, deps);
    return {
      die,
      source: 'shield',
      nextSideState: {
        ...sideState,
        pendingShieldValue: null,
      },
      events: [{ type: 'SHIELD_GRANTED', side, die }],
    };
  }

  const die = rollNormalDie(side, deps);
  return {
    die,
    source: 'rolled',
    nextSideState: sideState,
    events: [{ type: 'DIE_ROLLED', side, die }],
  };
}
