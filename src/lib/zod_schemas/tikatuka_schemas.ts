import { z } from 'zod';

export const TikatukaDifficultySchema = z.number().int().min(1).max(10);
export const TikatukaWinnerSchema = z.enum(['player', 'ai', 'draw']);

export const TikatukaProgressSchema = z.object({
  highest_unlocked_difficulty: TikatukaDifficultySchema,
  cleared_difficulties: z.array(TikatukaDifficultySchema),
  games_played: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  losses: z.number().int().nonnegative(),
  draws: z.number().int().nonnegative(),
  last_played_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type TikatukaProgress = z.infer<typeof TikatukaProgressSchema>;

export const StudentCreateTikatukaGameSchema = z.object({
  p_difficulty: TikatukaDifficultySchema,
}).strict();
export type StudentCreateTikatukaGameInput = z.infer<typeof StudentCreateTikatukaGameSchema>;

export const TikatukaIssuedGameSchema = z.object({
  game_id: z.string().uuid(),
  engine_version: z.literal(1),
  difficulty: TikatukaDifficultySchema,
  issued_at: z.string().datetime({ offset: true }),
  progress: TikatukaProgressSchema,
}).strict();
export type TikatukaIssuedGame = z.infer<typeof TikatukaIssuedGameSchema>;

export const TikatukaFinalDieSchema = z.object({
  value: z.number().int().min(1).max(6),
  kind: z.enum(['normal', 'shield']),
}).strict();
export type TikatukaFinalDie = z.infer<typeof TikatukaFinalDieSchema>;

export const TikatukaFinalRowSchema = z.tuple([
  TikatukaFinalDieSchema,
  TikatukaFinalDieSchema,
  TikatukaFinalDieSchema,
]);
export type TikatukaFinalRow = z.infer<typeof TikatukaFinalRowSchema>;

export const TikatukaFinalBoardSchema = z.object({
  top: TikatukaFinalRowSchema,
  middle: TikatukaFinalRowSchema,
  bottom: TikatukaFinalRowSchema,
}).strict();
export type TikatukaFinalBoard = z.infer<typeof TikatukaFinalBoardSchema>;

export const TikatukaFinalBoardsSchema = z.object({
  player: TikatukaFinalBoardSchema,
  ai: TikatukaFinalBoardSchema,
}).strict();
export type TikatukaFinalBoards = z.infer<typeof TikatukaFinalBoardsSchema>;

const NonNegativeCounter = z.number().int().nonnegative();

export const StudentSubmitTikatukaResultSchema = z.object({
  p_game_id: z.string().uuid(),
  p_engine_version: z.literal(1),
  p_winner: TikatukaWinnerSchema,
  p_difficulty: TikatukaDifficultySchema,
  p_player_row_wins: z.number().int().min(0).max(3),
  p_ai_row_wins: z.number().int().min(0).max(3),
  p_tied_rows: z.number().int().min(0).max(3),
  p_player_score: z.number().int().min(0).max(90),
  p_ai_score: z.number().int().min(0).max(90),
  p_player_raw_pips: z.number().int().min(0).max(54),
  p_ai_raw_pips: z.number().int().min(0).max(54),
  p_player_knock_count: NonNegativeCounter,
  p_ai_knock_count: NonNegativeCounter,
  p_player_dice_removed: NonNegativeCounter,
  p_ai_dice_removed: NonNegativeCounter,
  p_player_shields_earned: NonNegativeCounter,
  p_ai_shields_earned: NonNegativeCounter,
  p_player_tazza_used: NonNegativeCounter,
  p_ai_tazza_used: NonNegativeCounter,
  p_player_hold_used: NonNegativeCounter,
  p_ai_hold_used: NonNegativeCounter,
  p_total_turns: z.number().int().min(18).max(5000),
  p_final_boards: TikatukaFinalBoardsSchema,
}).strict().superRefine((value, ctx) => {
  if (value.p_player_row_wins + value.p_ai_row_wins + value.p_tied_rows !== 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['p_tied_rows'],
      message: 'Row 승/패/무 합계는 3이어야 합니다.',
    });
  }
});
export type StudentSubmitTikatukaResultInput = z.infer<typeof StudentSubmitTikatukaResultSchema>;

export const TikatukaServerResultSchema = z.object({
  winner: TikatukaWinnerSchema,
  difficulty: TikatukaDifficultySchema,
  player_row_wins: z.number().int().min(0).max(3),
  ai_row_wins: z.number().int().min(0).max(3),
  tied_rows: z.number().int().min(0).max(3),
  player_score: z.number().int().min(0).max(90),
  ai_score: z.number().int().min(0).max(90),
  player_raw_pips: z.number().int().min(0).max(54),
  ai_raw_pips: z.number().int().min(0).max(54),
  player_knock_count: NonNegativeCounter,
  ai_knock_count: NonNegativeCounter,
  player_dice_removed: NonNegativeCounter,
  ai_dice_removed: NonNegativeCounter,
  player_shields_earned: NonNegativeCounter,
  ai_shields_earned: NonNegativeCounter,
  player_tazza_used: NonNegativeCounter,
  ai_tazza_used: NonNegativeCounter,
  player_hold_used: NonNegativeCounter,
  ai_hold_used: NonNegativeCounter,
  total_turns: z.number().int().min(18).max(5000),
}).strict();
export type TikatukaServerResult = z.infer<typeof TikatukaServerResultSchema>;

export const TikatukaSubmissionResponseSchema = z.object({
  accepted: z.literal(true),
  duplicate: z.boolean(),
  game_id: z.string().uuid(),
  server_winner: TikatukaWinnerSchema,
  server_result: TikatukaServerResultSchema,
  progress: TikatukaProgressSchema,
}).strict();
export type TikatukaSubmissionResponse = z.infer<typeof TikatukaSubmissionResponseSchema>;
