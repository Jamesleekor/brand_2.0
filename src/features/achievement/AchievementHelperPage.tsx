import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { EmptyState, LoadingSpinner, PageHeader, useRpcCall } from '@/components/shared/components';
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

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'TODO', label: '검토 대기' },
  { value: 'DONE', label: '내 검토 완료' },
  { value: 'APPROVE', label: '승인 추천' },
  { value: 'REJECT', label: '반려 추천' },
  { value: 'ALL', label: '전체' },
];

export default function AchievementHelperPage() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('TODO');

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
    // Realtime 연결이 일시적으로 끊겨도 검토 큐가 오래 멈추지 않도록 안전망을 둔다.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    const classroomId = status.data?.classroom_id;
    if (!status.data?.can_access || !studentId || !classroomId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['achievement-helper-queue', studentId] });
    };

    // helper_reviews는 브라우저에 직접 공개하지 않는다. 추천 RPC가 parent application의
    // updated_at을 touch하므로, 기존 안전한 application stream만 구독하면 충분하다.
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

  const items = useMemo(() => {
    if (filter === 'TODO') return rows.filter((r) => !r.my_recommendation);
    if (filter === 'DONE') return rows.filter((r) => Boolean(r.my_recommendation));
    if (filter === 'APPROVE') return rows.filter((r) => r.my_recommendation === 'APPROVE');
    if (filter === 'REJECT') return rows.filter((r) => r.my_recommendation === 'REJECT');
    return rows;
  }, [rows, filter]);

  const refresh = async () => {
    await Promise.all([status.refetch(), queue.refetch()]);
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

      <div className="px-4 pt-4 pb-24">
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
            description="현재 1인1역이 업적검증도우미인 학생만 사용할 수 있습니다. 실제 승인·반려 권한은 선생님에게만 있습니다."
          />
        ) : (
          <>
            <section className="mb-4 rounded-card-lg border border-bv/30 bg-bv/10 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-bv-100">선생님을 돕는 1차 검토 화면</div>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-slate-300">
                    신청 내용과 시스템 검증 근거를 확인해 <b>승인 추천</b> 또는 <b>반려 추천</b>을 남겨주세요.
                    추천은 최종 결정이 아니며 선생님이 다시 확인합니다.
                  </p>
                </div>
                <span className="flex-shrink-0 rounded-pill border border-success/30 bg-success-bg px-2.5 py-1 text-[10px] font-black text-success">
                  권한 확인됨
                </span>
              </div>
              <div className="mt-3 rounded-card-sm border border-warning/20 bg-warning/5 px-3 py-2 text-[11px] font-bold leading-relaxed text-slate-200">
                🔐 히든 업적 특별보고와 교사 전용 업적은 이 화면에 표시되지 않습니다. 도우미는 업적을 직접 승인·반려하거나 보상을 지급할 수 없습니다.
              </div>
            </section>

            <section className="mb-4 grid grid-cols-3 gap-2">
              <SummaryCard label="검토 대기" value={counts.todo} tone="warning" />
              <SummaryCard label="내 검토 완료" value={counts.done} tone="success" />
              <SummaryCard label="전체 공개 큐" value={counts.all} tone="default" />
            </section>

            <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
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
                    onClick={() => setFilter(value)}
                    className={cn(
                      'flex flex-shrink-0 items-center gap-1.5 rounded-pill px-3 py-1.5 text-2xs font-black',
                      filter === value
                        ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
                        : 'border border-line bg-bg-card text-slate-200',
                    )}
                  >
                    {label}
                    <span className={cn(
                      'min-w-[18px] rounded-pill px-1.5 py-0.5 text-[9px]',
                      filter === value ? 'bg-white/20 text-white' : 'bg-bg-deep text-slate-200',
                    )}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {queue.isLoading ? (
              <div className="flex justify-center py-12"><LoadingSpinner size="lg" /></div>
            ) : queue.isError ? (
              <HelperLoadError
                title="업적 신청 목록을 불러오지 못했습니다"
                message={errorMessage(queue.error)}
                onRetry={() => void queue.refetch()}
              />
            ) : items.length === 0 ? (
              <EmptyState
                emoji={filter === 'TODO' ? '🎉' : '✅'}
                title={filter === 'TODO' ? '검토 대기 신청이 없습니다' : '표시할 신청이 없습니다'}
                description={filter === 'TODO' ? '새 신청이 들어오면 자동으로 이 목록에 표시됩니다.' : '다른 필터를 선택해 확인해보세요.'}
              />
            ) : (
              <div className="space-y-3">
                {items.map((item) => <HelperReviewCard key={item.application_id} item={item} />)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: 'warning' | 'success' | 'default' }) {
  return (
    <div className={cn(
      'rounded-card-md border p-3 text-center',
      tone === 'warning'
        ? 'border-warning/25 bg-warning/5'
        : tone === 'success'
          ? 'border-success/25 bg-success-bg/30'
          : 'border-line bg-bg-card',
    )}>
      <div className="text-xl font-black text-white">{value}</div>
      <div className="mt-0.5 text-[10px] font-black text-slate-200">{label}</div>
    </div>
  );
}

function HelperReviewCard({ item }: { item: AchievementHelperQueueItem }) {
  const queryClient = useQueryClient();
  const studentId = useStudentId();
  const { call, isLoading } = useRpcCall();
  const [memo, setMemo] = useState(item.my_memo ?? '');

  // 같은 application card가 유지된 채 서버 데이터만 갱신되는 경우에도 메모를 최신값으로 맞춘다.
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
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['achievement-helper-queue', studentId] }),
      },
    );
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-card-lg border bg-bg-card p-4',
        item.my_recommendation === 'APPROVE'
          ? 'border-success/45'
          : item.my_recommendation === 'REJECT'
            ? 'border-danger/45'
            : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-pill bg-bv/10 px-2 py-0.5 text-2xs font-black text-bv-100">{item.grade}</span>
            <span className="rounded-pill bg-bg-deep px-2 py-0.5 text-[10px] font-black text-slate-200">
              {item.evaluation_type === 'QUANTITATIVE' ? '📊 정량' : '📋 정성'}
            </span>
            <span className="font-mono text-[11px] font-black text-bv-100">{item.achievement_uid}</span>
          </div>
          <h3 className="mt-1 font-display text-lg text-white">{item.achievement_name}</h3>
          <div className="mt-0.5 text-xs font-black text-slate-200">
            신청자 · <span className="text-white">{item.student_name}</span>
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-white/80" title={formatAbsoluteTime(item.created_at)}>
            신청 {formatRelativeTime(item.created_at)} · {formatAbsoluteTime(item.created_at)}
          </div>
        </div>
        <RecommendationBadge item={item} />
      </div>

      <div className="mt-3 rounded-card-sm border border-line bg-bg-deep p-3">
        <div className="text-2xs font-black uppercase tracking-wider text-white/90">달성 조건</div>
        <div className="mt-1 text-sm font-bold leading-relaxed text-white/90">{item.condition_text}</div>
      </div>

      <div className="mt-2 rounded-card-sm border border-line bg-bg-deep p-3">
        <div className="text-2xs font-black uppercase tracking-wider text-white/90">학생이 제출한 증빙 · 설명</div>
        <div className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-white/90">
          {item.evidence_text || '(증빙 없음)'}
        </div>
      </div>

      <SystemEvidence evidence={item.system_evidence} evaluationType={item.evaluation_type} />

      <div className="mt-3">
        <div className="mb-1 flex items-end justify-between gap-2">
          <label htmlFor={`helper-memo-${item.application_id}`} className="text-2xs font-black uppercase tracking-wider text-white/90">
            선생님에게 남길 판단 근거 · 메모
          </label>
          <span className="text-[10px] font-bold text-white/70">{memo.length}/500</span>
        </div>
        <textarea
          id={`helper-memo-${item.application_id}`}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="예: 제출한 기록과 조건이 일치함 / 증빙만으로는 조건 충족을 확인하기 어려움"
          className="input-field w-full resize-y text-sm text-white placeholder:text-slate-400"
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
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
        {item.my_recommendation && (
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void recommend('')}
            className="btn-secondary col-span-2 !py-2 text-xs disabled:cursor-not-allowed disabled:opacity-60"
          >
            현재 추천 취소
          </button>
        )}
      </div>
    </motion.article>
  );
}

