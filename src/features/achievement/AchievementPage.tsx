// =====================================================================
// B.R.A.N.D 2.0 — 업적 페이지 (도감 + 신청)
// Stage 6-C · 생성일 2026-05-20
// =====================================================================
// 학생 업적도감 — 달성한 업적·미달성·등급 필터·신청 모달
// =====================================================================

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  PageHeader, Modal, LoadingSpinner, EmptyState, useRpcCall
} from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { studentRpc } from '@/lib/rpc/student_rpc';
import { useStudentId, useClassroomId } from '@/stores/auth_store';
import { formatRelativeTime, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 타입
// =====================================================================

type AchievementGrade = '희귀' | '유니크' | '에픽' | '초월' | '유일' | '히든';

interface Achievement {
  id: number;
  title: string;
  description: string;
  grade: AchievementGrade;
  isHidden: boolean;
  bvReward: number;
  goldReward: number;
  evaluationType: 'QUANTITATIVE' | 'QUALITATIVE' | 'EVENT_DRIVEN' | 'TEACHER_ONLY';
  
  // 학생 보유 정보 (조회 시 조인)
  isEarned: boolean;
  earnedAt: string | null;
}

const GRADE_CONFIG: Record<AchievementGrade, { color: string; bgClass: string; label: string }> = {
  희귀:   { color: 'text-text-secondary', bgClass: 'border-line bg-bg-card',                label: '희귀' },
  유니크: { color: 'text-blue-400',        bgClass: 'border-blue-400/40 bg-blue-400/10',     label: '유니크' },
  에픽:   { color: 'text-bv',              bgClass: 'border-bv/40 bg-bv/10',                 label: '에픽' },
  초월:   { color: 'text-warning',         bgClass: 'border-warning/40 bg-warning/10',       label: '초월' },
  유일:   { color: 'text-danger',          bgClass: 'border-danger/40 bg-danger/10',         label: '유일' },
  히든:   { color: 'text-slate-100',      bgClass: 'border-slate-300/40 bg-slate-400/10',    label: '히든' },
};

// =====================================================================
// AchievementPage
// =====================================================================

export default function AchievementPage() {
  const [gradeFilter, setGradeFilter] = useState<AchievementGrade | 'ALL'>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'EARNED' | 'LOCKED'>('ALL');
  const [selected, setSelected] = useState<Achievement | null>(null);
  
  const { data: achievements, isLoading } = useAchievements();
  
  const filtered = useMemo(() => {
    if (!achievements) return [];
    return achievements.filter((a) => {
      if (gradeFilter !== 'ALL' && a.grade !== gradeFilter) return false;
      if (statusFilter === 'EARNED' && !a.isEarned) return false;
      if (statusFilter === 'LOCKED' && a.isEarned) return false;
      return true;
    });
  }, [achievements, gradeFilter, statusFilter]);
  
  return (
    <>
      <PageHeader title="업적도감" emoji="🏆" />
      
      <div className="px-4 pt-4">
        <SummaryHeader achievements={achievements ?? []} />
        
        <StatusFilter current={statusFilter} onChange={setStatusFilter} />
        <GradeFilter current={gradeFilter} onChange={setGradeFilter} />
        
        {isLoading ? (
          <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>
        ) : filtered.length === 0 ? (
          <EmptyState emoji="🔍" title="해당하는 업적이 없어요" />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((ach) => (
              <AchievementCard
                key={ach.id}
                achievement={ach}
                onClick={() => setSelected(ach)}
              />
            ))}
          </div>
        )}
      </div>
      
      {selected && (
        <AchievementDetailModal
          achievement={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

// =====================================================================
// 요약 헤더
// =====================================================================

function SummaryHeader({ achievements }: { achievements: Achievement[] }) {
  const earned = achievements.filter((a) => a.isEarned).length;
  const total = achievements.length;
  const grades: AchievementGrade[] = ['희귀', '유니크', '에픽', '히든', '유일', '초월'];
  const gradeCounts = Object.fromEntries(
    grades.map((grade) => [grade, achievements.filter((a) => a.isEarned && a.grade === grade).length])
  ) as Record<AchievementGrade, number>;
  const chipClass: Record<AchievementGrade, string> = {
    희귀: 'border-slate-400/30 bg-slate-400/10 text-slate-200',
    유니크: 'border-blue-400/30 bg-blue-400/10 text-blue-300',
    에픽: 'border-bv/30 bg-bv/10 text-bv-100',
    히든: 'border-slate-200/30 bg-white/10 text-white',
    유일: 'border-danger/30 bg-danger/10 text-red-200',
    초월: 'border-warning/30 bg-warning/10 text-warning',
  };

  return (
    <div className="bg-gradient-to-br from-bv/20 to-bv-500/10 backdrop-blur-card border border-bv/40 rounded-card-lg p-4 mb-4">
      <div className="flex items-baseline gap-2 mb-3">
        <span className="font-display text-3xl text-bv tracking-tighter">
          {earned}
        </span>
        <span className="text-base text-text-secondary font-extrabold">/ {total}</span>
        <span className="text-xs text-text-secondary ml-auto font-bold">달성률 {total > 0 ? Math.round((earned / total) * 100) : 0}%</span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        {grades.map((grade) => (
          <div key={grade} className={`rounded-pill border px-2 py-1.5 text-center ${chipClass[grade]}`}>
            <span className="text-xs font-black">{grade}</span>
            <span className="ml-1 text-sm font-display">{gradeCounts[grade]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================
// 필터들
// =====================================================================

function StatusFilter({ current, onChange }: { current: 'ALL' | 'EARNED' | 'LOCKED'; onChange: (v: any) => void }) {
  const options = [
    { value: 'ALL',    label: '전체' },
    { value: 'EARNED', label: '달성' },
    { value: 'LOCKED', label: '미달성' },
  ] as const;
  
  return (
    <div className="flex gap-1.5 mb-2">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-3.5 py-1.5 rounded-pill text-xs font-extrabold transition-all',
            current === opt.value
              ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
              : 'bg-bg-card border border-line text-text-secondary'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function GradeFilter({ current, onChange }: { current: AchievementGrade | 'ALL'; onChange: (v: any) => void }) {
  const grades: (AchievementGrade | 'ALL')[] = ['ALL', '희귀', '유니크', '에픽', '초월', '유일', '히든'];
  
  return (
    <div className="flex gap-1.5 mb-3 overflow-x-auto scrollbar-hide pb-1">
      {grades.map((g) => {
        const config = g === 'ALL' ? null : GRADE_CONFIG[g];
        return (
          <button
            key={g}
            onClick={() => onChange(g)}
            className={cn(
              'px-3 py-1.5 rounded-pill text-2xs font-extrabold transition-all flex-shrink-0',
              current === g
                ? 'bg-gradient-to-r from-brand-primary to-gold text-white'
                : cn('bg-bg-card border', config?.bgClass ?? 'border-line', config?.color ?? 'text-text-secondary')
            )}
          >
            {g === 'ALL' ? '전체' : g}
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// 업적 카드
// =====================================================================

function AchievementCard({ 
  achievement: ach, onClick 
}: { 
  achievement: Achievement; onClick: () => void;
}) {
  const config = GRADE_CONFIG[ach.grade];
  const isHiddenLocked = ach.isHidden && !ach.isEarned;
  
  return (
    <motion.div
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={cn(
        'p-3 rounded-card-md border cursor-pointer hover-lift relative overflow-hidden',
        ach.isEarned ? config.bgClass : 'bg-bg-deep border-line opacity-60'
      )}
    >
      {/* 등급 라벨 */}
      <div className={cn(
        'text-2xs font-black uppercase tracking-widest mb-1',
        ach.isEarned ? config.color : 'text-text-faded'
      )}>
        {isHiddenLocked ? '???' : config.label}
      </div>
      
      {/* 제목 */}
      <h4 className={cn(
        'text-sm font-extrabold mb-1 leading-tight',
        ach.isEarned ? 'text-text-primary' : 'text-text-secondary'
      )}>
        {isHiddenLocked ? '히든 업적' : ach.title}
      </h4>
      
      {/* 보상 */}
      {ach.isEarned && (
        <div className="flex items-center gap-2 text-2xs font-bold">
          {ach.bvReward > 0 && (
            <span className="text-bv">⭐ +{ach.bvReward}</span>
          )}
          {ach.goldReward > 0 && (
            <span className="text-gold">🪙 +{ach.goldReward}</span>
          )}
        </div>
      )}
      
      {/* 달성 체크 */}
      {ach.isEarned && (
        <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-success flex items-center justify-center text-white text-xs">
          ✓
        </div>
      )}
    </motion.div>
  );
}

// =====================================================================
// 업적 상세 모달 + 신청
// =====================================================================

function AchievementDetailModal({ 
  achievement: ach, onClose 
}: { 
  achievement: Achievement; onClose: () => void;
}) {
  const config = GRADE_CONFIG[ach.grade];
  const [evidence, setEvidence] = useState('');
  const studentId = useStudentId();
  const { call, isLoading } = useRpcCall();
  const isHiddenLocked = ach.isHidden && !ach.isEarned;
  
  const canApply = !ach.isEarned 
    && !isHiddenLocked
    && (ach.evaluationType === 'QUANTITATIVE' || ach.evaluationType === 'QUALITATIVE');
  
  const handleApply = async () => {
    if (!studentId) return;
    
    await call(
      () => studentRpc.submitAchievementApplication(supabase, {
        p_student_id: studentId,
        p_achievement_id: ach.id,
        p_evidence_text: evidence || undefined,
      }),
      {
        successTitle: '신청 완료!',
        successDescription: ach.evaluationType === 'QUANTITATIVE' 
          ? '자동 평가가 진행됩니다'
          : '선생님이 검토할 예정입니다',
        onSuccess: () => {
          onClose();
        },
      }
    );
  };
  
  return (
    <Modal isOpen onClose={onClose} title={ach.title} emoji="🏆" size="md">
      <div>
        {/* 등급 배지 */}
        <div className={cn(
          'inline-flex items-center px-3 py-1 rounded-pill text-2xs font-black uppercase tracking-widest mb-4 border',
          config.bgClass,
          config.color
        )}>
          {config.label} 등급
        </div>
        
        {/* 설명 */}
        <p className="text-sm text-text-primary leading-relaxed mb-4 break-keep">
          {isHiddenLocked ? '히든 업적은 달성 시 공개됩니다.' : ach.description}
        </p>
        
        {/* 보상 */}
        <div className="bg-bg-deep border border-line rounded-card-md p-3 mb-4">
          <div className="text-2xs font-extrabold text-text-secondary uppercase mb-2">보상</div>
          <div className="flex items-center gap-4">
            {ach.bvReward > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-lg">⭐</span>
                <span className="font-display text-base text-bv">+{ach.bvReward}</span>
              </div>
            )}
            {ach.goldReward > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-lg">🪙</span>
                <span className="font-display text-base text-gold">+{ach.goldReward}</span>
              </div>
            )}
          </div>
        </div>
        
        {/* 달성 상태 */}
        {ach.isEarned && (
          <div className="bg-success-bg border border-success/40 rounded-card-md p-3 mb-4 flex items-center gap-2">
            <span className="text-lg">✅</span>
            <div>
              <div className="text-sm font-extrabold text-success">달성 완료</div>
              {ach.earnedAt && (
                <div className="text-2xs text-text-secondary mt-0.5">
                  {formatRelativeTime(ach.earnedAt)}
                </div>
              )}
            </div>
          </div>
        )}
        
        {/* 신청 폼 */}
        {canApply && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-bold text-text-secondary mb-2">
                신청 사유 (선택)
              </label>
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="어떤 활동으로 이 업적을 달성했는지 설명해주세요"
                className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 resize-none"
                rows={3}
                maxLength={500}
              />
            </div>
            
            <button
              onClick={handleApply}
              disabled={isLoading}
              className="btn-primary w-full"
            >
              {isLoading ? '신청 중...' : '🎯 업적 신청하기'}
            </button>
            
            <p className="text-2xs text-text-muted text-center break-keep">
              {ach.evaluationType === 'QUANTITATIVE'
                ? '자동 평가됩니다 (즉시 결과)'
                : '선생님이 검토 후 결과를 알려드립니다'}
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

// =====================================================================
// 데이터 조회
// =====================================================================

function useAchievements() {
  const studentId = useStudentId();
  const classroomId = useClassroomId();
  
  return useQuery<Achievement[]>({
    queryKey: ['achievements', studentId, classroomId],
    queryFn: async () => {
      if (!studentId || !classroomId) return [];
      
      // 1. 모든 활성 업적 (학급 전용 + 전역)
      const { data: allAchs } = await supabase
        .from('achievements')
        .select('id, name, condition_text, grade, is_hidden, reward_bv, reward_gold, evaluation_type')
        .or(`classroom_id.eq.${classroomId},classroom_id.is.null`)
        .eq('is_active', true)
        .order('grade');
      
      // 2. 본인 달성 업적
      const { data: earned } = await supabase
        .from('student_achievements')
        .select('achievement_id, granted_at')
        .eq('student_id', studentId)
        .eq('is_revoked', false);
      
      const earnedMap = new Map(
        (earned ?? []).map((e) => [e.achievement_id, e.granted_at])
      );
      
      return (allAchs ?? []).map((a: any) => ({
        id: a.id,
        title: a.name,
        description: a.condition_text ?? '',
        grade: a.grade,
        isHidden: a.is_hidden ?? false,
        bvReward: Number(a.reward_bv ?? 0),
        goldReward: Number(a.reward_gold ?? 0),
        evaluationType: a.evaluation_type,
        isEarned: earnedMap.has(a.id),
        earnedAt: earnedMap.get(a.id) ?? null,
      }));
    },
    enabled: studentId !== null && classroomId !== null,
  });
}
