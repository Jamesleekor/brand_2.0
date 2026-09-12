import type {
  ActionValidationError,
  ActionValidationResult,
  GameAction,
  GameState,
  Side,
} from './types';
import { getLegalPlacements, isLegalPlacement, shouldForcePass } from './rules/placement';
import { isRowFull } from './rules/board';

function ok(): ActionValidationResult {
  return { ok: true };
}

function fail(reason: ActionValidationError): ActionValidationResult {
  return { ok: false, reason };
}

function requiresCurrentActor(action: GameAction): boolean {
  return action.type !== 'START_GAME';
}

export function validateAction(
  state: GameState,
  action: GameAction,
  actor: Side = state.currentSide,
): ActionValidationResult {
  if (state.phase === 'game_over') return fail('GAME_ALREADY_OVER');

  if (requiresCurrentActor(action) && actor !== state.currentSide) {
    return fail('NOT_CURRENT_SIDE');
  }

  switch (action.type) {
    case 'START_GAME': {
      if (state.phase !== 'idle' || action.difficulty !== state.difficulty) return fail('INVALID_PHASE');
      return ok();
    }

    case 'START_TURN': {
      if (state.phase !== 'turn_start') return fail('INVALID_PHASE');
      return ok();
    }

    case 'USE_TAZZA': {
      if (state.phase !== 'awaiting_action') return fail('INVALID_PHASE');
      const die = state.turn.currentDie;
      if (die === null) return fail('NO_CURRENT_DIE');
      if (die.kind === 'shield') return fail('TAZZA_FORBIDDEN_FOR_SHIELD');
      if (state.turn.tazzaUsedThisTurn) return fail('TAZZA_ALREADY_USED');
      if (state.sides[actor].skills.tazzaRemaining <= 0) return fail('TAZZA_NOT_AVAILABLE');
      return ok();
    }

    case 'HOLD': {
      if (state.phase !== 'awaiting_action') return fail('INVALID_PHASE');
      if (state.turn.currentDie === null) return fail('NO_CURRENT_DIE');
      if (state.sides[actor].skills.holdRemaining <= 0) return fail('HOLD_NOT_AVAILABLE');
      return ok();
    }

    case 'PLACE_DIE': {
      if (state.phase !== 'awaiting_action') return fail('INVALID_PHASE');
      const die = state.turn.currentDie;
      if (die === null) return fail('NO_CURRENT_DIE');

      if (isRowFull(state.sides[action.targetSide].board, action.row)) return fail('ROW_FULL');
      if (die.kind === 'normal' && action.targetSide !== actor) {
        return fail('NORMAL_DIE_CANNOT_TARGET_OPPONENT');
      }
      if (!isLegalPlacement(state, actor, die, { targetSide: action.targetSide, row: action.row })) {
        return fail('ILLEGAL_PLACEMENT');
      }
      return ok();
    }

    case 'FORCED_PASS': {
      if (state.phase !== 'awaiting_action') return fail('INVALID_PHASE');
      const die = state.turn.currentDie;
      if (die === null) return fail('NO_CURRENT_DIE');
      if (!shouldForcePass(state, actor, die)) return fail('ILLEGAL_PLACEMENT');
      return ok();
    }

    case 'END_TURN': {
      if (state.phase !== 'turn_end') return fail('INVALID_PHASE');
      return ok();
    }

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

export function hasAnyLegalPlacement(state: GameState, actor: Side = state.currentSide): boolean {
  const die = state.turn.currentDie;
  return die !== null && getLegalPlacements(state, actor, die).length > 0;
}
