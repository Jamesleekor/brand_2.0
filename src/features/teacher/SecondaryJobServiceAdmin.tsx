import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { TeacherShell } from '@/components/teacher/TeacherShell';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useClassroomId } from '@/stores/auth_store';
import { cn } from '@/lib/utils/cn';
import { formatNumber } from '@/lib/utils/format';
import { orderPriceSummary, servicePriceSummary } from '@/lib/utils/secondary_job_service_pricing';
import {
  secondaryJobServiceTeacherRpc,
  type TeacherServiceOrder,
} from '@/lib/rpc/secondary_job_service_rpc';
import {
  secondaryJobServiceAdTeacherRpc,
  type TeacherServiceAd,
} from '@/lib/rpc/secondary_job_service_ad_rpc';
import type { ServiceOrderStatus } from '@/lib/zod_schemas/secondary_job_service_schemas';

const STATUS_LABEL: Record<ServiceOrderStatus,string> = {
  QUOTE_REQUESTED:'견적 요청중', QUOTE_OFFERED:'견적 제안됨',
  REQUESTED:'판매자 확인 대기', ACCEPTED:'작업 중', DELIVERED:'납품 완료', REVISION_REQUESTED:'수정 요청',
  COMPLETED:'완료', REJECTED:'거절', CANCELLED:'취소', DISPUTED:'분쟁',
};
const ACTIVE = new Set<ServiceOrderStatus>(['QUOTE_REQUESTED','QUOTE_OFFERED','REQUESTED','ACCEPTED','DELIVERED','REVISION_REQUESTED','DISPUTED']);

const AD_STATUS_LABEL: Record<TeacherServiceAd['status'],string> = {
  PENDING:'승인 대기',
  ACTIVE:'광고 중',
  REJECTED:'거절',
  CANCELLED:'학생 취소',
  EXPIRED:'종료',
};

