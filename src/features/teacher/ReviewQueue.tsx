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

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Modal, LoadingSpinner, EmptyState, useRpcCall
} from '@/components/shared/components';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { supabase } from '@/lib/supabase/client';
import { teacherRpc } from '@/lib/rpc/teacher_rpc';
import { secondaryJobTeacherRpc } from '@/lib/rpc/secondary_job_rpc';
import { achievementA3Rpc, type AchievementHelperRecommendation, type SecretAchievementCandidate, type TeacherAchievementReviewBoard, type TeacherAchievementReviewItem } from '@/lib/rpc/achievement_a3_rpc';
import { achievementA4Rpc } from '@/lib/rpc/achievement_a4_rpc';
import { useClassroomId, useCurrentStudent } from '@/stores/auth_store';
import { formatRelativeTime } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';

// =====================================================================
// 타입
// =====================================================================

type Tab = 'achievement' | 'secondary_job';

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
// 업적 신청 큐 — A4: 최종 승인/보상/히든 공개 + 유일 soft warning
// =====================================================================

function AchievementQueue() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();

  const board = useQuery<TeacherAchievementReviewBoard>({
    queryKey: ['review-achievements', classroomId],
    queryFn: async () => {
      if (!classroomId) return { applications: [], secret_candidates: [] };
      const result = await achievementA3Rpc.teacherReviewBoard(supabase, classroomId);
      if (result.success === false) throw new Error(result.error);
      return result.data ?? { applications: [], secret_candidates: [] };
    },
    enabled: classroomId !== null,
  });

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['review-achievements', classroomId] });
    const channels = [
      supabase.channel(`teacher-achievement-apps:${classroomId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'achievement_applications', filter: `classroom_id=eq.${classroomId}` }, invalidate)
        .subscribe(),
    ];
    return () => { channels.forEach((channel) => { void supabase.removeChannel(channel); }); };
  }, [classroomId, queryClient]);

  if (board.isLoading) {
    return <div className="py-8 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }

  const apps = board.data?.applications ?? [];
  const candidates = board.data?.secret_candidates ?? [];
  if (apps.length === 0) {
    return <EmptyState emoji="✅" title="검토 대기 업적 신청이 없어요" description="모든 신청을 처리했습니다" />;
  }

  const normalCount = apps.filter((app) => app.application_kind === 'NORMAL').length;
  const specialCount = apps.length - normalCount;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-2xs font-bold text-text-muted">
        <span>대기 {apps.length}건 · 오래된 순</span>
        <span className="rounded-pill bg-bg-deep px-2 py-0.5">일반 {normalCount}</span>
        {specialCount > 0 && <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-warning">🌟 특별보고 {specialCount}</span>}
      </div>
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence>
          {apps.map((app) => app.application_kind === 'SPECIAL_REPORT'
            ? <SpecialReportReviewCard key={app.id} application={app} candidates={candidates} />
            : <AchievementReviewCard key={app.id} application={app} />)}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AchievementReviewCard({ application: app }: { application: TeacherAchievementReviewItem }) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [uniqueConfirmOpen, setUniqueConfirmOpen] = useState(false);
  const isAutoApproved = app.status === 'AUTO_APPROVED';

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['review-achievements'] });
    void queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
  };

  const approveNow = async () => {
    await call(
      () => teacherRpc.manualReviewAchievement(supabase, {
        p_application_id: app.id,
        p_approve: true,
      }),
      {
        successTitle: isAutoApproved ? '✅ 자동 승인 확인 완료' : '✅ 승인 완료',
        successDescription: isAutoApproved
          ? `${app.student_name}의 자동 승인 결과를 최종 확인했습니다.`
          : `${app.student_name}에게 업적을 부여했습니다.`,
        onSuccess: () => {
          setUniqueConfirmOpen(false);
          refresh();
        },
      },
    );
  };

  const handleApprove = async () => {
    if (app.achievement_grade === '유일' && app.active_holder_count > 0) {
      setUniqueConfirmOpen(true);
      return;
    }
    await approveNow();
  };

  const handleReject = async () => {
    await call(
      () => teacherRpc.manualReviewAchievement(supabase, {
        p_application_id: app.id,
        p_approve: false,
        p_reason: rejectReason.trim(),
      }),
      {
        successTitle: '❌ 반려 처리',
        successDescription: `${app.student_name}에게 결과 우편을 보냈습니다.`,
        onSuccess: () => {
          refresh();
          setRejectModalOpen(false);
          setRejectReason('');
        },
      },
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-card-lg border border-line bg-bg-card p-4 backdrop-blur-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-pill bg-bv/15 px-2 py-0.5 text-2xs font-black text-bv">{app.achievement_grade ?? '업적'}</span>
            {app.achievement_uid && <span className="font-mono text-[10px] font-bold text-text-muted">{app.achievement_uid}</span>}
            {isAutoApproved && (
              <span className="rounded-pill bg-sky-400/15 px-2 py-0.5 text-[10px] font-black text-sky-300">⚡ 자동 승인됨 · 교사 확인 가능</span>
            )}
            {app.helper_review_enabled
              ? <span className="rounded-pill bg-success-bg px-2 py-0.5 text-[10px] font-black text-success">🔎 도우미 검토 가능</span>
              : <span className="rounded-pill bg-bg-deep px-2 py-0.5 text-[10px] font-black text-text-muted">👤 교사 전용</span>}
            {app.achievement_grade === '유일' && app.active_holder_count > 0 && (
              <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-[10px] font-black text-warning">⚠️ 기존 보유 {app.active_holder_count}명</span>
            )}
            <span className="text-[10px] font-bold text-text-muted">{formatRelativeTime(app.created_at)}</span>
          </div>
          <h4 className="font-display text-lg tracking-tight text-white">{app.achievement_name || '업적'}</h4>
          <p className="mt-1 text-xs font-bold text-text-secondary">신청자 · <span className="text-text-primary">{app.student_name}</span></p>
        </div>
        <div className="flex flex-shrink-0 flex-col items-end gap-1">
          {app.reward_bv > 0 && <span className="text-xs font-bold text-bv">⭐ BV +{app.reward_bv}</span>}
          {app.reward_gold > 0 && <span className="text-xs font-bold text-gold">🪙 GOLD +{app.reward_gold}</span>}
          {app.reward_crystal > 0 && <span className="text-xs font-bold text-crystal">💎 CRYSTAL +{app.reward_crystal}</span>}
        </div>
      </div>

      {app.condition_text && (
        <div className="mt-3 rounded-card-sm border border-bv/20 bg-bv/5 p-3">
          <div className="text-2xs font-black uppercase tracking-widest text-bv-100">달성 조건</div>
          <p className="mt-1 text-sm font-bold leading-relaxed text-slate-200">{app.condition_text}</p>
        </div>
      )}

      <div className="mt-3 rounded-card-sm border border-line bg-bg-deep p-3">
        <div className="text-2xs font-black uppercase tracking-widest text-text-muted">학생 제출 증빙 · 설명</div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-text-primary">{app.evidence_text || '(증빙 없음)'}</p>
      </div>

      {app.evidence_data && (
        <details className="mt-2 rounded-card-sm border border-line bg-bg-deep p-3">
          <summary className="cursor-pointer text-2xs font-black text-text-muted">자동 평가 데이터 보기</summary>
          <pre className="mt-2 overflow-x-auto text-[10px] leading-relaxed text-text-secondary">{JSON.stringify(app.evidence_data, null, 2)}</pre>
        </details>
      )}

      <HelperRecommendationBlock recommendations={app.helper_recommendations} enabled={app.helper_review_enabled} />

      <div className="mt-3 flex gap-2">
        <button onClick={() => setRejectModalOpen(true)} disabled={isLoading} className="flex-1 rounded-card-md border border-danger/40 bg-bg-deep py-2.5 text-sm font-extrabold text-danger hover:bg-danger-bg">❌ 반려</button>
        <button onClick={handleApprove} disabled={isLoading} className="flex-1 rounded-card-md border border-success/40 bg-gradient-to-r from-success/30 to-success/15 py-2.5 text-sm font-extrabold text-success hover:bg-success-bg">{isAutoApproved ? '✅ 자동 승인 확정' : '✅ 최종 승인'}</button>
      </div>

      {uniqueConfirmOpen && (
        <Modal isOpen onClose={() => setUniqueConfirmOpen(false)} title="유일 등급 업적 확인" emoji="🌌" size="sm">
          <div className="space-y-4">
            <p className="text-sm font-semibold leading-relaxed text-text-secondary">
              이 업적은 <b className="text-white">유일 등급</b>이며 현재 이미 <b className="text-warning">{app.active_holder_count}명</b>의 보유자가 있습니다.
              공동 1위·길드 단위 달성처럼 여러 명에게 정당하게 부여되는 경우라면 그대로 승인할 수 있습니다.
            </p>
            <div className="rounded-card-sm border border-warning/25 bg-warning-bg/30 p-3 text-sm font-black text-warning">
              그래도 {app.student_name} 학생에게 [{app.achievement_name}] 업적을 승인하시겠습니까?
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setUniqueConfirmOpen(false)}>취소</button>
              <button className="btn-primary flex-1" onClick={approveNow} disabled={isLoading}>그래도 승인</button>
            </div>
          </div>
        </Modal>
      )}

      {rejectModalOpen && (
        <Modal isOpen onClose={() => setRejectModalOpen(false)} title="업적 신청 반려" emoji="❌" size="sm">
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-text-secondary"><b className="text-text-primary">{app.student_name}</b>에게 반려 사유가 우편으로 전달됩니다.</p>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} maxLength={500} className="input-field w-full resize-none" placeholder="반려 사유를 2자 이상 입력하세요." />
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => { setRejectModalOpen(false); setRejectReason(''); }}>취소</button>
              <button className="btn-danger flex-1" onClick={handleReject} disabled={isLoading || rejectReason.trim().length < 2}>반려 확정</button>
            </div>
          </div>
        </Modal>
      )}
    </motion.div>
  );
}

function HelperRecommendationBlock({ recommendations, enabled }: { recommendations: AchievementHelperRecommendation[]; enabled: boolean }) {
  if (!enabled) return null;
  if (!recommendations.length) {
    return <div className="mt-2 rounded-card-sm border border-line bg-bg-deep/60 p-2.5 text-xs font-bold text-text-muted">🔎 업적검증도우미 추천 대기</div>;
  }
  return (
    <div className="mt-2 rounded-card-sm border border-bv/20 bg-bv/5 p-3">
      <div className="text-2xs font-black uppercase tracking-widest text-bv-100">🔎 업적검증도우미 1차 의견</div>
      <div className="mt-2 space-y-2">
        {recommendations.map((rec) => (
          <div key={`${rec.helper_student_id}-${rec.updated_at}`} className="rounded-card-sm bg-bg-deep/70 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={cn('text-xs font-black', rec.recommendation === 'APPROVE' ? 'text-success' : 'text-danger')}>
                {rec.recommendation === 'APPROVE' ? '✅ 승인 추천' : '❌ 반려 추천'} · {rec.helper_name}
              </span>
              <span className="text-[10px] font-bold text-text-muted">{formatRelativeTime(rec.updated_at)}</span>
            </div>
            {rec.memo && <p className="mt-1 whitespace-pre-wrap break-words text-xs font-semibold text-text-secondary">{rec.memo}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SpecialReportReviewCard({ application: app, candidates }: { application: TeacherAchievementReviewItem; candidates: SecretAchievementCandidate[] }) {
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [selectedId, setSelectedId] = useState(app.achievement_id ? String(app.achievement_id) : '');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [uniqueConfirmOpen, setUniqueConfirmOpen] = useState(false);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['review-achievements'] });
    void queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
  };
  const match = async () => {
    await call(
      () => achievementA3Rpc.teacherMatchSpecialReport(supabase, {
        p_application_id: app.id,
        p_achievement_id: selectedId ? Number(selectedId) : null,
      }),
      {
        successTitle: selectedId ? '🌟 히든 후보 연결 완료' : '연결 해제',
        successDescription: selectedId ? '이제 최종 승인 시 업적 부여·최초 공개·보상·전역 알림이 한 번에 처리됩니다.' : undefined,
        onSuccess: refresh,
      },
    );
  };
  const reject = async () => {
    await call(
      () => achievementA3Rpc.teacherRejectSpecialReport(supabase, {
        p_application_id: app.id,
        p_reason: rejectReason.trim(),
      }),
      {
        successTitle: '특별보고 반려 완료',
        successDescription: `${app.student_name}에게 결과 우편을 보냈습니다.`,
        onSuccess: () => {
          setRejectOpen(false);
          setRejectReason('');
          refresh();
        },
      },
    );
  };
  const approveNow = async () => {
    await call(
      () => achievementA4Rpc.approveSpecialReport(supabase, { p_application_id: app.id }),
      {
        successTitle: '🌟 히든 업적 승인 완료',
        successDescription: `${app.student_name}에게 업적을 부여했습니다. 최초 발견이라면 도감 공개와 전역 알림도 함께 처리되었습니다.`,
        onSuccess: () => {
          setUniqueConfirmOpen(false);
          refresh();
        },
      },
    );
  };
  const approve = async () => {
    if (!app.achievement_id || selectedId !== String(app.achievement_id)) return;
    if (app.achievement_grade === '유일' && app.active_holder_count > 0) {
      setUniqueConfirmOpen(true);
      return;
    }
    await approveNow();
  };

  const selectedCandidate = candidates.find((item) => item.id === Number(selectedId));
  const isSavedMatch = Boolean(app.achievement_id && selectedId === String(app.achievement_id));

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} className="rounded-card-lg border border-amber-300/30 bg-amber-300/[0.055] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-pill bg-warning-bg px-2 py-0.5 text-2xs font-black text-warning">🌟 특별보고 · 교사 전용</span>
        {app.achievement_id && <span className="rounded-pill bg-success-bg px-2 py-0.5 text-2xs font-black text-success">✓ 히든 후보 연결됨</span>}
        <span className="text-[10px] font-bold text-text-muted">{formatRelativeTime(app.created_at)}</span>
      </div>
      <h4 className="mt-2 font-display text-lg text-amber-100">히든 업적 특별보고</h4>
      <p className="mt-1 text-xs font-bold text-text-secondary">신청자 · <span className="text-text-primary">{app.student_name}</span></p>

      <div className="mt-3 rounded-card-sm border border-amber-200/15 bg-bg-deep p-3">
        <div className="text-2xs font-black uppercase tracking-widest text-text-muted">학생이 보고한 특별 성과</div>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-text-primary">{app.evidence_text || '(내용 없음)'}</p>
      </div>

      <div className="mt-3 rounded-card-sm border border-amber-200/15 bg-bg-deep p-3">
        <label className="text-2xs font-black uppercase tracking-widest text-amber-100">해당하는 미공개 히든 업적 후보</label>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="login-input mt-2 w-full">
          <option value="">-- 아직 매칭하지 않음 --</option>
          {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.achievement_uid} · {candidate.name} ({candidate.grade})</option>)}
          {app.achievement_id && !candidates.some((candidate) => candidate.id === app.achievement_id) && (
            <option value={app.achievement_id}>{app.achievement_uid} · {app.achievement_name} ({app.achievement_grade}) · 이미 연결됨</option>
          )}
        </select>
        {(selectedCandidate || (isSavedMatch && app.achievement_name)) && (
          <div className="mt-2 rounded-card-sm border border-line bg-black/10 p-2.5">
            <div className="text-xs font-black text-white">{selectedCandidate?.name ?? app.achievement_name}</div>
            <div className="mt-1 text-xs font-semibold leading-relaxed text-text-secondary">조건: {selectedCandidate?.condition_text ?? app.condition_text}</div>
          </div>
        )}
        <button type="button" onClick={match} disabled={isLoading} className="btn-secondary mt-2 w-full">{selectedId ? '이 히든 업적으로 연결 저장' : '기존 연결 해제'}</button>
        {selectedId && !isSavedMatch && <p className="mt-2 text-2xs font-black text-warning">후보를 변경했습니다. 먼저 ‘연결 저장’을 눌러야 최종 승인할 수 있습니다.</p>}
      </div>

      <div className="mt-3 rounded-card-sm border border-success/25 bg-success-bg/20 p-3 text-xs font-bold leading-relaxed text-success">
        최종 승인 시 <b>업적 부여 → 개별 보상 → 누적 마일스톤 검사 → 최초 SECRET 공개 → 필요한 전역 명예 알림 → 결과 우편</b>이 하나의 트랜잭션으로 처리됩니다.
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setRejectOpen(true)} disabled={isLoading} className="rounded-card-md border border-danger/40 bg-bg-deep py-2.5 text-sm font-black text-danger">❌ 특별보고 반려</button>
        <button type="button" onClick={approve} disabled={isLoading || !isSavedMatch} className="rounded-card-md border border-success/40 bg-gradient-to-r from-success/30 to-success/15 py-2.5 text-sm font-black text-success disabled:cursor-not-allowed disabled:opacity-40">✅ 히든 업적 승인</button>
      </div>

      {uniqueConfirmOpen && (
        <Modal isOpen onClose={() => setUniqueConfirmOpen(false)} title="유일 등급 업적 확인" emoji="🌌" size="sm">
          <div className="space-y-4">
            <p className="text-sm font-semibold leading-relaxed text-text-secondary">이 유일 등급 업적은 현재 이미 {app.active_holder_count}명의 보유자가 있습니다. 그래도 특별보고를 승인할 수 있습니다.</p>
            <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setUniqueConfirmOpen(false)}>취소</button><button className="btn-primary flex-1" onClick={approveNow} disabled={isLoading}>그래도 승인</button></div>
          </div>
        </Modal>
      )}

      {rejectOpen && (
        <Modal isOpen onClose={() => setRejectOpen(false)} title="특별보고 반려" emoji="❌" size="sm">
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-text-secondary">히든 업적에 해당하지 않는다고 판단한 이유를 학생에게 알려주세요.</p>
            <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} maxLength={500} className="input-field w-full resize-none" placeholder="반려 사유를 2자 이상 입력하세요." />
            <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setRejectOpen(false)}>취소</button><button className="btn-danger flex-1" onClick={reject} disabled={isLoading || rejectReason.trim().length < 2}>반려 확정</button></div>
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const approve = async () => {
    if (!teacher?.userId) return;
    await call(
      () => secondaryJobTeacherRpc.approve(supabase, {
        p_application_id: app.id,
        p_teacher_user_id: teacher.userId,
        p_approved: true,
      }),
      {
        successTitle: '✅ 승인 완료',
        successDescription: `${app.studentName} · ${app.jobName}`,
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: ['review-jobs'] });
          void queryClient.invalidateQueries({ queryKey: ['teacher-secondary-active-jobs'] });
          void queryClient.invalidateQueries({ queryKey: ['secondary-jobs'] });
          void queryClient.invalidateQueries({ queryKey: ['secondary-job-status'] });
          void queryClient.invalidateQueries({ queryKey: ['my-secondary-job-applications'] });
          void queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
        },
      },
    );
  };

  const reject = async () => {
    if (!teacher?.userId) return;
    await call(
      () => secondaryJobTeacherRpc.approve(supabase, {
        p_application_id: app.id,
        p_teacher_user_id: teacher.userId,
        p_approved: false,
        p_rejection_reason: rejectReason,
      }),
      {
        successTitle: '❌ 거절 처리',
        successDescription: `${app.studentName} · ${app.jobName}`,
        onSuccess: () => {
          setRejectOpen(false);
          setRejectReason('');
          void queryClient.invalidateQueries({ queryKey: ['review-jobs'] });
          void queryClient.invalidateQueries({ queryKey: ['my-secondary-job-applications'] });
          void queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
        },
      },
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
          <h4 className="font-display text-lg text-white tracking-tight mb-1">💼 {app.jobName}</h4>
          <p className="text-xs text-text-secondary font-bold">신청자: <span className="text-text-primary">{app.studentName}</span></p>
        </div>
      </div>

      <div className="bg-bg-deep border border-line rounded-card-sm p-3 mb-3">
        <div className="text-2xs font-black uppercase tracking-widest text-text-muted mb-1">학생 활동 계획</div>
        <p className="text-sm text-text-primary leading-relaxed break-keep">{app.description}</p>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setRejectOpen(true)} disabled={isLoading} className="flex-1 py-2.5 bg-bg-deep border border-danger/40 text-danger rounded-card-md font-extrabold text-sm hover:bg-danger-bg transition-all">❌ 거절</button>
        <button onClick={approve} disabled={isLoading} className="flex-1 py-2.5 bg-gradient-to-r from-success/30 to-success/15 border border-success/40 text-success rounded-card-md font-extrabold text-sm hover:bg-success-bg transition-all">✅ 승인</button>
      </div>

      {rejectOpen && <Modal isOpen onClose={() => { setRejectOpen(false); setRejectReason(''); }} title="2차직업 신청 거절">
        <div className="space-y-3">
          <p className="text-sm text-text-secondary"><b className="text-text-primary">{app.studentName}</b>의 <b className="text-text-primary">{app.jobName}</b> 신청을 거절합니다.</p>
          <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} rows={4} maxLength={500} className="input-field w-full resize-none" placeholder="학생에게 보여줄 거절 사유를 2자 이상 입력하세요." />
          <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => { setRejectOpen(false); setRejectReason(''); }}>취소</button><button className="btn-danger flex-1" onClick={reject} disabled={isLoading || rejectReason.trim().length < 2}>거절 확정</button></div>
        </div>
      </Modal>}
    </motion.div>
  );
}
