import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';
import {
  secondaryJobServiceReviewTeacherRpc,
  type TeacherServiceReview,
} from '@/lib/rpc/secondary_job_service_review_rpc';

type Filter = 'ALL'|'VISIBLE'|'HIDDEN'|'INVALID';

function dt(v:string|null|undefined){
  return v ? new Date(v).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
}

export default function SecondaryJobReviewAdmin(){
  const navigate=useNavigate();
  const classroomId=useClassroomId();
  const queryClient=useQueryClient();
  const {call,isLoading}=useRpcCall();
  const [filter,setFilter]=useState<Filter>('ALL');
  const [target,setTarget]=useState<{review:TeacherServiceReview;visible:boolean;valid:boolean;label:string}|null>(null);
  const [reason,setReason]=useState('');

  const board=useQuery({
    queryKey:['teacher-secondary-job-service-reviews',classroomId],
    enabled:classroomId!==null,
    queryFn:async()=>{
      if(!classroomId)return {reviews:[]};
      const r=await secondaryJobServiceReviewTeacherRpc.board(supabase,classroomId);
      if('error' in r)throw new Error(r.error);
      return r.data;
    },
  });

  const refresh=()=>void queryClient.invalidateQueries({queryKey:['teacher-secondary-job-service-reviews']});
  const items=useMemo(()=>{
    const all=board.data?.reviews??[];
    if(filter==='VISIBLE')return all.filter(r=>r.is_review_visible);
    if(filter==='HIDDEN')return all.filter(r=>!r.is_review_visible);
    if(filter==='INVALID')return all.filter(r=>!r.is_rating_valid);
    return all;
  },[board.data,filter]);

  const run=async()=>{
    if(!target||reason.trim().length<2)return;
    await call(()=>secondaryJobServiceReviewTeacherRpc.moderate(supabase,{
      p_review_id:target.review.id,
      p_review_visible:target.visible,
      p_rating_valid:target.valid,
      p_reason:reason,
    }),{
      successTitle:`후기 관리 완료 · ${target.label}`,
      onSuccess:()=>{setTarget(null);setReason('');refresh();},
    });
  };

  return <TeacherShell><div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <button onClick={()=>navigate('/teacher/secondary-jobs')} className="text-xs font-bold text-text-secondary hover:text-white mb-2">← 2차직업 운영으로</button>
        <h1 className="font-display text-2xl text-brand-gradient">⭐ P2P 평점·후기 관리</h1>
        <p className="text-sm text-text-secondary mt-1">학생 화면에는 작성자와 개별 점수가 노출되지 않습니다. 교사는 악용 대응을 위해 원본을 확인할 수 있습니다.</p>
      </div>
      <button className="btn-secondary" onClick={refresh} disabled={board.isFetching}>새로고침</button>
    </div>

    <div className="bg-bg-card border border-line rounded-card-md p-3 text-xs text-text-secondary">
      감사 이력을 보존하기 위해 후기 자체를 삭제하지 않습니다. 부적절한 글은 <b className="text-white">후기 숨김</b>, 조작·악성 점수는 <b className="text-white">평점 무효</b>로 처리하고 언제든 복구할 수 있습니다.
    </div>

    <div className="grid grid-cols-4 gap-2">
      {([['ALL','전체'],['VISIBLE','공개'],['HIDDEN','숨김'],['INVALID','평점 무효']] as const).map(([v,l])=><button key={v} onClick={()=>setFilter(v)}
        className={cn('rounded-card-md border px-2 py-2 text-xs font-black',filter===v?'border-brand-primary bg-brand-primary/15 text-white':'border-line bg-bg-card text-text-secondary')}>{l}</button>)}
    </div>

    {board.isLoading?<div className="py-10 flex justify-center"><LoadingSpinner size="lg"/></div>:
      board.isError?<EmptyState emoji="⚠️" title="후기 목록을 불러오지 못했습니다" description={board.error instanceof Error?board.error.message:undefined}/>:
      !items.length?<EmptyState emoji="💬" title="해당 후기가 없습니다"/>:
      <div className="space-y-2.5">{items.map(r=><div key={r.id} className="bg-bg-card border border-line rounded-card-md p-4">
        <div className="flex flex-wrap justify-between gap-3">
          <div>
            <div className="text-2xs text-text-muted">후기 #{r.id} · 주문 #{r.order_id}</div>
            <div className="font-display text-base text-white mt-0.5">{r.service_title}</div>
            <div className="text-xs text-text-secondary mt-1">구매자 <b className="text-white">{r.buyer_name}</b> → 판매자 <b className="text-white">{r.seller_name}</b></div>
          </div>
          <div className="text-right">
            <div className="font-display text-lg text-gold">⭐ {r.rating} / 10</div>
            <div className="text-2xs text-text-muted mt-1">{dt(r.created_at)}</div>
          </div>
        </div>
        <div className="bg-bg-deep rounded-card-sm p-3 mt-3 text-sm text-text-primary whitespace-pre-wrap">“{r.review_text}”</div>
        <div className="flex flex-wrap gap-2 mt-3 text-xs">
          <span className={cn('rounded-pill px-2 py-1 font-black',r.is_review_visible?'bg-success-bg text-success':'bg-warning-bg text-warning')}>{r.is_review_visible?'후기 공개':'후기 숨김'}</span>
          <span className={cn('rounded-pill px-2 py-1 font-black',r.is_rating_valid?'bg-success-bg text-success':'bg-danger-bg text-danger')}>{r.is_rating_valid?'평점 유효':'평점 무효'}</span>
        </div>
        {r.moderation_reason&&<div className="text-xs text-warning mt-2">최근 관리: {r.moderation_reason} · {dt(r.moderated_at)}</div>}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button className="btn-secondary" disabled={isLoading} onClick={()=>{setTarget({review:r,visible:!r.is_review_visible,valid:r.is_rating_valid,label:r.is_review_visible?'후기 숨김':'후기 다시 공개'});setReason('');}}>{r.is_review_visible?'후기 숨김':'후기 다시 공개'}</button>
          <button className="btn-secondary" disabled={isLoading} onClick={()=>{setTarget({review:r,visible:r.is_review_visible,valid:!r.is_rating_valid,label:r.is_rating_valid?'평점 무효':'평점 복구'});setReason('');}}>{r.is_rating_valid?'평점 무효':'평점 복구'}</button>
        </div>
      </div>)}</div>}

    <Modal isOpen={!!target} onClose={()=>setTarget(null)} title={target?.label??'후기 관리'} emoji="🛡️">
      {target&&<div className="space-y-3">
        <div className="bg-bg-deep rounded-card-md p-3 text-sm"><div className="font-bold text-white">{target.review.service_title}</div><div className="text-xs text-text-secondary mt-1">{target.review.buyer_name} → {target.review.seller_name} · {target.review.rating}/10</div></div>
        <textarea rows={4} maxLength={500} className="input-field w-full resize-none" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="관리 사유를 2자 이상 입력하세요."/>
        <button className="btn-primary w-full" disabled={isLoading||reason.trim().length<2} onClick={run}>{target.label} 확정</button>
        {reason.trim().length<2&&<div className="text-xs text-warning text-center">사유 2자 이상 입력 후 버튼이 활성화됩니다.</div>}
      </div>}
    </Modal>
  </div></TeacherShell>;
}
