import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import {
  secondaryJobPublicTeacherRpc,
  type TeacherPublicAssignment,
  type TeacherPublicBoard,
  type TeacherPublicRequest,
} from '@/lib/rpc/secondary_job_public_request_rpc';
import type { PublicRequestEligibility } from '@/lib/zod_schemas/secondary_job_public_request_schemas';
import type { SecondaryJobCategory } from '@/lib/zod_schemas/secondary_job_schemas';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';

const CATEGORY_LABEL: Record<SecondaryJobCategory, string> = {
  STUDY: '📚 학습', CREATIVITY: '🎨 창작', SPORT: '🏃 체육', TECH: '💻 기술', COMFORT: '🌿 생활', CUSTOM: '✨ 자유',
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as SecondaryJobCategory[];
const STATUS_LABEL: Record<string, string> = { DRAFT: '초안', OPEN: '모집 중', CLOSED: '모집 마감', CANCELLED: '취소' };
const ASSIGNMENT_LABEL: Record<string, string> = { ACCEPTED: '수행 중', SUBMITTED: '검사 대기', REVISION_REQUESTED: '재수행', COMPLETED: '완료', FAILED: '실패', CANCELLED: '취소' };

type RequestForm = {
  id: number | null; title: string; description: string; rewardGold: number; eligibilityType: PublicRequestEligibility;
  requiredCategory: SecondaryJobCategory | null; requiredJobName: string; maxAssignees: number; dueAt: string;
};

function defaultDue() {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000); d.setMinutes(Math.ceil(d.getMinutes() / 10) * 10, 0, 0);
  return toLocalDateTimeInput(d.toISOString());
}
function toLocalDateTimeInput(value: string) {
  const d = new Date(value); const offset = d.getTimezoneOffset(); return new Date(d.getTime() - offset * 60_000).toISOString().slice(0, 16);
}
const EMPTY_FORM = (): RequestForm => ({ id: null, title: '', description: '', rewardGold: 100, eligibilityType: 'ANY', requiredCategory: null, requiredJobName: '', maxAssignees: 1, dueAt: defaultDue() });
function formatDateTime(value: string | null) { return value ? new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '-'; }

