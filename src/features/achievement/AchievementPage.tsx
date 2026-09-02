// =====================================================================
// B.R.A.N.D 2.0 — Achievement Core A2
// 학생 업적도감: SECRET-safe 검색/복합필터/최초달성/칭호 UX
// =====================================================================

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  PageHeader, Modal, LoadingSpinner, EmptyState, useRpcCall,
} from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import {
  achievementA1Rpc,
  type AchievementFirstAchiever,
} from '@/lib/rpc/achievement_a1_rpc';
import { achievementA3Rpc, type AchievementSpecialReport } from '@/lib/rpc/achievement_a3_rpc';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

type AchievementGrade = '희귀' | '유니크' | '에픽' | '히든' | '유일' | '초월';
type StatusFilterValue = 'ALL' | 'EARNED' | 'LOCKED' | 'PENDING';
type EvalFilterValue = 'ALL' | 'QUANTITATIVE' | 'QUALITATIVE';
type GrantFilterValue = 'ALL' | 'AUTO' | 'MANUAL';

interface Achievement {
  id: number;
  uid: string | null;
  title: string;
  description: string;
  hint: string | null;
  grade: AchievementGrade;
  isHidden: boolean;
  bvReward: number;
  goldReward: number;
  crystalReward: number;
  evaluationType: 'QUANTITATIVE' | 'QUALITATIVE' | null;
  autoEvalEnabled: boolean;
  isEarned: boolean;
  earnedAt: string | null;
  studentAchievementId: number | null;
  isEquipped: boolean;
  isPending: boolean;
  applicationStatus: string | null;
  firstAchievedAt: string | null;
  firstAchievers: AchievementFirstAchiever[];
}

const GRADE_ORDER: AchievementGrade[] = ['희귀', '유니크', '에픽', '히든', '유일', '초월'];

const GRADE_CONFIG: Record<AchievementGrade, { color: string; bgClass: string; label: string }> = {
  희귀:   { color: 'text-slate-200', bgClass: 'border-line bg-bg-card', label: '희귀' },
  유니크: { color: 'text-blue-300', bgClass: 'border-blue-400/40 bg-blue-400/10', label: '유니크' },
  에픽:   { color: 'text-bv', bgClass: 'border-bv/40 bg-bv/10', label: '에픽' },
  히든:   { color: 'text-amber-200', bgClass: 'border-amber-300/40 bg-amber-300/10', label: '히든' },
  유일:   { color: 'text-red-200', bgClass: 'border-danger/40 bg-danger/10', label: '유일' },
  초월:   { color: 'text-warning', bgClass: 'border-warning/40 bg-warning/10', label: '초월' },
};

