import { getInitialSkillState, TIKATUKA_ENGINE_VERSION } from './config';
import type { Difficulty, GameState, Side } from './types';
import { createEmptyBoard, createEmptyRuntimeStats } from './rules/board';

function createSideState(side: Side, difficulty: Difficulty) {
  return {
    board: createEmptyBoard(),
    skills: getInitialSkillState(side, difficulty),
    pendingShieldValue: null,
    heldDie: null,
  };
}

export function createInitialTikatukaState(gameId: string, difficulty: Difficulty): GameState {
  if (!gameId.trim()) throw new Error('타카투카 gameId가 필요합니다.');

  return {
    version: TIKATUKA_ENGINE_VERSION,
    gameId,
    difficulty,
    phase: 'idle',
    currentSide: 'player',
    sides: {
      player: createSideState('player', difficulty),
      ai: createSideState('ai', difficulty),
    },
    stats: {
      player: createEmptyRuntimeStats(),
      ai: createEmptyRuntimeStats(),
    },
    turn: {
      currentDie: null,
      source: null,
      tazzaUsedThisTurn: false,
      forcedPass: false,
    },
    turnNumber: 0,
    winner: null,
    result: null,
  };
}
