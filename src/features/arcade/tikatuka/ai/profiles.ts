import type { Difficulty } from '../engine';
import type { AIProfile, AIWeights } from './types';

export const BASE_AI_WEIGHTS: AIWeights = {
  boardScore: 1.0,
  rowLead: 3.0,
  securedRow: 5.0,
  double: 2.0,
  triple: 5.0,
  openComboPotential: 1.5,
  shieldOwnedPlacement: 2.0,
  opponentSlotBlock: 2.5,
  exposedDuplicateRisk: -2.0,
  tazzaReserve: 0.8,
  holdReserve: 1.2,
  terminalWin: 10_000,
  terminalLoss: -10_000,
  terminalDraw: 0,
};

interface ProfilePreset {
  searchDepth: 0 | 1 | 2;
  mistakeRate: number;
  candidatePoolSize: number;
  maxMistakeScoreGap: number;
  evaluateCombo: boolean;
  evaluateShieldBlock: boolean;
  evaluateVulnerability: boolean;
  evaluateEndgame: boolean;
}

const PROFILE_PRESETS = {
  1: { searchDepth: 0, mistakeRate: 0.55, candidatePoolSize: 4, maxMistakeScoreGap: 30, evaluateCombo: false, evaluateShieldBlock: false, evaluateVulnerability: false, evaluateEndgame: false },
  2: { searchDepth: 0, mistakeRate: 0.42, candidatePoolSize: 4, maxMistakeScoreGap: 26, evaluateCombo: false, evaluateShieldBlock: false, evaluateVulnerability: false, evaluateEndgame: false },
  3: { searchDepth: 0, mistakeRate: 0.32, candidatePoolSize: 3, maxMistakeScoreGap: 22, evaluateCombo: true, evaluateShieldBlock: false, evaluateVulnerability: false, evaluateEndgame: false },
  4: { searchDepth: 0, mistakeRate: 0.24, candidatePoolSize: 3, maxMistakeScoreGap: 18, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: false, evaluateEndgame: false },
  5: { searchDepth: 1, mistakeRate: 0.18, candidatePoolSize: 3, maxMistakeScoreGap: 14, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: false, evaluateEndgame: true },
  6: { searchDepth: 1, mistakeRate: 0.13, candidatePoolSize: 3, maxMistakeScoreGap: 12, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: true, evaluateEndgame: true },
  7: { searchDepth: 1, mistakeRate: 0.09, candidatePoolSize: 2, maxMistakeScoreGap: 10, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: true, evaluateEndgame: true },
  8: { searchDepth: 2, mistakeRate: 0.06, candidatePoolSize: 2, maxMistakeScoreGap: 8, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: true, evaluateEndgame: true },
  9: { searchDepth: 2, mistakeRate: 0.03, candidatePoolSize: 2, maxMistakeScoreGap: 5, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: true, evaluateEndgame: true },
  10: { searchDepth: 2, mistakeRate: 0.01, candidatePoolSize: 1, maxMistakeScoreGap: 0, evaluateCombo: true, evaluateShieldBlock: true, evaluateVulnerability: true, evaluateEndgame: true },
} as const satisfies Record<Difficulty, ProfilePreset>;

export function getAIProfile(difficulty: Difficulty): AIProfile {
  const preset = PROFILE_PRESETS[difficulty];
  return {
    difficulty,
    ...preset,
    weights: BASE_AI_WEIGHTS,
  };
}
