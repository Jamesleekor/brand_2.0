import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { EmptyState, LoadingSpinner, PageHeader, useRpcCall } from '@/components/shared/components';
import { AchievementHelperRecordRoom, HelperRecordModal, type HelperRecordTarget } from './AchievementHelperRecordRoom';
import { supabase } from '@/lib/supabase/client';
import {
  achievementA3Rpc,
  type AchievementHelperQueueItem,
  type AchievementHelperSystemEvidence,
} from '@/lib/rpc/achievement_a3_rpc';
import { useStudentId } from '@/stores/auth_store';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type Filter = 'ALL' | 'TODO' | 'DONE' | 'APPROVE' | 'REJECT';
type PageMode = 'REVIEW' | 'RECORDS';

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'TODO', label: '검토 대기' },
  { value: 'DONE', label: '검토 완료' },
  { value: 'APPROVE', label: '승인 추천' },
  { value: 'REJECT', label: '반려 추천' },
  { value: 'ALL', label: '전체' },
];

export default function AchievementHelperPage() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('TODO');
  const [mode, setMode] = useState<PageMode>('REVIEW');
  const [search, setSearch] = useState('');
  const [selectedApplicationId, setSelectedApplicationId] = useState<number | null>(null);
  const [recordTarget, setRecordTarget] = useState<HelperRecordTarget | null>(null);

  const status = useQuery({
    queryKey: ['achievement-helper-status', studentId],
    queryFn: async () => {
      const r = await achievementA3Rpc.helperStatus(supabase);
      if (r.success === false) throw new Error(r.error);
      return r.data;
    },
    enabled: Boolean(studentId),
    staleTime: 30_000,
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const queue = useQuery<AchievementHelperQueueItem[]>({
    queryKey: ['achievement-helper-queue', studentId],
    queryFn: async () => {
      const r = await achievementA3Rpc.helperQueue(supabase);
      if (r.success === false) throw new Error(r.error);
      return r.data ?? [];
    },
    enabled: Boolean(status.data?.can_access),
    staleTime: 10_000,
    retry: 1,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const classroomId = status.data?.classroom_id;
    if (!status.data?.can_access || !studentId || !classroomId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['achievement-helper-queue', studentId] });
    };

    const channel = supabase
      .channel(`achievement-helper-apps:${classroomId}:${studentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'achievement_applications',
          filter: `classroom_id=eq.${classroomId}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [status.data?.can_access, status.data?.classroom_id, studentId, queryClient]);

  const rows = queue.data ?? [];
  const counts = useMemo(() => ({
    all: rows.length,
    todo: rows.filter((r) => !r.my_recommendation).length,
    done: rows.filter((r) => Boolean(r.my_recommendation)).length,
    approve: rows.filter((r) => r.my_recommendation === 'APPROVE').length,
    reject: rows.filter((r) => r.my_recommendation === 'REJECT').length,
  }), [rows]);

  const filteredItems = useMemo(() => {
    let next = rows;
    if (filter === 'TODO') next = next.filter((r) => !r.my_recommendation);
    if (filter === 'DONE') next = next.filter((r) => Boolean(r.my_recommendation));
    if (filter === 'APPROVE') next = next.filter((r) => r.my_recommendation === 'APPROVE');
    if (filter === 'REJECT') next = next.filter((r) => r.my_recommendation === 'REJECT');

    const needle = search.trim().toLocaleLowerCase('ko-KR');
    if (!needle) return next;
    return next.filter((r) => [
      r.student_name,
      r.achievement_name,
      r.achievement_uid,
      r.condition_text,
    ].some((value) => value.toLocaleLowerCase('ko-KR').includes(needle)));
  }, [rows, filter, search]);

  useEffect(() => {
    if (mode !== 'REVIEW') return;
    if (filteredItems.length === 0) {
      setSelectedApplicationId(null);
      return;
    }
    if (!selectedApplicationId || !filteredItems.some((item) => item.application_id === selectedApplicationId)) {
      setSelectedApplicationId(filteredItems[0].application_id);
    }
  }, [filteredItems, mode, selectedApplicationId]);

  const selectedItem = useMemo(
    () => filteredItems.find((item) => item.application_id === selectedApplicationId) ?? null,
    [filteredItems, selectedApplicationId],
  );

  const refresh = async () => {
    await Promise.all([status.refetch(), queue.refetch()]);
  };

  const openStudentRecord = (target: HelperRecordTarget) => {
    setRecordTarget(target);
  };

  const moveToNextAfterSave = (applicationId: number) => {
    if (filter !== 'TODO') return;
    const currentIndex = filteredItems.findIndex((item) => item.application_id === applicationId);
    const next = filteredItems[currentIndex + 1]
      ?? filteredItems.find((item) => item.application_id !== applicationId)
      ?? null;
    setSelectedApplicationId(next?.application_id ?? null);
  };

  return (
    <>
      <PageHeader
        title="업적 검증 도우미"
        emoji="🔎"
        right={status.data?.can_access ? (
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={status.isFetching || queue.isFetching}
            className="btn-secondary !px-3 !py-2 text-xs"
          >
            {status.isFetching || queue.isFetching ? '갱신 중…' : '새로고침'}
          </button>
        ) : undefined}
      />

      <div className="px-4 pb-24 pt-3">
        {status.isLoading ? (
          <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
        ) : status.isError ? (
          <HelperLoadError
            title="도우미 권한을 확인하지 못했습니다"
            message={errorMessage(status.error)}
            onRetry={() => void status.refetch()}
          />
        ) : !status.data?.can_access ? (
          <EmptyState
            emoji="🔒"
            title="업적검증도우미 전용입니다"
            description="현재 업적검증도우미 역할을 가진 학생만 사용할 수 있습니다. 실제 승인·반려 권한은 선생님에게만 있습니다."
          />
        ) : (
          <>
            <HelperTopBar
              mode={mode}
              onMode={setMode}
              todo={counts.todo}
              done={counts.done}
              all={counts.all}
            />

            {mode === 'REVIEW' ? (
              <ReviewWorkspace
                items={filteredItems}
                selectedItem={selectedItem}
                selectedApplicationId={selectedApplicationId}
                onSelect={setSelectedApplicationId}
                counts={counts}
                filter={filter}
                onFilter={setFilter}
                search={search}
                onSearch={setSearch}
                isLoading={queue.isLoading}
                isError={queue.isError}
                error={queue.error}
                onRetry={() => void queue.refetch()}
                onOpenRecord={openStudentRecord}
                onSaved={moveToNextAfterSave}
              />
            ) : (
              <AchievementHelperRecordRoom
                enabled={Boolean(status.data?.can_access)}
                onOpenRecord={openStudentRecord}
              />
            )}
          </>
        )}
      </div>

      {recordTarget && (
        <HelperRecordModal
          key={`${recordTarget.studentId}-${recordTarget.initialSection ?? 'OVERVIEW'}-${recordTarget.suggestedSections?.join(',') ?? ''}`}
          target={recordTarget}
          onClose={() => setRecordTarget(null)}
        />
      )}
    </>
  );
}

function HelperTopBar({
  mode,
  onMode,
  todo,
  done,
  all,
}: {
  mode: PageMode;
  onMode: (mode: PageMode) => void;
  todo: number;
  done: number;
  all: number;
}) {
  const completedPercent = all > 0 ? Math.round((done / all) * 100) : 0;
  return (
    <section className="mb-3 rounded-card-lg border border-line bg-bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex rounded-pill border border-line bg-bg-deep p-1">
            <button
              type="button"
              onClick={() => onMode('REVIEW')}
              className={cn(
                'rounded-pill px-3 py-1.5 text-xs font-black transition',
                mode === 'REVIEW' ? 'bg-bv text-white' : 'text-slate-300 hover:text-white',
              )}
            >
              🔎 신청 검토
            </button>
            <button
              type="button"
              onClick={() => onMode('RECORDS')}
              className={cn(
                'rounded-pill px-3 py-1.5 text-xs font-black transition',
                mode === 'RECORDS' ? 'bg-bv text-white' : 'text-slate-300 hover:text-white',
              )}
            >
              📚 학생 기록실
            </button>
          </div>
          <div className="hidden text-[11px] font-bold text-slate-300 md:block">
            추천은 선생님의 최종 판단을 돕는 1차 검토입니다.
          </div>
        </div>

        <div className="flex min-w-[220px] items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between text-[10px] font-black text-slate-300">
              <span>검토 진행 {done}/{all}</span>
              <span>{completedPercent}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-deep">
              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${completedPercent}%` }} />
            </div>
          </div>
          <span className="rounded-pill border border-warning/30 bg-warning/5 px-2.5 py-1 text-[10px] font-black text-warning">
            {todo}건 남음
          </span>
        </div>
      </div>
    </section>
  );
}

function ReviewWorkspace({
  items,
  selectedItem,
  selectedApplicationId,
  onSelect,
  counts,
  filter,
  onFilter,
  search,
  onSearch,
  isLoading,
  isError,
  error,
  onRetry,
  onOpenRecord,
  onSaved,
}: {
  items: AchievementHelperQueueItem[];
  selectedItem: AchievementHelperQueueItem | null;
  selectedApplicationId: number | null;
  onSelect: (id: number) => void;
  counts: { all: number; todo: number; done: number; approve: number; reject: number };
  filter: Filter;
  onFilter: (filter: Filter) => void;
  search: string;
  onSearch: (value: string) => void;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenRecord: (target: HelperRecordTarget) => void;
  onSaved: (applicationId: number) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[330px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
      <aside className="overflow-hidden rounded-card-lg border border-line bg-bg-card lg:sticky lg:top-3">
        <div className="border-b border-line p-2.5">
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {FILTERS.map(({ value, label }) => {
              const count = value === 'TODO'
                ? counts.todo
                : value === 'DONE'
                  ? counts.done
                  : value === 'APPROVE'
                    ? counts.approve
                    : value === 'REJECT'
                      ? counts.reject
                      : counts.all;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onFilter(value)}
                  className={cn(
                    'flex flex-shrink-0 items-center gap-1 rounded-pill px-2.5 py-1.5 text-[10px] font-black transition',
                    filter === value
                      ? 'bg-bv text-white'
                      : 'border border-line bg-bg-deep text-slate-300 hover:text-white',
                  )}
                >
                  {label}
                  <span className={cn(
                    'rounded-pill px-1.5 py-0.5 text-[9px]',
                    filter === value ? 'bg-white/20' : 'bg-black/20',
                  )}>{count}</span>
                </button>
              );
            })}
          </div>
          <div className="relative mt-1.5">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs">🔍</span>
            <input
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="학생·업적 검색"
              className="h-9 w-full rounded-card-sm border border-line bg-bg-deep pl-8 pr-2.5 text-xs font-bold text-white placeholder:text-slate-500 focus:border-bv/60 focus:outline-none"
            />
          </div>
        </div>

        <div className="lg:max-h-[calc(100vh-260px)] lg:min-h-[520px] lg:overflow-y-auto">
          {isLoading ? (
            <div className="flex justify-center py-12"><LoadingSpinner size="md" /></div>
          ) : isError ? (
            <div className="p-3">
              <HelperLoadError
                title="신청 목록을 불러오지 못했습니다"
                message={errorMessage(error)}
                onRetry={onRetry}
              />
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <div className="text-3xl">{filter === 'TODO' ? '🎉' : '🔎'}</div>
              <div className="mt-2 text-sm font-black text-white">
                {filter === 'TODO' ? '검토 대기 신청이 없습니다' : '조건에 맞는 신청이 없습니다'}
              </div>
              <div className="mt-1 text-[11px] font-bold text-slate-400">검색어나 필터를 바꿔보세요.</div>
            </div>
          ) : (
            <div className="p-1.5">
              {items.map((item) => (
                <QueueRow
                  key={item.application_id}
                  item={item}
                  selected={item.application_id === selectedApplicationId}
                  onClick={() => onSelect(item.application_id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="overflow-hidden rounded-card-lg border border-line bg-bg-card lg:min-h-[520px]">
        {selectedItem ? (
          <ReviewDetailPanel
            key={selectedItem.application_id}
            item={selectedItem}
            onOpenRecord={onOpenRecord}
            onSaved={onSaved}
          />
        ) : (
          <div className="flex min-h-[520px] items-center justify-center p-6 text-center">
            <div>
              <div className="text-4xl">👈</div>
              <div className="mt-3 font-display text-lg text-white">검토할 신청을 선택하세요</div>
              <p className="mt-1 text-xs font-bold text-slate-400">왼쪽 목록에서 한 건을 누르면 이곳에서 바로 검토할 수 있습니다.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function QueueRow({ item, selected, onClick }: { item: AchievementHelperQueueItem; selected: boolean; onClick: () => void }) {
  const evidence = queueEvidenceMeta(item);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.99 }}
      className={cn(
        'mb-1.5 w-full rounded-card-md border px-2.5 py-2 text-left transition last:mb-0',
        selected
          ? 'border-bv/70 bg-bv/10 shadow-sm'
          : 'border-line/80 bg-bg-deep/55 hover:border-bv/35 hover:bg-bg-deep',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-xs font-black text-white">{item.student_name}</div>
        <span className={cn('flex-shrink-0 rounded-pill px-2 py-0.5 text-[9px] font-black', evidence.className)}>
          {evidence.label}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12px] font-black text-slate-100">{item.achievement_name}</span>
        <span className="flex-shrink-0 font-mono text-[9px] font-bold text-bv-100">{item.achievement_uid}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[10px] font-bold text-slate-400">{evidence.summary}</span>
        <span className="flex-shrink-0 text-[9px] font-bold text-slate-500">{formatRelativeTime(item.created_at)}</span>
      </div>
      {item.my_recommendation && (
        <div className={cn(
          'mt-1 text-[9px] font-black',
          item.my_recommendation === 'APPROVE' ? 'text-success' : 'text-danger',
        )}>
          {item.my_recommendation === 'APPROVE' ? '✓ 승인 추천 완료' : '✕ 반려 추천 완료'}
        </div>
      )}
    </motion.button>
  );
}

function ReviewDetailPanel({
  item,
  onOpenRecord,
  onSaved,
}: {
  item: AchievementHelperQueueItem;
  onOpenRecord: (target: HelperRecordTarget) => void;
  onSaved: (applicationId: number) => void;
}) {
  const queryClient = useQueryClient();
  const studentId = useStudentId();
  const { call, isLoading } = useRpcCall();
  const [memo, setMemo] = useState(item.my_memo ?? '');
  const evidenceMeta = queueEvidenceMeta(item);

  useEffect(() => {
    setMemo(item.my_memo ?? '');
  }, [item.application_id, item.my_memo, item.my_recommended_at]);

  const recommend = async (recommendation: 'APPROVE' | 'REJECT' | '') => {
    await call(
      () => achievementA3Rpc.helperRecommend(supabase, {
        p_application_id: item.application_id,
        p_recommendation: recommendation,
        p_memo: recommendation ? memo.trim() || null : null,
      }),
      {
        successTitle: recommendation === 'APPROVE'
          ? '✅ 승인 추천 저장'
          : recommendation === 'REJECT'
            ? '❌ 반려 추천 저장'
            : '추천 취소',
        successDescription: recommendation ? '선생님 검토 큐에 추천 결과가 표시됩니다.' : undefined,
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['achievement-helper-queue', studentId] });
          if (recommendation) onSaved(item.application_id);
        },
      },
    );
  };

  return (
    <div className="lg:max-h-[calc(100vh-260px)] lg:overflow-y-auto">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-pill bg-bv/10 px-2 py-0.5 text-[10px] font-black text-bv-100">{item.grade}</span>
              <VerificationModeBadge mode={item.verification_mode} />
              <span className="font-mono text-[10px] font-black text-slate-400">{item.achievement_uid}</span>
            </div>
            <h2 className="mt-1 font-display text-xl text-white">{item.achievement_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-bold text-slate-300">
              <span>신청자 <b className="text-white">{item.student_name}</b></span>
              <span title={formatAbsoluteTime(item.created_at)}>신청 {formatRelativeTime(item.created_at)}</span>
            </div>
          </div>
          <span className={cn('rounded-pill px-2.5 py-1 text-[10px] font-black', evidenceMeta.className)}>
            {evidenceMeta.label}
          </span>
        </div>
      </div>

      <div className="space-y-2.5 p-3.5">
        <div className="grid gap-2 md:grid-cols-2">
          <CompactTextBox title="달성 조건" text={item.condition_text} emphasis />
          <CompactTextBox title="학생 설명" text={item.evidence_text || '제출한 설명이 없습니다.'} />
        </div>

        <SystemEvidenceCompact evidence={item.system_evidence} evaluationType={item.evaluation_type} />

        <ActionGuide item={item} />

        <div className="rounded-card-md border border-line bg-bg-deep/60 px-3 py-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wide text-slate-300">📚 관련 기록 확인</div>
              <div className="mt-0.5 text-[10px] font-bold text-slate-500">이 업적과 직접 연결된 기록만 먼저 확인하세요.</div>
            </div>
            <button
              type="button"
              onClick={() => onOpenRecord({
                studentId: item.student_id,
                studentName: item.student_name,
                suggestedSections: item.record_sections,
                initialSection: item.record_sections[0] ?? 'OVERVIEW',
              })}
              className="rounded-pill border border-bv/35 bg-bv/10 px-2.5 py-1.5 text-[10px] font-black text-bv-100"
            >
              전체 기록실
            </button>
          </div>
          {item.record_sections.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.record_sections.map((section) => (
                <button
                  key={section}
                  type="button"
                  onClick={() => onOpenRecord({
                    studentId: item.student_id,
                    studentName: item.student_name,
                    suggestedSections: item.record_sections,
                    initialSection: section,
                  })}
                  className="rounded-pill border border-line bg-bg-card px-2.5 py-1.5 text-[10px] font-black text-slate-200 hover:border-bv/40 hover:text-bv-100"
                >
                  {recordSectionLabel(section)}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-2 text-[10px] font-bold text-slate-500">공개 가능한 원기록보다 학생 설명과 선생님의 정성 판단이 중요한 업적입니다.</div>
          )}
        </div>

        <div className="rounded-card-md border border-line bg-bg-deep/60 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label htmlFor={`helper-memo-${item.application_id}`} className="text-[10px] font-black text-slate-200">
              선생님에게 남길 판단 근거
            </label>
            <span className="text-[9px] font-bold text-slate-500">{memo.length}/500</span>
          </div>
          <textarea
            id={`helper-memo-${item.application_id}`}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="예: 기록을 확인했으며 조건과 일치함 / 누락 기록이 없어 조건 미충족으로 판단함"
            className="input-field w-full resize-none text-xs text-white placeholder:text-slate-500"
          />
        </div>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-line bg-bg-card/95 px-3.5 py-3 backdrop-blur">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void recommend('APPROVE')}
            className={cn(
              'rounded-card-md px-3 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60',
              item.my_recommendation === 'APPROVE'
                ? 'bg-success text-white'
                : 'border border-success/40 bg-success-bg text-success',
            )}
          >
            ✅ 승인 추천
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void recommend('REJECT')}
            className={cn(
              'rounded-card-md px-3 py-2.5 text-sm font-black disabled:cursor-not-allowed disabled:opacity-60',
              item.my_recommendation === 'REJECT'
                ? 'bg-danger text-white'
                : 'border border-danger/40 bg-danger-bg text-danger',
            )}
          >
            ❌ 반려 추천
          </button>
        </div>
        {item.my_recommendation ? (
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void recommend('')}
            className="mt-2 w-full rounded-card-sm border border-line bg-bg-deep px-3 py-1.5 text-[10px] font-black text-slate-300 disabled:opacity-60"
          >
            현재 추천 취소
          </button>
        ) : (
          <div className="mt-1.5 text-center text-[9px] font-bold text-slate-500">추천 저장 후 다음 검토 대기 신청으로 자동 이동합니다.</div>
        )}
      </div>
    </div>
  );
}

function CompactTextBox({ title, text, emphasis = false }: { title: string; text: string; emphasis?: boolean }) {
  return (
    <div className={cn(
      'rounded-card-md border px-3 py-2.5',
      emphasis ? 'border-bv/25 bg-bv/5' : 'border-line bg-bg-deep/60',
    )}>
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-300">{title}</div>
      <div className={cn('mt-1 whitespace-pre-wrap break-words text-xs font-bold leading-relaxed', emphasis ? 'text-white' : 'text-slate-200')}>
        {text}
      </div>
    </div>
  );
}

function SystemEvidenceCompact({
  evidence,
  evaluationType,
}: {
  evidence: AchievementHelperQueueItem['system_evidence'];
  evaluationType: AchievementHelperQueueItem['evaluation_type'];
}) {
  if (!evidence) {
    return (
      <div className="rounded-card-md border border-warning/25 bg-warning/5 px-3 py-2.5">
        <div className="text-[11px] font-black text-warning">📋 시스템 자동판정 없음 · 직접 확인 필요</div>
        <div className="mt-0.5 text-[10px] font-bold text-slate-300">
          {evaluationType === 'QUANTITATIVE' ? '관련 원기록과 신청 설명을 직접 비교하세요.' : '정성 업적은 학생 설명과 실제 활동을 확인하세요.'}
        </div>
      </div>
    );
  }

  if (evidence.error || evidence.available === false) {
    return (
      <div className="rounded-card-md border border-warning/25 bg-warning/5 px-3 py-2.5">
        <div className="text-[11px] font-black text-warning">📋 자동 검증 실패 · 직접 확인</div>
        <div className="mt-0.5 text-[10px] font-bold text-slate-300">{evidence.error || '자동 근거를 계산하지 못했습니다.'}</div>
      </div>
    );
  }

  const normalized = normalizeEvidence(evidence);
  if (!normalized) {
    return (
      <div className="rounded-card-md border border-warning/25 bg-warning/5 px-3 py-2.5 text-[11px] font-black text-warning">
        📋 안전하게 표시할 수 있는 자동 근거가 없습니다. 관련 기록을 직접 확인하세요.
      </div>
    );
  }

  const meta = evidenceResultMeta(normalized.result);
  return (
    <div className={cn('rounded-card-md border px-3 py-2.5', meta.panelClassName)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-black uppercase tracking-wide text-slate-200">📊 시스템 참고값</div>
        <span className={cn('rounded-pill px-2 py-0.5 text-[10px] font-black', meta.badgeClassName)}>{meta.label}</span>
      </div>

      <div className="mt-2 flex flex-wrap items-stretch gap-2">
        <EvidenceMini label="실측값" value={displayValue(normalized.measuredValue)} />
        <EvidenceMini
          label="조건값"
          value={`${normalized.op ? `${normalized.op} ` : ''}${displayValue(normalized.targetValue)}`.trim() || '-'}
        />
        {normalized.details.slice(0, 2).map((detail, index) => (
          <EvidenceMini key={`${detail.label}-${index}`} label={detail.label} value={displayDetailValue(detail.value)} />
        ))}
      </div>

      {(normalized.details.length > 2 || normalized.note || normalized.snapshotAt) && (
        <details className="mt-2 rounded-card-sm border border-line/60 bg-black/10 px-2.5 py-1.5">
          <summary className="cursor-pointer text-[10px] font-black text-slate-300">계산 근거 자세히 보기</summary>
          {normalized.details.length > 2 && (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {normalized.details.slice(2).map((detail, index) => (
                <EvidenceMini key={`${detail.label}-extra-${index}`} label={detail.label} value={displayDetailValue(detail.value)} />
              ))}
            </div>
          )}
          {normalized.note && <div className="mt-2 text-[10px] font-semibold leading-relaxed text-slate-300">💡 {normalized.note}</div>}
          {normalized.snapshotAt && <div className="mt-1 text-[9px] font-bold text-slate-500">기준 시각 · {formatAbsoluteTime(normalized.snapshotAt)}</div>}
        </details>
      )}
    </div>
  );
}

function EvidenceMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[120px] flex-1 rounded-card-sm bg-bg-deep/65 px-2.5 py-2">
      <div className="text-[9px] font-black text-bv-100">{label}</div>
      <div className="mt-0.5 break-words text-xs font-black text-white">{value}</div>
    </div>
  );
}

function ActionGuide({ item }: { item: AchievementHelperQueueItem }) {
  const normalized = item.system_evidence ? normalizeEvidence(item.system_evidence) : null;
  const result = normalized?.result?.toUpperCase() ?? '';
  const text = result === 'PASS'
    ? '시스템 참고값은 조건 충족으로 표시됩니다. 관련 기록이 실제 조건과 맞는지 빠르게 확인한 뒤 추천하세요.'
    : result === 'FAIL'
      ? '시스템 참고값은 조건 미충족으로 표시됩니다. 계산에서 빠진 기록이 없는지만 확인한 뒤 추천하세요.'
      : result === 'BORDERLINE'
        ? '일부 조건은 도우미에게 공개되지 않거나 자동판정이 어렵습니다. 공개된 기록만 확인하고 메모를 남기세요.'
        : item.verification_mode === 'TEACHER_JUDGMENT'
          ? '이 업적은 선생님의 정성 판단이 중요합니다. 사실관계만 확인하고 가치 판단은 선생님에게 맡기세요.'
          : '자동으로 확정하기 어려운 업적입니다. 관련 기록에서 조건에 필요한 사실만 확인하세요.';

  return (
    <div className="rounded-card-md border border-bv/20 bg-bv/5 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-200">
      <span className="text-bv-100">💡 도우미가 확인할 것</span> · {text}
      {item.helper_note ? <div className="mt-1 text-[10px] font-semibold text-slate-400">검증 가이드: {item.helper_note}</div> : null}
    </div>
  );
}

function VerificationModeBadge({ mode }: { mode: AchievementHelperQueueItem['verification_mode'] }) {
  const meta = mode === 'SYSTEM_RECORD'
    ? { label: '🧮 기록 검증', className: 'border-success/25 bg-success-bg/30 text-success' }
    : mode === 'PARTIAL_PRIVATE'
      ? { label: '🔐 일부 교사 확인', className: 'border-warning/25 bg-warning/5 text-warning' }
      : { label: '👩‍🏫 교사 판단', className: 'border-line bg-bg-deep text-slate-200' };
  return <span className={cn('rounded-pill border px-2 py-0.5 text-[9px] font-black', meta.className)}>{meta.label}</span>;
}

function recordSectionLabel(section: AchievementHelperQueueItem['record_sections'][number]): string {
  const labels: Record<AchievementHelperQueueItem['record_sections'][number], string> = {
    OVERVIEW: '🧭 종합',
    ECONOMY: '💰 경제',
    P2P: '🤝 개인거래',
    AUCTION: '🔨 경매',
    ARCADE: '🕹️ 아케이드',
    GUILD: '🛡️ 길드',
    SHARDS: '💎 편린',
    DAILY: '✅ 일퀘·출결',
    ACCESS: '🕒 접속',
    DIMENSION: '🌌 차원관문',
    ACHIEVEMENTS: '🏆 업적',
  };
  return labels[section];
}

function queueEvidenceMeta(item: AchievementHelperQueueItem): { label: string; summary: string; className: string } {
  if (item.my_recommendation) {
    return item.my_recommendation === 'APPROVE'
      ? { label: '승인 추천', summary: '검토 완료', className: 'bg-success-bg text-success' }
      : { label: '반려 추천', summary: '검토 완료', className: 'bg-danger-bg text-danger' };
  }

  const normalized = item.system_evidence ? normalizeEvidence(item.system_evidence) : null;
  const result = normalized?.result?.toUpperCase() ?? '';
  const measured = normalized ? displayValue(normalized.measuredValue) : '-';
  const target = normalized
    ? `${normalized.op ? `${normalized.op} ` : ''}${displayValue(normalized.targetValue)}`.trim()
    : '';
  const summary = normalized && (measured !== '-' || target)
    ? `${measured}${target ? ` / ${target}` : ''}`
    : item.verification_mode === 'TEACHER_JUDGMENT'
      ? '선생님 정성 판단 필요'
      : '원기록 확인 필요';

  if (result === 'PASS') return { label: 'PASS', summary, className: 'bg-success-bg text-success' };
  if (result === 'FAIL') return { label: 'FAIL', summary, className: 'bg-danger-bg text-danger' };
  if (result === 'BORDERLINE') return { label: '부분 확인', summary, className: 'bg-warning/10 text-warning' };
  if (item.verification_mode === 'TEACHER_JUDGMENT') return { label: '교사 판단', summary, className: 'bg-bv/10 text-bv-100' };
  return { label: 'REVIEW', summary, className: 'bg-warning/10 text-warning' };
}

function evidenceResultMeta(result: string) {
  const upper = result.toUpperCase();
  if (upper === 'PASS') {
    return {
      label: 'PASS · 조건 충족',
      panelClassName: 'border-success/25 bg-success-bg/30',
      badgeClassName: 'bg-success-bg text-success',
    };
  }
  if (upper === 'FAIL') {
    return {
      label: 'FAIL · 조건 미충족',
      panelClassName: 'border-danger/25 bg-danger-bg/30',
      badgeClassName: 'bg-danger-bg text-danger',
    };
  }
  if (upper === 'BORDERLINE') {
    return {
      label: '부분 확인 필요',
      panelClassName: 'border-warning/25 bg-warning/5',
      badgeClassName: 'bg-warning/10 text-warning',
    };
  }
  return {
    label: 'REVIEW · 직접 확인',
    panelClassName: 'border-warning/25 bg-warning/5',
    badgeClassName: 'bg-warning/10 text-warning',
  };
}

function normalizeEvidence(evidence: AchievementHelperSystemEvidence) {
  const source = (evidence.snapshot ?? evidence) as Record<string, unknown>;
  const rawError = safeString(source.error);
  if (rawError) return null;

  const measuredValue = source.measured_value;
  const targetValue = source.target_value;
  const op = safeString(source.op);
  const result = safeString(source.result)?.toUpperCase() ?? '';
  const snapshotAt = safeString(source.snapshot_at);
  const note = safeString(source.note);
  const details = Array.isArray(source.details)
    ? source.details.flatMap((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
        const detail = raw as Record<string, unknown>;
        const label = safeString(detail.label);
        return label ? [{ label, value: detail.value }] : [];
      })
    : [];

  if (
    measuredValue === undefined
    && targetValue === undefined
    && !op
    && !result
    && !snapshotAt
    && details.length === 0
    && !note
  ) {
    return null;
  }

  return { measuredValue, targetValue, op, result, snapshotAt, details, note };
}

function displayDetailValue(value: unknown): string {
  if (typeof value === 'string') {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dateOnly) return `${Number(dateOnly[2])}월 ${Number(dateOnly[3])}일`;

    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return formatAbsoluteTime(value);
  }
  return displayValue(value);
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return value.toLocaleString('ko-KR');
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  if (typeof value === 'string') return value;
  return '-';
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatAbsoluteTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function HelperLoadError({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className="rounded-card-lg border border-danger/40 bg-danger-bg/30 p-4">
      <div className="font-black text-danger">⚠️ {title}</div>
      <p className="mt-2 break-all text-xs font-semibold leading-relaxed text-slate-200">{message}</p>
      <button type="button" className="btn-secondary mt-3 text-xs" onClick={onRetry}>다시 시도</button>
    </div>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '잠시 후 다시 시도해주세요.';
}
