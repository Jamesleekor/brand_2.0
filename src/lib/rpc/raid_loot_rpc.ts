// RAID_LOOT_V1_2_RPC_20261018
// 레이드 전리품 획득식 V1.2 — 교사/학생 RPC 타입과 호출
// 모든 추첨·지급은 서버(PostgreSQL)에서만 일어납니다. 이 파일은 요청을 보내고 결과를 받기만 합니다.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { RpcResult } from './student_rpc';

export type RaidLootSlot1Kind = 'GOLD' | 'CRYSTAL';
export type RaidLootSlot2Kind = 'FRAGMENTS' | 'CHARACTER';
export type RaidLootKind = RaidLootSlot1Kind | RaidLootSlot2Kind;
export type RaidLootMode = 'AUTO' | 'FIXED_KIND' | 'FIXED_ITEM';

export type RaidLootStage =
  | 'READY'
  | 'SLOT1_ITEM' | 'SLOT1_DRAWING' | 'SLOT1_WINNER'
  | 'SLOT2_ITEM' | 'SLOT2_DRAWING' | 'SLOT2_WINNER'
  | 'COMPLETE';

export type RaidLootUnavailableReason =
  | 'NO_ELIGIBLE' | 'RAID_FAILED' | 'DISABLED' | 'NOT_COMPLETED' | 'CONFIG_INCOMPLETE';

export interface RaidLootRange { min: number; max: number; step: number }

export interface RaidLootPoolItem {
  character_id: number;
  character_uid: string | null;
  display_name: string;
  image_url: string | null;
  emoji: string | null;
  base_price_crystal: number;
  manual_factor: number;
  is_selected: boolean;
  sort_order: number;
  weight: number;
  probability: number;
}

export interface RaidLootSlot1Config {
  mode: RaidLootMode;
  gold_bp?: number;
  crystal_bp?: number;
  gold: RaidLootRange | null;
  crystal: RaidLootRange | null;
  fixed_kind: RaidLootSlot1Kind | null;
  fixed_amount: number | null;
}

export interface RaidLootSlot2Config {
  mode: RaidLootMode;
  fragments_bp?: number;
  character_bp?: number;
  fragments: RaidLootRange | null;
  fixed_kind: RaidLootSlot2Kind | null;
  fixed_amount: number | null;
  fixed_character_id: number | null;
  fixed_character?: {
    character_id: number;
    display_name: string;
    base_price_crystal: number;
    image_url: string | null;
    emoji: string | null;
  } | null;
  duplicate_policy?: 'CONVERT_TO_CRYSTAL_90';
  duplicate_conversion_bp?: number;
}

export interface RaidLootStoredConfig {
  slot1: RaidLootSlot1Config;
  slot2: RaidLootSlot2Config;
  pool: RaidLootPoolItem[];
  enabled: boolean;
  config_version: number;
  updated_at: string;
}

export interface RaidLootAvailableCharacter {
  character_id: number;
  character_uid: string | null;
  display_name: string;
  image_url: string | null;
  emoji: string | null;
  base_price_crystal: number;
  default_weight: number;
}

export interface RaidLootDriftWarning {
  character_id: number;
  display_name: string;
  saved_price: number;
  live_price: number | null;
  message: string;
}

export interface RaidLootConfigView {
  raid: { id: number; title: string; boss_name: string; status: string; classroom_id: number };
  editable: boolean;
  has_ceremony: boolean;
  config: RaidLootStoredConfig | null;
  issues: string[];
  drift_warnings: RaidLootDriftWarning[];
  available_characters: RaidLootAvailableCharacter[];
  copy_sources: Array<{ raid_id: number; title: string; status: string; config_version: number; updated_at: string }>;
  rehearsal_sources: Array<{
    raid_id: number; title: string; boss_name: string; completed_at: string | null;
    participant_count: number; has_config: boolean;
  }>;
  copy_dropped?: string[];
}

/** 저장할 때 보내는 값 (서버가 다시 검사하고 가격·이름은 서버가 채웁니다) */
export interface RaidLootConfigPayload {
  enabled: boolean;
  slot1: {
    mode: RaidLootMode;
    gold: RaidLootRange | null;
    crystal: RaidLootRange | null;
    fixed_kind: RaidLootSlot1Kind | null;
    fixed_amount: number | null;
  };
  slot2: {
    mode: RaidLootMode;
    fragments: RaidLootRange | null;
    fixed_kind: RaidLootSlot2Kind | null;
    fixed_amount: number | null;
    fixed_character_id: number | null;
  };
  pool: Array<{ character_id: number; manual_factor: number; is_selected: boolean }>;
}