export default function AchievementPage() {
  const [search, setSearch] = useState('');
  const [gradeFilter, setGradeFilter] = useState<AchievementGrade | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('ALL');
  const [evalFilter, setEvalFilter] = useState<EvalFilterValue>('ALL');
  const [grantFilter, setGrantFilter] = useState<GrantFilterValue>('ALL');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: achievements, isLoading } = useAchievements();
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const helperStatus = useQuery({
    queryKey: ['achievement-helper-status', studentId],
    queryFn: async () => {
      const r = await achievementA3Rpc.helperStatus(supabase);
      if (r.success === false) return null;
      return r.data;
    },
    enabled: Boolean(studentId),
    staleTime: 60_000,
  });

  // 교사 승인/반려와 업적 부여를 페이지 새로고침 없이 즉시 반영한다.
  useEffect(() => {
    if (!studentId) return;
    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['achievements-safe-catalog', studentId] });
      void queryClient.invalidateQueries({ queryKey: ['achievement-special-reports', studentId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard', studentId, classroomId] });
      void queryClient.invalidateQueries({ queryKey: ['profile-detail', studentId] });
      if (classroomId) {
        void queryClient.invalidateQueries({ queryKey: ['achievement-titles', classroomId] });
      }
    };
    const channels = [
      supabase.channel(`achievement-dex:applications:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'achievement_applications', filter: `student_id=eq.${studentId}` }, invalidate)
        .subscribe(),
      supabase.channel(`achievement-dex:grants:${studentId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'student_achievements', filter: `student_id=eq.${studentId}` }, invalidate)
        .subscribe(),
    ];
    return () => { channels.forEach((channel) => { void supabase.removeChannel(channel); }); };
  }, [studentId, classroomId, queryClient]);

  const selected = achievements?.find((a) => a.id === selectedId) ?? null;
  const normalizedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!achievements) return [];
    return achievements.filter((a) => {
      if (gradeFilter !== 'ALL' && a.grade !== gradeFilter) return false;
      if (statusFilter === 'EARNED' && !a.isEarned) return false;
      if (statusFilter === 'LOCKED' && (a.isEarned || a.isPending)) return false;
      if (statusFilter === 'PENDING' && !a.isPending) return false;
      // 미공개 SECRET은 서버에서 판정 성격/자동 여부가 의도적으로 마스킹된다.
      // 마스킹된 false/null 값을 필터 분류에 사용하면 정보가 새어 보일 수 있으므로
      // 상세 판정 필터 또는 검색이 켜졌을 때는 SECRET placeholder 자체를 제외한다.
      if (a.isHidden && (evalFilter !== 'ALL' || grantFilter !== 'ALL')) return false;
      if (evalFilter !== 'ALL' && a.evaluationType !== evalFilter) return false;
      if (grantFilter === 'AUTO' && !a.autoEvalEnabled) return false;
      if (grantFilter === 'MANUAL' && a.autoEvalEnabled) return false;

      if (normalizedSearch) {
        if (a.isHidden) return false;
        const hay = [a.uid ?? '', a.title, a.description, a.hint ?? ''].join(' ').toLowerCase();
        if (!hay.includes(normalizedSearch)) return false;
      }
      return true;
    });
  }, [achievements, gradeFilter, statusFilter, evalFilter, grantFilter, normalizedSearch]);

  const hasActiveFilter = Boolean(
    search.trim()
    || gradeFilter !== 'ALL'
    || statusFilter !== 'ALL'
    || evalFilter !== 'ALL'
    || grantFilter !== 'ALL',
  );

  const resetFilters = () => {
    setSearch('');
    setGradeFilter('ALL');
    setStatusFilter('ALL');
    setEvalFilter('ALL');
    setGrantFilter('ALL');
  };

  return (
    <>
      <PageHeader title="업적도감" emoji="🏆" />

      <div className="px-4 pt-4 pb-20">
        <SummaryHeader achievements={achievements ?? []} />

        {helperStatus.data?.can_access && (
          <button
            type="button"
            onClick={() => navigate('/achievement/helper')}
            className="mb-3 w-full rounded-card-md border border-bv/35 bg-bv/10 px-4 py-3 text-left transition hover:border-bv/60 hover:bg-bv/15"
          >
            <div className="text-sm font-black text-bv-100">🔎 업적 검증 도우미</div>
            <div className="mt-0.5 text-2xs font-bold text-text-secondary">신청된 업적을 1차 확인하고 선생님께 추천을 남길 수 있습니다.</div>
          </button>
        )}

        <div className="mb-3 rounded-card-lg border border-line bg-bg-card p-3">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm">🔍</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="업적 ID · 이름 · 조건 · 힌트 검색"
              className="w-full rounded-card-md border border-line-strong bg-bg-deep py-2.5 pl-9 pr-3 text-sm font-bold text-white placeholder:text-slate-500 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
            />
          </div>

          <StatusFilter current={statusFilter} onChange={setStatusFilter} />
          <GradeFilter current={gradeFilter} onChange={setGradeFilter} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <select
              value={evalFilter}
              onChange={(e) => setEvalFilter(e.target.value as EvalFilterValue)}
              className="input-field w-full text-xs font-bold"
            >
              <option value="ALL">조건 성격 · 전체</option>
              <option value="QUANTITATIVE">정량 조건</option>
              <option value="QUALITATIVE">정성 조건</option>
            </select>
            <select
              value={grantFilter}
              onChange={(e) => setGrantFilter(e.target.value as GrantFilterValue)}
              className="input-field w-full text-xs font-bold"
            >
              <option value="ALL">판정 방식 · 전체</option>
              <option value="MANUAL">교사 확인형</option>
              <option value="AUTO">자동 판정형</option>
            </select>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!hasActiveFilter}
              className="btn-secondary col-span-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40 sm:col-span-1"
            >
              초기화
            </button>
          </div>
        </div>

        <SpecialReportPanel />

        <div className="mb-3 flex items-center justify-between text-xs font-bold text-slate-400">
          <span>{filtered.length}개 표시</span>
          {hasActiveFilter && <span>필터 적용 중</span>}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="조건에 맞는 업적이 없어요" description="검색어나 필터를 바꿔보세요." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((ach) => (
              <AchievementCard
                key={ach.id}
                achievement={ach}
                onClick={() => setSelectedId(ach.id)}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <AchievementDetailModal
          achievement={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function SummaryHeader({ achievements }: { achievements: Achievement[] }) {
  const earned = achievements.filter((a) => a.isEarned).length;
  const total = achievements.length;
  const equipped = achievements.find((a) => a.isEquipped);
  const gradeCounts = Object.fromEntries(
    GRADE_ORDER.map((grade) => [grade, achievements.filter((a) => a.isEarned && a.grade === grade).length]),
  ) as Record<AchievementGrade, number>;
  const chipClass: Record<AchievementGrade, string> = {
    희귀: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
    유니크: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
    에픽: 'border-bv/30 bg-bv/10 text-bv-100',
    히든: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
    유일: 'border-danger/30 bg-danger/10 text-red-200',
    초월: 'border-warning/30 bg-warning/10 text-warning',
  };

  return (
    <div className="mb-4 rounded-card-lg border border-bv/40 bg-gradient-to-br from-bv/20 to-bv-500/10 p-4 backdrop-blur-card">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="font-display text-3xl tracking-tighter text-bv">{earned}</span>
        <span className="text-base font-extrabold text-text-secondary">/ {total}</span>
        <span className="ml-auto text-xs font-bold text-text-secondary">달성률 {total > 0 ? Math.round((earned / total) * 100) : 0}%</span>
      </div>

      <div className="mb-3 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {GRADE_ORDER.map((grade) => (
          <div key={grade} className={`rounded-pill border px-2 py-1.5 text-center ${chipClass[grade]}`}>
            <span className="text-xs font-black">{grade}</span>
            <span className="ml-1 font-display text-sm">{gradeCounts[grade]}</span>
          </div>
        ))}
      </div>

      <div className="rounded-card-md border border-white/10 bg-black/15 px-3 py-2 text-xs font-bold">
        <span className="text-slate-400">현재 칭호</span>
        <span className={cn('ml-2', equipped ? GRADE_CONFIG[equipped.grade].color : 'text-slate-500')}>
          {equipped ? `[${equipped.title}]` : '장착한 칭호 없음'}
        </span>
      </div>
    </div>
  );
}

