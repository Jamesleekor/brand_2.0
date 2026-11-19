// =====================================================================
// B.R.A.N.D 2.0 — 출석·일일퀘스트 기록 창 조회 래퍼 (명세 v1.3)
// RPC: student_get_my_attendance_quest_calendar(p_month date)
// 읽기 전용. 날짜를 누를 때마다 부르지 않고, 월 단위로만 부른다.
// =====================================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const QUEST_CODES = ['ATTENDANCE', 'PRIMARY_JOB', 'LEARNING_MATERIALS', 'CLEANING'] as const;
export type QuestCode = (typeof QUEST_CODES)[number];

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const checkValue = z.enum(['PASS', 'FAIL', 'UNCHECKED']).nullable();

export const dayStateSchema = z.enum(['CLEAR', 'PARTIAL', 'PENDING', 'FUTURE', 'CLOSED', 'CHECK_NEEDED']);
export type DayState = z.infer<typeof dayStateSchema>;

const daySchema = z.object({
  date: ymd,
  in_month: z.boolean(),
  attendance_status: z.string().nullable(),
  attendance_recognized: z.boolean().nullable(),
  attendance_source: z.string().nullable(),
  day_state: dayStateSchema,
  source: z.enum(['DAILY_QUEST_CHECKS', 'LEGACY_TEACHER_RECORD', 'NONE']),
  confidence: z.enum(['VERIFIED', 'UNCONFIRMED', 'CONFLICT']).nullable(),
  report_status: z.string().nullable(),
  pass_count: z.number().int().nullable(),
  expected_count: z.number().int(),
  checks: z.object({
    ATTENDANCE: checkValue,
    PRIMARY_JOB: checkValue,
    LEARNING_MATERIALS: checkValue,
    CLEANING: checkValue,
  }),
  failure_codes: z.array(z.enum(QUEST_CODES)),
  reason_codes: z.array(z.string()),
  closure_kind: z.string().nullable(),
  closure_label: z.string().nullable(),
});

export const weekRecordStatusSchema = z.enum([
  'HAS_FAIL',
  'ALL_FIVE_CLEAR',
  'CHECK_NEEDED',
  'CLOSED_DAY_IN_WEEK',
  'UNCONFIRMED',
  'IN_PROGRESS',
  'GOAL_NOT_MET',
]);
export type WeekRecordStatus = z.infer<typeof weekRecordStatusSchema>;

const weekSchema = z.object({
  week_start: ymd,
  week_end: ymd,
  settled_days: z.number().int(),
  complete_days: z.number().int(),
  failed_days: z.number().int(),
  unconfirmed_days: z.number().int(),
  future_days: z.number().int(),
  closed_days: z.number().int(),
  check_needed_days: z.number().int(),
  pass_total: z.number().int(),
  expected_total: z.number().int(),
  record_status: weekRecordStatusSchema,
  warning_codes: z.array(z.string()),
});

const achievementSchema = z.union([
  z.object({ visible: z.literal(false) }),
  z.object({
    visible: z.literal(true),
    uid: z.string(),
    name: z.string(),
    condition_text: z.string(),
    active_ownership: z.boolean(),
    achieved_at: z.string().nullable(),
    assessment_scope: z.literal('record_summary_only'),
  }),
]);

export const attendanceQuestCalendarSchema = z.object({
  schema_version: z.literal(1),
  kst_today: ymd,
  fetched_at: z.string(),
  month: ymd,
  range_start: ymd,
  range_end: ymd,
  coverage: z.object({
    earliest_available_date: ymd,
    latest_available_date: ymd,
    earliest_month: ymd,
    latest_selectable_month: ymd,
    detail_ledger_cutover: ymd,
  }),
  days: z.array(daySchema),
  weeks: z.array(weekSchema),
  achievement: achievementSchema,
});

export type AttendanceQuestCalendar = z.infer<typeof attendanceQuestCalendarSchema>;
export type AttendanceQuestDay = z.infer<typeof daySchema>;
export type AttendanceQuestWeek = z.infer<typeof weekSchema>;
export type AttendanceQuestAchievement = z.infer<typeof achievementSchema>;

/** 주간 분포 불변식(명세 12.2). 어긋나면 화면에서 임의로 맞추지 않고 오류로 처리한다. */
export function isWeekConsistent(week: AttendanceQuestWeek): boolean {
  const sum = week.settled_days + week.unconfirmed_days + week.future_days + week.closed_days + week.check_needed_days;
  return sum === 5 && week.complete_days + week.failed_days === week.settled_days;
}

export async function getMyAttendanceQuestCalendar(
  client: SupabaseClient,
  month: string | null,
): Promise<AttendanceQuestCalendar> {
  const { data, error } = await client.rpc('student_get_my_attendance_quest_calendar', { p_month: month });
  if (error) {
    if (error.code === 'P0337' || error.code === 'P0338') {
      throw new Error('학생 계정으로 로그인해야 기록을 볼 수 있어요.');
    }
    throw new Error('출석·일일퀘스트 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  const parsed = attendanceQuestCalendarSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error('출석·일일퀘스트 기록 형식을 확인하지 못했어요. 운영국에 알려 주세요.');
  }
  if (!parsed.data.weeks.every(isWeekConsistent)) {
    throw new Error('주간 기록 합계가 맞지 않아요. 운영국에 알려 주세요.');
  }
  return parsed.data;
}
