import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { secondaryJobTeacherRpc } from '@/lib/rpc/secondary_job_rpc';
import { useClassroomId } from '@/stores/auth_store';
import type { SecondaryJobCategory } from '@/lib/zod_schemas/secondary_job_schemas';
import { TIER_THRESHOLDS } from '@/constants/tier_thresholds';

const CATEGORY_LABEL: Record<SecondaryJobCategory, string> = {
  STUDY: '📚 학습', CREATIVITY: '🎨 창작', SPORT: '🏃 체육', TECH: '💻 기술', COMFORT: '🌿 생활', CUSTOM: '✨ 자유',
};
const CATEGORIES = Object.keys(CATEGORY_LABEL) as SecondaryJobCategory[];

type Catalog = {
  id: number;
  classroomId: number | null;
  category: SecondaryJobCategory;
  templateName: string;
  templateDescription: string | null;
  suggestedPriceRange: string | null;
  unlockTier: string;
  isActive: boolean;
  sortOrder: number;
};

type ActiveJob = {
  id: number;
  studentName: string;
  jobName: string;
  description: string | null;
  approvedAt: string;
  tierAtApproval: string | null;
};

const EMPTY_FORM = {
  id: null as number | null,
  category: 'CUSTOM' as SecondaryJobCategory,
  name: '', description: '', price: '', unlockTier: '금 광석', sortOrder: 0, isActive: true,
};

