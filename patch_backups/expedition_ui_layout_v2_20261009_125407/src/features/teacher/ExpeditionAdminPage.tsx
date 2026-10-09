import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { LoadingSpinner, Modal } from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import {
  expeditionAdminRpc,
  type ExpeditionAdminBoard,
  type ExpeditionAdminOperation,
  type ExpeditionAdminRewardMode,
  type ExpeditionAdminRunSummary,
  type ExpeditionAdminSettings,
  type ExpeditionAdminSite,
  type ExpeditionAdminStudent,
  type ExpeditionAdminWeek,
  type ExpeditionWorldEffectCode,
} from '@/lib/rpc/expedition_admin_rpc';
import { supabase } from '@/lib/supabase/client';
import { cn } from '@/lib/utils/cn';
import {
  EXPEDITION_ASSETS,
  getExpeditionFitGradeAsset,
  getExpeditionMasteryAsset,
  getExpeditionSiteAsset,
  getExpeditionWorldEffectAsset,
} from '@/features/character/expedition/expeditionAssets';
import { useClassroomId } from '@/stores/auth_store';

type StudentFilter = 'ALL' | 'MISSING' | 'PARTICIPATED' | 'TEST';

type PendingAction = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'default' | 'danger' | 'warning';
  run: () => Promise<void>;
};

const SPECIALTY_META = {
  RUINS: { label: '유적', icon: '🏛️' },
  NATURE: { label: '자연', icon: '🌿' },
  SANCTUARY: { label: '성소', icon: '✦' },
} as const;

const ELEMENT_META: Record<string, { label: string; icon: string }> = {
  WATER: { label: '수', icon: '💧' },
  FIRE: { label: '화', icon: '🔥' },
  WIND: { label: '풍', icon: '🌪️' },
  EARTH: { label: '지', icon: '🪨' },
  LIGHT: { label: '광', icon: '☀️' },
  DARK: { label: '암', icon: '🌑' },
};

const EFFECT_META: Record<ExpeditionWorldEffectCode, { label: string; short: string }> = {
  RESTORE: { label: '편린 복구 지원', short: '복구' },
  SHOP: { label: '상점 할인', short: '할인' },
  SUPPLY: { label: '골드 보급', short: '보급' },
  RECORD: { label: '발굴 지원', short: '발굴' },
  COSMETIC: { label: '명품관 개방', short: '명품관' },
};

const REWARD_META = {
  EXPEDITION_BOX: '원정 상자',
  GOLD: 'GOLD',
  FRAGMENT: '편린 조각',
} as const;

const PHASE_META: Record<string, { label: string; tone: string }> = {
  HIDDEN: { label: '공개 전', tone: 'border-line bg-bg-deep text-text-secondary' },
  PREVIEW: { label: '사전 공개', tone: 'border-bv/30 bg-bv/10 text-bv' },
  SAT: { label: '토요일 원정', tone: 'border-success/30 bg-success-bg text-success' },
  SUN: { label: '일요일 원정', tone: 'border-gold/30 bg-gold/10 text-gold' },
  CLOSED: { label: '원정 종료', tone: 'border-warning/30 bg-warning-bg text-warning' },
  NONE: { label: '대기', tone: 'border-line bg-bg-deep text-text-secondary' },
};

