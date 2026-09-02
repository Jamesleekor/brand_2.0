import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { EmptyState, LoadingSpinner, Modal, useRpcCall } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { formatNumber } from '@/lib/utils/format';
import { cn } from '@/lib/utils/cn';
import {
  secondaryJobServiceStudentRpc,
  type MyServiceItem,
  type ServiceMarketItem,
  type ServicePurchaseOrder,
  type ServiceSaleOrder,
} from '@/lib/rpc/secondary_job_service_rpc';
import type { ServiceOrderStatus } from '@/lib/zod_schemas/secondary_job_service_schemas';
import {
  secondaryJobServiceReviewStudentRpc,
  type MyServiceReview,
  type SellerReputation,
} from '@/lib/rpc/secondary_job_service_review_rpc';
import { MySellerReputationCard, OrderReviewAction, SellerReputationBadge } from '@/features/market/SecondaryJobReviewWidgets';
import { useClassroomId } from '@/stores/auth_store';
import {
  secondaryJobServiceAdStudentRpc,
  type MyServiceAd,
  type StudentServiceAdBoard,
} from '@/lib/rpc/secondary_job_service_ad_rpc';

type ViewTab = 'market' | 'orders' | 'sales' | 'services';

const STATUS_LABEL: Record<ServiceOrderStatus, string> = {
  REQUESTED: '판매자 확인 대기',
  ACCEPTED: '작업 중',
  DELIVERED: '납품 완료',
  REVISION_REQUESTED: '수정 요청',
  COMPLETED: '거래 완료',
  REJECTED: '거절',
  CANCELLED: '취소',
  DISPUTED: '분쟁 처리 대기',
};

const STATUS_CLASS: Record<ServiceOrderStatus, string> = {
  REQUESTED: 'text-warning',
  ACCEPTED: 'text-bv',
  DELIVERED: 'text-success',
  REVISION_REQUESTED: 'text-warning',
  COMPLETED: 'text-success',
  REJECTED: 'text-danger',
  CANCELLED: 'text-text-muted',
  DISPUTED: 'text-danger',
};

