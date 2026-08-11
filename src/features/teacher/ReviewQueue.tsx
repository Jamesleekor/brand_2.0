// =====================================================================
// B.R.A.N.D 2.0 — 교사 검토 큐
// Stage 6-D · 생성일 2026-05-20
// =====================================================================
// 학생 신청을 교사가 검토하는 화면:
// - 업적 신청 (수동 평가)
// - 2차 직업 신청
// 
// 핵심 패턴: Stage 4-D의 안전장치 ②번 (검토 윈도우)
// =====================================================================

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Modal, LoadingSpinner, EmptyState, useRpcCall
} from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { teacherRpc } from '@/lib/rpc/teacher_rpc';
import { useClassroomId, useCurrentStudent } from '@/stores/auth_store';
import { formatRelativeTime, formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 타입
// =====================================================================

type Tab = 'achievement' | 'secondary_job';

interface AchievementApplication {
  id: number;
  studentId: number;
  studentName: string;
  achievementId: number;
  achievementTitle: string;
  achievementGrade: string;
  bvReward: number;
  goldReward: number;
  evidenceText: string | null;
  evidenceData: any;  // 자동 평가 결과 (DSL)
  status: 'PENDING_REVIEW' | 'BORDERLINE' | 'APPROVED' | 'REJECTED';
  createdAt: string;
}

interface SecondaryJobApplication {
  id: number;
  studentId: number;
  studentName: string;
  jobName: string;
  description: string;
  createdAt: string;
}

// =====================================================================
// ReviewQueue 메인
// =====================================================================

export default function ReviewQueue() {
  const [tab, setTab] = useState<Tab>('achievement');
  
  return (
    <TeacherShell>
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-2xl text-brand-gradient tracking-tight mb-1">
            📋 검토 큐
          </h1>
          <p className="text-sm text-text-secondary font-bold">
            학생들의 신청을 검토하고 처리하세요
          </p>
        </div>
        
        {/* 탭 */}
        <div className="flex gap-2">
          <TabButton
            label="업적 신청"
            emoji="🏆"
            active={tab === 'achievement'}
            onClick={() => setTab('achievement')}
          />
          <TabButton
            label="2차 직업 신청"
            emoji="💼"
            active={tab === 'secondary_job'}
            onClick={() => setTab('secondary_job')}
          />
        </div>
        
        {/* 큐 */}
        {tab === 'achievement' ? <AchievementQueue /> : <SecondaryJobQueue />}
      </div>
    </TeacherShell>
  );
}

function TabButton({
  label, emoji, active, onClick
}: {
  label: string;
  emoji: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-4 py-2.5 rounded-pill text-sm font-extrabold transition-all',
        active
          ? 'bg-gradient-to-r from-brand-primary to-gold text-white shadow-brand-sm'
          : 'bg-bg-card border border-line text-text-secondary'
      )}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
  );
}

// =====================================================================
// 업적 신청 큐
// =====================================================================

function AchievementQueue() {
  const classroomId = useClassroomId();
  
  const { data: apps, isLoading } = useQuery<AchievementApplication[]>({
    queryKey: ['review-achievements', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const { data } = await supabase
        .from('achievement_applications')
        .select(`
          id, student_id, achievement_id, evidence_text, evidence_data, 
          status, created_at,
          student:students!student_id(name, brand_name),
          achievement:achievements!achievement_id(name, grade, reward_bv, reward_gold)
        `)
        .eq('classroom_id', classroomId)
        .in('status', ['PENDING', 'PENDING_REVIEW'])
        .order('created_at', { ascending: true })  // 오래된 것부터
        .limit(50);
      
      return (data ?? []).map((a: any) => ({
        id: a.id,
        studentId: a.student_id,
        studentName: a.student?.brand_name || a.student?.name || '학생',
        achievementId: a.achievement_id,
        achievementTitle: a.achievement?.name ?? '',
        achievementGrade: a.achievement?.grade ?? '희귀',
        bvReward: Number(a.achievement?.reward_bv ?? 0),
        goldReward: Number(a.achievement?.reward_gold ?? 0),
        evidenceText: a.evidence_text,
        evidenceData: a.evidence_data,
        status: a.status,
        createdAt: a.created_at,
      }));
    },
    enabled: classroomId !== null,
  });
  
  if (isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }
  
  if (!apps || apps.length === 0) {
    return (
      <EmptyState
        emoji="✅"
        title="검토 대기 업적 신청이 없어요"
        description="모든 신청을 처리했습니다"
      />
    );
  }
  
  return (
    <div className="space-y-3">
      <div className="text-2xs text-text-muted font-bold">
        대기 {apps.length}건 (오래된 순)
      </div>
      
      <AnimatePresence>
        {apps.map((app) => (
          <AchievementReviewCard key={app.id} application={app} />
        ))}
      </AnimatePresence>
    </div>
  );
}

