import type {
  EngineDependencies,
  EngineTransition,
  GameAction,
  GameEvent,
  GameState,
  Side,
  TurnState,
} from './types';
import { assertGameStateInvariant } from './invariants';
import { validateAction } from './validateAction';
import { otherSide } from './rules/board';
import { canUseTazza, rollTazzaReplacement } from './rules/tazza';
import { canHold } from './rules/hold';
import { placeDie, shouldForcePass } from './rules/placement';
import { resolveKnockOff } from './rules/knock';
import { queuePendingShield } from './rules/shield';
import { prepareTurnDieForSide } from './rules/turn';
import { createGameResult, isGameOver } from './rules/victory';

const MAX_AUTOMATIC_TURN_TRANSITIONS = 4;

function emptyTurnState(): TurnState {
  return {
    currentDie: null,
    source: null,
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
}

function invalidActionError(action: GameAction, reason: string | undefined): Error {
  return new Error(`타카투카 액션 ${action.type}을 처리할 수 없습니다: ${reason ?? 'UNKNOWN'}`);
}

function prepareCurrentTurn(state: GameState, deps: EngineDependencies): EngineTransition {
  if (state.phase !== 'turn_start') {
    throw new Error('타카투카 내부 오류: turn_start 단계가 아닌 상태에서 턴을 준비했습니다.');
  }

  let working = state;
  const events: GameEvent[] = [];

  for (let passGuard = 0; passGuard < MAX_AUTOMATIC_TURN_TRANSITIONS; passGuard += 1) {
    const side = working.currentSide;
    const prepared = prepareTurnDieForSide(working.sides[side], side, deps);

    working = {
      ...working,
      phase: 'awaiting_action',
      sides: {
        ...working.sides,
        [side]: prepared.nextSideState,
      },
      turn: {
        currentDie: prepared.die,
        source: prepared.source,
        tazzaUsedThisTurn: false,
        forcedPass: false,
      },
      turnNumber: working.turnNumber + 1,
    };
    events.push(...prepared.events);

    if (!shouldForcePass(working, side, prepared.die)) {
      assertGameStateInvariant(working);
      return { nextState: working, events };
    }

    // Forced Pass is not HOLD: preserve the exact die without consuming HOLD charges or stats.
    working = {
      ...working,
      phase: 'turn_end',
      sides: {
        ...working.sides,
        [side]: {
          ...working.sides[side],
          heldDie: prepared.die,
        },
      },
      turn: {
        currentDie: null,
        source: null,
        tazzaUsedThisTurn: false,
        forcedPass: true,
      },
    };
    events.push({ type: 'FORCED_PASS', side, die: prepared.die });

    const nextSide = otherSide(side);
    working = {
      ...working,
      phase: 'turn_start',
      currentSide: nextSide,
      turn: emptyTurnState(),
    };
    events.push({ type: 'TURN_CHANGED', side: nextSide });
  }

  throw new Error('타카투카 내부 오류: 자동 Forced Pass 전환이 안전 상한을 초과했습니다.');
}

function advanceToNextTurn(
  state: GameState,
  deps: EngineDependencies,
  priorEvents: GameEvent[] = [],
): EngineTransition {
  if (state.turn.currentDie !== null) {
    throw new Error('타카투카 내부 오류: currentDie가 남아 있는 상태에서 턴을 넘길 수 없습니다.');
  }

  const nextSide = otherSide(state.currentSide);
  const turnStartState: GameState = {
    ...state,
    phase: 'turn_start',
    currentSide: nextSide,
    turn: emptyTurnState(),
  };
  const prepared = prepareCurrentTurn(turnStartState, deps);

  return {
    nextState: prepared.nextState,
    events: [...priorEvents, { type: 'TURN_CHANGED', side: nextSide }, ...prepared.events],
  };
}

function resolveTazza(state: GameState, actor: Side, deps: EngineDependencies): EngineTransition {
  if (!canUseTazza(state, actor) || state.turn.currentDie === null) {
    throw new Error('타카투카 내부 오류: 검증을 통과하지 않은 타짜 액션입니다.');
  }

  const previous = state.turn.currentDie;
  const next = rollTazzaReplacement(previous, actor, deps);
  const actorState = state.sides[actor];

  const nextState: GameState = {
    ...state,
    sides: {
      ...state.sides,
      [actor]: {
        ...actorState,
        skills: {
          ...actorState.skills,
          tazzaRemaining: actorState.skills.tazzaRemaining - 1,
        },
      },
    },
    stats: {
      ...state.stats,
      [actor]: {
        ...state.stats[actor],
        tazzaUsed: state.stats[actor].tazzaUsed + 1,
      },
    },
    turn: {
      ...state.turn,
      currentDie: next,
      source: 'rolled',
      tazzaUsedThisTurn: true,
    },
  };

  assertGameStateInvariant(nextState);
  return {
    nextState,
    events: [{ type: 'TAZZA_USED', side: actor, previous, next }],
  };
}

function resolveHold(state: GameState, actor: Side, deps: EngineDependencies): EngineTransition {
  if (!canHold(state, actor) || state.turn.currentDie === null) {
    throw new Error('타카투카 내부 오류: 검증을 통과하지 않은 HOLD 액션입니다.');
  }

  const die = state.turn.currentDie;
  const actorState = state.sides[actor];
  if (actorState.heldDie !== null) {
    throw new Error('타카투카 내부 오류: HOLD 저장 공간에 이미 주사위가 있습니다.');
  }

  const turnEndState: GameState = {
    ...state,
    phase: 'turn_end',
    sides: {
      ...state.sides,
      [actor]: {
        ...actorState,
        heldDie: die,
        skills: {
          ...actorState.skills,
          holdRemaining: actorState.skills.holdRemaining - 1,
        },
      },
    },
    stats: {
      ...state.stats,
      [actor]: {
        ...state.stats[actor],
        holdUsed: state.stats[actor].holdUsed + 1,
      },
    },
    turn: emptyTurnState(),
  };

  return advanceToNextTurn(turnEndState, deps, [{ type: 'DIE_HELD', side: actor, die }]);
}

function resolveForcedPass(state: GameState, actor: Side, deps: EngineDependencies): EngineTransition {
  const die = state.turn.currentDie;
  if (die === null || !shouldForcePass(state, actor, die)) {
    throw new Error('타카투카 내부 오류: 검증을 통과하지 않은 Forced Pass 액션입니다.');
  }

  const actorState = state.sides[actor];
  if (actorState.heldDie !== null) {
    throw new Error('타카투카 내부 오류: Forced Pass 저장 공간에 이미 주사위가 있습니다.');
  }

  const turnEndState: GameState = {
    ...state,
    phase: 'turn_end',
    sides: {
      ...state.sides,
      [actor]: {
        ...actorState,
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

  return advanceToNextTurn(turnEndState, deps, [{ type: 'FORCED_PASS', side: actor, die }]);
}

function resolvePlacementUnchecked(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' }>,
  actor: Side,
  deps: EngineDependencies,
): EngineTransition {
  const die = state.turn.currentDie;
  if (die === null) throw new Error('타카투카 내부 오류: PLACE 시 currentDie가 없습니다.');

  const placement = { targetSide: action.targetSide, row: action.row } as const;
  let working: GameState = { ...state, phase: 'resolving_place' };
  const events: GameEvent[] = [];

  working = placeDie(working, actor, die, placement);
  events.push({ type: 'DIE_PLACED', side: actor, die, placement });

  const knock = resolveKnockOff(working, actor, placement, die);
  working = knock.nextState;

  if (knock.result.triggered) {
    events.push({
      type: 'DICE_KNOCKED',
      attackingSide: actor,
      targetSide: knock.result.targetSide,
      row: knock.result.row,
      removedDice: knock.result.removedDice,
    });

    working = queuePendingShield(working, actor, die.value);
    working = {
      ...working,
      stats: {
        ...working.stats,
        [actor]: {
          ...working.stats[actor],
          knockCount: working.stats[actor].knockCount + 1,
          diceRemoved: working.stats[actor].diceRemoved + knock.result.removedDice.length,
          shieldsEarned: working.stats[actor].shieldsEarned + 1,
        },
      },
    };
    events.push({ type: 'SHIELD_QUEUED', side: actor, value: die.value });
  }

  working = {
    ...working,
    phase: 'turn_end',
    turn: emptyTurnState(),
  };

  // Game-over is checked only after placement + knock + pending-shield/stat resolution.
  if (isGameOver(working)) {
    const result = createGameResult(working);
    const gameOverState: GameState = {
      ...working,
      phase: 'game_over',
      winner: result.winner,
      result,
    };
    events.push({ type: 'GAME_FINISHED', result });
    assertGameStateInvariant(gameOverState);
    return { nextState: gameOverState, events };
  }

  return advanceToNextTurn(working, deps, events);
}

export function resolvePlacementTransaction(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' }>,
  actor: Side,
  deps: EngineDependencies,
): EngineTransition {
  assertGameStateInvariant(state);
  const validation = validateAction(state, action, actor);
  if (!validation.ok) throw invalidActionError(action, validation.reason);
  return resolvePlacementUnchecked(state, action, actor, deps);
}

export function dispatchTikatukaAction(
  state: GameState,
  action: GameAction,
  deps: EngineDependencies,
  actor: Side = state.currentSide,
): EngineTransition {
  assertGameStateInvariant(state);
  const validation = validateAction(state, action, actor);
  if (!validation.ok) throw invalidActionError(action, validation.reason);

  let transition: EngineTransition;

  switch (action.type) {
    case 'START_GAME': {
      const turnStartState: GameState = {
        ...state,
        phase: 'turn_start',
        currentSide: 'player',
        turn: emptyTurnState(),
      };
      transition = prepareCurrentTurn(turnStartState, deps);
      break;
    }

    case 'START_TURN':
      transition = prepareCurrentTurn(state, deps);
      break;

    case 'USE_TAZZA':
      transition = resolveTazza(state, actor, deps);
      break;

    case 'HOLD':
      transition = resolveHold(state, actor, deps);
      break;

    case 'PLACE_DIE':
      transition = resolvePlacementUnchecked(state, action, actor, deps);
      break;

    case 'FORCED_PASS':
      transition = resolveForcedPass(state, actor, deps);
      break;

    case 'END_TURN':
      transition = advanceToNextTurn(state, deps);
      break;

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }

  assertGameStateInvariant(transition.nextState);
  return transition;
}
