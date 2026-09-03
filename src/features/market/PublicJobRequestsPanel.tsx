import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  secondaryJobPublicStudentRpc,
  type StudentPublicAssignment,
  type StudentPublicBoard,
  type StudentPublicRequest,
} from '@/lib/rpc/secondary_job_public_request_rpc';
import { useClassroomId, useStudentId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';

const CATEGORY_LABEL: Record<string, string> = {
  STUDY: '📚 학습', CREATIVITY: '🎨 창작', SPORT: '🏃 체육', TECH: '💻 기술', COMFORT: '🌿 생활', CUSTOM: '✨ 자유',
};
const ASSIGNMENT_LABEL: Record<string, string> = {
  ACCEPTED: '수행 중', SUBMITTED: '검사 대기', REVISION_REQUESTED: '재수행 요청', COMPLETED: '완료', FAILED: '실패', CANCELLED: '취소',
};

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function requirementLabel(r: StudentPublicRequest) {
  if (r.eligibility_type === 'CATEGORY') return `${CATEGORY_LABEL[r.required_category ?? 'CUSTOM'] ?? r.required_category} 분야`;
  if (r.eligibility_type === 'JOB_NAME') return `💼 ${r.required_job_name}`;
  return '💼 모든 2차직업';
}

export default function PublicJobRequestsPanel() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [accepting, setAccepting] = useState<StudentPublicRequest | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<StudentPublicAssignment | null>(null);
  const [submissionText, setSubmissionText] = useState('');
  const [cancelling, setCancelling] = useState<StudentPublicAssignment | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const board = useQuery<StudentPublicBoard>({
    queryKey: ['secondary-job-public-board', studentId],
    enabled: studentId !== null,
    queryFn: async () => {
      const result = await secondaryJobPublicStudentRpc.board(supabase);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
  });

  useEffect(() => {
    if (!classroomId || !studentId) return;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['secondary-job-public-board', studentId] });
    const channels = [
      supabase.channel(`sj-public-requests:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_public_requests', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe(),
      supabase.channel(`sj-public-assignments:${studentId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_public_assignments', filter: `student_id=eq.${studentId}` }, invalidate).subscribe(),
      supabase.channel(`sj-public-submissions:${studentId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_public_submissions' }, invalidate).subscribe(),
    ];
    return () => { channels.forEach((ch) => void supabase.removeChannel(ch)); };
  }, [classroomId, queryClient, studentId]);

  const serverNowMs = board.data?.server_now ? new Date(board.data.server_now).getTime() : Date.now();
  const openRequests = useMemo(() => (board.data?.requests ?? []).filter((r) => r.status === 'OPEN' && new Date(r.due_at).getTime() > serverNowMs), [board.data, serverNowMs]);
  const pastRequests = useMemo(() => (board.data?.requests ?? []).filter((r) => r.status !== 'OPEN' || new Date(r.due_at).getTime() <= serverNowMs), [board.data, serverNowMs]);
  const activeMine = useMemo(() => (board.data?.my_assignments ?? []).filter((a) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(a.status)), [board.data]);
  const historyMine = useMemo(() => (board.data?.my_assignments ?? []).filter((a) => ['COMPLETED', 'FAILED', 'CANCELLED'].includes(a.status)), [board.data]);

  const openAccept = (request: StudentPublicRequest) => {
    if (!request.can_accept || request.eligible_jobs.length === 0) return;
    setAccepting(request);
    setSelectedJobId(request.eligible_jobs[0]?.id ?? null);
  };
  const accept = async () => {
    if (!accepting || !selectedJobId) return;
    await call(() => secondaryJobPublicStudentRpc.accept(supabase, { p_request_id: accepting.id, p_secondary_job_id: selectedJobId }), {
      successTitle: '📋 공공 의뢰 수락 완료',
      successDescription: '내 공공 의뢰에서 진행 상태를 확인할 수 있어요.',
      onSuccess: () => { setAccepting(null); setSelectedJobId(null); void board.refetch(); },
    });
  };
  const submit = async () => {
    if (!submitting) return;
    await call(() => secondaryJobPublicStudentRpc.submit(supabase, { p_assignment_id: submitting.id, p_submission_text: submissionText }), {
      successTitle: '✅ 완료 보고 제출', successDescription: '선생님의 검사를 기다려주세요.',
      onSuccess: () => { setSubmitting(null); setSubmissionText(''); void board.refetch(); },
    });
  };
  const cancelAssignment = async () => {
    if (!cancelling) return;
    await call(() => secondaryJobPublicStudentRpc.cancelAssignment(supabase, { p_assignment_id: cancelling.id, p_reason: cancelReason.trim() || null }), {
      successTitle: '공공 의뢰 포기 완료',
      onSuccess: () => { setCancelling(null); setCancelReason(''); void board.refetch(); },
    });
  };

  if (board.isLoading) return <div className="py-10 flex justify-center"><LoadingSpinner size="lg" /></div>;
  if (board.isError) return <div className="bg-danger-bg border border-danger/40 rounded-card-md p-4 text-sm text-danger">공공 의뢰를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.</div>;

  return <div className="space-y-5 pb-8">
    <section className="bg-bg-card border border-line rounded-card-lg p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-xl text-brand-gradient">📋 공공 의뢰</h2><p className="text-xs text-text-secondary mt-1">선생님이 공개한 일을 2차직업으로 수행하고 검사 후 GOLD 보상을 받아요.</p></div>
        <div className="text-right"><div className="text-2xs text-text-muted">진행 중</div><div className="font-display text-lg text-gold">{activeMine.length}건</div></div>
      </div>
      {board.data?.employment_freeze && <div className="mt-3 bg-warning-bg border border-warning/40 rounded-card-sm p-2.5 text-xs font-bold text-warning">🚫 고용 동결 중이라 새 공공 의뢰 수락만 중단됩니다. 이미 수락한 의뢰는 계속 수행할 수 있습니다.</div>}
    </section>

    <section>
      <div className="flex items-center justify-between mb-2"><h3 className="font-display text-lg text-white">내 공공 의뢰</h3><span className="text-2xs text-text-muted">{activeMine.length}건 진행 중</span></div>
      {activeMine.length === 0 ? <div className="bg-bg-card border border-line rounded-card-md p-3 text-xs text-text-muted">현재 수행 중인 공공 의뢰가 없습니다.</div> : <div className="space-y-2.5">
        {activeMine.map((a) => <AssignmentCard key={a.id} assignment={a} onSubmit={() => { setSubmitting(a); setSubmissionText(a.latest_submission ?? ''); }} onCancel={() => { setCancelling(a); setCancelReason(''); }} />)}
      </div>}
    </section>

    <section>
      <div className="flex items-center justify-between mb-2"><h3 className="font-display text-lg text-white">모집 중인 의뢰</h3><span className="text-2xs text-text-muted">{openRequests.length}건</span></div>
      {openRequests.length === 0 ? <EmptyState emoji="📭" title="현재 모집 중인 공공 의뢰가 없어요" /> : <div className="grid md:grid-cols-2 gap-3">
        {openRequests.map((r) => <RequestCard key={r.id} request={r} onAccept={() => openAccept(r)} />)}
      </div>}
    </section>

    {(historyMine.length > 0 || pastRequests.length > 0) && <details className="bg-bg-card border border-line rounded-card-md p-3">
      <summary className="cursor-pointer font-extrabold text-sm text-text-secondary">지난 공공 의뢰 / 내 완료 이력</summary>
      <div className="mt-3 space-y-4">
        {historyMine.length > 0 && <div><div className="text-xs font-black text-text-secondary mb-2">내 수행 이력</div><div className="space-y-2">{historyMine.map((a) => <AssignmentCard key={a.id} assignment={a} />)}</div></div>}
        {pastRequests.length > 0 && <div><div className="text-xs font-black text-text-secondary mb-2">마감·취소된 공개 의뢰</div><div className="grid md:grid-cols-2 gap-2">{pastRequests.map((r) => <RequestCard key={r.id} request={r} onAccept={() => {}} />)}</div></div>}
      </div>
    </details>}

    {accepting && <Modal isOpen onClose={() => { setAccepting(null); setSelectedJobId(null); }} title="공공 의뢰 수락">
      <div className="space-y-4">
        <div><div className="font-extrabold">{accepting.title}</div><div className="text-xs text-text-secondary mt-1">보상 🪙 {formatNumber(accepting.reward_gold)} GOLD · 마감 {formatDateTime(accepting.due_at)}</div></div>
        <label className="block"><span className="text-xs font-bold text-text-secondary">이 의뢰에 사용할 2차직업</span><select className="input-field w-full mt-1" value={selectedJobId ?? ''} onChange={(e) => setSelectedJobId(Number(e.target.value))}>{accepting.eligible_jobs.map((j) => <option key={j.id} value={j.id}>{j.job_name} · {CATEGORY_LABEL[j.category] ?? j.category}</option>)}</select></label>
        <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setAccepting(null)}>취소</button><button className="btn-primary flex-1" disabled={isLoading || !selectedJobId} onClick={accept}>{isLoading ? '수락 중...' : '수락 확정'}</button></div>
      </div>
    </Modal>}

    {submitting && <Modal isOpen onClose={() => { setSubmitting(null); setSubmissionText(''); }} title="완료 보고 제출">
      <div className="space-y-3">
        <div><div className="font-extrabold">{submitting.request_title}</div>{submitting.teacher_feedback && <div className="mt-2 bg-warning-bg border border-warning/30 rounded-card-sm p-2 text-xs text-warning">선생님 피드백: {submitting.teacher_feedback}</div>}</div>
        <label className="block"><span className="text-xs font-bold text-text-secondary">무엇을 어떻게 수행했는지 10자 이상 적어주세요.</span><textarea className="input-field w-full mt-1 resize-none" rows={6} maxLength={2000} value={submissionText} onChange={(e) => setSubmissionText(e.target.value)} /></label>
        <div className="text-right text-2xs text-text-muted">{submissionText.trim().length}/2000</div>
        <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setSubmitting(null)}>취소</button><button className="btn-primary flex-1" disabled={isLoading || submissionText.trim().length < 10} onClick={submit}>{isLoading ? '제출 중...' : '완료 보고 제출'}</button></div>
      </div>
    </Modal>}

    {cancelling && <Modal isOpen onClose={() => { setCancelling(null); setCancelReason(''); }} title="공공 의뢰 포기">
      <div className="space-y-3"><p className="text-sm"><b>{cancelling.request_title}</b> 수행을 포기하시겠어요? 포기하면 다른 학생이 빈 자리를 수락할 수 있습니다.</p><textarea className="input-field w-full resize-none" rows={3} maxLength={500} placeholder="포기 사유(선택)" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setCancelling(null)}>계속 수행</button><button className="btn-danger flex-1" disabled={isLoading} onClick={cancelAssignment}>포기 확정</button></div></div>
    </Modal>}
  </div>;
}

function RequestCard({ request, onAccept }: { request: StudentPublicRequest; onAccept: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const full = request.active_assignees >= request.max_assignees;
  const hasLongDescription = request.description.length > 120 || request.description.split('\n').length > 4;
  return <div className="bg-bg-card border border-line rounded-card-md p-4 flex flex-col">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-display text-base text-white">{request.title}</div><div className="text-2xs text-brand-glow font-black mt-1">{requirementLabel(request)}</div></div><div className="shrink-0 text-right"><div className="font-display text-base text-gold">🪙 {formatNumber(request.reward_gold)}</div><div className="text-2xs text-text-muted">{request.active_assignees}/{request.max_assignees}명</div></div></div>
    <button
      type="button"
      onClick={() => hasLongDescription && setExpanded((value) => !value)}
      className={cn('mt-3 text-left rounded-card-sm transition-colors', hasLongDescription && 'cursor-pointer hover:bg-bg-deep/60 focus:outline-none focus:ring-1 focus:ring-line-brand')}
      aria-expanded={expanded}
    >
      <p className={cn('text-xs text-text-secondary whitespace-pre-wrap break-words leading-relaxed', !expanded && 'line-clamp-4')}>{request.description}</p>
      {hasLongDescription && <div className="mt-1.5 text-2xs font-black text-brand-glow">{expanded ? '내용 접기 ▲' : '내용 더 보기 ▼'}</div>}
    </button>
    <div className="mt-3 text-2xs text-text-muted">마감 {formatDateTime(request.due_at)} · 완료 {request.completed_count}명</div>
    {request.blocked_reason && !request.can_accept && <div className="mt-2 text-2xs font-bold text-warning">{request.blocked_reason}</div>}
    <button onClick={onAccept} disabled={!request.can_accept} className={cn('mt-3 w-full py-2 rounded-pill text-xs font-black transition-opacity', request.can_accept ? 'bg-gradient-to-r from-brand-primary to-gold text-white' : 'bg-bg-deep border border-line text-text-muted cursor-not-allowed')}>
      {request.can_accept ? '수락하기' : full ? '모집 완료' : request.blocked_reason ?? '수락 불가'}
    </button>
  </div>;
}

function AssignmentCard({ assignment: a, onSubmit, onCancel }: { assignment: StudentPublicAssignment; onSubmit?: () => void; onCancel?: () => void }) {
  const active = ['ACCEPTED', 'REVISION_REQUESTED'].includes(a.status);
  const badge = a.status === 'COMPLETED' ? 'text-success bg-success-bg border-success/30' : a.status === 'FAILED' || a.status === 'CANCELLED' ? 'text-danger bg-danger-bg border-danger/30' : a.status === 'REVISION_REQUESTED' ? 'text-warning bg-warning-bg border-warning/30' : 'text-brand-glow bg-brand-primary/10 border-line-brand';
  return <div className="bg-bg-card border border-line rounded-card-md p-3.5">
    <div className="flex items-start justify-between gap-3"><div><div className="font-extrabold text-sm">{a.request_title}</div><div className="text-2xs text-text-muted mt-1">{a.job_name} · 수락 {formatDateTime(a.accepted_at)}</div></div><span className={cn('px-2 py-1 rounded-pill border text-2xs font-black', badge)}>{ASSIGNMENT_LABEL[a.status]}</span></div>
    {a.teacher_feedback && <div className="mt-2 bg-bg-deep rounded-card-sm p-2 text-xs text-text-secondary">선생님 피드백: {a.teacher_feedback}</div>}
    {a.latest_submission && <div className="mt-2 text-xs text-text-secondary"><span className="font-bold">최근 완료 보고:</span> {a.latest_submission}</div>}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-text-muted"><span>마감 {formatDateTime(a.due_at)}</span>{a.submitted_at && <span>제출 {formatDateTime(a.submitted_at)}</span>}{a.reviewed_at && <span>검사 {formatDateTime(a.reviewed_at)}</span>}{a.status === 'COMPLETED' && <span className="text-gold font-black">+{formatNumber(a.reward_gold)} GOLD</span>}</div>
    {active && (onSubmit || onCancel) && <div className="flex gap-2 mt-3">{onCancel && <button className="btn-secondary flex-1" onClick={onCancel}>포기</button>}{onSubmit && <button className="btn-primary flex-[2]" onClick={onSubmit}>{a.status === 'REVISION_REQUESTED' ? '다시 완료 보고' : '완료 보고'}</button>}</div>}
  </div>;
}
