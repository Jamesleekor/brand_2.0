import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/shared/components';
import { supabase } from '@/lib/supabase/client';
import { useStudentId } from '@/stores/auth_store';
import { quickServiceRpc, type QuickServiceOrder, type QuickServiceAction } from '@/lib/rpc/quick_service_rpc';
// Only settle existing QUICK orders. New trades use the standard service market.
export function QuickServiceEscrowPanel(){
 const studentId=useStudentId();const queryClient=useQueryClient();const lock=useRef(false);
 const [action,setAction]=useState<{order:QuickServiceOrder;type:QuickServiceAction}|null>(null);const [reason,setReason]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const board=useQuery({queryKey:['quick-service-board',studentId],enabled:!!studentId,queryFn:async()=>{const r=await quickServiceRpc.board(supabase);if(r.success===false)throw new Error(r.error);return r.data;},staleTime:15000});
 const run=async()=>{if(!action||lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await quickServiceRpc.act(supabase,{p_order_id:action.order.id,p_action:action.type,p_reason:reason.trim()||null});if(r.success===false){setError(r.error);return;}setAction(null);for(const key of ['quick-service-board','service-activity','secondary-job-service-market','wallet','transactions','mail'])void queryClient.invalidateQueries({queryKey:[key]});}catch(e){setError(e instanceof Error?e.message:'처리하지 못했어요.');}finally{lock.current=false;setBusy(false);}};
 if(!board.data?.orders.length)return null;
 return <section className="rounded-card-lg border border-gold/30 bg-bg-card p-3.5 text-amber-50"><h2 className="font-bold text-gold">기존 간편 거래 마무리</h2><p className="mt-1 text-xs">이미 맡긴 대금의 지급·환불만 처리할 수 있어요.</p>
  {board.data.orders.map(o=><div key={o.id} className="mt-2 rounded-card-md border border-line p-3"><b className="text-sm">{o.service_title} · {o.amount.toLocaleString()}G</b><p className="mt-1 text-xs">{o.buyer_student_id===studentId?o.seller_name:o.buyer_name} · {o.status==='DISPUTED'?'운영국 확인 중':'대금 보관 중'}</p><div className="mt-2 flex gap-2 flex-wrap">
   {o.buyer_student_id===studentId&&o.status!=='DISPUTED'&&<button className="btn-primary" onClick={()=>{setAction({order:o,type:'PAY'});setReason('');setError('');}}>서비스 받음 · 지급</button>}
   {o.seller_student_id===studentId&&<button className="btn-secondary" onClick={()=>{setAction({order:o,type:'REFUND'});setReason('');setError('');}}>환불</button>}
   {o.status!=='DISPUTED'&&<button className="btn-secondary" onClick={()=>{setAction({order:o,type:'DISPUTE'});setReason('');setError('');}}>운영국 확인 요청</button>}
  </div></div>)}
  <Modal isOpen={!!action} onClose={()=>{if(!busy)setAction(null);}} title={action?.type==='PAY'?'서비스 대금 지급':action?.type==='REFUND'?'대금 환불':'운영국 확인 요청'}>
   <div className="space-y-3 text-amber-50"><p className="text-sm">{action?.order.service_title}</p>{action?.type==='PAY'?<p className="text-xs">실제로 서비스를 받았다면 대금을 지급하세요.</p>:<textarea className="input-field w-full" maxLength={500} placeholder={action?.type==='DISPUTE'?'사유를 2자 이상 입력하세요':'환불 사유 (선택)'} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy}/>}{error&&<p role="alert" className="text-xs text-danger">{error}</p>}<button className="btn-primary w-full" disabled={busy} onClick={()=>void run()}>{busy?'처리 중…':'확인'}</button></div>
  </Modal>
 </section>;
}
