import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { LoadingSpinner, useRpcCall } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { raidAdminRpc, type RaidEditorPayload, type RaidElement, type RaidStatus, type TeacherRaidDetail, type TeacherRaidLiveDashboard } from '@/lib/rpc/raid_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

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
  chatEnabled: boolean;
  chatSlowMode: string;
  includeTestAccounts: boolean;
  imageUrl: string;
  loopVideoUrl: string;
};

const ELEMENT_OPTIONS: Array<{ value: RaidElement; label: string }> = [
  { value: 'FIRE', label: '🔥 화' },
  { value: 'WATER', label: '💧 수' },
  { value: 'WIND', label: '💫 풍' },
  { value: 'EARTH', label: '🪨 토' },
  { value: 'LIGHT', label: '✦ 빛' },
  { value: 'DARK', label: '☾ 암' },
];

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
  chatEnabled: true,
  chatSlowMode: '2',
  includeTestAccounts: false,
  imageUrl: '',
  loopVideoUrl: '',
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
    setSelectedRaidId(null);
    setForm({ ...EMPTY_FORM });
    setFormLoadedFor(null);
  };

  const selectRaid = (raidId: number) => {
    setIsCreating(false);
    setSelectedRaidId(raidId);
    setFormLoadedFor(null);
  };

  const buildPayload = (): RaidEditorPayload | null => {
    const maxHp = Number(form.maxHp);
    const damageCoefficient = Number(form.damageCoefficient);
    const varianceMin = Number(form.varianceMin);
    const varianceMax = Number(form.varianceMax);
    const critMultiplier = Number(form.critMultiplier);
    const tapRateLimit = Number(form.tapRateLimit);
    const chatSlowMode = Number(form.chatSlowMode);

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
      reward_config: detail?.raid.reward_config ?? {},
      metadata: detail?.raid.metadata ?? {},
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
          setIsCreating(false);
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
          metadata: phase?.metadata ?? {},
        }),
        {
          successTitle: '레이드 설정 저장 완료',
          successDescription: '보스·전투 규칙·1페이즈 미디어를 저장했습니다.',
        },
      );
      if (phaseResult !== null) {
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
      '복제해서 만들 새 레이드의 제목을 입력해주세요.\n보스 설정·전투 규칙·보상·페이즈·미디어·약점부위 구조가 그대로 복제됩니다.',
      defaultTitle,
    );
    if (requestedTitle === null) return;

    const newTitle = requestedTitle.trim() || defaultTitle;

    if (!window.confirm(
      `「${detail.raid.title}」을 새 레이드 초안으로 재생성할까요?\n\n` +
      '복제되는 항목: 보스/속성/HP/전투 규칙/보상/페이즈/이미지·영상/Hit Zone\n' +
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
            <button type="button" onClick={beginCreate} className="btn-primary">
              + 새 레이드
            </button>
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
          <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
            <RaidList
              raids={raids}
              selectedId={selectedRaidId}
              creating={isCreating}
              onSelect={selectRaid}
              onCreate={beginCreate}
            />

            <div className="min-w-0 space-y-4">
              {isCreating ? (
                <RaidEditor
                  form={form}
                  setForm={setForm}
                  status="DRAFT"
                  creating
                  saving={busyAction === 'SAVE' || rpcLoading}
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
                  <div className="flex min-h-[420px] items-center justify-center rounded-card-lg border border-line bg-bg-card">
                    <LoadingSpinner size="lg" />
                  </div>
                )
              ) : (
                <>
                  <RaidEditor
                    form={form}
                    setForm={setForm}
                    status={detail.raid.status}
                    creating={false}
                    saving={busyAction === 'SAVE' || rpcLoading}
                    onSave={save}
                  />

                  <RaidStateControl
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

                  <LivePanel
                    data={liveQuery.data}
                    loading={liveQuery.isLoading}
                    error={liveQuery.isError ? (liveQuery.error instanceof Error ? liveQuery.error.message : '알 수 없는 오류') : null}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </TeacherShell>
  );
}

function RaidList({
  raids,
  selectedId,
  creating,
  onSelect,
  onCreate,
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
}) {
  return (
    <aside className="self-start rounded-card-lg border border-line bg-bg-card p-3 xl:sticky xl:top-[76px]">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-black text-cyan-100">레이드 목록</div>
          <div className="mt-0.5 text-[11px] font-bold text-amber-100">{raids.length}개 기록</div>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className={cn(
            'rounded-card-md border px-2.5 py-1.5 text-xs font-black',
            creating
              ? 'border-gold/60 bg-gold/15 text-yellow-100'
              : 'border-line bg-bg-deep text-white hover:border-gold/50',
          )}
        >
          + 생성
        </button>
      </div>

      <div className="max-h-[calc(100vh-170px)] space-y-2 overflow-y-auto pr-1">
        {raids.length === 0 && !creating ? (
          <div className="rounded-card-md border border-dashed border-cyan-400/30 bg-bg-deep p-5 text-center">
            <div className="text-3xl">👾</div>
            <div className="mt-2 text-sm font-black text-white">아직 레이드가 없습니다</div>
            <button type="button" className="mt-3 btn-primary" onClick={onCreate}>첫 레이드 만들기</button>
          </div>
        ) : null}

        {raids.map((raid) => {
          const active = !creating && raid.id === selectedId;
          const hpRatio = raid.max_hp > 0 ? raid.current_hp / raid.max_hp : 0;
          return (
            <button
              key={raid.id}
              type="button"
              onClick={() => onSelect(raid.id)}
              className={cn(
                'w-full rounded-card-md border p-3 text-left transition',
                active
                  ? 'border-gold/70 bg-gold/10 shadow-[0_0_16px_rgba(245,158,11,0.08)]'
                  : 'border-line bg-bg-deep hover:border-cyan-400/40',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-white">{raid.title}</div>
                  <div className="mt-0.5 truncate text-xs font-bold text-amber-100">
                    {elementLabel(raid.boss_element)} · {raid.boss_name}
                  </div>
                </div>
                <StatusBadge status={raid.status} />
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-yellow-200"
                  style={{ width: `${Math.max(0, Math.min(100, hpRatio * 100))}%` }}
                />
              </div>
              <div className="mt-1.5 flex justify-between text-[10px] font-black text-cyan-100">
                <span>HP {formatPercent(hpRatio * 100)}</span>
                <span>참여 {raid.participant_count}</span>
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function RaidEditor({
  form,
  setForm,
  status,
  creating,
  saving,
  onSave,
}: {
  form: RaidForm;
  setForm: React.Dispatch<React.SetStateAction<RaidForm>>;
  status: RaidStatus;
  creating: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  const editable = creating || canEdit(status);
  const update = <K extends keyof RaidForm>(key: K, value: RaidForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <section className="rounded-card-lg border border-line bg-bg-card p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">
            BOSS SETUP · PHASE 1
          </div>
          <h2 className="mt-1 font-display text-xl text-white">
            {creating ? '새 레이드 초안' : '보스 및 전투 설정'}
          </h2>
          <p className="mt-1 text-xs font-bold text-amber-100">
            V1은 1페이즈(100% → 0%)를 사용합니다. 다중 페이즈 데이터 구조는 이미 준비되어 있습니다.
          </p>
        </div>
        {!creating && <StatusBadge status={status} />}
      </div>

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

      <div className="my-5 border-t border-line" />

      <div>
        <div className="mb-3 text-sm font-black text-yellow-100">🎞️ 1페이즈 미디어</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field label="첫 프레임 이미지 URL" hint="영상 로딩 실패 시 fallback">
            <input
              value={form.imageUrl}
              disabled={!editable}
              onChange={(e) => update('imageUrl', e.target.value)}
              className={inputClass()}
              placeholder="https://..."
            />
          </Field>
          <Field label="6~7초 루프 영상 URL" hint="MP4/WebM 권장">
            <input
              value={form.loopVideoUrl}
              disabled={!editable}
              onChange={(e) => update('loopVideoUrl', e.target.value)}
              className={inputClass()}
              placeholder="https://..."
            />
          </Field>
        </div>
        {!form.imageUrl.trim() && !form.loopVideoUrl.trim() && (
          <div className="mt-3 rounded-card-md border border-warning/45 bg-warning/10 px-3 py-2 text-xs font-black text-yellow-100">
            ⚠️ 초안 저장은 가능하지만, 이미지 또는 루프 영상 중 하나가 없으면 레이드를 시작할 수 없습니다.
          </div>
        )}
        {(form.imageUrl.trim() || form.loopVideoUrl.trim()) && (
          <BossMediaPreview imageUrl={form.imageUrl.trim()} videoUrl={form.loopVideoUrl.trim()} />
        )}
      </div>

      <div className="my-5 border-t border-line" />

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
        </div>
        <p className="mt-3 text-xs font-bold text-cyan-100">
          기본 피해 = 공명력 × 피해 계수 × 랜덤 보정 × 부위 배율. 치명타는 현재 기본 ×{form.critMultiplier || '2.0'}.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
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
    </section>
  );
}

function BossMediaPreview({
  imageUrl,
  videoUrl,
}: {
  imageUrl: string;
  videoUrl: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
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
    <div className="mt-4 overflow-hidden rounded-card-lg border border-cyan-400/30 bg-black/55">
      <div className="relative aspect-video w-full overflow-hidden">
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
}) {
  const status = detail.raid.status;
  return (
    <section className="rounded-card-lg border border-line bg-bg-card p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">STATE CONTROL</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg text-white">레이드 상태 제어</h2>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-xs font-bold text-amber-100">
            시작 시 학생들의 편린·공명력·치명타·장착 편린·길드가 스냅샷으로 고정됩니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* RAID_V15_E4A_BROADCAST_BUTTON */}
          <Link
            to={`/teacher/raid/${detail.raid.id}/broadcast`}
            target="_blank"
            rel="noreferrer"
            className="rounded-card-md border border-fuchsia-300/45 bg-fuchsia-500/10 px-3 py-2 text-xs font-black text-fuchsia-100 hover:bg-fuchsia-500/20"
          >
            📺 레이드 화면 중계
          </Link>
          <ActionButton onClick={onClone} disabled={busyAction !== null} tone="gold">
            ♻️ 이 레이드 재생성
          </ActionButton>
          {status === 'DRAFT' && (
            <ActionButton onClick={onE3TestPreset} disabled={busyAction !== null} tone="cyan">
              🧪 E3 기믹 테스트
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
      </div>
    </section>
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
  if (loading) {
    return (
      <section className="flex min-h-44 items-center justify-center rounded-card-lg border border-line bg-bg-card">
        <LoadingSpinner />
      </section>
    );
  }
  if (error) return <ErrorPanel title="실시간 현황을 불러오지 못했습니다" message={error} />;
  if (!data) return null;

  const summary = data.summary;
  const hpPercent = Number(data.raid.hp_ratio ?? 0) * 100;

  return (
    <section className="space-y-4 rounded-card-lg border border-line bg-bg-card p-5">
      <div>
        <div className="text-xs font-black uppercase tracking-[0.16em] text-cyan-200">LIVE CONTROL</div>
        <h2 className="mt-1 font-display text-lg text-white">실시간 현황</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="보스 HP" value={`${formatPercent(hpPercent)}%`} accent="red" />
        <MetricCard label="참여 학생" value={`${summary.attack_participant_count} / ${summary.participant_count}`} accent="cyan" />
        <MetricCard label="총 누적 피해" value={formatNumber(summary.total_damage)} accent="gold" />
        <MetricCard label="유효 터치" value={formatNumber(summary.accepted_taps)} accent="white" />
      </div>

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
    chatEnabled: detail.raid.chat_enabled,
    chatSlowMode: String(detail.raid.chat_slow_mode_seconds),
    includeTestAccounts: detail.raid.include_test_accounts,
    imageUrl: phase?.image_url ?? '',
    loopVideoUrl: phase?.loop_video_url ?? '',
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
