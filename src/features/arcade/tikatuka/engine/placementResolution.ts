import type { EngineTransition, GameAction, GameEvent, GameState, Side, TurnState } from './types';
import { assertGameStateInvariant } from './invariants';
import { validateAction } from './validateAction';
import { isKnockPlacement, placeDie } from './rules/placement';
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

function finalizeResolvedAction(working: GameState, events: GameEvent[]): EngineTransition {
  working = {
    ...working,
    phase: 'turn_end',
    turn: emptyTurnState(),
  };

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

/**
 * Resolves the deterministic consequences of selecting a row with the current die.
 *
 * Normal die:
 * - selecting own board places the die and does NOT attack automatically.
 * - selecting an opponent row is an explicit knock action. The attacking die is
 *   consumed without occupying either board and removes matching normal dice only.
 *
 * Shield die:
 * - selecting either board places the shield normally.
 *
 * This function never advances to the opponent turn and never consumes gameRng.
 * Live play and AI simulation share this exact resolution path.
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

  if (isKnockPlacement(actor, die, placement)) {
    const knock = resolveKnockOff(working, actor, placement, die);
    if (!knock.result.triggered) {
      throw new Error('라카루카 내부 오류: 합법 알까기 대상에서 제거할 주사위를 찾지 못했습니다.');
    }
    working = knock.nextState;

    events.push({
      type: 'DICE_KNOCKED',
      attackingSide: actor,
      targetSide: knock.result.targetSide,
      row: knock.result.row,
      attackingDie: die,
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
  } else {
    working = placeDie(working, actor, die, placement);
    events.push({ type: 'DIE_PLACED', side: actor, die, placement });
  }

  return finalizeResolvedAction(working, events);
}