export default function SecondaryJobPublicRequestAdmin() {
  const classroomId = useClassroomId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [form, setForm] = useState<RequestForm | null>(null);
  const [publishConfirm, setPublishConfirm] = useState<TeacherPublicRequest | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<TeacherPublicRequest | null>(null);
  const [cancelRequest, setCancelRequest] = useState<TeacherPublicRequest | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [extendRequest, setExtendRequest] = useState<TeacherPublicRequest | null>(null);
  const [extendDueAt, setExtendDueAt] = useState('');
  const [reviewing, setReviewing] = useState<TeacherPublicAssignment | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REVISION' | 'FAIL'>('APPROVE');
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [cancelAssignment, setCancelAssignment] = useState<TeacherPublicAssignment | null>(null);
  const [assignmentCancelReason, setAssignmentCancelReason] = useState('');

  const board = useQuery<TeacherPublicBoard>({
    queryKey: ['teacher-secondary-job-public-board', classroomId], enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return { server_now: '', requests: [], assignments: [], job_options: [] };
      const result = await secondaryJobPublicTeacherRpc.board(supabase, classroomId);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
  });

  useEffect(() => {
    if (!classroomId) return;
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['teacher-secondary-job-public-board', classroomId] });
    const channels = [
      supabase.channel(`teacher-sj-public-requests:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_public_requests', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe(),
      supabase.channel(`teacher-sj-public-assignments:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_public_assignments', filter: `classroom_id=eq.${classroomId}` }, invalidate).subscribe(),
      supabase.channel(`teacher-sj-public-submissions:${classroomId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_public_submissions' }, invalidate).subscribe(),
    ];
    return () => { channels.forEach((ch) => void supabase.removeChannel(ch)); };
  }, [classroomId, queryClient]);

  const requests = board.data?.requests ?? [];
  const assignments = board.data?.assignments ?? [];
  const submittedCount = assignments.filter((a) => a.status === 'SUBMITTED').length;
  const formValid = !!form && form.title.trim().length >= 2 && form.description.trim().length >= 10 && form.rewardGold >= 1 && form.rewardGold <= 1_000_000 && form.maxAssignees >= 1 && form.maxAssignees <= 24 && new Date(form.dueAt).getTime() > Date.now() && (form.eligibilityType !== 'CATEGORY' || !!form.requiredCategory) && (form.eligibilityType !== 'JOB_NAME' || !!form.requiredJobName.trim());

  const refresh = () => { void board.refetch(); void queryClient.invalidateQueries({ queryKey: ['secondary-job-public-board'] }); };
  const commonPayload = () => ({
    p_title: form!.title, p_description: form!.description, p_reward_gold: form!.rewardGold,
    p_eligibility_type: form!.eligibilityType, p_required_category: form!.eligibilityType === 'CATEGORY' ? form!.requiredCategory : null,
    p_required_job_name: form!.eligibilityType === 'JOB_NAME' ? form!.requiredJobName : null, p_max_assignees: form!.maxAssignees,
    p_due_at: new Date(form!.dueAt).toISOString(),
  });

  const saveForm = async (publish: boolean) => {
    if (!form || !classroomId || !formValid) return;
    if (form.id) {
      await call(() => secondaryJobPublicTeacherRpc.update(supabase, { p_request_id: form.id, ...commonPayload() }), {
        successTitle: '공공 의뢰 초안 수정 완료', onSuccess: () => { setForm(null); refresh(); },
      });
      return;
    }
    await call(() => secondaryJobPublicTeacherRpc.create(supabase, { p_classroom_id: classroomId, ...commonPayload(), p_publish: publish }), {
      successTitle: publish ? '📋 공공 의뢰 공개 완료' : '공공 의뢰 초안 저장 완료', onSuccess: () => { setForm(null); refresh(); },
    });
  };

  const edit = (r: TeacherPublicRequest) => setForm({ id: r.id, title: r.title, description: r.description, rewardGold: r.reward_gold, eligibilityType: r.eligibility_type, requiredCategory: (r.required_category as SecondaryJobCategory | null), requiredJobName: r.required_job_name ?? '', maxAssignees: r.max_assignees, dueAt: toLocalDateTimeInput(r.due_at) });
  const simple = async (kind: 'publish' | 'close' | 'reopen' | 'delete', r: TeacherPublicRequest) => {
    const fn = kind === 'publish' ? secondaryJobPublicTeacherRpc.publish : kind === 'close' ? secondaryJobPublicTeacherRpc.close : kind === 'reopen' ? secondaryJobPublicTeacherRpc.reopen : secondaryJobPublicTeacherRpc.remove;
    await call(() => fn(supabase, { p_request_id: r.id }), { successTitle: kind === 'publish' ? '공공 의뢰 공개 완료' : kind === 'close' ? '모집 마감 완료' : kind === 'reopen' ? '모집 재오픈 완료' : '초안 삭제 완료', onSuccess: () => { setPublishConfirm(null); setDeleteConfirm(null); refresh(); } });
  };
  const extend = async () => { if (!extendRequest || !extendDueAt) return; await call(() => secondaryJobPublicTeacherRpc.extend(supabase, { p_request_id: extendRequest.id, p_due_at: new Date(extendDueAt).toISOString() }), { successTitle: '마감 연장 완료', onSuccess: () => { setExtendRequest(null); setExtendDueAt(''); refresh(); } }); };
  const cancelWholeRequest = async () => { if (!cancelRequest) return; await call(() => secondaryJobPublicTeacherRpc.cancelRequest(supabase, { p_request_id: cancelRequest.id, p_reason: cancelReason }), { successTitle: '공공 의뢰 취소 완료', onSuccess: () => { setCancelRequest(null); setCancelReason(''); refresh(); } }); };
  const review = async () => { if (!reviewing) return; await call(() => secondaryJobPublicTeacherRpc.review(supabase, { p_assignment_id: reviewing.id, p_action: reviewAction, p_feedback: reviewFeedback.trim() || null }), { successTitle: reviewAction === 'APPROVE' ? `✅ 승인 + ${formatNumber(reviewing.reward_gold)} GOLD 지급 완료` : reviewAction === 'REVISION' ? '재수행 요청 완료' : '실패 처리 완료', onSuccess: () => { setReviewing(null); setReviewFeedback(''); setReviewAction('APPROVE'); refresh(); void queryClient.invalidateQueries({ queryKey: ['wallet'] }); } }); };
  const teacherCancelAssignment = async () => { if (!cancelAssignment) return; await call(() => secondaryJobPublicTeacherRpc.cancelAssignment(supabase, { p_assignment_id: cancelAssignment.id, p_reason: assignmentCancelReason }), { successTitle: '배정 취소 완료', onSuccess: () => { setCancelAssignment(null); setAssignmentCancelReason(''); refresh(); } }); };

  return <TeacherShell><div className="space-y-5 pb-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><button onClick={() => navigate('/teacher/secondary-jobs')} className="text-xs font-bold text-brand-glow hover:underline">← 2차직업 운영으로</button><h1 className="font-display text-2xl text-brand-gradient mt-2">📋 공공 의뢰 관리</h1><p className="text-sm text-text-secondary mt-1">공개 → 학생 수락 → 완료 보고 → 검사 → GOLD 보상까지 관리합니다.</p></div>
      <button className="btn-primary" onClick={() => setForm(EMPTY_FORM())}>+ 새 공공 의뢰</button>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
      <Summary label="모집 중" value={requests.filter((r) => r.status === 'OPEN').length} />
      <Summary label="초안" value={requests.filter((r) => r.status === 'DRAFT').length} />
      <Summary label="검사 대기" value={submittedCount} emphasis={submittedCount > 0} />
      <Summary label="완료 수행" value={assignments.filter((a) => a.status === 'COMPLETED').length} />
    </div>

    {board.isLoading ? <div className="py-10 flex justify-center"><LoadingSpinner size="lg" /></div> : board.isError ? <div className="bg-danger-bg border border-danger/40 rounded-card-md p-4 text-danger text-sm">공공 의뢰 관리 데이터를 불러오지 못했습니다.</div> : requests.length === 0 ? <EmptyState emoji="📭" title="등록된 공공 의뢰가 없습니다" description="오른쪽 위 ‘새 공공 의뢰’에서 첫 의뢰를 만들어보세요." /> : <div className="space-y-3">
      {requests.map((r) => <RequestAdminCard key={r.id} request={r} assignments={assignments.filter((a) => a.request_id === r.id)} onEdit={() => edit(r)} onPublish={() => setPublishConfirm(r)} onDelete={() => setDeleteConfirm(r)} onClose={() => void simple('close', r)} onReopen={() => void simple('reopen', r)} onExtend={() => { setExtendRequest(r); setExtendDueAt(toLocalDateTimeInput(new Date(Math.max(Date.now(), new Date(r.due_at).getTime()) + 60 * 60 * 1000).toISOString())); }} onCancel={() => { setCancelRequest(r); setCancelReason(''); }} onReview={(a) => { setReviewing(a); setReviewAction('APPROVE'); setReviewFeedback(''); }} onCancelAssignment={(a) => { setCancelAssignment(a); setAssignmentCancelReason(''); }} />)}
    </div>}

    {form && <Modal isOpen onClose={() => setForm(null)} title={form.id ? '공공 의뢰 초안 수정' : '새 공공 의뢰'}><div className="space-y-3">
      <label className="block"><span className="text-xs font-bold text-text-secondary">제목</span><input className="input-field w-full mt-1" maxLength={100} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label className="block"><span className="text-xs font-bold text-text-secondary">상세 설명</span><textarea className="input-field w-full mt-1 resize-none" rows={5} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      <div className="grid grid-cols-2 gap-2.5"><label><span className="text-xs font-bold text-text-secondary">보상 GOLD</span><input type="number" min={1} max={1000000} className="input-field w-full mt-1" value={form.rewardGold} onChange={(e) => setForm({ ...form, rewardGold: Number(e.target.value) })} /></label><label><span className="text-xs font-bold text-text-secondary">모집 인원</span><input type="number" min={1} max={24} className="input-field w-full mt-1" value={form.maxAssignees} onChange={(e) => setForm({ ...form, maxAssignees: Number(e.target.value) })} /></label></div>
      <label className="block"><span className="text-xs font-bold text-text-secondary">수행 자격</span><select className="input-field w-full mt-1" value={form.eligibilityType} onChange={(e) => setForm({ ...form, eligibilityType: e.target.value as PublicRequestEligibility, requiredCategory: null, requiredJobName: '' })}><option value="ANY">모든 활성 2차직업</option><option value="CATEGORY">특정 분야</option><option value="JOB_NAME">특정 2차직업</option></select></label>
      {form.eligibilityType === 'CATEGORY' && <label className="block"><span className="text-xs font-bold text-text-secondary">필요 분야</span><select className="input-field w-full mt-1" value={form.requiredCategory ?? ''} onChange={(e) => setForm({ ...form, requiredCategory: e.target.value as SecondaryJobCategory })}><option value="">선택</option>{CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>}
      {form.eligibilityType === 'JOB_NAME' && <label className="block"><span className="text-xs font-bold text-text-secondary">필요 2차직업</span><select className="input-field w-full mt-1" value={form.requiredJobName} onChange={(e) => setForm({ ...form, requiredJobName: e.target.value })}><option value="">선택</option>{(board.data?.job_options ?? []).map((o) => <option key={`${o.job_name}:${o.category}`} value={o.job_name}>{o.job_name} · {CATEGORY_LABEL[o.category as SecondaryJobCategory] ?? o.category} · {o.holders}명</option>)}</select>{(board.data?.job_options ?? []).length === 0 && <div className="text-2xs text-warning mt-1">현재 활동 중인 2차직업이 없어 특정 직업을 선택할 수 없습니다.</div>}</label>}
      <label className="block"><span className="text-xs font-bold text-text-secondary">마감 날짜·시간</span><input type="datetime-local" className="input-field w-full mt-1" value={form.dueAt} onChange={(e) => setForm({ ...form, dueAt: e.target.value })} /></label>
      {!formValid && <div className="text-xs text-warning bg-warning-bg border border-warning/30 rounded-card-sm p-2">제목 2자+, 설명 10자+, 보상/인원, 미래 마감 시간과 수행 자격을 모두 확인해주세요.</div>}
      <div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setForm(null)}>취소</button><button className="btn-secondary flex-1" disabled={isLoading || !formValid} onClick={() => void saveForm(false)}>{form.id ? '수정 저장' : '초안 저장'}</button>{!form.id && <button className="btn-primary flex-1" disabled={isLoading || !formValid} onClick={() => void saveForm(true)}>바로 공개</button>}</div>
    </div></Modal>}

    {publishConfirm && <Modal isOpen onClose={() => setPublishConfirm(null)} title="공공 의뢰 공개"><div className="space-y-3"><p className="text-sm"><b>{publishConfirm.title}</b>을 학생 게시판에 공개합니다. 공개 후에는 보상·자격·모집인원 같은 핵심 조건을 수정하지 않고, 마감 연장/모집 마감/취소로 관리합니다.</p><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setPublishConfirm(null)}>취소</button><button className="btn-primary flex-1" disabled={isLoading} onClick={() => void simple('publish', publishConfirm)}>공개 확정</button></div></div></Modal>}
    {deleteConfirm && <Modal isOpen onClose={() => setDeleteConfirm(null)} title="공공 의뢰 초안 삭제"><div className="space-y-3"><p className="text-sm"><b>{deleteConfirm.title}</b> 초안을 완전히 삭제합니다.</p><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setDeleteConfirm(null)}>취소</button><button className="btn-danger flex-1" disabled={isLoading} onClick={() => void simple('delete', deleteConfirm)}>삭제 확정</button></div></div></Modal>}
    {extendRequest && <Modal isOpen onClose={() => setExtendRequest(null)} title="마감 연장"><div className="space-y-3"><p className="text-sm">현재 마감: <b>{formatDateTime(extendRequest.due_at)}</b></p><input type="datetime-local" className="input-field w-full" value={extendDueAt} onChange={(e) => setExtendDueAt(e.target.value)} /><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setExtendRequest(null)}>취소</button><button className="btn-primary flex-1" disabled={isLoading || !extendDueAt || new Date(extendDueAt).getTime() <= Math.max(Date.now(), new Date(extendRequest.due_at).getTime())} onClick={extend}>연장 확정</button></div></div></Modal>}
    {cancelRequest && <Modal isOpen onClose={() => setCancelRequest(null)} title="공공 의뢰 취소"><div className="space-y-3"><p className="text-sm">공개된 <b>{cancelRequest.title}</b>을 취소합니다. 진행 중 학생에게도 취소 알림이 전송됩니다.</p><textarea className="input-field w-full resize-none" rows={4} maxLength={500} placeholder="취소 사유 2자 이상" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setCancelRequest(null)}>유지</button><button className="btn-danger flex-1" disabled={isLoading || cancelReason.trim().length < 2} onClick={cancelWholeRequest}>의뢰 취소</button></div></div></Modal>}
    {reviewing && <Modal isOpen onClose={() => setReviewing(null)} title="공공 의뢰 검사"><div className="space-y-3"><div><div className="font-extrabold">{reviewing.student_name} · {reviewing.request_title}</div><div className="text-xs text-text-secondary mt-1">{reviewing.job_name} · 보상 {formatNumber(reviewing.reward_gold)} GOLD</div></div><div className="bg-bg-deep rounded-card-sm p-3 text-sm whitespace-pre-wrap">{reviewing.latest_submission ?? '제출 내용 없음'}</div><div className="grid grid-cols-3 gap-2">{(['APPROVE','REVISION','FAIL'] as const).map((a) => <button key={a} onClick={() => setReviewAction(a)} className={cn('py-2 rounded-card-sm border text-xs font-black', reviewAction === a ? 'border-line-brand bg-brand-primary/15 text-brand-glow' : 'border-line text-text-secondary')}>{a === 'APPROVE' ? '승인+보상' : a === 'REVISION' ? '재수행' : '실패'}</button>)}</div><textarea className="input-field w-full resize-none" rows={4} maxLength={500} placeholder={reviewAction === 'APPROVE' ? '피드백(선택)' : '사유 2자 이상 필수'} value={reviewFeedback} onChange={(e) => setReviewFeedback(e.target.value)} /><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setReviewing(null)}>취소</button><button className={reviewAction === 'APPROVE' ? 'btn-primary flex-1' : 'btn-danger flex-1'} disabled={isLoading || ((reviewAction === 'REVISION' || reviewAction === 'FAIL') && reviewFeedback.trim().length < 2)} onClick={review}>{reviewAction === 'APPROVE' ? `승인 + ${formatNumber(reviewing.reward_gold)} GOLD` : reviewAction === 'REVISION' ? '재수행 요청' : '실패 처리'}</button></div></div></Modal>}
    {cancelAssignment && <Modal isOpen onClose={() => setCancelAssignment(null)} title="학생 배정 취소"><div className="space-y-3"><p className="text-sm"><b>{cancelAssignment.student_name}</b>의 <b>{cancelAssignment.request_title}</b> 배정을 취소합니다. 빈 모집 자리는 다시 열립니다.</p><textarea className="input-field w-full resize-none" rows={4} maxLength={500} placeholder="취소 사유 2자 이상" value={assignmentCancelReason} onChange={(e) => setAssignmentCancelReason(e.target.value)} /><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={() => setCancelAssignment(null)}>유지</button><button className="btn-danger flex-1" disabled={isLoading || assignmentCancelReason.trim().length < 2} onClick={teacherCancelAssignment}>배정 취소</button></div></div></Modal>}
  </div></TeacherShell>;
}

function Summary({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) { return <div className={cn('bg-bg-card border rounded-card-md p-3', emphasis ? 'border-warning/50' : 'border-line')}><div className="text-2xs text-text-muted font-bold">{label}</div><div className={cn('font-display text-xl mt-1', emphasis ? 'text-warning' : 'text-white')}>{value}</div></div>; }

function RequestAdminCard({ request: r, assignments, onEdit, onPublish, onDelete, onClose, onReopen, onExtend, onCancel, onReview, onCancelAssignment }: {
  request: TeacherPublicRequest; assignments: TeacherPublicAssignment[]; onEdit: () => void; onPublish: () => void; onDelete: () => void; onClose: () => void; onReopen: () => void; onExtend: () => void; onCancel: () => void; onReview: (a: TeacherPublicAssignment) => void; onCancelAssignment: (a: TeacherPublicAssignment) => void;
}) {
  const pastDue = new Date(r.due_at).getTime() <= Date.now();
  const eligibility = r.eligibility_type === 'ANY' ? '모든 2차직업' : r.eligibility_type === 'CATEGORY' ? `${CATEGORY_LABEL[r.required_category as SecondaryJobCategory] ?? r.required_category} 분야` : r.required_job_name;
  const statusClass = r.status === 'OPEN' ? 'text-success' : r.status === 'DRAFT' ? 'text-warning' : r.status === 'CANCELLED' ? 'text-danger' : 'text-text-secondary';
  return <section className="bg-bg-card border border-line rounded-card-lg p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className={cn('text-2xs font-black', statusClass)}>{STATUS_LABEL[r.status]}{pastDue && r.status !== 'DRAFT' && r.status !== 'CANCELLED' ? ' · 시간 만료' : ''}</span><span className="text-2xs text-text-muted">#{r.id}</span></div><h2 className="font-display text-lg text-white mt-1">{r.title}</h2><p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">{r.description}</p></div><div className="text-right shrink-0"><div className="font-display text-lg text-gold">🪙 {formatNumber(r.reward_gold)}</div><div className="text-2xs text-text-muted">{r.active_assignees}/{r.max_assignees}명 · 완료 {r.completed_count}</div></div></div>
    <div className="mt-3 flex flex-wrap gap-2 text-2xs text-text-muted"><span>자격 {eligibility}</span><span>·</span><span>마감 {formatDateTime(r.due_at)}</span>{r.submitted_count > 0 && <><span>·</span><span className="text-warning font-black">검사 대기 {r.submitted_count}</span></>}</div>
    <div className="flex flex-wrap gap-2 mt-3">
      {r.status === 'DRAFT' && <><button className="btn-secondary" onClick={onEdit}>수정</button><button className="btn-primary" onClick={onPublish}>공개</button><button className="px-3 py-2 rounded-pill border border-danger/40 text-danger text-xs font-black" onClick={onDelete}>삭제</button></>}
      {r.status === 'OPEN' && <><button className="btn-secondary" onClick={onExtend}>마감 연장</button><button className="btn-secondary" onClick={onClose}>모집 마감</button><button className="px-3 py-2 rounded-pill border border-danger/40 text-danger text-xs font-black" onClick={onCancel}>의뢰 취소</button></>}
      {r.status === 'CLOSED' && <><button className="btn-secondary" onClick={onExtend}>마감 연장</button><button className="btn-primary" onClick={onReopen} disabled={pastDue || r.active_assignees >= r.max_assignees} title={pastDue ? '먼저 마감 시간을 연장해주세요.' : r.active_assignees >= r.max_assignees ? '모집 인원이 모두 찼습니다.' : ''}>재오픈</button><button className="px-3 py-2 rounded-pill border border-danger/40 text-danger text-xs font-black" onClick={onCancel}>의뢰 취소</button>{pastDue && <span className="self-center text-2xs text-warning">재오픈하려면 먼저 마감 연장</span>}</>}
      {r.status === 'CANCELLED' && <span className="text-xs text-text-muted">종료된 의뢰 · 이력 보존</span>}
    </div>
    {assignments.length > 0 && <details className="mt-4 border-t border-line pt-3" open={assignments.some((a) => a.status === 'SUBMITTED')}><summary className="cursor-pointer text-sm font-extrabold text-text-secondary">수행자 / 검사 {assignments.length}건</summary><div className="mt-3 space-y-2">{assignments.map((a) => <div key={a.id} className={cn('rounded-card-sm border p-3', a.status === 'SUBMITTED' ? 'border-warning/50 bg-warning-bg/30' : 'border-line bg-bg-deep/40')}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-bold text-sm">{a.student_name} · {a.job_name}</div><div className="text-2xs text-text-muted mt-1">수락 {formatDateTime(a.accepted_at)}{a.submitted_at ? ` · 제출 ${formatDateTime(a.submitted_at)}` : ''}</div></div><span className={cn('text-2xs font-black', a.status === 'SUBMITTED' ? 'text-warning' : a.status === 'COMPLETED' ? 'text-success' : a.status === 'FAILED' || a.status === 'CANCELLED' ? 'text-danger' : 'text-brand-glow')}>{ASSIGNMENT_LABEL[a.status]}</span></div>{a.latest_submission && <div className="text-xs text-text-secondary mt-2 line-clamp-3">{a.latest_submission}</div>}{a.teacher_feedback && <div className="text-2xs text-text-muted mt-1">피드백: {a.teacher_feedback}</div>}<div className="flex gap-2 mt-2">{a.status === 'SUBMITTED' && <button className="btn-primary" onClick={() => onReview(a)}>검사하기</button>}{!['COMPLETED','FAILED','CANCELLED'].includes(a.status) && <button className="btn-secondary" onClick={() => onCancelAssignment(a)}>배정 취소</button>}</div></div>)}</div></details>}
  </section>;
}
