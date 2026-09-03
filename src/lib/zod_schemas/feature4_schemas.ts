// =====================================================================
// B.R.A.N.D 2.0 — Feature 4 isolated schemas
// F4A communication / F4B operations / F4C learning / F4D records
// =====================================================================
import { z } from 'zod';

const PositiveInt = z.number().int().positive();
const DateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식이어야 합니다');

const AttendanceRewardValue = z.object({
  gold: z.number().int().min(0).max(1_000_000),
  bv: z.number().int().min(0).max(1_000_000),
  crystal: z.number().int().min(0).max(1_000_000),
});
const AttendanceRewardSettings = z.object({
  '3': AttendanceRewardValue,
  '7': AttendanceRewardValue,
  '14': AttendanceRewardValue,
  '28': AttendanceRewardValue,
});

export const F4A = {
  markMailRead: z.object({ p_message_id: PositiveInt }),
  markAlertRead: z.object({ p_alert_id: PositiveInt }),
  markAllAlertsRead: z.object({ p_classroom_id: PositiveInt }),
  sendMail: z.object({
    p_classroom_id: PositiveInt,
    p_recipient_ids: z.array(PositiveInt).min(1, '수신자를 선택해주세요').max(100),
    p_title: z.string().trim().min(1).max(200),
    p_body: z.string().trim().min(1).max(5000),
    p_message_type: z.enum(['INFO','ACHIEVEMENT','ACHIEVEMENT_REJECT','REWARD','WARNING','PENALTY','DEPOSIT_MATURITY','LOAN_REMINDER','AUCTION_RESULT','TEACHER_MESSAGE','JOB_APPROVAL','COSMETIC_GIFT','P2P_NOTE','OTHER']).default('TEACHER_MESSAGE'),
  }),
  broadcastAlert: z.object({
    p_classroom_id: PositiveInt,
    p_message: z.string().trim().min(1).max(1000),
    p_emoji: z.string().max(10).default('📢'),
    p_expires_in_hours: z.number().int().min(1).max(168).default(48),
  }),
};

export const F4B = {
  activateEmergency: z.object({
    p_classroom_id: PositiveInt,
    p_emergency_type: z.enum(['HYPERINFLATION','EMPLOYMENT_FREEZE','ASSET_FREEZE']),
    p_reason: z.string().trim().max(5000),
    p_scheduled_end_at: z.string().datetime({ offset: true }).optional(),
    p_auto_termination: z.record(z.unknown()).optional(),
    p_teacher_user_id: z.string().uuid().optional(),
  }),
  finalizeExpiredEmergencies: z.object({ p_classroom_id: PositiveInt }),
  terminateEmergency: z.object({
    p_emergency_id: PositiveInt,
    p_is_auto: z.boolean().default(false),
    p_teacher_user_id: z.string().uuid().optional(),
  }),
  createQuest: z.object({
    p_classroom_id: PositiveInt,
    p_title: z.string().trim().min(1).max(120),
    p_description: z.string().trim().min(1).max(2000),
    p_reward_gold: z.number().int().min(0).max(10000),
    p_reward_bv: z.number().int().min(0).max(10000),
    p_duration_minutes: z.number().int().min(1).max(1440),
  }).refine(v => v.p_reward_gold > 0 || v.p_reward_bv > 0, { message: '보상은 GOLD 또는 BV 중 하나 이상이어야 합니다' }),
  closeQuest: z.object({ p_quest_id: PositiveInt }),
  requestQuestCompletion: z.object({ p_student_id: PositiveInt, p_quest_id: PositiveInt }),
  reviewQuestRequest: z.object({ p_request_id: PositiveInt, p_approve: z.boolean(), p_note: z.string().trim().max(500).optional() }),
  appointGuard: z.object({
    p_classroom_id: PositiveInt,
    p_student_id: PositiveInt,
    p_role_type: z.enum(['CHIEF','MEMBER']),
    p_start_date: DateYmd,
    p_end_date: DateYmd,
    p_note: z.string().trim().max(500).optional(),
  }),
  endGuard: z.object({ p_term_id: PositiveInt, p_end_date: DateYmd.optional() }),
};

export const F4C = {
  getAttendanceRewardSettings: z.object({ p_classroom_id: PositiveInt }),
  updateAttendanceRewardSettings: z.object({ p_classroom_id: PositiveInt, p_rewards: AttendanceRewardSettings }),
  attendanceBulk: z.object({
    p_classroom_id: PositiveInt,
    p_attendance_date: DateYmd,
    p_entries: z.array(z.object({
      student_id: PositiveInt,
      status: z.enum(['PRESENT','LATE','ABSENT','EXCUSED']),
    })).min(1).max(100),
  }),
  correctAttendance: z.object({
    p_attendance_id: PositiveInt,
    p_new_status: z.enum(['PRESENT','LATE','ABSENT','EXCUSED']),
    p_reason: z.string().trim().min(2).max(200),
  }),
  createAssignment: z.object({
    p_classroom_id: PositiveInt,
    p_title: z.string().trim().min(1).max(200),
    p_description: z.string().trim().max(5000),
    p_subject: z.string().trim().max(50),
    p_due_at: z.string().datetime({ offset: true }),
    p_max_score: z.number().int().min(1).max(1000),
    p_base_reward_gold: z.number().int().min(0).max(10000),
    p_full_score_reward_bv: z.number().int().min(0).max(10000),
    p_publish_now: z.boolean(),
  }),
  setAssignmentStatus: z.object({ p_assignment_id: PositiveInt, p_status: z.enum(['DRAFT','PUBLISHED','CLOSED','ARCHIVED']) }),
  submitAssignment: z.object({
    p_student_id: PositiveInt,
    p_assignment_id: PositiveInt,
    p_content_text: z.string().trim().max(5000).optional(),
    p_attachment_urls: z.array(z.string().url()).max(5).optional(),
  }).refine(v => Boolean(v.p_content_text?.trim()) || Boolean(v.p_attachment_urls?.length), { message: '제출 내용이나 첨부 링크 중 하나는 필요합니다' }),
  gradeAssignment: z.object({
    p_submission_id: PositiveInt,
    p_score: z.number().int().min(0).max(1000),
    p_feedback: z.string().trim().max(5000).optional(),
    p_teacher_user_id: z.string().uuid().optional(),
  }),
};

export const F4D = {
  refreshRecords: z.object({ p_classroom_id: PositiveInt, p_stat_date: DateYmd.optional() }),
  addHallEntry: z.object({
    p_classroom_id: PositiveInt,
    p_category: z.string().trim().min(1).max(40),
    p_period_label: z.string().trim().max(60),
    p_title: z.string().trim().min(1).max(160),
    p_subtitle: z.string().trim().max(1000).optional(),
    p_student_id: PositiveInt.nullable().optional(),
    p_rank_position: z.number().int().positive().nullable().optional(),
  }),
  archiveHallEntry: z.object({ p_entry_id: PositiveInt }),
  healthCheck: z.object({}),
};

export type F4AAttachment = never;
