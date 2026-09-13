export type Side = 'player' | 'ai';
export type RowId = 'top' | 'middle' | 'bottom';
export type Difficulty = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type DieValue = 1 | 2 | 3 | 4 | 5 | 6;
export type DieKind = 'normal' | 'shield';

export interface Die {
  id: string;
  value: DieValue;
  kind: DieKind;
  /** Creation/ownership attribution only. Scoring follows the board where the die is placed. */
  owner: Side;
}

export interface RowState {
  dice: Die[];
}

export interface BoardState {
  rows: Record<RowId, RowState>;
}

export interface SkillState {
  tazzaRemaining: number;
  holdRemaining: number;
}

export interface SideState {
  board: BoardState;
  skills: SkillState;
  pendingShieldValue: DieValue | null;
  heldDie: Die | null;
}

export interface SideRuntimeStats {
  knockCount: number;
  diceRemoved: number;
  shieldsEarned: number;
  tazzaUsed: number;
  holdUsed: number;
}

export type TurnDieSource = 'rolled' | 'shield' | 'held';

export interface TurnState {
  currentDie: Die | null;
  source: TurnDieSource | null;
  tazzaUsedThisTurn: boolean;
  forcedPass: boolean;
}

export type GamePhase =
  | 'idle'
  | 'turn_start'
  | 'dice_ready'
  | 'awaiting_action'
  | 'resolving_place'
  | 'turn_end'
  | 'game_over';

export type GameWinner = 'player' | 'ai' | 'draw' | null;

/**
 * A target selected with the current die.
 * - normal die + own board: place the die
 * - normal die + opponent board: perform an explicit knock attack; the die is consumed and not placed
 * - shield die: place on either board
 */
export interface Placement {
  targetSide: Side;
  row: RowId;
}

export interface GameResult {
  gameId: string;
  winner: Exclude<GameWinner, null>;
  difficulty: Difficulty;
  playerRowWins: number;
  aiRowWins: number;
  tiedRows: number;
  playerScore: number;
  aiScore: number;
  playerRawPips: number;
  aiRawPips: number;
  playerKnockCount: number;
  aiKnockCount: number;
  playerDiceRemoved: number;
  aiDiceRemoved: number;
  playerShieldsEarned: number;
  aiShieldsEarned: number;
  playerTazzaUsed: number;
  aiTazzaUsed: number;
  playerHoldUsed: number;
  aiHoldUsed: number;
  totalTurns: number;
}

export interface GameState {
  version: 1;
  gameId: string;
  difficulty: Difficulty;
  phase: GamePhase;
  currentSide: Side;
  sides: Record<Side, SideState>;
  stats: Record<Side, SideRuntimeStats>;
  turn: TurnState;
  turnNumber: number;
  winner: GameWinner;
  result: GameResult | null;
}

export type GameAction =
  | { type: 'START_GAME'; difficulty: Difficulty }
  | { type: 'START_TURN' }
  | { type: 'USE_TAZZA' }
  | { type: 'HOLD' }
  | { type: 'PLACE_DIE'; targetSide: Side; row: RowId }
  | { type: 'FORCED_PASS' }
  | { type: 'END_TURN' };

export type ActionValidationError =
  | 'NOT_CURRENT_SIDE'
  | 'INVALID_PHASE'
  | 'NO_CURRENT_DIE'
  | 'TAZZA_NOT_AVAILABLE'
  | 'TAZZA_ALREADY_USED'
  | 'TAZZA_FORBIDDEN_FOR_SHIELD'
  | 'HOLD_NOT_AVAILABLE'
  | 'ILLEGAL_PLACEMENT'
  | 'ROW_FULL'
  | 'NORMAL_DIE_CANNOT_TARGET_OPPONENT'
  | 'GAME_ALREADY_OVER';

export interface ActionValidationResult {
  ok: boolean;
  reason?: ActionValidationError;
}

export type GameEvent =
  | { type: 'DIE_ROLLED'; side: Side; die: Die }
  | { type: 'TAZZA_USED'; side: Side; previous: Die; next: Die }
  | { type: 'DIE_HELD'; side: Side; die: Die }
  | { type: 'FORCED_PASS'; side: Side; die: Die }
  | { type: 'DIE_PLACED'; side: Side; die: Die; placement: Placement }
  | { type: 'DICE_KNOCKED'; attackingSide: Side; targetSide: Side; row: RowId; attackingDie?: Die; removedDice: Die[] }
  | { type: 'SHIELD_QUEUED'; side: Side; value: DieValue }
  | { type: 'SHIELD_GRANTED'; side: Side; die: Die }
  | { type: 'TURN_CHANGED'; side: Side }
  | { type: 'GAME_FINISHED'; result: GameResult };

export interface RandomSource {
  nextInt(minInclusive: number, maxInclusive: number): number;
  nextFloat?(): number;
}

export interface EngineDependencies {
  /** Actual game outcomes only: normal rolls and Tazza rerolls. */
  gameRng: RandomSource;
  /** AI candidate/tie/mistake selection only. Never consume gameRng for AI choice. */
  aiRng: RandomSource;
  createId: () => string;
}

export interface EngineTransition {
  nextState: GameState;
  events: GameEvent[];
}