function formatKst(value: string | null | undefined, withDate = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    ...(withDate ? { month: 'numeric', day: 'numeric', weekday: 'short' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

function operationLabel(code: string) {
  if (code === 'SAT_RECONCILE') return '토요일 결과 확정';
  if (code === 'SETTLE_WORLD') return '주간 정산';
  if (code === 'SUPPLY_GRANT') return '보급 지급';
  return code;
}

function fitGradeLabel(grade: string) {
  if (grade === 'VULNERABLE') return '취약';
  if (grade === 'NORMAL') return '보통';
  if (grade === 'STABLE') return '안정';
  if (grade === 'STRONG') return '강인';
  return grade;
}

function rewardTierLabel(tier: string) {
  if (tier === 'RARE') return '희귀';
  if (tier === 'INTERMEDIATE') return '중급';
  return '일반';
}

function rewardResultLabel(reward: ExpeditionAdminRunSummary['reward']) {
  if (!reward) return '—';
  if (reward.kind === 'EXPEDITION_BOX') return `${rewardTierLabel(reward.tier)} 원정상자`;
  if (reward.kind === 'GOLD') return `GOLD +${reward.quantity.toLocaleString('ko-KR')}`;
  if (reward.kind === 'FRAGMENT') return `편린 조각 +${reward.quantity.toLocaleString('ko-KR')}`;
  return `${reward.kind} ×${reward.quantity.toLocaleString('ko-KR')}`;
}

function masteryLabel(level: number) {
  if (level >= 3) return '완전탐사';
  if (level === 2) return '개방';
  if (level === 1) return '조사됨';
  return '미개척';
}

function storyLabel(stage: number) {
  if (stage >= 4) return '돌파';
  if (stage === 3) return '활성화';
  if (stage === 2) return '발견';
  if (stage === 1) return '희미한 반응';
  return '미발견';
}

export default function ExpeditionAdminPage() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [studentFilter, setStudentFilter] = useState<StudentFilter>('ALL');
  const [search, setSearch] = useState('');

  const boardQuery = useQuery<ExpeditionAdminBoard>({
    queryKey: ['expedition-admin-board', classroomId],
    queryFn: async () => {
      if (!classroomId) throw new Error('학급 정보를 확인할 수 없습니다.');
      const result = await expeditionAdminRpc.board(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data;
    },
    enabled: classroomId !== null,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const board = boardQuery.data;
  const week = board?.week ?? null;

  const realStudents = useMemo(
    () => (week?.students ?? []).filter((student) => !student.is_test_account),
    [week?.students],
  );
  const satCount = useMemo(
    () => realStudents.filter((student) => student.sat !== null).length,
    [realStudents],
  );
  const sunCount = useMemo(
    () => realStudents.filter((student) => student.sun !== null).length,
    [realStudents],
  );
  const claimedCount = useMemo(
    () => realStudents.reduce((sum, student) => {
      const satClaimed = student.sat?.reward?.claim_status && student.sat.reward.claim_status !== 'UNCLAIMED' ? 1 : 0;
      const sunClaimed = student.sun?.reward?.claim_status && student.sun.reward.claim_status !== 'UNCLAIMED' ? 1 : 0;
      return sum + satClaimed + sunClaimed;
    }, 0),
    [realStudents],
  );
  const runCount = useMemo(
    () => realStudents.reduce((sum, student) => sum + (student.sat ? 1 : 0) + (student.sun ? 1 : 0), 0),
    [realStudents],
  );

  const filteredStudents = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ko-KR');
    return (week?.students ?? []).filter((student) => {
      if (studentFilter === 'MISSING' && student.sat && student.sun) return false;
      if (studentFilter === 'PARTICIPATED' && !student.sat && !student.sun) return false;
      if (studentFilter === 'TEST' && !student.is_test_account) return false;
      if (studentFilter !== 'TEST' && student.is_test_account) return false;
      if (!needle) return true;
      return [student.name, student.brand_name, student.sat?.site_name, student.sun?.site_name]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase('ko-KR').includes(needle));
    });
  }, [week?.students, studentFilter, search]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['expedition-admin-board'] });
  };

  const runAction = async (
    label: string,
    action: () => Promise<{ success: true; data: unknown } | { success: false; error: string; code?: string }>,
  ) => {
    if (busy) return;
    setBusy(label);
    setNotice(null);
    try {
      const result = await action();
      if (result.success === false) {
        throw Object.assign(new Error(result.error), { code: result.code });
      }
      setNotice({ tone: 'success', text: `${label} 완료` });
      await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : '작업을 완료하지 못했습니다.';
      setNotice({ tone: 'error', text: message });
      throw error;
    } finally {
      setBusy(null);
    }
  };

  const requestGenerate = () => {
    if (!classroomId || !board?.suggested_week_start) return;
    setPending({
      title: '새 원정 주차 생성',
      description: `${formatDate(board.suggested_week_start)} 시작 주차를 생성합니다. 3개 지역과 환경은 서버 규칙에 따라 확정됩니다.`,
      confirmLabel: '주차 생성',
      run: () => runAction('주차 생성', () =>
        expeditionAdminRpc.generateWeek(supabase, classroomId, board.suggested_week_start)),
    });
  };

  const requestPublish = () => {
    if (!week) return;
    const live = week.reward_mode === 'LIVE';
    setPending({
      title: live ? 'LIVE 원정 공개' : 'DRY RUN 원정 공개',
      description: live
        ? '학생 화면에 실제 원정을 공개합니다. 제출 순간 최종 보상이 확정되고 실제 보상 지급 경로가 활성화됩니다.'
        : '학생 화면에 DRY RUN 원정을 공개합니다. 결과는 기록되지만 실제 자산 지급은 발생하지 않습니다.',
      confirmLabel: live ? 'LIVE 공개' : '원정 공개',
      tone: live ? 'danger' : 'warning',
      run: () => runAction('원정 공개', () => expeditionAdminRpc.publishWeek(supabase, week.id)),
    });
  };

  const requestReconcile = () => {
    if (!week) return;
    setPending({
      title: '토요일 결과 확정',
      description: '토요일 흔적·참여자 수를 확정하고 선두 지역 하나에 일요일 환경 변화를 적용합니다. 동일 주차에서는 한 번만 처리됩니다.',
      confirmLabel: '토요일 확정',
      tone: 'warning',
      run: () => runAction('토요일 결과 확정', () => expeditionAdminRpc.reconcileSaturday(supabase, week.id)),
    });
  };

  const requestSettle = () => {
    if (!week) return;
    setPending({
      title: '주간 원정 정산',
      description: '최종 주도 지역, 누적 서사, 숙련도, 월드 효과를 확정합니다. LIVE 주차라면 이후 월드 효과가 예약됩니다.',
      confirmLabel: '주간 정산',
      tone: 'danger',
      run: () => runAction('주간 정산', () => expeditionAdminRpc.settleWeek(supabase, week.id)),
    });
  };

  const requestMode = (nextMode: ExpeditionAdminRewardMode) => {
    if (!week || week.reward_mode === nextMode) return;
    const live = nextMode === 'LIVE';
    const execute = () => runAction(
      live ? 'LIVE 모드 전환' : 'DRY RUN 모드 전환',
      () => expeditionAdminRpc.setWeekMode(supabase, week.id, nextMode),
    );
    if (live) {
      setPending({
        title: 'LIVE 모드로 전환',
        description: '이 주차를 실제 운영 주차로 표시합니다. 실제 공개는 Core·학생 UI·실제 보상이 모두 준비된 경우에만 서버에서 허용됩니다.',
        confirmLabel: 'LIVE로 전환',
        tone: 'danger',
        run: execute,
      });
    } else {
      void execute().catch(() => undefined);
    }
  };

  const requestFlagChange = (
    key: 'core_enabled' | 'student_ui_enabled' | 'scheduler_enabled' | 'reward_grant_enabled',
    value: boolean,
  ) => {
    if (!classroomId || !board) return;
    const current = board.settings;
    let next = {
      core_enabled: current.core_enabled,
      student_ui_enabled: current.student_ui_enabled,
      scheduler_enabled: current.scheduler_enabled,
      reward_grant_enabled: current.reward_grant_enabled,
    };

    next[key] = value;
    if (key === 'core_enabled' && !value) {
      next = {
        core_enabled: false,
        student_ui_enabled: false,
        scheduler_enabled: false,
        reward_grant_enabled: false,
      };
    }
    if (key === 'student_ui_enabled' && !value) next.reward_grant_enabled = false;
    if (key !== 'core_enabled' && value) next.core_enabled = true;
    if (key === 'reward_grant_enabled' && value) next.student_ui_enabled = true;

    const labels = {
      core_enabled: '원정 Core',
      student_ui_enabled: '학생 화면',
      scheduler_enabled: '자동 운영',
      reward_grant_enabled: '실제 보상',
    };
    const execute = () => runAction(
      `${labels[key]} ${value ? '활성화' : '비활성화'}`,
      () => expeditionAdminRpc.setFlags(supabase, classroomId, next),
    );

    if (value && key !== 'core_enabled') {
      setPending({
        title: `${labels[key]} 활성화`,
        description: key === 'reward_grant_enabled'
          ? '실제 GOLD·편린 조각·원정 상자 지급을 허용합니다. Release Validator가 통과하지 않으면 서버가 활성화를 거부합니다.'
          : key === 'student_ui_enabled'
            ? '학생의 편린 도감에 원정 연대기가 노출됩니다. Core는 자동으로 함께 활성화됩니다.'
            : '토요일 결과 확정·월요일 정산·보급 처리를 cron이 자동으로 수행합니다. Core는 자동으로 함께 활성화됩니다.',
        confirmLabel: '활성화',
        tone: key === 'reward_grant_enabled' ? 'danger' : 'warning',
        run: execute,
      });
    } else {
      void execute().catch(() => undefined);
    }
  };

  if (boardQuery.isLoading || !board) {
    return (
      <TeacherShell>
        <div className="flex min-h-[560px] items-center justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </TeacherShell>
    );
  }

  if (boardQuery.isError) {
    return (
      <TeacherShell>
        <div className="rounded-card-xl border border-danger/40 bg-danger-bg p-8 text-center">
          <div className="text-4xl">⚠️</div>
          <h1 className="mt-3 font-display text-xl text-white">편린 원정 통제실을 불러오지 못했습니다</h1>
          <p className="mt-2 break-all text-sm font-bold text-text-secondary">
            {boardQuery.error instanceof Error ? boardQuery.error.message : '알 수 없는 오류'}
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={() => void boardQuery.refetch()}>
            다시 불러오기
          </button>
        </div>
      </TeacherShell>
    );
  }

  const hasSatReconcile = week?.operations.some((op) => op.code === 'SAT_RECONCILE') ?? false;
  const hasSettlement = week?.operations.some((op) => op.code === 'SETTLE_WORLD') ?? false;
  const nowMs = Date.parse(board.server_now);
  const settleDue = week ? nowMs >= Date.parse(week.settle_at) : false;

  return (
    <TeacherShell>
      <div className="space-y-4 pb-12">
        <header className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="mb-1 text-xs font-black uppercase tracking-[0.2em] text-brand-primary">
              Fragment Expedition · Operations
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl tracking-tight text-brand-gradient">🧭 편린 원정 통제실</h1>
              <ReleaseBadge ok={board.release_validation.ok} />
            </div>
            <p className="mt-1 max-w-3xl text-base font-semibold text-text-secondary">
              주차 생성부터 3개 지역, 학생 참여, 일요일 변동, 정산과 월드 효과까지 한 화면에서 운영합니다.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs font-bold text-text-muted sm:block">
              15초 자동 갱신 · 서버 {formatKst(board.server_now)}
            </span>
            <button
              type="button"
              className="btn-secondary px-3 py-2 text-sm"
              disabled={boardQuery.isFetching}
              onClick={() => void boardQuery.refetch()}
            >
              {boardQuery.isFetching ? '갱신 중…' : '↻ 새로고침'}
            </button>
          </div>
        </header>

        {notice && (
          <div className={cn(
            'rounded-card-md border px-4 py-2.5 text-sm font-black',
            notice.tone === 'success'
              ? 'border-success/35 bg-success-bg text-success'
              : 'border-danger/35 bg-danger-bg text-danger',
          )}>
            {notice.tone === 'success' ? '✓ ' : '⚠ '}{notice.text}
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="min-w-0 space-y-4">
            <CommandDeck
              board={board}
              week={week}
              realStudentCount={realStudents.length}
              satCount={satCount}
              sunCount={sunCount}
              runCount={runCount}
              claimedCount={claimedCount}
              busy={busy}
              hasSatReconcile={hasSatReconcile}
              hasSettlement={hasSettlement}
              settleDue={settleDue}
              onGenerate={requestGenerate}
              onPublish={requestPublish}
              onReconcile={requestReconcile}
              onSettle={requestSettle}
            />

            <section>
              <div className="mb-2 flex items-end justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Weekly Map</div>
                  <h2 className="text-base font-black text-white">이번 주 3개 탐사지</h2>
                </div>
                {week && (
                  <div className="text-xs font-bold text-text-muted">
                    월드효과 기준 · 흔적 12 / 24 / 40
                  </div>
                )}
              </div>
              {!week ? (
                <EmptyPanel
                  icon="🗺️"
                  title="생성된 원정 주차가 없습니다"
                  description={board.suggested_week_start
                    ? `${formatDate(board.suggested_week_start)} 시작 주차를 생성하면 3개 지역이 이곳에 배치됩니다.`
                    : '활성 시즌 범위 안에 생성 가능한 주차가 없습니다.'}
                />
              ) : (
                <div className="grid gap-3 lg:grid-cols-3">
                  {week.sites.map((site) => (
                    <SiteCard key={site.id} site={site} />
                  ))}
                </div>
              )}
            </section>

            <StudentOperations
              week={week}
              students={filteredStudents}
              filter={studentFilter}
              setFilter={setStudentFilter}
              search={search}
              setSearch={setSearch}
            />
          </main>

          <aside className="space-y-4">
            <SafetyPanel
              board={board}
              week={week}
              busy={busy}
              onMode={requestMode}
              onFlag={requestFlagChange}
            />
            <WorldEffectPanel board={board} />
            <OperationLog operations={week?.operations ?? []} />
          </aside>
        </div>
      </div>

      <Modal
        isOpen={pending !== null}
        onClose={() => !busy && setPending(null)}
        title={pending?.title ?? '확인'}
        emoji={pending?.tone === 'danger' ? '⚠️' : '🧭'}
        size="sm"
      >
        {pending && (
          <div className="space-y-4">
            <p className="text-base font-semibold leading-6 text-text-secondary">{pending.description}</p>
            <div className={cn(
              'rounded-card-md border p-3 text-sm font-bold',
              pending.tone === 'danger'
                ? 'border-danger/30 bg-danger-bg text-danger'
                : pending.tone === 'warning'
                  ? 'border-warning/30 bg-warning-bg text-warning'
                  : 'border-line bg-bg-deep text-text-secondary',
            )}>
              {pending.tone === 'danger'
                ? '실제 학생 데이터와 보상에 영향을 줄 수 있는 운영 작업입니다.'
                : '서버의 현재 주차 상태를 다시 검증한 뒤 실행됩니다.'}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" disabled={Boolean(busy)} onClick={() => setPending(null)}>
                취소
              </button>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => {
                  const action = pending;
                  setPending(null);
                  void action.run().catch(() => undefined);
                }}
                className={cn(
                  'rounded-card-md px-4 py-2 text-base font-black transition-all disabled:opacity-50',
                  pending.tone === 'danger'
                    ? 'bg-danger text-white hover:brightness-110'
                    : 'bg-brand-primary text-white hover:brightness-110',
                )}
              >
                {busy ? '처리 중…' : pending.confirmLabel}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </TeacherShell>
  );
}

function CommandDeck({
  board,week,realStudentCount,satCount,sunCount,runCount,claimedCount,busy,
  hasSatReconcile,hasSettlement,settleDue,onGenerate,onPublish,onReconcile,onSettle,
}: {
  board: ExpeditionAdminBoard;
  week: ExpeditionAdminWeek | null;
  realStudentCount: number;
  satCount: number;
  sunCount: number;
  runCount: number;
  claimedCount: number;
  busy: string | null;
  hasSatReconcile: boolean;
  hasSettlement: boolean;
  settleDue: boolean;
  onGenerate: () => void;
  onPublish: () => void;
  onReconcile: () => void;
  onSettle: () => void;
}) {
  const phase = PHASE_META[week?.phase ?? 'NONE'] ?? PHASE_META.NONE;
  const nextAction = !week || week.status === 'SETTLED' || week.status === 'CANCELLED'
    ? { label: week ? '다음 주차 생성' : '새 주차 생성', onClick: onGenerate, disabled: !board.suggested_week_start }
    : week.status === 'DRAFT'
      ? { label: '원정 공개', onClick: onPublish, disabled: false }
      : week.status === 'PUBLISHED' && ['SUN','CLOSED'].includes(week.phase) && !hasSatReconcile
        ? { label: '토요일 결과 확정', onClick: onReconcile, disabled: false }
        : week.status === 'PUBLISHED' && settleDue && !hasSettlement
          ? { label: '주간 정산', onClick: onSettle, disabled: false }
          : null;

  return (
    <section className="overflow-hidden rounded-card-xl border border-line bg-bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-pill border px-2.5 py-1 text-xs font-black', phase.tone)}>
            {phase.label}
          </span>
          {week ? (
            <>
              <span className="text-base font-black text-white">
                {week.week_index}주차 · {formatDate(week.week_start_date)}
              </span>
              <span className={cn(
                'rounded-pill border px-2 py-1 text-[11px] font-black',
                week.reward_mode === 'LIVE'
                  ? 'border-danger/35 bg-danger-bg text-danger'
                  : 'border-bv/30 bg-bv/10 text-bv',
              )}>
                {week.reward_mode === 'LIVE' ? 'LIVE' : 'DRY RUN'}
              </span>
            </>
          ) : (
            <span className="text-base font-black text-white">원정 주차 대기</span>
          )}
        </div>
        {nextAction && (
          <button
            type="button"
            className="btn-primary px-4 py-2 text-sm"
            disabled={Boolean(busy) || nextAction.disabled}
            onClick={nextAction.onClick}
          >
            {busy ? '처리 중…' : nextAction.label} →
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-px bg-line/70 lg:grid-cols-4">
        <MetricCell label="토요일 참여" value={week ? `${satCount} / ${realStudentCount}` : '—'} hint="실학생 기준" />
        <MetricCell label="일요일 참여" value={week ? `${sunCount} / ${realStudentCount}` : '—'} hint="토요일 편린 재사용 불가" />
        <MetricCell label="제출 / 보상 확인" value={week ? `${runCount} / ${claimedCount}` : '—'} hint="원정 제출 / claim" />
        <MetricCell
          label="Release Health"
          value={board.release_validation.ok ? 'PASS' : 'CHECK'}
          hint={board.release_validation.ok ? '운영 검증 통과' : '우측 안전 패널 확인'}
          tone={board.release_validation.ok ? 'success' : 'warning'}
        />
      </div>

      {week && (
        <div className="grid grid-cols-5 gap-1.5 px-4 py-3">
          <TimelineStep label="공개" value={formatKst(week.publish_at)} active={['PREVIEW','SAT','SUN','CLOSED'].includes(week.phase)} />
          <TimelineStep label="토 원정" value={formatKst(week.sat_open_at)} active={['SAT','SUN','CLOSED'].includes(week.phase)} />
          <TimelineStep label="일 원정" value={formatKst(week.sun_open_at)} active={['SUN','CLOSED'].includes(week.phase)} />
          <TimelineStep label="정산" value={formatKst(week.settle_at)} active={week.status === 'SETTLED'} />
          <TimelineStep label="효과 시작" value={week.world_effect ? formatKst(week.world_effect.starts_at) : '월 06:00'} active={Boolean(week.world_effect)} />
        </div>
      )}
    </section>
  );
}

function MetricCell({
  label,value,hint,tone='default',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <div className="bg-bg-card px-4 py-3">
      <div className="text-[11px] font-black uppercase tracking-[0.13em] text-text-muted">{label}</div>
      <div className={cn(
        'mt-1 font-display text-xl tracking-tight',
        tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-white',
      )}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] font-bold text-text-muted">{hint}</div>
    </div>
  );
}

function TimelineStep({ label,value,active }: { label: string; value: string; active: boolean }) {
  return (
    <div className={cn(
      'min-w-0 rounded-card-md border px-2 py-2 text-center',
      active ? 'border-brand-primary/35 bg-brand-primary/10' : 'border-line bg-bg-deep/45',
    )}>
      <div className={cn('text-[11px] font-black', active ? 'text-brand-primary' : 'text-text-muted')}>{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-bold text-text-secondary">{value}</div>
    </div>
  );
}

function SiteCard({ site }: { site: ExpeditionAdminSite }) {
  const specialty = SPECIALTY_META[site.specialty_code];
  const satMajor = ELEMENT_META[site.saturday_major_element] ?? { label: site.saturday_major_element, icon: '◆' };
  const satMinor = ELEMENT_META[site.saturday_minor_element] ?? { label: site.saturday_minor_element, icon: '◇' };
  const sunMajor = ELEMENT_META[site.sunday_major_element] ?? { label: site.sunday_major_element, icon: '◆' };
  const tracePct = Math.min(100, Math.round((site.total_trace / 40) * 100));
  const siteAsset = getExpeditionSiteAsset(site.site_code);

  return (
    <article className={cn(
      'relative overflow-hidden rounded-card-xl border bg-bg-card',
      site.is_dominant ? 'border-gold/55 shadow-[0_0_24px_rgba(255,202,40,0.08)]' : 'border-line',
    )}>
      {siteAsset && (
        <div className="relative h-24 overflow-hidden bg-black/25">
          <img src={siteAsset} alt="" className="h-full w-full object-cover" decoding="async" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent" />
        </div>
      )}

      <div className="relative p-4">
        {site.is_dominant && (
          <div className="absolute right-3 top-3 rounded-pill border border-gold/30 bg-gold/10 px-2 py-1 text-xs font-black text-gold">
            ★ 주도 지역
          </div>
        )}

        <div className="flex items-center gap-2">
          <img src={EXPEDITION_ASSETS.specialty[site.specialty_code]} alt="" className="h-5 w-5 object-contain" decoding="async" />
          <span className="text-xs font-black text-[#F0DEC3]">{specialty.label} · SLOT {site.slot}</span>
        </div>

        <div className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black text-white">{site.site_name}</h3>
            <p className="mt-0.5 truncate text-xs font-bold text-[#F6EFE7]">{site.environment_label}</p>
          </div>

          <div className="flex flex-none items-stretch gap-1.5">
            <SiteElementBadge code={site.saturday_major_element} role="주속성" label={satMajor.label} strong />
            <SiteElementBadge code={site.saturday_minor_element} role="부속성" label={satMinor.label} />
          </div>
        </div>

        {site.sunday_event_applied && site.sunday_major_element !== site.saturday_major_element && (
          <div className="mt-2 flex justify-end">
            <SiteElementBadge code={site.sunday_major_element} role="일요일" label={sunMajor.label} changed />
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <SiteMetric label="토 흔적" value={site.saturday_trace} sub={`${site.saturday_participants}명`} />
          <SiteMetric label="일 흔적" value={site.sunday_trace} sub={`${site.sunday_participants}명`} />
          <SiteMetric label="합계" value={site.total_trace} sub={`${site.total_participants}명`} strong />
        </div>

        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between text-[13px] font-black">
            <span className="text-[#FFF7ED]">월드 효과 도달</span>
            <span className="text-white">{site.total_trace} / 40+</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-pill bg-bg-deep">
            <div className="h-full rounded-pill bg-gradient-to-r from-brand-primary to-gold" style={{ width: `${tracePct}%` }} />
            <span className="absolute left-[30%] top-0 h-full w-px bg-white/35" />
            <span className="absolute left-[60%] top-0 h-full w-px bg-white/35" />
          </div>
          <div className="mt-2 flex justify-between text-xs font-black text-[#F6EFE7]">
            <span>12 · Lv1</span><span>24 · Lv2</span><span>40 · Lv3</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="min-w-0">
            <div className="text-xs font-black text-[#FFF7ED]">예상 효과</div>
            <div className="mt-0.5 text-sm font-black text-[#D9C3FF]">{EFFECT_META[site.world_effect_code].label}</div>
          </div>

          <div className="flex flex-none items-center gap-2.5 text-right">
            <img src={getExpeditionMasteryAsset(site.mastery_level)} alt="" className="h-10 w-10 object-contain" loading="lazy" decoding="async" />
            <div>
              <div className="text-sm font-black text-[#FFD58A]">{REWARD_META[site.core_reward_code]}</div>
              <div className="mt-0.5 text-xs font-black text-[#FFF7ED]">
                {storyLabel(site.story_stage)} · {masteryLabel(site.mastery_level)}
              </div>
            </div>
          </div>
        </div>

        {site.sunday_event_applied && (
          <div className="mt-3 flex items-center gap-2 rounded-card-md border border-gold/20 bg-gold/5 px-3 py-2">
            <img src={EXPEDITION_ASSETS.sundayEnvironmentShift} alt="" className="h-9 w-9 flex-none object-contain" loading="lazy" decoding="async" />
            <div className="min-w-0">
              <div className="text-xs font-black text-gold">일요일 환경 변화</div>
              <div className="mt-0.5 truncate text-sm font-bold text-[#FFF7ED]">
                {site.sunday_event_title ?? '토요일 선두 지역 환경이 변화했습니다.'}
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function SiteElementBadge({
  code,
  role,
  label,
  strong,
  changed,
}: {
  code: string;
  role: string;
  label: string;
  strong?: boolean;
  changed?: boolean;
}) {
  const asset = EXPEDITION_ASSETS.element[code as keyof typeof EXPEDITION_ASSETS.element];
  return (
    <div className={cn(
      'min-w-[96px] rounded-card-md border px-2.5 py-2',
      changed
        ? 'border-gold/35 bg-gold/10'
        : strong
          ? 'border-bv/40 bg-bv/10'
          : 'border-line bg-bg-deep/85',
    )}>
      <div className="flex items-center justify-center gap-1.5 whitespace-nowrap">
        {asset && <img src={asset} alt="" className="h-6 w-6 flex-none object-contain" decoding="async" />}
        <span className={cn(
          'text-sm font-black',
          changed ? 'text-gold' : strong ? 'text-[#CBB6FF]' : 'text-[#FFF7ED]',
        )}>{role}: {label}</span>
      </div>
    </div>
  );
}

function SiteMetric({ label,value,sub,strong }: { label: string; value: number; sub: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-card-md border p-2.5 text-center', strong ? 'border-brand-primary/25 bg-brand-primary/10' : 'border-line bg-bg-deep/55')}>
      <div className="text-xs font-black text-[#F6EFE7]">{label}</div>
      <div className={cn('mt-0.5 text-xl font-black', strong ? 'text-brand-primary' : 'text-white')}>{value}</div>
      <div className="text-xs font-bold text-[#F6EFE7]">{sub}</div>
    </div>
  );
}

function ElementChip({ code,label,strong,changed }: { code: string; label: string; strong?: boolean; changed?: boolean }) {
  const asset = EXPEDITION_ASSETS.element[code as keyof typeof EXPEDITION_ASSETS.element];
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-pill border px-2 py-1 text-[11px] font-black',
      changed
        ? 'border-gold/30 bg-gold/10 text-gold'
        : strong
          ? 'border-bv/30 bg-bv/10 text-bv'
          : 'border-line bg-bg-deep text-[#F0DEC3]',
    )}>
      {asset && <img src={asset} alt="" className="h-3.5 w-3.5 object-contain" decoding="async" />}
      {label}
    </span>
  );
}

function StudentOperations({
  week,students,filter,setFilter,search,setSearch,
}: {
  week: ExpeditionAdminWeek | null;
  students: ExpeditionAdminStudent[];
  filter: StudentFilter;
  setFilter: (value: StudentFilter) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  return (
    <section className="overflow-hidden rounded-card-xl border border-line bg-bg-card">
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Participants</div>
          <h2 className="text-base font-black text-white">학생 참가 현황</h2>
        </div>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {([
            ['ALL','전체'],
            ['MISSING','미완료'],
            ['PARTICIPATED','참여'],
            ['TEST','TEST'],
          ] as const).map(([key,label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={cn(
                'rounded-pill border px-2.5 py-1.5 text-[11px] font-black',
                filter === key
                  ? 'border-brand-primary/40 bg-brand-primary/15 text-white'
                  : 'border-line bg-bg-deep text-text-secondary',
              )}
            >
              {label}
            </button>
          ))}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="학생 검색"
            className="w-32 rounded-pill border border-line bg-bg-deep px-3 py-1.5 text-xs font-bold text-white outline-none focus:border-brand-primary/50"
          />
        </div>
      </div>

      {!week ? (
        <div className="py-10 text-center text-sm font-bold text-text-muted">주차를 생성하면 학생 참가 현황이 표시됩니다.</div>
      ) : students.length === 0 ? (
        <div className="py-10 text-center text-sm font-bold text-text-muted">조건에 맞는 학생이 없습니다.</div>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[1080px]">
            <div className="grid grid-cols-[150px_1fr_1fr_210px_76px_110px] gap-3 border-b border-line bg-bg-deep/50 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-[#F6EFE7]">
              <span>학생</span><span>토요일</span><span>일요일</span><span>받은 보상</span><span>흔적</span><span>보상 상태</span>
            </div>
            <div className="divide-y divide-line">
              {students.map((student) => (
                <StudentRow key={student.student_id} student={student} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function StudentRow({ student }: { student: ExpeditionAdminStudent }) {
  const trace = (student.sat?.trace ?? 0) + (student.sun?.trace ?? 0);
  const claims = [student.sat?.reward?.claim_status, student.sun?.reward?.claim_status].filter(Boolean);
  const claimed = claims.filter((status) => status !== 'UNCLAIMED').length;

  return (
    <div className={cn(
      'grid grid-cols-[150px_1fr_1fr_210px_76px_110px] gap-3 px-4 py-3 text-sm',
      student.is_test_account && 'opacity-60',
    )}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-black text-white">{student.name}</span>
          {student.is_test_account && <span className="rounded-pill border border-line px-1.5 py-0.5 text-[10px] font-black text-text-muted">TEST</span>}
        </div>
        <div className="truncate text-[11px] font-bold text-text-muted">{student.brand_name ?? 'BRAND 미설정'}</div>
      </div>
      <RunCell run={student.sat} />
      <RunCell run={student.sun} />
      <StudentRewardCell sat={student.sat} sun={student.sun} />
      <div className="flex items-center">
        <span className={cn('font-display text-lg', trace > 0 ? 'text-brand-primary' : 'text-text-muted')}>{trace}</span>
      </div>
      <div className="flex items-center">
        {claims.length === 0 ? (
          <span className="text-[11px] font-bold text-text-muted">제출 없음</span>
        ) : (
          <span className={cn(
            'rounded-pill border px-2 py-1 text-[11px] font-black',
            claimed === claims.length
              ? 'border-success/30 bg-success-bg text-success'
              : 'border-warning/30 bg-warning-bg text-warning',
          )}>
            {claimed}/{claims.length} 확인
          </span>
        )}
      </div>
    </div>
  );
}

function StudentRewardCell({
  sat,
  sun,
}: {
  sat: ExpeditionAdminRunSummary | null;
  sun: ExpeditionAdminRunSummary | null;
}) {
  const rewards = [
    sat?.reward ? { day: '토', reward: sat.reward } : null,
    sun?.reward ? { day: '일', reward: sun.reward } : null,
  ].filter((item): item is { day: string; reward: NonNullable<ExpeditionAdminRunSummary['reward']> } => Boolean(item));

  if (rewards.length === 0) {
    return <div className="flex items-center text-xs font-bold text-text-muted">—</div>;
  }

  return (
    <div className="flex min-w-0 flex-col justify-center gap-1">
      {rewards.map(({ day, reward }) => (
        <div key={day} className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full border border-white/15 bg-white/5 text-[10px] font-black text-[#F6EFE7]">
            {day}
          </span>
          <span className="truncate text-[13px] font-black text-[#FFE066]">
            {rewardResultLabel(reward)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RunCell({ run }: { run: ExpeditionAdminRunSummary | null }) {
  if (!run) return <div className="flex items-center text-xs font-bold text-text-muted">— 미참여</div>;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        {getExpeditionFitGradeAsset(run.fit_grade) && (
          <img src={getExpeditionFitGradeAsset(run.fit_grade) ?? undefined} alt="" className="h-5 w-5 flex-none object-contain" loading="lazy" decoding="async" />
        )}
        <span className="truncate font-black text-text-primary">{run.site_name}</span>
        <span className="rounded-pill border border-line px-1.5 py-0.5 text-[10px] font-black text-[#F0DEC3]">
          {fitGradeLabel(run.fit_grade)} {run.fit_percent}
        </span>
      </div>
      <div className="mt-0.5 truncate text-[11px] font-bold text-text-muted">
        {run.members.join(' · ')} · 흔적 +{run.trace}
      </div>
    </div>
  );
}

function SafetyPanel({
  board,week,busy,onMode,onFlag,
}: {
  board: ExpeditionAdminBoard;
  week: ExpeditionAdminWeek | null;
  busy: string | null;
  onMode: (mode: ExpeditionAdminRewardMode) => void;
  onFlag: (
    key: 'core_enabled' | 'student_ui_enabled' | 'scheduler_enabled' | 'reward_grant_enabled',
    value: boolean,
  ) => void;
}) {
  const settings = board.settings;
  const integrity = board.release_validation.integrity;
  const catalog = board.release_validation.catalog;
  const expectedProfiles = catalog?.active_characters ?? 0;
  const profileCoverageOk = expectedProfiles > 0
    && (catalog?.active_character_profiles ?? 0) === expectedProfiles
    && (catalog?.active_element_profiles ?? 0) === expectedProfiles
    && (catalog?.invalid_specialty_profiles ?? 0) === 0
    && (catalog?.orphan_active_profiles ?? 0) === 0;

  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Launch Safety</div>
          <h2 className="mt-0.5 text-base font-black text-white">운영 안전장치</h2>
        </div>
        <ReleaseBadge ok={board.release_validation.ok} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <IntegrityMini label="편린 프로필" value={expectedProfiles > 0 ? `${catalog?.active_character_profiles ?? '—'}/${expectedProfiles}` : '—'} ok={profileCoverageOk} />
        <IntegrityMini label="탐사지/서사" value={`${catalog?.active_sites ?? '—'}/${catalog?.story_sites ?? '—'}`} ok={(catalog?.active_sites ?? 0) === 15 && (catalog?.story_sites ?? 0) === 15} />
        <IntegrityMini label="Cron" value={`${integrity?.active_lifecycle_cron_jobs ?? '—'}개`} ok={(integrity?.active_lifecycle_cron_jobs ?? 0) === 1} />
        <IntegrityMini label="권한 누수" value={`${integrity?.direct_browser_table_grants ?? '—'}건`} ok={(integrity?.direct_browser_table_grants ?? -1) === 0} />
      </div>

      {catalog?.luxury_assets_pending && (
        <div className="mt-2 rounded-card-md border border-warning/25 bg-warning-bg px-3 py-2 text-[11px] font-bold leading-4 text-warning">
          명품관 A/B/C 실물 자산은 아직 미등록입니다. 원정 본체 운영에는 영향이 없고 COSMETIC 효과에서만 상품이 비어 있습니다.
        </div>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-black text-text-muted">이번 주차 모드</span>
          {!week && <span className="text-[11px] font-bold text-text-muted">주차 생성 후 설정</span>}
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-card-md border border-line bg-bg-deep p-1">
          {(['DRY_RUN','LIVE'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={!week || week.status !== 'DRAFT' || Boolean(busy)}
              onClick={() => onMode(mode)}
              className={cn(
                'rounded-card-md px-3 py-2 text-xs font-black transition-all disabled:cursor-not-allowed disabled:opacity-40',
                week?.reward_mode === mode
                  ? mode === 'LIVE'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-bv/15 text-bv'
                  : 'text-text-muted hover:text-white',
              )}
            >
              {mode === 'LIVE' ? '● LIVE' : '◇ DRY RUN'}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-2 border-t border-line pt-3">
        <FeatureSwitch
          label="원정 Core"
          description="서버 원정 기능"
          enabled={settings.core_enabled}
          disabled={Boolean(busy)}
          onChange={(value) => onFlag('core_enabled', value)}
        />
        <FeatureSwitch
          label="학생 화면"
          description="원정 연대기 노출"
          enabled={settings.student_ui_enabled}
          disabled={Boolean(busy)}
          onChange={(value) => onFlag('student_ui_enabled', value)}
        />
        <FeatureSwitch
          label="자동 운영"
          description="일요일·정산 Cron"
          enabled={settings.scheduler_enabled}
          disabled={Boolean(busy)}
          onChange={(value) => onFlag('scheduler_enabled', value)}
        />
        <FeatureSwitch
          label="실제 보상"
          description="GOLD·조각·상자 지급"
          enabled={settings.reward_grant_enabled}
          dangerous
          disabled={Boolean(busy)}
          onChange={(value) => onFlag('reward_grant_enabled', value)}
        />
      </div>
    </section>
  );
}

function IntegrityMini({ label,value,ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-card-md border border-line bg-bg-deep/55 px-3 py-2">
      <div className="text-[10px] font-black text-text-muted">{label}</div>
      <div className={cn('mt-0.5 text-sm font-black', ok ? 'text-success' : 'text-warning')}>{value}</div>
    </div>
  );
}

function FeatureSwitch({
  label,description,enabled,onChange,disabled,dangerous,
}: {
  label: string;
  description: string;
  enabled: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  dangerous?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center gap-3 rounded-card-md px-2 py-1.5 text-left transition-colors hover:bg-bg-deep disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="min-w-0 flex-1">
        <div className={cn('text-xs font-black', dangerous && enabled ? 'text-danger' : 'text-white')}>{label}</div>
        <div className="truncate text-[10px] font-bold text-text-muted">{description}</div>
      </div>
      <span className={cn(
        'relative h-5 w-9 flex-shrink-0 rounded-pill border transition-colors',
        enabled
          ? dangerous ? 'border-danger/40 bg-danger/30' : 'border-success/40 bg-success/25'
          : 'border-line bg-bg-deep',
      )}>
        <span className={cn(
          'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform',
          enabled ? 'translate-x-[17px]' : 'translate-x-0.5',
        )} />
      </span>
    </button>
  );
}

function WorldEffectPanel({ board }: { board: ExpeditionAdminBoard }) {
  const effect = board.week?.world_effect;
  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-4">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">World Effect</div>
      <h2 className="mt-0.5 text-base font-black text-white">월드 효과</h2>
      {effect ? (
        <div className="relative mt-3 overflow-hidden rounded-card-lg border border-gold/15 bg-bg-deep/40 p-3">
          <img src={EXPEDITION_ASSETS.worldEffectActivation} alt="" className="pointer-events-none absolute -bottom-5 -right-4 h-24 w-24 object-contain opacity-[0.12]" loading="lazy" decoding="async" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {getExpeditionWorldEffectAsset(effect.effect_code) && (
                <img src={getExpeditionWorldEffectAsset(effect.effect_code) ?? undefined} alt="" className="h-10 w-10 flex-none object-contain" loading="lazy" decoding="async" />
              )}
              <span className="truncate text-lg font-black text-gold">{EFFECT_META[effect.effect_code].label}</span>
            </div>
            <span className="rounded-pill border border-gold/30 bg-gold/10 px-2 py-1 text-[11px] font-black text-gold">Lv.{effect.effect_level}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold">
            <div className="rounded-card-md border border-line bg-bg-deep p-2">
              <div className="text-text-muted">시작</div>
              <div className="mt-0.5 text-text-primary">{formatKst(effect.starts_at)}</div>
            </div>
            <div className="rounded-card-md border border-line bg-bg-deep p-2">
              <div className="text-text-muted">종료</div>
              <div className="mt-0.5 text-text-primary">{formatKst(effect.ends_at)}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] font-bold text-text-muted">정확히 168시간 · 월요일 06:00 → 다음 월요일 06:00</div>
        </div>
      ) : (
        <div className="mt-3 rounded-card-md border border-dashed border-line px-3 py-5 text-center">
          <div className="text-xl">◌</div>
          <div className="mt-1 text-xs font-black text-text-secondary">확정된 월드 효과 없음</div>
          <div className="mt-0.5 text-[11px] font-bold text-text-muted">주간 정산 후 이곳에 표시됩니다.</div>
        </div>
      )}
    </section>
  );
}

function OperationLog({ operations }: { operations: ExpeditionAdminOperation[] }) {
  const rows = [...operations].sort((a,b) => Date.parse(b.completed_at) - Date.parse(a.completed_at)).slice(0, 5);
  return (
    <section className="rounded-card-xl border border-line bg-bg-card p-4">
      <div className="text-xs font-black uppercase tracking-[0.16em] text-text-muted">Audit Trail</div>
      <h2 className="mt-0.5 text-base font-black text-white">운영 기록</h2>
      {rows.length === 0 ? (
        <div className="mt-3 text-xs font-bold text-text-muted">아직 실행된 운영 작업이 없습니다.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {rows.map((operation) => (
            <div key={`${operation.code}-${operation.completed_at}`} className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-success/25 bg-success-bg text-[11px] text-success">✓</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-black text-text-primary">{operationLabel(operation.code)}</div>
                <div className="text-[10px] font-bold text-text-muted">{formatKst(operation.completed_at)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ReleaseBadge({ ok }: { ok: boolean }) {
  return (
    <span className={cn(
      'rounded-pill border px-2.5 py-1 text-[11px] font-black',
      ok
        ? 'border-success/30 bg-success-bg text-success'
        : 'border-warning/30 bg-warning-bg text-warning',
    )}>
      {ok ? '✓ RELEASE READY' : '⚠ RELEASE CHECK'}
    </span>
  );
}

function EmptyPanel({ icon,title,description }: { icon: string; title: string; description: ReactNode }) {
  return (
    <div className="rounded-card-xl border border-dashed border-line bg-bg-card px-6 py-12 text-center">
      <div className="text-4xl opacity-70">{icon}</div>
      <h3 className="mt-3 text-base font-black text-white">{title}</h3>
      <p className="mx-auto mt-1 max-w-lg text-sm font-semibold leading-5 text-text-secondary">{description}</p>
    </div>
  );
}