// =====================================================================
// 업적 검토 카드
// =====================================================================

function AchievementReviewCard({ application: app }: { application: AchievementApplication }) {
  const teacher = useCurrentStudent();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  
  const handleApprove = async () => {
    if (!teacher?.userId) return;
    
    await call(
      () => teacherRpc.manualReviewAchievement(supabase, {
        p_application_id: app.id,
        p_approve: true,
        p_teacher_user_id: teacher.userId,
      }),
      {
        successTitle: '✅ 승인 완료',
        successDescription: `${app.studentName}에게 보상 지급`,
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['review-achievements'] });
          queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
        },
      }
    );
  };
  
  const handleReject = async () => {
    if (!teacher?.userId) return;
    
    await call(
      () => teacherRpc.manualReviewAchievement(supabase, {
        p_application_id: app.id,
        p_approve: false,
        p_reason: rejectReason,
        p_teacher_user_id: teacher.userId,
      }),
      {
        successTitle: '거부 처리',
        successDescription: `${app.studentName}에게 알림 전송`,
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['review-achievements'] });
          setRejectModalOpen(false);
          setRejectReason('');
        },
      }
    );
  };
  
  const isBorderline = app.status === 'BORDERLINE';
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={cn(
        'bg-bg-card backdrop-blur-card border rounded-card-lg p-4',
        isBorderline ? 'border-warning/50 shadow-[0_0_16px_rgba(255,200,87,0.15)]' : 'border-line'
      )}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="text-2xs font-black uppercase tracking-widest text-bv bg-bv/15 px-2 py-0.5 rounded-pill">
              {app.achievementGrade}
            </span>
            {isBorderline && (
              <span className="text-2xs font-black uppercase tracking-widest text-warning bg-warning-bg px-2 py-0.5 rounded-pill">
                ⚠️ 경계선 — 자동 평가 애매
              </span>
            )}
            <span className="text-2xs text-text-muted font-bold">
              {formatRelativeTime(app.createdAt)}
            </span>
          </div>
          <h4 className="font-display text-lg text-white tracking-tight mb-1">
            {app.achievementTitle}
          </h4>
          <p className="text-xs text-text-secondary font-bold">
            신청자: <span className="text-text-primary">{app.studentName}</span>
          </p>
        </div>
        
        <div className="text-right flex-shrink-0">
          <div className="flex flex-col items-end gap-1">
            {app.bvReward > 0 && (
              <span className="text-xs font-mono text-bv font-bold">
                ⭐ +{app.bvReward}
              </span>
            )}
            {app.goldReward > 0 && (
              <span className="text-xs font-mono text-gold font-bold">
                🪙 +{app.goldReward}
              </span>
            )}
          </div>
        </div>
      </div>
      
      {/* 학생 제출 근거 */}
      {app.evidenceText && (
        <div className="bg-bg-deep border border-line rounded-card-sm p-3 mb-3">
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">
            학생 제출 사유
          </div>
          <p className="text-sm text-text-primary leading-relaxed break-keep">
            "{app.evidenceText}"
          </p>
        </div>
      )}
      
      {/* 자동 평가 결과 (있는 경우) */}
      {app.evidenceData && (
        <div className="bg-bg-deep border border-line rounded-card-sm p-3 mb-3">
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1.5">
            자동 평가 결과 (참고용)
          </div>
          <pre className="text-2xs text-text-secondary font-mono leading-relaxed overflow-x-auto">
            {JSON.stringify(app.evidenceData, null, 2)}
          </pre>
        </div>
      )}
      
      {/* 액션 버튼 */}
      <div className="flex gap-2">
        <button
          onClick={() => setRejectModalOpen(true)}
          disabled={isLoading}
          className="flex-1 py-2.5 bg-bg-deep border border-danger/40 text-danger rounded-card-md font-extrabold text-sm hover:bg-danger-bg transition-all"
        >
          ❌ 거부
        </button>
        <button
          onClick={handleApprove}
          disabled={isLoading}
          className="flex-1 py-2.5 bg-gradient-to-r from-success/30 to-success/15 border border-success/40 text-success rounded-card-md font-extrabold text-sm hover:bg-success-bg transition-all"
        >
          ✅ 승인
        </button>
      </div>
      
      {/* 거부 모달 */}
      {rejectModalOpen && (
        <Modal
          isOpen
          onClose={() => setRejectModalOpen(false)}
          title="거부 사유 작성"
          emoji="❌"
          size="sm"
        >
          <div className="space-y-3">
            <p className="text-sm text-text-secondary break-keep leading-relaxed">
              <strong className="text-text-primary">{app.studentName}</strong>님에게
              거부 사유를 알려주세요. 격려와 함께 다음 기회를 안내해주시면 좋아요.
            </p>
            
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="예: 좋은 시도였지만 조건이 부족해요. 다시 도전해보세요!"
              className="w-full px-3 py-2.5 bg-bg-deep border border-line-strong rounded-card-md text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary resize-none"
              rows={3}
              maxLength={300}
            />
            
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setRejectModalOpen(false)}
                className="btn-secondary flex-1"
              >
                취소
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim() || isLoading}
                className="btn-danger flex-1"
              >
                {isLoading ? '처리 중...' : '거부 확정'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
}

