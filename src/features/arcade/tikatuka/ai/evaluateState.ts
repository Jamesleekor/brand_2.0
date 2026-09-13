import { TIKATUKA_ROW_IDS } from '../engine/config';
import type { BoardState, DieValue, GameState, Side } from '../engine/types';
import { countBoardDice, isRowFull } from '../engine/rules/board';
import { calculateBoardScore, calculateBoardScores } from '../engine/rules/score';
import type { AIProfile } from './types';

interface ComboSummary {
  doubles: number;
  triples: number;
  openPotential: number;
  duplicateRisk: number;
}

function summarizeCombos(board: BoardState): ComboSummary {
  let doubles = 0;
  let triples = 0;
  let openPotential = 0;
  let duplicateRisk = 0;

  for (const rowId of TIKATUKA_ROW_IDS) {
    const row = board.rows[rowId];
    const allCounts = new Map<DieValue, number>();
    const normalCounts = new Map<DieValue, number>();

    for (const die of row.dice) {
      allCounts.set(die.value, (allCounts.get(die.value) ?? 0) + 1);
      if (die.kind === 'normal') normalCounts.set(die.value, (normalCounts.get(die.value) ?? 0) + 1);
    }

    for (const count of allCounts.values()) {
      if (count === 2) doubles += 1;
      else if (count === 3) triples += 1;
      if (!isRowFull(board, rowId)) {
        if (count === 2) openPotential += 2;
        else if (count === 1) openPotential += 0.5;
      }
    }

    for (const count of normalCounts.values()) {
      if (count >= 2) duplicateRisk += count - 1;
    }
  }

  return { doubles, triples, openPotential, duplicateRisk };
}

function shieldStrategicValue(state: GameState, profile: AIProfile): number {
  if (!profile.evaluateShieldBlock) return 0;
  let value = 0;
  const ownWeight = profile.weights.shieldOwnedPlacement;
  const blockWeight = profile.weights.opponentSlotBlock;

  const visit = (boardSide: Side) => {
    for (const rowId of TIKATUKA_ROW_IDS) {
      for (const die of state.sides[boardSide].board.rows[rowId].dice) {
        if (die.kind !== 'shield') continue;
        if (die.owner === 'ai') value += boardSide === 'ai' ? ownWeight : blockWeight;
        else value -= boardSide === 'player' ? ownWeight : blockWeight;
      }
    }
  };

  visit('ai');
  visit('player');

  const aiPending = state.sides.ai.pendingShieldValue;
  const playerPending = state.sides.player.pendingShieldValue;
  if (aiPending !== null) value += ownWeight * (1 + aiPending / 6);
  if (playerPending !== null) value -= ownWeight * (1 + playerPending / 6);
  return value;
}

function terminalScore(state: GameState, profile: AIProfile): number | null {
  if (state.phase !== 'game_over' || state.winner === null) return null;
  if (state.winner === 'ai') return profile.weights.terminalWin;
  if (state.winner === 'player') return profile.weights.terminalLoss;
  return profile.weights.terminalDraw;
}

/**
 * Lv.9+ stops treating every extra point in an already-won row as equally useful.
 * The middle value after sorting is the strategically important "second row":
 * taking two of three rows wins the match. Raw score still matters, but only as a
 * secondary tie-break at the top levels.
 */
function highLevelTwoRowValue(
  state: GameState,
  aiScores: ReturnType<typeof calculateBoardScores>,
  playerScores: ReturnType<typeof calculateBoardScores>,
): number {
  const margins = TIKATUKA_ROW_IDS
    .map((rowId) => Math.tanh((aiScores[rowId] - playerScores[rowId]) / 8))
    .sort((a, b) => b - a);
  const occupied = countBoardDice(state.sides.ai.board) + countBoardDice(state.sides.player.board);
  const maturity = occupied >= 14 ? 1 : occupied >= 10 ? 0.8 : occupied >= 6 ? 0.55 : 0.3;
  return (margins[0] * 4 + margins[1] * 22 + margins[2]) * maturity;
}

/** Immediate board evaluation from the AI side's perspective. Higher is better for AI. */
export function evaluateStateForAI(state: GameState, profile: AIProfile): number {
  const terminal = terminalScore(state, profile);
  if (terminal !== null) return terminal;

  const aiBoard = state.sides.ai.board;
  const playerBoard = state.sides.player.board;
  const aiScores = calculateBoardScores(aiBoard);
  const playerScores = calculateBoardScores(playerBoard);
  const highLevelStrategy = profile.difficulty >= 9;
  const rawBoardScale = highLevelStrategy ? 0.2 : 1;

  let score = (calculateBoardScore(aiBoard) - calculateBoardScore(playerBoard))
    * profile.weights.boardScore
    * rawBoardScale;

  let rowLeadDifference = 0;
  for (const rowId of TIKATUKA_ROW_IDS) {
    if (aiScores[rowId] > playerScores[rowId]) rowLeadDifference += 1;
    else if (playerScores[rowId] > aiScores[rowId]) rowLeadDifference -= 1;

    if (isRowFull(aiBoard, rowId) && isRowFull(playerBoard, rowId)) {
      if (aiScores[rowId] > playerScores[rowId]) score += profile.weights.securedRow;
      else if (playerScores[rowId] > aiScores[rowId]) score -= profile.weights.securedRow;
    }
  }
  score += rowLeadDifference * profile.weights.rowLead;
  if (highLevelStrategy) score += highLevelTwoRowValue(state, aiScores, playerScores);

  const aiCombo = summarizeCombos(aiBoard);
  const playerCombo = summarizeCombos(playerBoard);
  if (profile.evaluateCombo) {
    score += (aiCombo.doubles - playerCombo.doubles) * profile.weights.double;
    score += (aiCombo.triples - playerCombo.triples) * profile.weights.triple;
    score += (aiCombo.openPotential - playerCombo.openPotential) * profile.weights.openComboPotential;
  }
  if (profile.evaluateVulnerability) {
    score += (aiCombo.duplicateRisk - playerCombo.duplicateRisk) * profile.weights.exposedDuplicateRisk;
  }

  score += shieldStrategicValue(state, profile);

  // Remaining skills have small option value so search does not burn scarce charges for negligible gain.
  score += (state.sides.ai.skills.tazzaRemaining - state.sides.player.skills.tazzaRemaining) * profile.weights.tazzaReserve;
  score += (state.sides.ai.skills.holdRemaining - state.sides.player.skills.holdRemaining) * profile.weights.holdReserve;

  if (profile.evaluateEndgame) {
    const occupied = countBoardDice(aiBoard) + countBoardDice(playerBoard);
    if (occupied >= 14) score += rowLeadDifference * profile.weights.securedRow;
  }

  return score;
}