function StatusFilter({ current, onChange }: { current: StatusFilterValue; onChange: (v: StatusFilterValue) => void }) {
  const options: Array<{ value: StatusFilterValue; label: string }> = [
    { value: 'ALL', label: '전체' },
    { value: 'EARNED', label: '달성' },
    { value: 'LOCKED', label: '미달성' },
    { value: 'PENDING', label: '신청 중' },
  ];
  return (
    <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'flex-shrink-0 rounded-pill px-3.5 py-1.5 text-xs font-extrabold transition-all',
            current === opt.value
              ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
              : 'border border-line bg-bg-deep text-slate-300',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function GradeFilter({ current, onChange }: { current: AchievementGrade | 'ALL'; onChange: (v: AchievementGrade | 'ALL') => void }) {
  const grades: Array<AchievementGrade | 'ALL'> = ['ALL', ...GRADE_ORDER];
  return (
    <div className="mb-3 mt-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {grades.map((g) => {
        const config = g === 'ALL' ? null : GRADE_CONFIG[g];
        return (
          <button
            key={g}
            onClick={() => onChange(g)}
            className={cn(
              'flex-shrink-0 rounded-pill px-3 py-1.5 text-2xs font-extrabold transition-all',
              current === g
                ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
                : cn('border bg-bg-deep', config?.bgClass ?? 'border-line', config?.color ?? 'text-slate-300'),
            )}
          >
            {g === 'ALL' ? '모든 등급' : g}
          </button>
        );
      })}
    </div>
  );
}

