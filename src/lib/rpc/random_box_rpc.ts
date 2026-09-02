import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type RandomBoxRewardKind = 'GOLD' | 'INVENTORY' | 'MANUAL';
export type RandomBoxOpeningStatus = 'AUTO_DELIVERED' | 'PENDING_MANUAL' | 'MANUAL_DELIVERED';

export interface RandomBoxRewardPreview {
  reward_code: string;
  label: string;
  kind: RandomBoxRewardKind;
  probability_percent: number;
  manual_required: boolean;
}

export interface RandomBoxBoard {
  student_id: number;
  classroom_id: number;
  box: {
    item_id: number;
    name: string;
    description: string | null;
    image_url: string | null;
    owned_quantity: number;
    reserved_quantity: number;
    available_quantity: number;
  } | null;
  rewards: RandomBoxRewardPreview[];
  recent_openings: Array<{
    opening_id: number;
    reward_code: string;
    reward_label: string;
    reward_kind: RandomBoxRewardKind;
    status: RandomBoxOpeningStatus;
    created_at: string;
  }>;
}

export interface RandomBoxOpenResult {
  success: true;
  opening_id: number;
  reward_code: string;
  reward_label: string;
  reward_kind: RandomBoxRewardKind;
  reward_gold: number | null;
  manual_required: boolean;
  status: RandomBoxOpeningStatus;
  remaining_box_quantity: number;
}

export interface TeacherRandomBoxManualReward {
  opening_id: number;
  student_id: number;
  student_name: string;
  brand_name: string | null;
  reward_code: string;
  reward_label: string;
  status: RandomBoxOpeningStatus;
  opened_at: string;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface TeacherRandomBoxManualBoard {
  classroom_id: number;
  pending_count: number;
  items: TeacherRandomBoxManualReward[];
}

async function callRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const randomBoxRpc = {
  studentBoard: (supabase: SupabaseClient) => callRpc<RandomBoxBoard>(supabase, 'student_get_random_box_board'),
  open: (supabase: SupabaseClient) => callRpc<RandomBoxOpenResult>(supabase, 'student_open_random_box'),
  teacherManualBoard: (supabase: SupabaseClient, classroomId: number) =>
    callRpc<TeacherRandomBoxManualBoard>(supabase, 'teacher_get_random_box_manual_rewards', { p_classroom_id: classroomId }),
  teacherMarkDelivered: (supabase: SupabaseClient, openingId: number, note?: string | null) =>
    callRpc<{
      success: true;
      opening_id: number;
      student_id: number;
      reward_code: string;
      reward_label: string;
      status: RandomBoxOpeningStatus;
      reviewed_at: string;
    }>(supabase, 'teacher_mark_random_box_manual_reward_delivered', {
      p_opening_id: openingId,
      p_note: note?.trim() || null,
    }),
};
