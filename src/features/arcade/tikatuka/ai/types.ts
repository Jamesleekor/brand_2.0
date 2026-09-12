import type { Difficulty, GameAction, GameState, Placement } from '../engine';

export type AISearchDepth = 0 | 1 | 2;
export type AIPlacementAction = Extract<GameAction, { type: 'PLACE_DIE' }>;

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
  terminalWin: number;
  terminalLoss: number;
  terminalDraw: number;
}

export interface AIProfile {
  difficulty: Difficulty;
  /** Reserved for the advanced-search phase. Phase 4 remains immediate-evaluation only. */
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
