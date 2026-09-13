import { z } from 'zod';
import { TikatukaDifficultySchema } from './tikatuka_schemas';

export const TikatukaGeneralRankingRowSchema = z.object({
  rank: z.number().int().positive(),
  student_id: z.number().int().positive(),
  student_name: z.string().min(1),
  brand_name: z.string().nullable(),
  cleared_level: z.number().int().min(0).max(10),
}).strict();
export type TikatukaGeneralRankingRow = z.infer<typeof TikatukaGeneralRankingRowSchema>;

export const TikatukaOfficialRankingRowSchema = z.object({
  rank: z.number().int().positive(),
  student_id: z.number().int().positive(),
  student_name: z.string().min(1),
  brand_name: z.string().nullable(),
  difficulty: TikatukaDifficultySchema,
  wins: z.number().int().min(0).max(5),
  draws: z.number().int().min(0).max(5),
  losses: z.number().int().min(0).max(5),
  points: z.number().int().min(3).max(15),
  ranking_score: z.number().int().positive(),
  completed_at: z.string().datetime({ offset: true }),
}).strict();
export type TikatukaOfficialRankingRow = z.infer<typeof TikatukaOfficialRankingRowSchema>;

export const TikatukaMyGeneralRankSchema = z.object({
  rank: z.number().int().positive(),
  cleared_level: z.number().int().min(0).max(10),
}).strict();
export type TikatukaMyGeneralRank = z.infer<typeof TikatukaMyGeneralRankSchema>;

export const TikatukaMyOfficialRankSchema = z.object({
  rank: z.number().int().positive(),
  difficulty: TikatukaDifficultySchema,
  wins: z.number().int().min(0).max(5),
  draws: z.number().int().min(0).max(5),
  losses: z.number().int().min(0).max(5),
  points: z.number().int().min(3).max(15),
  ranking_score: z.number().int().positive(),
  completed_at: z.string().datetime({ offset: true }),
}).strict();
export type TikatukaMyOfficialRank = z.infer<typeof TikatukaMyOfficialRankSchema>;

export const TikatukaActiveChallengeSchema = z.object({
  session_id: z.number().int().positive(),
  difficulty: TikatukaDifficultySchema,
  games_played: z.number().int().min(0).max(4),
  remaining_games: z.number().int().min(1).max(5),
  wins: z.number().int().min(0).max(4),
  draws: z.number().int().min(0).max(4),
  losses: z.number().int().min(0).max(4),
  points: z.number().int().min(0).max(12),
  started_at: z.string().datetime({ offset: true }),
}).strict();
export type TikatukaActiveChallenge = z.infer<typeof TikatukaActiveChallengeSchema>;

export const TikatukaRecentChallengeSchema = z.object({
  session_id: z.number().int().positive(),
  difficulty: TikatukaDifficultySchema,
  wins: z.number().int().min(0).max(5),
  draws: z.number().int().min(0).max(5),
  losses: z.number().int().min(0).max(5),
  points: z.number().int().min(0).max(15),
  qualified: z.boolean(),
  ranking_score: z.number().int().positive().nullable(),
  completed_at: z.string().datetime({ offset: true }),
}).strict();
export type TikatukaRecentChallenge = z.infer<typeof TikatukaRecentChallengeSchema>;

export const TikatukaCompetitionRulesSchema = z.object({
  matches_per_challenge: z.literal(5),
  win_points: z.literal(3),
  draw_points: z.literal(1),
  loss_points: z.literal(0),
  minimum_qualifying_points: z.literal(3),
}).strict();

export const TikatukaCompetitionSchema = z.object({
  period_id: z.number().int().positive(),
  period_key: z.string().regex(/^\d{4}-\d{2}$/),
  period_display_name: z.string().min(1),
  period_kind: z.enum(['MONTHLY', 'SEASON']),
  period_status: z.enum(['ACTIVE', 'VERIFICATION', 'READY_TO_FINALIZE', 'FINALIZED']),
  period_starts_at: z.string().datetime({ offset: true }),
  period_ends_at_exclusive: z.string().datetime({ offset: true }),
  general_leaderboard: z.array(TikatukaGeneralRankingRowSchema),
  official_leaderboard: z.array(TikatukaOfficialRankingRowSchema),
  my_general: TikatukaMyGeneralRankSchema.nullable(),
  my_official: TikatukaMyOfficialRankSchema.nullable(),
  active_challenge: TikatukaActiveChallengeSchema.nullable(),
  recent_challenges: z.array(TikatukaRecentChallengeSchema),
  official_window_open: z.boolean(),
  official_window_opened_at: z.string().datetime({ offset: true }).nullable(),
  official_window_closed_at: z.string().datetime({ offset: true }).nullable(),
  official_attempt_used: z.boolean(),
  official_can_start: z.boolean(),
  rules: TikatukaCompetitionRulesSchema,
}).strict();
export type TikatukaCompetition = z.infer<typeof TikatukaCompetitionSchema>;

export const StudentGetTikatukaCompetitionSchema = z.object({
  p_period_id: z.number().int().positive(),
}).strict();
export type StudentGetTikatukaCompetitionInput = z.infer<typeof StudentGetTikatukaCompetitionSchema>;

export const StudentStartTikatukaOfficialChallengeSchema = z.object({
  p_period_id: z.number().int().positive(),
  p_difficulty: TikatukaDifficultySchema,
}).strict();
export type StudentStartTikatukaOfficialChallengeInput = z.infer<typeof StudentStartTikatukaOfficialChallengeSchema>;

export const TeacherTikatukaOfficialWindowSchema = z.object({
  period_key: z.string().regex(/^\d{4}-\d{2}$/),
  period_id: z.number().int().positive().nullable(),
  period_display_name: z.string().min(1).nullable(),
  is_open: z.boolean(),
  opened_at: z.string().datetime({ offset: true }).nullable(),
  closed_at: z.string().datetime({ offset: true }).nullable(),
  started_count: z.number().int().nonnegative(),
  completed_count: z.number().int().nonnegative(),
}).strict();
export type TeacherTikatukaOfficialWindow = z.infer<typeof TeacherTikatukaOfficialWindowSchema>;

export const TeacherSetTikatukaOfficialWindowSchema = z.object({
  p_is_open: z.boolean(),
}).strict();
export type TeacherSetTikatukaOfficialWindowInput = z.infer<typeof TeacherSetTikatukaOfficialWindowSchema>;
