import {
  TIKATUKA_MAX_DICE_PER_BOARD,
  TIKATUKA_MAX_DICE_PER_ROW,
  TIKATUKA_ROW_IDS,
  isTikatukaDifficulty,
} from './config';
import type { Die, GameState, Side } from './types';
import { countBoardDice, isBoardFull } from './rules/board';
import { isDieValue } from './rules/dice';

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`타카투카 상태 불변식 위반: ${label}은 0 이상의 정수여야 합니다.`);
  }
}

function assertDie(die: Die, label: string, seenIds: Set<string>): void {
  if (!die.id || !die.id.trim()) {
    throw new Error(`타카투카 상태 불변식 위반: ${label} 주사위 id가 비어 있습니다.`);
  }
  if (seenIds.has(die.id)) {
    throw new Error(`타카투카 상태 불변식 위반: 주사위 id ${die.id}가 중복되었습니다.`);
  }
  seenIds.add(die.id);

  if (!isDieValue(die.value)) {
    throw new Error(`타카투카 상태 불변식 위반: ${label} 주사위 눈이 1~6 범위를 벗어났습니다.`);
  }
  if (die.kind !== 'normal' && die.kind !== 'shield') {
    throw new Error(`타카투카 상태 불변식 위반: ${label} 주사위 종류가 유효하지 않습니다.`);
  }
  if (die.owner !== 'player' && die.owner !== 'ai') {
    throw new Error(`타카투카 상태 불변식 위반: ${label} 주사위 owner가 유효하지 않습니다.`);
  }
}

function assertSideState(state: GameState, side: Side, seenIds: Set<string>): void {
  const sideState = state.sides[side];
  if (!sideState) throw new Error(`타카투카 상태 불변식 위반: ${side} 상태가 없습니다.`);

  assertNonNegativeInteger(sideState.skills.tazzaRemaining, `${side}.tazzaRemaining`);
  assertNonNegativeInteger(sideState.skills.holdRemaining, `${side}.holdRemaining`);

  if (sideState.pendingShieldValue !== null && !isDieValue(sideState.pendingShieldValue)) {
    throw new Error(`타카투카 상태 불변식 위반: ${side}.pendingShieldValue가 유효하지 않습니다.`);
  }

  if (sideState.heldDie !== null) {
    assertDie(sideState.heldDie, `${side}.heldDie`, seenIds);
    if (sideState.heldDie.owner !== side) {
      throw new Error(`타카투카 상태 불변식 위반: ${side}.heldDie의 owner가 해당 Side와 다릅니다.`);
    }
    if (sideState.pendingShieldValue !== null) {
      throw new Error(`타카투카 상태 불변식 위반: ${side}에 heldDie와 pendingShield가 동시에 존재합니다.`);
    }
  }

  for (const row of TIKATUKA_ROW_IDS) {
    const dice = sideState.board.rows[row]?.dice;
    if (!Array.isArray(dice)) {
      throw new Error(`타카투카 상태 불변식 위반: ${side}.${row} Row가 유효하지 않습니다.`);
    }
    if (dice.length > TIKATUKA_MAX_DICE_PER_ROW) {
      throw new Error(`타카투카 상태 불변식 위반: ${side}.${row} Row가 3칸을 초과했습니다.`);
    }

    for (const die of dice) {
      assertDie(die, `${side}.${row}`, seenIds);
      if (die.kind === 'normal' && die.owner !== side) {
        throw new Error(`타카투카 상태 불변식 위반: normal 주사위가 owner와 다른 Board에 있습니다.`);
      }
    }
  }

  const boardDiceCount = countBoardDice(sideState.board);
  if (boardDiceCount > TIKATUKA_MAX_DICE_PER_BOARD) {
    throw new Error(`타카투카 상태 불변식 위반: ${side} Board가 9칸을 초과했습니다.`);
  }

  const stats = state.stats[side];
  assertNonNegativeInteger(stats.knockCount, `${side}.knockCount`);
  assertNonNegativeInteger(stats.diceRemoved, `${side}.diceRemoved`);
  assertNonNegativeInteger(stats.shieldsEarned, `${side}.shieldsEarned`);
  assertNonNegativeInteger(stats.tazzaUsed, `${side}.tazzaUsed`);
  assertNonNegativeInteger(stats.holdUsed, `${side}.holdUsed`);
}

export function assertGameStateInvariant(state: GameState): void {
  if (state.version !== 1) throw new Error('타카투카 상태 불변식 위반: 지원하지 않는 엔진 버전입니다.');
  if (!state.gameId?.trim()) throw new Error('타카투카 상태 불변식 위반: gameId가 비어 있습니다.');
  if (!isTikatukaDifficulty(state.difficulty)) {
    throw new Error('타카투카 상태 불변식 위반: difficulty가 1~10 범위를 벗어났습니다.');
  }
  if (state.currentSide !== 'player' && state.currentSide !== 'ai') {
    throw new Error('타카투카 상태 불변식 위반: currentSide가 유효하지 않습니다.');
  }
  assertNonNegativeInteger(state.turnNumber, 'turnNumber');

  const seenIds = new Set<string>();
  assertSideState(state, 'player', seenIds);
  assertSideState(state, 'ai', seenIds);

  const currentDie = state.turn.currentDie;
  if (currentDie !== null) {
    assertDie(currentDie, 'turn.currentDie', seenIds);
    if (currentDie.owner !== state.currentSide) {
      throw new Error('타카투카 상태 불변식 위반: currentDie owner가 currentSide와 다릅니다.');
    }
  }

  if (state.phase === 'idle' || state.phase === 'turn_start' || state.phase === 'turn_end' || state.phase === 'game_over') {
    if (currentDie !== null) {
      throw new Error(`타카투카 상태 불변식 위반: ${state.phase} 단계에는 currentDie가 없어야 합니다.`);
    }
  }
  if (state.phase === 'dice_ready' || state.phase === 'awaiting_action' || state.phase === 'resolving_place') {
    if (currentDie === null) {
      throw new Error(`타카투카 상태 불변식 위반: ${state.phase} 단계에는 currentDie가 필요합니다.`);
    }
  }

  const bothBoardsFull = isBoardFull(state.sides.player.board) && isBoardFull(state.sides.ai.board);
  if (state.phase === 'game_over') {
    if (!bothBoardsFull) throw new Error('타카투카 상태 불변식 위반: 양쪽 Board가 9/9가 아닌데 game_over입니다.');
    if (state.winner === null || state.result === null) {
      throw new Error('타카투카 상태 불변식 위반: game_over에는 winner와 result가 필요합니다.');
    }
    if (state.winner !== state.result.winner) {
      throw new Error('타카투카 상태 불변식 위반: winner와 result.winner가 다릅니다.');
    }
  } else if (state.winner !== null || state.result !== null) {
    throw new Error('타카투카 상태 불변식 위반: game_over 이전에는 winner/result가 없어야 합니다.');
  }
}