function AchievementCard({ achievement: ach, onClick }: { achievement: Achievement; onClick: () => void }) {
  const config = GRADE_CONFIG[ach.grade];
  const isHiddenLocked = ach.isHidden && !ach.isEarned;
  const firstLabel = getFirstAchieverLabel(ach.firstAchievers);

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'relative cursor-pointer overflow-hidden rounded-card-md border p-3.5 hover-lift',
        ach.isEarned
          ? cn(config.bgClass, 'achievement-earned-card')
          : 'border-slate-600/70 bg-[#17131f]',
        ach.isPending && !ach.isEarned && 'border-brand-primary/55',
      )}
    >
      <div className="relative z-[1]">
        <div className="mb-1.5 flex items-start gap-2 pr-7 text-[16px] font-black leading-snug tracking-[-0.015em]">
          <span className={cn('flex-shrink-0', isHiddenLocked ? 'text-amber-200' : config.color)}>
            {isHiddenLocked ? '[SECRET]' : `[${config.label}]`}
          </span>
          <h4 className={cn(
            'min-w-0 break-keep',
            ach.isEarned ? 'text-white' : 'text-slate-100',
          )}>
            {isHiddenLocked ? '???' : ach.title}
          </h4>
        </div>

        <div className="mb-1.5 flex min-h-5 items-center gap-2 pr-7">
          {!isHiddenLocked && ach.uid && (
            <span className="font-mono text-[10px] font-bold text-slate-500">{ach.uid}</span>
          )}
          {ach.isPending && !ach.isEarned && (
            <span className="ml-auto rounded-pill bg-brand-primary/15 px-2 py-0.5 text-[10px] font-black text-orange-200">신청 중</span>
          )}
        </div>

        <p className={cn(
          'min-h-[2.6rem] text-xs font-semibold leading-relaxed',
          isHiddenLocked ? 'text-amber-100/75' : ach.isEarned ? 'text-slate-200' : 'text-slate-300',
        )}>
          {isHiddenLocked ? '아직 밝혀지지 않은 히든 업적입니다.' : ach.description}
        </p>

        {!isHiddenLocked && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/10 pt-2 text-[10px] font-bold">
            <span className={firstLabel ? 'text-amber-200' : 'text-slate-500'}>
              🥇 최초 {firstLabel || '아직 없음'}
            </span>
          </div>
        )}
      </div>

      {ach.isEarned && (
        <div className="absolute right-2 top-2 z-[2] flex h-5 w-5 items-center justify-center rounded-full bg-success text-xs text-white">✓</div>
      )}
    </motion.div>
  );
}