export interface RaidLootWinner {
  student_id: number;
  display_name: string;
  brand_name: string | null;
  avatar_url: string | null;
  final_rank: number | null;
  contribution_percent: number | null;
  is_me: boolean;
}

export interface RaidLootPublicReward {
  slot_no: 1 | 2;
  kind: RaidLootKind;
  label: string;
  amount: number | null;
  character_id: number | null;
  character_uid: string | null;
  character_name: string | null;
  character_image_url: string | null;
  character_emoji: string | null;
  settlement_status: 'UNSETTLED' | 'SETTLED' | 'VOID';
  winner: RaidLootWinner | null;
  delivered_kind: RaidLootKind | null;
  delivered_amount: number | null;
  duplicate_character_converted: boolean;
  original_base_price_crystal: number | null;
  conversion_rate_bp: number | null;
  void: boolean;
}

export interface RaidLootAdminReward extends RaidLootPublicReward {
  round_id?: number;
  reward_snapshot?: Record<string, unknown>;
  winner_snapshot?: Record<string, unknown> | null;
  void_reason?: string | null;
  transaction_id?: number | null;
  fragment_ledger_id?: number | null;
  acquisition_event_id?: number | null;
}

export interface RaidLootShuffleCandidate {
  student_id: number;
  name: string;
  avatar_url: string | null;
}

export interface RaidLootEligibleRow {
  participant_id: number;
  student_id: number;
  name: string;
  brand_name: string | null;
  avatar_url: string | null;
  final_rank: number | null;
  total_damage: number;
  contribution_percent: number;
  display_order: number;
  weight: number;
}

export interface RaidLootAdminState {
  raid: { id: number; title: string; boss_name: string; status: string; classroom_id: number };
  enabled: boolean;
  config_version: number | null;
  config_issues: string[];
  ceremony: {
    id: number; status: RaidLootStage; eligible_count: number; total_damage: number;
    version: number; created_at: string; updated_at: string; completed_at: string | null;
  } | null;
  stage: RaidLootStage | null;
  unavailable_reason: RaidLootUnavailableReason | null;
  can_prepare: boolean;
  next_action: { expected_status: RaidLootStage | 'NONE'; label: string } | null;
  eligible_count: number | null;
  eligible: RaidLootEligibleRow[];
  shuffle_candidates: { slot1: RaidLootShuffleCandidate[]; slot2: RaidLootShuffleCandidate[] };
  rewards: RaidLootAdminReward[];
  audit: Array<{ id: number; action: string; slot_no: number | null; from_status: string | null; to_status: string | null; created_at: string }>;
  duplicate_request?: boolean;
  stale?: boolean;
}

export interface RaidLootRehearsalScript {
  mode: 'REHEARSAL';
  source_raid_id: number;
  source_raid_title: string;
  boss_name: string;
  config_source: 'RAID' | 'OTHER_RAID' | 'DRAFT';
  eligible_count: number;
  eligible?: RaidLootEligibleRow[];
  unavailable_reason: 'NO_ELIGIBLE' | null;
  shuffle_candidates: { slot1: RaidLootShuffleCandidate[]; slot2: RaidLootShuffleCandidate[] };
  rewards: RaidLootAdminReward[];
  generated_at: string;
}

export interface RaidLootPublicState {
  raid_id: number;
  enabled: boolean;
  stage: RaidLootStage | null;
  eligible_count: number | null;
  unavailable_reason: RaidLootUnavailableReason | null;
  rewards: RaidLootPublicReward[];
  my_win_count: number;
}

/** 중계화면 8단계 순서 (명세서 §4.2.1) */
export const RAID_LOOT_STAGE_ORDER: RaidLootStage[] = [
  'READY', 'SLOT1_ITEM', 'SLOT1_DRAWING', 'SLOT1_WINNER',
  'SLOT2_ITEM', 'SLOT2_DRAWING', 'SLOT2_WINNER', 'COMPLETE',
];

export const RAID_LOOT_NEXT_LABEL: Record<RaidLootStage, string | null> = {
  READY: '1차 전리품 공개',
  SLOT1_ITEM: '1차 획득자 추첨 시작',
  SLOT1_DRAWING: '당첨자 확정',
  SLOT1_WINNER: '2차 전리품 공개',
  SLOT2_ITEM: '2차 획득자 추첨 시작',
  SLOT2_DRAWING: '당첨자 확정',
  SLOT2_WINNER: '최종 결과',
  COMPLETE: null,
};