function dt(v: string | null | undefined) {
  if (!v) return null;
  return new Date(v).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function SecondaryJobServicesPanel() {
  const queryClient = useQueryClient();
  const classroomId = useClassroomId();
  const { call, isLoading } = useRpcCall();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get('view');
  const initialView: ViewTab = requestedView === 'orders' || requestedView === 'sales' || requestedView === 'services' || requestedView === 'market'
    ? requestedView
    : 'market';
  const [tab, setTab] = useState<ViewTab>(initialView);
  const requestedServiceId = (() => {
    const raw = Number(searchParams.get('service'));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  })();

  const board = useQuery({
    queryKey: ['secondary-job-service-market'],
    queryFn: async () => {
      const result = await secondaryJobServiceStudentRpc.board(supabase);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
  });

  const studentNames = useQuery({
    queryKey: ['secondary-job-service-student-names', classroomId],
    enabled: !!classroomId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('students')
        .select('id,name')
        .eq('classroom_id', classroomId!);
      if (error) throw new Error(error.message);
      return new Map<number, string>((data ?? []).map((row) => [Number(row.id), row.name]));
    },
    staleTime: 60_000,
  });

  const reputationBoard = useQuery({
    queryKey: ['secondary-job-service-reputation'],
    queryFn: async () => {
      const result = await secondaryJobServiceReviewStudentRpc.board(supabase);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
  });

  const adBoard = useQuery({
    queryKey: ['secondary-job-service-ad-board'],
    queryFn: async () => {
      const result = await secondaryJobServiceAdStudentRpc.board(supabase);
      if ('error' in result) throw new Error(result.error);
      return result.data;
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['secondary-job-service-market'] });
    void queryClient.invalidateQueries({ queryKey: ['secondary-job-service-reputation'] });
    void queryClient.invalidateQueries({ queryKey: ['secondary-job-service-ad-board'] });
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    void queryClient.invalidateQueries({ queryKey: ['mail'] });
  };

  useEffect(() => {
    const requested = searchParams.get('view');
    if (requested === 'market' || requested === 'orders' || requested === 'sales' || requested === 'services') {
      setTab(requested);
    }
    if (searchParams.get('service')) {
      setTab('market');
    }
  }, [searchParams]);

  useEffect(() => {
    const channel = supabase
      .channel('secondary-job-service-market-ui')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_services' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_service_orders' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_service_deliveries' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secondary_job_service_ads' }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [queryClient]);

  const data = board.data;
  const reputationData = reputationBoard.data;
  const reputationBySeller = useMemo(() => new Map<number, SellerReputation>(
    (reputationData?.seller_reputations ?? []).map((r) => [r.seller_student_id, r]),
  ), [reputationData]);
  const myReviewByOrder = useMemo(() => new Map<number, MyServiceReview>(
    (reputationData?.my_reviews ?? []).map((r) => [r.order_id, r]),
  ), [reputationData]);
  const pendingBuy = data?.my_orders.filter((o) => !['COMPLETED','REJECTED','CANCELLED'].includes(o.status)).length ?? 0;
  const pendingSell = data?.my_sales.filter((o) => !['COMPLETED','REJECTED','CANCELLED'].includes(o.status)).length ?? 0;
  const reviewNeeded = data?.my_orders.filter((o) => o.status==='COMPLETED' && !myReviewByOrder.has(o.id)).length ?? 0;

  if (board.isLoading || reputationBoard.isLoading) return <div className="py-10 flex justify-center"><LoadingSpinner size="lg" /></div>;
  if (board.isError || reputationBoard.isError || !data || !reputationData) return <EmptyState emoji="⚠️" title="서비스 마켓을 불러오지 못했어요" description={(board.error instanceof Error ? board.error.message : reputationBoard.error instanceof Error ? reputationBoard.error.message : '잠시 후 다시 시도해주세요.')} />;

  return <div className="space-y-4 pb-8">
    <div className="bg-bg-card border border-line rounded-card-lg p-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <div className="font-display text-lg text-brand-gradient">🛍️ P2P 서비스 마켓</div>
          <p className="text-xs text-text-secondary mt-1">2차직업을 가진 친구의 서비스를 GOLD로 구매하거나, 내 2차직업으로 서비스를 판매할 수 있습니다.</p>
        </div>
        <div className="text-right">
          <div className="text-2xs text-text-muted">사용 가능 GOLD</div>
          <div className="font-display text-lg text-gold">🪙 {formatNumber(data.gold)}</div>
        </div>
      </div>
      {data.asset_freeze && <div className="mt-3 bg-danger-bg border border-danger/40 rounded-card-md p-3 text-xs text-danger font-bold">🚫 자산동결 중이라 신규 구매는 할 수 없습니다. 이미 결제된 주문의 수락·납품·환불·정산은 계속 처리할 수 있습니다.</div>}
    </div>

    {reviewNeeded>0 && <button type="button" onClick={()=>setTab('orders')} className="w-full text-left bg-brand-primary/10 border border-brand-primary/30 rounded-card-md p-3">
      <div className="text-xs font-black text-white">⭐ 아직 평가하지 않은 완료 거래가 {reviewNeeded}건 있어요</div>
      <div className="text-2xs text-text-secondary mt-1">내 주문에서 평점 0~10점과 익명 후기를 남길 수 있습니다.</div>
    </button>}

    <div className="grid grid-cols-4 gap-1.5">
      {([
        ['market','서비스','🛒',0],
        ['orders','내 주문','📦',pendingBuy+reviewNeeded],
        ['sales','판매 주문','💼',pendingSell],
        ['services','내 서비스','🧰',data.my_services.filter((s)=>!s.deleted_at).length],
      ] as const).map(([value,label,emoji,count]) => (
        <button key={value} onClick={()=>setTab(value)}
          className={cn('relative rounded-card-md border px-2 py-2.5 text-xs font-black',
            tab===value ? 'border-brand-primary bg-brand-primary/15 text-white' : 'border-line bg-bg-card text-text-secondary')}>
          <div>{emoji} {label}</div>
          {count>0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-danger text-white text-[10px] flex items-center justify-center">{count}</span>}
        </button>
      ))}
    </div>

    {tab==='market' && <MarketList items={data.services} reputations={reputationBySeller} studentNames={studentNames.data ?? new Map()} busy={isLoading} onDone={refresh} highlightServiceId={requestedServiceId} />}
    {tab==='orders' && <BuyerOrders items={data.my_orders} myReviews={myReviewByOrder} studentNames={studentNames.data ?? new Map()} busy={isLoading} onDone={refresh} />}
    {tab==='sales' && <SellerOrders items={data.my_sales} busy={isLoading} onDone={refresh} />}
    {tab==='services' && <MyServices items={data.my_services} jobs={data.active_jobs} reputation={reputationData.my_seller_reputation} adBoard={adBoard.data ?? null} adLoading={adBoard.isLoading} adError={adBoard.isError ? (adBoard.error instanceof Error ? adBoard.error.message : '광고 정보를 불러오지 못했습니다.') : null} busy={isLoading} onDone={refresh} />}

    {tab==='services' && data.active_jobs.length===0 && (
      <div className="bg-warning-bg border border-warning/40 rounded-card-md p-3 text-xs text-warning font-bold">
        활성 2차직업이 있어야 서비스를 등록할 수 있습니다. 먼저 2차직업 승인을 받아주세요.
      </div>
    )}
  </div>;
}

function MarketList({ items, reputations, studentNames, busy, onDone, highlightServiceId }: { items: ServiceMarketItem[]; reputations: Map<number,SellerReputation>; studentNames: Map<number,string>; busy: boolean; onDone: ()=>void; highlightServiceId: number | null }) {
  const { call, isLoading: rpcLoading } = useRpcCall();
  const actionBusy = busy || rpcLoading;
  const [selected,setSelected] = useState<ServiceMarketItem|null>(null);
  const [request,setRequest] = useState('');

  useEffect(() => {
    if (!highlightServiceId || !items.some((item) => item.id === highlightServiceId)) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`service-market-${highlightServiceId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [highlightServiceId, items]);

  const buy = async () => {
    if (!selected || !selected.can_buy || request.trim().length<10) return;
    await call(() => secondaryJobServiceStudentRpc.buy(supabase,{p_service_id:selected.id,p_buyer_request:request}),{
      successTitle:'서비스 주문 완료',
      successDescription:`${formatNumber(selected.price_gold)} GOLD가 거래 완료 전까지 보류됩니다.`,
      onSuccess:()=>{ setSelected(null);setRequest('');onDone(); },
    });
  };

  if (!items.length) return <EmptyState emoji="🛍️" title="판매 중인 서비스가 없어요" description="2차직업을 가진 학생이 서비스를 등록하면 여기에 표시됩니다." />;

  return <>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {items.map((s)=>{const sellerName=studentNames.get(s.seller_student_id)??s.seller_name;return <div
        key={s.id}
        id={`service-market-${s.id}`}
        className={cn(
          'bg-bg-card border rounded-card-md p-3.5 flex flex-col transition',
          highlightServiceId===s.id
            ? 'border-gold/70 ring-2 ring-gold/20 shadow-card'
            : 'border-line',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div><div className="text-2xs text-brand-glow font-black">{s.job_name}</div><div className="font-display text-base text-white mt-0.5">{s.title}</div></div>
          <div className="font-display text-sm text-gold whitespace-nowrap">🪙 {formatNumber(s.price_gold)}</div>
        </div>
        <div className="mt-2 rounded-card-sm border border-white/5 bg-black/15 px-2 py-1.5 text-sm font-black text-slate-100">👤 판매자 · {sellerName}</div>
        <SellerReputationBadge reputation={reputations.get(s.seller_student_id)} />
        <p className="mt-2 flex-1 whitespace-pre-wrap text-[13px] font-medium leading-5 text-slate-200">{s.description}</p>
        {s.delivery_note && <div className="mt-2 rounded-card-sm bg-bg-deep/80 px-2 py-1.5 text-xs font-bold text-cyan-100">⏱ 소요시간 · {s.delivery_note}</div>}
        <div className="mt-2 text-[11px] font-bold text-text-muted">{s.allow_concurrent_orders?'👥 여러 학생 동시 주문 가능':'👤 한 번에 1명만 주문 가능'}</div>
        <button disabled={!s.can_buy || actionBusy} onClick={()=>{setSelected(s);setRequest('');}}
          className="btn-primary w-full mt-3 disabled:opacity-50 disabled:cursor-not-allowed">
          {s.can_buy?'구매하기':'구매 불가'}
        </button>
        {!s.can_buy && s.blocked_reason && <div className="text-[11px] text-warning mt-1.5 text-center">{s.blocked_reason}</div>}
      </div>})}
    </div>

    <Modal isOpen={!!selected} onClose={()=>setSelected(null)} title={selected?`${selected.title} 주문`:'서비스 주문'} emoji="🛒">
      {selected && <div className="space-y-3">
        <div className="bg-bg-deep rounded-card-md p-3 text-sm">
          <div className="flex justify-between"><span className="font-bold text-slate-100">{studentNames.get(selected.seller_student_id) ?? selected.seller_name} · {selected.job_name}</span><b className="text-gold">{formatNumber(selected.price_gold)} GOLD</b></div>
          <div className="text-xs text-text-secondary mt-2">구매 시 GOLD가 즉시 빠져나가지만 판매자에게 바로 지급되지는 않습니다. 납품 후 구매 확정하면 판매자에게 정산됩니다.</div>
        </div>
        <label className="block"><span className="text-xs font-bold text-text-secondary">구체적인 요청 내용 (10~500자)</span>
          <textarea rows={5} maxLength={500} value={request} onChange={(e)=>setRequest(e.target.value)}
            className="input-field w-full mt-1 resize-none" placeholder="원하는 결과, 내용, 조건을 구체적으로 적어주세요." /></label>
        <div className="text-right text-2xs text-text-muted">{request.trim().length}/500</div>
        <button className="btn-primary w-full" disabled={actionBusy||request.trim().length<10} onClick={buy}>결제하고 주문하기</button>
        {request.trim().length<10 && <div className="text-xs text-warning text-center">요청 내용을 10자 이상 입력하면 주문 버튼이 활성화됩니다.</div>}
      </div>}
    </Modal>
  </>;
}

function BuyerOrders({ items, myReviews, studentNames, busy, onDone }: { items: ServicePurchaseOrder[]; myReviews: Map<number,MyServiceReview>; studentNames: Map<number,string>; busy:boolean; onDone:()=>void }) {
  const { call, isLoading: rpcLoading } = useRpcCall();
  const actionBusy = busy || rpcLoading;
  const [action,setAction] = useState<{order:ServicePurchaseOrder;type:'CANCEL'|'REVISION'|'DISPUTE'}|null>(null);
  const [reason,setReason] = useState('');

  const run = async (order:ServicePurchaseOrder,type:'CANCEL'|'CONFIRM'|'REVISION'|'DISPUTE') => {
    const needsReason = type==='REVISION'||type==='DISPUTE';
    if (needsReason && reason.trim().length<2) return;
    await call(()=>secondaryJobServiceStudentRpc.buyerAction(supabase,{p_order_id:order.id,p_action:type,p_reason:reason.trim()||null}),{
      successTitle:type==='CONFIRM'?'구매 확정 완료':type==='CANCEL'?'주문 취소 및 환불 완료':type==='REVISION'?'수정 요청 완료':'분쟁 접수 완료',
      onSuccess:()=>{setAction(null);setReason('');onDone();},
    });
  };

  if (!items.length) return <EmptyState emoji="📦" title="아직 구매 주문이 없어요" />;
  return <div className="space-y-2.5">
    {items.map((o)=><div key={o.id} className="bg-bg-card border border-line rounded-card-md p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-display text-base text-white">{o.service_title}</div><div className="mt-1 text-xs font-bold text-slate-200">판매자 {studentNames.get(o.seller_student_id) ?? o.seller_name} · <span className="text-slate-400">{o.job_name}</span></div></div>
        <span className={cn('text-xs font-black',STATUS_CLASS[o.status])}>{STATUS_LABEL[o.status]}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
        <div className="bg-bg-deep rounded-card-sm p-2"><span className="text-text-muted">결제</span><div className="font-black text-gold">{formatNumber(o.price_gold)} GOLD</div></div>
        <div className="bg-bg-deep rounded-card-sm p-2"><span className="text-text-muted">주문</span><div>{dt(o.created_at)}</div></div>
      </div>
      <div className="text-xs text-text-secondary mt-3 whitespace-pre-wrap"><b className="text-white">내 요청</b><br/>{o.buyer_request}</div>
      {o.latest_delivery && <div className="bg-success-bg border border-success/30 rounded-card-sm p-3 mt-3 text-xs whitespace-pre-wrap"><b className="text-success">📦 최신 납품 #{o.current_revision}</b><div className="mt-1 text-text-primary">{o.latest_delivery}</div><div className="text-2xs text-text-muted mt-1">{dt(o.latest_delivery_at)}</div></div>}
      {o.status_reason && <div className="text-xs text-warning mt-2">사유/안내: {o.status_reason}</div>}

      <div className="flex flex-wrap gap-2 mt-3">
        {o.status==='REQUESTED' && <button className="btn-secondary" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'CANCEL'});setReason('');}}>주문 취소</button>}
        {o.status==='DELIVERED' && <>
          <button className="btn-primary" disabled={actionBusy} onClick={()=>run(o,'CONFIRM')}>구매 확정</button>
          <button className="btn-secondary" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'REVISION'});setReason('');}}>수정 요청</button>
          <button className="btn-secondary text-danger" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'DISPUTE'});setReason('');}}>문제 신고</button>
        </>}
        {(o.status==='ACCEPTED'||o.status==='REVISION_REQUESTED') && <button className="btn-secondary text-danger" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'DISPUTE'});setReason('');}}>취소/분쟁 요청</button>}
      </div>

      {o.status==='REQUESTED' && <div className="text-2xs text-text-muted mt-2">판매자 수락 전까지는 즉시 취소·전액 환불할 수 있습니다.</div>}
      {o.status==='ACCEPTED' && <div className="text-2xs text-text-muted mt-2">판매자가 작업을 시작했습니다. 일방 취소 대신 문제가 있으면 분쟁 요청을 이용하세요.</div>}
      {o.status==='DISPUTED' && <div className="text-xs text-warning mt-2">교사 확인 대기 중입니다. 보류된 GOLD는 아직 판매자에게 지급되지 않았습니다.</div>}
      <OrderReviewAction orderId={o.id} completed={o.status==='COMPLETED'} serviceTitle={o.service_title} existingReview={myReviews.get(o.id)} busy={actionBusy} onDone={onDone} />
    </div>)}

    <Modal isOpen={!!action} onClose={()=>setAction(null)}
      title={action?.type==='CANCEL'?'주문 취소':action?.type==='REVISION'?'수정 요청':'분쟁/취소 요청'} emoji="⚠️">
      {action && <div className="space-y-3">
        <p className="text-sm text-text-secondary">
          {action.type==='CANCEL'?'판매자가 아직 수락하지 않은 주문입니다. 취소하면 보류된 GOLD가 즉시 환불됩니다.':'상대방과 교사가 상황을 이해할 수 있도록 이유를 적어주세요.'}
        </p>
        {action.type!=='CANCEL' && <textarea rows={4} maxLength={500} className="input-field w-full resize-none" value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="사유를 2자 이상 입력" />}
        <button className="btn-primary w-full" disabled={actionBusy||(action.type!=='CANCEL'&&reason.trim().length<2)}
          onClick={()=>run(action.order,action.type)}>확정</button>
      </div>}
    </Modal>
  </div>;
}

function SellerOrders({ items, busy, onDone }: { items: ServiceSaleOrder[]; busy:boolean; onDone:()=>void }) {
  const { call, isLoading: rpcLoading } = useRpcCall();
  const actionBusy = busy || rpcLoading;
  const [action,setAction] = useState<{order:ServiceSaleOrder;type:'REJECT'|'CANCEL'|'DELIVER'}|null>(null);
  const [text,setText] = useState('');

  const sellerAction = async (order:ServiceSaleOrder,type:'ACCEPT'|'REJECT'|'CANCEL') => {
    if ((type==='REJECT'||type==='CANCEL') && text.trim().length<2) return;
    await call(()=>secondaryJobServiceStudentRpc.sellerAction(supabase,{p_order_id:order.id,p_action:type,p_reason:text.trim()||null}),{
      successTitle:type==='ACCEPT'?'주문 수락 완료':type==='REJECT'?'주문 거절 및 환불 완료':'주문 취소 및 환불 완료',
      onSuccess:()=>{setAction(null);setText('');onDone();},
    });
  };
  const deliver = async (order:ServiceSaleOrder) => {
    if (text.trim().length<10) return;
    await call(()=>secondaryJobServiceStudentRpc.deliver(supabase,{p_order_id:order.id,p_delivery_text:text}),{
      successTitle:'납품 완료',
      onSuccess:()=>{setAction(null);setText('');onDone();},
    });
  };

  if (!items.length) return <EmptyState emoji="💼" title="아직 판매 주문이 없어요" description="서비스를 등록하면 다른 학생이 주문할 수 있습니다." />;
  return <div className="space-y-2.5">
    {items.map((o)=><div key={o.id} className="bg-bg-card border border-line rounded-card-md p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div><div className="font-display text-base text-white">{o.service_title}</div><div className="text-2xs text-text-muted">구매자 {o.buyer_name} · {o.job_name}</div></div>
        <span className={cn('text-xs font-black',STATUS_CLASS[o.status])}>{STATUS_LABEL[o.status]}</span>
      </div>
      <div className="text-xs text-text-secondary mt-3 whitespace-pre-wrap"><b className="text-white">구매자 요청</b><br/>{o.buyer_request}</div>
      <div className="text-xs text-gold font-bold mt-2">거래금액 {formatNumber(o.price_gold)} GOLD</div>
      {o.status_reason && <div className="text-xs text-warning mt-2">사유/안내: {o.status_reason}</div>}
      {o.latest_delivery && <div className="bg-bg-deep rounded-card-sm p-2.5 mt-2 text-xs whitespace-pre-wrap">최근 납품 #{o.current_revision}<br/>{o.latest_delivery}</div>}
      <div className="flex flex-wrap gap-2 mt-3">
        {o.status==='REQUESTED' && <>
          <button className="btn-primary" disabled={actionBusy} onClick={()=>sellerAction(o,'ACCEPT')}>주문 수락</button>
          <button className="btn-secondary" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'REJECT'});setText('');}}>거절</button>
        </>}
        {(o.status==='ACCEPTED'||o.status==='REVISION_REQUESTED') && <>
          <button className="btn-primary" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'DELIVER'});setText('');}}>납품하기</button>
          <button className="btn-secondary text-danger" disabled={actionBusy} onClick={()=>{setAction({order:o,type:'CANCEL'});setText('');}}>판매 취소</button>
        </>}
      </div>
      {o.status==='DELIVERED' && <div className="text-2xs text-text-muted mt-2">구매자의 구매 확정 또는 수정 요청을 기다리는 중입니다.</div>}
      {o.status==='DISPUTED' && <div className="text-xs text-warning mt-2">분쟁이 접수되어 교사 확인을 기다리고 있습니다.</div>}
    </div>)}

    <Modal isOpen={!!action} onClose={()=>setAction(null)}
      title={action?.type==='DELIVER'?'서비스 납품':action?.type==='REJECT'?'주문 거절':'판매 취소'} emoji={action?.type==='DELIVER'?'📦':'⚠️'}>
      {action && <div className="space-y-3">
        <textarea rows={5} maxLength={action.type==='DELIVER'?2000:500} className="input-field w-full resize-none"
          value={text} onChange={(e)=>setText(e.target.value)}
          placeholder={action.type==='DELIVER'?'완료한 내용, 전달 방법 등을 10자 이상 적어주세요.':'사유를 2자 이상 적어주세요.'} />
        <button className="btn-primary w-full" disabled={actionBusy||text.trim().length<(action.type==='DELIVER'?10:2)}
          onClick={()=>action.type==='DELIVER'?deliver(action.order):sellerAction(action.order,action.type)}>확정</button>
      </div>}
    </Modal>
  </div>;
}

function MyServices({ items, jobs, reputation, adBoard, adLoading, adError, busy, onDone }: {
  items: MyServiceItem[];
  jobs: {id:number;job_name:string;category:string|null}[];
  reputation: SellerReputation | null;
  adBoard: StudentServiceAdBoard | null;
  adLoading: boolean;
  adError: string | null;
  busy:boolean;
  onDone:()=>void;
}) {
  const { call, isLoading: rpcLoading } = useRpcCall();
  const actionBusy = busy || rpcLoading;
  const liveItems = useMemo(()=>items.filter((s)=>!s.deleted_at),[items]);
  const activeAdCandidates = useMemo(()=>liveItems.filter((s)=>s.is_active),[liveItems]);
  const openAd = useMemo<MyServiceAd | null>(
    () => adBoard?.my_ads.find((ad)=>ad.status==='PENDING'||ad.status==='ACTIVE') ?? null,
    [adBoard],
  );

  const [form,setForm] = useState<MyServiceItem|null|'NEW'>(null);
  const [jobId,setJobId] = useState(0);
  const [title,setTitle] = useState('');
  const [desc,setDesc] = useState('');
  const [price,setPrice] = useState(100);
  const [delivery,setDelivery] = useState('');
  const [allowConcurrent,setAllowConcurrent] = useState(false);
  const [deleteTarget,setDeleteTarget] = useState<MyServiceItem|null>(null);
  const [adTarget,setAdTarget] = useState<MyServiceItem|null>(null);
  const [adPickerOpen,setAdPickerOpen] = useState(false);
  const [adDuration,setAdDuration] = useState<1|2|3>(1);

  const openNew=()=>{setForm('NEW');setJobId(jobs[0]?.id??0);setTitle('');setDesc('');setPrice(100);setDelivery('');setAllowConcurrent(false);};
  const openEdit=(s:MyServiceItem)=>{setForm(s);setJobId(s.secondary_job_id);setTitle(s.title);setDesc(s.description);setPrice(s.price_gold);setDelivery(s.delivery_note??'');setAllowConcurrent(s.allow_concurrent_orders);};

  const save=async()=>{
    const existing=form!=='NEW'&&form?form:null;
    if (!jobId||title.trim().length<2||desc.trim().length<10||price<1) return;
    await call(()=>secondaryJobServiceStudentRpc.upsertService(supabase,{
      p_service_id:existing?.id??null,p_secondary_job_id:jobId,p_title:title,p_description:desc,
      p_price_gold:price,p_delivery_note:delivery,p_is_active:existing?.is_active??true,
      p_allow_concurrent_orders:allowConcurrent,
    }),{successTitle:existing?'서비스 수정 완료':'서비스 등록 완료',onSuccess:()=>{setForm(null);onDone();}});
  };

  const toggle=async(s:MyServiceItem)=>{
    await call(()=>secondaryJobServiceStudentRpc.toggleService(supabase,{p_service_id:s.id,p_is_active:!s.is_active}),{
      successTitle:s.is_active?'판매 일시정지':'판매 재개',onSuccess:onDone,
    });
  };

  const remove=async()=>{
    if(!deleteTarget)return;
    await call(()=>secondaryJobServiceStudentRpc.deleteService(supabase,{p_service_id:deleteTarget.id}),{
      successTitle:'서비스 삭제 완료',
      successDescription:'과거 주문 이력은 그대로 보존됩니다.',
      onSuccess:()=>{setDeleteTarget(null);onDone();},
    });
  };

  const submitAd=async()=>{
    if(!adTarget)return;
    const option=adBoard?.fee_options.find((x)=>x.duration_days===adDuration);
    if(!option)return;
    await call(
      ()=>secondaryJobServiceAdStudentRpc.submit(supabase,adTarget.id,adDuration),
      {
        successTitle:'광고 심사 신청 완료',
        successDescription:`지금은 GOLD가 차감되지 않습니다. 선생님 승인 시 ${formatNumber(option.fee_gold)} GOLD가 차감되고 그때부터 ${adDuration}일간 광고됩니다.`,
        onSuccess:()=>{setAdTarget(null);onDone();},
      },
    );
  };

  const cancelPendingAd=async()=>{
    if(!openAd||openAd.status!=='PENDING')return;
    await call(
      ()=>secondaryJobServiceAdStudentRpc.cancel(supabase,openAd.id),
      {
        successTitle:'광고 신청 취소 완료',
        successDescription:'심사 전 취소이므로 GOLD는 차감되지 않았습니다.',
        onSuccess:onDone,
      },
    );
  };

  const openAdRequest=()=>{
    if(!adBoard?.can_submit||openAd||activeAdCandidates.length===0)return;
    if(activeAdCandidates.length===1){
      setAdTarget(activeAdCandidates[0]);
      setAdDuration(1);
      return;
    }
    setAdPickerOpen(true);
  };

  const feeOptions=adBoard?.fee_options ?? [];
  const selectedFee=feeOptions.find((x)=>x.duration_days===adDuration)?.fee_gold ?? null;

  return <>
    <MySellerReputationCard reputation={reputation} />

    <div className="rounded-card-md border border-gold/25 bg-gold/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-black text-gold">📣 내 서비스 광고</div>
          <div className="mt-1 text-2xs text-text-secondary">
            1일 100G · 2일 190G · 3일 250G. 신청할 때는 무료이며 선생님이 승인하는 순간에만 GOLD가 차감됩니다.
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {openAd && (
            <span className={cn(
              'rounded-pill px-2.5 py-1 text-2xs font-black',
              openAd.status==='ACTIVE' ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning',
            )}>
              {openAd.status==='ACTIVE'?'광고 진행 중':'승인 대기'}
            </span>
          )}
          <button
            type="button"
            className="btn-primary whitespace-nowrap"
            disabled={actionBusy||adLoading||!!openAd||!adBoard?.can_submit||activeAdCandidates.length===0}
            onClick={openAdRequest}
          >
            📣 광고 신청
          </button>
        </div>
      </div>

      {adLoading && <div className="mt-2 text-2xs text-text-muted">광고 상태 확인 중…</div>}
      {adError && <div className="mt-2 text-2xs font-bold text-danger">광고 상태를 불러오지 못했습니다: {adError}</div>}
      {!adLoading && !adError && activeAdCandidates.length===0 && <div className="mt-2 text-2xs text-text-muted">광고를 신청하려면 먼저 아래에서 판매 중인 서비스를 1개 이상 등록하세요.</div>}
      {!adLoading && !adError && !openAd && activeAdCandidates.length>0 && adBoard && !adBoard.can_submit && <div className="mt-2 text-2xs text-text-muted">현재 다른 광고의 심사/진행이 끝난 뒤 새 광고를 신청할 수 있습니다.</div>}

      {openAd && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-card-sm bg-bg-deep p-2.5">
          <div className="min-w-0">
            <div className="truncate text-xs font-black text-white">{openAd.service_title}</div>
            <div className="mt-0.5 text-2xs text-text-muted">
              {openAd.duration_days}일 · {formatNumber(openAd.fee_gold)} GOLD
              {openAd.status==='ACTIVE' && openAd.ends_at ? ` · ${dt(openAd.ends_at)}까지` : ' · 교사 승인 대기'}
            </div>
          </div>
          {openAd.status==='PENDING' && (
            <button className="btn-secondary" disabled={actionBusy} onClick={cancelPendingAd}>신청 취소</button>
          )}
        </div>
      )}
    </div>

    <div className="flex items-center justify-between gap-3">
      <div><h3 className="font-display text-lg text-white">내 판매 서비스</h3><p className="text-xs text-text-secondary">활성 2차직업을 서비스 상품으로 등록합니다.</p></div>
      <button className="btn-primary" onClick={openNew} disabled={actionBusy||jobs.length===0}>+ 서비스 등록</button>
    </div>
    {jobs.length===0 && <div className="text-xs text-warning">활성 2차직업이 없어 등록 버튼이 비활성화되었습니다.</div>}
    {!liveItems.length?<EmptyState emoji="🧰" title="등록한 서비스가 없어요" />:<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {liveItems.map((s)=>{
        const thisOpenAd=openAd?.service_id===s.id?openAd:null;
        const canRequestAd=!!adBoard?.can_submit && s.is_active && !thisOpenAd;
        return <div key={s.id} className="bg-bg-card border border-line rounded-card-md p-3.5">
          <div className="flex justify-between gap-2"><div><div className="text-2xs text-brand-glow font-black">{s.job_name}</div><div className="font-display text-base text-white">{s.title}</div></div><span className={cn('text-2xs font-black',s.is_active?'text-success':'text-text-muted')}>{s.is_active?'판매중':'일시정지'}</span></div>
          <div className="text-sm text-gold font-black mt-2">🪙 {formatNumber(s.price_gold)}</div>
          <div className="text-[11px] font-bold text-text-muted mt-1">{s.allow_concurrent_orders?'👥 동시 주문 허용':'👤 1명씩 주문'}</div>
          <p className="text-xs text-text-secondary mt-2 line-clamp-3">{s.description}</p>
          {s.active_orders>0 && <div className="text-xs text-warning mt-2">진행 중 주문 {s.active_orders}건</div>}
          {thisOpenAd && (
            <div className={cn(
              'mt-2 rounded-card-sm border px-2 py-1.5 text-[11px] font-black',
              thisOpenAd.status==='ACTIVE'
                ? 'border-success/30 bg-success-bg text-success'
                : 'border-warning/30 bg-warning-bg text-warning',
            )}>
              📣 {thisOpenAd.status==='ACTIVE'?'광고 진행 중':'광고 승인 대기'} · {thisOpenAd.duration_days}일
            </div>
          )}
          <div className="grid grid-cols-3 gap-1.5 mt-3">
            <button className="btn-secondary" onClick={()=>openEdit(s)} disabled={actionBusy}>수정</button>
            <button className="btn-secondary" onClick={()=>toggle(s)} disabled={actionBusy}>{s.is_active?'중지':'재개'}</button>
            <button className="btn-secondary text-danger" onClick={()=>setDeleteTarget(s)} disabled={actionBusy}>삭제</button>
          </div>
          <button className="btn-secondary mt-1.5 w-full text-gold" disabled={actionBusy||adLoading||!canRequestAd} onClick={()=>{setAdTarget(s);setAdDuration(1);}}>📣 광고 신청</button>
          {!s.is_active && <div className="mt-1 text-center text-[10px] text-text-muted">판매중인 서비스만 광고할 수 있습니다.</div>}
          {s.is_active && !thisOpenAd && adBoard && !adBoard.can_submit && <div className="mt-1 text-center text-[10px] text-text-muted">현재 다른 심사/광고가 끝난 뒤 신청할 수 있습니다.</div>}
        </div>;
      })}
    </div>}

    <Modal isOpen={form!==null} onClose={()=>setForm(null)} title={form==='NEW'?'서비스 등록':'서비스 수정'} emoji="🧰">
      <div className="space-y-3">
        <label className="block"><span className="text-xs font-bold text-text-secondary">연결할 2차직업</span>
          <select className="input-field w-full mt-1" value={jobId} onChange={(e)=>setJobId(Number(e.target.value))}>
            {jobs.map(j=><option key={j.id} value={j.id}>{j.job_name}</option>)}
          </select></label>
        <label className="block"><span className="text-xs font-bold text-text-secondary">서비스 제목</span><input maxLength={80} className="input-field w-full mt-1" value={title} onChange={(e)=>setTitle(e.target.value)} /></label>
        <label className="block"><span className="text-xs font-bold text-text-secondary">설명</span><textarea rows={5} maxLength={1000} className="input-field w-full mt-1 resize-none" value={desc} onChange={(e)=>setDesc(e.target.value)} /></label>
        <label className="block"><span className="text-xs font-bold text-text-secondary">가격 GOLD</span><input type="number" min={1} max={1000000} className="input-field w-full mt-1" value={price} onChange={(e)=>setPrice(Number(e.target.value))} /></label>
        <label className="block"><span className="text-xs font-bold text-text-secondary">예상 소요 안내 (선택)</span><input maxLength={100} placeholder="예: 쉬는시간 2번 정도 / 오늘 안에" className="input-field w-full mt-1" value={delivery} onChange={(e)=>setDelivery(e.target.value)} /></label>
        <div>
          <div className="text-xs font-bold text-text-secondary mb-1.5">동시 주문 방식</div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={()=>setAllowConcurrent(false)} className={cn('rounded-card-md border p-3 text-left',!allowConcurrent?'border-brand-primary bg-brand-primary/15':'border-line bg-bg-deep')}>
              <div className="text-xs font-black text-white">👤 한 번에 1명</div>
              <div className="text-[11px] text-text-muted mt-1">진행 중 주문이 끝나야 다른 학생이 주문할 수 있어요.</div>
            </button>
            <button type="button" onClick={()=>setAllowConcurrent(true)} className={cn('rounded-card-md border p-3 text-left',allowConcurrent?'border-brand-primary bg-brand-primary/15':'border-line bg-bg-deep')}>
              <div className="text-xs font-black text-white">👥 여러 명 동시</div>
              <div className="text-[11px] text-text-muted mt-1">서로 다른 학생이 동시에 주문을 넣을 수 있어요.</div>
            </button>
          </div>
          <div className="text-[11px] text-text-muted mt-1.5">같은 학생이 같은 서비스에 진행 중 주문을 중복으로 넣는 것은 두 방식 모두 차단됩니다.</div>
        </div>
        <button className="btn-primary w-full" onClick={save} disabled={actionBusy||!jobId||title.trim().length<2||desc.trim().length<10||price<1}>저장</button>
        {(title.trim().length<2||desc.trim().length<10||price<1) && <div className="text-xs text-warning text-center">제목 2자+, 설명 10자+, 가격 1 GOLD+ 조건을 채우면 저장할 수 있습니다.</div>}
      </div>
    </Modal>

    <Modal isOpen={!!deleteTarget} onClose={()=>setDeleteTarget(null)} title="서비스 삭제" emoji="🗑️">
      {deleteTarget && <div className="space-y-3"><p className="text-sm text-text-secondary"><b className="text-white">{deleteTarget.title}</b> 서비스를 삭제합니다. 새 구매는 막히지만 기존 주문과 거래 이력은 삭제되지 않습니다.</p><button className="btn-primary w-full" disabled={actionBusy} onClick={remove}>삭제 확정</button></div>}
    </Modal>

    <Modal isOpen={adPickerOpen} onClose={()=>setAdPickerOpen(false)} title="광고할 서비스 선택" emoji="📣">
      <div className="space-y-2">
        <p className="text-xs text-text-secondary">광고 심사를 신청할 서비스를 선택하세요.</p>
        {activeAdCandidates.map((service)=>(
          <button
            type="button"
            key={service.id}
            onClick={()=>{setAdPickerOpen(false);setAdTarget(service);setAdDuration(1);}}
            className="w-full rounded-card-md border border-line bg-bg-deep p-3 text-left hover:border-gold/50"
          >
            <div className="text-2xs font-black text-brand-glow">{service.job_name}</div>
            <div className="mt-0.5 font-display text-sm text-white">{service.title}</div>
            <div className="mt-1 text-xs font-black text-gold">🪙 {formatNumber(service.price_gold)}</div>
          </button>
        ))}
      </div>
    </Modal>

    <Modal isOpen={!!adTarget} onClose={()=>setAdTarget(null)} title="서비스 광고 신청" emoji="📣">
      {adTarget && (
        <div className="space-y-3">
          <div className="rounded-card-md bg-bg-deep p-3">
            <div className="text-2xs font-black text-brand-glow">{adTarget.job_name}</div>
            <div className="mt-0.5 font-display text-base text-white">{adTarget.title}</div>
            <div className="mt-1 text-xs text-text-secondary">서비스 가격 · {formatNumber(adTarget.price_gold)} GOLD</div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-bold text-text-secondary">광고 유지 기간</div>
            <div className="grid grid-cols-3 gap-2">
              {feeOptions.map((option)=>(
                <button
                  type="button"
                  key={option.duration_days}
                  onClick={()=>setAdDuration(option.duration_days)}
                  className={cn(
                    'rounded-card-md border p-3 text-center',
                    adDuration===option.duration_days ? 'border-gold bg-gold/10' : 'border-line bg-bg-deep',
                  )}
                >
                  <div className="text-sm font-black text-white">{option.duration_days}일</div>
                  <div className="mt-1 text-xs font-black text-gold">{formatNumber(option.fee_gold)}G</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-card-md border border-warning/25 bg-warning-bg p-3 text-xs text-warning">
            신청 즉시 결제되지 않습니다. 선생님이 승인하는 시점에 잔액과 서비스 상태를 다시 확인하고
            {selectedFee!==null ? ` ${formatNumber(selectedFee)} GOLD를 차감한 뒤` : ''} 광고가 시작됩니다.
          </div>

          <button className="btn-primary w-full" disabled={actionBusy||selectedFee===null} onClick={submitAd}>광고 심사 신청</button>
        </div>
      )}
    </Modal>
  </>;
}
