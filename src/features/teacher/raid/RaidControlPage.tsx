import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { LoadingSpinner, useRpcCall } from '@/components/shared/components';

// RAID_BETA1_REWARD_CONFIG_UI_20260918
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { raidAdminRpc, type RaidEditorPayload, type RaidElement, type RaidStatus, type TeacherRaidDetail, type TeacherRaidLiveDashboard } from '@/lib/rpc/raid_admin_rpc';
import { raidBalanceV15Rpc } from '@/lib/rpc/raid_balance_v15_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';
import RaidV15ConfigPanel, { type RaidConfigTabKey } from '@/features/teacher/raid/RaidV15ConfigPanel';
import { isValidOptionalHttpUrl, mergeRaidVisualV2Metadata, readRaidVisualV2 } from '@/features/raid/visual/raidVisualConfig';
import type { RaidVisualFxConfig, RaidVisualFxIntensity, RaidVisualFxPreset, RaidVisualCameraConfig, RaidVisualCameraPreset } from '@/features/raid/visual/raidVisualTypes';
import { RAID_CAMERA_PRESETS } from '@/features/raid/visual/raidCameraPresets';
import { RaidCameraRig, type RaidCameraEvents } from '@/features/raid/visual/RaidCameraRig';
import { RAID_FX_PRESETS, RAID_FX_INTENSITIES } from '@/features/raid/visual/raidFxPresets';
import { RaidFxCanvas } from '@/features/raid/visual/RaidFxCanvas';
import { RaidCinematicFxLayer } from '@/features/raid/visual/RaidCinematicFxLayer';
import { useRaidCinematicEvents } from '@/features/raid/visual/useRaidCinematicEvents';
import { RAID_CINEMATIC_TRIGGERS, RAID_EVENT_FX, RAID_CAMERA_REACTIONS, RAID_CINEMATIC_DEFAULTS, normalizeRaidCinematicConfig } from '@/features/raid/visual/raidCinematicPresets';
import type { RaidCinematicConfig, RaidCinematicTrigger, RaidEventFx, RaidCameraReaction } from '@/features/raid/visual/raidCinematicPresets';
import { raidV15AdminRpc } from '@/lib/rpc/raid_v15_admin_rpc';
import {
  RAID_BOSS_PRESETS,
  cloneRaidBossPresetPatterns,
  getRaidBossPreset,
  type RaidBossPresetKey,
} from '@/features/teacher/raid/raidBossPresets';
// RAID_V15_E5_CONFIGURATION_UI

// RAID_V15_E3C_TEACHER_TEST_PRESET

type RaidForm = {
  title: string;
  bossName: string;
  bossDescription: string;
  bossElement: RaidElement;
  maxHp: string;
  endsAt: string;
  damageCoefficient: string;
  varianceMin: string;
  varianceMax: string;
  critMultiplier: string;
  tapRateLimit: string;
  baseRewardGold: string;
  rewardsEnabled: boolean;
  chatEnabled: boolean;
  chatSlowMode: string;
  includeTestAccounts: boolean;
  // RAID_ELEMENT_V1_20261017
  elementDamageEnabled: boolean;
  imageUrl: string;
  loopVideoUrl: string;
  basicAttackVideoUrl: string;
  enrageBasicAttackVideoUrl: string;
  specialPatternVideoUrl: string;
  enrageSpecialPatternVideoUrl: string;
  groggyVideoUrl: string;
  enrageVideoUrl: string;
  fxPreset: RaidVisualFxPreset;
  fxIntensity: RaidVisualFxIntensity;
  cameraPreset: RaidVisualCameraPreset;
  cameraEventReactions: boolean;
  cinematic: RaidCinematicConfig;
};

// RAID_ADMIN_LAYOUT_TABS_20261023: 레이드 통제실을 탭으로 나눠 스크롤 이동을 줄인다.
// BASIC/VISUAL/RULES = 보스 설정 폼(설정 저장 1개), COMBAT/PATTERNS/AUDIO/LOOT = 레이드 구성 패널, LIVE = 실시간 현황.
type RaidPageTab = 'BASIC' | 'VISUAL' | 'RULES' | 'COMBAT' | 'PATTERNS' | 'AUDIO' | 'LOOT' | 'LIVE';
type RaidEditorSection = 'BASIC' | 'VISUAL' | 'RULES';

const EDITOR_SECTION_TABS: readonly RaidPageTab[] = ['BASIC', 'VISUAL', 'RULES'];
const CONFIG_PANEL_TABS: readonly RaidPageTab[] = ['COMBAT', 'PATTERNS', 'AUDIO', 'LOOT'];

const ELEMENT_OPTIONS: Array<{ value: RaidElement; label: string }> = [
  { value: 'FIRE', label: '🔥 화' },
  { value: 'WATER', label: '💧 수' },
  { value: 'WIND', label: '💫 풍' },
  { value: 'EARTH', label: '🪨 토' },
  { value: 'LIGHT', label: '✦ 빛' },
  { value: 'DARK', label: '☾ 암' },
];

const RAID_BOSS_VIDEO_BASE_URL = 'https://cdn.jsdelivr.net/gh/Jamesleekor/brand-assets@main/Raid/boss_videos/';

function raidVideoInputValue(value: string, baseUrl = RAID_BOSS_VIDEO_BASE_URL): string {
  const trimmed = value.trim();
  return trimmed.startsWith(baseUrl) ? trimmed.slice(baseUrl.length) : trimmed;
}

