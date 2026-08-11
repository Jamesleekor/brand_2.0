// =====================================================================
// B.R.A.N.D 2.0 — Feature 4 isolated RPC layer
// Keeping this file separate is intentional: if Feature4 fails, the failing
// F4A/F4B/F4C/F4D call can be identified without touching legacy wrappers.
// =====================================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { F4A, F4B, F4C, F4D } from '@/lib/zod_schemas/feature4_schemas';
import type { RpcResult } from '@/lib/rpc/student_rpc';

const RPC_DOMAIN: Record<string, 'F4A'|'F4B'|'F4C'|'F4D'> = {
  mark_mail_read:'F4A', mark_global_alert_read:'F4A', mark_all_global_alerts_read:'F4A', teacher_send_mail:'F4A', teacher_broadcast_alert:'F4A',
  activate_emergency:'F4B', terminate_emergency:'F4B', finalize_expired_emergencies_for_classroom:'F4B', teacher_create_emergency_quest:'F4B', teacher_close_emergency_quest:'F4B', request_emergency_quest_completion:'F4B', teacher_review_emergency_quest_request:'F4B', teacher_appoint_guard:'F4B', teacher_end_guard_term:'F4B',
  teacher_record_attendance_bulk:'F4C', teacher_correct_attendance:'F4C', teacher_create_assignment:'F4C', teacher_set_assignment_status:'F4C', submit_assignment:'F4C', grade_assignment:'F4C',
  teacher_refresh_classroom_records:'F4D', teacher_add_hall_of_fame_entry:'F4D', teacher_archive_hall_of_fame_entry:'F4D', teacher_feature4_health_check:'F4D', teacher_feature4_1_health_check:'F4D', teacher_feature4_1_1_health_check:'F4D',
};

async function call<T>(supabase: SupabaseClient, name: string, schema: z.ZodTypeAny, input: unknown): Promise<RpcResult<T>> {
  const domain = RPC_DOMAIN[name] ?? 'F4D';
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const message = parsed.error.issues.map(i => i.message).join(' · ');
    console.error(`[B.R.A.N.D Feature4 ${domain}] validation failed: ${name}`, { input, issues: parsed.error.issues });
    return { success: false, type: 'VALIDATION', error: `[${domain}:${name}] ${message}`, details: parsed.error.issues };
  }
  const { data, error } = await supabase.rpc(name, parsed.data as Record<string, unknown>);
  if (error) {
    console.error(`[B.R.A.N.D Feature4 ${domain}] RPC failed: ${name}`, {
      code: error.code, message: error.message, details: error.details, hint: error.hint, input: parsed.data,
    });
    const tagged = error.message.includes(`[${domain}]`) ? error.message : `[${domain}:${name}] ${error.message}`;
    return { success: false, type: 'SERVER', error: tagged, code: error.code };
  }
  return { success: true, data: data as T };
}

export const feature4Rpc = {
  // F4A — Communication
  markMailRead: (s: SupabaseClient, i: z.input<typeof F4A.markMailRead>) => call<void>(s,'mark_mail_read',F4A.markMailRead,i),
  markAlertRead: (s: SupabaseClient, i: z.input<typeof F4A.markAlertRead>) => call<void>(s,'mark_global_alert_read',F4A.markAlertRead,i),
  markAllAlertsRead: (s: SupabaseClient, i: z.input<typeof F4A.markAllAlertsRead>) => call<number>(s,'mark_all_global_alerts_read',F4A.markAllAlertsRead,i),
  sendMail: (s: SupabaseClient, i: z.input<typeof F4A.sendMail>) => call<number>(s,'teacher_send_mail',F4A.sendMail,i),
  broadcastAlert: (s: SupabaseClient, i: z.input<typeof F4A.broadcastAlert>) => call<number>(s,'teacher_broadcast_alert',F4A.broadcastAlert,i),

  // F4B — Operations
  activateEmergency: (s: SupabaseClient, i: z.input<typeof F4B.activateEmergency>) => call<number>(s,'activate_emergency',F4B.activateEmergency,i),
  finalizeExpiredEmergencies: (s: SupabaseClient, i: z.input<typeof F4B.finalizeExpiredEmergencies>) => call<number>(s,'finalize_expired_emergencies_for_classroom',F4B.finalizeExpiredEmergencies,i),
  terminateEmergency: (s: SupabaseClient, i: z.input<typeof F4B.terminateEmergency>) => call<void>(s,'terminate_emergency',F4B.terminateEmergency,i),
  createEmergencyQuest: (s: SupabaseClient, i: z.input<typeof F4B.createQuest>) => call<number>(s,'teacher_create_emergency_quest',F4B.createQuest,i),
  closeEmergencyQuest: (s: SupabaseClient, i: z.input<typeof F4B.closeQuest>) => call<void>(s,'teacher_close_emergency_quest',F4B.closeQuest,i),
  requestEmergencyQuestCompletion: (s: SupabaseClient, i: z.input<typeof F4B.requestQuestCompletion>) => call<number>(s,'request_emergency_quest_completion',F4B.requestQuestCompletion,i),
  reviewEmergencyQuestRequest: (s: SupabaseClient, i: z.input<typeof F4B.reviewQuestRequest>) => call<number>(s,'teacher_review_emergency_quest_request',F4B.reviewQuestRequest,i),
  appointGuard: (s: SupabaseClient, i: z.input<typeof F4B.appointGuard>) => call<number>(s,'teacher_appoint_guard',F4B.appointGuard,i),
  endGuard: (s: SupabaseClient, i: z.input<typeof F4B.endGuard>) => call<void>(s,'teacher_end_guard_term',F4B.endGuard,i),

  // F4C — Attendance + Assignments
  recordAttendanceBulk: (s: SupabaseClient, i: z.input<typeof F4C.attendanceBulk>) => call<{recorded:any[];skipped:any[]}>(s,'teacher_record_attendance_bulk',F4C.attendanceBulk,i),
  correctAttendance: (s: SupabaseClient, i: z.input<typeof F4C.correctAttendance>) => call<number>(s,'teacher_correct_attendance',F4C.correctAttendance,i),
  createAssignment: (s: SupabaseClient, i: z.input<typeof F4C.createAssignment>) => call<number>(s,'teacher_create_assignment',F4C.createAssignment,i),
  setAssignmentStatus: (s: SupabaseClient, i: z.input<typeof F4C.setAssignmentStatus>) => call<void>(s,'teacher_set_assignment_status',F4C.setAssignmentStatus,i),
  submitAssignment: (s: SupabaseClient, i: z.input<typeof F4C.submitAssignment>) => call<number>(s,'submit_assignment',F4C.submitAssignment,i),
  gradeAssignment: (s: SupabaseClient, i: z.input<typeof F4C.gradeAssignment>) => call<number>(s,'grade_assignment',F4C.gradeAssignment,i),

  // F4D — Records + diagnostics
  refreshRecords: (s: SupabaseClient, i: z.input<typeof F4D.refreshRecords>) => call<any>(s,'teacher_refresh_classroom_records',F4D.refreshRecords,i),
  addHallEntry: (s: SupabaseClient, i: z.input<typeof F4D.addHallEntry>) => call<number>(s,'teacher_add_hall_of_fame_entry',F4D.addHallEntry,i),
  archiveHallEntry: (s: SupabaseClient, i: z.input<typeof F4D.archiveHallEntry>) => call<void>(s,'teacher_archive_hall_of_fame_entry',F4D.archiveHallEntry,i),
  healthCheck: (s: SupabaseClient) => call<any>(s,'teacher_feature4_1_1_health_check',F4D.healthCheck,{}),
};