export default function SecondaryJobAdmin() {
  const classroomId = useClassroomId();
  const queryClient = useQueryClient();
  const { call, isLoading } = useRpcCall();
  const [form, setForm] = useState(EMPTY_FORM);
  const [releaseJob, setReleaseJob] = useState<ActiveJob | null>(null);
  const [releaseReason, setReleaseReason] = useState('');
  const [deleteCatalog, setDeleteCatalog] = useState<Catalog | null>(null);

  const catalogs = useQuery<Catalog[]>({
    queryKey: ['teacher-secondary-job-catalogs', classroomId], enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase.from('secondary_job_catalogs')
        .select('id,classroom_id,category,template_name,template_description,suggested_price_range,unlock_tier,is_active,sort_order')
        .or(`classroom_id.is.null,classroom_id.eq.${classroomId}`)
        .order('sort_order').order('id');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ id:r.id,classroomId:r.classroom_id,category:r.category,templateName:r.template_name,templateDescription:r.template_description,suggestedPriceRange:r.suggested_price_range,unlockTier:r.unlock_tier,isActive:r.is_active,sortOrder:r.sort_order }));
    },
  });

  const jobs = useQuery<ActiveJob[]>({
    queryKey: ['teacher-secondary-active-jobs', classroomId], enabled: classroomId !== null,
    queryFn: async () => {
      if (!classroomId) return [];
      const { data, error } = await supabase.from('secondary_jobs')
        .select('id,job_name,description,approved_at,tier_at_approval,student:students!student_id(name,brand_name)')
        .eq('classroom_id', classroomId).eq('is_active', true).order('approved_at', { ascending:false });
      if (error) throw error;
      return (data ?? []).map((r:any)=>({ id:r.id,studentName:r.student?.brand_name||r.student?.name||'학생',jobName:r.job_name,description:r.description,approvedAt:r.approved_at,tierAtApproval:r.tier_at_approval }));
    },
  });

  const saveCatalog = async () => {
    await call(() => secondaryJobTeacherRpc.upsertCatalog(supabase, {
      p_catalog_id: form.id,
      p_category: form.category,
      p_template_name: form.name,
      p_template_description: form.description,
      p_suggested_price_range: form.price,
      p_unlock_tier: form.unlockTier,
      p_sort_order: form.sortOrder,
      p_is_active: form.isActive,
    }), {
      successTitle: form.id ? '2차직업 템플릿 수정 완료' : '2차직업 템플릿 추가 완료',
      onSuccess: () => { setForm(EMPTY_FORM); void queryClient.invalidateQueries({queryKey:['teacher-secondary-job-catalogs']}); void queryClient.invalidateQueries({queryKey:['secondary-job-catalogs']}); },
    });
  };

  const editCatalog = (c: Catalog) => {
    if (c.classroomId !== classroomId) return;
    setForm({ id:c.id,category:c.category,name:c.templateName,description:c.templateDescription??'',price:c.suggestedPriceRange??'',unlockTier:c.unlockTier,sortOrder:c.sortOrder,isActive:c.isActive });
  };

  const toggleCatalog = async (c: Catalog) => {
    if (c.classroomId !== classroomId) return;
    await call(() => secondaryJobTeacherRpc.upsertCatalog(supabase, {
      p_catalog_id:c.id,p_category:c.category,p_template_name:c.templateName,p_template_description:c.templateDescription??'',p_suggested_price_range:c.suggestedPriceRange??'',p_unlock_tier:c.unlockTier,p_sort_order:c.sortOrder,p_is_active:!c.isActive,
    }), { successTitle: c.isActive ? '템플릿 비활성화' : '템플릿 활성화', onSuccess:()=>{ void queryClient.invalidateQueries({queryKey:['teacher-secondary-job-catalogs']}); void queryClient.invalidateQueries({queryKey:['secondary-job-catalogs']}); } });
  };

  const release = async () => {
    if (!releaseJob) return;
    await call(() => secondaryJobTeacherRpc.release(supabase,{p_job_id:releaseJob.id,p_reason:releaseReason}), {
      successTitle:'2차직업 해제 완료',
      successDescription:`${releaseJob.studentName} · ${releaseJob.jobName}`,
      onSuccess:()=>{ setReleaseJob(null);setReleaseReason('');void queryClient.invalidateQueries({queryKey:['teacher-secondary-active-jobs']});void queryClient.invalidateQueries({queryKey:['secondary-jobs']});void queryClient.invalidateQueries({queryKey:['secondary-job-status']}); },
    });
  };

  const removeCatalog = async () => {
    if (!deleteCatalog) return;
    await call(() => secondaryJobTeacherRpc.deleteCatalog(supabase, { p_catalog_id: deleteCatalog.id }), {
      successTitle: '2차직업 템플릿 삭제 완료',
      successDescription: deleteCatalog.templateName,
      onSuccess: () => {
        if (form.id === deleteCatalog.id) setForm(EMPTY_FORM);
        setDeleteCatalog(null);
        void queryClient.invalidateQueries({ queryKey: ['teacher-secondary-job-catalogs'] });
        void queryClient.invalidateQueries({ queryKey: ['secondary-job-catalogs'] });
      },
    });
  };

  return <TeacherShell><div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="font-display text-2xl text-brand-gradient">💼 2차직업 운영</h1><p className="text-sm text-text-secondary mt-1">추천 카탈로그와 현재 활동 중인 2차직업을 관리합니다. 학생 신청 승인은 검토 큐에서 처리합니다.</p></div><div className="flex flex-wrap gap-2"><a href="#/teacher/secondary-jobs/public-requests" className="btn-primary">📋 공공 의뢰 관리</a><a href="#/teacher/secondary-jobs/services" className="btn-primary">🛍️ P2P 서비스 거래</a><a href="#/teacher/secondary-jobs/reviews" className="btn-primary">⭐ 평점·후기 관리</a></div></div>

    <section className="bg-bg-card border border-line rounded-card-lg p-4 space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-display text-lg text-white">{form.id ? '템플릿 수정' : '카탈로그 템플릿 추가'}</h2>{form.id && <button className="text-xs text-text-secondary underline" onClick={()=>setForm(EMPTY_FORM)}>새 항목으로</button>}</div>
      <div className="grid md:grid-cols-2 gap-3">
        <label><span className="text-xs font-bold text-text-secondary">분류</span><select className="input-field w-full mt-1" value={form.category} onChange={(e)=>setForm({...form,category:e.target.value as SecondaryJobCategory})}>{CATEGORIES.map(c=><option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></label>
        <label><span className="text-xs font-bold text-text-secondary">직업명</span><input className="input-field w-full mt-1" maxLength={50} value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})} /></label>
        <label><span className="text-xs font-bold text-text-secondary">해금 티어</span><select className="input-field w-full mt-1" value={form.unlockTier} onChange={(e)=>setForm({...form,unlockTier:e.target.value})}>{TIER_THRESHOLDS.map((tier)=><option key={tier.tier} value={tier.tier}>{tier.tier}</option>)}</select></label>
        <label><span className="text-xs font-bold text-text-secondary">권장 단가(참고)</span><input className="input-field w-full mt-1" maxLength={50} placeholder="예: 50~100 GOLD" value={form.price} onChange={(e)=>setForm({...form,price:e.target.value})} /></label>
        <label><span className="text-xs font-bold text-text-secondary">정렬 순서</span><input type="number" min={0} max={9999} className="input-field w-full mt-1" value={form.sortOrder} onChange={(e)=>setForm({...form,sortOrder:Number(e.target.value)})} /></label>
        <label className="flex items-end gap-2 pb-2"><input type="checkbox" checked={form.isActive} onChange={(e)=>setForm({...form,isActive:e.target.checked})}/><span className="text-sm font-bold">학생에게 활성 표시</span></label>
      </div>
      <label className="block"><span className="text-xs font-bold text-text-secondary">템플릿 설명</span><textarea className="input-field w-full mt-1 resize-none" rows={3} maxLength={500} value={form.description} onChange={(e)=>setForm({...form,description:e.target.value})}/></label>
      <button className="btn-primary" onClick={saveCatalog} disabled={isLoading||!form.name.trim()||!form.unlockTier.trim()}>{isLoading?'저장 중...':'저장'}</button>
    </section>

    <section><h2 className="font-display text-lg text-white mb-2">카탈로그</h2>{catalogs.isLoading?<LoadingSpinner/>:!catalogs.data?.length?<EmptyState emoji="📭" title="등록된 카탈로그가 없습니다" description="위에서 첫 2차직업 템플릿을 추가하세요."/>:<div className="grid md:grid-cols-2 gap-2.5">{catalogs.data.map(c=><div key={c.id} className="bg-bg-card border border-line rounded-card-md p-3.5"><div className="flex justify-between gap-2"><div><div className="text-2xs text-brand-glow font-black">{CATEGORY_LABEL[c.category]}</div><div className="font-display text-base text-white mt-1">{c.templateName}</div></div><span className={`text-2xs font-black ${c.isActive?'text-success':'text-text-muted'}`}>{c.isActive?'활성':'비활성'}</span></div>{c.templateDescription&&<p className="text-xs text-text-secondary mt-2">{c.templateDescription}</p>}<div className="text-2xs text-text-muted mt-2">해금 {c.unlockTier}{c.suggestedPriceRange?` · 권장 ${c.suggestedPriceRange}`:''}</div><div className="flex gap-2 mt-3">{c.classroomId===classroomId?<><button className="btn-secondary flex-1" onClick={()=>editCatalog(c)}>수정</button><button className="btn-secondary flex-1" onClick={()=>toggleCatalog(c)}>{c.isActive?'비활성화':'활성화'}</button><button className="px-3 py-2 rounded-pill border border-danger/40 text-danger text-xs font-black" onClick={()=>setDeleteCatalog(c)}>삭제</button></>:<div className="text-2xs text-text-muted">공용 템플릿 · 읽기 전용</div>}</div></div>)}</div>}</section>

    <section><div className="flex items-center justify-between mb-2"><h2 className="font-display text-lg text-white">활동 중인 2차직업</h2><a href="/teacher/review" className="text-xs text-brand-glow font-bold underline">신청 검토 큐 →</a></div>{jobs.isLoading?<LoadingSpinner/>:!jobs.data?.length?<EmptyState emoji="💼" title="활동 중인 2차직업이 없습니다"/>:<div className="space-y-2">{jobs.data.map(j=><div key={j.id} className="bg-bg-card border border-line rounded-card-md p-3 flex items-start justify-between gap-3"><div><div className="font-extrabold">{j.studentName} · {j.jobName}</div><div className="text-xs text-text-secondary mt-1">{j.description||'설명 없음'}</div><div className="text-2xs text-text-muted mt-1">승인 당시 {j.tierAtApproval||'티어 기록 없음'}</div></div><button className="px-3 py-1.5 rounded-pill border border-danger/40 text-danger text-xs font-black" onClick={()=>setReleaseJob(j)}>해제</button></div>)}</div>}</section>

    {releaseJob&&<Modal isOpen onClose={()=>{setReleaseJob(null);setReleaseReason('')}} title="2차직업 해제"><div className="space-y-3"><p className="text-sm"><b>{releaseJob.studentName}</b>의 <b>{releaseJob.jobName}</b>을 해제합니다. 기록은 삭제되지 않습니다.</p><textarea className="input-field w-full resize-none" rows={4} maxLength={500} placeholder="해제 사유를 2자 이상 입력하세요." value={releaseReason} onChange={(e)=>setReleaseReason(e.target.value)}/><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={()=>{setReleaseJob(null);setReleaseReason('')}}>취소</button><button className="btn-danger flex-1" disabled={isLoading||releaseReason.trim().length<2} onClick={release}>해제 확정</button></div></div></Modal>}
    {deleteCatalog&&<Modal isOpen onClose={()=>setDeleteCatalog(null)} title="2차직업 템플릿 삭제"><div className="space-y-3"><p className="text-sm"><b>{deleteCatalog.templateName}</b> 템플릿을 카탈로그에서 완전히 삭제합니다.</p><p className="text-xs text-text-secondary">기존 학생의 신청 기록과 승인된 2차직업 기록은 삭제되지 않습니다.</p><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={()=>setDeleteCatalog(null)}>취소</button><button className="btn-danger flex-1" disabled={isLoading} onClick={removeCatalog}>삭제 확정</button></div></div></Modal>}
  </div></TeacherShell>;
}
