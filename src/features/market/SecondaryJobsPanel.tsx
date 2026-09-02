import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { secondaryJobStudentRpc, type SecondaryJobStatus } from '@/lib/rpc/secondary_job_rpc';
import { useClassroomId, useCurrentStudent, useStudentId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';

const CATEGORY_LABEL: Record<string, string> = {
  STUDY: '📚 학습', CREATIVITY: '🎨 창작', SPORT: '🏃 체육', TECH: '💻 기술', COMFORT: '🌿 생활', CUSTOM: '✨ 자유',
};

type Catalog = {
  id: number;
  category: string;
  templateName: string;
  templateDescription: string | null;
  suggestedPriceRange: string | null;
  unlockTier: string;
};

type Job = {
  id: number;
  studentId: number;
  studentName: string;
  jobName: string;
  description: string;
  approvedAt: string;
};

type Application = {
  id: number;
  jobName: string;
  description: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason: string | null;
  createdAt: string;
  reviewedAt: string | null;
};

export default function SecondaryJobsPanel() {
  const classroomId = useClassroomId();
  const studentId = useStudentId();
  const current = useCurrentStudent();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { call, isLoading: isSubmitting } = useRpcCall();
  const [selected, setSelected] = useState<Catalog | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [jobName, setJobName] = useState('');
  const [description, setDescription] = useState('');

  const statusQuery = useQuery<SecondaryJobStatus | null>({
    queryKey: ['secondary-job-status', studentId],
    enabled: studentId !== null,
    queryFn: async () => {
      const result = await secondaryJobStudentRpc.status(supabase);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
  });

  const catalogQuery = useQuery<Catalog[]>({
    queryKey: ['secondary-job-catalogs', classroomId],
    enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase
        .from('secondary_job_catalogs')
        .select('id,category,template_name,template_description,suggested_price_range,unlock_tier,classroom_id,sort_order')
        .eq('is_active', true)
        .or(`classroom_id.is.null,classroom_id.eq.${classroomId}`)
        .order('sort_order', { ascending: true })
        .order('id', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id,
        category: row.category,
        templateName: row.template_name,
        templateDescription: row.template_description,
        suggestedPriceRange: row.suggested_price_range,
        unlockTier: row.unlock_tier,
      }));
    },
  });

  const jobsQuery = useQuery<Job[]>({
    queryKey: ['secondary-jobs', classroomId],
    enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase
        .from('secondary_jobs')
        .select('id,student_id,job_name,description,approved_at,student:students!student_id(name)')
        .eq('classroom_id', classroomId)
        .eq('is_active', true)
        .order('approved_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((j: any) => ({
        id: j.id,
        studentId: j.student_id,
        studentName: j.student?.name ?? '',
        jobName: j.job_name,
        description: j.description ?? '',
        approvedAt: j.approved_at,
      }));
    },
  });

  const appQuery = useQuery<Application[]>({
    queryKey: ['my-secondary-job-applications', studentId],
    enabled: studentId !== null,
    queryFn: async () => {
      if (!studentId) return [];
      const { data, error } = await supabase
        .from('secondary_job_applications')
        .select('id,job_name,description,status,rejection_reason,created_at,reviewed_at')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []).map((a: any) => ({
        id: a.id,
        jobName: a.job_name,
        description: a.description,
        status: a.status,
        rejectionReason: a.rejection_reason,
        createdAt: a.created_at,
        reviewedAt: a.reviewed_at,
      }));
    },
  });

  useEffect(() => {
    if (!studentId || !classroomId) return;
    const invalidateApplications = () => {
      void queryClient.invalidateQueries({ queryKey: ['my-secondary-job-applications', studentId] });
      void queryClient.invalidateQueries({ queryKey: ['secondary-job-status', studentId] });
    };
    const invalidateJobs = () => {
      void queryClient.invalidateQueries({ queryKey: ['secondary-jobs', classroomId] });
      void queryClient.invalidateQueries({ queryKey: ['secondary-job-status', studentId] });
    };
    const appsChannel = supabase
      .channel(`secondary-job-apps:${studentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_applications', filter: `student_id=eq.${studentId}` }, invalidateApplications)
      .subscribe();
    const jobsChannel = supabase
      .channel(`secondary-jobs:${classroomId}:${studentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_jobs', filter: `classroom_id=eq.${classroomId}` }, invalidateJobs)
      .subscribe();
    return () => {
      void supabase.removeChannel(appsChannel);
      void supabase.removeChannel(jobsChannel);
    };
  }, [classroomId, queryClient, studentId]);

  const myJobs = useMemo(() => (jobsQuery.data ?? []).filter((job) => job.studentId === studentId), [jobsQuery.data, studentId]);
  const status = statusQuery.data;
  const canApply = !!status?.eligible && !status.employment_freeze && status.remaining_slots > 0;
  const pendingCount = useMemo(() => (appQuery.data ?? []).filter((app) => app.status === 'PENDING').length, [appQuery.data]);
  const formatDateTime = (value: string | null) => value ? new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '-';

  const openCatalog = (catalog: Catalog) => {
    setSelected(catalog);
    setCustomMode(false);
    setJobName(catalog.templateName);
    setDescription('');
  };
  const openCustom = () => {
    setSelected(null);
    setCustomMode(true);
    setJobName('');
    setDescription('');
  };
  const closeModal = () => {
    setSelected(null);
    setCustomMode(false);
    setJobName('');
    setDescription('');
  };

  const submit = async () => {
    if (!studentId) return;
    await call(
      () => secondaryJobStudentRpc.apply(supabase, {
        p_student_id: studentId,
        p_job_name: jobName,
        p_description: description,
      }),
      {
        successTitle: '💼 2차직업 신청 완료',
        successDescription: '선생님의 승인을 기다려주세요.',
        onSuccess: () => {
          closeModal();
          void queryClient.invalidateQueries({ queryKey: ['secondary-job-status', studentId] });
          void queryClient.invalidateQueries({ queryKey: ['my-secondary-job-applications', studentId] });
          void queryClient.invalidateQueries({ queryKey: ['teacher-dashboard'] });
        },
      },
    );
  };

  if (statusQuery.isLoading || jobsQuery.isLoading || catalogQuery.isLoading || appQuery.isLoading) {
    return <div className="py-10 flex justify-center"><LoadingSpinner size="lg" /></div>;
  }

  return (
    <div className="space-y-4 pb-6">
      <section className="bg-bg-card border border-line rounded-card-lg px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-black text-text-muted">내 2차직업</span>
              <span className="font-display text-lg text-brand-gradient">{myJobs.length}/{status?.slot_limit ?? 3}</span>
            </div>
            <span className="text-2xs text-text-secondary">현재 {status?.current_tier ?? current?.cachedTier ?? '확인 중'} · 해금 {status?.unlock_tier ?? '금 광석'}</span>
            {myJobs.map((job) => (
              <span key={job.id} className="max-w-[220px] truncate rounded-pill border border-line-brand bg-brand-primary/10 px-2.5 py-1 text-2xs font-black text-brand-glow">💼 {job.jobName}</span>
            ))}
            {myJobs.length === 0 && <span className="text-2xs text-text-muted">활동 중인 직업 없음</span>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            <span className={cn('px-2.5 py-1 rounded-pill text-2xs font-black border', status?.eligible ? 'text-success border-success/40 bg-success-bg' : 'text-warning border-warning/40 bg-warning-bg')}>
              {status?.eligible ? `신청 가능 · ${status.remaining_slots}칸 남음` : '티어 잠금'}
            </span>
            <button
              type="button"
              onClick={openCustom}
              disabled={!canApply}
              className="px-3 py-2 rounded-pill bg-brand-primary text-white border border-brand-primary/60 text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ＋ 2차직업 신청
            </button>
            <button
              type="button"
              onClick={() => navigate('/market/services?view=services')}
              disabled={myJobs.length === 0}
              className="px-3 py-2 rounded-pill bg-brand-primary/20 text-brand-glow border border-line-brand text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed"
            >
              🧰 서비스 등록/관리
            </button>
          </div>
        </div>
        {status?.employment_freeze && <div className="mt-2 p-2 rounded-card-sm bg-danger-bg border border-danger/30 text-xs font-bold text-danger">🚫 현재 고용 동결 중이라 신규 신청이 중단되어 있습니다.</div>}
        {myJobs.length === 0 && <div className="mt-2 text-2xs text-warning">활성 2차직업이 생기면 여기서 바로 서비스를 등록할 수 있습니다.</div>}
      </section>

      <section>
        <h3 className="font-display text-lg text-white mb-2">우리 반 2차직업 리스트</h3>
        {!jobsQuery.data?.length ? (
          <EmptyState emoji="💼" title="활동 중인 2차직업이 아직 없어요" />
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {jobsQuery.data.map((job) => (
              <motion.div key={job.id} whileTap={{ scale: 0.99 }} className={cn('bg-bg-card border rounded-card-md p-3', job.studentId === studentId ? 'border-line-brand' : 'border-line')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-display text-sm text-brand-gradient truncate">{job.jobName}</div>
                    <div className="mt-1 truncate text-xs font-extrabold text-slate-200">👤 {job.studentName}</div>
                  </div>
                  {job.studentId === studentId && <span className="shrink-0 text-[10px] rounded-pill bg-brand-primary/15 px-2 py-0.5 font-black text-brand-glow">내 직업</span>}
                </div>
                {job.description && <p className="mt-2 line-clamp-2 text-xs font-medium leading-relaxed text-slate-300">{job.description}</p>}
              </motion.div>
            ))}
          </div>
        )}
      </section>

      <details className="group bg-bg-card border border-line rounded-card-lg">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none">
          <div>
            <h3 className="font-display text-lg text-white">2차직업 카탈로그</h3>
            <p className="text-2xs text-text-muted mt-0.5">추천 직업 {(catalogQuery.data ?? []).length}개 · 눌러서 펼치기</p>
          </div>
          <span className="text-text-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-4 py-4">
          <div className="flex items-center justify-end mb-3">
            <button onClick={openCustom} disabled={!canApply} className="px-3 py-2 rounded-pill bg-brand-primary/20 text-brand-glow border border-line-brand text-xs font-black disabled:opacity-40">✨ 직접 제안</button>
          </div>
          {(catalogQuery.data ?? []).length === 0 ? (
            <div className="bg-bg-deep border border-line rounded-card-md p-4 text-center"><div className="text-3xl mb-2">📭</div><div className="font-extrabold">등록된 추천 직업이 아직 없어요</div><div className="text-xs text-text-secondary mt-1">직접 제안은 사용할 수 있습니다.</div></div>
          ) : (
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
              {(catalogQuery.data ?? []).map((catalog) => (
                <motion.button key={catalog.id} whileTap={{ scale: 0.98 }} onClick={() => openCatalog(catalog)} disabled={!canApply} className="text-left bg-bg-deep border border-line rounded-card-md p-3 disabled:opacity-45">
                  <div className="flex justify-between gap-2"><span className="text-2xs font-black text-brand-glow">{CATEGORY_LABEL[catalog.category] ?? catalog.category}</span><span className="text-2xs text-text-muted">{catalog.unlockTier}+</span></div>
                  <div className="font-display text-sm text-white mt-1">{catalog.templateName}</div>
                  {catalog.templateDescription && <div className="text-xs text-text-secondary mt-1.5 line-clamp-2">{catalog.templateDescription}</div>}
                  {catalog.suggestedPriceRange && <div className="text-2xs text-gold mt-2 font-bold">권장 단가 {catalog.suggestedPriceRange}</div>}
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </details>

      <details className="group bg-bg-card border border-line rounded-card-lg">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 select-none">
          <div>
            <h3 className="font-display text-lg text-white">내 신청 기록</h3>
            <p className="text-2xs text-text-muted mt-0.5">총 {(appQuery.data ?? []).length}건{pendingCount > 0 ? ` · 검토 중 ${pendingCount}건` : ''} · 눌러서 펼치기</p>
          </div>
          <span className="text-text-muted transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="border-t border-line px-4 py-4">
          {(appQuery.data ?? []).length === 0 ? (
            <div className="text-xs text-text-muted py-1">아직 신청 기록이 없습니다.</div>
          ) : (
            <div className="space-y-2">{(appQuery.data ?? []).map((app) => <div key={app.id} className="bg-bg-deep border border-line rounded-card-sm p-3 flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-extrabold text-sm">{app.jobName}</div><div className="text-2xs text-text-muted mt-1">신청 {formatDateTime(app.createdAt)}{app.reviewedAt ? ` · ${app.status === 'APPROVED' ? '승인' : '반려'} ${formatDateTime(app.reviewedAt)}` : ''}</div>{app.status === 'REJECTED' && app.rejectionReason && <div className="text-xs text-danger mt-1">사유: {app.rejectionReason}</div>}</div><span className={cn('shrink-0 text-2xs font-black px-2 py-1 rounded-pill', app.status === 'PENDING' ? 'bg-warning-bg text-warning' : app.status === 'APPROVED' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger')}>{app.status === 'PENDING' ? '검토 중' : app.status === 'APPROVED' ? '승인' : '거절'}</span></div>)}</div>
          )}
        </div>
      </details>

      {(selected || customMode) && <Modal isOpen onClose={closeModal} title={selected ? `${selected.templateName} 신청` : '2차직업 직접 제안'}><div className="space-y-3">
        {customMode && <label className="block"><span className="text-xs font-bold text-text-secondary">직업명</span><input value={jobName} onChange={(e) => setJobName(e.target.value)} maxLength={50} className="input-field mt-1 w-full" placeholder="예: 문제 해결 도우미" /></label>}
        <label className="block"><span className="text-xs font-bold text-text-secondary">활동 계획 · 설명</span><textarea value={description} onChange={(e) => setDescription(e.target.value)} minLength={10} maxLength={500} rows={5} className="input-field mt-1 w-full resize-none" placeholder="이 직업으로 어떤 활동을 할지 10자 이상 구체적으로 적어주세요." /></label>
        <div className="text-right text-2xs text-text-muted">{description.trim().length}/500</div>
        <div className="flex gap-2"><button onClick={closeModal} className="btn-secondary flex-1">취소</button><button onClick={submit} disabled={isSubmitting || !canApply || jobName.trim().length < 1 || description.trim().length < 10} className="btn-primary flex-1">{isSubmitting ? '신청 중...' : '신청하기'}</button></div>
      </div></Modal>}
    </div>
  );
}