function AchievementDetailModal({ achievement: ach, onClose }: { achievement: Achievement; onClose: () => void }) {
  const config = GRADE_CONFIG[ach.grade];
  const [evidence, setEvidence] = useState('');
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const isHiddenLocked = ach.isHidden && !ach.isEarned;

  const canApply = !ach.isEarned && !ach.isPending && !isHiddenLocked
    && (ach.evaluationType === 'QUANTITATIVE' || ach.evaluationType === 'QUALITATIVE');

  const refreshCatalog = () => {
    void queryClient.invalidateQueries({ queryKey: ['achievements-safe-catalog', studentId] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['profile-detail', studentId] });
    void queryClient.invalidateQueries({ queryKey: ['achievement-titles'] });
  };

  const handleApply = async () => {
    if (!studentId) return;
    await call(
      () => studentRpc.submitAchievementApplication(supabase, {
        p_student_id: studentId,
        p_achievement_id: ach.id,
        p_evidence_text: evidence.trim(),
      }),
      {
        successTitle: '신청 완료!',
        successDescription: ach.autoEvalEnabled ? '자동 평가가 진행됩니다' : '선생님이 검토할 예정입니다',
        onSuccess: () => {
          refreshCatalog();
          onClose();
        },
      },
    );
  };

  const handleEquip = async () => {
    if (!studentId || !ach.studentAchievementId) return;
    await call(
      () => studentRpc.equipAchievement(supabase, {
        p_student_id: studentId,
        p_student_achievement_id: ach.studentAchievementId,
      }),
      {
        successTitle: '칭호 장착 완료',
        successDescription: `[${ach.title}] 칭호를 장착했습니다.`,
        onSuccess: () => {
          refreshCatalog();
          onClose();
        },
      },
    );
  };

  const handleUnequip = async () => {
    if (!studentId) return;
    await call(
      () => studentRpc.equipAchievement(supabase, {
        p_student_id: studentId,
        p_student_achievement_id: null,
      }),
      {
        successTitle: '칭호 해제 완료',
        onSuccess: () => {
          refreshCatalog();
          onClose();
        },
      },
    );
  };

  return (
    <Modal isOpen onClose={onClose} title={isHiddenLocked ? '???' : ach.title} emoji="🏆" size="md">
      <div>
        <div className={cn(
          'mb-4 inline-flex items-center rounded-pill border px-3 py-1 text-2xs font-black uppercase tracking-widest',
          config.bgClass,
          config.color,
        )}>
          {isHiddenLocked ? 'SECRET' : `${config.label} 등급`}
        </div>

        <p className="mb-4 break-keep text-sm font-semibold leading-relaxed text-slate-100">
          {isHiddenLocked ? '아직 밝혀지지 않은 히든 업적입니다.' : ach.description}
        </p>

        {!isHiddenLocked && ach.hint && (
          <div className="mb-4 rounded-card-md border border-warning/25 bg-warning/10 p-3 text-xs font-bold leading-relaxed text-amber-100">
            💡 힌트 · {ach.hint}
          </div>
        )}

        {!isHiddenLocked && (
          <div className="mb-4 rounded-card-md border border-line bg-bg-deep p-3">
            <div className="mb-2 text-2xs font-extrabold uppercase text-text-secondary">업적 정보</div>
            <div className="grid grid-cols-2 gap-2 text-xs font-bold">
              <InfoLine label="판정" value={ach.autoEvalEnabled ? '자동 판정' : '교사 확인'} />
              <InfoLine label="조건 성격" value={ach.evaluationType === 'QUANTITATIVE' ? '정량' : '정성'} />
              <InfoLine label="ID" value={ach.uid ?? '-'} mono />
            </div>
          </div>
        )}

        {!isHiddenLocked && (
          <div className="mb-4 rounded-card-md border border-amber-300/20 bg-amber-300/5 p-3">
            <div className="mb-2 text-2xs font-extrabold uppercase text-amber-200">🥇 최초 달성자</div>
            {ach.firstAchievers.length === 0 ? (
              <div className="text-sm font-bold text-slate-400">아직 이 업적의 최초 달성자가 없습니다.</div>
            ) : (
              <div className="space-y-1.5">
                {ach.firstAchievers.map((first) => (
                  <div key={first.student_id} className="flex items-center justify-between gap-3 text-sm font-bold">
                    <span className="text-amber-100">{first.name}</span>
                    <span className="text-xs text-slate-400">{formatDateTime(first.achieved_at)}</span>
                  </div>
                ))}
                {ach.firstAchievers.length > 1 && (
                  <div className="pt-1 text-2xs font-bold text-amber-300">같은 시각의 기록으로 공동 최초 처리되었습니다.</div>
                )}
              </div>
            )}
          </div>
        )}

        {!isHiddenLocked && (ach.bvReward > 0 || ach.goldReward > 0 || ach.crystalReward > 0) && (
          <div className="mb-4 rounded-card-md border border-line bg-bg-deep p-3">
            <div className="mb-2 text-2xs font-extrabold uppercase text-text-secondary">보상</div>
            <div className="flex flex-wrap items-center gap-4">
              {ach.bvReward > 0 && <Reward emoji="⭐" value={ach.bvReward} className="text-bv" />}
              {ach.goldReward > 0 && <Reward emoji="🪙" value={ach.goldReward} className="text-gold" />}
              {ach.crystalReward > 0 && <Reward emoji="💎" value={ach.crystalReward} className="text-crystal" />}
            </div>
          </div>
        )}

        {ach.isEarned && (
          <>
            <div className="mb-3 flex items-center gap-2 rounded-card-md border border-success/40 bg-success-bg p-3">
              <span className="text-lg">✅</span>
              <div>
                <div className="text-sm font-extrabold text-success">달성 완료</div>
                {ach.earnedAt && <div className="mt-0.5 text-2xs text-text-secondary">{formatRelativeTime(ach.earnedAt)}</div>}
              </div>
            </div>

            <div className="mb-4 rounded-card-md border border-gold/30 bg-gold/5 p-3">
              <div className="mb-1 text-xs font-black text-gold">🏷️ 이 업적을 칭호로 사용</div>
              <p className="mb-3 text-xs font-semibold leading-relaxed text-slate-300">
                장착하면 닉네임 앞에 <span className={cn('font-black', config.color)}>[{ach.title}]</span> 칭호를 사용할 수 있습니다.
              </p>
              <button
                type="button"
                onClick={ach.isEquipped ? handleUnequip : handleEquip}
                disabled={isLoading || !ach.studentAchievementId}
                className={ach.isEquipped ? 'btn-secondary w-full' : 'btn-primary w-full'}
              >
                {isLoading ? '처리 중...' : ach.isEquipped ? '✓ 현재 장착 중 · 칭호 해제' : '🏷️ 칭호로 장착'}
              </button>
            </div>
          </>
        )}

        {ach.isPending && !ach.isEarned && (
          <div className="rounded-card-md border border-brand-primary/35 bg-brand-primary/10 p-3 text-center">
            <div className="text-sm font-extrabold text-orange-200">⏳ 신청 검토 중</div>
            <div className="mt-1 text-2xs font-bold text-slate-400">같은 업적은 결과가 나오기 전까지 다시 신청할 수 없습니다.</div>
          </div>
        )}

        {canApply && (
          <div className="space-y-3">
            <div>
              <label className="mb-2 block text-xs font-bold text-text-secondary">달성 증빙 · 설명 <span className="text-danger">(필수)</span></label>
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="언제, 어떤 활동으로 조건을 달성했는지 구체적으로 적어주세요. 링크가 있다면 함께 입력해도 됩니다."
                className="w-full resize-none rounded-card-md border border-line-strong bg-bg-deep px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/20"
                rows={4}
                maxLength={1000}
              />
            </div>
            <button onClick={handleApply} disabled={isLoading || evidence.trim().length < 2} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50">
              {isLoading ? '신청 중...' : '🎯 업적 신청하기'}
            </button>
            <p className="text-center text-2xs text-text-muted break-keep">
              {ach.autoEvalEnabled
                ? '자동 판정이 설정된 업적입니다'
                : ach.evaluationType === 'QUANTITATIVE'
                  ? '정량 조건이지만 현재는 선생님이 확인 후 승인합니다'
                  : '선생님이 검토 후 결과를 알려드립니다'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}


function SpecialReportPanel() {
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [text, setText] = useState('');

  const reports = useQuery<AchievementSpecialReport[]>({
    queryKey: ['achievement-special-reports', studentId],
    queryFn: async () => {
      const r = await achievementA3Rpc.mySpecialReports(supabase);
      if (r.success === false) throw new Error(r.error);
      return r.data ?? [];
    },
    enabled: Boolean(studentId),
  });

  const submit = async () => {
    if (!studentId || text.trim().length < 2) return;
    await call(
      () => achievementA3Rpc.submitSpecialReport(supabase, {
        p_student_id: studentId,
        p_evidence_text: text.trim(),
      }),
      {
        successTitle: '🌟 특별보고 제출 완료',
        successDescription: '아직 공개되지 않은 히든 업적에 해당하는지 선생님이 직접 확인합니다.',
        onSuccess: () => {
          setText('');
          void queryClient.invalidateQueries({ queryKey: ['achievement-special-reports', studentId] });
        },
      },
    );
  };

  const recent = reports.data ?? [];
  return (
    <details className="mb-4 rounded-card-lg border border-amber-300/25 bg-amber-300/[0.055] p-3">
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black text-amber-100">🌟 히든 업적 특별보고</div>
            <div className="mt-0.5 text-2xs font-bold text-amber-100/65">“혹시 이 행동이 히든 업적 아닐까?” 싶을 때 사용하는 교사 직행 보고서</div>
          </div>
          {recent.some((r) => ['PENDING','PENDING_REVIEW'].includes(r.status)) && (
            <span className="rounded-pill bg-warning-bg px-2 py-1 text-[10px] font-black text-warning">검토 중</span>
          )}
        </div>
      </summary>

      <div className="mt-3 border-t border-amber-200/10 pt-3">
        <p className="mb-2 text-xs font-semibold leading-relaxed text-slate-300">
          아직 밝혀지지 않은 히든 업적은 이름과 조건을 선택할 수 없습니다. 달성했다고 생각하는 특별한 행동과 근거를 자유롭게 적어주세요.
          <b className="text-amber-100"> 이 보고서는 업적검증도우미에게 공개되지 않고 선생님에게만 전달됩니다.</b>
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="특별한 성과와 그 근거를 구체적으로 적어주세요."
          className="w-full resize-y rounded-card-md border border-amber-300/25 bg-bg-deep px-3 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-amber-300/60 focus:outline-none"
        />
        <div className="mt-1 flex justify-between text-[10px] font-bold text-text-muted"><span>최소 2자</span><span>{text.length}/1000</span></div>
        <button type="button" onClick={submit} disabled={isLoading || text.trim().length < 2} className="btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-50">
          {isLoading ? '제출 중...' : '🚀 특별보고 제출'}
        </button>

        {recent.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="text-2xs font-black uppercase tracking-wider text-amber-200/80">최근 특별보고</div>
            {recent.slice(0, 5).map((r) => (
              <div key={r.id} className="rounded-card-sm border border-white/5 bg-bg-deep/70 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('text-2xs font-black', specialStatusClass(r.status))}>{specialStatusLabel(r.status)}</span>
                  <span className="text-[10px] font-bold text-text-muted">{formatRelativeTime(r.created_at)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs font-semibold text-slate-300">{r.evidence_text}</div>
                {r.revealed_achievement_name && <div className="mt-1 text-xs font-black text-gold">🏆 {r.revealed_achievement_name}</div>}
                {r.rejection_reason && <div className="mt-1 text-2xs font-bold text-danger">사유: {r.rejection_reason}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function specialStatusLabel(status: string) {
  if (status === 'APPROVED' || status === 'AUTO_APPROVED') return '✅ 승인';
  if (status === 'REJECTED' || status === 'AUTO_REJECTED') return '❌ 반려';
  return '⏳ 검토 중';
}

function specialStatusClass(status: string) {
  if (status === 'APPROVED' || status === 'AUTO_APPROVED') return 'text-success';
  if (status === 'REJECTED' || status === 'AUTO_REJECTED') return 'text-danger';
  return 'text-warning';
}

function InfoLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-card-sm border border-white/5 bg-white/[0.025] px-2.5 py-2">
      <div className="mb-0.5 text-[10px] text-slate-500">{label}</div>
      <div className={cn('text-slate-200', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

function Reward({ emoji, value, className }: { emoji: string; value: number; className: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-lg">{emoji}</span>
      <span className={cn('font-display text-base', className)}>+{value}</span>
    </div>
  );
}

function getFirstAchieverLabel(first: AchievementFirstAchiever[]) {
  if (first.length === 0) return '';
  if (first.length === 1) return first[0].name;
  return `공동 ${first.length}명`;
}

function formatDateTime(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function useAchievements() {
  const studentId = useStudentId();

  return useQuery<Achievement[]>({
    queryKey: ['achievements-safe-catalog', studentId],
    queryFn: async () => {
      if (!studentId) return [];
      const result = await achievementA1Rpc.studentCatalog(supabase);
      if (result.success === false) throw new Error(result.error);

      return (result.data ?? []).map((a) => ({
        id: Number(a.id),
        uid: a.achievement_uid,
        title: a.name || '???',
        description: a.condition_text ?? '',
        hint: a.hint ?? null,
        grade: a.grade,
        isHidden: Boolean(a.is_secret),
        bvReward: Number(a.reward_bv ?? 0),
        goldReward: Number(a.reward_gold ?? 0),
        crystalReward: Number(a.reward_crystal ?? 0),
        evaluationType: a.evaluation_type,
        autoEvalEnabled: Boolean(a.auto_eval_enabled),
        isEarned: Boolean(a.is_earned),
        earnedAt: a.achieved_at ?? null,
        studentAchievementId: a.student_achievement_id == null ? null : Number(a.student_achievement_id),
        isEquipped: Boolean(a.is_equipped),
        isPending: Boolean(a.is_pending),
        applicationStatus: a.application_status ?? null,
        firstAchievedAt: a.first_achieved_at ?? null,
        firstAchievers: Array.isArray(a.first_achievers) ? a.first_achievers : [],
      }));
    },
    enabled: studentId !== null,
  });
}