function resolveRaidVideoUrl(value: string, baseUrl = RAID_BOSS_VIDEO_BASE_URL): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${baseUrl}${trimmed.replace(/^\/+/, '')}`;
}

const EMPTY_FORM: RaidForm = {
  title: '',
  bossName: '',
  bossDescription: '',
  bossElement: 'DARK',
  maxHp: '1000000',
  endsAt: '',
  damageCoefficient: '0.02',
  varianceMin: '0.90',
  varianceMax: '1.10',
  critMultiplier: '2.0',
  tapRateLimit: '10',
  baseRewardGold: '300',
  rewardsEnabled: true,
  chatEnabled: true,
  chatSlowMode: '2',
  includeTestAccounts: false,
  elementDamageEnabled: true,
  imageUrl: '',
  loopVideoUrl: '',
  basicAttackVideoUrl: '',
  enrageBasicAttackVideoUrl: '',
  specialPatternVideoUrl: '',
  enrageSpecialPatternVideoUrl: '',
  groggyVideoUrl: '',
  enrageVideoUrl: '',
  fxPreset: 'NONE',
  fxIntensity: 'MEDIUM',
  cameraPreset: 'LOCKED',
  cameraEventReactions: true,
  cinematic: normalizeRaidCinematicConfig(RAID_CINEMATIC_DEFAULTS),
};

export default function RaidControlPage() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading: rpcLoading } = useRpcCall();

  const [selectedRaidId, setSelectedRaidId] = useState<number | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<RaidForm>(EMPTY_FORM);
  const [formLoadedFor, setFormLoadedFor] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [deletingRaidId, setDeletingRaidId] = useState<number | null>(null);
  const [pendingBossPresetKey, setPendingBossPresetKey] = useState<RaidBossPresetKey | null>(null);
  const [raidConfigRevision, setRaidConfigRevision] = useState(0);
  const [focusPatternRaidId, setFocusPatternRaidId] = useState<number | null>(null);
  // RAID_ADMIN_LAYOUT_TABS_20261023
  const [pageTab, setPageTab] = useState<RaidPageTab>('BASIC');
  const [lastConfigTab, setLastConfigTab] = useState<RaidConfigTabKey>('COMBAT');
  const [tabInitFor, setTabInitFor] = useState<number | null>(null);
  const [patternCount, setPatternCount] = useState<number | null>(null);

  const boardQuery = useQuery({
    queryKey: ['teacher-raid-control-board', classroomId],
    queryFn: async () => {
      if (!classroomId) return { raids: [] };
      const result = await raidAdminRpc.board(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { raids: [] };
    },
    enabled: classroomId !== null,
  });

  const raids = boardQuery.data?.raids ?? [];

  useEffect(() => {
    if (isCreating) return;
    if (selectedRaidId === null && raids[0]) {
      setSelectedRaidId(raids[0].id);
    }
    if (selectedRaidId !== null && raids.length > 0 && !raids.some((raid) => raid.id === selectedRaidId)) {
      setSelectedRaidId(raids[0]?.id ?? null);
    }
  }, [isCreating, raids, selectedRaidId]);

  const detailQuery = useQuery({
    queryKey: ['teacher-raid-detail', selectedRaidId],
    queryFn: async () => {
      if (selectedRaidId === null) throw new Error('레이드가 선택되지 않았습니다.');
      const result = await raidAdminRpc.detail(supabase, selectedRaidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: selectedRaidId !== null && !isCreating,
  });

  const detail = detailQuery.data;

  useEffect(() => {
    if (isCreating || !detail) return;
    if (formLoadedFor === detail.raid.id) return;
    setForm(formFromDetail(detail));
    setFormLoadedFor(detail.raid.id);
  }, [detail, formLoadedFor, isCreating]);

  // RAID_ADMIN_LAYOUT_TABS_20261023: 레이드를 처음 열 때 시작 탭을 정한다.
  // 전투 중이면 실시간 운영, 새로 만든 직후면 패턴, 그 외에는 기본 정보.
  useEffect(() => {
    if (isCreating || !detail) return;
    if (tabInitFor === detail.raid.id) return;
    setTabInitFor(detail.raid.id);
    const status = detail.raid.status;
    if (focusPatternRaidId === detail.raid.id) {
      setPageTab('PATTERNS');
      setLastConfigTab('PATTERNS');
    } else if (status === 'ACTIVE' || status === 'PAUSED') {
      setPageTab('LIVE');
    } else {
      setPageTab('BASIC');
    }
  }, [detail, focusPatternRaidId, isCreating, tabInitFor]);

  const changePageTab = (next: RaidPageTab) => {
    setPageTab(next);
    if (CONFIG_PANEL_TABS.includes(next)) setLastConfigTab(next as RaidConfigTabKey);
  };

  const selectedSummary = raids.find((raid) => raid.id === selectedRaidId) ?? null;
  const liveStatus = detail?.raid.status ?? selectedSummary?.status ?? null;

  const liveQuery = useQuery({
    queryKey: ['teacher-raid-live', selectedRaidId],
    queryFn: async () => {
      if (selectedRaidId === null) throw new Error('레이드가 선택되지 않았습니다.');
      const result = await raidAdminRpc.live(supabase, selectedRaidId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: selectedRaidId !== null && !isCreating && Boolean(detail),
    refetchInterval: liveStatus === 'ACTIVE' || liveStatus === 'PAUSED' ? 2000 : false,
  });

  const refreshAll = async (raidId?: number) => {
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-control-board'] });
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-detail'] });
    await queryClient.invalidateQueries({ queryKey: ['teacher-raid-live'] });
    if (raidId) {
      setSelectedRaidId(raidId);
      setFormLoadedFor(null);
    }
  };

  const beginCreate = () => {
    setIsCreating(true);
    setFocusPatternRaidId(null);
    setSelectedRaidId(null);
    setForm({ ...EMPTY_FORM });
    setFormLoadedFor(null);
    setPendingBossPresetKey(null);
    setPageTab('BASIC');
    setTabInitFor(null);
  };

  const selectRaid = (raidId: number) => {
    setIsCreating(false);
    setFocusPatternRaidId(null);
    setSelectedRaidId(raidId);
    setFormLoadedFor(null);
    setPendingBossPresetKey(null);
    setTabInitFor(null);
  };

  const selectBossPreset = (presetKey: RaidBossPresetKey | null) => {
    setPendingBossPresetKey(presetKey);
    const preset = getRaidBossPreset(presetKey);
    if (!preset) return;
    setForm((current) => ({
      ...current,
      title: preset.raidTitle,
      bossName: preset.bossName,
      bossDescription: preset.description,
      bossElement: preset.element,
    }));
  };

  const saveBossPresetCombat = async (raidId: number, presetKey: RaidBossPresetKey) => {
    const preset = getRaidBossPreset(presetKey);
    if (!preset) return false;
    const result = await raidV15AdminRpc.saveCombat(supabase, raidId, {
      config: { ...preset.combat, metadata: { ...(preset.combat.metadata ?? {}) } },
      patterns: cloneRaidBossPresetPatterns(preset),
    });
    if (result.success === false) {
      window.alert(`보스 프리셋의 전투 기믹/패턴 적용에 실패했습니다.\n\n${result.error}`);
      return false;
    }
    setRaidConfigRevision((current) => current + 1);
    return true;
  };

  const deleteRaidRecord = async (raid: { id: number; title: string; status: RaidStatus }) => {
    if (raid.status === 'LOBBY_OPEN' || raid.status === 'ACTIVE' || raid.status === 'PAUSED') {
      window.alert('진행 중인 레이드는 삭제할 수 없습니다. 먼저 레이드를 종료해주세요.');
      return;
    }

    const confirmed = window.confirm(
      `\"${raid.title}\" 기록을 영구 삭제합니다.\n\n` +
      '레이드 전투 기록, 참가자 스냅샷, 분석 보고서가 삭제되며 학생 화면에서도 더 이상 보이지 않습니다.\n' +
      '이미 지급된 골드/보상은 자동으로 회수되지 않습니다.\n\n계속하시겠습니까?',
    );
    if (!confirmed) return;

    setDeletingRaidId(raid.id);
    try {
      const result = await raidBalanceV15Rpc.deleteRecord(supabase, raid.id);
      if (result.success === false) {
        window.alert(result.error);
        return;
      }

      if (selectedRaidId === raid.id) {
        setSelectedRaidId(null);
        setFormLoadedFor(null);
      }
      setIsCreating(false);

      queryClient.removeQueries({ queryKey: ['teacher-raid-detail', raid.id] });
      queryClient.removeQueries({ queryKey: ['teacher-raid-live', raid.id] });
      queryClient.removeQueries({ queryKey: ['raid-balance-analysis-v15', raid.id] });
      await queryClient.invalidateQueries({ queryKey: ['teacher-raid-control-board'] });
      await queryClient.invalidateQueries({ queryKey: ['raid-balance-lab-v15'] });

      const rewardNote = Number(result.data.reward_settlement_count ?? 0) > 0
        ? `\n※ 기존 보상 정산 ${result.data.reward_settlement_count}건은 회수하지 않았습니다.`
        : '';
      window.alert(`레이드 기록을 삭제했습니다.${rewardNote}`);
    } finally {
      setDeletingRaidId(null);
    }
  };

  const buildPayload = (): RaidEditorPayload | null => {
    const maxHp = Number(form.maxHp);
    const damageCoefficient = Number(form.damageCoefficient);
    const varianceMin = Number(form.varianceMin);
    const varianceMax = Number(form.varianceMax);
    const critMultiplier = Number(form.critMultiplier);
    const tapRateLimit = Number(form.tapRateLimit);
    const chatSlowMode = Number(form.chatSlowMode);
    const baseRewardGold = Number(form.baseRewardGold);

    if (!form.title.trim()) {
      window.alert('레이드 제목을 입력해주세요.');
      return null;
    }
    if (!form.bossName.trim()) {
      window.alert('보스 이름을 입력해주세요.');
      return null;
    }
    if (!Number.isInteger(maxHp) || maxHp <= 0) {
      window.alert('보스 최대 HP는 1 이상의 정수로 입력해주세요.');
      return null;
    }
    if (!Number.isFinite(damageCoefficient) || damageCoefficient <= 0) {
      window.alert('피해 계수는 0보다 커야 합니다.');
      return null;
    }
    if (!Number.isFinite(varianceMin) || !Number.isFinite(varianceMax) || varianceMin <= 0 || varianceMax < varianceMin) {
      window.alert('랜덤 피해 범위를 확인해주세요.');
      return null;
    }
    if (!Number.isFinite(critMultiplier) || critMultiplier < 1) {
      window.alert('치명타 배율은 1 이상이어야 합니다.');
      return null;
    }
    if (!Number.isInteger(tapRateLimit) || tapRateLimit < 1 || tapRateLimit > 30) {
      window.alert('초당 터치 제한은 1~30 범위의 정수로 입력해주세요.');
      return null;
    }
    if (!Number.isInteger(chatSlowMode) || chatSlowMode < 0 || chatSlowMode > 60) {
      window.alert('채팅 간격은 0~60초 범위의 정수로 입력해주세요.');
      return null;
    }
    if (!Number.isInteger(baseRewardGold) || baseRewardGold < 0 || baseRewardGold > 10000000) {
      window.alert('토벌 기본 보상은 0~10,000,000 GOLD 범위의 정수로 입력해주세요.');
      return null;
    }

    const mediaUrls: Array<[string, string]> = [
      ['첫 프레임 이미지 URL', form.imageUrl],
      ['IDLE 루프 영상 URL', form.loopVideoUrl],
      ['일반공격 영상 URL', form.basicAttackVideoUrl],
      ['광폭 일반공격 영상 URL', form.enrageBasicAttackVideoUrl],
      ['특수패턴 영상 URL', form.specialPatternVideoUrl],
      ['광폭 특수패턴 영상 URL', form.enrageSpecialPatternVideoUrl],
      ['그로기 영상 URL', form.groggyVideoUrl],
      ['광폭화 영상 URL', form.enrageVideoUrl],
    ];
    for (const [label, value] of mediaUrls) {
      if (!isValidOptionalHttpUrl(value)) {
        window.alert(`${label}은 비워두거나 http:// 또는 https:// 주소를 입력해주세요.`);
        return null;
      }
    }

    return {
      title: form.title.trim(),
      boss_name: form.bossName.trim(),
      boss_description: form.bossDescription.trim() || null,
      boss_element: form.bossElement,
      max_hp: maxHp,
      ends_at: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      damage_coefficient: damageCoefficient,
      variance_min: varianceMin,
      variance_max: varianceMax,
      crit_multiplier: critMultiplier,
      tap_rate_limit_per_second: tapRateLimit,
      chat_enabled: form.chatEnabled,
      chat_slow_mode_seconds: chatSlowMode,
      include_test_accounts: form.includeTestAccounts,
      image_url: form.imageUrl.trim() || null,
      loop_video_url: form.loopVideoUrl.trim() || null,
      reward_config: { ...(detail?.raid.reward_config ?? {}), base_gold: baseRewardGold, rewards_enabled: form.rewardsEnabled },
      metadata: {
        ...(detail?.raid.metadata ?? {}),
        ...(pendingBossPresetKey ? { boss_preset_key: pendingBossPresetKey, boss_preset_version: 1 } : {}),
        element_damage_rules_version: form.elementDamageEnabled ? 'V1' : 'OFF',
      },
    };
  };

  const save = async () => {
    if (!classroomId) return;
    const payload = buildPayload();
    if (!payload) return;

    setBusyAction('SAVE');
    try {
      if (isCreating) {
        const newId = await call(
          () => raidAdminRpc.create(supabase, classroomId, payload),
          {
            successTitle: '레이드 초안 생성 완료',
            successDescription: '보스 설정을 저장했습니다.',
          },
        );
        if (typeof newId === 'number') {
          const visualMetadata = mergeRaidVisualV2Metadata({}, {
            basicAttackVideoUrl: form.basicAttackVideoUrl,
            enrageBasicAttackVideoUrl: form.enrageBasicAttackVideoUrl,
            specialPatternVideoUrl: form.specialPatternVideoUrl,
            enrageSpecialPatternVideoUrl: form.enrageSpecialPatternVideoUrl,
            groggyVideoUrl: form.groggyVideoUrl,
            enrageVideoUrl: form.enrageVideoUrl,
            fx: { preset: form.fxPreset, intensity: form.fxIntensity },
            camera: { preset: form.cameraPreset, event_reactions: form.cameraEventReactions },
            cinematic: form.cinematic,
          });

          const phaseSaveResult = await call(
            () => raidAdminRpc.savePhase(supabase, newId, 1, {
              hp_from_ratio: 1,
              hp_to_ratio: 0,
              boss_element: form.bossElement,
              image_url: form.imageUrl.trim() || null,
              loop_video_url: form.loopVideoUrl.trim() || null,
              damage_config: {},
              metadata: visualMetadata,
            }),
            { silent: true },
          );

          if (phaseSaveResult === null) {
            window.alert(
              '레이드 초안은 생성되었지만 Visual V2 설정 저장에 실패했습니다. 생성된 레이드를 다시 열어 미디어 설정을 저장해주세요.',
            );
          }

          if (pendingBossPresetKey) {
            const presetApplied = await saveBossPresetCombat(newId, pendingBossPresetKey);
            if (presetApplied) setPendingBossPresetKey(null);
          }
          setIsCreating(false);
          setFocusPatternRaidId(newId);
          await refreshAll(newId);
        }
        return;
      }

      if (selectedRaidId === null || !detail) return;
      if (!canEdit(detail.raid.status)) {
        window.alert('전투가 시작된 레이드는 핵심 설정을 수정할 수 없습니다.');
        return;
      }

      let updateSucceeded = false;
      await call(
        () => raidAdminRpc.update(supabase, selectedRaidId, payload),
        {
          silent: true,
          onSuccess: () => {
            updateSucceeded = true;
          },
        },
      );
      if (!updateSucceeded) return;

      const phase = detail.phases.find((item) => item.phase_no === 1);
      const phaseResult = await call(
        () => raidAdminRpc.savePhase(supabase, selectedRaidId, 1, {
          hp_from_ratio: 1,
          hp_to_ratio: 0,
          boss_element: form.bossElement,
          image_url: form.imageUrl.trim() || null,
          loop_video_url: form.loopVideoUrl.trim() || null,
          damage_config: phase?.damage_config ?? {},
          metadata: mergeRaidVisualV2Metadata(phase?.metadata, {
            basicAttackVideoUrl: form.basicAttackVideoUrl,
            enrageBasicAttackVideoUrl: form.enrageBasicAttackVideoUrl,
            specialPatternVideoUrl: form.specialPatternVideoUrl,
            enrageSpecialPatternVideoUrl: form.enrageSpecialPatternVideoUrl,
            groggyVideoUrl: form.groggyVideoUrl,
            enrageVideoUrl: form.enrageVideoUrl,
            fx: { preset: form.fxPreset, intensity: form.fxIntensity },
            camera: { preset: form.cameraPreset, event_reactions: form.cameraEventReactions },
            cinematic: form.cinematic,
          }),
        }),
        {
          successTitle: '레이드 설정 저장 완료',
          successDescription: '보스·전투 규칙·1페이즈 미디어를 저장했습니다.',
        },
      );
      if (phaseResult !== null) {
        if (pendingBossPresetKey) {
          const presetApplied = await saveBossPresetCombat(selectedRaidId, pendingBossPresetKey);
          if (presetApplied) setPendingBossPresetKey(null);
        }
        await refreshAll(selectedRaidId);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const runStateAction = async (
    key: string,
    confirmText: string,
    fn: () => ReturnType<typeof raidAdminRpc.openLobby>,
  ) => {
    if (selectedRaidId === null) return;
    if (!window.confirm(confirmText)) return;
    setBusyAction(key);
    try {
      let succeeded = false;
      await call(fn, {
        successTitle: actionSuccessTitle(key),
        onSuccess: () => {
          succeeded = true;
        },
      });
      if (succeeded) await refreshAll(selectedRaidId);
    } finally {
      setBusyAction(null);
    }
  };

  const handleStart = async () => {
    if (selectedRaidId === null || !detail) return;
    const phase = detail.phases.find((item) => item.phase_no === 1);
    if (!phase?.image_url && !phase?.loop_video_url) {
      window.alert('레이드를 시작하려면 1페이즈 보스 이미지 또는 루프 영상이 필요합니다.');
      return;
    }
    if (!window.confirm(
      '레이드를 시작하면 현재 학생들의 보유 편린·공명력·치명타율·장착 편린·길드가 스냅샷으로 고정됩니다.\n\n시작할까요?',
    )) return;

    setBusyAction('START');
    try {
      const result = await call(
        () => raidAdminRpc.start(supabase, selectedRaidId),
        {
          successTitle: '레이드 시작',
          successDescription: '학생 전투 스탯 스냅샷이 생성되었습니다.',
        },
      );
      if (result !== null) {
        await refreshAll(selectedRaidId);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleEnd = async () => {
    if (selectedRaidId === null) return;
    const reason = window.prompt('강제 종료 사유를 입력해주세요. (선택)', '') ?? null;
    if (!window.confirm('레이드를 종료하면 결과 순위가 확정됩니다. 계속할까요?')) return;

    setBusyAction('END');
    try {
      const result = await call(
        () => raidAdminRpc.end(supabase, selectedRaidId, reason),
        { successTitle: '레이드 종료 완료' },
      );
      if (result !== null) {
        await refreshAll(selectedRaidId);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleClone = async () => {
    if (selectedRaidId === null || !detail) return;

    const defaultTitle = `${detail.raid.title} · 재도전`;
    const requestedTitle = window.prompt(
      '복제해서 만들 새 레이드의 제목을 입력해주세요.\n보스·전투 규칙·V1.5 기믹·패턴·오디오·보상·페이즈·미디어가 그대로 복제됩니다.',
      defaultTitle,
    );
    if (requestedTitle === null) return;

    const newTitle = requestedTitle.trim() || defaultTitle;

    if (!window.confirm(
      `「${detail.raid.title}」을 새 레이드 초안으로 재생성할까요?\n\n` +
      '복제되는 항목: 보스/속성/HP/전투 규칙/V1.5 기믹·패턴/오디오/보상/페이즈/이미지·영상/Hit Zone\n' +
      '복제되지 않는 항목: 참가자/공격기록/채팅/결과/기존 일정\n\n' +
      '새 레이드는 DRAFT 상태로 만들어지며 바로 수정할 수 있습니다.',
    )) return;

    setBusyAction('CLONE');
    try {
      const newRaidId = await call(
        () => raidAdminRpc.clone(supabase, selectedRaidId, newTitle),
        {
          successTitle: '레이드 재생성 완료',
          successDescription: '기존 보스 설정을 복제한 새 초안을 만들었습니다.',
        },
      );

      const clonedRaidId = Number(newRaidId);
      if (newRaidId !== null && Number.isFinite(clonedRaidId)) {
        setIsCreating(false);
        await refreshAll(clonedRaidId);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleE3TestPreset = async () => {
    if (selectedRaidId === null || !detail) return;
    if (detail.raid.status !== 'DRAFT') {
      window.alert('E3 테스트 프리셋은 DRAFT 상태에서만 적용할 수 있습니다.');
      return;
    }
    if (!window.confirm(
      '이 Raid의 패턴 목록을 E3 특수기믹 10종 테스트 순서로 교체할까요?\n\n' +
      '12초부터 약 3분 동안 ABSORB → REFLECT → ULTIMATE → DOT → SHIELD → MULTI_CORE → SPLIT_TARGET → REGEN → SEAL → DAMAGE_CHECK가 순서대로 발동합니다.\n\n' +
      '테스트용 DRAFT Raid에서만 사용하세요.',
    )) return;

    setBusyAction('E3_PRESET');
    try {
      const result = await call(
        () => raidAdminRpc.applyE3TestPreset(supabase, selectedRaidId),
        {
          successTitle: 'E3 테스트 프리셋 적용 완료',
          successDescription: '특수기믹 10종을 시간순으로 배치했습니다.',
        },
      );
      if (result !== null) await refreshAll(selectedRaidId);
    } finally {
      setBusyAction(null);
    }
  };

  const handleChatToggle = async () => {
    if (selectedRaidId === null || !detail) return;
    setBusyAction('CHAT');
    try {
      const next = !detail.raid.chat_enabled;
      let succeeded = false;
      await call(
        () => raidAdminRpc.setChatEnabled(supabase, selectedRaidId, next),
        {
          successTitle: next ? '레이드 채팅 활성화' : '레이드 채팅 잠금',
          onSuccess: () => {
            succeeded = true;
          },
        },
      );
      if (succeeded) await refreshAll(selectedRaidId);
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <TeacherShell>
      <div className="space-y-5 pb-10">
        <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.18em] text-cyan-200">
              RAID CONTROL
            </div>
            <h1 className="font-display text-2xl tracking-tight text-brand-gradient">
              👾 레이드 통제실
            </h1>
            <p className="mt-1 text-sm font-bold text-amber-100">
              보스 설정부터 로비 개방, 전투 시작·중지·종료와 실시간 현황까지 관리합니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/teacher/raid"
              className="rounded-card-md border border-gold/60 bg-gold/15 px-4 py-2 text-xs font-black text-yellow-100"
            >
              ⚔️ 레이드 통제실
            </Link>
            <Link
              to="/teacher/raid/analytics"
              className="rounded-card-md border border-cyan-400/40 bg-cyan-500/10 px-4 py-2 text-xs font-black text-cyan-100 hover:border-cyan-300/70"
            >
              📊 밸런싱 분석실
            </Link>
            {/* RAID_ADMIN_LAYOUT_TABS_20261023: "+ 새 레이드"는 아래 고정 상단바에 한 번만 둔다. */}
          </div>
        </header>

        {boardQuery.isLoading ? (
          <div className="flex min-h-[460px] items-center justify-center">
            <LoadingSpinner size="lg" />
          </div>
        ) : boardQuery.isError ? (
          <ErrorPanel
            title="레이드 목록을 불러오지 못했습니다"
            message={boardQuery.error instanceof Error ? boardQuery.error.message : '알 수 없는 오류'}
          />
        ) : (
          <>
            {/* RAID_ADMIN_LAYOUT_TABS_20261023: 고정 상단바 — 레이드 선택·상태·요약·조작 버튼 + 페이지 탭 */}
            <div className="z-20 -mx-2 space-y-2 bg-bg-base px-2 pb-2 pt-2 lg:sticky lg:top-[60px]">
              <RaidSelectorBar
                raids={raids}
                selectedId={selectedRaidId}
                creating={isCreating}
                onSelect={selectRaid}
                onCreate={beginCreate}
                onDelete={deleteRaidRecord}
                deletingRaidId={deletingRaidId}
              >
                {!isCreating && detail ? (
                  <>
                    <RaidQuickStats
                      hpRatio={liveQuery.data ? Number(liveQuery.data.raid.hp_ratio ?? 0) : (selectedSummary && selectedSummary.max_hp > 0 ? selectedSummary.current_hp / selectedSummary.max_hp : null)}
                      attackParticipants={liveQuery.data?.summary.attack_participant_count ?? null}
                      participants={liveQuery.data?.summary.participant_count ?? selectedSummary?.participant_count ?? null}
                    />
                    <RaidStateControl
                      inline
                      detail={detail}
                      busyAction={busyAction}
                      onOpenLobby={() => runStateAction(
                        'OPEN_LOBBY',
                        '레이드 로비를 개방할까요?\n학생들이 레이드 로비에 입장할 수 있게 됩니다.',
                        () => raidAdminRpc.openLobby(supabase, detail.raid.id),
                      )}
                      onStart={handleStart}
                      onPause={() => runStateAction(
                        'PAUSE',
                        '레이드를 일시정지할까요?\n정지 중에는 학생 공격이 처리되지 않습니다.',
                        () => raidAdminRpc.pause(supabase, detail.raid.id),
                      )}
                      onResume={() => runStateAction(
                        'RESUME',
                        '레이드를 다시 시작할까요?',
                        () => raidAdminRpc.resume(supabase, detail.raid.id),
                      )}
                      onEnd={handleEnd}
                      onClone={handleClone}
                      onE3TestPreset={handleE3TestPreset}
                      onChatToggle={handleChatToggle}
                    />
                  </>
                ) : null}
              </RaidSelectorBar>

              {isCreating || detail ? (
                <RaidPageTabs
                  active={pageTab}
                  onChange={changePageTab}
                  creating={isCreating}
                  patternCount={patternCount}
                  liveRunning={!isCreating && (detail?.raid.status === 'ACTIVE' || detail?.raid.status === 'PAUSED')}
                />
              ) : null}
            </div>

            <div className="min-w-0 space-y-4">
              {isCreating ? (
                <RaidEditor
                  form={form}
                  setForm={setForm}
                  status="DRAFT"
                  creating
                  section={EDITOR_SECTION_TABS.includes(pageTab) ? (pageTab as RaidEditorSection) : 'BASIC'}
                  saving={busyAction === 'SAVE' || rpcLoading}
                  pendingBossPresetKey={pendingBossPresetKey}
                  onBossPresetSelect={selectBossPreset}
                  onSave={save}
                />
              ) : selectedRaidId === null ? (
                <EmptyPanel />
              ) : detailQuery.isLoading || !detail ? (
                detailQuery.isError ? (
                  <ErrorPanel
                    title="레이드 설정을 불러오지 못했습니다"
                    message={detailQuery.error instanceof Error ? detailQuery.error.message : '알 수 없는 오류'}
                  />
                ) : (
                  <div className="flex min-h-[280px] items-center justify-center rounded-card-lg border border-line bg-bg-card">
                    <LoadingSpinner size="lg" />
                  </div>
                )
              ) : (
                <>
                  {pageTab === 'LIVE' ? (
                    <LivePanel
                      data={liveQuery.data}
                      loading={liveQuery.isLoading}
                      error={liveQuery.isError ? (liveQuery.error instanceof Error ? liveQuery.error.message : '알 수 없는 오류') : null}
                    />
                  ) : null}

                  {EDITOR_SECTION_TABS.includes(pageTab) ? (
                    <RaidEditor
                      key={`raid-editor-${detail.raid.id}`}
                      form={form}
                      setForm={setForm}
                      status={detail.raid.status}
                      creating={false}
                      section={pageTab as RaidEditorSection}
                      saving={busyAction === 'SAVE' || rpcLoading}
                      pendingBossPresetKey={pendingBossPresetKey}
                      onBossPresetSelect={selectBossPreset}
                      onSave={save}
                    />
                  ) : null}

                  {/* 레이드 구성 패널은 저장 전 편집 내용을 잃지 않도록 항상 켜 두고, 다른 탭에서는 숨기기만 한다. */}
                  <div className={cn(!CONFIG_PANEL_TABS.includes(pageTab) && 'hidden')}>
                    <RaidV15ConfigPanel
                      key={`raid-config-${detail.raid.id}-${raidConfigRevision}`}
                      raidId={detail.raid.id}
                      raidStatus={detail.raid.status}
                      bossName={detail.raid.boss_name}
                      visualReady={detail.phases.some((phase) => Boolean(phase.image_url || phase.loop_video_url))}
                      rewardEnabled={detail.raid.reward_config?.rewards_enabled === true}
                      raidMaxHp={detail.raid.max_hp}
                      damageCoefficient={detail.raid.damage_coefficient}
                      varianceMin={detail.raid.variance_min}
                      varianceMax={detail.raid.variance_max}
                      critMultiplier={detail.raid.crit_multiplier}
                      tapRateLimit={detail.raid.tap_rate_limit_per_second}
                      focusGenerator={focusPatternRaidId === detail.raid.id}
                      externalTab={lastConfigTab}
                      onPatternCountChange={setPatternCount}
                      onOpenLobby={() => runStateAction(
                        'OPEN_LOBBY',
                        '레이드 로비를 개방할까요?\n학생들이 레이드 로비에 입장할 수 있게 됩니다.',
                        () => raidAdminRpc.openLobby(supabase, detail.raid.id),
                      )}
                      bossImageUrl={detail.phases.find((phase) => phase.phase_no === 1)?.image_url ?? null}
                      bossVideoUrl={detail.phases.find((phase) => phase.phase_no === 1)?.loop_video_url ?? null}
                    />
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </TeacherShell>
  );
}

function RaidSelectorBar({
  raids,
  selectedId,
  creating,
  onSelect,
  onCreate,
  onDelete,
  deletingRaidId,
  children,
}: {
  raids: Array<{
    id: number;
    title: string;
    boss_name: string;
    boss_element: RaidElement;
    status: RaidStatus;
    max_hp: number;
    current_hp: number;
    participant_count: number;
  }>;
  selectedId: number | null;
  creating: boolean;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onDelete: (raid: { id: number; title: string; status: RaidStatus }) => void;
  deletingRaidId: number | null;
  /** RAID_ADMIN_LAYOUT_TABS_20261023: 오른쪽에 붙는 요약·상태 조작 버튼 */
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | 'RUNNING' | 'FINISHED' | 'DRAFT'>('ALL');
  const selected = raids.find((raid) => raid.id === selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const filteredRaids = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return raids.filter((raid) => {
      const matchesSearch = !keyword || `${raid.title} ${raid.boss_name} ${raid.id}`.toLowerCase().includes(keyword);
      if (!matchesSearch) return false;
      if (filter === 'RUNNING') return raid.status === 'LOBBY_OPEN' || raid.status === 'ACTIVE' || raid.status === 'PAUSED';
      if (filter === 'FINISHED') return raid.status === 'COMPLETED' || raid.status === 'FAILED' || raid.status === 'ARCHIVED';
      if (filter === 'DRAFT') return raid.status === 'DRAFT';
      return true;
    });
  }, [filter, raids, search]);

  return (
    <section className="relative rounded-card-lg border border-cyan-400/30 bg-bg-card px-3 py-2.5 shadow-[0_0_24px_rgba(34,211,238,0.04)]">
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="min-w-0 flex-1 rounded-card-md border border-cyan-300/25 bg-bg-deep px-3 py-2 text-left transition hover:border-cyan-300/55"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex-none text-xl">🗂️</span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black tracking-[0.08em] text-cyan-200">
                현재 레이드 · 눌러서 변경
              </div>
              {creating ? (
                <div className="mt-1 truncate text-sm font-black text-yellow-100">+ 새 레이드 작성 중</div>
              ) : selected ? (
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-black text-white">#{selected.id} · {selected.title}</span>
                  <StatusBadge status={selected.status} />
                  <span className="truncate text-xs font-bold text-amber-100">{elementLabel(selected.boss_element)} · {selected.boss_name}</span>
                </div>
              ) : (
                <div className="mt-1 text-sm font-black text-amber-100">레이드를 선택해주세요.</div>
              )}
            </div>
            <span className="flex-none text-xs font-black text-cyan-100">목록 {raids.length} ▾</span>
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {children}
          <button type="button" onClick={onCreate} className="btn-primary px-4 py-2 text-xs">
            + 새 레이드
          </button>
        </div>
      </div>

      {open ? (
        <>
          <button
            type="button"
            aria-label="레이드 목록 닫기"
            className="fixed inset-0 z-40 cursor-default bg-black/50"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="레이드 선택"
            className="absolute left-0 top-full z-50 mt-2 w-full max-w-3xl overflow-hidden rounded-card-lg border border-cyan-300/35 bg-[#0b1020] shadow-[0_20px_70px_rgba(0,0,0,0.6)]"
          >
            <div className="border-b border-cyan-300/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">RAID ARCHIVE</div>
                  <div className="mt-1 text-lg font-black text-white">레이드 선택 · 기록 관리</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onCreate();
                    }}
                    className="btn-primary px-3 py-2 text-xs"
                  >
                    + 새 레이드
                  </button>
                  <button type="button" onClick={() => setOpen(false)} className="rounded-card-md border border-line bg-bg-deep px-3 py-2 text-xs font-black text-white">
                    닫기 ✕
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="레이드 제목 · 보스 이름 · ID 검색"
                  className="w-full rounded-card-md border border-cyan-300/25 bg-black/25 px-3 py-2.5 text-sm font-bold text-white outline-none placeholder:text-cyan-100/45 focus:border-cyan-300/65"
                />
                <div className="flex flex-wrap gap-1.5">
                  {([
                    ['ALL', '전체'],
                    ['RUNNING', '진행 중'],
                    ['FINISHED', '종료'],
                    ['DRAFT', '초안'],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setFilter(value)}
                      className={cn(
                        'rounded-card-md border px-2.5 py-2 text-[11px] font-black',
                        filter === value
                          ? 'border-gold/55 bg-gold/15 text-yellow-100'
                          : 'border-line bg-bg-deep text-cyan-100 hover:border-cyan-300/45',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="max-h-[520px] overflow-y-auto p-3">
              {filteredRaids.length === 0 ? (
                <div className="rounded-card-md border border-dashed border-cyan-300/25 px-4 py-10 text-center text-sm font-black text-amber-100">
                  조건에 맞는 레이드가 없습니다.
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredRaids.map((raid) => {
                    const active = !creating && raid.id === selectedId;
                    const hpRatio = raid.max_hp > 0 ? raid.current_hp / raid.max_hp : 0;
                    const deleteDisabled = raid.status === 'LOBBY_OPEN' || raid.status === 'ACTIVE' || raid.status === 'PAUSED';
                    return (
                      <div
                        key={raid.id}
                        className={cn(
                          'grid gap-2 rounded-card-md border p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center',
                          active ? 'border-gold/65 bg-gold/10' : 'border-line bg-bg-deep',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(raid.id);
                            setOpen(false);
                          }}
                          className="min-w-0 text-left"
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-black text-white">#{raid.id} · {raid.title}</span>
                            <StatusBadge status={raid.status} />
                          </div>
                          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold">
                            <span className="truncate text-amber-100">{elementLabel(raid.boss_element)} · {raid.boss_name}</span>
                            <span className="text-cyan-100">HP {formatPercent(hpRatio * 100)}</span>
                            <span className="text-cyan-100">참여 {raid.participant_count}</span>
                          </div>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/40">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-yellow-200"
                              style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }}
                            />
                          </div>
                        </button>

                        <button
                          type="button"
                          onClick={() => onDelete(raid)}
                          disabled={deleteDisabled || deletingRaidId !== null}
                          title={deleteDisabled ? '진행 중인 레이드는 종료 후 삭제할 수 있습니다.' : '레이드 기록 삭제'}
                          className="rounded-card-md border border-red-300/35 bg-red-500/10 px-3 py-2 text-[11px] font-black text-red-100 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-35"
                        >
                          {deletingRaidId === raid.id ? '삭제 중…' : '🗑 기록 삭제'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

function RaidEditor({
  form,
  setForm,
  status,
  creating,
  saving,
  pendingBossPresetKey,
  onBossPresetSelect,
  onSave,
  section,
}: {
  form: RaidForm;
  setForm: React.Dispatch<React.SetStateAction<RaidForm>>;
  status: RaidStatus;
  creating: boolean;
  saving: boolean;
  pendingBossPresetKey: RaidBossPresetKey | null;
  onBossPresetSelect: (presetKey: RaidBossPresetKey | null) => void;
  onSave: () => void;
  /** RAID_ADMIN_LAYOUT_TABS_20261023: 지정하면 해당 탭 부분만 보여준다(접기 없음). 비우면 기존처럼 전체 표시. */
  section?: RaidEditorSection;
}) {
  const editable = creating || canEdit(status);
  const [collapsed, setCollapsed] = useState(!creating);
  const sectioned = section !== undefined;
  const isOpen = sectioned || !collapsed;
  const showBasic = !sectioned || section === 'BASIC';
  const showVisual = !sectioned || section === 'VISUAL';
  const showRules = !sectioned || section === 'RULES';
  const sectionMeta: Record<RaidEditorSection, { eyebrow: string; title: string; description: string }> = {
    BASIC: {
      eyebrow: '1페이즈 보스 · 기본 정보',
      title: creating ? '새 레이드 초안 · 기본 정보' : '보스 기본 정보',
      description: '레이드 제목·보스 이름·속성·HP·종료 시각·채팅·보스 설명을 정합니다.',
    },
    VISUAL: {
      eyebrow: '1페이즈 보스 · 연출',
      title: '보스 영상 · 화면 연출',
      description: '보스 영상, 환경 FX, 카메라, 이벤트별 시네마틱 연출을 정하고 아래에서 미리 봅니다.',
    },
    RULES: {
      eyebrow: '1페이즈 보스 · 전투 규칙',
      title: '전투 규칙 · 보상',
      description: '피해 계산 값, 터치 제한, 토벌 보상, 편린 속성 보정을 정합니다.',
    },
  };

  useEffect(() => {
    setCollapsed(!creating);
  }, [creating]);

  const update = <K extends keyof RaidForm>(key: K, value: RaidForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="rounded-card-lg border border-line bg-bg-card p-5">
      <div className={`${isOpen ? 'mb-5' : ''} flex flex-wrap items-start justify-between gap-3`}>
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">
            {section ? sectionMeta[section].eyebrow : 'BOSS SETUP · PHASE 1'}
          </div>
          <h2 className="mt-1 font-display text-xl text-white">
            {section ? sectionMeta[section].title : creating ? '새 레이드 초안' : '보스 및 전투 설정'}
          </h2>
          {isOpen && (
            <p className="mt-1 text-xs font-bold text-amber-100">
              {section ? sectionMeta[section].description : 'V1은 1페이즈(100% → 0%)를 사용합니다. 다중 페이즈 데이터 구조는 이미 준비되어 있습니다.'}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sectioned && !creating && !editable && <span className="rounded-pill border border-amber-300/40 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-100">🔒 전투 시작 후 읽기 전용</span>}
          {!sectioned && !creating && <StatusBadge status={status} />}
          {!sectioned && (
            <button
              type="button"
              onClick={() => setCollapsed((current) => !current)}
              className="rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-500/20"
              aria-expanded={!collapsed}
            >
              {collapsed ? '▼ 펼치기' : '▲ 접기'}
            </button>
          )}
        </div>
      </div>

      {isOpen && (
        <>
      {showBasic && (
        <>
      <BossPresetPicker
        value={pendingBossPresetKey}
        onChange={onBossPresetSelect}
        disabled={!editable || saving}
        creating={creating}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Field label="레이드 제목">
          <input
            value={form.title}
            disabled={!editable}
            onChange={(e) => update('title', e.target.value)}
            className={inputClass()}
            placeholder="예: 첫 번째 차원 침공"
          />
        </Field>
        <Field label="보스 이름">
          <input
            value={form.bossName}
            disabled={!editable}
            onChange={(e) => update('bossName', e.target.value)}
            className={inputClass()}
            placeholder="예: 폭염의 사자왕"
          />
        </Field>

        <Field label="보스 속성">
          <select
            value={form.bossElement}
            disabled={!editable}
            onChange={(e) => update('bossElement', e.target.value as RaidElement)}
            className={inputClass()}
          >
            {ELEMENT_OPTIONS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </Field>
        <Field label="최대 HP">
          <input
            type="number"
            min={1}
            step={1}
            value={form.maxHp}
            disabled={!editable}
            onChange={(e) => update('maxHp', e.target.value)}
            className={inputClass(true)}
          />
        </Field>

        <Field label="종료 예정 시각" hint="비워두면 수동 종료">
          <input
            type="datetime-local"
            value={form.endsAt}
            disabled={!editable}
            onChange={(e) => update('endsAt', e.target.value)}
            className={inputClass()}
          />
        </Field>
        <Field label="채팅">
          <div className="flex h-[42px] items-center gap-4 rounded-card-md border border-line bg-bg-deep px-3">
            <Toggle
              checked={form.chatEnabled}
              disabled={!editable}
              label={form.chatEnabled ? '사용' : '잠금'}
              onChange={(value) => update('chatEnabled', value)}
            />
            <span className="text-xs font-bold text-cyan-100">간격</span>
            <input
              type="number"
              min={0}
              max={60}
              value={form.chatSlowMode}
              disabled={!editable}
              onChange={(e) => update('chatSlowMode', e.target.value)}
              className="w-20 rounded border border-cyan-400/25 bg-black/20 px-2 py-1 font-mono text-xs font-black text-white outline-none focus:border-cyan-300/70"
            />
            <span className="text-xs font-bold text-amber-100">초</span>
          </div>
        </Field>

        <div className="lg:col-span-2">
          <Field label="보스 설명">
            <textarea
              value={form.bossDescription}
              disabled={!editable}
              onChange={(e) => update('bossDescription', e.target.value)}
              className={`${inputClass()} min-h-24 resize-y`}
              placeholder="학생 로비나 레이드 소개에 표시할 보스 설명"
            />
          </Field>
        </div>
      </div>
        </>
      )}

      {!sectioned && <div className="my-5 border-t border-line" />}

      {showVisual && (
      // RAID_ADMIN_LAYOUT_VISUAL_20261023: 왼쪽 = 설정 카드 3개, 오른쪽 = 스크롤해도 따라오는 미리보기
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          {/* ① 보스 영상 */}
          <div className="rounded-card-md border border-cyan-300/20 bg-cyan-500/5 p-4">
            <div className="text-sm font-black text-yellow-100">🎞️ 보스 영상 · 7슬롯</div>
            <p className="mt-1 text-[11px] font-bold leading-5 text-cyan-100">
              우선순위는 그로기 → 특수패턴 → 일반공격 → 광폭화 → IDLE입니다. 광폭 전용 공격/패턴 영상이 비어 있으면 변신 전 영상으로 되돌아가지 않고 광폭화 영상을 유지합니다.
            </p>
            <div className="mt-3 space-y-3">
              <VisualUrlRow label="첫 프레임 이미지" hint="영상 실패 시 대체" value={form.imageUrl} disabled={!editable} onChange={(value) => update('imageUrl', value)} />

              <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3">
                <div className="mb-2 text-[11px] font-black text-yellow-100">기본 영상</div>
                <VisualUrlRow label="IDLE 루프 영상" hint="6~7초 · 항상 최종 fallback" value={form.loopVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('loopVideoUrl', value)} />
              </div>

              <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3 space-y-2.5">
                <div className="text-[11px] font-black text-yellow-100">공격 영상</div>
                <VisualUrlRow label="일반공격 영상" hint="보스 기본 공격 전조/실행" value={form.basicAttackVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('basicAttackVideoUrl', value)} />
                <VisualUrlRow label="광폭 일반공격" hint="선택 · 광폭화 외형 유지" value={form.enrageBasicAttackVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('enrageBasicAttackVideoUrl', value)} />
              </div>

              <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3 space-y-2.5">
                <div className="text-[11px] font-black text-yellow-100">패턴 영상</div>
                <VisualUrlRow label="특수패턴 영상" hint="특수패턴 공용" value={form.specialPatternVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('specialPatternVideoUrl', value)} />
                <VisualUrlRow label="광폭 특수패턴" hint="선택 · 광폭화 외형 유지" value={form.enrageSpecialPatternVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('enrageSpecialPatternVideoUrl', value)} />
              </div>

              <div className="rounded-card-md border border-cyan-300/15 bg-bg-deep p-3 space-y-2.5">
                <div className="text-[11px] font-black text-yellow-100">상태 영상</div>
                <VisualUrlRow label="그로기 영상" hint="무력화/특수패턴 파훼 성공" value={form.groggyVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('groggyVideoUrl', value)} />
                <VisualUrlRow label="광폭화 영상" hint="광폭화 상태 기본 영상" value={form.enrageVideoUrl} baseUrl={RAID_BOSS_VIDEO_BASE_URL} disabled={!editable} onChange={(value) => update('enrageVideoUrl', value)} />
              </div>
            </div>
          </div>

          {/* ② 환경 FX · 카메라 */}
          <div className="rounded-card-md border border-cyan-300/20 bg-cyan-500/5 p-4">
            <div className="text-sm font-black text-yellow-100">🌊 환경 FX · 카메라</div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="raid-fx-preset" className="mb-1.5 block text-xs font-black text-yellow-100">환경 FX 프리셋</label>
                <select
                  id="raid-fx-preset"
                  value={form.fxPreset}
                  disabled={!editable}
                  onChange={(e) => update('fxPreset', e.target.value as RaidVisualFxPreset)}
                  className={compactSelectClass()}
                >
                  {RAID_FX_PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-black text-cyan-100">강도</span>
                  {RAID_FX_INTENSITIES.map((value) => (
                    <button
                      key={value}
                      type="button"
                      disabled={!editable || form.fxPreset === 'NONE'}
                      onClick={() => update('fxIntensity', value)}
                      className={cn(
                        'rounded-card-md border px-2.5 py-1 text-[11px] font-black transition disabled:cursor-not-allowed disabled:opacity-50',
                        form.fxIntensity === value
                          ? 'border-gold/65 bg-gold/15 text-yellow-100'
                          : 'border-cyan-300/25 bg-bg-deep text-cyan-100 hover:border-cyan-300/55',
                      )}
                    >
                      {value}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-cyan-100">
                  {RAID_FX_PRESETS.find((option) => option.value === form.fxPreset)?.description}
                </p>
              </div>
              <div className="min-w-0">
                <label htmlFor="raid-camera-preset" className="mb-1.5 block text-xs font-black text-yellow-100">카메라 프리셋</label>
                <select
                  id="raid-camera-preset"
                  value={form.cameraPreset}
                  disabled={!editable}
                  onChange={(e) => update('cameraPreset', e.target.value as RaidVisualCameraPreset)}
                  className={compactSelectClass()}
                >
                  {RAID_CAMERA_PRESETS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <label className="mt-2 flex items-center gap-2 text-xs font-black text-cyan-50">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={form.cameraEventReactions}
                    onChange={(e) => update('cameraEventReactions', e.target.checked)}
                    className="h-4 w-4 accent-yellow-300"
                  />
                  전투 이벤트 카메라 반응
                </label>
                <p className="mt-2 text-[11px] leading-5 text-cyan-100">
                  {RAID_CAMERA_PRESETS.find((option) => option.value === form.cameraPreset)?.description}
                  {' '}영상만 움직이고 약점 판정·HUD는 고정됩니다.
                </p>
              </div>
            </div>
          </div>

          {/* ③ 이벤트 시네마틱 */}
          <div className="rounded-card-md border border-fuchsia-400/30 bg-fuchsia-950/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-black text-fuchsia-100">
                <input type="checkbox" disabled={!editable} checked={form.cinematic.enabled}
                  onChange={e => update('cinematic', { ...form.cinematic, enabled: e.target.checked })}
                  className="h-4 w-4 accent-fuchsia-300" />
                🎬 이벤트 시네마틱 V2
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-cyan-100">
                <input type="checkbox" disabled={!editable || !form.cinematic.enabled} checked={form.cinematic.enrage_atmosphere}
                  onChange={e => update('cinematic', { ...form.cinematic, enrage_atmosphere: e.target.checked })}
                  className="h-4 w-4 accent-fuchsia-300" />
                광폭화 중 환경폭풍·카메라 난류 유지
              </label>
            </div>
            <p className="mt-1 text-[11px] font-bold leading-5 text-fuchsia-100">
              켜면 아래 4가지 순간에 화면 효과와 강한 카메라 반응이 붙습니다. 끄면 기존과 같습니다.
            </p>
            {form.cinematic.enabled ? (
              <div className="mt-3 overflow-hidden rounded-md border border-white/10">
                <div className="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)] gap-2 bg-black/30 px-2.5 py-1.5 text-[11px] font-black text-fuchsia-100">
                  <span>순간</span>
                  <span>화면 효과</span>
                  <span>카메라 반응</span>
                </div>
                {RAID_CINEMATIC_TRIGGERS.map(trigger => (
                  <div key={trigger} className="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 border-t border-white/10 px-2.5 py-1.5">
                    <span className="text-xs font-black text-yellow-100">{({ PATTERN:'패턴 시작', BOSS_ATTACK:'보스 공격', GROGGY:'그로기 진입', ENRAGE:'광폭화 진입' } as Record<RaidCinematicTrigger,string>)[trigger]}</span>
                    <select disabled={!editable} value={form.cinematic.event_fx[trigger]} aria-label="화면 효과"
                      onChange={e => update('cinematic', { ...form.cinematic, event_fx: { ...form.cinematic.event_fx, [trigger]: e.target.value as RaidEventFx } })}
                      className={compactSelectClass()}>
                      {RAID_EVENT_FX.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                    <select disabled={!editable} value={form.cinematic.camera_reactions[trigger]} aria-label="카메라 반응"
                      onChange={e => update('cinematic', { ...form.cinematic, camera_reactions: { ...form.cinematic.camera_reactions, [trigger]: e.target.value as RaidCameraReaction } })}
                      className={compactSelectClass()}>
                      {RAID_CAMERA_REACTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {/* 오른쪽: 미리보기 (넓은 화면에서 스크롤해도 따라옴) */}
        <div className="min-w-0 space-y-3 self-start xl:sticky xl:top-[212px]">
          {!form.imageUrl.trim() && !form.loopVideoUrl.trim() && (
            <div className="rounded-card-md border border-warning/45 bg-warning/10 px-3 py-2 text-xs font-black text-yellow-100">
              ⚠️ 초안 저장은 가능하지만, 이미지 또는 IDLE 루프 영상 중 하나가 없으면 레이드를 시작할 수 없습니다.
            </div>
          )}
          {(form.imageUrl.trim() || form.loopVideoUrl.trim() || form.basicAttackVideoUrl.trim() || form.enrageBasicAttackVideoUrl.trim() || form.specialPatternVideoUrl.trim() || form.enrageSpecialPatternVideoUrl.trim() || form.groggyVideoUrl.trim() || form.enrageVideoUrl.trim() || form.fxPreset !== 'NONE' || form.cameraPreset !== 'LOCKED') ? (
            <BossVisualPreview
              imageUrl={form.imageUrl.trim()}
              idleVideoUrl={form.loopVideoUrl.trim()}
              basicAttackVideoUrl={form.basicAttackVideoUrl.trim()}
              enrageBasicAttackVideoUrl={form.enrageBasicAttackVideoUrl.trim()}
              specialPatternVideoUrl={form.specialPatternVideoUrl.trim()}
              enrageSpecialPatternVideoUrl={form.enrageSpecialPatternVideoUrl.trim()}
              groggyVideoUrl={form.groggyVideoUrl.trim()}
              enrageVideoUrl={form.enrageVideoUrl.trim()}
              fx={{ preset: form.fxPreset, intensity: form.fxIntensity }}
              camera={{ preset: form.cameraPreset, event_reactions: form.cameraEventReactions }}
              cinematic={form.cinematic}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-card-lg border border-dashed border-cyan-300/30 bg-black/30 px-6 text-center text-sm font-black text-amber-100">
              영상 주소나 FX·카메라를 정하면 여기에서 바로 미리 볼 수 있어요.
            </div>
          )}
        </div>
      </div>
      )}

      {!sectioned && <div className="my-5 border-t border-line" />}

      {showRules && (
      <div>
        <div className="mb-3 text-sm font-black text-yellow-100">⚙️ 전투 규칙</div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Field label="피해 계수">
            <input type="number" step="0.001" value={form.damageCoefficient} disabled={!editable} onChange={(e) => update('damageCoefficient', e.target.value)} className={inputClass(true)} />
          </Field>
          <Field label="랜덤 최저">
            <input type="number" step="0.01" value={form.varianceMin} disabled={!editable} onChange={(e) => update('varianceMin', e.target.value)} className={inputClass(true)} />
          </Field>
          <Field label="랜덤 최고">
            <input type="number" step="0.01" value={form.varianceMax} disabled={!editable} onChange={(e) => update('varianceMax', e.target.value)} className={inputClass(true)} />
          </Field>
          <Field label="Crit 배율">
            <input type="number" step="0.1" value={form.critMultiplier} disabled={!editable} onChange={(e) => update('critMultiplier', e.target.value)} className={inputClass(true)} />
          </Field>
          <Field label="초당 터치 제한">
            <input type="number" min={1} max={30} step={1} value={form.tapRateLimit} disabled={!editable} onChange={(e) => update('tapRateLimit', e.target.value)} className={inputClass(true)} />
          </Field>
          <Field label="토벌 기본 보상(GOLD)" hint="성공 시 기본 지급액">
            <input type="number" min={0} max={10000000} step={10} value={form.baseRewardGold} disabled={!editable} onChange={(e) => update('baseRewardGold', e.target.value)} className={inputClass(true)} />
          </Field>
          <label className="flex items-center gap-2 rounded-card-md border border-yellow-300/20 bg-yellow-500/5 px-3 py-2">
            <input type="checkbox" checked={form.rewardsEnabled} disabled={!editable} onChange={(e) => update('rewardsEnabled', e.target.checked)} className="h-4 w-4 accent-yellow-300" />
            <span className="text-xs font-black text-yellow-100">보상 지급 사용 <span className="font-bold text-cyan-100">(베타 테스트는 OFF)</span></span>
          </label>
        </div>
        <p className="mt-3 text-xs font-bold text-cyan-100">
          기본 피해 = 공명력 × 피해 계수 × 랜덤 보정 × 부위 배율. 치명타는 현재 기본 ×{form.critMultiplier || '2.0'}.
        </p>
      </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {showRules && (
          <>
        <label className="flex items-center gap-2 rounded-card-md border border-emerald-300/30 bg-emerald-500/10 px-3 py-2">
          <input type="checkbox" checked={form.elementDamageEnabled} disabled={!editable}
            onChange={(e) => update('elementDamageEnabled', e.target.checked)} className="h-4 w-4 accent-emerald-400" />
          <span className="text-xs font-black text-emerald-100">장착 편린 속성 보정 사용 (V1)</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.includeTestAccounts}
            disabled={!editable}
            onChange={(e) => update('includeTestAccounts', e.target.checked)}
            className="h-4 w-4 accent-cyan-400"
          />
          <span className="text-xs font-black text-cyan-100">TEST 학생도 시작 스냅샷에 포함</span>
        </label>
          </>
        )}
        {sectioned && (
          <span className="text-xs font-bold text-amber-100">
            💾 기본 정보 · 연출 · 전투 규칙 탭의 변경을 한 번에 저장합니다.
          </span>
        )}

        {editable ? (
          <button type="button" onClick={onSave} disabled={saving} className="btn-primary min-w-28 disabled:opacity-50">
            {saving ? '저장 중...' : creating ? '초안 생성' : '설정 저장'}
          </button>
        ) : (
          <span className="rounded-pill border border-cyan-400/35 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100">
            전투 시작 후 설정 고정
          </span>
        )}
      </div>
        </>
      )}
    </section>
  );
}


function BossPresetPicker({
  value,
  onChange,
  disabled,
  creating,
}: {
  value: RaidBossPresetKey | null;
  onChange: (presetKey: RaidBossPresetKey | null) => void;
  disabled: boolean;
  creating: boolean;
}) {
  const selected = getRaidBossPreset(value);

  return (
    <div className="mb-5 rounded-card-lg border border-gold/35 bg-gold/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.15em] text-yellow-100">INITIAL BOSS PRESET · A-TYPE</div>
          <h3 className="mt-1 text-lg font-black text-white">⚡ 초기 4보스 전투 프리셋</h3>
          <p className="mt-1 max-w-4xl text-sm font-bold leading-6 text-cyan-100">
            보스를 선택하면 이름·속성·소개가 즉시 채워지고, {creating ? '초안 생성 시' : '설정 저장 시'} 공명방벽·기본 공격·공통 기믹·특수 패턴 초안까지 함께 저장됩니다.
          </p>
        </div>
        {value ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="rounded-card-md border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100 disabled:opacity-40"
          >
            프리셋 해제
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {RAID_BOSS_PRESETS.map((preset) => {
          const active = preset.key === value;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onChange(preset.key)}
              disabled={disabled}
              className={cn(
                'rounded-card-md border p-3 text-left transition disabled:opacity-40',
                active
                  ? 'border-gold/70 bg-gold/15 shadow-[0_0_20px_rgba(251,191,36,0.08)]'
                  : 'border-cyan-300/20 bg-bg-deep hover:border-cyan-300/50',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-yellow-100">RAID {preset.raidNo}</span>
                <span className="text-xs font-black text-cyan-100">{elementLabel(preset.element)}</span>
              </div>
              <div className="mt-2 text-sm font-black leading-5 text-white">{preset.bossName}</div>
              <div className="mt-2 text-xs font-bold leading-5 text-cyan-100">특수 {preset.specialPatterns.length}종 · 총 패턴 {preset.patterns.length}개</div>
            </button>
          );
        })}
      </div>

      {selected ? (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          <div className="rounded-card-md border border-cyan-300/20 bg-black/20 p-3">
            <div className="text-sm font-black text-yellow-100">⚔️ 전투 구성</div>
            <div className="mt-2 text-sm font-bold leading-6 text-white">
              공통: {selected.commonMechanics.join(' · ')}
            </div>
            <div className="mt-1 text-sm font-bold leading-6 text-amber-100">
              특수: {selected.specialPatterns.join(' · ')}
            </div>
            <div className="mt-2 text-xs font-bold leading-5 text-cyan-100">
              기본 공격: {selected.combat.boss_attack_name} · {selected.combat.boss_attack_interval_seconds}초 간격 · 방벽 {(selected.combat.boss_attack_barrier_ratio * 100).toFixed(1)}%
            </div>
          </div>
          <div className="rounded-card-md border border-fuchsia-300/20 bg-black/20 p-3">
            <div className="text-sm font-black text-fuchsia-100">🎬 그래픽 가이드</div>
            <div className="mt-2 text-xs font-bold leading-5 text-white">환경 · {selected.environment}</div>
            <div className="mt-1 text-xs font-bold leading-5 text-cyan-100">카메라 · {selected.camera}</div>
            <div className="mt-1 text-xs font-bold leading-5 text-amber-100">Idle · {selected.idleLoop}</div>
          </div>
          {!creating ? (
            <div className="xl:col-span-2 rounded-card-md border border-red-300/25 bg-red-500/5 px-3 py-2 text-xs font-black leading-5 text-red-100">
              ⚠️ 기존 DRAFT에 이 프리셋을 저장하면 현재 V1.5 전투 기믹과 패턴 목록이 프리셋 초안으로 교체됩니다. 이미지·루프 영상·HP·보상값은 자동으로 덮어쓰지 않습니다.
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function BossVisualPreview({
  imageUrl,
  idleVideoUrl,
  basicAttackVideoUrl,
  enrageBasicAttackVideoUrl,
  specialPatternVideoUrl,
  enrageSpecialPatternVideoUrl,
  groggyVideoUrl,
  enrageVideoUrl,
  fx,
  camera,
  cinematic,
}: {
  imageUrl: string;
  idleVideoUrl: string;
  basicAttackVideoUrl: string;
  enrageBasicAttackVideoUrl: string;
  specialPatternVideoUrl: string;
  enrageSpecialPatternVideoUrl: string;
  groggyVideoUrl: string;
  enrageVideoUrl: string;
  fx: RaidVisualFxConfig;
  camera: RaidVisualCameraConfig;
  cinematic: RaidCinematicConfig;
}) {
  type PreviewSlot = 'IDLE' | 'BASIC_ATTACK' | 'ENRAGE_BASIC_ATTACK' | 'SPECIAL_PATTERN' | 'ENRAGE_SPECIAL_PATTERN' | 'GROGGY' | 'ENRAGE';
  const [slot, setSlot] = useState<PreviewSlot>('IDLE');
  const [patternRunId, setPatternRunId] = useState(0);
  const [bossAttackSeq, setBossAttackSeq] = useState(0);
  const [previewGroggy, setPreviewGroggy] = useState(false);
  const [previewEnrage, setPreviewEnrage] = useState(false);
  const previewCameraEvents: RaidCameraEvents = { patternRunId, bossAttackSeq, groggyActive: previewGroggy, enrageActive: previewEnrage };
  const slotUrls: Record<PreviewSlot, string> = {
    IDLE: idleVideoUrl,
    BASIC_ATTACK: basicAttackVideoUrl,
    ENRAGE_BASIC_ATTACK: enrageBasicAttackVideoUrl,
    SPECIAL_PATTERN: specialPatternVideoUrl,
    ENRAGE_SPECIAL_PATTERN: enrageSpecialPatternVideoUrl,
    GROGGY: groggyVideoUrl,
    ENRAGE: enrageVideoUrl,
  };
  const slotLabels: Record<PreviewSlot, string> = {
    IDLE: 'IDLE',
    BASIC_ATTACK: '일반공격',
    ENRAGE_BASIC_ATTACK: '광폭 일반공격',
    SPECIAL_PATTERN: '특수패턴',
    ENRAGE_SPECIAL_PATTERN: '광폭 특수패턴',
    GROGGY: '그로기',
    ENRAGE: '광폭화',
  };
  const selectedUrl = slotUrls[slot];

  return (
    // RAID_ADMIN_LAYOUT_VISUAL_20261023: 영상 슬롯 → 영상 → 이벤트 테스트 순서로 배치
    <div>
      <div className="flex flex-wrap gap-2 rounded-card-md border border-cyan-400/25 bg-[#07111f]/95 px-3 py-2.5">
        {(['IDLE', 'BASIC_ATTACK', 'ENRAGE_BASIC_ATTACK', 'SPECIAL_PATTERN', 'ENRAGE_SPECIAL_PATTERN', 'GROGGY', 'ENRAGE'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setSlot(value)}
            className={cn(
              'rounded-card-md border px-3 py-2 text-[11px] font-black transition',
              slot === value
                ? 'border-gold/65 bg-gold/15 text-yellow-100'
                : 'border-cyan-300/25 bg-bg-deep text-cyan-100 hover:border-cyan-300/55',
            )}
          >
            {slotLabels[value]} {slotUrls[value] ? '●' : '○'}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] font-bold text-cyan-100/75">● URL 설정됨 · ○ 미설정</span>
      </div>

      {selectedUrl || imageUrl ? (
        <BossMediaPreview
          key={`${slot}:${selectedUrl}:${imageUrl}`}
          imageUrl={imageUrl}
          videoUrl={selectedUrl}
          fx={fx}
          camera={camera}
          cameraEvents={previewCameraEvents}
          cinematic={cinematic}
        />
      ) : (
        <div className="relative mt-3 flex aspect-video items-center justify-center overflow-hidden rounded-card-lg border border-cyan-400/30 bg-black/55 px-6 text-center text-xs font-black text-amber-100">
          <span className="relative z-10">{slot} 슬롯에 영상이 없고 fallback 이미지도 없습니다.</span>
          {!cinematic.enabled && <RaidFxCanvas fx={fx} />}
          <RaidCinematicFxLayer fx={fx} cinematic={cinematic} pulse={null} enrageActive={previewEnrage} />
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2 rounded-card-md border border-cyan-400/20 bg-[#07111f]/95 px-3 py-2.5">
        <span className="mr-2 self-center text-[10px] font-black text-cyan-100">이벤트 테스트</span>
        <button type="button" onClick={() => setPatternRunId((id) => id + 1)} className="rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50">패턴 시작</button>
        <button type="button" onClick={() => setBossAttackSeq((seq) => seq + 1)} className="rounded border border-cyan-300/30 px-2 py-1 text-[11px] text-cyan-50">보스 공격 적중</button>
        <button type="button" onClick={() => setPreviewGroggy((value) => !value)} className={cn('rounded border px-2 py-1 text-[11px]', previewGroggy ? 'border-yellow-300 text-yellow-200' : 'border-cyan-300/30 text-cyan-50')}>Groggy {previewGroggy ? 'ON' : 'OFF'}</button>
        <button type="button" onClick={() => setPreviewEnrage((value) => !value)} className={cn('rounded border px-2 py-1 text-[11px]', previewEnrage ? 'border-yellow-300 text-yellow-200' : 'border-cyan-300/30 text-cyan-50')}>Enrage {previewEnrage ? 'ON' : 'OFF'}</button>
      </div>
    </div>
  );
}

function BossMediaPreview({
  imageUrl,
  videoUrl,
  fx,
  camera,
  cameraEvents,
  cinematic,
}: {
  imageUrl: string;
  videoUrl: string;
  fx: RaidVisualFxConfig;
  camera: RaidVisualCameraConfig;
  cameraEvents: RaidCameraEvents;
  cinematic: RaidCinematicConfig;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pulse = useRaidCinematicEvents(cameraEvents, cinematic.enabled);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    videoUrl ? 'loading' : 'idle',
  );
  const [diagnostic, setDiagnostic] = useState<string | null>(null);

  const animatedImage =
    Boolean(videoUrl) &&
    /\.(?:webp|gif|apng)(?:$|[?#])/i.test(videoUrl);

  useEffect(() => {
    setState(videoUrl && !animatedImage ? 'loading' : 'idle');
    setDiagnostic(null);

    if (!videoUrl || animatedImage) return;

    const timer = window.setTimeout(() => {
      setState((current) => {
        if (current === 'ready' || current === 'error') return current;
        setDiagnostic(
          '영상 데이터를 불러오지 못했습니다. URL이 직접 MP4/WebM 파일을 가리키는지, 서버가 브라우저 재생을 허용하는지 확인해주세요.',
        );
        return 'error';
      });
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [animatedImage, videoUrl]);

  const retry = async () => {
    const video = videoRef.current;
    if (!video) return;

    setState('loading');
    setDiagnostic(null);
    try {
      video.load();
      await video.play();
    } catch {
      setState('error');
      setDiagnostic(
        '자동 재생에 실패했습니다. 아래 재생 컨트롤을 이용하거나 영상 파일 형식/코덱을 확인해주세요.',
      );
    }
  };

  const onVideoError = () => {
    const error = videoRef.current?.error;
    const message =
      error?.code === 4
        ? '이 브라우저가 영상 형식 또는 코덱을 지원하지 않습니다.'
        : error?.code === 2
          ? '영상 파일을 네트워크에서 불러오지 못했습니다.'
          : '영상 미리보기를 재생하지 못했습니다.';

    setState('error');
    setDiagnostic(
      `${message} 직접 MP4(H.264) 또는 WebM 주소인지 확인해주세요.`,
    );
  };

  return (
    <div className="mt-2 overflow-hidden rounded-card-lg border border-cyan-400/30 bg-black/55">
      <div className="relative aspect-video w-full overflow-hidden">
        <RaidCameraRig camera={camera} events={cameraEvents} cinematic={cinematic} pulse={pulse}>
          <div className="absolute inset-0">
        {videoUrl ? (
          animatedImage ? (
            <img
              src={videoUrl}
              alt="레이드 보스 애니메이션 미리보기"
              className="h-full w-full object-contain"
              onError={() => {
                setState('error');
                setDiagnostic('이미지 형식 미디어를 불러오지 못했습니다.');
              }}
            />
          ) : (
            <>
              <video
                ref={videoRef}
                key={videoUrl}
                src={videoUrl}
                poster={imageUrl || undefined}
                muted
                loop
                autoPlay
                playsInline
                controls
                preload="metadata"
                className="h-full w-full bg-black object-contain"
                onLoadStart={() => setState('loading')}
                onLoadedData={() => {
                  setState('ready');
                  setDiagnostic(null);
                }}
                onCanPlay={() => {
                  setState('ready');
                  setDiagnostic(null);
                }}
                onError={onVideoError}
              />

              {state === 'loading' && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45">
                  <div className="rounded-card-md border border-cyan-300/35 bg-[#07111f]/90 px-4 py-2 text-xs font-black text-cyan-100">
                    영상 미리보기 불러오는 중...
                  </div>
                </div>
              )}

              {state === 'error' && imageUrl && (
                <img
                  src={imageUrl}
                  alt="영상 재생 실패 시 보스 이미지"
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-70"
                />
              )}
            </>
          )
        ) : (
          <img
            src={imageUrl}
            alt="레이드 보스 미리보기"
            className="h-full w-full object-contain"
          />
        )}
          </div>
        </RaidCameraRig>
        {!cinematic.enabled && <RaidFxCanvas fx={fx} />}
        <RaidCinematicFxLayer fx={fx} cinematic={cinematic} pulse={pulse} enrageActive={cameraEvents.enrageActive===true} />
      </div>

      <div className="flex flex-col gap-2 border-t border-cyan-400/20 bg-[#07111f]/95 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.15em] text-cyan-100">
            MEDIA PREVIEW
          </div>
          <div className="mt-0.5 break-all text-[11px] font-bold text-yellow-100">
            {animatedImage
              ? 'Animated WebP/GIF는 이미지 방식으로 미리봅니다.'
              : state === 'ready'
                ? '영상 재생 가능 · 실제 전투 화면에서도 같은 브라우저 재생 방식을 사용합니다.'
                : diagnostic ??
                  'MP4(H.264) 또는 WebM 직접 파일 URL을 권장합니다.'}
          </div>
        </div>

        {videoUrl && !animatedImage && (
          <button
            type="button"
            onClick={() => void retry()}
            className="flex-none rounded-card-md border border-cyan-300/40 bg-cyan-500/10 px-3 py-2 text-[11px] font-black text-cyan-100 hover:bg-cyan-500/20"
          >
            ▶ 다시 재생
          </button>
        )}
      </div>
    </div>
  );
}

function RaidStateControl({
  detail,
  busyAction,
  onOpenLobby,
  onStart,
  onPause,
  onResume,
  onEnd,
  onClone,
  onE3TestPreset,
  onChatToggle,
  inline = false,
}: {
  detail: TeacherRaidDetail;
  busyAction: string | null;
  onOpenLobby: () => void;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onClone: () => void;
  onE3TestPreset: () => void;
  onChatToggle: () => void;
  /** RAID_ADMIN_LAYOUT_TABS_20261023: 고정 상단바 안에 버튼만 넣을 때 사용 */
  inline?: boolean;
}) {
  const status = detail.raid.status;
  const actions = (
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/teacher/raid/${detail.raid.id}/broadcast`}
            target="_blank"
            rel="noreferrer"
            className="rounded-card-md border border-fuchsia-300/45 bg-fuchsia-500/10 px-3 py-2 text-xs font-black text-fuchsia-100 hover:bg-fuchsia-500/20"
          >
            📺 화면 중계
          </Link>
          <ActionButton onClick={onClone} disabled={busyAction !== null} tone="gold">
            ♻️ 재생성
          </ActionButton>
          {status === 'DRAFT' && (
            <ActionButton onClick={onE3TestPreset} disabled={busyAction !== null} tone="cyan">
              🧪 E3 테스트
            </ActionButton>
          )}
          {status === 'DRAFT' && (
            <ActionButton onClick={onOpenLobby} disabled={busyAction !== null} tone="cyan">
              🚪 로비 개방
            </ActionButton>
          )}
          {status === 'LOBBY_OPEN' && (
            <ActionButton onClick={onStart} disabled={busyAction !== null} tone="gold">
              ⚔️ 레이드 시작
            </ActionButton>
          )}
          {status === 'ACTIVE' && (
            <ActionButton onClick={onPause} disabled={busyAction !== null} tone="cyan">
              ⏸ 일시정지
            </ActionButton>
          )}
          {status === 'PAUSED' && (
            <ActionButton onClick={onResume} disabled={busyAction !== null} tone="gold">
              ▶ 재개
            </ActionButton>
          )}
          {(status === 'ACTIVE' || status === 'PAUSED') && (
            <ActionButton onClick={onEnd} disabled={busyAction !== null} tone="danger">
              ■ 강제 종료
            </ActionButton>
          )}
          {['LOBBY_OPEN', 'ACTIVE', 'PAUSED'].includes(status) && (
            <ActionButton onClick={onChatToggle} disabled={busyAction !== null} tone={detail.raid.chat_enabled ? 'cyan' : 'gold'}>
              {detail.raid.chat_enabled ? '💬 채팅 ON' : '🔒 채팅 OFF'}
            </ActionButton>
          )}
        </div>
  );

  if (inline) return actions;

  return (
    <section className="z-20 rounded-card-lg border border-cyan-300/25 bg-bg-card/95 px-4 py-3 shadow-[0_10px_28px_rgba(0,0,0,0.18)] xl:sticky xl:top-3 xl:backdrop-blur">
      <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex-none">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">STATE CONTROL</div>
            <div className="mt-0.5 text-sm font-black text-white">레이드 상태 제어</div>
          </div>
          <StatusBadge status={status} />
          <div className="hidden h-7 w-px bg-cyan-300/15 lg:block" />
          <p className="min-w-0 text-[11px] font-bold text-amber-100">
            시작 시 학생 전투 스탯이 스냅샷으로 고정됩니다.
          </p>
        </div>

        {actions}
      </div>
    </section>
  );
}

// RAID_ADMIN_LAYOUT_TABS_20261023: 고정 상단바의 한 줄 요약 (보스 HP · 참여 학생)
function RaidQuickStats({
  hpRatio,
  attackParticipants,
  participants,
}: {
  hpRatio: number | null;
  attackParticipants: number | null;
  participants: number | null;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-card-md border border-line bg-bg-deep px-2.5 py-2 text-xs font-black">
      <span className="text-red-100">HP {hpRatio === null ? '—' : `${formatPercent(hpRatio * 100)}%`}</span>
      <span className="text-cyan-200">·</span>
      <span className="text-cyan-100">
        참여 {attackParticipants === null ? (participants ?? '—') : `${attackParticipants} / ${participants ?? 0}`}
      </span>
    </div>
  );
}

// RAID_ADMIN_LAYOUT_TABS_20261023: 페이지 탭. 탭마다 저장 버튼 범위가 정해져 있다.
function RaidPageTabs({
  active,
  onChange,
  creating,
  patternCount,
  liveRunning,
}: {
  active: RaidPageTab;
  onChange: (tab: RaidPageTab) => void;
  creating: boolean;
  patternCount: number | null;
  liveRunning: boolean;
}) {
  const tabs: Array<{ key: RaidPageTab; label: string; group: 'editor' | 'config' | 'live' }> = [
    { key: 'BASIC', label: '📋 기본 정보', group: 'editor' },
    { key: 'VISUAL', label: '🎬 연출', group: 'editor' },
    { key: 'RULES', label: '⚙️ 전투 규칙·보상', group: 'editor' },
    { key: 'COMBAT', label: '🛡 전투 기믹', group: 'config' },
    { key: 'PATTERNS', label: `🧩 패턴${patternCount === null ? '' : ` ${patternCount}`}`, group: 'config' },
    { key: 'AUDIO', label: '🔊 오디오', group: 'config' },
    { key: 'LOOT', label: '🎁 전리품', group: 'config' },
    { key: 'LIVE', label: '📡 실시간 운영', group: 'live' },
  ];
  const visible = creating ? tabs.filter((tab) => tab.group === 'editor') : tabs;

  return (
    <nav className="flex gap-1 overflow-x-auto rounded-card-lg border border-line bg-bg-card p-1" aria-label="레이드 설정 탭">
      {visible.map((tab, index) => {
        const previous = visible[index - 1];
        const groupStart = previous && previous.group !== tab.group;
        return (
          <div key={tab.key} className="flex flex-none items-center">
            {groupStart ? <span className="mx-1 h-5 w-px bg-cyan-300/25" aria-hidden="true" /> : null}
            <button
              type="button"
              onClick={() => onChange(tab.key)}
              aria-current={active === tab.key ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap rounded-card-md border px-3 py-2 text-xs font-black transition',
                active === tab.key
                  ? 'border-gold/60 bg-gold/15 text-yellow-100'
                  : 'border-transparent text-cyan-100 hover:border-cyan-300/40 hover:bg-cyan-500/10',
              )}
            >
              {tab.label}
              {tab.key === 'LIVE' && liveRunning ? <span className="ml-1.5 text-emerald-300">●</span> : null}
            </button>
          </div>
        );
      })}
      {creating ? (
        <span className="ml-auto flex-none self-center pr-2 text-[11px] font-bold text-amber-100">
          기믹·패턴·오디오·전리품은 초안 생성 후 열립니다
        </span>
      ) : null}
    </nav>
  );
}

function LivePanel({
  data,
  loading,
  error,
}: {
  data: TeacherRaidLiveDashboard | undefined;
  loading: boolean;
  error: string | null;
}) {
  const [participantsExpanded, setParticipantsExpanded] = useState(false);

  if (loading) {
    return (
      <section className="flex min-h-28 items-center justify-center rounded-card-lg border border-line bg-bg-card">
        <LoadingSpinner />
      </section>
    );
  }
  if (error) return <ErrorPanel title="실시간 현황을 불러오지 못했습니다" message={error} />;
  if (!data) return null;

  const summary = data.summary;
  const hpPercent = Number(data.raid.hp_ratio ?? 0) * 100;

  return (
    <section className="space-y-3 rounded-card-lg border border-line bg-bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.17em] text-cyan-200">LIVE CONTROL</div>
            <h2 className="mt-0.5 font-display text-lg text-white">실시간 현황</h2>
          </div>
          <span className="pb-0.5 text-[11px] font-bold text-amber-100">전투 핵심 지표는 항상 표시되고, 참가자 표는 필요할 때만 펼칩니다.</span>
        </div>
        <button
          type="button"
          onClick={() => setParticipantsExpanded((current) => !current)}
          className="rounded-card-md border border-cyan-300/35 bg-cyan-500/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-500/20"
          aria-expanded={participantsExpanded}
        >
          {participantsExpanded ? '▲ 참가자 상세 접기' : `▼ 참가자 상세 펼치기 (${summary.participant_count})`}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="보스 HP" value={`${formatPercent(hpPercent)}%`} accent="red" />
        <MetricCard label="참여 학생" value={`${summary.attack_participant_count} / ${summary.participant_count}`} accent="cyan" />
        <MetricCard label="총 누적 피해" value={formatNumber(summary.total_damage)} accent="gold" />
        <MetricCard label="유효 터치" value={formatNumber(summary.accepted_taps)} accent="white" />
      </div>

      {participantsExpanded ? (
        <div className="overflow-x-auto rounded-card-md border border-line">
          <table className="w-full min-w-[760px] text-left">
            <thead className="bg-black/25">
              <tr className="text-[11px] font-black text-cyan-100">
                <th className="px-3 py-2.5">학생</th>
                <th className="px-3 py-2.5">길드</th>
                <th className="px-3 py-2.5 text-right">공명력</th>
                <th className="px-3 py-2.5 text-right">Crit</th>
                <th className="px-3 py-2.5 text-right">누적 피해</th>
                <th className="px-3 py-2.5 text-right">유효 터치</th>
                <th className="px-3 py-2.5">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.students.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm font-black text-amber-100">아직 학생 스냅샷이 없습니다.</td></tr>
              ) : (
                data.students.map((student) => (
                  <tr key={student.student_id} className="text-xs font-bold text-white">
                    <td className="px-3 py-2.5">
                      <div className="font-black">{student.brand_name || student.name}</div>
                      {student.brand_name && <div className="mt-0.5 text-[10px] text-amber-100">{student.name}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-yellow-100">{student.guild_name || '—'}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-cyan-100">{formatNumber(student.raid_power)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-yellow-100">{formatCritBp(student.final_crit_bp)}</td>
                    <td className="px-3 py-2.5 text-right font-mono font-black text-white">{formatNumber(student.total_damage)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-cyan-100">{formatNumber(student.accepted_taps)}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        'rounded-pill border px-2 py-1 text-[10px] font-black',
                        student.attack_blocked
                          ? 'border-red-400/50 bg-red-500/15 text-red-100'
                          : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100',
                      )}>
                        {student.attack_blocked ? '공격 차단' : student.accepted_taps > 0 ? '참여 중' : '대기'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: 'red' | 'cyan' | 'gold' | 'white';
}) {
  const tone = {
    red: 'border-red-400/40 bg-red-500/10 text-red-100',
    cyan: 'border-cyan-400/40 bg-cyan-500/10 text-cyan-100',
    gold: 'border-yellow-400/40 bg-yellow-500/10 text-yellow-100',
    white: 'border-white/25 bg-white/5 text-white',
  }[accent];
  return (
    <div className={cn('rounded-card-md border p-3', tone)}>
      <div className="text-[11px] font-black">{label}</div>
      <div className="mt-1 font-mono text-lg font-black">{value}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-black text-yellow-100">
        <span>{label}</span>
        {hint && <span className="text-[10px] font-bold text-cyan-100">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'rounded-pill border px-3 py-1.5 text-xs font-black transition disabled:opacity-50',
        checked
          ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
          : 'border-red-400/45 bg-red-500/10 text-red-100',
      )}
    >
      {label}
    </button>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone: 'cyan' | 'gold' | 'danger';
}) {
  const cls = {
    cyan: 'border-cyan-400/45 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/20',
    gold: 'border-yellow-400/50 bg-yellow-500/12 text-yellow-100 hover:bg-yellow-500/20',
    danger: 'border-red-400/55 bg-red-500/12 text-red-100 hover:bg-red-500/20',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('rounded-card-md border px-4 py-2.5 text-xs font-black transition disabled:opacity-50', cls)}
    >
      {children}
    </button>
  );
}

function StatusBadge({ status }: { status: RaidStatus }) {
  const meta: Record<RaidStatus, { label: string; cls: string }> = {
    DRAFT: { label: '초안', cls: 'border-white/25 bg-white/5 text-white' },
    LOBBY_OPEN: { label: '로비 개방', cls: 'border-cyan-400/50 bg-cyan-500/12 text-cyan-100' },
    ACTIVE: { label: '진행 중', cls: 'border-emerald-400/50 bg-emerald-500/12 text-emerald-100' },
    PAUSED: { label: '일시정지', cls: 'border-yellow-400/50 bg-yellow-500/12 text-yellow-100' },
    COMPLETED: { label: '토벌 완료', cls: 'border-violet-400/50 bg-violet-500/12 text-violet-100' },
    FAILED: { label: '종료', cls: 'border-red-400/50 bg-red-500/12 text-red-100' },
    ARCHIVED: { label: '보관', cls: 'border-amber-400/45 bg-amber-500/10 text-amber-100' },
  };
  const item = meta[status];
  return <span className={cn('whitespace-nowrap rounded-pill border px-2 py-1 text-[10px] font-black', item.cls)}>{item.label}</span>;
}

function ErrorPanel({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-card-lg border border-red-400/50 bg-red-950/45 p-6 text-center">
      <div className="text-3xl">⚠️</div>
      <h2 className="mt-2 font-display text-lg text-white">{title}</h2>
      <p className="mt-2 break-all text-sm font-bold text-red-100">{message}</p>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="rounded-card-lg border border-dashed border-cyan-400/30 bg-bg-card p-12 text-center">
      <div className="text-5xl">👾</div>
      <h2 className="mt-3 font-display text-lg text-white">레이드를 선택하거나 새로 만들어주세요</h2>
    </div>
  );
}

// RAID_ADMIN_LAYOUT_VISUAL_20261023: 연출 탭의 한 줄짜리 URL 입력 (라벨 | 입력칸 | 설정 여부 표시)
function VisualUrlRow({
  label,
  hint,
  value,
  baseUrl,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  baseUrl?: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const filled = value.trim().length > 0;
  const inputValue = baseUrl ? raidVideoInputValue(value, baseUrl) : value;
  return (
    <label className="grid items-center gap-1.5 sm:grid-cols-[132px_minmax(0,1fr)] sm:gap-2">
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-xs font-black text-yellow-100">
          <span className={filled ? 'text-emerald-300' : 'text-amber-100'} aria-hidden="true">{filled ? '●' : '○'}</span>
          {label}
        </span>
        <span className="block pl-4 text-[10px] font-bold text-cyan-100">{hint}</span>
      </span>
      <span className="min-w-0">
        {baseUrl ? (
          <span
            className="mb-1 block min-w-0 truncate text-[10px] font-bold text-cyan-200/80"
            title={baseUrl}
          >
            {baseUrl}
          </span>
        ) : null}
        <input
          value={inputValue}
          disabled={disabled}
          onChange={(e) => onChange(baseUrl ? resolveRaidVideoUrl(e.target.value, baseUrl) : e.target.value)}
          className={cn(inputClass(), 'py-2 text-xs')}
          placeholder={baseUrl ? '파일명 또는 하위경로만 입력' : 'https://...'}
        />
      </span>
    </label>
  );
}
function compactSelectClass() {
  return 'w-full min-w-0 rounded-md border border-line bg-bg-deep px-2 py-1.5 text-xs font-bold text-white outline-none transition focus:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60';
}

function inputClass(mono = false) {
  return cn(
    'w-full rounded-card-md border border-line bg-bg-deep px-3 py-2.5 text-sm font-bold text-white outline-none transition placeholder:text-amber-100/50 focus:border-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-60',
    mono && 'font-mono',
  );
}

function canEdit(status: RaidStatus) {
  return status === 'DRAFT' || status === 'LOBBY_OPEN';
}

function formFromDetail(detail: TeacherRaidDetail): RaidForm {
  const phase = detail.phases.find((item) => item.phase_no === 1);
  const visual = readRaidVisualV2(phase?.metadata);
  return {
    title: detail.raid.title,
    bossName: detail.raid.boss_name,
    bossDescription: detail.raid.boss_description ?? '',
    bossElement: detail.raid.boss_element,
    maxHp: String(detail.raid.max_hp),
    endsAt: toDateTimeLocal(detail.raid.ends_at),
    damageCoefficient: String(detail.raid.damage_coefficient),
    varianceMin: String(detail.raid.variance_min),
    varianceMax: String(detail.raid.variance_max),
    critMultiplier: String(detail.raid.crit_multiplier),
    tapRateLimit: String(detail.raid.tap_rate_limit_per_second),
    baseRewardGold: String(Number(detail.raid.reward_config?.base_gold ?? 300)),
    rewardsEnabled: detail.raid.reward_config?.rewards_enabled !== false,
    chatEnabled: detail.raid.chat_enabled,
    chatSlowMode: String(detail.raid.chat_slow_mode_seconds),
    includeTestAccounts: detail.raid.include_test_accounts,
    elementDamageEnabled: detail.raid.metadata?.element_damage_rules_version === 'V1',
    imageUrl: phase?.image_url ?? '',
    loopVideoUrl: phase?.loop_video_url ?? '',
    basicAttackVideoUrl: visual.media.basic_attack_video_url ?? '',
    enrageBasicAttackVideoUrl: visual.media.enrage_basic_attack_video_url ?? '',
    specialPatternVideoUrl: visual.media.special_pattern_video_url ?? '',
    enrageSpecialPatternVideoUrl: visual.media.enrage_special_pattern_video_url ?? '',
    groggyVideoUrl: visual.media.groggy_video_url ?? '',
    enrageVideoUrl: visual.media.enrage_video_url ?? '',
    fxPreset: visual.fx?.preset ?? 'NONE',
    fxIntensity: visual.fx?.intensity ?? 'MEDIUM',
    cameraPreset: visual.camera?.preset ?? 'LOCKED',
    cameraEventReactions: visual.camera?.event_reactions ?? true,
    cinematic: normalizeRaidCinematicConfig(visual.cinematic_v2),
  };
}

function toDateTimeLocal(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const pad = (num: number) => String(num).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

function elementLabel(element: RaidElement) {
  return ELEMENT_OPTIONS.find((item) => item.value === element)?.label ?? element;
}

function formatNumber(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR');
}

function formatPercent(value: number) {
  return Number(value ?? 0).toLocaleString('ko-KR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function formatCritBp(value: number) {
  return `${(Number(value ?? 0) / 100).toFixed(2)}%`;
}

function actionSuccessTitle(key: string) {
  switch (key) {
    case 'OPEN_LOBBY': return '레이드 로비 개방 완료';
    case 'PAUSE': return '레이드 일시정지';
    case 'RESUME': return '레이드 재개';
    default: return '레이드 상태 변경 완료';
  }
}