function RecommendationBadge({ item }: { item: AchievementHelperQueueItem }) {
  if (!item.my_recommendation) {
    return (
      <span className="flex-shrink-0 rounded-pill border border-warning/25 bg-warning/5 px-2.5 py-1 text-[10px] font-black text-warning">
        검토 대기
      </span>
    );
  }

  const approve = item.my_recommendation === 'APPROVE';
  return (
    <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
      <span className={cn(
        'rounded-pill px-2.5 py-1 text-[10px] font-black',
        approve ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger',
      )}>
        {approve ? '✅ 승인 추천 완료' : '❌ 반려 추천 완료'}
      </span>
      {item.my_recommended_at && (
        <span className="text-[9px] font-bold text-slate-200">{formatRelativeTime(item.my_recommended_at)}</span>
      )}
    </div>
  );
}

function SystemEvidence({
  evidence,
  evaluationType,
}: {
  evidence: AchievementHelperQueueItem['system_evidence'];
  evaluationType: AchievementHelperQueueItem['evaluation_type'];
}) {
  if (!evidence) {
    return (
      <div className="mt-2 rounded-card-sm border border-warning/20 bg-warning/5 p-3">
        <div className="text-2xs font-black uppercase tracking-wider text-warning">📋 직접 확인 필요</div>
        <div className="mt-1 text-xs font-semibold text-slate-200">
          {evaluationType === 'QUANTITATIVE'
            ? '이 정량 업적에는 아직 서버 판단 근거가 연결되지 않았습니다. 정량 기준을 연결하면 현재값과 목표값이 여기에 표시됩니다.'
            : '정성 업적은 제출 내용과 실제 활동을 보고 판단해주세요.'}
        </div>
      </div>
    );
  }

  if (evidence.error || evidence.available === false) {
    return (
      <div className="mt-2 rounded-card-sm border border-warning/20 bg-warning/5 p-3">
        <div className="text-2xs font-black uppercase tracking-wider text-warning">📋 자동 검증 실패 · 직접 확인</div>
        <div className="mt-1 text-xs font-semibold text-slate-200">
          {evidence.error || '자동 근거를 계산하지 못했습니다.'}
        </div>
      </div>
    );
  }

  const normalized = normalizeEvidence(evidence);
  if (!normalized) {
    return (
      <div className="mt-2 rounded-card-sm border border-warning/20 bg-warning/5 p-3 text-xs font-bold text-warning">
        {evaluationType === 'QUANTITATIVE'
          ? '📋 현재 판단에 사용할 정량값을 계산하지 못했습니다. 제출 내용과 실제 기록을 직접 확인해주세요.'
          : '📋 저장된 평가 자료가 있지만 도우미 판단에 필요한 안전한 항목은 없습니다. 제출 내용을 직접 확인해주세요.'}
      </div>
    );
  }

  const result = normalized.result;
  const resultLabel = result === 'PASS'
    ? 'PASS · 조건 충족'
    : result === 'FAIL'
      ? 'FAIL · 조건 미충족'
      : result === 'BORDERLINE'
        ? '경계값 · 직접 확인'
        : result || '참고';

  return (
    <div className={cn(
      'mt-2 rounded-card-sm border p-3',
      result === 'PASS'
        ? 'border-success/25 bg-success-bg/40'
        : result === 'FAIL'
          ? 'border-danger/25 bg-danger-bg/40'
          : 'border-warning/25 bg-warning-bg/30',
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-2xs font-black uppercase tracking-wider text-white/90">📊 시스템 검증 근거</div>
        <span className={cn(
          'text-xs font-black',
          result === 'PASS' ? 'text-success' : result === 'FAIL' ? 'text-danger' : 'text-warning',
        )}>
          {resultLabel}
        </span>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
        <EvidenceCell label="실측값" value={displayValue(normalized.measuredValue)} />
        <EvidenceCell
          label="조건값"
          value={`${normalized.op ? `${normalized.op} ` : ''}${displayValue(normalized.targetValue)}`.trim() || '-'}
        />
      </div>

      {normalized.details.length > 0 && (
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs font-bold sm:grid-cols-2">
          {normalized.details.map((detail, index) => (
            <EvidenceCell
              key={`${detail.label}-${index}`}
              label={detail.label}
              value={displayDetailValue(detail.value)}
            />
          ))}
        </div>
      )}

      {normalized.note && (
        <div className="mt-2 rounded-card-sm border border-line/70 bg-bg-deep/50 px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-slate-200">
          💡 {normalized.note}
        </div>
      )}

      {normalized.snapshotAt && (
        <div className="mt-2 text-[10px] font-bold text-slate-200">
          기준 시각 · {formatAbsoluteTime(normalized.snapshotAt)}
        </div>
      )}
    </div>
  );
}

function EvidenceCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card-sm bg-bg-deep/70 p-2">
      <div className="text-[10px] font-black text-bv-100">{label}</div>
      <div className="mt-0.5 break-words text-white">{value}</div>
    </div>
  );
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
