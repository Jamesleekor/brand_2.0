import type { Difficulty, GameAction, GameState, Placement } from '../engine';
import type { AISearchAbortReason } from './searchContext';

export type AISearchDepth = 0 | 1 | 2;
export type AIPlacementAction = Extract<GameAction, { type: 'PLACE_DIE' }>;
export type AIAdvancedAction = Extract<GameAction, { type: 'PLACE_DIE' | 'USE_TAZZA' | 'HOLD' }>;

export interface AIWeights {
  boardScore: number;
  rowLead: number;
  securedRow: number;
  double: number;
  triple: number;
  openComboPotential: number;
  shieldOwnedPlacement: number;
  opponentSlotBlock: number;
  exposedDuplicateRisk: number;
  tazzaReserve: number;
  holdReserve: number;
  terminalWin: number;
  terminalLoss: number;
  terminalDraw: number;
}

export interface AIProfile {
  difficulty: Difficulty;
  searchDepth: AISearchDepth;
  mistakeRate: number;
  candidatePoolSize: number;
  maxMistakeScoreGap: number;
  evaluateCombo: boolean;
  evaluateShieldBlock: boolean;
  evaluateVulnerability: boolean;
  evaluateEndgame: boolean;
  weights: AIWeights;
}

export interface AIPlacementCandidate {
  action: AIPlacementAction;
  placement: Placement;
  score: number;
  resultingState: GameState;
}

export interface AIBasicChoice {
  action: AIPlacementAction;
  score: number;
  usedMistake: boolean;
  rankedCandidates: readonly AIPlacementCandidate[];
}

export interface AIAdvancedActionCandidate {
  action: AIAdvancedAction;
  score: number;
}

export interface AIAdvancedChoice {
  action: AIAdvancedAction;
  score: number;
  usedMistake: boolean;
  rankedCandidates: readonly AIAdvancedActionCandidate[];
  searchDepth: AISearchDepth;
  nodesVisited: number;
  searchAbortReason: AISearchAbortReason | null;
}