// =====================================================================
// 2차 직업 신청 큐
// =====================================================================

function SecondaryJobQueue() {
  const classroomId = useClassroomId();
  
  const { data: apps, isLoading } = useQuery<SecondaryJobApplication[]>({
    queryKey: ['review-jobs', classroomId],
    queryFn: async () => {
      if (!classroomId) return [];
      
      const { data } = await supabase
        .from('secondary_job_applications')
        .select(`
          id, student_id, job_name, description, created_at,
          student:students!student_id(name, brand_name)
        `)
        .eq('classroom_id', classroomId)
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(50);
      
      return (data ?? []).map((j: any) => ({
        id: j.id,
        studentId: j.student_id,
        studentName: j.student?.brand_name || j.student?.name || '학생',
        jobName: j.job_name,
        description: j.description ?? '',
        createdAt: j.created_at,
      }));
    },
    enabled: classroomId !== null,
  });
  
  if (isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }
  
  if (!apps || apps.length === 0) {
    return (
      <EmptyState
        emoji="✅"
        title="검토 대기 2차 직업 신청이 없어요"
      />
    );
  }
  
  return (
    <div className="space-y-3">
      <div className="text-2xs text-text-muted font-bold">
        대기 {apps.length}건
      </div>
      
      <AnimatePresence>
        {apps.map((app) => (
          <SecondaryJobReviewCard key={app.id} application={app} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function SecondaryJobReviewCard({ application: app }: { application: SecondaryJobApplication }) {
  const teacher = useCurrentStudent();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  
  const handleDecision = async (approved: boolean) => {
    if (!teacher?.userId) return;
    if (!approved && !confirm(`${app.studentName}님의 신청을 거부하시겠어요?`)) return;
    
    await call(
      () => teacherRpc.approveSecondaryJob(supabase, {
        p_application_id: app.id,
        p_teacher_user_id: teacher.userId,
        p_approved: approved,
      }),
      {
        successTitle: approved ? '✅ 승인 완료' : '❌ 거부 처리',
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['review-jobs'] });
        },
      }
    );
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="bg-bg-card backdrop-blur-card border border-line rounded-card-lg p-4"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xs font-black uppercase tracking-widest text-bv bg-bv/15 px-2 py-0.5 rounded-pill">
              직업 신청
            </span>
            <span className="text-2xs text-text-muted font-bold">
              {formatRelativeTime(app.createdAt)}
            </span>
          </div>
          <h4 className="font-display text-lg text-white tracking-tight mb-1">
            💼 {app.jobName}
          </h4>
          <p className="text-xs text-text-secondary font-bold">
            신청자: <span className="text-text-primary">{app.studentName}</span>
          </p>
        </div>
      </div>
      
      {app.description && (
        <div className="bg-bg-deep border border-line rounded-card-sm p-3 mb-3">
          <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">
            직업 설명
          </div>
          <p className="text-sm text-text-primary leading-relaxed break-keep">
            {app.description}
          </p>
        </div>
      )}
      
      <div className="flex gap-2">
        <button
          onClick={() => handleDecision(false)}
          disabled={isLoading}
          className="flex-1 py-2.5 bg-bg-deep border border-danger/40 text-danger rounded-card-md font-extrabold text-sm hover:bg-danger-bg transition-all"
        >
          ❌ 거부
        </button>
        <button
          onClick={() => handleDecision(true)}
          disabled={isLoading}
          className="flex-1 py-2.5 bg-gradient-to-r from-success/30 to-success/15 border border-success/40 text-success rounded-card-md font-extrabold text-sm hover:bg-success-bg transition-all"
        >
          ✅ 승인
        </button>
      </div>
    </motion.div>
  );
}