function dt(v:string|null|undefined){
  return v ? new Date(v).toLocaleString('ko-KR',{year:'2-digit',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '-';
}

export default function SecondaryJobServiceAdmin(){
  const navigate=useNavigate();
  const classroomId=useClassroomId();
  const queryClient=useQueryClient();
  const {call,isLoading}=useRpcCall();

  const [section,setSection]=useState<'ORDERS'|'ADS'>('ORDERS');
  const [filter,setFilter]=useState<'ALL'|'ACTIVE'|'DISPUTED'|'DONE'>('ACTIVE');
  const [resolve,setResolve]=useState<{order:TeacherServiceOrder;action:'REFUND'|'PAY_SELLER'}|null>(null);
  const [reason,setReason]=useState('');
  const [adReview,setAdReview]=useState<{ad:TeacherServiceAd;action:'APPROVE'|'REJECT'}|null>(null);
  const [adNote,setAdNote]=useState('');

  const board=useQuery({
    queryKey:['teacher-secondary-job-service-orders',classroomId],
    enabled:classroomId!==null,
    queryFn:async()=>{
      if(!classroomId)return {orders:[]};
      const r=await secondaryJobServiceTeacherRpc.board(supabase,classroomId);
      if('error' in r)throw new Error(r.error);
      return r.data;
    },
  });

  const adBoard=useQuery({
    queryKey:['teacher-secondary-job-service-ads',classroomId],
    enabled:classroomId!==null,
    queryFn:async()=>{
      if(!classroomId)return {server_now:new Date().toISOString(),ads:[]};
      const r=await secondaryJobServiceAdTeacherRpc.board(supabase,classroomId);
      if('error' in r)throw new Error(r.error);
      return r.data;
    },
    staleTime:10_000,
    refetchInterval:30_000,
  });

  const refresh=()=>{
    void queryClient.invalidateQueries({queryKey:['teacher-secondary-job-service-orders']});
    void queryClient.invalidateQueries({queryKey:['teacher-secondary-job-service-ads']});
    void queryClient.invalidateQueries({queryKey:['mail']});
  };

  useEffect(()=>{
    const ch=supabase.channel('teacher-secondary-job-service-orders-ui')
      .on('postgres_changes',{event:'*',schema:'public',table:'secondary_job_service_orders'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'secondary_job_service_deliveries'},refresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'secondary_job_service_ads'},refresh)
      .subscribe();
    return()=>{void supabase.removeChannel(ch);};
  },[queryClient]);

  const items=useMemo(()=>{
    const all=board.data?.orders??[];
    if(filter==='ALL')return all;
    if(filter==='DISPUTED')return all.filter(o=>o.status==='DISPUTED');
    if(filter==='ACTIVE')return all.filter(o=>ACTIVE.has(o.status));
    return all.filter(o=>!ACTIVE.has(o.status));
  },[board.data,filter]);

  const pendingAds=adBoard.data?.ads.filter((ad)=>ad.status==='PENDING')??[];

  const runResolve=async()=>{
    if(!resolve||reason.trim().length<2)return;
    const preEscrowQuote=resolve.order.pricing_mode==='QUOTE'&&resolve.order.escrow_transaction_id===null;
    await call(()=>secondaryJobServiceTeacherRpc.resolve(supabase,{
      p_order_id:resolve.order.id,p_action:resolve.action,p_reason:reason,
    }),{
      successTitle:resolve.action==='REFUND'?(preEscrowQuote?'견적 거래 종료 완료':'구매자 환불 처리 완료'):'판매자 지급 확정 완료',
      successDescription:preEscrowQuote?'결제 전 견적 단계이므로 GOLD 이동이나 환불 transaction 없이 종료되었습니다.':undefined,
      onSuccess:()=>{setResolve(null);setReason('');refresh();},
    });
  };

  const runAdReview=async()=>{
    if(!adReview)return;
    await call(
      ()=>secondaryJobServiceAdTeacherRpc.review(
        supabase,
        adReview.ad.id,
        adReview.action,
        adNote.trim()||null,
      ),
      {
        successTitle:adReview.action==='APPROVE'?'서비스 광고 승인 완료':'서비스 광고 거절 완료',
        successDescription:adReview.action==='APPROVE'
          ? `${formatNumber(adReview.ad.fee_gold)} GOLD가 학생에게서 차감되고 지금부터 ${adReview.ad.duration_days}일 광고가 시작됩니다.`
          : '거절 단계에서는 GOLD가 차감되지 않습니다.',
        onSuccess:()=>{setAdReview(null);setAdNote('');refresh();},
      },
    );
  };

  return <TeacherShell><div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <button onClick={()=>navigate('/teacher/secondary-jobs')} className="text-xs font-bold text-text-secondary hover:text-white mb-2">← 2차직업 운영으로</button>
        <h1 className="font-display text-2xl text-brand-gradient">🛍️ P2P 서비스 거래 관리</h1>
        <p className="text-sm text-text-secondary mt-1">학생 간 서비스 거래와 Home 서비스 광고 심사를 한 화면에서 관리합니다.</p>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2">
      <button type="button" onClick={()=>setSection('ORDERS')} className={cn('rounded-card-md border px-3 py-2.5 text-xs font-black',section==='ORDERS'?'border-brand-primary bg-brand-primary/15 text-white':'border-line bg-bg-card text-text-secondary')}>⚖️ 거래 관리</button>
      <button type="button" onClick={()=>setSection('ADS')} className={cn('relative rounded-card-md border px-3 py-2.5 text-xs font-black',section==='ADS'?'border-gold bg-gold/10 text-white':'border-line bg-bg-card text-text-secondary')}>
        📣 광고 승인
        {pendingAds.length>0&&<span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[10px] text-white">{pendingAds.length}</span>}
      </button>
    </div>

    {section==='ORDERS' ? <>
      <div className="grid grid-cols-4 gap-2">
        {([
          ['ACTIVE','진행중'],
          ['DISPUTED','분쟁'],
          ['DONE','종료'],
          ['ALL','전체'],
        ] as const).map(([v,l])=><button key={v} onClick={()=>setFilter(v)}
          className={cn('rounded-card-md border px-3 py-2 text-xs font-black',filter===v?'border-brand-primary bg-brand-primary/15 text-white':'border-line bg-bg-card text-text-secondary')}>
          {l}{v==='DISPUTED'&&board.data?.orders.some(o=>o.status==='DISPUTED')?' ⚠️':''}
        </button>)}
      </div>

      {board.isLoading?<div className="py-10 flex justify-center"><LoadingSpinner size="lg"/></div>:
        board.isError?<EmptyState emoji="⚠️" title="거래 목록을 불러오지 못했습니다" description={board.error instanceof Error?board.error.message:undefined}/>:
        !items.length?<EmptyState emoji="📭" title="해당 거래가 없습니다"/>:
        <div className="space-y-2.5">{items.map(o=><div key={o.id} className={cn('bg-bg-card border rounded-card-md p-4',o.status==='DISPUTED'?'border-danger/50':'border-line')}>
          <div className="flex flex-wrap justify-between gap-3">
            <div>
              <div className="text-2xs text-text-muted">주문 #{o.id} · {o.job_name}</div>
              <div className="font-display text-base text-white mt-0.5">{o.service_title}</div>
              <div className="text-xs text-text-secondary mt-1">구매자 <b className="text-white">{o.buyer_name}</b> → 판매자 <b className="text-white">{o.seller_name}</b></div>
            </div>
            <div className="text-right">
              <div className={cn('text-xs font-black',o.status==='DISPUTED'?'text-danger':o.status==='COMPLETED'?'text-success':'text-warning')}>{STATUS_LABEL[o.status]}</div>
              <div className="font-display text-sm text-gold mt-1">🪙 {orderPriceSummary(o)}</div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-2 mt-3 text-xs">
            <div className="bg-bg-deep rounded-card-sm p-2.5"><b className="text-white">구매 요청</b><div className="text-text-secondary mt-1 whitespace-pre-wrap">{o.buyer_request}</div></div>
            <div className="bg-bg-deep rounded-card-sm p-2.5"><b className="text-white">최근 납품</b><div className="text-text-secondary mt-1 whitespace-pre-wrap">{o.latest_delivery||'아직 없음'}</div></div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-2xs text-text-muted">
            <div>주문<br/><span className="text-text-primary">{dt(o.created_at)}</span></div>
            <div>수락<br/><span className="text-text-primary">{dt(o.accepted_at)}</span></div>
            <div>납품<br/><span className="text-text-primary">{dt(o.delivered_at)}</span></div>
            <div>완료/취소<br/><span className="text-text-primary">{dt(o.completed_at||o.cancelled_at)}</span></div>
          </div>

          {o.status_reason&&<div className="bg-warning-bg border border-warning/30 rounded-card-sm p-2.5 text-xs text-warning mt-3">현재 사유: {o.status_reason}</div>}

          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-text-secondary">원장/감사 정보</summary>
            <div className="mt-2 text-2xs text-text-muted space-y-1">
              <div>에스크로 transaction: {o.escrow_transaction_id??'-'}</div>
              <div>판매자 지급 transaction: {o.payout_transaction_id??'-'}</div>
              <div>환불 reversal transaction: {o.refund_transaction_id??'-'}</div>
              <div>납품 revision: {o.current_revision}</div>
            </div>
          </details>

          {ACTIVE.has(o.status)&&<div className="flex flex-wrap gap-2 mt-3">
            <button className="btn-secondary text-danger" disabled={isLoading} onClick={()=>{setResolve({order:o,action:'REFUND'});setReason('');}}>{o.escrow_transaction_id===null?'견적 종료 (자산 이동 없음)':'구매자 환불 / 거래 종료'}</button>
            {(o.status==='DELIVERED'||o.status==='DISPUTED')&&<button className="btn-primary" disabled={isLoading} onClick={()=>{setResolve({order:o,action:'PAY_SELLER'});setReason('');}}>판매자 지급 확정</button>}
          </div>}
          {ACTIVE.has(o.status)&&<div className="text-2xs text-text-muted mt-2">{o.escrow_transaction_id===null?'아직 결제 전 견적 단계이므로 종료해도 환불 transaction이 생기지 않습니다.':'판매자 지급은 납품 완료 또는 분쟁 상태에서만 가능합니다.'}</div>}
        </div>)}</div>}
    </> : <>
      <div className="rounded-card-md border border-gold/25 bg-gold/5 p-3 text-xs text-text-secondary">
        <b className="text-gold">광고비:</b> 1일 100G · 2일 190G · 3일 250G.
        학생 신청 시에는 차감하지 않고, <b className="text-white">승인 버튼을 누르는 순간</b> 서버가 서비스 상태·자산동결·잔액을 다시 확인한 뒤 차감합니다.
      </div>

      {adBoard.isLoading?<div className="py-10 flex justify-center"><LoadingSpinner size="lg"/></div>:
        adBoard.isError?<EmptyState emoji="⚠️" title="광고 신청 목록을 불러오지 못했습니다" description={adBoard.error instanceof Error?adBoard.error.message:undefined}/>:
        !(adBoard.data?.ads.length)?<EmptyState emoji="📭" title="광고 신청 이력이 없습니다"/>:
        <div className="space-y-2.5">
          {adBoard.data.ads.map((ad)=><div key={ad.id} className={cn('rounded-card-md border bg-bg-card p-4',ad.status==='PENDING'?'border-gold/45':'border-line')}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-2xs font-black text-brand-glow">{ad.job_name} · 광고 #{ad.id}</div>
                <div className="mt-0.5 font-display text-base text-white">{ad.service_title}</div>
                <div className="mt-1 text-xs text-text-secondary">판매자 <b className="text-white">{ad.seller_name}</b> · 서비스 가격 {servicePriceSummary(ad)}</div>
              </div>
              <div className="text-right">
                <div className={cn('text-xs font-black',ad.status==='PENDING'?'text-warning':ad.status==='ACTIVE'?'text-success':ad.status==='REJECTED'?'text-danger':'text-text-muted')}>{AD_STATUS_LABEL[ad.status]}</div>
                <div className="mt-1 text-sm font-black text-gold">{ad.duration_days}일 · {formatNumber(ad.fee_gold)}G</div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-2xs text-text-muted md:grid-cols-4">
              <div>신청<br/><span className="text-text-primary">{dt(ad.submitted_at)}</span></div>
              <div>검토<br/><span className="text-text-primary">{dt(ad.reviewed_at)}</span></div>
              <div>시작<br/><span className="text-text-primary">{dt(ad.starts_at)}</span></div>
              <div>종료<br/><span className="text-text-primary">{dt(ad.ends_at)}</span></div>
            </div>

            {!ad.service_active&&<div className="mt-3 rounded-card-sm border border-danger/30 bg-danger-bg p-2.5 text-xs font-bold text-danger">현재 서비스/2차직업/학생 상태가 광고 승인 조건을 만족하지 않습니다.</div>}
            {ad.review_note&&<div className="mt-3 rounded-card-sm bg-bg-deep p-2.5 text-xs text-text-secondary">검토 메모: {ad.review_note}</div>}

            {ad.status==='PENDING'&&<div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn-primary" disabled={isLoading||!ad.service_active} onClick={()=>{setAdReview({ad,action:'APPROVE'});setAdNote('');}}>승인 · {formatNumber(ad.fee_gold)}G 차감</button>
              <button className="btn-secondary text-danger" disabled={isLoading} onClick={()=>{setAdReview({ad,action:'REJECT'});setAdNote('');}}>거절</button>
            </div>}
          </div>)}
        </div>}
    </>}

    <Modal isOpen={!!resolve} onClose={()=>setResolve(null)} title={resolve?.action==='REFUND'?(resolve.order.escrow_transaction_id===null?'견적 거래 종료':'거래 환불 처리'):'판매자 지급 확정'} emoji="⚖️">
      {resolve&&<div className="space-y-3">
        <div className="bg-bg-deep rounded-card-md p-3 text-sm">
          <div className="font-bold text-white">{resolve.order.service_title}</div>
          <div className="text-xs text-text-secondary mt-1">{resolve.order.buyer_name} → {resolve.order.seller_name} · {orderPriceSummary(resolve.order)}</div>
        </div>
        <textarea rows={4} maxLength={500} className="input-field w-full resize-none" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="감사 이력에 남길 처리 사유를 2자 이상 입력하세요."/>
        <button className="btn-primary w-full" disabled={isLoading||reason.trim().length<2} onClick={runResolve}>{resolve.action==='REFUND'?(resolve.order.escrow_transaction_id===null?'견적 종료 확정':'환불 확정'):'판매자 지급 확정'}</button>
        {reason.trim().length<2&&<div className="text-xs text-warning text-center">사유 2자 이상 입력 후 버튼이 활성화됩니다.</div>}
      </div>}
    </Modal>

    <Modal isOpen={!!adReview} onClose={()=>setAdReview(null)} title={adReview?.action==='APPROVE'?'서비스 광고 승인':'서비스 광고 거절'} emoji="📣">
      {adReview&&<div className="space-y-3">
        <div className="rounded-card-md bg-bg-deep p-3">
          <div className="font-bold text-white">{adReview.ad.service_title}</div>
          <div className="mt-1 text-xs text-text-secondary">{adReview.ad.seller_name} · {adReview.ad.duration_days}일 · 광고비 {formatNumber(adReview.ad.fee_gold)} GOLD</div>
        </div>
        {adReview.action==='APPROVE'?<div className="rounded-card-md border border-warning/30 bg-warning-bg p-3 text-xs text-warning">승인하면 서버가 조건을 다시 검사한 뒤 <b>{formatNumber(adReview.ad.fee_gold)} GOLD를 즉시 차감</b>하고 그 시점부터 {adReview.ad.duration_days}일간 광고를 시작합니다.</div>:<div className="rounded-card-md border border-line bg-bg-card p-3 text-xs text-text-secondary">거절하면 GOLD는 차감되지 않습니다.</div>}
        <textarea rows={4} maxLength={500} className="input-field w-full resize-none" value={adNote} onChange={(e)=>setAdNote(e.target.value)} placeholder="검토 메모 (선택, 최대 500자)"/>
        <button className={adReview.action==='APPROVE'?'btn-primary w-full':'btn-secondary w-full text-danger'} disabled={isLoading} onClick={runAdReview}>{adReview.action==='APPROVE'?'승인 확정':'거절 확정'}</button>
      </div>}
    </Modal>
  </div></TeacherShell>;
}
