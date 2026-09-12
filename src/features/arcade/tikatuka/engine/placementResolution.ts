import type { EngineTransition, GameAction, GameEvent, GameState, Side, TurnState } from './types';
import { assertGameStateInvariant } from './invariants';
import { validateAction } from './validateAction';
import { placeDie } from './rules/placement';
import { resolveKnockOff } from './rules/knock';
import { queuePendingShield } from './rules/shield';
import { createGameResult, isGameOver } from './rules/victory';

function emptyTurnState(): TurnState {
  return {
    currentDie: null,
    source: null,
    tazzaUsedThisTurn: false,
    forcedPass: false,
  };
}

function invalidPlacementError(action: Extract<GameAction, { type: 'PLACE_DIE' }>, reason: string | undefined): Error {
  return new Error(`라카루카 PLACE_DIE을 처리할 수 없습니다: ${reason ?? 'UNKNOWN'}`);
}

/**
 * Resolves only the deterministic consequences of a PLACE_DIE action.
 *
 * Important: this function never advances to the opponent turn and therefore
 * never consumes gameRng. Both the live reducer and AI simulations must reuse
 * this function so candidate evaluation cannot alter future dice rolls.
 */
export function resolvePlacementOutcome(
  state: GameState,
  action: Extract<GameAction, { type: 'PLACE_DIE' }>,
  actor: Side,
): EngineTransition {
  assertGameStateInvariant(state);
  const validation = validateAction(state, action, actor);
  if (!validation.ok) throw invalidPlacementError(action, validation.reason);

  const die = state.turn.currentDie;
  if (die === null) throw new Error('라카루카 내부 오류: PLACE 시 currentDie가 없습니다.');

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

  // Game-over is evaluated only after placement + knock + shield/stat resolution.
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

  assertGameStateInvariant(working);
  return { nextState: working, events };
}