export const RAID_LOOT_REASON_TEXT: Record<RaidLootUnavailableReason, string> = {
  NO_ELIGIBLE: '전체 피해량의 1% 이상 기여한 모험가가 없어 전리품 획득식을 진행하지 않습니다.',
  RAID_FAILED: '토벌에 실패해 전리품이 없습니다.',
  DISABLED: '이 레이드는 전리품이 꺼져 있습니다.',
  NOT_COMPLETED: '보스 토벌이 끝나면 시작할 수 있습니다.',
  CONFIG_INCOMPLETE: '전리품 설정이 아직 완성되지 않았습니다.',
};

export function raidLootKindText(kind: RaidLootKind | null | undefined): string {
  switch (kind) {
    case 'GOLD': return '골드';
    case 'CRYSTAL': return '크리스탈';
    case 'FRAGMENTS': return '편린 조각';
    case 'CHARACTER': return '완성 편린';
    default: return '';
  }
}

/** 골드·크리스탈 전리품 이미지 (999 이하 / 1,000 이상) */
const RAID_LOOT_BOOTY_ROOT = 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Raid/booty';
export const RAID_LOOT_CURRENCY_IMAGES = {
  GOLD_SMALL: `${RAID_LOOT_BOOTY_ROOT}/root_1gold_bar.webp`,
  GOLD_LARGE: `${RAID_LOOT_BOOTY_ROOT}/root_3gold_bars.webp`,
  CRYSTAL_SMALL: `${RAID_LOOT_BOOTY_ROOT}/root_small_crystal.webp`,
  CRYSTAL_LARGE: `${RAID_LOOT_BOOTY_ROOT}/root_pile_of_crystal.webp`,
} as const;

export function raidLootCurrencyImage(kind: RaidLootKind | null | undefined, amount: number | null | undefined): string | null {
  const large = Number(amount ?? 0) >= 1000;
  if (kind === 'GOLD') return large ? RAID_LOOT_CURRENCY_IMAGES.GOLD_LARGE : RAID_LOOT_CURRENCY_IMAGES.GOLD_SMALL;
  if (kind === 'CRYSTAL') return large ? RAID_LOOT_CURRENCY_IMAGES.CRYSTAL_LARGE : RAID_LOOT_CURRENCY_IMAGES.CRYSTAL_SMALL;
  return null;
}

export function newRaidLootRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function callRpc<T>(supabase: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { success: false, type: 'SERVER', error: error.message, code: error.code };
  return { success: true, data: data as T };
}

export const raidLootRpc = {
  getConfig: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidLootConfigView>(supabase, 'teacher_get_raid_loot_config', { p_raid_id: raidId }),

  saveConfig: (supabase: SupabaseClient, raidId: number, payload: RaidLootConfigPayload, expectedVersion: number | null) =>
    callRpc<RaidLootConfigView>(supabase, 'teacher_save_raid_loot_config', {
      p_raid_id: raidId, p_payload: payload, p_expected_version: expectedVersion,
    }),

  copyConfig: (supabase: SupabaseClient, fromRaidId: number, toRaidId: number) =>
    callRpc<RaidLootConfigView>(supabase, 'teacher_copy_raid_loot_config', {
      p_from_raid_id: fromRaidId, p_to_raid_id: toRaidId,
    }),

  getCeremony: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidLootAdminState>(supabase, 'teacher_get_raid_loot_ceremony', { p_raid_id: raidId }),

  prepare: (supabase: SupabaseClient, raidId: number, requestId: string) =>
    callRpc<RaidLootAdminState>(supabase, 'teacher_prepare_raid_loot', { p_raid_id: raidId, p_request_id: requestId }),

  advance: (supabase: SupabaseClient, raidId: number, expectedStatus: RaidLootStage, requestId: string) =>
    callRpc<RaidLootAdminState>(supabase, 'teacher_advance_raid_loot', {
      p_raid_id: raidId, p_expected_status: expectedStatus, p_request_id: requestId,
    }),

  rehearse: (
    supabase: SupabaseClient,
    sourceRaidId: number,
    configSource: 'RAID' | 'OTHER_RAID' | 'DRAFT' = 'RAID',
    configRaidId: number | null = null,
    configPayload: RaidLootConfigPayload | null = null,
  ) =>
    callRpc<RaidLootRehearsalScript>(supabase, 'teacher_rehearse_raid_loot', {
      p_source_raid_id: sourceRaidId,
      p_config_source: configSource,
      p_config_raid_id: configRaidId,
      p_config_payload: configPayload,
    }),

  studentPublicState: (supabase: SupabaseClient, raidId: number) =>
    callRpc<RaidLootPublicState>(supabase, 'student_get_raid_loot_public_state', { p_raid_id: raidId }),
};
