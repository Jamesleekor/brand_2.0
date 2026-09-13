import { TIKATUKA_ROW_IDS } from '../config';
import type { GameResult, GameState, GameWinner } from '../types';
import { isBoardFull } from './board';
import { calculateBoardScore, calculateBoardScores, calculateRawPipSum } from './score';

export interface VictorySummary {
  winner: Exclude<GameWinner, null>;
  playerRowWins: number;
  aiRowWins: number;
  tiedRows: number;
  playerScore: number;
  aiScore: number;
  playerRawPips: number;
  aiRawPips: number;
}

export function isGameOver(state: GameState): boolean {
  return isBoardFull(state.sides.player.board) && isBoardFull(state.sides.ai.board);
}

export function determineWinner(state: GameState): VictorySummary {
  const playerScores = calculateBoardScores(state.sides.player.board);
  const aiScores = calculateBoardScores(state.sides.ai.board);

  let playerRowWins = 0;
  let aiRowWins = 0;
  let tiedRows = 0;

  for (const row of TIKATUKA_ROW_IDS) {
    if (playerScores[row] > aiScores[row]) playerRowWins += 1;
    else if (aiScores[row] > playerScores[row]) aiRowWins += 1;
    else tiedRows += 1;
  }

  const playerRawPips = calculateRawPipSum(state.sides.player.board);
  const aiRawPips = calculateRawPipSum(state.sides.ai.board);

  let winner: Exclude<GameWinner, null>;
  if (playerRowWins > aiRowWins) winner = 'player';
  else if (aiRowWins > playerRowWins) winner = 'ai';
  else if (playerRawPips > aiRawPips) winner = 'player';
  else if (aiRawPips > playerRawPips) winner = 'ai';
  else winner = 'draw';

  return {
    winner,
    playerRowWins,
    aiRowWins,
    tiedRows,
    playerScore: calculateBoardScore(state.sides.player.board),
    aiScore: calculateBoardScore(state.sides.ai.board),
    playerRawPips,
    aiRawPips,
  };
}

export function createGameResult(state: GameState): GameResult {
  if (!isGameOver(state)) throw new Error('양쪽 Board가 모두 9칸이 되기 전에는 게임 결과를 확정할 수 없습니다.');

  const summary = determineWinner(state);
  return {
    gameId: state.gameId,
    winner: summary.winner,
    difficulty: state.difficulty,
    playerRowWins: summary.playerRowWins,
    aiRowWins: summary.aiRowWins,
    tiedRows: summary.tiedRows,
    playerScore: summary.playerScore,
    aiScore: summary.aiScore,
    playerRawPips: summary.playerRawPips,
    aiRawPips: summary.aiRawPips,
    playerKnockCount: state.stats.player.knockCount,
    aiKnockCount: state.stats.ai.knockCount,
    playerDiceRemoved: state.stats.player.diceRemoved,
    aiDiceRemoved: state.stats.ai.diceRemoved,
    playerShieldsEarned: state.stats.player.shieldsEarned,
    aiShieldsEarned: state.stats.ai.shieldsEarned,
    playerTazzaUsed: state.stats.player.tazzaUsed,
    aiTazzaUsed: state.stats.ai.tazzaUsed,
    playerHoldUsed: state.stats.player.holdUsed,
    aiHoldUsed: state.stats.ai.holdUsed,
    totalTurns: state.turnNumber,
  };
}
